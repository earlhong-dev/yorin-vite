// Individual event page: details, "+ Create Invitations", and invitations grouped by category.

import { formatLongDate } from '../lib/format.js';
import { isValidISODate, validateCategoryName, validateEvent } from '../lib/validate.js';
import {
  addCategory, deleteEvent, deleteInvitation, describeDbError, getEvent,
  listCategories, listInvitations, updateEvent,
} from '../services/db.js';
import { openDatePicker } from '../ui/date-picker.js';
import { button, confirmDialog, h, icon, openModal, promptDialog, setBusy, toast } from '../ui/dom.js';
import { invitationCard, openInvitationPreview } from '../ui/invitation-card.js';
import { openShareDialog } from '../ui/share-dialog.js';
import { appPage, backLink, emptyState, errorState } from '../ui/shell.js';

function openCreateChoice(eventId, categoryId, navigate, onCreateCategory) {
  const q = categoryId ? `?cat=${encodeURIComponent(categoryId)}` : '';
  const go = (kind) => {
    modal.close();
    navigate(`/events/${encodeURIComponent(eventId)}/new/${kind}${q}`);
  };
  const option = (kind, iconName, title, text) =>
    h('button', { class: 'choice', type: 'button', dataset: { choice: kind }, onclick: () => go(kind) }, h('span', { class: 'choice-icon' }, icon(iconName, 28)), h('span', { class: 'choice-title' }, title), h('span', { class: 'choice-text muted' }, text));
  const modal = openModal({
    title: 'Create an invitation',
    size: 'md',
    content: h(
      'div',
      { class: 'stack' },
      h(
        'div',
        { class: 'choices' },
        option('created', 'sparkle', 'Create Invitation', 'Design it here with templates, fonts, colors and a live preview.'),
        option('upload', 'upload', 'Upload Invitation', 'Already have a design? Upload a PDF or image — quality stays untouched.'),
      ),
      onCreateCategory
        ? h(
          'div',
          { class: 'choices-category' },
          h('p', { class: 'muted small' }, 'Who’s on your guest list?'),
          button({
            label: 'Create Guest List',
            icon: 'folder',
            variant: 'secondary',
            onClick: () => {
              modal.close();
              onCreateCategory();
            },
          }),
        )
        : null,
    ),
  });
}

export default async function eventPage({ params, query, user, navigate }) {
  const { eventId } = params;
  const body = h('div', { class: 'event-body' }, h('div', { class: 'card skeleton tall', 'aria-hidden': 'true' }));
  let alive = true;
  let state = null; // { event, categories, invitations }

  async function load() {
    try {
      const event = await getEvent(user.uid, eventId);
      if (!alive) return;
      if (!event) {
        body.replaceChildren(
          emptyState({ iconName: 'lock', title: 'Event not found', text: 'It may have been deleted, or it isn’t yours to open.', action: h('a', { class: 'btn btn-primary', href: '#/dashboard' }, 'Back to My Events') }),
        );
        return;
      }
      const [categories, invitations] = await Promise.all([listCategories(user.uid, eventId), listInvitations(user.uid, eventId)]);
      if (!alive) return;
      state = { event, categories, invitations };
      paint();
    } catch (error) {
      console.error(error);
      if (alive) body.replaceChildren(errorState(describeDbError(error), () => { body.replaceChildren(h('div', { class: 'card skeleton tall' })); load(); }));
    }
  }

  async function onDeleteInvitation(inv) {
    const ok = await confirmDialog({
      title: 'Delete this invitation?',
      message: `“${inv.name}” will be permanently deleted${inv.shareToken ? ', and its share link will stop working immediately' : ''}.`,
      confirmLabel: 'Delete',
      danger: true,
    });
    if (!ok) return;
    try {
      await deleteInvitation(inv);
      state.invitations = state.invitations.filter((i) => i.id !== inv.id);
      paint();
      toast('Invitation deleted.', 'success');
    } catch (error) {
      console.error(error);
      toast(describeDbError(error), 'error');
    }
  }

  function onShare(inv) {
    openShareDialog(inv, (updated) => {
      state.invitations = state.invitations.map((i) => (i.id === updated.id ? { ...i, ...updated } : i));
      paint();
    });
  }

  function onEditEvent() {
    const ev = state.event;
    const nameInput = h('input', { class: 'input', type: 'text', maxlength: 100, value: ev.name, required: true });
    const dateInput = h('input', { class: 'input date-input', type: 'text', inputmode: 'numeric', value: ev.date, placeholder: 'YYYY-MM-DD', required: true });
    const locationInput = h('input', { class: 'input', type: 'text', maxlength: 200, value: ev.location, required: true });
    const errors = {
      name: h('p', { class: 'field-error', role: 'alert' }),
      date: h('p', { class: 'field-error', role: 'alert' }),
      location: h('p', { class: 'field-error', role: 'alert' }),
    };
    const datePreview = h('p', { class: 'muted small date-preview' }, isValidISODate(ev.date) ? formatLongDate(ev.date) : '');
    let pickerOpen = false;
    const openCal = async () => {
      if (pickerOpen) return;
      pickerOpen = true;
      try {
        const picked = await openDatePicker({ value: dateInput.value.trim() });
        if (picked === null) return;
        dateInput.value = picked;
        errors.date.textContent = '';
        dateInput.classList.remove('invalid');
        datePreview.textContent = isValidISODate(picked) ? formatLongDate(picked) : '';
      } finally {
        pickerOpen = false;
      }
    };
    dateInput.addEventListener('click', openCal);
    dateInput.addEventListener('input', () => {
      const v = dateInput.value.trim();
      datePreview.textContent = isValidISODate(v) ? formatLongDate(v) : '';
    });
    const calBtn = h('button', { class: 'icon-btn date-picker-btn', type: 'button', 'aria-label': 'Open calendar', onclick: openCal }, icon('calendar', 18));
    const saveBtn = button({ label: 'Save changes', type: 'submit', variant: 'primary' });

    const form = h(
      'form',
      { class: 'stack', novalidate: true },
      h('label', { class: 'field' }, h('span', { class: 'label' }, 'Event Name'), nameInput, errors.name),
      h('div', { class: 'field' }, h('span', { class: 'label' }, 'Date of Event'), h('div', { class: 'date-input-wrap' }, dateInput, calBtn), datePreview, errors.date),
      h('label', { class: 'field' }, h('span', { class: 'label' }, 'Location'), locationInput, errors.location),
      h('div', { class: 'modal-actions' }, button({ label: 'Cancel', variant: 'ghost', onClick: () => modal.close() }), saveBtn),
    );

    const modal = openModal({ title: 'Edit event details', size: 'md', content: form });
    form.addEventListener('submit', async (e) => {
      e.preventDefault();
      if (saveBtn.dataset.busy) return;
      const input = {
        name: nameInput.value,
        type: ev.type,
        customType: ev.customType || '',
        date: dateInput.value,
        location: locationInput.value,
      };
      const check = validateEvent(input);
      for (const [k, el] of Object.entries(errors)) el.textContent = check.errors[k] || '';
      nameInput.classList.toggle('invalid', Boolean(check.errors.name));
      dateInput.classList.toggle('invalid', Boolean(check.errors.date));
      locationInput.classList.toggle('invalid', Boolean(check.errors.location));
      if (!check.valid) return;

      setBusy(saveBtn, true, 'Saving…');
      try {
        state.event = await updateEvent(ev, input);
        modal.close();
        paint();
        toast('Event updated.', 'success');
      } catch (error) {
        console.error(error);
        toast(describeDbError(error), 'error');
        setBusy(saveBtn, false);
      }
    });
  }

  async function onDeleteEvent() {
    const count = state.invitations.length;
    const ok = await confirmDialog({
      title: 'Delete this event?',
      message: `“${state.event.name}” and ${count ? `its ${count} invitation${count === 1 ? '' : 's'} (including share links and uploaded files)` : 'all of its categories'} will be permanently deleted. This can’t be undone.`,
      confirmLabel: 'Delete event',
      danger: true,
    });
    if (!ok) return;
    try {
      await deleteEvent(user.uid, eventId);
      toast('Event deleted.', 'success');
      navigate('/dashboard');
    } catch (error) {
      console.error(error);
      toast(describeDbError(error), 'error');
    }
  }

  async function onCreateCategory() {
    const existingNames = state.categories.map((c) => c.name);
    const name = await promptDialog({
      title: 'Create Guest List',
      label: 'Guest list name',
      placeholder: 'e.g. VIP, Family, Friends',
      confirmLabel: 'Create',
      maxLength: 40,
      validate: (v) => {
        const res = validateCategoryName(v, existingNames);
        return res.valid ? '' : res.error;
      },
    });
    if (!name) return;
    try {
      const created = await addCategory(user.uid, eventId, name, state.categories);
      state.categories = [...state.categories, created];
      paint();
      toast(`Guest list “${created.name}” created.`, 'success');
    } catch (error) {
      console.error(error);
      toast(describeDbError(error), 'error');
    }
  }

  let activeFilter = ''; // '' = All

  function paint() {
    const { event, categories, invitations } = state;
    if (activeFilter && !categories.some((c) => c.id === activeFilter)) activeFilter = '';

    function applyFilter(id) {
      activeFilter = id;
      filterBtns.forEach((btn) => btn.classList.toggle('active', btn.dataset.filterId === id));
      contentEl.querySelectorAll('.category-section').forEach((sec) => {
        sec.hidden = sec.dataset.categoryId !== id;
      });
    }

    const filterBtns = [
      Object.assign(
        h('button', { type: 'button', class: `filter${activeFilter === '' ? ' active' : ''}`, dataset: { filterId: '' } }, h('span', {}, 'All'), h('span', { class: 'count' }, String(invitations.length))),
        { onclick: () => applyFilter('') },
      ),
      ...categories.map((c) => {
        const count = invitations.filter((i) => i.categoryId === c.id).length;
        return Object.assign(
          h('button', { type: 'button', class: `filter${activeFilter === c.id ? ' active' : ''}`, dataset: { filterId: c.id } }, h('span', {}, c.name), h('span', { class: 'count' }, String(count))),
          { onclick: () => applyFilter(c.id) },
        );
      }),
    ];

    const details = h(
      'div',
      { class: 'event-hero-wrap' },
      h(
        'section',
        { class: 'card event-hero' },
        h(
          'div',
          { class: 'event-hero-top-actions' },
          button({ icon: 'edit', variant: 'ghost', size: 'sm', onClick: onEditEvent, ariaLabel: 'Edit event details', title: 'Edit event details' }),
          button({ icon: 'trash', variant: 'ghost-danger', size: 'sm', onClick: onDeleteEvent, ariaLabel: 'Delete event', title: 'Delete event', className: 'event-delete-btn' }),
        ),
        h('h1', { class: 'display-md event-title' }, event.name),
        h('div', { class: 'event-meta-row' },
          icon('calendar', 16), h('span', {}, formatLongDate(event.date)),
          h('span', { class: 'event-meta-sep' }, '·'),
          icon('pin', 16), h('span', {}, event.location),
        ),
      ),
    
    );

    const createBtnFor = (catId) =>
      button({
        label: 'Create Invitations',
        icon: 'plus',
        variant: 'primary',
        size: 'sm',
        className: 'btn-create-invitations',
        onClick: () => openCreateChoice(eventId, catId, navigate, onCreateCategory),
      });

    const categoryNameById = new Map(categories.map((c) => [c.id, c.name]));
    const allSection = h(
      'section',
      { class: 'category-section', dataset: { categoryId: '' }, hidden: activeFilter !== '' },
      h(
        'div',
        { class: 'category-head' },
        h('h2', { class: 'category-title' }, 'All'),
        createBtnFor(''),
      ),
      invitations.length
        ? h('div', { class: 'grid grid-inv' }, ...invitations.map((inv) => invitationCard(inv, categoryNameById.get(inv.categoryId) || '', { onShare, onPreview: openInvitationPreview, onDelete: onDeleteInvitation, onEdit: (i) => navigate(`/events/${encodeURIComponent(eventId)}/invitations/${encodeURIComponent(i.id)}/edit`) })))
        : h('p', { class: 'muted' }, 'No invitations yet.'),
    );

    const sections = [allSection];
    for (const category of categories) {
      const items = invitations.filter((i) => i.categoryId === category.id);
      sections.push(
        h(
          'section',
          { class: 'category-section', dataset: { categoryId: category.id }, hidden: activeFilter !== category.id },
          h(
            'div',
            { class: 'category-head' },
            h('h2', { class: 'category-title' }, category.name),
            createBtnFor(category.id),
          ),
          items.length
            ? h('div', { class: 'grid grid-inv' }, ...items.map((inv) => invitationCard(inv, category.name, { onShare, onPreview: openInvitationPreview, onDelete: onDeleteInvitation, onEdit: (i) => navigate(`/events/${encodeURIComponent(eventId)}/invitations/${encodeURIComponent(i.id)}/edit`) })))
            : h('p', { class: 'muted' }, 'No invitations in this guest list yet.'),
        ),
      );
    }

    const emptyAll = !invitations.length && !categories.length
      ? emptyState({
        iconName: 'sparkle',
        title: 'No invitations yet',
        text: 'Create one in the built-in editor or upload a design you already have.',
        action: button({ label: 'Create Invitations', icon: 'plus', onClick: () => openCreateChoice(eventId, '', navigate, onCreateCategory) }),
      })
      : null;

    const contentEl = emptyAll || h('div', { class: 'sections' }, ...sections);

    const mainLayout = categories.length
      ? h(
          'div',
          { class: 'event-layout' },
          h(
            'aside',
            { class: 'event-sidebar' },
            h('p', { class: 'filter-label' }, 'Guest List'),
            h('div', { class: 'filter-col' }, ...filterBtns),
          ),
          h('div', { class: 'event-content' }, contentEl),
        )
      : contentEl;

    body.replaceChildren(
      details,
      mainLayout,
    );
    document.title = `${event.name} · Yorin.vite`;
  }

  load();
  const el = appPage(user, backLink('#/dashboard', 'My Events'), body);
  void query;
  return { el, title: '', destroy: () => (alive = false) };
}
