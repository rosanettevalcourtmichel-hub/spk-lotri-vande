package com.lotrivande.spklotrivande

import android.bluetooth.BluetoothAdapter
import android.bluetooth.BluetoothManager
import android.content.Context
import android.content.pm.PackageManager
import android.os.Build
import java.io.OutputStream
import com.facebook.react.bridge.Arguments
import com.facebook.react.bridge.Promise
import com.facebook.react.bridge.ReactApplicationContext
import com.facebook.react.bridge.ReactContextBaseJavaModule
import com.facebook.react.bridge.ReactMethod
import java.util.UUID

class PrinterModule(private val reactContext: ReactApplicationContext) : ReactContextBaseJavaModule(reactContext) {

  private val serialUuids = listOf(
    UUID.fromString("00001101-0000-1000-8000-00805F9B34FB"),
    UUID.fromString("0000111F-0000-1000-8000-00805F9B34FB")
  )

  private fun bluetoothAdapter(): BluetoothAdapter? {
    return if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.M) {
      val manager = reactContext.getSystemService(Context.BLUETOOTH_SERVICE) as? BluetoothManager
      manager?.adapter
    } else {
      BluetoothAdapter.getDefaultAdapter()
    }
  }

  private fun hasBluetoothPermission(): Boolean {
    return Build.VERSION.SDK_INT < Build.VERSION_CODES.S ||
      reactContext.checkSelfPermission(android.Manifest.permission.BLUETOOTH_CONNECT) == PackageManager.PERMISSION_GRANTED
  }

  private fun writeEscPos(output: OutputStream, content: String) {
    output.write(byteArrayOf(0x1B, 0x40))
    val bytes = content.toByteArray(Charsets.UTF_8)
    bytes.asList().chunked(512).forEach { chunk ->
      output.write(chunk.toByteArray())
      output.flush()
    }
    output.write(byteArrayOf(0x0A, 0x0A, 0x0A))
    output.flush()
  }

  private fun connectToPrinter(device: android.bluetooth.BluetoothDevice): android.bluetooth.BluetoothSocket {
    var lastError: Exception? = null

    for (uuid in serialUuids) {
      var socket: android.bluetooth.BluetoothSocket? = null
      try {
        socket = device.createRfcommSocketToServiceRecord(uuid)
        socket.connect()
        return socket
      } catch (error: Exception) {
        lastError = error
        try {
          socket?.close()
        } catch (_: Exception) {
        }
      }
    }

    var insecureSocket: android.bluetooth.BluetoothSocket? = null
    try {
      val insecureMethod = device.javaClass.getMethod("createRfcommSocket", Int::class.javaPrimitiveType!!)
      insecureSocket = insecureMethod.invoke(device, 1) as android.bluetooth.BluetoothSocket
      insecureSocket.connect()
      return insecureSocket
    } catch (error: Exception) {
      lastError = error
      try {
        insecureSocket?.close()
      } catch (_: Exception) {
      }
    }

    throw lastError ?: IllegalStateException("Printer Bluetooth socket unavailable")
  }

  override fun getName(): String = "PrinterModule"

  @ReactMethod
  fun getPrinterState(promise: Promise) {
    try {
      val bluetoothAdapter = bluetoothAdapter()
      if (!hasBluetoothPermission()) {
        val response = Arguments.createMap()
        response.putBoolean("enabled", false)
        response.putBoolean("permissionGranted", false)
        response.putArray("devices", Arguments.createArray())
        promise.resolve(response)
        return
      }

      val devices = bluetoothAdapter?.bondedDevices?.map { device ->
        Arguments.createMap().apply {
          putString("name", device.name ?: "Printer Bluetooth")
          putString("address", device.address)
        }
      } ?: emptyList()

      val response = Arguments.createMap()
      response.putBoolean("enabled", bluetoothAdapter?.isEnabled == true)
      response.putBoolean("permissionGranted", true)
      response.putArray("devices", Arguments.fromList(devices))
      promise.resolve(response)
    } catch (error: Exception) {
      promise.reject("PRINTER_ERROR", error.message ?: "Printer unavailable", error)
    }
  }

  @ReactMethod
  fun printText(content: String, address: String, promise: Promise) {
    try {
      val bluetoothAdapter = bluetoothAdapter()
      if (!hasBluetoothPermission()) {
        promise.resolve(false)
        return
      }
      val device = bluetoothAdapter?.bondedDevices?.firstOrNull { it.address == address }
      if (device == null) {
        promise.resolve(false)
        return
      }

      bluetoothAdapter?.cancelDiscovery()
      val socket = connectToPrinter(device)
      try {
        socket.outputStream.use { output ->
          writeEscPos(output, content)
        }
        promise.resolve(true)
      } finally {
        socket.close()
      }
    } catch (error: Exception) {
      promise.reject("PRINT_ERROR", error.message ?: "Print failed", error)
    }
  }
}
