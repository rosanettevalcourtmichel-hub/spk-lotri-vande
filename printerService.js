import { NativeModules } from 'react-native';
import AsyncStorage from '@react-native-async-storage/async-storage';

const { PrinterModule } = NativeModules;
const PRINTER_KEY = '@spk-lotri-vande/printer-config';

const buildTicketText = ({ ticketNumber, agent, director, draw, entries, total, ticketSettings }) => {
  const lines = [
    'SPK LOTRI',
    `Tikè: ${ticketNumber}`,
    `Ajan: ${agent || ''}`,
    `Dirèk: ${director || ''}`,
    `Tiraj: ${draw || ''}`,
    `Dat: ${new Date().toISOString()}`,
    '',
  ];

  (entries || []).forEach((entry, index) => {
    lines.push(`${index + 1}. ${entry.option} · ${entry.type} · G ${Number(entry.price || 0).toFixed(0)}`);
  });

  lines.push('', `Total: G ${Number(total || 0).toFixed(0)}`);
  return lines.join('\n');
};

export const printTicket = async ({ ticketNumber, agent, director, draw, entries, total, ticketSettings }) => {
  try {
    const savedPrinter = await AsyncStorage.getItem(PRINTER_KEY);
    const printerConfig = savedPrinter ? JSON.parse(savedPrinter) : null;

    if (!printerConfig?.address || !PrinterModule?.printText) {
      return false;
    }

    if (PrinterModule?.getPrinterState) {
      const state = await PrinterModule.getPrinterState();
      const selectedPrinter = (state?.devices || []).find((device) => device.address === printerConfig.address);
      if (!state?.enabled || state?.permissionGranted === false || !selectedPrinter) {
        return false;
      }
    }

    const content = buildTicketText({ ticketNumber, agent, director, draw, entries, total, ticketSettings });
    return Boolean(await PrinterModule.printText(content, printerConfig.address));
  } catch (error) {
    return false;
  }
};

export const getPrinterDevices = async () => {
  try {
    if (!PrinterModule?.getPrinterState) return [];
    const state = await PrinterModule.getPrinterState();
    if (!state?.enabled || state?.permissionGranted === false) return [];
    return state?.devices || [];
  } catch (error) {
    return [];
  }
};

export const testPrinter = async () => {
  try {
    const savedPrinter = await AsyncStorage.getItem(PRINTER_KEY);
    const printerConfig = savedPrinter ? JSON.parse(savedPrinter) : null;
    const devices = await getPrinterDevices();
    return Boolean(printerConfig?.address && devices.some((device) => device.address === printerConfig.address));
  } catch (error) {
    return false;
  }
};
