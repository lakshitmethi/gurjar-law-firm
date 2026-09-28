// Authentication Module for Gurjar Law Firm & Associates
// Unified Login ID / Password authentication with loginIds Firestore lookup
import { 
  signInWithEmailAndPassword, 
  signOut, 
  onAuthStateChanged,
  createUserWithEmailAndPassword,
  sendPasswordResetEmail
} from "https://www.gstatic.com/firebasejs/10.13.2/firebase-auth.js";
import { 
  doc, 
  getDoc,
  collection,
  query,
  where,
  limit,
  getDocs,
  setDoc,
  deleteDoc,
  runTransaction,
  serverTimestamp 
} from "https://www.gstatic.com/firebasejs/10.13.2/firebase-firestore.js";
import { initializeApp } from "https://www.gstatic.com/firebasejs/10.13.2/firebase-app.js";
import { auth, db, firebaseConfig } from "./firebase-config.js";

// ==========================================
// LOGIN ID NORMALIZATION
// ==========================================

// Normalize a Login ID for use as a Firestore document key
// Converts to lowercase, replaces special chars with underscores
export function normalizeLoginId(loginId) {
  return String(loginId || "")
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9@._-]/g, "_");
}

// ==========================================
// ERROR MESSAGES
// ==========================================
export function formatAuthErrorMessage(error) {
  if (!error) return "An unexpected error occurred. Please try again.";
  const code = error.code || "";

  switch (code) {
    case "permission-denied":
    case "auth/permission-denied":
      return "Firestore permission denied while reading your profile.";
    case "unavailable":
    case "auth/service-unavailable":
      return "Firestore database service is currently unavailable. Please verify your Firestore database is created and active in Firebase Console.";
    case "failed-precondition":
    case "auth/invalid-project":
      return "Firebase configuration or project error. Please verify project settings in Firebase Console.";
    case "auth/invalid-profile-data":
      return "Invalid profile data found in database. Please verify user record.";
    case "auth/operation-not-allowed":
      return "Email/Password authentication is not enabled for this Firebase project.";
    case "auth/superadmin-not-configured":
      return "Super Admin profile is not configured.";
    case "auth/not-authorized":
      return "Your account is not authorized.";
    case "auth/inactive":
    case "auth/user-disabled":
      return "Your account has been deactivated.";
    case "auth/locked":
    case "auth/user-locked":
      return error.message || "Your account access is temporarily restricted.";
    case "auth/invalid-credential":
    case "auth/user-not-found":
    case "auth/wrong-password":
    case "auth/invalid-email":
    case "auth/login-id-not-found":
      return "Invalid Login ID or Password.";
    case "auth/too-many-requests":
      return "Too many failed login attempts. Please wait a moment and try again.";
    case "auth/network-request-failed":
      return "Network connection error. Please verify your internet connection and try again.";
    case "auth/internal-error":
      return "Internal authentication error. If you are using Brave or third-party cookie blockers, please allow cookies for this site.";
    default:
      if (typeof error.message === "string") {
        if (error.message.includes("permission-denied") || error.message.includes("Missing or insufficient permissions")) {
          return "Firestore permission denied while reading your profile.";
        }
        if (error.message.includes("operation-not-allowed")) {
          return "Email/Password authentication is not enabled for this Firebase project.";
        }
        if (error.message.includes("Cloud Firestore API has not been used") || error.message.includes("SERVICE_DISABLED")) {
          return "Cloud Firestore database is disabled or not created for this Firebase project.";
        }
        if (error.message.includes("unavailable")) {
          return "Firestore database service is currently unavailable. Please check your internet or Firebase status.";
        }
        if (error.message.includes("auth/invalid-credential") ||
            error.message.includes("auth/user-not-found") ||
            error.message.includes("auth/wrong-password")) {
          return "Invalid Login ID or Password.";
        }
      }
      return error.message || "Authentication failed. Please check your credentials and try again.";
  }
}

// ==========================================
// FIRESTORE USER PROFILE
// ==========================================

// Fetch user profile from Firestore users/{uid} without swallowing errors
export async function getUserProfile(uid) {
  const path = `users/${uid}`;
  const projectId = firebaseConfig?.projectId || "unknown";
  try {
    const userDocRef = doc(db, "users", uid);
    const snap = await getDoc(userDocRef);
    const exists = snap.exists();

    console.log(`[Auth Diagnostic] Firestore read on '${path}' (Project: ${projectId}) - Document exists: ${exists}`);

    if (exists) {
      const data = snap.data();
      if (!data || typeof data !== "object") {
        const err = new Error("Invalid profile data in Firestore.");
        err.code = "auth/invalid-profile-data";
        throw err;
      }
      return { ...data, uid };
    }

    return null;
  } catch (error) {
    console.error(`[Auth Diagnostic] Firestore error reading '${path}' (Project: ${projectId}):`, {
      code: error.code || "unknown",
      message: error.message
    });
    throw error;
  }
}

// ==========================================
// LOGIN ID → EMAIL RESOLUTION
// ==========================================

// Look up the loginIds collection to resolve a custom loginId to a Firebase email
async function resolveLoginIdToEmail(loginId) {
  const normalized = normalizeLoginId(loginId);
  try {
    const loginIdRef = doc(db, "loginIds", normalized);
    const snap = await getDoc(loginIdRef);
    if (snap.exists()) {
      return snap.data().email || null;
    }
    return null;
  } catch (err) {
    console.warn("loginIds lookup failed:", err.message);
    return null;
  }
}

// ==========================================
// AUTHENTICATION VALIDATION
// ==========================================

// Validate authenticated Firebase User against Firestore authorization
export async function handleAuthenticatedUser(user) {
  const uid = user.uid;
  const email = user.email ? user.email.toLowerCase() : "";
  const projectId = firebaseConfig?.projectId || "unknown";
  const path = `users/${uid}`;
  const isSuperAdminEmail = email === "anjugurjar06@gmail.com";

  console.log(`[Auth Diagnostic] Authenticated UID: ${uid}`);
  console.log(`[Auth Diagnostic] Authenticated Email: ${email}`);
  console.log(`[Auth Diagnostic] Firebase Project ID: ${projectId}`);
  console.log(`[Auth Diagnostic] Target Profile Path: ${path}`);

  let profile = null;
  try {
    profile = await getUserProfile(uid);
  } catch (firestoreErr) {
    await signOut(auth);
    console.error(`[Auth Diagnostic] Could not validate profile for ${email}:`, firestoreErr.code, firestoreErr.message);
    if (firestoreErr.code === "permission-denied") {
      const err = new Error("Firestore permission denied while reading your profile.");
      err.code = "permission-denied";
      throw err;
    }
    if (firestoreErr.code === "unavailable") {
      const err = new Error("Firestore database service is currently unavailable. Please verify your Firestore database is created and active in Firebase Console.");
      err.code = "unavailable";
      throw err;
    }
    if (firestoreErr.code === "failed-precondition") {
      const err = new Error("Firestore project configuration error. Please verify project settings in Firebase Console.");
      err.code = "failed-precondition";
      throw err;
    }
    throw firestoreErr;
  }

  // 1. If getUserProfile succeeded without error but returned null, document genuinely does not exist
  if (!profile) {
    await signOut(auth);
    console.warn(`[Auth Diagnostic] Document does not exist at ${path}`);
    if (isSuperAdminEmail) {
      const err = new Error("Super Admin profile is not configured.");
      err.code = "auth/superadmin-not-configured";
      throw err;
    }
    const err = new Error("Your account is not authorized.");
    err.code = "auth/not-authorized";
    throw err;
  }

  // Normalize role comparison safely to lowercase
  const userRole = String(profile.role || "").trim().toLowerCase();
  const validRoles = ["superadmin", "admin", "associate", "client"];

  // 2. Account must have an authorized role
  if (!validRoles.includes(userRole)) {
    await signOut(auth);
    console.warn(`[Auth Diagnostic] Unauthorized role '${profile.role}' for UID ${uid}`);
    const err = new Error("Your account is not authorized.");
    err.code = "auth/not-authorized";
    throw err;
  }

  // If Super Admin email is used, profile role must be superadmin
  if (isSuperAdminEmail && userRole !== "superadmin") {
    await signOut(auth);
    console.warn(`[Auth Diagnostic] Role mismatch for Super Admin email (${email}): found '${userRole}', expected 'superadmin'`);
    const err = new Error("Super Admin profile is not configured.");
    err.code = "auth/superadmin-not-configured";
    throw err;
  }

  // 3. Account must be active (applies to all accounts)
  if (profile.active === false || String(profile.status || "").trim().toLowerCase() === "inactive") {
    await signOut(auth);
    console.warn(`[Auth Diagnostic] Inactive account for UID ${uid}`);
    const err = new Error("Your account has been deactivated.");
    err.code = "auth/inactive";
    throw err;
  }

  // 4. Check lock status (clients and associates only)
  if ((userRole === "client" || userRole === "associate") && profile.locked === true) {
    await signOut(auth);
    console.warn(`[Auth Diagnostic] Locked account for UID ${uid}`);
    const reason = profile.lockReason ? ` Reason: ${profile.lockReason}` : "";
    const err = new Error("Your account access is temporarily restricted." + reason);
    err.code = "auth/locked";
    throw err;
  }

  console.log(`[Auth Diagnostic] Successfully authorized: ${email} as '${userRole}' (UID: ${uid})`);
  return { ...profile, uid, role: userRole, active: profile.active !== false };
}

// ==========================================
// UNIFIED LOGIN (replaces all old login functions)
// ==========================================

// Single login function: resolves Login ID → email → Firebase Auth → Firestore validation
export async function loginUser(loginInput, password) {
  if (firebaseConfig.projectId === "PASTE_NEW_FIREBASE_PROJECT_ID") {
    const err = new Error("Connect a new Firebase project first. See SETUP_NEW_PROJECT.md in the ZIP.");
    err.code = "auth/invalid-project";
    throw err;
  }
  const trimmed = String(loginInput || "").trim();
  if (!trimmed || !password) {
    const err = new Error("Please enter your Login ID and Password.");
    err.code = "auth/invalid-credential";
    throw err;
  }

  let email;

  if (trimmed.toLowerCase() === "anjugurjar@admin") {
    // Visible alias for the separately provisioned Firebase Auth email.
    email = "anjugurjar06@gmail.com";
  } else if (trimmed.includes("@")) {
    // Input looks like an email — use directly
    email = trimmed.toLowerCase();
  } else {
    // Custom Login ID — resolve via loginIds collection
    email = await resolveLoginIdToEmail(trimmed);
    if (!email) {
      const err = new Error("Invalid Login ID or Password.");
      err.code = "auth/invalid-credential";
      throw err;
    }
  }

  try {
    const credential = await signInWithEmailAndPassword(auth, email, password);
    const profile = await handleAuthenticatedUser(credential.user);
    return profile;
  } catch (error) {
    if (error && error.code) {
      console.error("Auth code:", error.code);
    }
    // Re-throw custom authorization & firestore diagnostic errors directly
    if (error.code && (
        error.code === "auth/not-authorized" ||
        error.code === "auth/superadmin-not-configured" ||
        error.code === "auth/inactive" ||
        error.code === "auth/locked" ||
        error.code === "permission-denied" ||
        error.code === "unavailable" ||
        error.code === "failed-precondition" ||
        error.code === "auth/invalid-profile-data"
    )) {
      throw error;
    }
    // Handle operation-not-allowed explicitly
    if (error.code === "auth/operation-not-allowed") {
      const err = new Error("Email/Password authentication is not enabled for this Firebase project.");
      err.code = "auth/operation-not-allowed";
      throw err;
    }
    // Map Firebase credential errors to generic user-friendly message
    if (
      error.code === "auth/wrong-password" ||
      error.code === "auth/invalid-credential" ||
      error.code === "auth/user-not-found" ||
      error.code === "auth/login-id-not-found" ||
      error.code === "auth/invalid-email"
    ) {
      const err = new Error("Invalid Login ID or Password.");
      err.code = "auth/invalid-credential";
      throw err;
    }
    throw error;
  }
}

// ==========================================
// SESSION MANAGEMENT
// ==========================================

// Sign out
export async function logoutUser() {
  return await signOut(auth);
}

// Listen for Auth state changes and sync Firestore profile
export function subscribeAuthState(callback) {
  return onAuthStateChanged(auth, async (firebaseUser) => {
    if (!firebaseUser) {
      callback(null);
      return;
    }
    try {
      const profile = await getUserProfile(firebaseUser.uid);
      const validRoles = ["superadmin", "admin", "associate", "client"];

      if (!profile) {
        console.warn("[Auth Diagnostic] Session restore: Profile document not found for UID:", firebaseUser.uid);
        await signOut(auth);
        callback(null);
        return;
      }

      const userRole = String(profile.role || "").trim().toLowerCase();

      if (!validRoles.includes(userRole)) {
        await signOut(auth);
        callback(null);
        return;
      }

      const isSuperAdminEmail = firebaseUser.email && firebaseUser.email.toLowerCase() === "anjugurjar06@gmail.com";
      if (isSuperAdminEmail && userRole !== "superadmin") {
        await signOut(auth);
        callback(null);
        return;
      }

      // Check active status
      if (profile.active === false || String(profile.status || "").trim().toLowerCase() === "inactive") {
        console.warn("[Auth Diagnostic] Session restore denied for inactive user:", firebaseUser.uid);
        await signOut(auth);
        callback(null);
        return;
      }

      // Check lock status for clients and associates
      if ((userRole === "client" || userRole === "associate") && profile.locked === true) {
        console.warn("[Auth Diagnostic] Session restore denied for locked user:", firebaseUser.uid);
        await signOut(auth);
        callback(null);
        return;
      }

      callback({ ...profile, uid: firebaseUser.uid, role: userRole, active: profile.active !== false });
    } catch (e) {
      console.warn("[Auth Diagnostic] Auth state sync error:", e.code || e.message);
      await signOut(auth);
      callback(null);
    }
  });
}

// ==========================================
// LOGINIDS COLLECTION HELPERS
// ==========================================

// Write a loginIds entry (called when creating a user with custom Login ID)
export async function setLoginIdEntry(loginId, uid, email) {
  const normalized = normalizeLoginId(loginId);
  if (!normalized || normalized === email) return; // skip if loginId is same as email
  const ref = doc(db, "loginIds", normalized);
  await setDoc(ref, { uid, email, loginId: loginId.trim() });
}

// Delete a loginIds entry (called when deleting a user)
export async function deleteLoginIdEntry(loginId) {
  if (!loginId) return;
  const normalized = normalizeLoginId(loginId);
  const ref = doc(db, "loginIds", normalized);
  await deleteDoc(ref);
}

// ==========================================
// ADMIN / SUPER ADMIN: CREATE USER ACCOUNT
// ==========================================

// Create a new user account via secondary Firebase app instance
// (so the currently logged-in admin/superadmin session is preserved)
export async function createAccountByAdmin({ loginId, name, role, password, mobile = "", email: customEmail = "", caseNos = [], permissions = {} }) {
  const trimmedLoginId = String(loginId || "").trim();
  
  // Determine the Firebase email for this account
  let firebaseEmail;
  if (trimmedLoginId.includes("@")) {
    firebaseEmail = trimmedLoginId.toLowerCase();
  } else if (customEmail && customEmail.includes("@")) {
    firebaseEmail = customEmail.toLowerCase();
  } else {
    const cleanId = trimmedLoginId.toLowerCase().replace(/[^a-z0-9._-]/g, "");
    firebaseEmail = `${cleanId || "user"}@gurjarlawfirm.internal`;
  }

  const secondaryAppName = "AdminCreateUserApp_" + Date.now();
  const secondaryApp = initializeApp(firebaseConfig, secondaryAppName);
  const secondaryAuth = (await import("https://www.gstatic.com/firebasejs/10.13.2/firebase-auth.js")).getAuth(secondaryApp);

  try {
    const cred = await createUserWithEmailAndPassword(secondaryAuth, firebaseEmail, password);
    const newUid = cred.user.uid;

    const newProfile = {
      uid: newUid,
      name: name.trim(),
      email: firebaseEmail,
      loginId: trimmedLoginId,
      mobile: mobile.trim(),
      role: role.toLowerCase(),
      active: true,
      locked: false,
      lockReason: "",
      caseNos: Array.isArray(caseNos) ? caseNos : [],
      permissions: permissions || {},
      createdAt: serverTimestamp(),
      updatedAt: serverTimestamp()
    };

    // Write Firestore user profile
    await setDoc(doc(db, "users", newUid), newProfile);

    // Write loginIds entry (for custom login ID resolution)
    if (!trimmedLoginId.includes("@")) {
      await setLoginIdEntry(trimmedLoginId, newUid, firebaseEmail);
    }

    return newProfile;
  } finally {
    const { deleteApp } = await import("https://www.gstatic.com/firebasejs/10.13.2/firebase-app.js");
    await deleteApp(secondaryApp);
  }
}

 
// Firebase sends a reset link only to a real sign-in email. This does not
// expose or change another user's password in the browser.
export async function sendAccountPasswordReset(email) {
  const address = String(email || "").trim().toLowerCase();
  if (!address || address.endsWith("@gurjarlawfirm.internal")) {
    throw new Error("This account uses an internal login email. Set up a real sign-in email in Firebase Authentication before a reset link can be sent.");
  }
  await sendPasswordResetEmail(auth, address);
}

/** Save profile details and rename a custom login alias atomically. */
export async function saveUserDetailsWithLoginId(uid, loginId, details) {
  const requested = String(loginId || "").trim();
  if (!requested) throw new Error("Login ID is required.");
  return runTransaction(db, async transaction => {
    const profileRef = doc(db, "users", uid);
    const snapshot = await transaction.get(profileRef);
    if (!snapshot.exists()) throw new Error("User account no longer exists.");
    const profile = snapshot.data();
    if (profile.role === "superadmin") throw new Error("Primary account cannot be edited.");
    const previous = String(profile.loginId || "").trim();
    const changed = requested !== previous;
    if (changed && !/^[a-zA-Z0-9._-]{1,64}$/.test(requested)) {
      throw new Error("Use 1–64 letters, numbers, dots, underscores or hyphens for the Login ID.");
    }
    if (changed) {
      if (!profile.email) throw new Error("Account sign-in email is missing.");
      const nextRef = doc(db, "loginIds", normalizeLoginId(requested));
      const next = await transaction.get(nextRef);
      if (next.exists() && next.data().uid !== uid) {
        throw new Error("This Login ID is already used by another account.");
      }
      const oldKey = previous && !previous.includes("@") ? normalizeLoginId(previous) : "";
      const oldRef = oldKey && oldKey !== normalizeLoginId(requested) ? doc(db, "loginIds", oldKey) : null;
      const old = oldRef ? await transaction.get(oldRef) : null;
      transaction.set(nextRef, { uid, email: profile.email, loginId: requested });
      // Never delete a mapping that belongs to a different account.
      if (old?.exists() && old.data().uid === uid) transaction.delete(oldRef);
    }
    const allowed = {};
    for (const key of ["name", "mobile", "contactEmail", "caseNos"]) {
      if (Object.prototype.hasOwnProperty.call(details, key)) allowed[key] = details[key];
    }
    transaction.update(profileRef, { ...allowed, loginId: requested, updatedAt: serverTimestamp() });
  });
}
