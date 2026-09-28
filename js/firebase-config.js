// Firebase Modular Configuration for Gurjar Law Firm & Associates
import { initializeApp } from "https://www.gstatic.com/firebasejs/10.13.2/firebase-app.js";
import { 
  getAuth, 
  setPersistence,
  browserLocalPersistence
} from "https://www.gstatic.com/firebasejs/10.13.2/firebase-auth.js";
import { 
  getFirestore 
} from "https://www.gstatic.com/firebasejs/10.13.2/firebase-firestore.js";
import { 
  getStorage 
} from "https://www.gstatic.com/firebasejs/10.13.2/firebase-storage.js";
import { 
  getAnalytics, 
  isSupported 
} from "https://www.gstatic.com/firebasejs/10.13.2/firebase-analytics.js";

export const firebaseConfig = {
  apiKey: "AIzaSyChhU7VIZXEq0oX-m1oUxM3-oOhDdhavNU",
  authDomain: "gurjar-law-firm.firebaseapp.com",
  projectId: "gurjar-law-firm",
  storageBucket: "gurjar-law-firm.firebasestorage.app",
  messagingSenderId: "848830390632",
  appId: "1:848830390632:web:982b635af88b5c745ef6dd"
};

// Never connect this separate website to the original firm's backend.
if (/mmkhandelwal/i.test(JSON.stringify(firebaseConfig))) {
  throw new Error("The previous firm's Firebase project cannot be used here.");
}

// Initialize Firebase Core (Single instance)
export const app = initializeApp(firebaseConfig);

// Initialize Authentication (Single instance)
export const auth = getAuth(app);

// Enable persistent browser sessions
setPersistence(auth, browserLocalPersistence).catch(err => {
  console.warn("Auth persistence notice:", err);
});

// Initialize Cloud Firestore
export const db = getFirestore(app);

// Initialize Firebase Storage
export const storage = getStorage(app);

// Initialize Analytics conditionally
export let analytics = null;
isSupported().then(supported => {
  if (supported) {
    analytics = getAnalytics(app);
  }
}).catch(() => {
  // Analytics not supported in this environment
});
