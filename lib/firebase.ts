import { initializeApp, getApps, getApp } from "firebase/app";
import {
  getAuth,
  GoogleAuthProvider,
  signInWithPopup,
  signOut as fbSignOut,
  onAuthStateChanged,
  type User,
} from "firebase/auth";
/**
 * Firebase client — same project and sign-in flow as Scripture Studio
 * (ported from its src/lib/auth-client.ts), so one Google account works
 * across both tools. NEXT_PUBLIC_* values are client-exposed by design.
 * Auth only — Firestore is server-side (lib/firestore-server.ts), matching
 * the project's deny-all client rules.
 */

const config = {
  apiKey: process.env.NEXT_PUBLIC_FIREBASE_API_KEY,
  authDomain: process.env.NEXT_PUBLIC_FIREBASE_AUTH_DOMAIN,
  projectId: process.env.NEXT_PUBLIC_FIREBASE_PROJECT_ID,
  appId: process.env.NEXT_PUBLIC_FIREBASE_APP_ID,
};

function app() {
  return getApps().length ? getApp() : initializeApp(config);
}

export function auth() {
  return getAuth(app());
}

export function signInWithGoogle() {
  const provider = new GoogleAuthProvider();
  // Always show Google's account chooser so a reviewer can switch accounts
  // after signing out (otherwise Google silently reuses the last session).
  provider.setCustomParameters({ prompt: "select_account" });
  return signInWithPopup(auth(), provider);
}

export function signOut() {
  return fbSignOut(auth());
}

/** Subscribe to auth state; returns the unsubscribe fn. */
export function watchAuth(cb: (user: User | null) => void) {
  return onAuthStateChanged(auth(), cb);
}

/** Friendly, code-specific message for a Firebase Auth failure. */
export function authErrorMessage(e: unknown): string {
  const code = (e as { code?: string }).code ?? "";
  switch (code) {
    case "auth/unauthorized-domain":
      return "This site isn't authorized for sign-in yet. If you're the admin, add this domain under Firebase → Authentication → Settings → Authorized domains.";
    case "auth/popup-blocked":
      return "Your browser blocked the sign-in popup. Allow popups for this site, then try again.";
    case "auth/popup-closed-by-user":
    case "auth/cancelled-popup-request":
      return "Sign-in was cancelled — tap the button to try again.";
    case "auth/network-request-failed":
      return "Network problem — check your connection and try again.";
    case "auth/operation-not-allowed":
      return "Google sign-in isn't enabled for this project yet.";
    default:
      return code ? `Couldn't sign in (${code}). Please try again.` : "Couldn't sign in. Please try again.";
  }
}

export type { User };
