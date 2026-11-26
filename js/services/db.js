// Cloud Firestore data layer. All reads/writes go through here.
//
// Collections (flat, each document carries ownerId so rules can verify ownership cheaply):
//   users/{uid}  events/{id}  categories/{id} (eventId)  invitations/{id} (eventId, categoryId)
//   shares/{token}  — public-by-token snapshot of one invitation, see firestore.rules
//
// Queries always filter by ownerId == uid: Firestore rules aren't filters, so a query that
// could return someone else's documents is rejected outright.
// Sorting is done client-side, so no composite indexes are required.

import {
  collection, deleteDoc, doc, getDoc, getDocs, query, serverTimestamp, setDoc, updateDoc, where, writeBatch,
} from 'firebase/firestore';
import { db } from '../firebase.js';
import { sanitizeDesign } from '../lib/design.js';
import { generateToken, isPlausibleToken } from '../lib/token.js';
import { LIMITS, validateCategoryName, validateEvent, validateInvitationName } from '../lib/validate.js';
import { deleteFile } from './storage.js';

const toMs = (t) => (t && typeof t.toMillis === 'function' ? t.toMillis() : typeof t === 'number' ? t : null);
const fromSnap = (snap) => {
  const d = snap.data();
  return { id: snap.id, ...d, createdAt: toMs(d.createdAt), updatedAt: toMs(d.updatedAt) };
};

export function isPermissionError(error) {
  return error?.code === 'permission-denied' || error?.code === 'not-found';
}

export function describeDbError(error) {
  switch (error?.code) {
    case 'permission-denied':
      return 'You don’t have permission to do that.';
    case 'unavailable':
    case 'deadline-exceeded':
      return 'We can’t reach the server right now. Check your connection and try again.';
    case 'resource-exhausted':
      return 'The service is temporarily over its quota. Please try again later.';
    default:
      return error?.message && !error?.code ? error.message : 'Something went wrong. Please try again.';
  }
}

class ValidationError extends Error {
  constructor(message, errors = {}) {
    super(message);
    this.name = 'ValidationError';
    this.errors = errors;
  }
}
export const isValidationError = (e) => e?.name === 'ValidationError';

async function commitInChunks(operations) {
  // Firestore batches are limited to 500 writes.
  for (let i = 0; i < operations.length; i += 400) {
    const batch = writeBatch(db);
    operations.slice(i, i + 400).forEach((apply) => apply(batch));
    await batch.commit();
  }
}

/* ------------------------------------------------------------------ users */

export async function upsertUser(user) {
  const ref = doc(db, 'users', user.uid);
  const existing = await getDoc(ref).catch(() => null);
  const profile = {
    displayName: user.displayName || '',
    email: user.email || '',
    photoURL: user.photoURL || '',
    lastLoginAt: serverTimestamp(),
  };
  if (!existing?.exists()) profile.createdAt = serverTimestamp();
  await setDoc(ref, profile, { merge: true });
}

/* ----------------------------------------------------------------- events */

export async function listEvents(uid) {
  const snap = await getDocs(query(collection(db, 'events'), where('ownerId', '==', uid)));
  return snap.docs.map(fromSnap).sort((a, b) => (a.date < b.date ? 1 : a.date > b.date ? -1 : (b.createdAt || 0) - (a.createdAt || 0)));
}

/** Returns the event, or null if it doesn't exist / isn't yours (the two look identical on purpose). */
export async function getEvent(uid, eventId) {
  try {
    const snap = await getDoc(doc(db, 'events', eventId));
    if (!snap.exists()) return null;
    const event = fromSnap(snap);
    return event.ownerId === uid ? event : null;
  } catch (error) {
    if (isPermissionError(error)) return null;
    throw error;
  }
}

export async function createEvent(uid, input) {
  const { valid, errors, value } = validateEvent(input);
  if (!valid) throw new ValidationError('Please fix the highlighted fields.', errors);

  const eventRef = doc(collection(db, 'events'));
  await setDoc(eventRef, { ownerId: uid, ...value, createdAt: serverTimestamp(), updatedAt: serverTimestamp() });
  return eventRef.id;
}

export async function updateEvent(event, input) {
  const { valid, errors, value } = validateEvent(input);
  if (!valid) throw new ValidationError('Please fix the highlighted fields.', errors);

  await updateDoc(doc(db, 'events', event.id), { ...value, updatedAt: serverTimestamp() });
  return { ...event, ...value, updatedAt: Date.now() };
}

/** Deletes an event and everything inside it: invitations (+ their files and share links) and categories. */
export async function deleteEvent(uid, eventId) {
  const invitations = await listInvitations(uid, eventId);
  const categories = await listCategories(uid, eventId);
  const ops = [];
  for (const inv of invitations) {
    if (inv.shareToken) ops.push((b) => b.delete(doc(db, 'shares', inv.shareToken)));
    ops.push((b) => b.delete(doc(db, 'invitations', inv.id)));
  }
  categories.forEach((c) => ops.push((b) => b.delete(doc(db, 'categories', c.id))));
  ops.push((b) => b.delete(doc(db, 'events', eventId)));
  await commitInChunks(ops);
  await Promise.all(invitations.filter((i) => i.file?.path).map((i) => deleteFile(i.file.path)));
}

/* ------------------------------------------------------------- categories */

export async function listCategories(uid, eventId) {
  const snap = await getDocs(
    query(collection(db, 'categories'), where('ownerId', '==', uid), where('eventId', '==', eventId)),
  );
  return snap.docs.map(fromSnap).sort((a, b) => (a.order ?? 0) - (b.order ?? 0) || (a.createdAt || 0) - (b.createdAt || 0));
}

export async function addCategory(uid, eventId, name, existing = []) {
  if (existing.length >= LIMITS.maxCategoriesPerEvent) {
    throw new ValidationError(`An event can have up to ${LIMITS.maxCategoriesPerEvent} guest lists.`);
  }
  const check = validateCategoryName(name, existing.map((c) => c.name));
  if (!check.valid) throw new ValidationError(check.error);
  const ref = doc(collection(db, 'categories'));
  const order = existing.reduce((max, c) => Math.max(max, c.order ?? 0), -1) + 1;
  await setDoc(ref, {
    ownerId: uid,
    eventId,
    name: check.value,
    nameLower: check.value.toLowerCase(),
    order,
    isDefault: false,
    createdAt: serverTimestamp(),
  });
  return { id: ref.id, ownerId: uid, eventId, name: check.value, nameLower: check.value.toLowerCase(), order, isDefault: false };
}

export async function markCategoryActive(category) {
  if (!category?.id || !category.isDefault) return;
  await updateDoc(doc(db, 'categories', category.id), { isDefault: false });
  category.isDefault = false;
}

export async function deleteCategory(uid, category) {
  const used = await getDocs(
    query(collection(db, 'invitations'), where('ownerId', '==', uid), where('categoryId', '==', category.id)),
  );
  if (!used.empty) throw new ValidationError('Move or delete the invitations in this guest list first.');
  await deleteDoc(doc(db, 'categories', category.id));
}

/* ------------------------------------------------------------ invitations */

export async function listInvitations(uid, eventId) {
  const snap = await getDocs(
    query(collection(db, 'invitations'), where('ownerId', '==', uid), where('eventId', '==', eventId)),
  );
  return snap.docs.map(normaliseInv).sort((a, b) => (b.createdAt || 0) - (a.createdAt || 0));
}

export async function getInvitation(uid, invitationId) {
  try {
    const snap = await getDoc(doc(db, 'invitations', invitationId));
    if (!snap.exists()) return null;
    const inv = normaliseInv(snap);
    return inv.ownerId === uid ? inv : null;
  } catch (error) {
    if (isPermissionError(error)) return null;
    throw error;
  }
}

/** Reserve an ID up-front so an uploaded file can live under its invitation's folder. */
export const newInvitationId = () => doc(collection(db, 'invitations')).id;

const fileMeta = (file) => ({
  path: String(file.path),
  name: String(file.name || '').slice(0, 200),
  contentType: String(file.contentType),
  kind: file.kind === 'pdf' ? 'pdf' : 'image',
  size: Number(file.size) || 0,
  width: Number(file.width) || 0,
  height: Number(file.height) || 0,
});

/** Normalise an invitation snapshot: always expose `files[]` even for old single-file records. */
function normaliseInv(snap) {
  const d = snap.data();
  const base = { id: snap.id, ...d, createdAt: toMs(d.createdAt), updatedAt: toMs(d.updatedAt) };
  if (base.creationType === 'uploaded' && !base.files) {
    // Migrate old single-file format on the fly (read-only, no write needed).
    base.files = base.file ? [base.file] : [];
  }
  return base;
}

function shareSnapshot(inv, enabled) {
  const base = {
    invitationId: inv.id,
    ownerId: inv.ownerId,
    enabled,
    kind: inv.creationType,
    name: inv.name,
    updatedAt: serverTimestamp(),
  };
  return inv.creationType === 'created'
    ? { ...base, design: inv.design }
    : { ...base, files: (inv.files || []).map(fileMeta), viewMode: inv.viewMode || 'vertical' };
}

/**
 * Create an invitation. `data` = { name, categoryId, creationType:'created'|'uploaded', design?, files?[], thumbnail? }.
 * For uploads pass `id` from newInvitationId() — files must already be stored under that ID.
 */
export async function createInvitation(uid, eventId, data) {
  const name = validateInvitationName(data.name);
  if (!name.valid) throw new ValidationError(name.error, { name: name.error });
  if (!data.categoryId) throw new ValidationError('Choose a guest list.', { category: 'Choose a guest list.' });

  const ref = data.id ? doc(db, 'invitations', data.id) : doc(collection(db, 'invitations'));
  const record = {
    ownerId: uid,
    eventId,
    categoryId: data.categoryId,
    name: name.value,
    creationType: data.creationType,
    sharingEnabled: false,
    shareToken: null,
    createdAt: serverTimestamp(),
    updatedAt: serverTimestamp(),
  };
  if (data.creationType === 'created') record.design = sanitizeDesign(data.design);
  else {
    record.files = (data.files || []).map(fileMeta);
    record.viewMode = ['vertical', 'horizontal', 'flip'].includes(data.viewMode) ? data.viewMode : 'vertical';
  }
  if (data.thumbnail) record.thumbnail = data.thumbnail;

  await setDoc(ref, record);
  return ref.id;
}

/** Update name / category / design / files / thumbnail. Keeps an existing share link in sync. */
export async function updateInvitation(inv, changes) {
  const patch = { updatedAt: serverTimestamp() };
  const merged = { ...inv };

  if ('name' in changes) {
    const name = validateInvitationName(changes.name);
    if (!name.valid) throw new ValidationError(name.error, { name: name.error });
    patch.name = merged.name = name.value;
  }
  if ('categoryId' in changes) patch.categoryId = merged.categoryId = changes.categoryId;
  if ('design' in changes && inv.creationType === 'created') patch.design = merged.design = sanitizeDesign(changes.design);
  if ('files' in changes && inv.creationType === 'uploaded') patch.files = merged.files = (changes.files || []).map(fileMeta);
  if ('viewMode' in changes && inv.creationType === 'uploaded') patch.viewMode = merged.viewMode = ['vertical', 'horizontal', 'flip'].includes(changes.viewMode) ? changes.viewMode : 'vertical';
  if ('thumbnail' in changes) patch.thumbnail = changes.thumbnail || null;

  const batch = writeBatch(db);
  batch.update(doc(db, 'invitations', inv.id), patch);
  if (inv.shareToken) {
    const { updatedAt, invitationId, ownerId, enabled, kind, ...rest } = shareSnapshot(merged, inv.sharingEnabled);
    batch.update(doc(db, 'shares', inv.shareToken), { updatedAt, name: merged.name, ...(rest.design ? { design: rest.design } : { files: rest.files, viewMode: rest.viewMode }) });
  }
  await batch.commit();
  return { ...inv, ...patch, updatedAt: Date.now() };
}

/** Deletes the invitation, its share link (revoked instantly) and all stored files. */
export async function deleteInvitation(inv) {
  const batch = writeBatch(db);
  if (inv.shareToken) batch.delete(doc(db, 'shares', inv.shareToken));
  batch.delete(doc(db, 'invitations', inv.id));
  await batch.commit();
  const paths = inv.files?.length ? inv.files.map((f) => f.path) : inv.file?.path ? [inv.file.path] : [];
  await Promise.all(paths.map(deleteFile));
}

/* ---------------------------------------------------------------- sharing */

/** Turn link access on/off. First enable mints a random token; later toggles keep the same link. */
export async function setSharing(inv, enabled) {
  const batch = writeBatch(db);
  let token = inv.shareToken;
  if (enabled && !token) {
    token = generateToken();
    batch.set(doc(db, 'shares', token), { ...shareSnapshot(inv, true), createdAt: serverTimestamp() });
  } else if (token) {
    batch.update(doc(db, 'shares', token), { enabled, updatedAt: serverTimestamp() });
  } else {
    return inv; // nothing to disable
  }
  batch.update(doc(db, 'invitations', inv.id), { sharingEnabled: enabled, shareToken: token, updatedAt: serverTimestamp() });
  await batch.commit();
  return { ...inv, sharingEnabled: enabled, shareToken: token };
}

/** Issue a brand-new link; the old one stops working immediately. */
export async function regenerateShareLink(inv) {
  const token = generateToken();
  const batch = writeBatch(db);
  if (inv.shareToken) batch.delete(doc(db, 'shares', inv.shareToken));
  batch.set(doc(db, 'shares', token), { ...shareSnapshot(inv, true), createdAt: serverTimestamp() });
  batch.update(doc(db, 'invitations', inv.id), { sharingEnabled: true, shareToken: token, updatedAt: serverTimestamp() });
  await batch.commit();
  return { ...inv, sharingEnabled: true, shareToken: token };
}

export function shareUrl(token) {
  const { origin, pathname } = window.location;
  return `${origin}${pathname}#/s/${token}`;
}

/** Public, no sign-in: fetch the shared snapshot by token. Resolves null when unavailable. */
export async function getShare(token) {
  if (!isPlausibleToken(token)) return null;
  try {
    const snap = await getDoc(doc(db, 'shares', token));
    if (!snap.exists()) return null;
    const share = snap.data();
    if (share.enabled !== true) return null;
    const files = share.kind === 'uploaded'
      ? (Array.isArray(share.files) ? share.files : share.file ? [share.file] : []).map(fileMeta)
      : [];
    return {
      kind: share.kind,
      name: share.name,
      design: share.kind === 'created' ? sanitizeDesign(share.design) : null,
      files,
      viewMode: share.viewMode || 'vertical',
      file: files[0] || null,
    };
  } catch (error) {
    if (isPermissionError(error)) return null; // disabled, deleted, or never existed — indistinguishable by design
    throw error;
  }
}
