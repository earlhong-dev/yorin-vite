import { isConfigured, missingConfig } from './config.js';
import { h } from './ui/dom.js';

const app = document.getElementById('app');

function showSetupScreen() {
  app.replaceChildren(
    h(
      'main',
      { class: 'center-screen setup' },
      h('div', { class: 'brand-mark' }, 'Yorin.vite'),
      h('h1', { class: 'display-sm' }, 'Almost there — connect Firebase & Supabase'),
      h('p', { class: 'muted' }, 'Yorin.vite uses Firebase for sign-in/database and Supabase for file storage.'),
      h(
        'ol',
        { class: 'setup-steps' },
        h('li', {}, 'Follow ', h('strong', {}, 'FIREBASE_SETUP.md'), ' and ', h('strong', {}, 'SUPABASE_SETUP.md'), '.'),
        h('li', {}, 'Copy ', h('code', {}, '.env.example'), ' to ', h('code', {}, '.env'), ' and fill in the missing keys/URLs.'),
        h('li', {}, 'Restart with ', h('code', {}, 'npm run dev'), '.'),
      ),
      h('p', { class: 'muted small' }, `Missing: ${missingConfig.join(', ')}`),
    ),
  );
}

async function boot() {
  if (!isConfigured) {
    showSetupScreen();
    return;
  }
  const [{ initAuth, onUserChange }, { startRouter, render, currentPath, navigate }] = await Promise.all([
    import('./services/auth.js'),
    import('./router.js'),
  ]);

  await initAuth();
  await startRouter(app);

  // React to sign-in / sign-out that happens after the first render (including redirect sign-in).
  onUserChange((user) => {
    const path = currentPath();
    if (user && path === '/' && sessionStorageGet('yorin:afterLogin')) {
      sessionStorageSet('yorin:afterLogin', '');
      navigate('/dashboard');
    } else if (!user && !path.startsWith('/s/')) {
      navigate('/', { replace: true });
      render();
    } else {
      render();
    }
  });
}

function sessionStorageGet(key) {
  try {
    return sessionStorage.getItem(key);
  } catch {
    return null;
  }
}
function sessionStorageSet(key, value) {
  try {
    sessionStorage.setItem(key, value);
  } catch {
    /* storage can be unavailable (private mode) — the flow still works without it */
  }
}

boot().catch((error) => {
  console.error('Failed to start', error);
  app.replaceChildren(
    h(
      'main',
      { class: 'center-screen' },
      h('h1', { class: 'display-sm' }, 'Couldn’t start Yorin.vite'),
      h('p', { class: 'muted' }, 'Please check your connection and reload the page.'),
      h('button', { class: 'btn btn-primary', type: 'button', onclick: () => location.reload() }, 'Reload'),
    ),
  );
});
