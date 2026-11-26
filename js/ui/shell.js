// Shared page chrome: header with branding, account menu and sign-out.

import { initials } from '../lib/format.js';
import { signOut } from '../services/auth.js';
import { button, confirmDialog, h, icon, toast } from './dom.js';

export function brand(href = '#/') {
  return h('a', { class: 'brand', href, 'aria-label': 'Yorin.vite home' }, h('span', { class: 'brand-dot', 'aria-hidden': 'true' }, 'Y'), h('span', { class: 'brand-name' }, 'Yorin.vite'));
}

export function avatar(user) {
  if (user?.photoURL) {
    return h('img', { class: 'avatar', src: user.photoURL, alt: '', referrerpolicy: 'no-referrer', width: 36, height: 36 });
  }
  return h('span', { class: 'avatar avatar-fallback', 'aria-hidden': 'true' }, initials(user?.displayName || user?.email));
}

export function appHeader(user) {
  const out = button({
    label: 'Sign out',
    icon: 'logout',
    variant: 'ghost',
    size: 'sm',
    onClick: async () => {
      const ok = await confirmDialog({
        title: 'Sign out?',
        message: 'Are you sure you want to sign out of your account?',
        confirmLabel: 'Sign out',
        danger: true,
      });
      if (!ok) return;
      try {
        await signOut();
      } catch (error) {
        console.error(error);
        toast('Couldn’t sign out. Please try again.', 'error');
      }
    },
  });
  return h(
    'header',
    { class: 'app-header' },
    h(
      'div',
      { class: 'app-header-inner' },
      brand('#/dashboard'),
      h('div', { class: 'header-right' }, h('div', { class: 'user-chip', title: user.email }, avatar(user), h('span', { class: 'user-name' }, user.displayName || user.email)), out),
    ),
  );
}

/** Standard authenticated page: header + <main>. */
export function appPage(user, ...content) {
  return h('div', { class: 'app-page' }, appHeader(user), h('main', { class: 'container page-enter' }, ...content));
}

export function backLink(href, label) {
  return h('a', { class: 'back-link', href }, icon('back', 16), h('span', {}, label));
}

export function emptyState({ iconName = 'sparkle', title, text, action }) {
  return h('div', { class: 'empty' }, h('div', { class: 'empty-icon' }, icon(iconName, 28)), h('h3', {}, title), text ? h('p', { class: 'muted' }, text) : null, action || null);
}

export function errorState(message, onRetry) {
  return h(
    'div',
    { class: 'empty error-state', role: 'alert' },
    h('div', { class: 'empty-icon' }, icon('alert', 28)),
    h('h3', {}, 'Something went wrong'),
    h('p', { class: 'muted' }, message),
    onRetry ? button({ label: 'Try again', icon: 'refresh', variant: 'secondary', onClick: onRetry }) : null,
  );
}
