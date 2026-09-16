import React, { useEffect, useMemo, useRef, useState } from "react";
import {
  ActivityIndicator,
  Alert,
  FlatList,
  KeyboardAvoidingView,
  Modal,
  Platform,
  PermissionsAndroid,
  Pressable,
  SafeAreaView,
  ScrollView,
  StyleSheet,
  Switch,
  Text,
  TextInput,
  View,
} from "react-native";
import AsyncStorage from "@react-native-async-storage/async-storage";
import { StatusBar } from "expo-status-bar";
import { CameraView, useCameraPermissions } from "expo-camera";
import {
  getOpenDraws,
  validateOption,
  GAME_TYPES,
  OPTIONS,
  DRAWS,
  limits,
  getDrawCutoffMessage,
  isDrawOpen,
} from "./lotteryRules";
import {
  getTickets,
  saveTicket,
  saveTransaction,
  getTransactions,
  getResults,
  getLimits,
  getLimitUsage,
  getBlockedNumbers,
  login,
  logout,
  updateTicket,
  deleteTicketBundle,
  getAgentStatus,
  updateAgentPresence,
} from "./firebaseService";
import { getPrinterDevices, printTicket } from "./printerService";

const SESSION_KEY = "@spk-lotri-vande/session";
const PRINTER_KEY = "@spk-lotri-vande/printer-config";
const PRINTER_SETUP_KEY = "@spk-lotri-vande/printer-setup-complete";
const TICKET_LAYOUT_KEY = "@spk-lotri-vande/ticket-layout";
const DEFAULT_TICKET_LAYOUT = {
  lotteryName: "SPK LOTRI",
  address: "",
  directorName: "",
  footer: "",
  logoData: "",
};

const money = (value) => `G ${Number(value || 0).toFixed(0)}`;
const today = () => new Date().toISOString().slice(0, 10);

const BOULE_OPTIONS = ["11", "22", "33", "44", "55", "66", "77", "88", "99", "00"];
const LOTO3_GRAP_OPTIONS = ["111", "222", "333", "444", "555", "666", "777", "888", "999", "000"];

const getConfiguredLimit = (limitsConfig, draw, game, option, agentUid) => {
  if (!limitsConfig || typeof limitsConfig !== "object") return null;

  const candidates = [
    limitsConfig?.general?.[game]?.[draw]?.[option],
    limitsConfig?.general?.[draw]?.[option],
    limitsConfig?.draws?.[draw]?.[option],
    limitsConfig?.draws?.[draw]?.[game]?.[option],
    limitsConfig?.agents?.[agentUid]?.[game]?.[draw]?.[option],
    limitsConfig?.agents?.[agentUid]?.[draw]?.[option],
    limitsConfig?.[game]?.[draw]?.[option],
    limitsConfig?.[draw]?.[option],
    limitsConfig?.[game]?.[option],
  ];

  const limit = candidates.find((value) => value !== undefined && value !== null && value !== "");
  return limit === undefined || limit === null || limit === "" ? null : Number(limit);
};

const optionLabels = ["Opsyon 1", "Opsyon 2", "Opsyon 3"];

const buildEntryNumbers = (digits, reverseMode, game) => {
  const normalized = String(digits || "").replace(/\D/g, "");
  if (!normalized) return [];

  const numbers = new Set([normalized]);

  if (reverseMode) {
    const reversed = normalized.split("").reverse().join("");
    if (reversed && reversed !== normalized) numbers.add(reversed);
  }

  return Array.from(numbers);
};

function App() {
  const [ready, setReady] = useState(false);
  const [printerConfigured, setPrinterConfigured] = useState(false);
  const [session, setSession] = useState(null);
  const [sales, setSales] = useState([]);
  const [tickets, setTickets] = useState([]);
  const [transactions, setTransactions] = useState([]);
  const [results, setResults] = useState([]);
  const [limits, setLimits] = useState({});
  const [draw, setDraw] = useState(DRAWS[0] || "");
  const [game, setGame] = useState(GAME_TYPES[0]?.label || "");
  const [option, setOption] = useState("");
  const [price, setPrice] = useState("");
  const [menuVisible, setMenuVisible] = useState(false);
  const [screen, setScreen] = useState(null);
  const [scanVisible, setScanVisible] = useState(false);
  const [ticketLayout, setTicketLayout] = useState(DEFAULT_TICKET_LAYOUT);
  const [blockedByAdmin, setBlockedByAdmin] = useState(false);

  useEffect(() => {
    (async () => {
      try {
        const [storedSession, savedPrinter, setupComplete, savedLayout] = await Promise.all([
          AsyncStorage.getItem(SESSION_KEY),
          AsyncStorage.getItem(PRINTER_KEY),
          AsyncStorage.getItem(PRINTER_SETUP_KEY),
          AsyncStorage.getItem(TICKET_LAYOUT_KEY),
        ]);

        if (storedSession) {
          setSession(JSON.parse(storedSession));
        }

        const hasSavedPrinter = Boolean(savedPrinter && JSON.parse(savedPrinter)?.address);
        setPrinterConfigured(hasSavedPrinter || setupComplete === "true");
        if (savedLayout) {
          setTicketLayout({ ...DEFAULT_TICKET_LAYOUT, ...JSON.parse(savedLayout) });
        }
      } catch (error) {
        console.warn("App init error", error);
      } finally {
        setReady(true);
      }
    })();
  }, []);

  useEffect(() => {
    if (!session?.uid) return;

    let active = true;
    const loadData = async () => {
      try {
        const [ticketsRes, txRes, resultsRes, limitsRes] = await Promise.all([
          getTickets(session.uid),
          getTransactions(session.uid),
          getResults(),
          getLimits(),
        ]);

        if (!active) return;
        setTickets(ticketsRes || []);
        setTransactions(txRes || []);
        setResults(resultsRes || []);
        setLimits(limitsRes || {});
      } catch (error) {
        console.warn("loadData", error);
      }
    };

    loadData();
    return () => {
      active = false;
    };
  }, [session]);

  useEffect(() => {
    if (!session?.uid) return;

    const ping = async () => {
      try {
        const profile = await getAgentStatus(session.uid);
        if (profile?.blocked) {
          setBlockedByAdmin(true);
          return;
        }

        setBlockedByAdmin(false);
        if (profile && (profile.commission !== session.commission || profile.firstPrize !== session.firstPrize)) {
          setSession((current) => ({ ...current, ...profile }));
        }
        await updateAgentPresence(session.uid).catch(() => {});
      } catch (error) {
        console.warn("Ping error", error);
      }
    };

    ping();
    const timer = setInterval(ping, 60000);
    return () => clearInterval(timer);
  }, [session]);

  const doLogin = async (user) => {
    setSession(user);
    await AsyncStorage.setItem(SESSION_KEY, JSON.stringify(user));
  };

  const doLogout = async () => {
    try {
      await logout();
    } catch (error) {
      console.warn("logout error", error);
    }

    await AsyncStorage.removeItem(SESSION_KEY);
    setSession(null);
    setSales([]);
    setMenuVisible(false);
    setScreen(null);
  };

  const saveTicketLayout = async (layout) => {
    setTicketLayout(layout);
    await AsyncStorage.setItem(TICKET_LAYOUT_KEY, JSON.stringify(layout));
    setScreen(null);
    Alert.alert("Paramèt", "Tèt ak anba fich la anrejistre.");
  };

  const printReport = async ({ startDate, endDate, salesTotal, commission, paid, profit }) => {
    try {
      const printed = await printTicket({
        ticketNumber: `report-${Date.now()}`,
        agent: session.username,
        director: session.director,
        draw: "Rapò",
        entries: [],
        total: salesTotal,
        ticketSettings: ticketLayout,
        report: {
          title: "Rapò",
          startDate,
          endDate,
          salesTotal,
          commission,
          paid,
          profit,
        },
      });

      Alert.alert(
        printed ? "Rapò enprime" : "Rapò anrejistre",
        printed
          ? "Rapò a enprime avèk dat ak kantite yo."
          : "Rapò la anrejistre nan istorik la. Printer la pa disponib kounye a."
      );
    } catch (error) {
      Alert.alert("Rapò", "Rapò la pa t ka enprime. Printer la pa disponib kounye a.");
    }
  };

  const print = async () => {
    if (!sales.length) {
      Alert.alert("Fich", "Ajoute yon boul avan ou enprime.");
      return;
    }

    if (!isDrawOpen(draw)) {
      Alert.alert("Tiraj fèmen", `${getDrawCutoffMessage(draw)} Chwazi yon lòt tiraj.`);
      return;
    }

    const total = sales.reduce((sum, item) => sum + Number(item.price || 0), 0);
    const ticketNumber = `${Date.now()}`;
    const createdAt = new Date().toISOString();

    try {
      const saved = sales.map((item, index) => ({
        ...item,
        ticketId: `${ticketNumber}-${index}`,
        ticketNumber,
        agentUid: session.uid,
        ajanNom: session.username,
        createdAt,
      }));

      await Promise.all(saved.map(saveTicket));
      await saveTransaction({
        id: ticketNumber,
        agentUid: session.uid,
        ajanNom: session.username,
        montanVanti: total,
        tiraj: draw,
        dateTransaksyon: createdAt,
      });

      setTickets((current) => [...current, ...saved]);
      setSales([]);

      try {
        const printed = await printTicket({
          ticketNumber,
          agent: session.username,
          director: session.director,
          draw,
          entries: saved,
          total,
          ticketSettings: ticketLayout,
        });

        Alert.alert(
          printed ? "Siksè" : "Fich anrejistre",
          printed
            ? "Fich la enprime epi li anrejistre."
            : "Fich la anrejistre nan istorik la. Printer la pa disponib kounye a."
        );
      } catch (error) {
        Alert.alert(
          "Fich anrejistre",
          "Fich la anrejistre nan kontwòl ak istorik tikè a. Printer la pa disponib kounye a."
        );
      }
    } catch (error) {
      Alert.alert("Fich", "Fich la pa t ka anrejistre. Verifye koneksyon an.");
    }
  };

  const chooseMenu = (key) => {
    setMenuVisible(false);
    switch (key) {
      case "printer":
        setScreen("printer");
        break;
      case "help":
        setScreen("help");
        break;
      case "draws":
        setScreen("draws");
        break;
      case "delete":
        setScreen("delete");
        break;
      case "reprint":
      case "pay":
        setScreen(key);
        break;
      default:
        setScreen(key);
        break;
    }
  };

  if (!ready) {
    return (
      <View style={styles.loading}>
        <ActivityIndicator size="large" color="#123b66" />
      </View>
    );
  }

  if (!printerConfigured) {
    return <PrinterSetup onComplete={() => setPrinterConfigured(true)} />;
  }

  if (!session) {
    return <Login onLogin={doLogin} />;
  }

  if (blockedByAdmin) {
    return (
      <SafeAreaView style={styles.login}>
        <StatusBar style="dark" />
        <View style={styles.brand}>
          <Text style={styles.brandLetter}>!</Text>
        </View>
        <Text style={styles.eyebrow}>SPK LOTRI / AKÈS BLOKE</Text>
        <Text style={styles.hero}>Admin an bloke kont ou.</Text>
        <Text style={styles.subtitle}>
          Kontakte admin lan pou li debloke ajan sa a. Ou pap ka vann oswa itilize meni a pandan kont lan bloke.
        </Text>
        <Button label="Soti" tone="danger" onPress={doLogout} />
      </SafeAreaView>
    );
  }

  return (
    <>
      <Home
        session={session}
        sales={sales}
        setSales={setSales}
        draw={draw}
        setDraw={setDraw}
        game={game}
        setGame={setGame}
        option={option}
        setOption={setOption}
        price={price}
        setPrice={setPrice}
        limits={limits}
        onPrint={print}
        onMenu={() => setMenuVisible(true)}
      />

      <Menu
        visible={menuVisible}
        onClose={() => setMenuVisible(false)}
        onSelect={chooseMenu}
        onLogout={doLogout}
      />

      <Report
        visible={screen === "today" || screen === "date" || screen === "history"}
        title={
          screen === "history"
            ? "Istorik tikè"
            : screen === "date"
              ? "Kontwòl pa dat"
              : "Kontwòl jodi a"
        }
        range={screen === "date"}
        tickets={tickets}
        transactions={transactions}
        session={session}
        onPrintReport={printReport}
        onClose={() => setScreen(null)}
      />

      {(screen === "reprint" || screen === "pay" || screen === "delete") && (
        <TicketAction
          type={screen}
          tickets={tickets}
          onClose={() => setScreen(null)}
          onScan={() => {
            setScreen(null);
            setScanVisible(true);
          }}
          onPrint={async (ticket) => {
            const entries = Array.isArray(ticket.entries) ? ticket.entries : [ticket];
            const total = entries.reduce((sum, item) => sum + Number(item.price || 0), 0);

            await printTicket({
              ticketNumber: ticket.ticketNumber || ticket.ticketId || ticket.id,
              agent: session.username,
              director: session.director,
              draw: ticket.draw || entries[0]?.draw,
              entries,
              total,
            });
            Alert.alert("Siksè", "Fich la enprime.");
          }}
          onPay={async (ticket) => {
            const entries = Array.isArray(ticket.entries) ? ticket.entries : [ticket];
            await Promise.all(
              entries.map((entry) =>
                updateTicket(entry.ticketId || entry.id, {
                  paid: true,
                  paidAt: new Date().toISOString(),
                  payout: Number(entry.price || 0) * Number(session.firstPrize || 50),
                })
              )
            );
            Alert.alert("Peman", "Peman an anrejistre.");
          }}
        />
      )}

      {screen === "draws" && <DrawList onClose={() => setScreen(null)} results={results} />}
      {screen === "help" && <Help onClose={() => setScreen(null)} />}
      {screen === "printer" && (
        <PrinterSetup
          onComplete={() => {
            setPrinterConfigured(true);
            setScreen(null);
          }}
          mini
        />
      )}

      {scanVisible && (
        <Scan
          onClose={() => setScanVisible(false)}
          onFound={(code) => {
            setScanVisible(false);
            setScreen("reprint");
            Alert.alert("Scan", `Kòd fich la: ${code}`);
          }}
        />
      )}
    </>
  );
}

function Login({ onLogin }) {
  const [username, setUsername] = useState("");
  const [pin, setPin] = useState("");
  const [busy, setBusy] = useState(false);

  const submit = async () => {
    if (!username.trim() || !pin.trim()) {
      Alert.alert("Login", "Mete non ajan ak kòd ajan.");
      return;
    }

    setBusy(true);
    try {
      const result = await login(username, pin);
      if (!result.ok) {
        Alert.alert("Login", result.message);
        return;
      }
      await onLogin(result.user);
    } finally {
      setBusy(false);
    }
  };

  return (
    <SafeAreaView style={styles.login}>
      <StatusBar style="dark" />
      <View style={styles.brand}>
        <Text style={styles.brandLetter}>L</Text>
      </View>
      <Text style={styles.eyebrow}>SPK LOTRI / VANDÈ</Text>
      <Text style={styles.hero}>Bonjou.</Text>
      <Text style={styles.subtitle}>Antre non ajan ak kòd ajan pou kòmanse pran fich.</Text>
      <View style={styles.panel}>
        <Field label="Non ajan" value={username} onChangeText={setUsername} placeholder="Non ajan" />
        <Field label="Kòd ajan" value={pin} onChangeText={setPin} placeholder="Kòd ajan" secureTextEntry />
        <Button label={busy ? "Ap verifye..." : "Antre"} onPress={submit} disabled={busy} />
      </View>
    </SafeAreaView>
  );
}

function PrinterSetup({ onComplete, mini = false }) {
  const [saving, setSaving] = useState(false);
  const [devices, setDevices] = useState([]);
  const [selectedAddress, setSelectedAddress] = useState("");
  const [loadingDevices, setLoadingDevices] = useState(true);

  const loadDevices = async () => {
    setLoadingDevices(true);
    try {
      if (Platform.OS === "android" && Number(Platform.Version) >= 31) {
        await PermissionsAndroid.requestMultiple([
          PermissionsAndroid.PERMISSIONS.BLUETOOTH_CONNECT,
          PermissionsAndroid.PERMISSIONS.BLUETOOTH_SCAN,
        ]);
      } else if (Platform.OS === "android") {
        await PermissionsAndroid.requestMultiple([
          PermissionsAndroid.PERMISSIONS.ACCESS_FINE_LOCATION,
          PermissionsAndroid.PERMISSIONS.ACCESS_COARSE_LOCATION,
        ]);
      }
      const foundDevices = await getPrinterDevices();
      setDevices(foundDevices);
      const savedPrinter = await AsyncStorage.getItem(PRINTER_KEY);
      const savedAddress = savedPrinter ? JSON.parse(savedPrinter)?.address : "";
      const preferredDevice = foundDevices.find((device) => device.address === savedAddress)
        || foundDevices.find((device) => String(device.name || "").trim().toLowerCase() === "enpresyon")
        || foundDevices[0];
      setSelectedAddress(preferredDevice?.address || "");
    } finally {
      setLoadingDevices(false);
    }
  };

  useEffect(() => {
    loadDevices();
  }, []);

  const configure = async () => {
    if (!selectedAddress) {
      Alert.alert("Printer", "Pè aparèy Bluetooth printer la dabò, epi peze Chèche ankò.");
      return;
    }

    setSaving(true);
    try {
      await AsyncStorage.setItem(PRINTER_KEY, JSON.stringify({
        address: selectedAddress,
        name: devices.find((device) => device.address === selectedAddress)?.name || "Printer",
        configuredAt: new Date().toISOString(),
      }));
      await AsyncStorage.setItem(PRINTER_SETUP_KEY, "true");

      await printTicket({
        ticketNumber: "test",
        agent: "test",
        director: "",
        draw: DRAWS[0] || "",
        entries: [],
        total: 0,
        ticketSettings: DEFAULT_TICKET_LAYOUT,
      });

      onComplete();
    } catch (error) {
      Alert.alert(
        "Printer",
        "Printer la pa reponn. Verifye li pè ak terminal la epi eseye ankò."
      );
    } finally {
      setSaving(false);
    }
  };

  if (mini) {
    return (
      <Modal visible animationType="slide" transparent>
        <View style={styles.modalOverlay}>
          <View style={styles.modalInner}>
            <Text style={styles.section}>Chwazi printer la</Text>
            {loadingDevices ? <ActivityIndicator color="#1d4f8f" /> : devices.length ? devices.map((device) => (
              <Pressable
                key={device.address}
                onPress={() => setSelectedAddress(device.address)}
                style={[styles.choice, selectedAddress === device.address && styles.choiceActive]}
              >
                <Text style={styles.choiceText}>{device.name}</Text>
                <Text style={styles.muted}>{device.address}</Text>
              </Pressable>
            )) : <Text style={styles.muted}>Pa gen printer pè oswa pèmisyon Bluetooth/Location lan poko aksepte. Verifye aparèy `enpresyon` an nan paramèt Bluetooth Android yo, aksepte pèmisyon yo, epi peze Chèche ankò.</Text>}
            <Button label="Chèche printer" tone="secondary" onPress={loadDevices} disabled={loadingDevices || saving} />
            <Button label={saving ? "Ap konekte..." : "Chwazi epi sove"} onPress={configure} disabled={saving || loadingDevices || !selectedAddress} />
            <Button label="Fèmen" tone="ghost" onPress={onComplete} />
          </View>
        </View>
      </Modal>
    );
  }

  return (
    <SafeAreaView style={styles.login}>
      <StatusBar style="dark" />
      <View style={styles.brand}>
        <Text style={styles.brandLetter}>▣</Text>
      </View>
      <Text style={styles.eyebrow}>SPK LOTRI / PRINTER</Text>
      <Text style={styles.hero}>Konekte enprimant lan.</Text>
      <Text style={styles.subtitle}>
        Pè printer entèn lan ak terminal la nan Bluetooth Android, epi chwazi li anba a. App la ap sonje li pou enprime rapid.
      </Text>
      <View style={styles.panel}>
        <Text style={styles.muted}>
          {loadingDevices ? "Ap chèche printer ki konekte..." : devices.length ? "Chwazi printer ki pou resevwa fich yo." : "Pa gen printer pè oswa pèmisyon Bluetooth/Location lan poko aksepte. Verifye aparèy enpresyon an nan paramèt Bluetooth Android yo, epi peze Chèche ankò."}
        </Text>
        {!loadingDevices && devices.map((device) => (
          <Pressable
            key={device.address}
            onPress={() => setSelectedAddress(device.address)}
            style={[styles.choice, selectedAddress === device.address && styles.choiceActive]}
          >
            <Text style={styles.choiceText}>{device.name}</Text>
            <Text style={styles.muted}>{device.address}</Text>
          </Pressable>
        ))}
        <Button label="Chèche printer" tone="secondary" onPress={loadDevices} disabled={loadingDevices || saving} />
        <Button label={saving ? "Ap konekte..." : "Chwazi epi sove printer la"} onPress={configure} disabled={saving || loadingDevices || !selectedAddress} />
      </View>
    </SafeAreaView>
  );
}

function Home({ session, sales, setSales, draw, setDraw, game, setGame, option, setOption, price, setPrice, limits, onPrint, onMenu }) {
  const [drawsOpen, setDrawsOpen] = useState(false);
  const [gamesOpen, setGamesOpen] = useState(false);
  const [reverseMode, setReverseMode] = useState(false);
  const [keepPrice, setKeepPrice] = useState(false);
  const [adding, setAdding] = useState(false);
  const [selectedOptions, setSelectedOptions] = useState([1]);
  const priceInputRef = useRef(null);

  const total = useMemo(() => sales.reduce((sum, item) => sum + Number(item.price || 0), 0), [sales]);
  const openDraws = getOpenDraws();
  const isOptionGame = game === "Loto 4 chif" || game === "Loto 5 chif";

  const addAllBoulNumbers = async () => {
    if (!draw) {
      Alert.alert("Tiraj", "Chwazi tiraj la anvan.");
      return;
    }

    if (!game || game !== "Boul") {
      Alert.alert("Bòlèt", "Chwazi bòlèt Boul anvan.");
      return;
    }

    const amount = Number(price);
    if (!amount || amount <= 0) {
      Alert.alert("Pri", "Mete yon pri avan ou ajoute tout boul yo.");
      return;
    }

    const entries = BOULE_OPTIONS.map((item, index) => ({
      id: `${Date.now()}-${Math.random()}-${item}-${index}`,
      draw,
      type: game,
      option: item,
      price: amount,
      optionId: 1,
    }));

    setSales((current) => [...current, ...entries]);
    setOption("");
    if (!keepPrice) setPrice("");
  };

  const addLoto3GrapNumbers = async () => {
    if (!draw) {
      Alert.alert("Tiraj", "Chwazi tiraj la anvan.");
      return;
    }

    if (!game || game !== "Loto 3 chif") {
      Alert.alert("Bòlèt", "Chwazi bòlèt Loto 3 chif anvan.");
      return;
    }

    const amount = Number(price);
    if (!amount || amount <= 0) {
      Alert.alert("Pri", "Mete yon pri avan ou ajoute grap boul pe yo.");
      return;
    }

    const entries = LOTO3_GRAP_OPTIONS.map((item, index) => ({
      id: `${Date.now()}-${Math.random()}-${item}-${index}`,
      draw,
      type: game,
      option: item,
      price: amount,
      optionId: 1,
    }));

    setSales((current) => [...current, ...entries]);
    setOption("");
    if (!keepPrice) setPrice("");
  };

  const addEntries = async () => {
    if (adding) return;

    if (!draw) {
      Alert.alert("Tiraj", "Chwazi tiraj la anvan.");
      return;
    }
    if (!game) {
      Alert.alert("Bòlèt", "Chwazi bòlèt la anvan.");
      return;
    }

    const digits = option.replace(/\D/g, "");
    if (!validateOption(game, digits)) {
      Alert.alert("Boul", "Nimewo a pa gen bon fòma pou jwèt sa.");
      return;
    }

    const amount = Number(price);
    if (!amount || amount <= 0) {
      Alert.alert("Pri", "Mete yon pri ki pi gran pase zewo.");
      return;
    }

    const optionIds = isOptionGame ? (selectedOptions.length ? selectedOptions : [1]) : [1];
    const numbers = buildEntryNumbers(digits, reverseMode, game);

    const newEntries = numbers.flatMap((number) =>
      optionIds.map((selectedOption) => ({
        id: `${Date.now()}-${Math.random()}-${number}-${selectedOption}`,
        draw,
        type: game,
        option: number,
        price: amount,
        optionId: selectedOption,
      }))
    );

    setAdding(true);
    try {
      for (const entry of numbers) {
        const limit = getConfiguredLimit(limits, draw, game, entry, session.uid);
        if (limit !== null) {
          const currentUsage = await getLimitUsage({
            game,
            option: entry,
            draw,
            agentUid: session.uid,
            date: today(),
          });

          if (currentUsage + newEntries.filter((item) => item.option === entry).length > limit) {
            Alert.alert(
              "Limit boul",
              `Boul ${entry} pou tiraj ${draw} rive nan limit la (${limit}). Fich la pa anrejistre.`
            );
            return;
          }
        }
      }

      setSales((current) => [...current, ...newEntries]);
      setOption("");
      if (!keepPrice) setPrice("");
    } finally {
      setAdding(false);
    }
  };

  return (
    <SafeAreaView style={styles.app}>
      <StatusBar style="light" />
      <View style={styles.topbar}>
        <View>
          <Text style={styles.topKicker}>AKÈY VANDÈ</Text>
          <Text style={styles.topTitle}>{String(session.username || "Ajan").toUpperCase()}</Text>
        </View>
        <Pressable onPress={onMenu} style={styles.menuIcon}>
          <Text style={styles.menuGlyph}>☰</Text>
        </Pressable>
      </View>

      <ScrollView contentContainerStyle={styles.content}>
        <View style={[styles.panel, styles.welcome]}>
          <Text style={styles.eyebrow}>JODI A · {today()}</Text>
          <Text style={styles.welcomeTitle}>Pare pou pran fich?</Text>
        </View>

        <View style={styles.two}>
          <Button label={draw || "Chwazi tiraj"} tone="secondary" onPress={() => setDrawsOpen((open) => !open)} style={styles.halfButton} />
          <Button label={game || "Chwazi bòlèt"} tone="secondary" onPress={() => setGamesOpen((open) => !open)} style={styles.halfButton} />
        </View>

        {drawsOpen && (
          <View style={styles.panel}>
            <Text style={styles.section}>Chwazi tiraj</Text>
            <View style={styles.chips}>
              {DRAWS.map((item) => {
                const isOpen = isDrawOpen(item);
                return (
                  <Pressable
                    key={item}
                    onPress={() => {
                      setDraw(item);
                      setDrawsOpen(false);
                    }}
                    style={[styles.chip, draw === item && styles.chipActive]}
                  >
                    <Text style={styles.chipText}>{item}{isOpen ? " · ouvè" : " · fèmen"}</Text>
                  </Pressable>
                );
              })}
            </View>
          </View>
        )}

        {gamesOpen && (
          <View style={styles.panel}>
            <Text style={styles.section}>Chwazi bòlèt</Text>
            {GAME_TYPES.map((item) => (
              <Pressable
                key={item.id}
                onPress={() => {
                  setGame(item.label);
                  setGamesOpen(false);
                }}
                style={[styles.choice, game === item.label && styles.choiceActive]}
              >
                <Text style={styles.choiceText}>{item.label}</Text>
              </Pressable>
            ))}
          </View>
        )}

        <View style={styles.panel}>
          <Text style={styles.section}>Nouvo boul</Text>
          <View style={styles.toggleRow}>
            <Text style={styles.muted}>Revè</Text>
            <Switch value={reverseMode} onValueChange={setReverseMode} />
            <Text style={styles.muted}>Pri rete</Text>
            <Switch value={keepPrice} onValueChange={setKeepPrice} />
          </View>

          {isOptionGame && (
            <View style={styles.optionToggleRow}>
              <Text style={styles.muted}>Opsyon:</Text>
              {optionLabels.map((label, index) => {
                const id = index + 1;
                const active = selectedOptions.includes(id);
                return (
                  <Pressable
                    key={label}
                    onPress={() =>
                      setSelectedOptions((current) =>
                        active ? current.filter((value) => value !== id) : [...current, id]
                      )
                    }
                    style={[styles.optionToggle, active && styles.optionToggleActive]}
                  >
                    <Text style={[styles.optionToggleText, active && styles.buttonAltText]}>{label}</Text>
                  </Pressable>
                );
              })}
              <Pressable
                onPress={() => setSelectedOptions(selectedOptions.length === 3 ? [] : [1, 2, 3])}
                style={[styles.optionToggle, selectedOptions.length === 3 && styles.optionToggleActive]}
              >
                <Text style={[styles.optionToggleText, selectedOptions.length === 3 && styles.buttonAltText]}>Tout</Text>
              </Pressable>
            </View>
          )}

          <View style={styles.entryRow}>
            <TextInput
              value={option}
              onChangeText={setOption}
              placeholder="Boul"
              placeholderTextColor="#8993a5"
              keyboardType="numeric"
              returnKeyType="next"
              onSubmitEditing={() => priceInputRef.current?.focus()}
              style={[styles.input, styles.numberInput]}
            />
            <TextInput
              ref={priceInputRef}
              value={price}
              onChangeText={setPrice}
              placeholder="Pri"
              placeholderTextColor="#8993a5"
              keyboardType="numeric"
              returnKeyType="done"
              onSubmitEditing={addEntries}
              style={[styles.input, styles.priceInput]}
            />
          </View>

          <Button label={adding ? "Ap ajoute..." : "Ajoute sou fich"} onPress={addEntries} disabled={adding} style={styles.addButton} />
          {game === "Boul" && (
            <Button label="10 boul pe (11,22,33,44,55,66,77,88,99,00)" tone="secondary" onPress={addAllBoulNumbers} style={styles.addButton} />
          )}
          {game === "Loto 3 chif" && (
            <Button label="Grap boul pe (111,222,333,444,555,666,777,888,999,000)" tone="secondary" onPress={addLoto3GrapNumbers} style={styles.addButton} />
          )}
        </View>

        {sales.length > 0 && (
          <View style={styles.panel}>
            <View style={styles.rowBetween}>
              <Text style={styles.section}>Fich la</Text>
              <Text style={styles.total}>{money(total)}</Text>
            </View>

            {sales.map((item) => (
              <View key={item.id} style={styles.rowBetween}>
                <Text style={styles.item}>
                  {item.type}: {item.option}
                  {isOptionGame ? ` · Opsyon ${item.optionId}` : ""}
                </Text>
                <View style={styles.rowBetween}>
                  <Text style={styles.amount}>{money(item.price)}</Text>
                  <Pressable onPress={() => setSales((current) => current.filter((sale) => sale.id !== item.id))}>
                    <Text style={styles.trash}>×</Text>
                  </Pressable>
                </View>
              </View>
            ))}

            <Button label="Enprime fich la" onPress={onPrint} />
          </View>
        )}
      </ScrollView>
    </SafeAreaView>
  );
}

function Menu({ visible, onClose, onSelect, onLogout }) {
  const items = [
    ["today", "Kontwòl jounen"],
    ["history", "Istorik tikè"],
    ["delete", "Efase fich"],
    ["reprint", "Refè fich"],
    ["pay", "Peye fich"],
    ["date", "Kontwòl pa dat"],
    ["draws", "Tiraj yo"],
    ["printer", "Bloutouf / Printer"],
    ["help", "Èd"],
  ];

  return (
    <Modal visible={visible} animationType="slide" transparent onRequestClose={onClose}>
      <View style={styles.menuOverlay}>
        <View style={styles.menu}>
          <Text style={styles.menuTitle}>Meni vandè</Text>
          <Button label="Retounen nan akèy" tone="secondary" onPress={onClose} />
          {items.map(([key, label]) => (
            <Button key={key} label={label} tone="ghost" onPress={() => onSelect(key)} />
          ))}
          <Button label="Dekonekte" tone="danger" onPress={onLogout} />
        </View>
      </View>
    </Modal>
  );
}

function Report({ visible, onClose, tickets, transactions, title, range = false, session, onPrintReport }) {
  const [startDate, setStartDate] = useState(today());
  const [endDate, setEndDate] = useState(today());

  const filteredTickets = tickets.filter((item) => {
    const date = String(item.createdAt || "").slice(0, 10);
    return !range || (date >= startDate && date <= endDate);
  });

  const groupedTickets = Object.values(
    filteredTickets.reduce((acc, item) => {
      const ticketKey = item.ticketNumber || item.ticketId || item.id;
      if (!acc[ticketKey]) {
        acc[ticketKey] = {
          id: ticketKey,
          ticketNumber: item.ticketNumber || item.ticketId || item.id,
          draw: item.draw,
          createdAt: item.createdAt,
          entries: [],
          total: 0,
        };
      }

      acc[ticketKey].entries.push(item);
      acc[ticketKey].total += Number(item.price || 0);
      acc[ticketKey].draw = item.draw || acc[ticketKey].draw;
      acc[ticketKey].createdAt = item.createdAt || acc[ticketKey].createdAt;
      return acc;
    }, {})
  );

  const sales = groupedTickets.reduce((sum, item) => sum + Number(item.total || 0), 0) || transactions.reduce((sum, item) => sum + Number(item.montanVanti || 0), 0);
  const paid = filteredTickets.filter((item) => item.paid).reduce((sum, item) => sum + Number(item.payout || 0), 0);
  const commission = (sales * Number(session?.commission || 0)) / 100;

  return (
    <ScreenModal visible={visible} title={title} onClose={onClose}>
      {range ? (
        <View style={styles.dateRow}>
          <Field label="Depi" value={startDate} onChangeText={setStartDate} placeholder="2026-09-01" />
          <Field label="Jiska" value={endDate} onChangeText={setEndDate} placeholder="2026-09-30" />
        </View>
      ) : (
        <Text style={styles.dateHeading}>{today()}</Text>
      )}

      <View style={styles.panel}>
        <Text style={styles.reportLine}>Vant <Text style={styles.reportValue}>{money(sales)}</Text></Text>
        <Text style={styles.reportLine}>Komisyon ({Number(session?.commission || 0)}%) <Text style={styles.reportValue}>{money(commission)}</Text></Text>
        <Text style={styles.reportLine}>Peye <Text style={styles.reportValue}>{money(paid)}</Text></Text>
        <Text style={styles.reportLine}>Benefis <Text style={styles.reportValue}>{money(sales - paid - commission)}</Text></Text>
      </View>

      <Button
        label="Enprime rapò"
        tone="secondary"
        onPress={() =>
          onPrintReport({
            startDate,
            endDate,
            salesTotal: sales,
            commission,
            paid,
            profit: sales - paid - commission,
          })
        }
      />

      <Text style={styles.section}>Fich yo ({groupedTickets.length})</Text>
      {groupedTickets.map((item) => (
        <View key={item.id} style={styles.panel}>
          <View style={styles.rowBetween}>
            <Text style={styles.item}>Tikè {item.ticketNumber}</Text>
            <Text style={styles.amount}>{money(item.total)}</Text>
          </View>
          <Text style={styles.muted}>Tiraj: {item.draw} · {String(item.createdAt || "").slice(0, 10)}</Text>
          <Text style={styles.muted}>Scan code: {item.ticketNumber}</Text>
          <Text style={styles.muted}>Boul total: {item.entries.length}</Text>
          {item.entries.map((entry, idx) => (
            <Text key={`${item.id}-${idx}`} style={styles.muted}>
              • {entry.option} · {money(entry.price)} · {entry.type}
              {entry.optionId ? ` · Opsyon ${entry.optionId}` : ""}
            </Text>
          ))}
        </View>
      ))}
    </ScreenModal>
  );
}

function TicketAction({ type, tickets, onClose, onScan, onPrint, onPay }) {
  const [query, setQuery] = useState("");

  const groupedTickets = useMemo(() => {
    const map = new Map();

    tickets.forEach((item) => {
      const ticketKey = item.ticketNumber || item.ticketId || item.id;
      if (!map.has(ticketKey)) {
        map.set(ticketKey, {
          id: ticketKey,
          ticketNumber: item.ticketNumber || item.ticketId || item.id,
          ticketId: item.ticketId || item.id,
          draw: item.draw,
          createdAt: item.createdAt,
          entries: [],
          total: 0,
        });
      }

      const group = map.get(ticketKey);
      group.entries.push(item);
      group.total += Number(item.price || 0);
      group.draw = item.draw || group.draw;
      group.createdAt = item.createdAt || group.createdAt;
    });

    return Array.from(map.values());
  }, [tickets]);

  const ticket = groupedTickets.find(
    (item) => item.ticketNumber === query || item.ticketId === query || item.id === query
  );

  const age = ticket?.entries?.[0]
    ? Math.floor((Date.now() - new Date(ticket.entries[0].createdAt || 0).getTime()) / 60000)
    : 999;

  const canDelete =
    type === "delete" &&
    ticket &&
    String(ticket.entries[0]?.createdAt || "").slice(0, 10) === today() &&
    age < 10 &&
    isDrawOpen(ticket.draw);

  return (
    <ScreenModal visible title={type === "pay" ? "Peye fich" : type === "delete" ? "Efase fich" : "Refè fich"} onClose={onClose}>
      <Field label="Nimewo tikè" value={query} onChangeText={setQuery} placeholder="12345678" />
      <Button label="Chèche" onPress={() => { if (!ticket) Alert.alert("Tikè", "Tikè sa a pa jwenn."); }} />
      <Button label="Scan" tone="secondary" onPress={onScan} />

      {ticket && (
        <View style={styles.panel}>
          <Text style={styles.item}>Tikè {ticket.ticketNumber || ticket.ticketId}</Text>
          <Text style={styles.muted}>Tiraj: {ticket.draw} · {money(ticket.total)}</Text>
          <Text style={styles.muted}>Scan code: {ticket.ticketNumber || ticket.ticketId}</Text>

          {ticket.entries.map((entry, idx) => (
            <Text key={`${ticket.id}-${idx}`} style={styles.muted}>
              • {entry.option} · {money(entry.price)} · {entry.type}
              {entry.optionId ? ` · Opsyon ${entry.optionId}` : ""}
            </Text>
          ))}

          {type !== "delete" && (
            <Button label={type === "pay" ? "Enprime rapò peman" : "Enprime fich"} onPress={() => (type === "pay" ? onPay(ticket) : onPrint(ticket))} />
          )}

          {type === "delete" && (
            <Text style={styles.muted}>Fich la gen {age} minit. Li dwe gen mwens pase 10 minit epi tiraj la dwe ouvè.</Text>
          )}

          {canDelete && (
            <Button
              label="Efase fich"
              tone="danger"
              onPress={async () => {
                await Promise.all(
                  ticket.entries.map((entry) => deleteTicketBundle(entry))
                );
                Alert.alert("Fich", "Fich la efase.");
                onClose();
              }}
            />
          )}
        </View>
      )}
    </ScreenModal>
  );
}

function DrawList({ onClose, results }) {
  const [search, setSearch] = useState("");

  const rows = results.filter((item) =>
    String(item.tiraj || "").toLowerCase().includes(search.toLowerCase())
  );

  return (
    <ScreenModal visible title="Tiraj yo" onClose={onClose}>
      <Field label="Rechèch tiraj" value={search} onChangeText={setSearch} placeholder="Florida..." />
      {rows.map((item) => (
        <View key={item.id} style={styles.panel}>
          <Text style={styles.item}>{item.tiraj}</Text>
          <Text style={styles.muted}>{item.dateGanye || item.createdAt || ""}</Text>
          <Text style={styles.result}>
            {item.firstLot3 || "-"} · {item.firstLot2 || "-"} · {item.secondLot2 || "-"} · {item.thirdLot2 || "-"}
          </Text>
        </View>
      ))}
    </ScreenModal>
  );
}

function Help({ onClose }) {
  return (
    <ScreenModal visible title="Èd" onClose={onClose}>
      <Text style={styles.help}>
        1. Chwazi tiraj la.{'\n\n'}2. Chwazi tip jwèt la, tape boul la ak pri a, epi peze Antre.{'\n\n'}3. Revize fich la, retire nenpòt liy ak bouton efase a, epi peze Enprime fich.{'\n\n'}4. Itilize Istorik tikè pou refè, peye oswa scan yon fich.{'\n\n'}5. Si printer la pa mache, louvri Bloutouf / Printer epi verifye sèvis enprime POS la.{'\n\n'}6. Rapò jodi a ak kontwòl pa dat montre vant, peman ak benefis.
      </Text>
    </ScreenModal>
  );
}

function Scan({ onFound, onClose }) {
  const [permission, requestPermission] = useCameraPermissions();

  if (!permission?.granted) {
    return (
      <ScreenModal visible title="Scan fich" onClose={onClose}>
        <Text style={styles.muted}>Kamera a bezwen pèmisyon pou scan kòd fich la.</Text>
        <Button label="Pèmèt kamera" onPress={requestPermission} />
      </ScreenModal>
    );
  }

  return (
    <Modal visible animationType="slide" onRequestClose={onClose}>
      <SafeAreaView style={styles.cameraWrap}>
        <Button label="‹ Retounen" tone="ghost" onPress={onClose} />
        <CameraView
          style={styles.camera}
          barcodeScannerSettings={{ barcodeTypes: ["qr", "code128", "code39"] }}
          onBarcodeScanned={({ data }) => onFound(data)}
        />
      </SafeAreaView>
    </Modal>
  );
}

function ScreenModal({ visible, title, onClose, children }) {
  return (
    <Modal visible={visible} animationType="slide" onRequestClose={onClose}>
      <SafeAreaView style={styles.modal}>
        <View style={styles.modalHeader}>
          <Button label="‹ Retounen" tone="ghost" compact onPress={onClose} />
          <Text style={styles.modalTitle}>{title}</Text>
          <View style={{ width: 84 }} />
        </View>
        <ScrollView contentContainerStyle={styles.content}>{children}</ScrollView>
      </SafeAreaView>
    </Modal>
  );
}

function Field({ label, value, onChangeText, secureTextEntry = false, placeholder = "", onSubmitEditing, returnKeyType }) {
  return (
    <View style={styles.field}>
      <Text style={styles.label}>{label}</Text>
      <TextInput
        value={value}
        onChangeText={onChangeText}
        placeholder={placeholder}
        placeholderTextColor="#8993a5"
        secureTextEntry={secureTextEntry}
        onSubmitEditing={onSubmitEditing}
        returnKeyType={returnKeyType}
        style={styles.input}
      />
    </View>
  );
}

function Button({ label, onPress, tone = "primary", disabled = false, compact = false, style }) {
  const lightBackground = tone === "secondary" || tone === "ghost";

  return (
    <Pressable
      disabled={disabled}
      onPress={onPress}
      style={({ pressed }) => [
        styles.button,
        styles[`button_${tone}`],
        compact && styles.buttonCompact,
        style,
        disabled && styles.disabled,
        pressed && styles.pressed,
      ]}
    >
      <Text style={lightBackground ? styles.buttonAltText : styles.buttonText}>{label}</Text>
    </Pressable>
  );
}

const styles = StyleSheet.create({
  loading: { flex: 1, alignItems: "center", justifyContent: "center", backgroundColor: "#f5f7fb" },
  login: { flex: 1, backgroundColor: "#f5f7fb", padding: 24, justifyContent: "center" },
  brand: { width: 62, height: 62, borderRadius: 18, backgroundColor: "#1d4f8f", alignItems: "center", justifyContent: "center", marginBottom: 20 },
  brandLetter: { color: "#fff", fontSize: 32, fontWeight: "800" },
  eyebrow: { color: "#1d4f8f", fontSize: 12, fontWeight: "800", letterSpacing: 1.2 },
  hero: { color: "#172033", fontSize: 38, fontWeight: "800", marginTop: 8 },
  subtitle: { color: "#647084", fontSize: 16, marginVertical: 12 },
  app: { flex: 1, backgroundColor: "#f5f7fb" },
  topbar: { backgroundColor: "#0f2348", padding: 20, paddingTop: 32, flexDirection: "row", justifyContent: "space-between", alignItems: "center" },
  topKicker: { color: "#bfd4ff", fontSize: 11, fontWeight: "800" },
  topTitle: { color: "#fff", fontSize: 20, fontWeight: "800", marginTop: 4 },
  menuIcon: { width: 46, height: 46, borderRadius: 23, backgroundColor: "#1d4f8f", alignItems: "center", justifyContent: "center" },
  menuGlyph: { color: "#fff", fontSize: 23 },
  content: { padding: 18, paddingBottom: 40 },
  panel: { backgroundColor: "#fff", borderRadius: 16, padding: 16, marginBottom: 14, borderWidth: 1, borderColor: "#dfe6f1", shadowColor: "#1d4f8f", shadowOpacity: 0.08, shadowRadius: 8, shadowOffset: { width: 0, height: 3 }, elevation: 2 },
  welcome: { borderLeftWidth: 4, borderLeftColor: "#1d4f8f" },
  welcomeTitle: { color: "#172033", fontSize: 24, fontWeight: "800", marginVertical: 8 },
  two: { flexDirection: "row", gap: 10, marginBottom: 14 },
  halfButton: { flex: 1 },
  addButton: { width: "100%", marginTop: 14, minHeight: 52 },
  button: { minHeight: 46, paddingHorizontal: 16, borderRadius: 8, alignItems: "center", justifyContent: "center", marginTop: 10 },
  buttonCompact: { minHeight: 38, paddingHorizontal: 12, marginTop: 0 },
  button_primary: { backgroundColor: "#0f2348" },
  button_secondary: { backgroundColor: "#edf5ff", borderWidth: 1, borderColor: "#1d4f8f" },
  button_ghost: { backgroundColor: "#ffffff", borderWidth: 1, borderColor: "#d8e3f6" },
  button_danger: { backgroundColor: "#b83d46" },
  buttonText: { color: "#fff", fontWeight: "800" },
  buttonAltText: { color: "#1d4f8f", fontWeight: "800" },
  disabled: { opacity: 0.45 },
  pressed: { opacity: 0.75 },
  field: { marginBottom: 14 },
  label: { color: "#546173", fontWeight: "700", marginBottom: 6 },
  input: { minHeight: 46, borderWidth: 1, borderColor: "#c8d5eb", borderRadius: 10, paddingHorizontal: 12, color: "#172033", backgroundColor: "#f9fbff" },
  section: { color: "#172033", fontSize: 17, fontWeight: "800", marginBottom: 10 },
  muted: { color: "#697588", marginTop: 4 },
  entryRow: { flexDirection: "row", alignItems: "center", gap: 8 },
  numberInput: { flex: 1 },
  priceInput: { width: 92 },
  chips: { flexDirection: "row", flexWrap: "wrap", gap: 8 },
  chip: { borderWidth: 1, borderColor: "#c9d7eb", padding: 10, borderRadius: 9, marginBottom: 8 },
  chipActive: { backgroundColor: "#dfeeff", borderColor: "#1d4f8f" },
  chipText: { color: "#1d4f8f", fontWeight: "700" },
  choice: { padding: 13, borderBottomWidth: 1, borderBottomColor: "#edf0f2" },
  choiceActive: { backgroundColor: "#eaf2ff" },
  choiceText: { color: "#1d4f8f", fontWeight: "700" },
  rowBetween: { flexDirection: "row", alignItems: "center", justifyContent: "space-between" },
  total: { color: "#1d4f8f", fontSize: 18, fontWeight: "800" },
  item: { color: "#172033", fontWeight: "800", fontSize: 16 },
  trash: { color: "#b83d46", fontSize: 22 },
  amount: { color: "#1d4f8f", fontWeight: "800" },
  menuOverlay: { flex: 1, backgroundColor: "rgba(0,0,0,.45)", justifyContent: "flex-end" },
  menu: { backgroundColor: "#ffffff", padding: 20, borderTopLeftRadius: 18, borderTopRightRadius: 18 },
  modalOverlay: { flex: 1, backgroundColor: "rgba(0,0,0,.45)", justifyContent: "center", padding: 24 },
  modalInner: { backgroundColor: "#fff", borderRadius: 12, padding: 20 },
  modal: { flex: 1, backgroundColor: "#f5f7fb" },
  modalHeader: { minHeight: 68, padding: 12, flexDirection: "row", alignItems: "center", justifyContent: "space-between", backgroundColor: "#172033" },
  modalTitle: { color: "#fff", fontSize: 19, fontWeight: "800" },
  dateHeading: { color: "#1f6b5b", fontWeight: "800", marginBottom: 14 },
  dateRow: { marginBottom: 12 },
  reportLine: { color: "#172033", fontSize: 18, paddingVertical: 8 },
  reportValue: { color: "#1f6b5b", fontWeight: "800" },
  result: { color: "#d39217", fontSize: 20, fontWeight: "800", marginTop: 8 },
  help: { color: "#172033", fontSize: 16, lineHeight: 25 },
  cameraWrap: { flex: 1, backgroundColor: "#172033", padding: 16 },
  camera: { flex: 1, marginTop: 14, borderRadius: 14, overflow: "hidden" },
  menuTitle: { color: "#172033", fontSize: 19, fontWeight: "800", marginBottom: 10 },
  toggleRow: { flexDirection: "row", alignItems: "center", gap: 8, marginBottom: 10 },
  optionToggleRow: { flexDirection: "row", alignItems: "center", flexWrap: "wrap", gap: 6, marginBottom: 10 },
  optionToggle: { borderWidth: 1, borderColor: "#d4dfe0", borderRadius: 8, paddingHorizontal: 8, paddingVertical: 6 },
  optionToggleActive: { backgroundColor: "#1d4f8f", borderColor: "#1d4f8f" },
  optionToggleText: { color: "#172033", fontSize: 12, fontWeight: "700" },
});

export default App;
