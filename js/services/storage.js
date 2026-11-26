// Supabase Storage access for uploaded invitation files.
//
// Files are stored in your Supabase Storage bucket at:
//   invitations/{ownerId}/{invitationId}/file-<random>.<ext>
//
// Security notes:
//   * File names carry 128 bits of randomness (32 hex chars) and are only stored inside
//     Firestore's `shares/{token}` document while sharing is enabled.
//   * Original file bytes are uploaded and fetched untouched (no re-encoding).

import { MAX_UPLOAD_BYTES } from '../config.js';
import { auth } from '../firebase.js';
import { ACCEPTED_TYPES, extForMime } from '../lib/filetype.js';
import { randomHex } from '../lib/token.js';
import { getSupabaseHeaders, storageBucketUrl, storageObjectUrl, supabaseConfig } from '../supabase.js';

export function buildStoragePath(ownerId, invitationId, mime) {
  const ext = extForMime(mime);
  if (!ext) throw new Error('Unsupported file type.');
  return `invitations/${ownerId}/${invitationId}/file-${randomHex(16)}.${ext}`;
}

export function describeStorageError(error) {
  switch (error?.code) {
    case 'storage/unauthorized':
    case 'storage/unauthenticated':
      return 'You don’t have permission to access this file. Check your Supabase Storage policies.';
    case 'storage/object-not-found':
      return 'That file could not be found.';
    case 'storage/quota-exceeded':
      return 'File exceeds your Supabase Storage size limit or quota.';
    case 'storage/retry-limit-exceeded':
    case 'storage/network-request-failed':
      return 'Network problem while transferring the file. Please try again.';
    case 'storage/canceled':
      return 'Upload cancelled.';
    default:
      return error?.message || 'Something went wrong with the file. Please try again.';
  }
}

function mapHttpStatusToCode(status, body = {}) {
  const msg = String(body?.message || body?.error || '').toLowerCase();
  if (status === 401 || status === 403 || msg.includes('row-level security') || msg.includes('unauthorized') || msg.includes('jwt')) {
    return 'storage/unauthorized';
  }
  if (status === 404 || msg.includes('not found')) {
    return 'storage/object-not-found';
  }
  if (status === 413 || msg.includes('maximum allowed size') || msg.includes('quota')) {
    return 'storage/quota-exceeded';
  }
  return 'storage/unknown';
}

function makeStorageError(code, fallbackMessage) {
  const message = fallbackMessage || describeStorageError({ code, message: fallbackMessage });
  return Object.assign(new Error(message), { code });
}

function parseErrorBody(text) {
  try {
    return text ? JSON.parse(text) : {};
  } catch {
    return { message: text };
  }
}

/** Uploads the ORIGINAL file bytes — no re-encoding — so quality and aspect ratio are preserved. */
export async function uploadInvitationFile(ownerId, invitationId, file, mime, onProgress) {
  if (!supabaseConfig.isConfigured) {
    throw makeStorageError('storage/unauthenticated', 'Supabase Storage is not configured in .env.');
  }
  const path = buildStoragePath(ownerId, invitationId, mime);
  const headers = await getSupabaseHeaders({ includeAuth: true });
  const uploadUrl = storageObjectUrl(path);

  return new Promise((resolve, reject) => {
    const xhr = new XMLHttpRequest();
    xhr.open('POST', uploadUrl, true);
    for (const [k, v] of Object.entries(headers)) xhr.setRequestHeader(k, v);
    xhr.setRequestHeader('Content-Type', mime);
    xhr.setRequestHeader('cache-control', '3600');

    xhr.upload.onprogress = (evt) => {
      if (evt.lengthComputable && evt.total > 0) {
        onProgress?.(evt.loaded / evt.total);
      }
    };
    xhr.onload = () => {
      if (xhr.status >= 200 && xhr.status < 300) {
        onProgress?.(1);
        resolve(path);
        return;
      }
      const body = parseErrorBody(xhr.responseText);
      const code = mapHttpStatusToCode(xhr.status, body);
      const detail = body?.message || body?.error;
      reject(makeStorageError(code, detail && (code === 'storage/unknown' || code === 'storage/object-not-found') ? detail : undefined));
    };
    xhr.onerror = () => reject(makeStorageError('storage/network-request-failed'));
    xhr.onabort = () => reject(makeStorageError('storage/canceled'));
    xhr.send(file);
  });
}

const blobCache = new Map();

async function fetchFromSupabase(path) {
  const preferAuthenticated = supabaseConfig.useFirebaseJwt && Boolean(auth?.currentUser);
  if (preferAuthenticated) {
    const authRes = await fetch(storageObjectUrl(path, 'authenticated'), {
      headers: await getSupabaseHeaders({ includeAuth: true }),
    });
    if (authRes.ok) return authRes;
    if (authRes.status !== 400 && authRes.status !== 404) return authRes;
  }

  // Default for public buckets (works for both signed-in owners and shared-link visitors).
  const pubRes = await fetch(storageObjectUrl(path, 'public'));
  if (pubRes.ok) return pubRes;

  // Fallback for private buckets with an RLS SELECT policy on storage.objects.
  if (pubRes.status === 400 || pubRes.status === 404) {
    return fetch(storageObjectUrl(path, 'object'), {
      headers: await getSupabaseHeaders({ includeAuth: true }),
    });
  }
  return pubRes;
}

/** Downloads a stored file as a Blob from Supabase Storage. Cached for the session. */
export async function fetchFileBlob(path, contentType) {
  if (blobCache.has(path)) return blobCache.get(path);
  const promise = (async () => {
    if (!supabaseConfig.isConfigured) {
      throw makeStorageError('storage/unauthenticated', 'Supabase Storage is not configured in .env.');
    }
    const type = ACCEPTED_TYPES[contentType] ? contentType : 'application/octet-stream';
    let res;
    try {
      res = await fetchFromSupabase(path);
    } catch {
      throw makeStorageError('storage/network-request-failed');
    }
    if (!res.ok) {
      const body = parseErrorBody(await res.text().catch(() => ''));
      throw makeStorageError(mapHttpStatusToCode(res.status, body));
    }
    const bytes = await res.arrayBuffer();
    if (bytes.byteLength > MAX_UPLOAD_BYTES + 1024) {
      throw makeStorageError('storage/quota-exceeded');
    }
    return new Blob([bytes], { type });
  })();
  blobCache.set(path, promise);
  promise.catch(() => blobCache.delete(path));
  return promise;
}

export function forgetFile(path) {
  blobCache.delete(path);
}

export async function deleteFile(path) {
  if (!path) return;
  forgetFile(path);
  if (!supabaseConfig.isConfigured) return;
  try {
    const headers = await getSupabaseHeaders({ includeAuth: true });
    const res = await fetch(storageBucketUrl(), {
      method: 'DELETE',
      headers: { ...headers, 'Content-Type': 'application/json' },
      body: JSON.stringify({ prefixes: [path] }),
    });
    if (!res.ok && res.status !== 404) {
      console.warn('Could not delete file', path, res.status);
    }
  } catch (error) {
    console.warn('Could not delete file', path, error);
  }
}

/**
 * Synchronous best-effort delete for pagehide / reload / tab close using `keepalive: true`.
 */
export function deleteFilesKeepalive(paths, headers) {
  const list = (paths || []).filter(Boolean);
  if (!list.length || !supabaseConfig.isConfigured) return;
  list.forEach(forgetFile);
  try {
    const authHeaders = headers || { apikey: supabaseConfig.anonKey };
    fetch(storageBucketUrl(), {
      method: 'DELETE',
      headers: { ...authHeaders, 'Content-Type': 'application/json' },
      body: JSON.stringify({ prefixes: list }),
      keepalive: true,
    }).catch(() => {});
  } catch {
    // ignore unload errors
  }
}
