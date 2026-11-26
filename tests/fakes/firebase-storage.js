// In-memory Cloud Storage enforcing storage.rules semantics (owner write; owner-or-shared read).
const F = (window.__files ||= new Map());
const err = (code) => Object.assign(new Error(code), { code });
const me = () => window.__auth?.user?.uid || null;

export const getStorage = () => ({});
export const ref = (_s, path) => ({ path });

function parts(path) {
  const m = /^invitations\/([^/]+)\/([^/]+)\/(file-[0-9a-f]{32}\.(pdf|jpg|png|webp|gif|avif|bmp))$/.exec(path);
  return m ? { owner: m[1], invId: m[2] } : null;
}

export const uploadBytesResumable = (r, file, meta) => {
  const p = parts(r.path);
  let handlers = {};
  const task = { on: (_evt, progress, error, done) => (handlers = { progress, error, done }) };
  setTimeout(async () => {
    try {
      if (!p || p.owner !== me()) throw err('storage/unauthorized');
      if (!/^(application\/pdf|image\/(jpeg|png|webp|gif|avif|bmp))$/.test(meta?.contentType || '')) throw err('storage/unauthorized');
      if (file.size > 15 * 1024 * 1024) throw err('storage/unauthorized');
      handlers.progress?.({ bytesTransferred: file.size / 2, totalBytes: file.size });
      F.set(r.path, { buf: await file.arrayBuffer(), type: meta.contentType });
      handlers.progress?.({ bytesTransferred: file.size, totalBytes: file.size });
      handlers.done?.();
    } catch (e) { handlers.error?.(e); }
  }, 10);
  return task;
};

export const getBytes = async (r) => {
  const p = parts(r.path);
  if (!p) throw err('storage/unauthorized');
  const inv = window.__store.get(`invitations/${p.invId}`);
  const allowed = p.owner === me() || (inv && inv.sharingEnabled === true && inv.ownerId === p.owner);
  if (!allowed) throw err('storage/unauthorized');
  const f = F.get(r.path);
  if (!f) throw err('storage/object-not-found');
  return f.buf.slice(0);
};

export const deleteObject = async (r) => {
  const p = parts(r.path);
  if (!p || p.owner !== me()) throw err('storage/unauthorized');
  if (!F.delete(r.path)) throw err('storage/object-not-found');
};
