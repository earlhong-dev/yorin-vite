// Built-in invitation editor: templates, text, fonts/colors, layout and a live preview.
// `mountEditor` is shared by "create" (this route) and "edit" (invitation-edit.js).

import { applyTemplate, createDefaultDesign, sanitizeDesign, templateStyle } from '../lib/design.js';
import { validateInvitationName } from '../lib/validate.js';
import { ALIGNS, DECOS, DIVIDERS, FONTS, FRAMES, TEMPLATES, TEXT_FIELDS, VERTICALS } from '../templates/templates.js';
import { createInvitation, describeDbError, getEvent, isValidationError, listCategories, updateInvitation } from '../services/db.js';
import { createCategoryPicker } from '../ui/category-picker.js';
import { confirmDialog, h, icon, toast, button } from '../ui/dom.js';
import { renderInvitation } from '../ui/render-invitation.js';
import { openSaveReview } from '../ui/save-review.js';
import { appPage, backLink, errorState } from '../ui/shell.js';

function segmented(options, get, set, label) {
  const wrap = h('div', { class: 'segmented', role: 'radiogroup', 'aria-label': label });
  const buttons = options.map((o) => {
    const b = h('button', { type: 'button', class: 'seg', role: 'radio', dataset: { value: o.id }, onclick: () => { set(o.id); sync(); } }, o.label);
    wrap.append(b);
    return [o.id, b];
  });
  function sync() {
    for (const [id, b] of buttons) {
      const on = get() === id;
      b.classList.toggle('active', on);
      b.setAttribute('aria-checked', String(on));
    }
  }
  sync();
  return { el: wrap, sync };
}

function colorField(label, get, set) {
  const input = h('input', { type: 'color', class: 'color-input', 'aria-label': label });
  const hex = h('code', { class: 'hex' });
  const sync = () => {
    input.value = get();
    hex.textContent = get();
  };
  input.addEventListener('input', () => {
    set(input.value);
    sync();
  });
  sync();
  return { el: h('label', { class: 'color-field' }, input, h('span', {}, label), hex), sync };
}

function fontSelect(label, get, set) {
  const select = h('select', { class: 'select', 'aria-label': label });
  for (const group of ['Serif', 'Script', 'Sans-serif']) {
    select.append(h('optgroup', { label: group }, ...FONTS.filter((f) => f.group === group).map((f) => h('option', { value: f.id, style: { fontFamily: f.stack } }, f.id))));
  }
  const sync = () => (select.value = get());
  select.addEventListener('change', () => set(select.value));
  sync();
  return { el: h('label', { class: 'field' }, h('span', { class: 'label' }, label), select), sync };
}

function slider(label, min, max, step, get, set) {
  const input = h('input', { type: 'range', min, max, step, class: 'range', 'aria-label': label });
  const out = h('output', { class: 'range-out' });
  const sync = () => {
    input.value = get();
    out.textContent = `${Math.round(get() * 100)}%`;
  };
  input.addEventListener('input', () => {
    set(Number(input.value));
    sync();
  });
  sync();
  return { el: h('label', { class: 'field' }, h('span', { class: 'label label-row' }, label, out), input), sync };
}

function selectField(label, options, get, set) {
  const select = h('select', { class: 'select', 'aria-label': label }, ...options.map((o) => h('option', { value: o.id }, o.label)));
  const sync = () => (select.value = get());
  select.addEventListener('change', () => set(select.value));
  sync();
  return { el: h('label', { class: 'field' }, h('span', { class: 'label' }, label), select), sync };
}

/**
 * @param {object} o
 * @param {object} o.user, o.event, o.categories, o.navigate
 * @param {object} [o.invitation]  when present we are editing it
 * @param {string} [o.initialCategory]
 */
export function mountEditor({ user, event, categories, invitation, initialCategory, navigate }) {
  const editing = Boolean(invitation);
  let design = editing ? sanitizeDesign(invitation.design) : createDefaultDesign(event);
  let dirty = false;
  const defaultName = `${event.name} invitation`.slice(0, 80);
  let name = editing ? invitation.name : defaultName;

  const picker = createCategoryPicker({
    uid: user.uid,
    eventId: event.id,
    categories,
    value: editing ? invitation.categoryId : categories.some((c) => c.id === initialCategory) ? initialCategory : '',
    onChange: () => (dirty = true),
  });

  /* live preview */
  const previewHost = h('div', { class: 'editor-preview-frame' });
  const repaint = () => previewHost.replaceChildren(renderInvitation(design));
  const touch = () => {
    dirty = true;
    design = sanitizeDesign(design);
    repaint();
  };
  repaint();

  /* controls */
  const syncers = [];
  const reg = (c) => {
    syncers.push(c.sync);
    return c.el;
  };
  const syncAll = () => syncers.forEach((fn) => fn());
  const setStyle = (key) => (value) => {
    design.style[key] = value;
    touch();
  };

  // Template tab
  const templateGrid = h('div', { class: 'template-grid' });
  const paintTemplates = () => {
    templateGrid.replaceChildren(
      ...TEMPLATES.map((t) => {
        const preview = renderInvitation({ templateId: t.id, text: design.text, style: templateStyle(t.id) });
        return h('button', { type: 'button', class: `template ${design.templateId === t.id ? 'active' : ''}`, dataset: { template: t.id }, 'aria-pressed': String(design.templateId === t.id), onclick: () => { design = applyTemplate(design, t.id); dirty = true; repaint(); syncAll(); paintTemplates(); } }, h('div', { class: 'template-thumb' }, preview), h('span', { class: 'template-name' }, t.name));
      }),
    );
  };

  // Text tab
  const textFields = TEXT_FIELDS.map((f) => {
    const input = h(f.multiline ? 'textarea' : 'input', { class: f.multiline ? 'textarea' : 'input', id: `txt-${f.key}`, maxlength: f.max, placeholder: f.placeholder, rows: f.multiline ? 2 : undefined, type: f.multiline ? undefined : 'text', dataset: { field: f.key } });
    input.value = design.text[f.key] || '';
    const counter = h('span', { class: 'counter' }, `${input.value.length}/${f.max}`);
    input.addEventListener('input', () => {
      design.text[f.key] = input.value;
      counter.textContent = `${input.value.length}/${f.max}`;
      touch();
    });
    return h('label', { class: 'field' }, h('span', { class: 'label label-row' }, f.label, counter), input);
  });

  const tabs = {
    template: { label: 'Template', body: h('div', { class: 'panel-body' }, h('p', { class: 'muted small' }, 'Pick a starting look. Your text stays as you wrote it.'), templateGrid) },
    text: { label: 'Text', body: h('div', { class: 'panel-body' }, ...textFields) },
    style: {
      label: 'Style',
      body: h(
        'div',
        { class: 'panel-body' },
        reg(fontSelect('Title font', () => design.style.titleFont, setStyle('titleFont'))),
        reg(fontSelect('Body font', () => design.style.bodyFont, setStyle('bodyFont'))),
        h('div', { class: 'color-grid' }, reg(colorField('Text', () => design.style.textColor, setStyle('textColor'))), reg(colorField('Accent', () => design.style.accentColor, setStyle('accentColor'))), reg(colorField('Background', () => design.style.bgColor, setStyle('bgColor'))), reg(colorField('Background 2', () => design.style.bgColor2, setStyle('bgColor2')))),
        reg(selectField('Background pattern', DECOS, () => design.style.deco, setStyle('deco'))),
        reg(slider('Title size', 0.6, 1.6, 0.05, () => design.style.titleScale, setStyle('titleScale'))),
        reg(slider('Text size', 0.7, 1.5, 0.05, () => design.style.bodyScale, setStyle('bodyScale'))),
      ),
    },
    layout: {
      label: 'Layout',
      body: h(
        'div',
        { class: 'panel-body' },
        h('div', { class: 'field' }, h('span', { class: 'label' }, 'Text alignment'), reg(segmented(ALIGNS, () => design.style.align, setStyle('align'), 'Text alignment'))),
        h('div', { class: 'field' }, h('span', { class: 'label' }, 'Vertical position'), reg(segmented(VERTICALS, () => design.style.vertical, setStyle('vertical'), 'Vertical position'))),
        h('div', { class: 'field' }, h('span', { class: 'label' }, 'Border'), reg(segmented(FRAMES, () => design.style.frame, setStyle('frame'), 'Border style'))),
        h('div', { class: 'field' }, h('span', { class: 'label' }, 'Divider'), reg(segmented(DIVIDERS, () => design.style.divider, setStyle('divider'), 'Divider style'))),
      ),
    },
  };

  const tabBar = h('div', { class: 'tabs', role: 'tablist' });
  const panelHost = h('div', { class: 'panel' });
  let activeTab = 'template';
  const showTab = (key) => {
    activeTab = key;
    for (const b of tabBar.children) {
      const on = b.dataset.tab === key;
      b.classList.toggle('active', on);
      b.setAttribute('aria-selected', String(on));
    }
    panelHost.replaceChildren(tabs[key].body);
    if (key === 'template') paintTemplates();
  };
  for (const [key, t] of Object.entries(tabs)) {
    tabBar.append(h('button', { type: 'button', class: 'tab', role: 'tab', dataset: { tab: key }, onclick: () => showTab(key) }, t.label));
  }
  showTab(activeTab);

  /* header: name + save */
  const nameInput = h('input', { class: 'input name-input', type: 'text', maxlength: 80, value: name, 'aria-label': 'Invitation name', placeholder: 'Invitation name', id: 'inv-name' });
  const nameError = h('p', { class: 'field-error', role: 'alert' });
  nameInput.addEventListener('input', () => {
    name = nameInput.value;
    dirty = true;
    nameError.textContent = '';
  });

  const saveBtn = button({ label: editing ? 'Review & save' : 'Preview & save', icon: 'check', variant: 'primary' });
  saveBtn.addEventListener('click', () => {
    const check = validateInvitationName(name);
    if (!check.valid) {
      nameError.textContent = check.error;
      nameInput.focus();
      return;
    }
    if (!picker.validate()) {
      picker.focus();
      return;
    }
    openSaveReview({
      preview: renderInvitation(design),
      name: check.value,
      category: picker.name(),
      typeLabel: 'Created',
      confirmLabel: editing ? 'Save changes' : 'Save invitation',
      onConfirm: async () => {
        try {
          const categoryId = await picker.resolveCategoryId();
          if (editing) await updateInvitation(invitation, { name: check.value, categoryId, design });
          else await createInvitation(user.uid, event.id, { name: check.value, categoryId, creationType: 'created', design });
        } catch (error) {
          throw new Error(isValidationError(error) ? error.message : describeDbError(error));
        }
      },
      onDone: () => {
        dirty = false;
        toast(editing ? 'Changes saved.' : 'Invitation saved.', 'success');
        navigate(`/events/${encodeURIComponent(event.id)}`);
      },
    });
  });

  const beforeUnload = (e) => {
    if (dirty) {
      e.preventDefault();
      e.returnValue = '';
    }
  };
  window.addEventListener('beforeunload', beforeUnload);

  const back = h('a', { class: 'back-link', href: `#/events/${encodeURIComponent(event.id)}` }, icon('back', 16), h('span', {}, event.name));
  back.addEventListener('click', async (e) => {
    if (!dirty) return;
    e.preventDefault();
    const ok = await confirmDialog({ title: 'Discard your changes?', message: 'You have unsaved changes that will be lost.', confirmLabel: 'Discard', cancelLabel: 'Keep editing', danger: true });
    if (ok) {
      dirty = false;
      navigate(`/events/${encodeURIComponent(event.id)}`);
    }
  });

  const el = appPage(
    user,
    back,
    h('div', { class: 'editor-bar' }, h('div', { class: 'editor-title' }, h('h1', { class: 'display-sm' }, editing ? 'Edit invitation' : 'Create invitation'), h('div', { class: 'editor-name field' }, nameInput, nameError)), h('div', { class: 'editor-meta' }, picker.el, saveBtn)),
    h('div', { class: 'editor' }, h('aside', { class: 'editor-controls card' }, tabBar, panelHost), h('section', { class: 'editor-preview', 'aria-label': 'Live preview' }, h('p', { class: 'eyebrow center' }, 'Live preview'), previewHost)),
  );

  return { el, title: editing ? 'Edit invitation' : 'Create invitation', destroy: () => window.removeEventListener('beforeunload', beforeUnload) };
}

export default async function editorPage({ params, query, user, navigate }) {
  try {
    const event = await getEvent(user.uid, params.eventId);
    if (!event) {
      navigate('/dashboard', { replace: true });
      toast('That event wasn’t found.', 'error');
      return { el: h('div') };
    }
    const categories = await listCategories(user.uid, event.id);
    return mountEditor({ user, event, categories, initialCategory: query.cat, navigate });
  } catch (error) {
    console.error(error);
    return { el: appPage(user, backLink('#/dashboard', 'My Events'), errorState(describeDbError(error), () => location.reload())) };
  }
}
