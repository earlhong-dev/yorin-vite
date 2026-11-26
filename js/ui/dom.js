// Tiny DOM toolkit: element builder, icons, toasts, modals. No innerHTML with user data anywhere —
// text always goes through text nodes / textContent, so user-entered strings can't inject markup.

export function h(tag, props = {}, ...children) {
  const el = document.createElement(tag);
  for (const [key, value] of Object.entries(props || {})) {
    if (value == null || value === false) continue;
    if (key === 'class') el.className = value;
    else if (key === 'dataset') Object.assign(el.dataset, value);
    else if (key === 'style' && typeof value === 'object') {
      for (const [k, v] of Object.entries(value)) {
        if (k.startsWith('--')) el.style.setProperty(k, v);
        else el.style[k] = v;
      }
    } else if (key.startsWith('on') && typeof value === 'function') el.addEventListener(key.slice(2).toLowerCase(), value);
    else if (key === 'value') el.value = value;
    else if (value === true) el.setAttribute(key, '');
    else el.setAttribute(key, String(value));
  }
  append(el, children);
  return el;
}

export function append(parent, children) {
  for (const child of children.flat(Infinity)) {
    if (child == null || child === false) continue;
    parent.append(child instanceof Node ? child : document.createTextNode(String(child)));
  }
  return parent;
}

export const clear = (el) => {
  el.replaceChildren();
  return el;
};

/* ------------------------------------------------------------------ icons */

const ICONS = {
  plus: '<path d="M12 5v14M5 12h14"/>',
  x: '<path d="M18 6 6 18M6 6l12 12"/>',
  check: '<path d="M20 6 9 17l-5-5"/>',
  trash: '<path d="M3 6h18M8 6V4h8v2M19 6l-1 14H6L5 6M10 11v6M14 11v6"/>',
  edit: '<path d="M12 20h9"/><path d="M16.5 3.5a2.1 2.1 0 0 1 3 3L7 19l-4 1 1-4Z"/>',
  share: '<circle cx="18" cy="5" r="3"/><circle cx="6" cy="12" r="3"/><circle cx="18" cy="19" r="3"/><path d="m8.6 13.5 6.8 4M15.4 6.5l-6.8 4"/>',
  link: '<path d="M10 13a5 5 0 0 0 7.5.5l3-3a5 5 0 0 0-7-7l-1.7 1.7"/><path d="M14 11a5 5 0 0 0-7.5-.5l-3 3a5 5 0 0 0 7 7l1.7-1.7"/>',
  copy: '<rect x="9" y="9" width="13" height="13" rx="2"/><path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1"/>',
  calendar: '<rect x="3" y="4" width="18" height="18" rx="2"/><path d="M16 2v4M8 2v4M3 10h18"/>',
  pin: '<path d="M21 10c0 7-9 13-9 13S3 17 3 10a9 9 0 0 1 18 0Z"/><circle cx="12" cy="10" r="3"/>',
  upload: '<path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4M17 8l-5-5-5 5M12 3v12"/>',
  file: '<path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8Z"/><path d="M14 2v6h6"/>',
  image: '<rect x="3" y="3" width="18" height="18" rx="2"/><circle cx="8.5" cy="8.5" r="1.5"/><path d="m21 15-5-5L5 21"/>',
  back: '<path d="M19 12H5M12 19l-7-7 7-7"/>',
  logout: '<path d="M9 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h4M16 17l5-5-5-5M21 12H9"/>',
  eye: '<path d="M2 12s3.5-7 10-7 10 7 10 7-3.5 7-10 7S2 12 2 12Z"/><circle cx="12" cy="12" r="3"/>',
  lock: '<rect x="4" y="11" width="16" height="10" rx="2"/><path d="M8 11V7a4 4 0 0 1 8 0v4"/>',
  globe: '<circle cx="12" cy="12" r="10"/><path d="M2 12h20M12 2a15 15 0 0 1 0 20M12 2a15 15 0 0 0 0 20"/>',
  folder: '<path d="M3 7a2 2 0 0 1 2-2h4l2 2h8a2 2 0 0 1 2 2v8a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2Z"/>',
  alert: '<path d="M10.3 3.9 1.8 18a2 2 0 0 0 1.7 3h17a2 2 0 0 0 1.7-3L13.7 3.9a2 2 0 0 0-3.4 0Z"/><path d="M12 9v4M12 17h.01"/>',
  sparkle: '<path d="m12 3 1.9 5.1L19 10l-5.1 1.9L12 17l-1.9-5.1L5 10l5.1-1.9Z"/><path d="M19 17v4M17 19h4"/>',
  refresh: '<path d="M21 12a9 9 0 0 1-15.4 6.4L3 16M3 12a9 9 0 0 1 15.4-6.4L21 8M21 3v5h-5M3 21v-5h5"/>',
  external: '<path d="M18 13v6a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h6M15 3h6v6M10 14 21 3"/>',
  chevronLeft: '<path d="m15 18-6-6 6-6"/>',
  chevronRight: '<path d="m9 18 6-6-6-6"/>',
};

export function icon(name, size = 18) {
  const span = document.createElement('span');
  span.className = 'icon';
  span.setAttribute('aria-hidden', 'true');
  span.innerHTML = `<svg viewBox="0 0 24 24" width="${size}" height="${size}" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round">${ICONS[name] || ''}</svg>`;
  return span;
}

/* ---------------------------------------------------------------- buttons */

/** Button with an optional icon and a built-in busy state. */
export function button({ label, icon: iconName, variant = 'primary', size, onClick, type = 'button', title, ariaLabel, className = '' }) {
  const btn = h('button', { type, class: `btn btn-${variant}${size ? ` btn-${size}` : ''} ${className}`.trim(), title, 'aria-label': ariaLabel });
  if (iconName) btn.append(icon(iconName));
  if (label) btn.append(h('span', { class: 'btn-label' }, label));
  if (onClick) btn.addEventListener('click', onClick);
  return btn;
}

export function setBusy(btn, busy, busyLabel) {
  if (!btn) return;
  const label = btn.querySelector('.btn-label');
  if (busy) {
    btn.dataset.busy = '1';
    btn.disabled = true;
    btn.classList.add('is-busy');
    if (label && busyLabel) {
      btn.dataset.label = label.textContent;
      label.textContent = busyLabel;
    }
  } else {
    delete btn.dataset.busy;
    btn.disabled = false;
    btn.classList.remove('is-busy');
    if (label && btn.dataset.label) {
      label.textContent = btn.dataset.label;
      delete btn.dataset.label;
    }
  }
}

/** Runs an async handler with the button disabled and relabelled; guards against double-clicks. */
export function withBusy(btn, busyLabel, handler) {
  return async (event) => {
    if (btn.dataset.busy) return;
    setBusy(btn, true, busyLabel);
    try {
      await handler(event);
    } finally {
      if (btn.isConnected) setBusy(btn, false);
    }
  };
}

/* ----------------------------------------------------------------- toasts */

export function toast(message, type = 'info', duration = 4200) {
  const host = document.getElementById('toasts');
  if (!host) return;
  const el = h(
    'div',
    { class: `toast toast-${type}`, role: type === 'error' ? 'alert' : 'status' },
    icon(type === 'success' ? 'check' : type === 'error' ? 'alert' : 'sparkle', 18),
    h('span', {}, message),
  );
  host.append(el);
  requestAnimationFrame(() => el.classList.add('in'));
  const remove = () => {
    el.classList.remove('in');
    setTimeout(() => el.remove(), 250);
  };
  const timer = setTimeout(remove, duration);
  el.addEventListener('click', () => {
    clearTimeout(timer);
    remove();
  });
}

/* ----------------------------------------------------------------- modals */

let modalDepth = 0;

/**
 * openModal({ title, content, size, dismissible, onClose }) → { el, close, setContent }
 * Escape and backdrop-click close it (unless dismissible:false). Focus is restored on close.
 */
export function openModal({ title, content, size = 'md', dismissible = true, onClose, labelledBy } = {}) {
  const previouslyFocused = document.activeElement;
  const titleId = `modal-title-${Math.random().toString(36).slice(2, 8)}`;
  const body = h('div', { class: 'modal-body' }, content);
  const closeBtn = dismissible ? h('button', { class: 'icon-btn modal-close', type: 'button', 'aria-label': 'Close' }, icon('x')) : null;
  const dialog = h(
    'div',
    { class: `modal modal-${size}`, role: 'dialog', 'aria-modal': 'true', 'aria-labelledby': title ? titleId : labelledBy, tabindex: '-1' },
    title || closeBtn ? h('div', { class: 'modal-head' }, title ? h('h2', { id: titleId }, title) : h('span'), closeBtn) : null,
    body,
  );
  const overlay = h('div', { class: 'overlay' }, dialog);
  let closed = false;

  const onKey = (e) => {
    if (e.key === 'Escape' && dismissible && overlay === topOverlay()) {
      e.stopPropagation();
      close();
    } else if (e.key === 'Tab' && overlay === topOverlay()) {
      const focusable = [...dialog.querySelectorAll('a[href],button:not([disabled]),input:not([disabled]),select:not([disabled]),textarea:not([disabled]),[tabindex]:not([tabindex="-1"])')].filter((n) => n.offsetParent !== null);
      if (!focusable.length) return;
      const first = focusable[0];
      const last = focusable[focusable.length - 1];
      if (e.shiftKey && document.activeElement === first) {
        e.preventDefault();
        last.focus();
      } else if (!e.shiftKey && document.activeElement === last) {
        e.preventDefault();
        first.focus();
      }
    }
  };

  function close() {
    if (closed) return;
    closed = true;
    overlay.dataset.closing = '1'; // stops it counting as the "top" dialog while it fades out
    document.removeEventListener('keydown', onKey, true);
    overlay.classList.remove('in');
    modalDepth -= 1;
    if (modalDepth <= 0) {
      modalDepth = 0;
      document.body.classList.remove('modal-open');
    }
    setTimeout(() => overlay.remove(), 180);
    if (previouslyFocused && previouslyFocused.isConnected) previouslyFocused.focus?.();
    onClose?.();
  }

  closeBtn?.addEventListener('click', close);
  if (dismissible) {
    let downOnOverlay = false;
    overlay.addEventListener('mousedown', (e) => (downOnOverlay = e.target === overlay));
    overlay.addEventListener('click', (e) => {
      if (e.target === overlay && downOnOverlay) close();
    });
  }
  document.addEventListener('keydown', onKey, true);
  document.body.append(overlay);
  document.body.classList.add('modal-open');
  modalDepth += 1;
  requestAnimationFrame(() => {
    overlay.classList.add('in');
    const autofocus = dialog.querySelector('[autofocus]');
    (autofocus || dialog).focus();
  });

  return {
    el: dialog,
    close,
    setContent: (next) => {
      clear(body);
      append(body, [next]);
    },
  };
}

function topOverlay() {
  const all = document.querySelectorAll('.overlay:not([data-closing])');
  return all[all.length - 1];
}

/** Promise-based notice dialog with a single action button. Resolves when dismissed. */
export function alertDialog({ title, message, confirmLabel = 'Okay', dismissible = true }) {
  return new Promise((resolve) => {
    let settled = false;
    const settle = () => {
      if (settled) return;
      settled = true;
      resolve();
    };
    const okBtn = button({ label: confirmLabel, variant: 'primary', onClick: () => { settle(); modal.close(); } });
    okBtn.setAttribute('autofocus', '');
    const modal = openModal({
      title,
      size: 'sm',
      dismissible,
      onClose: settle,
      content: [
        h('p', { class: 'muted' }, message),
        h('div', { class: 'modal-actions' }, okBtn),
      ],
    });
  });
}

/** Promise-based confirmation. Resolves true/false. */
export function confirmDialog({ title, message, confirmLabel = 'Confirm', cancelLabel = 'Cancel', danger = false }) {
  return new Promise((resolve) => {
    let settled = false;
    const settle = (value) => {
      if (settled) return;
      settled = true;
      resolve(value);
    };
    const confirmBtn = button({ label: confirmLabel, variant: danger ? 'danger' : 'primary', onClick: () => { settle(true); modal.close(); } });
    confirmBtn.setAttribute('autofocus', '');
    const modal = openModal({
      title,
      size: 'sm',
      onClose: () => settle(false),
      content: [
        h('p', { class: 'muted' }, message),
        h('div', { class: 'modal-actions' }, button({ label: cancelLabel, variant: 'ghost', onClick: () => modal.close() }), confirmBtn),
      ],
    });
  });
}

/** Single-field prompt. Resolves the entered value or null if cancelled. `validate(value)` returns an error string or ''. */
export function promptDialog({ title, label, placeholder = '', confirmLabel = 'Save', maxLength = 100, validate, initial = '' }) {
  return new Promise((resolve) => {
    let settled = false;
    const settle = (v) => {
      if (!settled) {
        settled = true;
        resolve(v);
      }
    };
    const input = h('input', { class: 'input', type: 'text', maxlength: maxLength, placeholder, value: initial, autofocus: true, id: 'prompt-input' });
    const error = h('p', { class: 'field-error', role: 'alert' });
    const submit = () => {
      const value = input.value.trim();
      const problem = validate ? validate(value) : value ? '' : 'This field is required.';
      if (problem) {
        error.textContent = problem;
        input.classList.add('invalid');
        input.focus();
        return;
      }
      settle(value);
      modal.close();
    };
    const form = h(
      'form',
      { class: 'stack', onsubmit: (e) => { e.preventDefault(); submit(); } },
      h('label', { class: 'field' }, h('span', { class: 'label' }, label), input, error),
      h('div', { class: 'modal-actions' }, button({ label: 'Cancel', variant: 'ghost', onClick: () => modal.close() }), button({ label: confirmLabel, type: 'submit' })),
    );
    const modal = openModal({ title, size: 'sm', content: form, onClose: () => settle(null) });
  });
}
