// Landing page: logo + Sign In in the header, big "Yorin.vite" title and "Start Your Event".

import { sampleDesign } from '../lib/design.js';
import { getUser, signIn } from '../services/auth.js';
import { brand, avatar } from '../ui/shell.js';
import { alertDialog, button, h, setBusy, toast } from '../ui/dom.js';
import { renderInvitation } from '../ui/render-invitation.js';

function setAfterLogin(active = true) {
  try {
    if (active) sessionStorage.setItem('yorin:afterLogin', '1');
    else sessionStorage.removeItem('yorin:afterLogin');
  } catch {
    /* optional */
  }
}

export default async function landing({ navigate, user }) {
  let busy = false;

  /** Signed in → dashboard. Otherwise → Google sign-in, then dashboard. */
  async function start(btn) {
    if (busy) return;
    if (getUser()) {
      navigate('/dashboard');
      return;
    }
    busy = true;
    setBusy(btn, true, 'Signing in…');
    try {
      setAfterLogin(true);
      const signedIn = await signIn();
      if (signedIn) {
        navigate('/dashboard');
      } else if (signedIn === null) {
        setAfterLogin(false);
        await alertDialog({
          title: 'Sign in required',
          message: 'You need to sign in to create an event.',
          confirmLabel: 'Okay',
          dismissible: false,
        });
        window.location.reload();
      }
    } catch (error) {
      setAfterLogin(false);
      toast(error.message, 'error', 7000);
    } finally {
      busy = false;
      if (btn.isConnected) setBusy(btn, false);
    }
  }

  const headerBtn = user
    ? h('a', { class: 'btn btn-secondary btn-sm', href: '#/dashboard' }, avatar(user), h('span', { class: 'btn-label' }, 'My dashboard'))
    : button({ label: 'Sign In', variant: 'secondary', size: 'sm', onClick: (e) => start(e.currentTarget) });

  const startBtn = button({ label: 'Start Your Event', variant: 'primary', size: 'lg', className: 'btn-hero', onClick: (e) => start(e.currentTarget) });

  const floating = ['blush-romance', 'golden-classic', 'midnight-gala'].map((id, i) =>
    h('div', { class: `float-card float-${i + 1}`, 'aria-hidden': 'true' }, renderInvitation(sampleDesign(id))),
  );

  const el = h(
    'div',
    { class: 'landing' },
    h('header', { class: 'landing-header' }, brand('#/'), headerBtn),
    h(
      'main',
      { class: 'hero' },
      ...floating,
      h(
        'div',
        { class: 'hero-center' },
        h('p', { class: 'eyebrow' }, 'Invitations, beautifully shared'),
        h('h1', { class: 'hero-title' }, 'Yorin.vite'),
        h('p', { class: 'hero-sub' }, 'Design or upload your invitations, sort them by guest group, and share each one with its own private link.'),
        startBtn,
        h('p', { class: 'muted small hero-note' }, 'Free to start · Sign in with Google'),
      ),
    ),
  );

  return { el, title: '' };
}
