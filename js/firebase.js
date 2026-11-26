// Firebase initialisation (Authentication + Cloud Firestore).
// Settings come from js/config.js (generated from .env — nothing private is hardcoded here).
// File uploads use Supabase Storage instead of Firebase Storage (see js/supabase.js).

import { initializeApp } from 'firebase/app';
import { getAuth } from 'firebase/auth';
import { getFirestore } from 'firebase/firestore';
import {
  MAX_UPLOAD_BYTES,
  MAX_UPLOAD_MB,
  env,
  isConfigured,
  missingConfig,
  missingFirebaseConfig,
} from './config.js';

const firebaseConfigured = missingFirebaseConfig.length === 0;

let app = null;
let auth = null;
let db = null;

if (firebaseConfigured) {
  app = initializeApp({
    apiKey: env.FIREBASE_API_KEY,
    authDomain: env.FIREBASE_AUTH_DOMAIN,
    projectId: env.FIREBASE_PROJECT_ID,
    messagingSenderId: env.FIREBASE_MESSAGING_SENDER_ID || undefined,
    appId: env.FIREBASE_APP_ID,
  });
  auth = getAuth(app);
  db = getFirestore(app);
}

export { MAX_UPLOAD_BYTES, MAX_UPLOAD_MB, app, auth, db, isConfigured, missingConfig };
