// Shared runtime configuration read from window.__YORIN_ENV__ (js/env-config.js),
// generated from .env by `npm run config` / `npm run dev` / `npm run build`.

export const env = window.__YORIN_ENV__ || {};

const FIREBASE_REQUIRED = [
  'FIREBASE_API_KEY',
  'FIREBASE_AUTH_DOMAIN',
  'FIREBASE_PROJECT_ID',
  'FIREBASE_APP_ID',
];

const SUPABASE_REQUIRED = [
  'SUPABASE_URL',
  'SUPABASE_ANON_KEY',
  'SUPABASE_BUCKET',
];

export const isPlaceholder = (v) =>
  !v || /^(?:https?:\/\/)?your[-_]/i.test(v) || /your-project/i.test(v);

export const missingFirebaseConfig = FIREBASE_REQUIRED.filter((key) => isPlaceholder(env[key]));
export const missingSupabaseConfig = SUPABASE_REQUIRED.filter((key) => isPlaceholder(env[key]));
export const missingConfig = [...missingFirebaseConfig, ...missingSupabaseConfig];
export const isConfigured = missingConfig.length === 0;

export const MAX_UPLOAD_MB = Math.min(Math.max(Number(env.MAX_UPLOAD_MB) || 15, 1), 100);
export const MAX_UPLOAD_BYTES = MAX_UPLOAD_MB * 1024 * 1024;
