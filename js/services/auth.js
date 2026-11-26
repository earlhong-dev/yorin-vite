// Authentication service: Google Sign-In with Firebase Auth. Sessions persist across reloads
// (Firebase's default local persistence), and every consumer goes through this module.

import { GoogleAuthProvider, onAuthStateChanged, signInWithPopup, signInWithRedirect, signOut as fbSignOut } from 'firebase/auth';
import { env } from '../config.js';
import { auth } from '../firebase.js';
import { upsertUser } from './db.js';

let currentUser = null;
let readyPromise = null;
const listeners = new Set();

const normalize = (u) =>
  u ? { uid: u.uid, displayName: u.displayName || '', email: u.email || '', photoURL: u.photoURL || '' } : null;

export const getUser = () => currentUser;

/** Resolves once Firebase has restored (or ruled out) a saved session. */
export function initAuth() {
  if (readyPromise) return readyPromise;
  readyPromise = new Promise((resolve) => {
    let first = true;
    onAuthStateChanged(
      auth,
      (fbUser) => {
        const next = normalize(fbUser);
        const changed = next?.uid !== currentUser?.uid;
        currentUser = next;
        if (next && changed) upsertUser(next).catch((e) => console.warn('Could not save profile', e));
        if (first) {
          first = false;
          resolve(currentUser);
        }
        if (changed) listeners.forEach((fn) => fn(currentUser));
      },
      (error) => {
        console.error('Auth listener failed', error);
        if (first) {
          first = false;
          resolve(null);
        }
      },
    );
  });
  return readyPromise;
}

export function onUserChange(fn) {
  listeners.add(fn);
  return () => listeners.delete(fn);
}

const SILENT_CODES = new Set(['auth/popup-closed-by-user', 'auth/cancelled-popup-request', 'auth/user-cancelled']);
const REDIRECT_CODES = new Set(['auth/popup-blocked', 'auth/operation-not-supported-in-this-environment']);

export function describeAuthError(error) {
  switch (error?.code) {
    case 'auth/unauthorized-domain':
      return 'This website’s domain isn’t authorized in Firebase yet. Add it under Authentication → Settings → Authorized domains.';
    case 'auth/operation-not-allowed':
      return 'Google sign-in isn’t enabled for this Firebase project yet. Enable it under Authentication → Sign-in method.';
    case 'auth/network-request-failed':
      return 'Network problem while signing in. Check your connection and try again.';
    case 'auth/too-many-requests':
      return 'Too many attempts. Please wait a moment and try again.';
    default:
      return 'We couldn’t sign you in. Please try again.';
  }
}

function capturePopup(startSignIn) {
  let popup = null;
  const origOpen = window.open;
  window.open = function (...args) {
    const win = origOpen.apply(this, args);
    if (!popup && win) popup = win;
    return win;
  };
  try {
    return { promise: startSignIn(), popup };
  } finally {
    window.open = origOpen;
  }
}

function awaitPopupOrFastClose(popupPromise, popup) {
  if (!popup) return popupPromise;
  const authOrigin = env.FIREBASE_AUTH_DOMAIN ? `https://${env.FIREBASE_AUTH_DOMAIN}` : '';
  return new Promise((resolve, reject) => {
    let settled = false;
    let sawAuthEvent = false;
    let timer = null;
    let graceTimer = null;

    const cleanup = () => {
      clearInterval(timer);
      clearTimeout(graceTimer);
      window.removeEventListener('focus', onFocus);
      window.removeEventListener('message', onMessage);
    };

    const finish = (fn, val) => {
      if (settled) return;
      settled = true;
      cleanup();
      fn(val);
    };

    const onMessage = (event) => {
      if (authOrigin && event.origin !== authOrigin) return;
      try {
        const raw = typeof event.data === 'string' ? event.data : JSON.stringify(event.data || '');
        if (raw.includes('authEvent')) sawAuthEvent = true;
      } catch {
        /* ignore non-serializable messages */
      }
    };

    const checkClosed = () => {
      if (settled || sawAuthEvent) return;
      try {
        if (!popup.closed) return;
      } catch {
        return;
      }
      if (graceTimer) return;
      // Short grace period so any queued postMessage from __/auth/handler arrives before we treat it as cancelled.
      graceTimer = setTimeout(() => {
        if (!settled && !sawAuthEvent) {
          finish(resolve, { cancelled: true });
        }
      }, 120);
    };

    const onFocus = () => checkClosed();

    window.addEventListener('message', onMessage);
    window.addEventListener('focus', onFocus);
    timer = setInterval(checkClosed, 80);

    popupPromise.then(
      (result) => finish(resolve, { result }),
      (error) => finish(reject, error),
    );
  });
}

/** Opens the Google sign-in popup (falls back to a full-page redirect if popups are blocked).
 *  Resolves to the user, or null if they closed the popup. Throws a friendly Error on failure. */
export async function signIn() {
  const provider = new GoogleAuthProvider();
  provider.setCustomParameters({ prompt: 'select_account' });
  const { promise, popup } = capturePopup(() => signInWithPopup(auth, provider));
  try {
    const outcome = await awaitPopupOrFastClose(promise, popup);
    if (outcome?.cancelled) {
      // Suppress unhandled rejection when Firebase's slower popup-closed timer fires later.
      promise.catch(() => {});
      return null;
    }
    const result = popup ? outcome.result : outcome;
    return normalize(result.user);
  } catch (error) {
    if (SILENT_CODES.has(error?.code)) return null;
    if (REDIRECT_CODES.has(error?.code)) {
      await signInWithRedirect(auth, provider);
      return undefined; // page navigates away
    }
    console.error('Sign-in failed', error);
    throw new Error(describeAuthError(error));
  }
}

export async function signOut() {
  await fbSignOut(auth);
}
