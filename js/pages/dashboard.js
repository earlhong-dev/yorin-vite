// Dashboard — "My Events". Shows only the signed-in user's events (queried by ownerId).

import { formatDate, isPastDate } from '../lib/format.js';
import { eventTypeLabel } from '../lib/validate.js';
import { describeDbError, listEvents } from '../services/db.js';
import { button, h, icon } from '../ui/dom.js';
import { appPage, emptyState, errorState } from '../ui/shell.js';
import { firstName } from '../lib/format.js';

export function eventCard(event) {
  const past = isPastDate(event.date);
  return h(
    'a',
    { class: 'card event-card', href: `#/events/${encodeURIComponent(event.id)}`, dataset: { eventId: event.id } },
    h('div', { class: 'event-card-top' }, h('span', { class: 'event-card-type' }, eventTypeLabel(event)), past ? h('span', { class: 'chip chip-muted' }, 'Past') : null),
    h('h3', { class: 'event-card-name' }, event.name),
    h(
      'ul',
      { class: 'event-meta' },
      h('li', {}, icon('calendar', 16), h('span', {}, formatDate(event.date))),
      h('li', {}, icon('pin', 16), h('span', {}, event.location)),
    ),
    h('span', { class: 'event-card-open' }, 'Open event →'),
  );
}

function skeletons(n = 8) {
  return h('div', { class: 'grid' }, ...Array.from({ length: n }, () => h('div', { class: 'card skeleton', 'aria-hidden': 'true' })));
}

export default async function dashboard({ user }) {
  const list = h('div', { class: 'section-body' }, skeletons());
  let alive = true;

  async function load() {
    list.replaceChildren(skeletons());
    try {
      const events = await listEvents(user.uid);
      if (!alive) return;
      if (!events.length) {
        list.replaceChildren(
          emptyState({
            iconName: 'calendar',
            title: 'No event created yet',
          }),
        );
        return;
      }
      list.replaceChildren(h('div', { class: 'grid' }, ...events.map(eventCard)));
    } catch (error) {
      console.error(error);
      if (alive) list.replaceChildren(errorState(describeDbError(error), load));
    }
  }

  load();

  const el = appPage(
    user,
    h('section', { class: 'page-head' }, h('div', {}, h('p', { class: 'eyebrow' }, `Welcome, ${firstName(user.displayName)}`), h('h1', { class: 'display-md dashboard-title' }, 'My Events')), h('a', { class: 'btn btn-primary', href: '#/events/new' }, icon('plus'), h('span', { class: 'btn-label' }, 'Create Event'))),
    list,
  );
  return { el, title: 'My Events', destroy: () => (alive = false) };
}
