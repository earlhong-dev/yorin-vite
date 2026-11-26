// "Review & save" step: shows the finished invitation before anything is written,
// so both the editor and the upload flow give a preview prior to saving.

import { button, h, openModal, setBusy, toast } from './dom.js';

/**
 * @param {object} o
 * @param {Node}   o.preview     element showing the invitation
 * @param {string} o.name
 * @param {string} o.category
 * @param {string} o.typeLabel   "Created" | "Uploaded"
 * @param {() => Promise<void>} o.onConfirm   performs the save; throw to keep the dialog open
 */
export function openSaveReview({ preview, name, category, typeLabel, viewLabel = '', confirmLabel = 'Save invitation', extra = null, onConfirm, onDone, onClose }) {
  void typeLabel;
  const saveBtn = button({ label: confirmLabel, icon: 'check' });
  const backBtn = button({ label: 'Keep editing', variant: 'ghost', className: 'btn-keep-editing', onClick: () => modal.close() });

  saveBtn.addEventListener('click', async () => {
    if (saveBtn.dataset.busy) return;
    setBusy(saveBtn, true, 'Saving…');
    backBtn.disabled = true;
    try {
      await onConfirm();
      modal.close();
      onDone?.();
    } catch (error) {
      console.error(error);
      toast(error?.message || 'Couldn’t save the invitation. Please try again.', 'error');
      setBusy(saveBtn, false);
      backBtn.disabled = false;
    }
  });

  const modal = openModal({
    title: 'Preview before saving',
    size: 'lg',
    onClose,
    content: h(
      'div',
      { class: 'review' },
      h('div', { class: 'review-preview' }, preview),
      h(
        'div',
        { class: 'review-side' },
        h(
          'dl',
          { class: 'meta-list' },
          h('dt', {}, 'Name'),
          h('dd', {}, name),
          h('dt', {}, 'Guest list'),
          h('dd', {}, category),
          ...(viewLabel ? [h('dt', {}, 'Page view'), h('dd', {}, viewLabel)] : []),
        ),
        extra,
        h('div', { class: 'modal-actions stack-actions' }, saveBtn, backBtn),
      ),
    ),
  });
  return modal;
}
