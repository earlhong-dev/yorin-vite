// Public, mobile-friendly viewer for ONE shared invitation. No sign-in, no navigation into the
// creator's account — it only ever receives the single share document for the token in the URL.

import { getShare } from '../services/db.js';
import { fetchFileBlob } from '../services/storage.js';
import { h, icon } from '../ui/dom.js';
import { createMultiFileViewer } from '../ui/file-viewer.js';
import { renderInvitation } from '../ui/render-invitation.js';

function unavailable() {
  return h(
    'main',
    { class: 'center-screen shared-unavailable' },
    h('div', { class: 'empty-icon' }, icon('lock', 28)),
    h('h1', { class: 'display-sm' }, 'This invitation isn’t available'),
    h('p', { class: 'muted' }, 'The link may have been turned off, replaced, or deleted by its owner. Please ask them for a new link.'),
  );
}

export default async function shared({ params }) {
  let viewer = null;
  const stage = h('div', { class: 'shared-stage' }, h('div', { class: 'spinner', role: 'status', 'aria-label': 'Loading invitation' }));
  const footer = h('footer', { class: 'shared-footer muted small' }, 'Made with ', h('a', { href: '#/', rel: 'noopener' }, 'Yorin.vite'));
  const el = h('div', { class: 'shared-page' }, stage, footer);

  (async () => {
    try {
      const share = await getShare(params.token);
      if (!share) {
        el.replaceChildren(unavailable());
        document.title = 'Invitation unavailable';
        return;
      }
      document.title = `${share.name} — Invitation`;
      if (share.kind === 'created') {
        stage.replaceChildren(h('div', { class: 'shared-invitation' }, renderInvitation(share.design, { label: share.name })));
        return;
      }
      const files = share.files?.length ? share.files : share.file ? [share.file] : [];
      const loaded = await Promise.all(files.map((f) => fetchFileBlob(f.path, f.contentType).then((blob) => ({ blob, kind: f.kind, name: f.name || share.name }))));
      viewer = createMultiFileViewer(loaded, { defaultLayout: share.viewMode || 'vertical' });
      const kindClass = files.length === 1 ? ` shared-file-${files[0].kind}` : '';
      stage.replaceChildren(h('div', { class: `shared-file${kindClass}` }, viewer.el));
    } catch (error) {
      console.error(error);
      stage.replaceChildren(
        h('div', { class: 'center-screen' }, h('h1', { class: 'display-sm' }, 'Couldn’t load the invitation'), h('p', { class: 'muted' }, 'Please check your connection and try again.'), h('button', { class: 'btn btn-primary', type: 'button', onclick: () => location.reload() }, 'Reload')),
      );
    }
  })();

  return { el, title: '', destroy: () => viewer?.destroy?.() };
}
