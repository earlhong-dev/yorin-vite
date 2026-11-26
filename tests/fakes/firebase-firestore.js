// In-memory Firestore that enforces the same ownership / share semantics as firestore.rules.
const S = (window.__store ||= new Map()); // "collection/id" -> data
const uid = () => window.__auth?.user?.uid || null;
const err = (code, msg = code) => Object.assign(new Error(msg), { code });
const clone = (v) => JSON.parse(JSON.stringify(v));
let counter = 0;
const newId = () => `doc${Date.now().toString(36)}${(counter++).toString(36)}${Math.random().toString(36).slice(2, 8)}`;

export const getFirestore = () => ({});
export const serverTimestamp = () => ({ __ms: Date.now() });
const revive = (v) => {
  if (Array.isArray(v)) return v.map(revive);
  if (v && typeof v === 'object') {
    if ('__ms' in v) return { toMillis: () => v.__ms };
    return Object.fromEntries(Object.entries(v).map(([k, x]) => [k, revive(x)]));
  }
  return v;
};

export const collection = (_db, name) => ({ type: 'collection', name });
export const doc = (a, b, c) => {
  const path = a?.type === 'collection' ? `${a.name}/${b ?? newId()}` : `${b}/${c ?? newId()}`;
  return { type: 'doc', path, id: path.split('/')[1] };
};
export const where = (field, op, value) => ({ field, op, value });
export const query = (col, ...wheres) => ({ type: 'query', col, wheres });

const snap = (path) => {
  const data = S.get(path);
  return { id: path.split('/')[1], exists: () => data !== undefined, data: () => revive(clone(data)) };
};

function check(op, path, existing, incoming) {
  const [coll, id] = path.split('/');
  const me = uid();
  const owner = (d) => me && d && d.ownerId === me;
  const deny = () => { throw err('permission-denied', `Missing or insufficient permissions (${op} ${path})`); };
  if (coll === 'users') { if (id !== me) deny(); return; }
  if (['events', 'categories', 'invitations'].includes(coll)) {
    if (op === 'get') { if (!owner(existing)) deny(); }
    else if (op === 'create') {
      if (!owner(incoming)) deny();
      // cross-document checks mirrored from firestore.rules
      if (coll === 'categories' && !owner(S.get(`events/${incoming.eventId}`))) deny();
      if (coll === 'invitations') {
        const cat = S.get(`categories/${incoming.categoryId}`);
        if (!owner(S.get(`events/${incoming.eventId}`)) || !owner(cat) || cat.eventId !== incoming.eventId) deny();
      }
    }
    else if (op === 'update') {
      if (!owner(existing) || incoming.ownerId !== existing.ownerId) deny();
      if (coll !== 'events' && incoming.eventId !== existing.eventId) deny();
      if (coll === 'invitations') {
        const cat = S.get(`categories/${incoming.categoryId}`);
        if (!owner(cat) || cat.eventId !== incoming.eventId) deny();
      }
    }
    else if (op === 'delete') { if (!owner(existing)) deny(); }
    return;
  }
  if (coll === 'shares') {
    if (op === 'get') { if (!(existing && (existing.enabled === true || owner(existing)))) deny(); }
    else if (op === 'create') { if (!owner(incoming) || id.length < 32 || !owner(S.get(`invitations/${incoming.invitationId}`))) deny(); }
    else if (op === 'update') { if (!owner(existing)) deny(); }
    else if (op === 'delete') { if (existing && !owner(existing)) deny(); }
    return;
  }
  deny();
}

export const getDoc = async (ref) => { check('get', ref.path, S.get(ref.path)); return snap(ref.path); };

export const getDocs = async (q) => {
  const [coll] = [q.col.name];
  const me = uid();
  // Firestore rejects queries that could return documents the rules wouldn't allow.
  if (!q.wheres.some((w) => w.field === 'ownerId' && w.op === '==' && w.value === me) || !me) {
    throw err('permission-denied', 'Query not constrained to the signed-in owner');
  }
  const docs = [...S.entries()].filter(([p, d]) => p.startsWith(`${coll}/`) && q.wheres.every((w) => d[w.field] === w.value));
  return { empty: docs.length === 0, docs: docs.map(([p]) => snap(p)) };
};

const apply = (op) => {
  const existing = S.get(op.path);
  if (op.kind === 'set') {
    if (op.merge && existing) { check('update', op.path, existing, { ...existing, ...op.data }); S.set(op.path, { ...existing, ...clone(op.data) }); }
    else { check(existing ? 'update' : 'create', op.path, existing, op.data); S.set(op.path, clone(op.data)); }
  } else if (op.kind === 'update') {
    if (!existing) throw err('not-found');
    const merged = { ...existing, ...clone(op.data) };
    check('update', op.path, existing, merged);
    S.set(op.path, merged);
  } else if (op.kind === 'delete') { check('delete', op.path, existing); S.delete(op.path); }
};
const dryRun = (ops) => { const backup = new Map(S); try { ops.forEach(apply); } catch (e) { S.clear(); backup.forEach((v, k) => S.set(k, v)); throw e; } };

export const setDoc = async (ref, data, opts = {}) => dryRun([{ kind: 'set', path: ref.path, data, merge: opts.merge }]);
export const updateDoc = async (ref, data) => dryRun([{ kind: 'update', path: ref.path, data }]);
export const deleteDoc = async (ref) => dryRun([{ kind: 'delete', path: ref.path }]);
export const writeBatch = () => {
  const ops = [];
  const api = {
    set: (ref, data, opts = {}) => (ops.push({ kind: 'set', path: ref.path, data, merge: opts.merge }), api),
    update: (ref, data) => (ops.push({ kind: 'update', path: ref.path, data }), api),
    delete: (ref) => (ops.push({ kind: 'delete', path: ref.path }), api),
    commit: async () => { if (ops.length > 500) throw err('invalid-argument', 'batch too large'); dryRun(ops); },
  };
  return api;
};
