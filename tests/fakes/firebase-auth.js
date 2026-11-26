// In-memory stand-in for Firebase Auth. window.__fakeUserId picks which Google account "signs in".
const A = (window.__auth ||= { user: null, listeners: new Set() });
const notify = () => A.listeners.forEach((fn) => fn(A.user));
export const getAuth = () => ({});
export class GoogleAuthProvider { setCustomParameters() {} }
export const onAuthStateChanged = (_auth, cb) => {
  A.listeners.add(cb);
  setTimeout(() => cb(A.user), 0);
  return () => A.listeners.delete(cb);
};
export const signInWithPopup = async () => {
  const id = window.__fakeUserId || 'u1';
  A.user = { uid: id, displayName: `Test ${id}`, email: `${id}@example.com`, photoURL: '' };
  setTimeout(notify, 0);
  return { user: A.user };
};
export const signInWithRedirect = signInWithPopup;
export const signOut = async () => { A.user = null; setTimeout(notify, 0); };
