// Supabase Storage configuration and request helpers.
// Settings come from js/config.js (generated from .env).
//
// Works with both modern Supabase publishable keys (`sb_publishable_...`) and legacy
// anon JWT keys (`eyJ...`). If SUPABASE_USE_FIREBASE_JWT=true in .env, signed-in
// requests also attach the Firebase user's ID token for Supabase Third-Party Auth RLS.

import { env, missingSupabaseConfig } from './config.js';
import { auth } from './firebase.js';

function normalizeSupabaseUrl(value) {
  const trimmed = String(value || '').trim().replace(/\/+$/, '');
  if (!trimmed) return '';
  try {
    return new URL(trimmed).origin;
  } catch {
    return trimmed.replace(/\/(?:rest|storage|auth)\/v1$/i, '');
  }
}

const rawUrl = normalizeSupabaseUrl(env.SUPABASE_URL);
const anonKey = String(env.SUPABASE_ANON_KEY || '').trim();
const bucket = String(env.SUPABASE_BUCKET || '').trim();
const useFirebaseJwt = String(env.SUPABASE_USE_FIREBASE_JWT || '').trim().toLowerCase() === 'true';

export const supabaseConfig = {
  url: rawUrl,
  anonKey,
  bucket,
  useFirebaseJwt,
  isConfigured: missingSupabaseConfig.length === 0,
};

export function encodeStoragePath(path) {
  return String(path)
    .split('/')
    .map((segment) => encodeURIComponent(segment))
    .join('/');
}

export function storageBucketUrl() {
  return `${supabaseConfig.url}/storage/v1/object/${encodeURIComponent(supabaseConfig.bucket)}`;
}

export function storageObjectUrl(path, access = 'object') {
  const prefix = access === 'public' ? 'public/' : access === 'authenticated' ? 'authenticated/' : '';
  return `${supabaseConfig.url}/storage/v1/object/${prefix}${encodeURIComponent(supabaseConfig.bucket)}/${encodeStoragePath(path)}`;
}

export async function getSupabaseHeaders({ includeAuth = true } = {}) {
  const headers = {
    apikey: supabaseConfig.anonKey,
  };
  if (!includeAuth) return headers;

  if (supabaseConfig.useFirebaseJwt && auth?.currentUser) {
    const token = await auth.currentUser.getIdToken();
    if (token) {
      headers.Authorization = `Bearer ${token}`;
      return headers;
    }
  }

  // Only pass the key in Authorization when it is a JWT (legacy anon key).
  // Modern `sb_publishable_*` keys must only go in the `apikey` header.
  if (supabaseConfig.anonKey.startsWith('eyJ')) {
    headers.Authorization = `Bearer ${supabaseConfig.anonKey}`;
  }
  return headers;
}
