// Google-Drive-style sharing dialog. Opening it for the first time creates the link; the
// toggle turns access on/off instantly; "Reset link" issues a new random link and kills the old one.

import { describeDbError, regenerateShareLink, setSharing, shareUrl } from '../services/db.js';
import { button, confirmDialog, h, icon, openModal, toast } from './dom.js';

async function copyText(text, inputEl) {
  try {
    await navigator.clipboard.writeText(text);
    return true;
  } catch {
    try {
      inputEl.removeAttribute('readonly');
      inputEl.select();
      inputEl.setSelectionRange(0, text.length);
      const ok = document.execCommand('copy');
      inputEl.setAttribute('readonly', '');
      return ok;
    } catch {
      return false;
    }
  }
}

/**
 * @param {object} inv       the invitation (must belong to the signed-in user)
 * @param {(updated:object)=>void} onChange  called whenever the invitation's sharing state changes
 */
export async function openShareDialog(inv, onChange) {
  let state = inv;
  const host = h('div', { class: 'share' });
  const modal = openModal({ title: `Share “${inv.name}”`, content: host, size: 'md' });

  const apply = (next) => {
    state = next;
    onChange?.(next);
    paint();
  };

  async function run(fn, successMsg) {
    try {
      apply(await fn());
      if (successMsg) toast(successMsg, 'success');
    } catch (error) {
      console.error(error);
      toast(describeDbError(error), 'error');
      paint();
    }
  }

  function paint() {
    const enabled = state.sharingEnabled === true && !!state.shareToken;
    const url = state.shareToken ? shareUrl(state.shareToken) : '';

    const toggle = h('input', { type: 'checkbox', role: 'switch', class: 'switch-input', id: 'share-toggle', checked: enabled, 'aria-checked': String(enabled) });
    toggle.addEventListener('change', () => {
      toggle.disabled = true;
      run(() => setSharing(state, toggle.checked), toggle.checked ? 'Link sharing turned on.' : 'Link sharing turned off — the link no longer works.');
    });

    const children = [
      h(
        'div',
        { class: 'share-toggle-row' },
        h('span', { class: `share-icon ${enabled ? 'on' : ''}` }, icon(enabled ? 'globe' : 'lock', 20)),
        h('div', { class: 'share-toggle-text' }, h('label', { for: 'share-toggle', class: 'share-title' }, enabled ? 'Anyone with the link can view' : 'Link sharing is off'), h('p', { class: 'muted small' }, enabled ? 'No sign-in needed. They see only this invitation.' : 'Only you can see this invitation right now.')),
        h('span', { class: 'switch' }, toggle, h('span', { class: 'switch-track' })),
      ),
    ];

    if (state.shareToken) {
      const input = h('input', { class: 'input mono', type: 'text', readonly: true, value: url, 'aria-label': 'Invitation link', disabled: !enabled });
      const copyBtn = button({ label: 'Copy link', icon: 'copy', variant: 'primary' });
      copyBtn.disabled = !enabled;
      copyBtn.addEventListener('click', async () => {
        const ok = await copyText(url, input);
        toast(ok ? 'Link copied to clipboard.' : 'Couldn’t copy automatically — select the link and copy it.', ok ? 'success' : 'error');
      });
      input.addEventListener('focus', () => enabled && input.select());

      children.push(h('div', { class: `share-link ${enabled ? '' : 'is-off'}` }, input, copyBtn));

      const extra = [];
      if (enabled && navigator.share) {
        extra.push(button({ label: 'Share…', icon: 'share', variant: 'secondary', size: 'sm', onClick: () => navigator.share({ title: state.name, url }).catch(() => {}) }));
      }
      if (enabled) extra.push(h('a', { class: 'btn btn-secondary btn-sm', href: url, target: '_blank', rel: 'noopener noreferrer' }, icon('external', 16), h('span', { class: 'btn-label' }, 'Open')));
      extra.push(
        button({
          label: 'Reset link',
          icon: 'refresh',
          variant: 'ghost',
          size: 'sm',
          title: 'Create a new link and disable the old one',
          onClick: async () => {
            const ok = await confirmDialog({
              title: 'Reset this link?',
              message: 'A new link will be created and the current one will stop working immediately. Anyone using the old link will lose access.',
              confirmLabel: 'Reset link',
              danger: true,
            });
            if (ok) run(() => regenerateShareLink(state), 'New link created. The old link no longer works.');
          },
        }),
      );
      children.push(h('div', { class: 'share-extra' }, ...extra));
    }

    children.push(h('p', { class: 'muted small share-note' }, 'The link is private and unlisted — it can’t be found by searching. Deleting the invitation also deletes the link.'));
    host.replaceChildren(...children);
  }

  if (!state.shareToken || state.sharingEnabled !== true) {
    // First share: generate the link right away (Drive-style).
    if (!state.shareToken) {
      host.replaceChildren(h('div', { class: 'pdf-status muted' }, 'Creating your private link…'));
      await run(() => setSharing(state, true));
      return modal;
    }
  }
  paint();
  return modal;
}
