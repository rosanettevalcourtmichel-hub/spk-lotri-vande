import { initializeApp } from "firebase/app";
import {
  getFirestore,
  collection,
  addDoc,
  getDocs,
  updateDoc,
  doc,
  deleteDoc,
  query,
  where,
  serverTimestamp,
} from "firebase/firestore";

const firebaseConfig = {
  apiKey: "AIzaSyDMtp193g_XAOOflrh4YBJyTWT6AtX-IEs",
  authDomain: "spk-lotri.firebaseapp.com",
  projectId: "spk-lotri",
  storageBucket: "spk-lotri.firebasestorage.app",
  messagingSenderId: "506106084726",
  appId: "1:506106084726:android:018a03344c811b3fc50e57",
};

const app = initializeApp(firebaseConfig);
const db = getFirestore(app);

export const login = async (username, pin) => {
  try {
    const fieldSets = [
      { usernameField: "username", pinField: "pin" },
      { usernameField: "agentName", pinField: "agentCode" },
      { usernameField: "name", pinField: "code" },
      { usernameField: "nom", pinField: "kode" },
    ];

    for (const { usernameField, pinField } of fieldSets) {
      const q = query(
        collection(db, "agents"),
        where(usernameField, "==", username),
        where(pinField, "==", pin)
      );

      const snapshot = await getDocs(q);

      if (!snapshot.empty) {
        const user = snapshot.docs[0].data();
        return {
          ok: true,
          user: {
            uid: snapshot.docs[0].id,
            ...user,
          },
        };
      }
    }

    return { ok: false, message: "Non ajan oswa kòd ajan pa kòrèk." };
  } catch (error) {
    return { ok: false, message: "Login pa t ka fèt. Verifye koneksyon an." };
  }
};

export const logout = async () => Promise.resolve();

export const getTickets = async (uid) => {
  const q = query(collection(db, "tickets"), where("agentUid", "==", uid));
  const snapshot = await getDocs(q);
  return snapshot.docs.map((docSnap) => ({ id: docSnap.id, ...docSnap.data() }));
};

export const saveTicket = async (ticket) => {
  await addDoc(collection(db, "tickets"), {
    ...ticket,
    createdAt: ticket.createdAt || new Date().toISOString(),
    updatedAt: serverTimestamp(),
  });
};

export const updateTicket = async (ticketId, updates) => {
  const ref = doc(db, "tickets", ticketId);
  await updateDoc(ref, updates);
};

export const deleteTicketBundle = async (ticket) => {
  if (ticket?.id) {
    await deleteDoc(doc(db, "tickets", ticket.id));
  }
};

export const getTransactions = async (uid) => {
  const q = query(collection(db, "transactions"), where("agentUid", "==", uid));
  const snapshot = await getDocs(q);
  return snapshot.docs.map((docSnap) => ({ id: docSnap.id, ...docSnap.data() }));
};

export const saveTransaction = async (tx) => {
  await addDoc(collection(db, "transactions"), {
    ...tx,
    createdAt: tx.createdAt || new Date().toISOString(),
  });
};

export const getResults = async () => {
  const snapshot = await getDocs(collection(db, "results"));
  return snapshot.docs.map((docSnap) => ({ id: docSnap.id, ...docSnap.data() }));
};

export const getLimits = async () => {
  const snapshot = await getDocs(collection(db, "limits"));
  const data = {};
  snapshot.forEach((docSnap) => {
    data[docSnap.id] = docSnap.data();
  });
  return data;
};

export const getLimitUsage = async ({ game, option, draw, agentUid, date }) => {
  const q = query(collection(db, "usage"), where("game", "==", game), where("option", "==", option));
  const snapshot = await getDocs(q);
  let used = 0;
  snapshot.forEach((docSnap) => {
    const item = docSnap.data();
    const ok = (!draw || item.draw === draw) && (!agentUid || item.agentUid === agentUid) && (!date || item.date === date);
    if (ok) used += Number(item.amount || 0);
  });
  return used;
};

export const getBlockedNumbers = async () => {
  const snapshot = await getDocs(collection(db, "blockedNumbers"));
  const data = {};
  snapshot.forEach((docSnap) => {
    data[docSnap.id] = docSnap.data();
  });
  return data;
};

export const getAgentStatus = async (uid) => {
  const ref = doc(db, "agents", uid);
  const snapshot = await getDocs(collection(db, "agents"));
  const user = snapshot.docs.find((item) => item.id === uid);
  return user ? user.data() : null;
};

export const updateAgentPresence = async (uid) => {
  const ref = doc(db, "agents", uid);
  await updateDoc(ref, {
    lastSeen: new Date().toISOString(),
  });
};

export const initializeFirebase = () => app;
