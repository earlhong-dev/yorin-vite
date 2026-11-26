// Create Event form. Validates on the client (and again in firestore.rules), saves, then opens the event page.

import { formatLongDate } from '../lib/format.js';
import { isValidISODate, validateEvent } from '../lib/validate.js';
import { createEvent, describeDbError, isValidationError } from '../services/db.js';
import { openDatePicker } from '../ui/date-picker.js';
import { button, h, icon, setBusy, toast } from '../ui/dom.js';
import { appPage, backLink } from '../ui/shell.js';

export default async function eventNew({ user, navigate }) {
  // --- Type of Event input ---
  const typeInput = h('input', {
    class: 'input',
    id: 'ev-type',
    type: 'text',
    maxlength: 60,
    placeholder: 'e.g. Wedding, Birthday\u2026',
    autocomplete: 'off',
  });

  const syncCustom = () => {
    customWrap.hidden = typeInput.value.trim() !== 'Custom';
  };

  typeInput.addEventListener('input', syncCustom);

  const fields = {
    name: h('input', { class: 'input', id: 'ev-name', name: 'name', type: 'text', maxlength: 100, placeholder: 'e.g. Maria & Joel\u2019s Wedding', autocomplete: 'off', required: true }),
    // type is a proxy so fields.type.value works for validation/submit
    type: { get value() { return typeInput.value.trim(); }, set value(v) { typeInput.value = v; } },
    customType: h('input', { class: 'input', id: 'ev-custom', name: 'customType', type: 'text', maxlength: 40, placeholder: 'e.g. Baby Shower' }),
    date: h('input', { class: 'input date-input', id: 'ev-date', name: 'date', type: 'text', inputmode: 'numeric', placeholder: 'Select a date\u2026', autocomplete: 'off', required: true }),
    location: h('input', { class: 'input', id: 'ev-location', name: 'location', type: 'text', maxlength: 200, placeholder: 'Venue or city', autocomplete: 'off', required: true }),
  };
  const errorEls = Object.fromEntries(Object.keys(fields).map((k) => [k, h('p', { class: 'field-error', id: `err-${k}`, role: 'alert' })]));
  const customWrap = h('label', { class: 'field', hidden: true }, h('span', { class: 'label' }, 'Custom event type'), fields.customType, errorEls.customType);
  const datePreview = h('p', { class: 'muted small date-preview' });
  const formError = h('p', { class: 'field-error form-error', role: 'alert' });

  const syncDatePreview = () => {
    const v = fields.date.value.trim();
    datePreview.textContent = isValidISODate(v) ? formatLongDate(v) : '';
  };

  let pickerOpen = false;
  const openCalendar = async () => {
    if (pickerOpen) return;
    pickerOpen = true;
    try {
      const picked = await openDatePicker({ value: fields.date.value.trim() });
      if (picked === null) return;
      fields.date.value = picked;
      errorEls.date.textContent = '';
      fields.date.classList.remove('invalid');
      fields.date.removeAttribute('aria-invalid');
      syncDatePreview();
    } finally {
      pickerOpen = false;
    }
  };

  const calBtn = h('button', { class: 'icon-btn date-picker-btn', type: 'button', 'aria-label': 'Open calendar', title: 'Choose date from calendar', onclick: openCalendar }, icon('calendar', 18));
  fields.date.addEventListener('click', openCalendar);
  fields.date.addEventListener('input', syncDatePreview);
  const dateWrap = h('div', { class: 'date-input-wrap' }, fields.date, calBtn, datePreview);

  const showErrors = (errors) => {
    for (const [key, el] of Object.entries(errorEls)) {
      el.textContent = errors[key] || '';
      // fields.type is a proxy (no classList) — style typeInput directly
      const targetEl = key === 'type' ? typeInput : fields[key];
      targetEl.classList.toggle('invalid', Boolean(errors[key]));
      if (errors[key]) targetEl.setAttribute('aria-invalid', 'true');
      else targetEl.removeAttribute('aria-invalid');
    }
  };

  const submit = button({ label: 'Create Event', type: 'submit', variant: 'primary', size: 'lg' });
  const form = h(
    'form',
    { class: 'card form-card', novalidate: true },
    h('label', { class: 'field' }, h('span', { class: 'label' }, 'Event Name'), fields.name, errorEls.name),
    h('label', { class: 'field' }, h('span', { class: 'label' }, 'Type of Event'), typeInput, errorEls.type),
    customWrap,
    h('div', { class: 'field-row' }, h('div', { class: 'field' }, h('label', { class: 'label', for: 'ev-date' }, 'Date of Event'), dateWrap, errorEls.date), h('label', { class: 'field' }, h('span', { class: 'label' }, 'Location'), fields.location, errorEls.location)),
    formError,
    h('div', { class: 'form-actions' }, h('a', { class: 'btn btn-ghost', href: '#/dashboard' }, 'Cancel'), submit),
  );

  form.addEventListener('submit', async (e) => {
    e.preventDefault();
    if (submit.dataset.busy) return;
    formError.textContent = '';
    const input = Object.fromEntries(Object.entries(fields).map(([k, el]) => [k, el.value]));
    const check = validateEvent(input);
    showErrors(check.errors);
    if (!check.valid) {
      // focus the first invalid field (typeInput handled separately)
      if (check.errors.type) { typeInput.focus(); return; }
      form.querySelector('.invalid')?.focus();
      return;
    }
    setBusy(submit, true, 'Creating\u2026');
    try {
      const id = await createEvent(user.uid, input);
      toast('Event created.', 'success');
      navigate(`/events/${id}`);
    } catch (error) {
      console.error(error);
      if (isValidationError(error)) showErrors(error.errors);
      formError.textContent = isValidationError(error) ? error.message : describeDbError(error);
      setBusy(submit, false);
    }
  });

  const el = appPage(
    user,
    backLink('#/dashboard', 'My Events'),
    h('section', { class: 'page-head' }, h('div', {}, h('h1', { class: 'display-md dashboard-title' }, 'Create an event'))),
    form,
  );
  return { el, title: 'Create Event' };
}
