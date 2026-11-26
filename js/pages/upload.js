// Upload an existing invitation (PDF / image): drag-and-drop, validation, preview,
// replace / remove, category, review, and a progress-tracked secure upload.
// Supports up to MAX_FILES files per invitation.
// `mountUpload` is shared by "create" (this route) and "edit" (invitation-edit.js).

import { MAX_UPLOAD_BYTES, MAX_UPLOAD_MB } from '../config.js';
import { ACCEPTED_TYPES, ACCEPT_ATTRIBUTE, SUPPORTED_LABEL, inspectFile } from '../lib/filetype.js';
import { fileBaseName, formatBytes } from '../lib/format.js';
import { validateInvitationName } from '../lib/validate.js';
import {
  createInvitation, describeDbError, getEvent, isValidationError, listCategories, newInvitationId, updateInvitation,
} from '../services/db.js';
import { deleteFile, deleteFilesKeepalive, fetchFileBlob, uploadInvitationFile } from '../services/storage.js';
import { getSupabaseHeaders } from '../supabase.js';
import { createCategoryPicker } from '../ui/category-picker.js';
import { button, confirmDialog, h, icon, toast } from '../ui/dom.js';
import { createMultiFileViewer, imageThumbnail, pdfThumbnail } from '../ui/file-viewer.js';
import { openSaveReview } from '../ui/save-review.js';
import { appPage, backLink, errorState } from '../ui/shell.js';

const MAX_FILES = 10;
const THUMB_LIMIT = 140000;
const DRAFT_UPLOADS_KEY = 'yorin:draft-uploads';

function readDraftUploads() {
  try {
    const raw = sessionStorage.getItem(DRAFT_UPLOADS_KEY);
    return raw ? JSON.parse(raw) : [];
  } catch {
    return [];
  }
}

function writeDraftUploads(paths) {
  try {
    if (paths.length) sessionStorage.setItem(DRAFT_UPLOADS_KEY, JSON.stringify(paths));
    else sessionStorage.removeItem(DRAFT_UPLOADS_KEY);
  } catch {
    // ignore storage quota errors
  }
}

function trackDraftUpload(path) {
  const list = readDraftUploads();
  if (!list.includes(path)) writeDraftUploads([...list, path]);
}

function untrackDraftUpload(path) {
  writeDraftUploads(readDraftUploads().filter((p) => p !== path));
}

async function makeThumbnail(file, kind) {
  let dims = { width: 0, height: 0 };
  let dataUrl = null;
  for (const size of [480, 360, 240]) {
    if (kind === 'pdf') {
      dataUrl = await pdfThumbnail(file, size);
    } else {
      const r = await imageThumbnail(file, size);
      dataUrl = r.dataUrl;
      dims = { width: r.width, height: r.height };
    }
    if (!dataUrl || dataUrl.length < THUMB_LIMIT) break;
    dataUrl = null;
  }
  return { dataUrl, ...dims };
}

export function mountUpload({ user, event, categories, invitation, initialCategory, navigate }) {
  const editing = Boolean(invitation);

  // Each slot: { file, mime, kind, path, meta, thumbnail, status:'uploading'|'uploaded'|'error', cancelled, uploadPromise }
  let slots = [];
  let draftId = null;
  let saved = false;
  let name = editing ? invitation.name : '';
  let nameTouched = editing;
  let viewMode = editing && ['vertical', 'horizontal', 'flip'].includes(invitation.viewMode) ? invitation.viewMode : 'vertical';
  let dirty = false;
  let alive = true;

  const picker = createCategoryPicker({
    uid: user.uid,
    eventId: event.id,
    categories,
    value: editing ? invitation.categoryId : categories.some((c) => c.id === initialCategory) ? initialCategory : '',
    onChange: () => (dirty = true),
  });

  const viewModes = [
    { id: 'vertical', label: 'Vertical' },
    { id: 'horizontal', label: 'Horizontal' },
    { id: 'flip', label: 'Page' },
  ];
  const viewModeBtns = viewModes.map((m) =>
    Object.assign(
      h('button', { type: 'button', class: `scroll-mode-btn${viewMode === m.id ? ' active' : ''}`, 'aria-pressed': String(viewMode === m.id) }, m.label),
      {
        onclick: () => {
          viewMode = m.id;
          dirty = true;
          viewModeBtns.forEach((b, idx) => {
            const active = viewModes[idx].id === viewMode;
            b.classList.toggle('active', active);
            b.setAttribute('aria-pressed', String(active));
          });
        },
      },
    ),
  );
  const viewModeField = h(
    'div',
    { class: 'field' },
    h('span', { class: 'label' }, 'Page view'),
    h('div', { class: 'scroll-mode-group view-mode-group', role: 'group', 'aria-label': 'Page view' }, ...viewModeBtns),
  );

  const fileInput = h('input', { type: 'file', accept: ACCEPT_ATTRIBUTE, class: 'visually-hidden', id: 'file-input', tabindex: '-1', multiple: 'multiple' });
  const dropError = h('p', { class: 'field-error', role: 'alert' });
  const nameInput = h('input', { class: 'input', id: 'inv-name', type: 'text', maxlength: 80, value: name, placeholder: 'Invitation name', 'aria-label': 'Invitation name' });
  const nameError = h('p', { class: 'field-error', role: 'alert' });
  nameInput.addEventListener('input', () => {
    name = nameInput.value;
    nameTouched = true;
    dirty = true;
    nameError.textContent = '';
  });

  // Clean up any leftover unsaved uploads from an earlier reload in this tab.
  const staleDrafts = readDraftUploads();
  if (staleDrafts.length) {
    writeDraftUploads([]);
    staleDrafts.forEach((p) => deleteFile(p));
  }

  let cachedHeaders = null;
  getSupabaseHeaders({ includeAuth: true }).then((h) => { cachedHeaders = h; }).catch(() => {});

  /* -------------------------------------------------- slot management */

  function cancelSlot(slot) {
    slot.cancelled = true;
    // Only delete newly uploaded files immediately; existing saved files are deleted on Save.
    if (slot.path && !slot.existing) {
      untrackDraftUpload(slot.path);
      deleteFile(slot.path);
    }
  }

  function cancelAllPending() {
    slots.forEach((s) => {
      if (!s.existing) cancelSlot(s);
    });
    slots = [];
  }

  function removeSlot(slot) {
    cancelSlot(slot);
    slots = slots.filter((s) => s !== slot);
    dirty = true;
    renderGrid();
  }

  /* -------------------------------------------------- grid rendering */

  const grid = h('div', { class: 'upload-file-grid' });
  const gridWrap = h('div', { class: 'upload-grid-wrap' }, grid, dropError);

  function makeProgressBar() {
    return h('div', { class: 'progress', hidden: true, role: 'progressbar', 'aria-valuemin': '0', 'aria-valuemax': '100' }, h('div', { class: 'progress-fill' }));
  }

  function setBarProgress(bar, fraction, visible = true) {
    bar.hidden = !visible;
    const pct = Math.round(fraction * 100);
    bar.setAttribute('aria-valuenow', String(pct));
    bar.firstChild.style.width = `${pct}%`;
  }

  function slotUploading(slot) {
    const bar = makeProgressBar();
    setBarProgress(bar, 0, true);
    slot._bar = bar;
    return h(
      'div',
      { class: 'upload-slot upload-slot-uploading' },
      h('div', { class: 'upload-slot-icon' }, icon('upload', 24)),
      h('p', { class: 'upload-slot-name muted' }, slot.file.name || 'file'),
      bar,
      button({ label: 'Cancel', variant: 'ghost-danger', size: 'sm', onClick: () => removeSlot(slot) }),
    );
  }

  function slotUploaded(slot) {
    const preview = slot.thumbnail
      ? h('img', { class: 'upload-slot-thumb', src: slot.thumbnail, alt: slot.file.name })
      : h('div', { class: 'upload-slot-icon' }, icon(slot.kind === 'pdf' ? 'file' : 'image', 28));
    return h(
      'div',
      { class: 'upload-slot upload-slot-done' },
      h('div', { class: 'upload-slot-preview' }, preview),
      h(
        'div',
        { class: 'upload-slot-meta' },
        h('p', { class: 'upload-slot-name muted small', title: slot.file.name || 'file' }, slot.file.name || 'file'),
        h(
          'div',
          { class: 'upload-slot-foot' },
          h('p', { class: 'upload-slot-size muted small' }, formatBytes(slot.file.size)),
          button({ icon: 'trash', variant: 'ghost-danger', size: 'sm', onClick: () => removeSlot(slot), ariaLabel: 'Remove file', title: 'Remove file' }),
        ),
      ),
    );
  }

  function addMoreTile() {
    const tile = h(
      'div',
      { class: 'upload-slot upload-slot-add', role: 'button', tabindex: '0', 'aria-label': 'Add more files' },
      h('div', { class: 'upload-slot-icon' }, icon('plus', 28)),
      h('p', { class: 'muted small' }, 'Add file'),
    );
    tile.addEventListener('click', () => fileInput.click());
    tile.addEventListener('keydown', (e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); fileInput.click(); } });
    return tile;
  }

  function emptyDropzone() {
    const zone = h(
      'div',
      { class: 'dropzone', role: 'button', tabindex: '0', 'aria-label': `Upload invitation files. ${SUPPORTED_LABEL}, up to ${MAX_UPLOAD_MB} MB each.` },
      h('span', { class: 'dropzone-icon' }, icon('upload', 32)),
      h('p', { class: 'dropzone-title' }, 'Drag & drop your files here'),
      h('p', { class: 'muted' }, 'or ', h('span', { class: 'link-like' }, 'browse files')),
      h('p', { class: 'muted small' }, `${SUPPORTED_LABEL} · up to ${MAX_UPLOAD_MB} MB · max ${MAX_FILES} files`),
    );
    const openPicker = () => fileInput.click();
    zone.addEventListener('click', openPicker);
    zone.addEventListener('keydown', (e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); openPicker(); } });
    return zone;
  }

  function renderGrid() {
    dropError.textContent = '';
    if (!slots.length) {
      // Show full dropzone when no files added yet
      let zone = grid.querySelector('.dropzone');
      if (!zone) {
        zone = emptyDropzone();
        attachDropZone(zone);
        grid.replaceChildren(zone);
      }
      return;
    }
    const tiles = slots.map((s) => s.status === 'uploading' ? slotUploading(s) : slotUploaded(s));
    if (slots.length < MAX_FILES) tiles.push(addMoreTile());
    grid.replaceChildren(...tiles);
  }

  /* -------------------------------------------------- drag & drop on the whole grid area */

  function attachDropZone(el) {
    let depth = 0;
    el.addEventListener('dragenter', (e) => { e.preventDefault(); depth += 1; el.classList.add('drag'); });
    el.addEventListener('dragover', (e) => e.preventDefault());
    el.addEventListener('dragleave', () => { depth = Math.max(0, depth - 1); if (!depth) el.classList.remove('drag'); });
    el.addEventListener('drop', (e) => { e.preventDefault(); depth = 0; el.classList.remove('drag'); acceptFiles([...e.dataTransfer.files]); });
  }

  attachDropZone(gridWrap);

  /* -------------------------------------------------- accept files */

  async function acceptFiles(files) {
    dropError.textContent = '';
    const remaining = MAX_FILES - slots.length;
    if (remaining <= 0) {
      dropError.textContent = `You can upload up to ${MAX_FILES} files per invitation.`;
      return;
    }
    const toAdd = files.slice(0, remaining);
    if (files.length > remaining) {
      dropError.textContent = `Only ${remaining} more file(s) allowed. ${files.length - remaining} ignored.`;
    }

    for (const file of toAdd) {
      const result = await inspectFile(file, MAX_UPLOAD_BYTES);
      if (!result.ok) {
        dropError.textContent = result.error;
        toast(result.error, 'error');
        continue;
      }

      const id = editing ? invitation.id : (draftId ||= newInvitationId());
      const slot = {
        file,
        mime: result.mime,
        kind: result.kind,
        id,
        path: null,
        meta: null,
        thumbnail: null,
        status: 'uploading',
        cancelled: false,
        uploadPromise: null,
        _bar: null,
      };
      slots.push(slot);
      dirty = true;

      if (!nameTouched && slots.length === 1) {
        name = fileBaseName(file.name).slice(0, 80) || 'Uploaded invitation';
        nameInput.value = name;
      }

      slot.uploadPromise = (async () => {
        try {
          const [thumb, path] = await Promise.all([
            makeThumbnail(file, result.kind),
            uploadInvitationFile(user.uid, id, file, result.mime, (fraction) => {
              if (!slot.cancelled && alive && slot._bar) setBarProgress(slot._bar, fraction, true);
            }),
          ]);
          if (slot.cancelled || !alive) { await deleteFile(path); return null; }
          slot.path = path;
          trackDraftUpload(path);
          slot.thumbnail = thumb.dataUrl;
          slot.meta = {
            path,
            name: (file.name || 'invitation').slice(0, 200),
            contentType: result.mime,
            kind: result.kind,
            size: file.size,
            width: thumb.width,
            height: thumb.height,
          };
          slot.status = 'uploaded';
          if (alive) renderGrid();
          return slot;
        } catch (error) {
          if (slot.cancelled || !alive) return null;
          slot.status = 'error';
          slots = slots.filter((s) => s !== slot);
          if (alive) {
            renderGrid();
            const msg = error?.message || 'Could not upload the file to Supabase.';
            dropError.textContent = msg;
            toast(msg, 'error');
          }
          throw error;
        }
      })();
      slot.uploadPromise.catch(() => {});
    }

    renderGrid();
  }

  fileInput.addEventListener('change', () => {
    const files = [...fileInput.files];
    fileInput.value = '';
    if (files.length) acceptFiles(files);
  });

  /* ----------------------------------------------------------------- save */

  async function performSave(check) {
    try {
      const categoryId = await picker.resolveCategoryId();

      // Wait for all uploads to finish
      await Promise.all(slots.map((s) => s.uploadPromise).filter(Boolean));

      const readyMetas = slots.filter((s) => s.status === 'uploaded' && s.meta).map((s) => s.meta);
      if (!readyMetas.length) {
        throw Object.assign(new Error('Please wait for uploads to finish or add a file.'), { code: 'storage/unknown' });
      }

      const thumbnail = slots.find((s) => s.thumbnail)?.thumbnail ?? (editing ? invitation.thumbnail || null : null);

      if (editing) {
        await updateInvitation(invitation, { name: check.value, categoryId, files: readyMetas, viewMode, thumbnail });
        // Delete old files that were removed or replaced
        const oldPaths = new Set((invitation.files || (invitation.file ? [invitation.file] : [])).map((f) => f.path));
        const newPaths = new Set(readyMetas.map((m) => m.path));
        await Promise.all([...oldPaths].filter((p) => !newPaths.has(p)).map(deleteFile));
      } else {
        const id = draftId || slots[0]?.id;
        await createInvitation(user.uid, event.id, { id, name: check.value, categoryId, creationType: 'uploaded', files: readyMetas, viewMode, thumbnail });
      }
      saved = true;
      slots.forEach((s) => { if (!s.existing && s.path) untrackDraftUpload(s.path); });
    } catch (error) {
      console.error(error);
      const friendly = isValidationError(error) || String(error?.code || '').startsWith('storage/');
      throw new Error(friendly ? error.message : describeDbError(error));
    }
  }

  const saveBtn = button({ label: 'Preview & save', icon: 'check', variant: 'primary' });
  saveBtn.addEventListener('click', () => {
    const check = validateInvitationName(name);
    if (!slots.length) {
      dropError.textContent = 'Add at least one file to upload.';
      return;
    }
    if (!check.valid) {
      nameError.textContent = check.error;
      nameInput.focus();
      return;
    }
    if (!picker.validate()) {
      picker.focus();
      return;
    }

    const previewHost = h('div', { class: 'review-file' });
    let reviewViewer = null;
    const needsFetch = slots.some((s) => s.existing && s.path);
    if (needsFetch) {
      previewHost.append(h('div', { class: 'pdf-status muted' }, 'Loading…'));
    }
    Promise.all(
      slots.map(async (s) => ({
        blob: s.existing && s.path ? await fetchFileBlob(s.path, s.mime) : s.file,
        kind: s.kind,
        name: s.file?.name || check.value,
      })),
    ).then((loaded) => {
      if (!previewHost.isConnected) return;
      reviewViewer = createMultiFileViewer(loaded, { defaultLayout: viewMode });
      previewHost.replaceChildren(reviewViewer.el);
    });

    openSaveReview({
      preview: previewHost,
      name: check.value,
      category: picker.name(),
      typeLabel: 'Uploaded',
      viewLabel: viewModes.find((m) => m.id === viewMode)?.label || '',
      confirmLabel: editing ? 'Save changes' : 'Save invitation',
      extra: null,
      onConfirm: () => performSave(check),
      onClose: () => reviewViewer?.destroy?.(),
      onDone: () => {
        dirty = false;
        toast(editing ? 'Changes saved.' : 'Invitation uploaded and saved.', 'success');
        navigate(`/events/${encodeURIComponent(event.id)}`);
      },
    });
  });

  const beforeUnload = (e) => {
    if (dirty) { e.preventDefault(); e.returnValue = ''; }
  };
  const onPageHide = () => {
    if (saved) return;
    const unsavedPaths = slots.filter((s) => !s.existing && s.path).map((s) => s.path);
    slots.forEach((s) => { if (!s.existing) s.cancelled = true; });
    if (unsavedPaths.length) deleteFilesKeepalive(unsavedPaths, cachedHeaders);
  };
  window.addEventListener('beforeunload', beforeUnload);
  window.addEventListener('pagehide', onPageHide);

  const back = h('a', { class: 'back-link', href: `#/events/${encodeURIComponent(event.id)}` }, icon('back', 16), h('span', {}, event.name));
  back.addEventListener('click', async (e) => {
    if (!dirty) return;
    e.preventDefault();
    const ok = await confirmDialog({ title: 'Discard your changes?', message: 'You have unsaved changes that will be lost.', confirmLabel: 'Discard', cancelLabel: 'Keep editing', danger: true });
    if (ok) {
      dirty = false;
      cancelAllPending();
      navigate(`/events/${encodeURIComponent(event.id)}`);
    }
  });

  // Seed slots from existing invitation files when editing
  const existingFiles = editing ? (invitation.files?.length ? invitation.files : invitation.file ? [invitation.file] : []) : [];
  if (existingFiles.length) {
    slots = existingFiles.map((f, idx) => ({
      file: { name: f.name, size: f.size || 0 },
      mime: f.contentType,
      kind: f.kind,
      id: invitation.id,
      path: f.path,
      meta: f,
      thumbnail: idx === 0 ? invitation.thumbnail || null : null,
      existing: true,
      status: 'uploaded',
      cancelled: false,
      uploadPromise: null,
      _bar: null,
    }));
  }

  renderGrid();

  const el = appPage(
    user,
    back,
    h('section', { class: 'page-head' }, h('div', {}, h('h1', { class: 'display-md dashboard-title' }, editing ? 'Edit uploaded invitation' : 'Upload invitation'), h('p', { class: 'muted' }, `Upload up to ${MAX_FILES} files. Files are stored exactly as uploaded — same quality, same proportions.`))),
    h(
      'div',
      { class: 'upload-layout' },
      h('section', { class: 'card upload-main' }, fileInput, gridWrap),
      h('aside', { class: 'card upload-side' }, h('label', { class: 'field' }, h('span', { class: 'label' }, 'Invitation name'), nameInput, nameError), picker.el, viewModeField, saveBtn),
    ),
  );

  return {
    el,
    title: editing ? 'Edit invitation' : 'Upload invitation',
    destroy: () => {
      alive = false;
      if (!saved) cancelAllPending();
      window.removeEventListener('beforeunload', beforeUnload);
      window.removeEventListener('pagehide', onPageHide);
    },
  };
}

export default async function uploadPage({ params, query, user, navigate }) {
  try {
    const event = await getEvent(user.uid, params.eventId);
    if (!event) {
      navigate('/dashboard', { replace: true });
      toast('That event wasn’t found.', 'error');
      return { el: h('div') };
    }
    const categories = await listCategories(user.uid, event.id);
    return mountUpload({ user, event, categories, initialCategory: query.cat, navigate });
  } catch (error) {
    console.error(error);
    return { el: appPage(user, backLink('#/dashboard', 'My Events'), errorState(describeDbError(error), () => location.reload())) };
  }
}
