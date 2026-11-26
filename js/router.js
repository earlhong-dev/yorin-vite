// Hash-based router (works on any static host, and keeps share tokens out of server logs
// because the part after # is never sent to the server).
//
// Route access:
//   auth: 'required' → must be signed in, otherwise bounced to the landing page
//   auth: 'public'   → anyone, even signed-out (the shared-invitation viewer)
//   auth: 'any'      → landing page; works either way

import { getUser, initAuth } from './services/auth.js';
import { findRoute, parseHash } from './lib/route-match.js';
import { clear, h, toast } from './ui/dom.js';

export const routes = [
  { path: '/', auth: 'any', load: () => import('./pages/landing.js') },
  { path: '/dashboard', auth: 'required', load: () => import('./pages/dashboard.js') },
  { path: '/events/new', auth: 'required', load: () => import('./pages/event-new.js') },
  { path: '/events/:eventId', auth: 'required', load: () => import('./pages/event.js') },
  { path: '/events/:eventId/new/created', auth: 'required', load: () => import('./pages/editor.js') },
  { path: '/events/:eventId/new/upload', auth: 'required', load: () => import('./pages/upload.js') },
  { path: '/events/:eventId/invitations/:invitationId/edit', auth: 'required', load: () => import('./pages/invitation-edit.js') },
  { path: '/s/:token', auth: 'public', load: () => import('./pages/shared.js') },
];

let mountEl = null;
let current = null; // { destroy }
let renderId = 0;

export const navigate = (path, { replace = false } = {}) => {
  const hash = `#${path}`;
  if (replace) window.location.replace(hash);
  else window.location.hash = hash;
};

export const currentPath = () => parseHash(window.location.hash).path;

function setRobots(noindex) {
  let meta = document.querySelector('meta[name="robots"]');
  if (noindex) {
    if (!meta) {
      meta = h('meta', { name: 'robots', content: 'noindex, nofollow, noarchive' });
      document.head.append(meta);
    }
  } else meta?.remove();
}

function notFound() {
  return h(
    'main',
    { class: 'center-screen' },
    h('h1', { class: 'display-sm' }, 'Page not found'),
    h('p', { class: 'muted' }, 'That page doesn’t exist.'),
    h('a', { class: 'btn btn-primary', href: '#/' }, 'Go home'),
  );
}

export async function render() {
  const id = (renderId += 1);
  const { path, query } = parseHash(window.location.hash);
  const match = findRoute(routes, path);

  current?.destroy?.();
  current = null;
  window.scrollTo(0, 0);

  if (!match) {
    clear(mountEl).append(notFound());
    return;
  }

  const { route, params } = match;
  setRobots(route.auth === 'public');
  await initAuth();
  if (id !== renderId) return;
  const user = getUser();

  if (route.auth === 'required' && !user) {
    toast('Please sign in to continue.', 'info');
    navigate('/', { replace: true });
    return;
  }

  clear(mountEl).append(h('div', { class: 'page-loading' }, h('div', { class: 'spinner', role: 'status', 'aria-label': 'Loading' })));

  try {
    const module = await route.load();
    if (id !== renderId) return;
    const result = await module.default({ params, query, user, navigate });
    if (id !== renderId) {
      result?.destroy?.();
      return;
    }
    current = result;
    clear(mountEl).append(result.el);
    document.title = result.title ? `${result.title} · Yorin.vite` : 'Yorin.vite — Online invitations';
  } catch (error) {
    if (id !== renderId) return;
    console.error('Page failed to load', error);
    clear(mountEl).append(
      h(
        'main',
        { class: 'center-screen' },
        h('h1', { class: 'display-sm' }, 'Something went wrong'),
        h('p', { class: 'muted' }, 'This page couldn’t be loaded. Check your connection and try again.'),
        h('button', { class: 'btn btn-primary', type: 'button', onclick: () => render() }, 'Try again'),
      ),
    );
  }
}

export function startRouter(el) {
  mountEl = el;
  window.addEventListener('hashchange', render);
  return render();
}
