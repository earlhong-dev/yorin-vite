// Saved-invitation card and the full-size preview dialog.

import { fetchFileBlob } from '../services/storage.js';
import { button, h, icon, openModal } from './dom.js';
import { createMultiFileViewer } from './file-viewer.js';
import { renderInvitation } from './render-invitation.js';

function thumbnail(inv) {
  if (inv.creationType === 'created') {
    return h('div', { class: 'thumb thumb-created' }, renderInvitation(inv.design, { label: `Preview of ${inv.name}` }));
  }
  const files = inv.files?.length ? inv.files : inv.file ? [inv.file] : [];
  const first = files[0];
  const moreBadge = files.length > 1 ? h('span', { class: 'thumb-more', title: `${files.length} files` }, `+${files.length - 1}`) : null;
  if (inv.thumbnail) {
    return h('div', { class: 'thumb thumb-upload' }, h('img', { src: inv.thumbnail, alt: `Preview of ${inv.name}`, loading: 'lazy' }), moreBadge);
  }
  const isPdf = first?.kind === 'pdf';
  return h('div', { class: 'thumb thumb-upload thumb-placeholder' }, icon(isPdf ? 'file' : 'image', 40), h('span', {}, isPdf ? 'PDF' : 'Image'), moreBadge);
}

export function invitationCard(inv, categoryName, { onShare, onEdit, onDelete, onPreview }) {
  void categoryName;
  const open = h('button', { class: 'thumb-button', type: 'button', 'aria-label': `Preview ${inv.name}`, onclick: () => onPreview(inv) }, thumbnail(inv));

  return h(
    'article',
    { class: 'card inv-card', dataset: { invitationId: inv.id } },
    open,
    h(
      'div',
      { class: 'inv-card-body' },
      h('h4', { class: 'inv-card-name', title: inv.name }, inv.name),
      h(
        'div',
        { class: 'card-actions' },
        button({ icon: 'edit', variant: 'ghost', size: 'sm', onClick: () => onEdit(inv), ariaLabel: `Edit ${inv.name}`, title: 'Edit invitation' }),
        button({ icon: 'trash', variant: 'ghost-danger', size: 'sm', onClick: () => onDelete(inv), ariaLabel: `Delete ${inv.name}`, title: 'Delete invitation' }),
        button({ icon: 'share', variant: 'ghost', size: 'sm', className: 'card-share-btn', onClick: () => onShare(inv), ariaLabel: `Share ${inv.name}`, title: 'Share invitation' }),
      ),
    ),
  );
}

/** Full-size preview of a saved invitation (owner view). */
export function openInvitationPreview(inv) {
  let viewer = null;
  const host = h('div', { class: 'preview-host' });
  const modal = openModal({
    title: inv.name,
    size: 'fit',
    content: host,
    onClose: () => viewer?.destroy?.(),
  });

  if (inv.creationType === 'created') {
    host.append(h('div', { class: 'preview-created' }, renderInvitation(inv.design)));
    return modal;
  }

  const files = inv.files?.length ? inv.files : inv.file ? [inv.file] : [];
  if (!files.length) {
    host.append(h('p', { class: 'muted' }, 'No files attached.'));
    return modal;
  }

  host.append(h('div', { class: 'pdf-status muted' }, 'Loading…'));
  Promise.all(files.map((f) => fetchFileBlob(f.path, f.contentType).then((blob) => ({ blob, kind: f.kind, name: f.name || inv.name }))))
    .then((loaded) => {
      if (!host.isConnected) return;
      viewer = createMultiFileViewer(loaded, { defaultLayout: inv.viewMode || 'vertical' });
      host.replaceChildren(viewer.el);
    })
    .catch((error) => {
      host.replaceChildren(h('p', { class: 'field-error' }, error.message || 'Couldn’t load the file.'));
    });
  return modal;
}
