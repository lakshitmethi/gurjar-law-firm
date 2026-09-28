// Cloud Firestore Service for Gurjar Law Firm & Associates
import { 
  collection, 
  doc, 
  getDoc, 
  getDocs, 
  setDoc, 
  addDoc, 
  updateDoc, 
  deleteDoc, 
  query, 
  where, 
  orderBy, 
  onSnapshot, 
  serverTimestamp,
  writeBatch 
} from "https://www.gstatic.com/firebasejs/10.13.2/firebase-firestore.js";
import { db, auth } from "./firebase-config.js";

// ==========================================
// DEFAULT APPLICATION DATA
// ==========================================
export const BASE_CASE_FIELDS = [
  ["sno", "S.No."],
  ["caseNo", "Case No."],
  ["clientName", "Client Name"],
  ["ncvNo", "NCV No."],
  ["courtName", "Court Name"],
  ["city", "City Of Court"],
  ["title", "Case Title"],
  ["stage", "Stage"],
  ["previousDate", "Previous Date"],
  ["nextDate", "Next Date"],
  ["particular", "Particular"],
  ["powerFile", "Power File (Petitioner/Respondent)"],
  ["powerFileDate", "Power File Date"],
  ["registrationDate", "Date of Registration of Case to Advocate"],
  ["referenceName", "Reference Name"],
  ["referenceMobile", "Reference Mobile No."],
  ["clientAddress", "Client Address"],
  ["clientMobile", "Client Mobile No.1"],
  ["alternateMobile", "Alternate Contact No."],
  ["result", "Case Result"],
  ["totalFees", "Total Fees"],
  ["received", "Received"],
  ["due", "Due"],
  ["paymentStatus", "Payment Status"]
];

export const DEFAULT_ASSOCIATE_FIELDS = [
  "sno", "caseNo", "clientName", "ncvNo", "courtName", "city", "title",
  "stage", "previousDate", "nextDate", "particular", "powerFile",
  "clientMobile", "alternateMobile", "result"
];

export const DEFAULT_CLIENT_FIELDS = [
  "caseNo", "clientName", "courtName", "city", "title", "stage",
  "previousDate", "nextDate", "particular", "result", "totalFees",
  "received", "due", "paymentStatus"
];

export function defaultTableSettings() {
  return BASE_CASE_FIELDS.map(([key, label], order) => ({
    key,
    label,
    order,
    custom: false,
    roles: [
      "superadmin",
      "admin",
      ...(DEFAULT_ASSOCIATE_FIELDS.includes(key) ? ["associate"] : []),
      ...(DEFAULT_CLIENT_FIELDS.includes(key) ? ["client"] : [])
    ]
  }));
}

export const DEFAULT_TILE_SETTINGS = {
  total: { label: "Total Cases", roles: ["superadmin", "admin", "associate", "client"] },
  active: { label: "Active Cases", roles: ["superadmin", "admin", "associate", "client"] },
  disposed: { label: "Disposed Cases", roles: ["superadmin", "admin", "associate", "client"] },
  tomorrow: { label: "Tomorrow's Cases", roles: ["superadmin", "admin", "associate", "client"] },
  upcoming: { label: "Upcoming Dates", roles: ["superadmin", "admin", "associate", "client"] },
  summary: { label: "Fees Due / Case Results", roles: ["superadmin", "admin", "associate", "client"] },
  caseTiles: { label: "Case Tiles", roles: ["superadmin", "admin", "associate", "client"] }
};

export const DEFAULT_ABOUT = {
  intro: "Our firm deals with these types of matters:",
  items: [
    "Criminal Suits",
    "Civil Suits",
    "Revenue Suits",
    "Family Suits",
    "Matrimonial Suits",
    "Registry Suits",
    "Bank & all departmental disputes"
  ],
  courts: "From Trial Court to Supreme Court",
  tagline: "Legal Clarity For A Better Tomorrow"
};

export const DEFAULT_FIRMS = {
  group: "",
  items: []
};

// ==========================================
// REAL-TIME CASE SUBSCRIPTION & CRUD
// ==========================================

export function subscribeCases(currentUser, callback, onError) {
  if (!currentUser || currentUser.role === "guest") {
    callback([]);
    return () => {};
  }

  const casesCol = collection(db, "cases");
  let q;

  if (currentUser.role === "superadmin" || currentUser.role === "admin") {
    // Super Admin and Admin see all cases
    q = query(casesCol, orderBy("sno", "asc"));
  } else if (currentUser.role === "associate") {
    // Associate sees cases marked visibleTo: associate
    q = query(casesCol, where("visibleTo", "array-contains", "associate"));
  } else if (currentUser.role === "client") {
    // Prefer the exact Firebase Auth UID. For legacy records whose UID array
    // was saved incorrectly, fall back to the case numbers explicitly assigned
    // to this authenticated user's own profile.
    const authUid = String(auth.currentUser?.uid || "").trim();
    if (!authUid) {
      callback([]);
      if (onError) onError(new Error("Authenticated client UID is unavailable."));
      return () => {};
    }

    const assignedCaseNos = Array.isArray(currentUser.caseNos)
      ? [...new Set(currentUser.caseNos.map(v => String(v || "").trim()).filter(Boolean))].slice(0, 30)
      : [];

    if (assignedCaseNos.length) {
      q = query(casesCol, where("caseNo", "in", assignedCaseNos));
    } else {
      q = query(casesCol, where("assignedClientUids", "array-contains", authUid));
    }
  }

  return onSnapshot(q, (snapshot) => {
    let cases = [];
    snapshot.forEach((docSnap) => {
      const data = docSnap.data();
      cases.push({ id: docSnap.id, ...data });
    });

    // Client assignment is the single source of truth. The Firestore query
    // already limits results to documents containing this exact client's UID.
    if (currentUser.role === "client") {
      const authUid = String(auth.currentUser?.uid || "").trim();
      const assignedCaseNos = Array.isArray(currentUser.caseNos)
        ? currentUser.caseNos.map(v => String(v || "").trim()).filter(Boolean)
        : [];
      cases = cases.filter(c =>
        (Array.isArray(c.assignedClientUids) && c.assignedClientUids.includes(authUid)) ||
        assignedCaseNos.includes(String(c.caseNo || "").trim())
      );
    }

    // Sort numerically by S.No
    cases.sort((a, b) => (Number(a.sno) || 0) - (Number(b.sno) || 0));
    callback(cases);
  }, (err) => {
    console.error("Error subscribing to cases:", err);
    if (onError) onError(err);
  });
}

export async function addCase(caseData, currentUserId) {
  const casesCol = collection(db, "cases");
  const payload = {
    ...caseData,
    createdBy: currentUserId || "admin",
    createdAt: serverTimestamp(),
    updatedAt: serverTimestamp()
  };
  const docRef = await addDoc(casesCol, payload);
  return docRef.id;
}

export async function updateCase(caseId, caseData) {
  const caseRef = doc(db, "cases", caseId);
  const payload = {
    ...caseData,
    updatedAt: serverTimestamp()
  };
  await updateDoc(caseRef, payload);
}

export async function deleteCase(caseId) {
  const caseRef = doc(db, "cases", caseId);
  await deleteDoc(caseRef);
}

export async function resequenceCasesInFirestore(casesList) {
  const batch = writeBatch(db);
  casesList.forEach((c, index) => {
    if (c.id) {
      const caseRef = doc(db, "cases", c.id);
      batch.update(caseRef, { sno: String(index + 1) });
    }
  });
  await batch.commit();
}

// ==========================================
// USERS MANAGEMENT
// ==========================================

export function subscribeUsers(callback, onError) {
  const usersCol = collection(db, "users");
  const q = query(usersCol, orderBy("createdAt", "desc"));

  return onSnapshot(q, (snapshot) => {
    const users = [];
    snapshot.forEach((docSnap) => {
      const data = docSnap.data();
      // A canonical users document is keyed by the Firebase Authentication UID.
      // Prefer the document ID. A stale uid field inside an old profile must
      // never be used for case assignment.
      users.push({ ...data, uid: docSnap.id, storedUid: data.uid || "", firestoreDocId: docSnap.id });
    });
    callback(users);
  }, (err) => {
    console.error("Error subscribing to users:", err);
    if (onError) onError(err);
  });
}

// Repair legacy user profiles whose Firestore document ID is not their Firebase Auth UID.
// Run only from the Super Admin session. Client security rules require users/{auth.uid}.
export async function repairLegacyUserProfiles(users = []) {
  const legacy = users.filter(u =>
    u?.storedUid && u?.firestoreDocId && u.firestoreDocId !== u.storedUid &&
    ["admin", "associate", "client"].includes(String(u.role || "").toLowerCase())
  );
  if (!legacy.length) return 0;

  const batch = writeBatch(db);
  for (const u of legacy) {
    const { firestoreDocId, storedUid, ...profile } = u;
    // Do not migrate based on a stale embedded UID. Keep the document ID as
    // the canonical identity and repair only the embedded uid field.
    const canonicalRef = doc(db, "users", firestoreDocId);
    batch.set(canonicalRef, { ...profile, uid: firestoreDocId, updatedAt: serverTimestamp() }, { merge: true });
  }
  await batch.commit();
  return legacy.length;
}

export async function updateUserProfile(uid, data) {
  const userRef = doc(db, "users", uid);
  await updateDoc(userRef, {
    ...data,
    updatedAt: serverTimestamp()
  });
}

export async function toggleUserActive(uid, currentActiveState) {
  const userRef = doc(db, "users", uid);
  await updateDoc(userRef, {
    active: !currentActiveState,
    updatedAt: serverTimestamp()
  });
}

export async function toggleUserLock(uid, currentLockedState, reason = "") {
  const userRef = doc(db, "users", uid);
  await updateDoc(userRef, {
    locked: !currentLockedState,
    lockReason: !currentLockedState ? (reason || "Restricted by Admin") : "",
    updatedAt: serverTimestamp()
  });
}

export async function deleteUserProfile(uid) {
  const userRef = doc(db, "users", uid);
  await deleteDoc(userRef);
}

// ==========================================
// LOGINIDS COLLECTION HELPERS
// ==========================================

export async function getLoginIdEntry(normalizedLoginId) {
  try {
    const ref = doc(db, "loginIds", normalizedLoginId);
    const snap = await getDoc(ref);
    return snap.exists() ? snap.data() : null;
  } catch (err) {
    console.warn("getLoginIdEntry error:", err.message);
    return null;
  }
}

export async function setLoginIdEntryFS(normalizedLoginId, uid, email, originalLoginId) {
  const ref = doc(db, "loginIds", normalizedLoginId);
  await setDoc(ref, { uid, email, loginId: originalLoginId || normalizedLoginId });
}

export async function deleteLoginIdEntryFS(normalizedLoginId) {
  if (!normalizedLoginId) return;
  const ref = doc(db, "loginIds", normalizedLoginId);
  await deleteDoc(ref);
}

// ==========================================
// SETTINGS (ABOUT US, FIRMS, TILES, TABLES)
// ==========================================

export function subscribeSettingsDoc(docName, defaultData, callback) {
  const docRef = doc(db, "settings", docName);
  return onSnapshot(docRef, (snap) => {
    if (snap.exists()) {
      callback(snap.data());
    } else {
      callback(defaultData);
    }
  }, (err) => {
    console.warn(`Error reading settings/${docName}, using default:`, err);
    callback(defaultData);
  });
}

export async function saveSettingsDoc(docName, data) {
  const docRef = doc(db, "settings", docName);
  await setDoc(docRef, {
    ...data,
    updatedAt: serverTimestamp()
  }, { merge: true });
}

// ==========================================
// GALLERY METADATA IN FIRESTORE
// ==========================================

export function subscribeGallery(callback, onError) {
  const galleryCol = collection(db, "gallery");
  const q = query(galleryCol, orderBy("order", "asc"));

  return onSnapshot(q, (snapshot) => {
    const items = [];
    snapshot.forEach((docSnap) => {
      items.push({ id: docSnap.id, ...docSnap.data() });
    });
    callback(items);
  }, (err) => {
    console.error("Error subscribing to gallery:", err);
    if (onError) onError(err);
  });
}

export async function addGalleryItem(itemData, currentUserId) {
  const galleryCol = collection(db, "gallery");
  const payload = {
    ...itemData,
    createdBy: currentUserId || "admin",
    createdAt: serverTimestamp()
  };
  const docRef = await addDoc(galleryCol, payload);
  return docRef.id;
}

export async function updateGalleryItem(itemId, itemData) {
  const itemRef = doc(db, "gallery", itemId);
  await updateDoc(itemRef, {
    ...itemData,
    updatedAt: serverTimestamp()
  });
}

export async function deleteGalleryDoc(itemId) {
  const itemRef = doc(db, "gallery", itemId);
  await deleteDoc(itemRef);
}

export async function reorderGalleryItems(itemsList) {
  const batch = writeBatch(db);
  itemsList.forEach((item, index) => {
    if (item.id) {
      const itemRef = doc(db, "gallery", item.id);
      batch.update(itemRef, { order: index });
    }
  });
  await batch.commit();
}

// ==========================================
// FIRST-RUN DATABASE INITIALIZATION / SEEDING
// ==========================================

export async function seedInitialFirestoreData() {
  try {
    // 1. Seed About Us if not exists
    const aboutRef = doc(db, "settings", "about");
    const aboutSnap = await getDoc(aboutRef);
    if (!aboutSnap.exists()) {
      await setDoc(aboutRef, { ...DEFAULT_ABOUT, updatedAt: serverTimestamp() });
    }

    // 2. Seed Other Firms if not exists
    const firmsRef = doc(db, "settings", "firms");
    const firmsSnap = await getDoc(firmsRef);
    if (!firmsSnap.exists()) {
      await setDoc(firmsRef, { ...DEFAULT_FIRMS, updatedAt: serverTimestamp() });
    }

    // 3. Seed Tile Settings if not exists
    const tilesRef = doc(db, "settings", "tileSettings");
    const tilesSnap = await getDoc(tilesRef);
    if (!tilesSnap.exists()) {
      await setDoc(tilesRef, { ...DEFAULT_TILE_SETTINGS, updatedAt: serverTimestamp() });
    }

    // 4. Seed Table Settings if not exists
    const tableRef = doc(db, "settings", "tableSettings");
    const tableSnap = await getDoc(tableRef);
    if (!tableSnap.exists()) {
      await setDoc(tableRef, { list: defaultTableSettings(), updatedAt: serverTimestamp() });
    }

    // Operational collections start empty; never seed cases, users, or gallery.
  } catch (err) {
    console.warn("Notice: Initial seed skipped or already seeded:", err.message);
  }
}
