// Calendar modal window for selecting a local ISO date ("YYYY-MM-DD").

import { parseISODate, todayISO } from '../lib/format.js';
import { isValidISODate } from '../lib/validate.js';
import { button, h, icon, openModal } from './dom.js';

const MONTHS = [
  'January', 'February', 'March', 'April', 'May', 'June',
  'July', 'August', 'September', 'October', 'November', 'December',
];
const WEEKDAYS = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];

const pad2 = (n) => String(n).padStart(2, '0');
const toISO = (year, month, day) => `${year}-${pad2(month + 1)}-${pad2(day)}`;

/**
 * Opens a modal calendar window and resolves to the chosen "YYYY-MM-DD" string,
 * "" if cleared, or null if dismissed.
 */
export function openDatePicker({ value = '', title = 'Select event date', minYear = 1900, maxYear = 2200 } = {}) {
  return new Promise((resolve) => {
    let settled = false;
    const settle = (result) => {
      if (settled) return;
      settled = true;
      resolve(result);
    };

    const today = todayISO();
    const initial = (isValidISODate(value) && parseISODate(value)) || new Date();
    let viewYear = Math.min(Math.max(initial.getFullYear(), minYear), maxYear);
    let viewMonth = initial.getMonth();

    const monthSelect = h(
      'select',
      { class: 'select cal-select', 'aria-label': 'Month' },
      ...MONTHS.map((name, idx) => h('option', { value: String(idx) }, name)),
    );
    const yearSelect = h(
      'select',
      { class: 'select cal-select', 'aria-label': 'Year' },
      ...Array.from({ length: maxYear - minYear + 1 }, (_, i) => {
        const y = minYear + i;
        return h('option', { value: String(y) }, String(y));
      }),
    );

    const prevBtn = h('button', { class: 'icon-btn cal-nav', type: 'button', 'aria-label': 'Previous month' }, icon('chevronLeft', 18));
    const nextBtn = h('button', { class: 'icon-btn cal-nav', type: 'button', 'aria-label': 'Next month' }, icon('chevronRight', 18));
    const grid = h('div', { class: 'cal-grid', role: 'grid', 'aria-label': 'Calendar days' });

    function pick(iso) {
      settle(iso);
      modal.close();
    }

    function paintMonth() {
      monthSelect.value = String(viewMonth);
      yearSelect.value = String(viewYear);
      prevBtn.disabled = viewYear === minYear && viewMonth === 0;
      nextBtn.disabled = viewYear === maxYear && viewMonth === 11;

      const firstWeekday = new Date(viewYear, viewMonth, 1).getDay();
      const totalDays = new Date(viewYear, viewMonth + 1, 0).getDate();
      const cells = [];

      for (let i = 0; i < firstWeekday; i += 1) {
        cells.push(h('span', { class: 'cal-pad', 'aria-hidden': 'true' }));
      }
      for (let day = 1; day <= totalDays; day += 1) {
        const iso = toISO(viewYear, viewMonth, day);
        const isSelected = iso === value;
        const isToday = iso === today;
        const cls = ['cal-day', isSelected ? 'is-selected' : '', isToday ? 'is-today' : ''].filter(Boolean).join(' ');
        const btn = h(
          'button',
          {
            type: 'button',
            class: cls,
            dataset: { date: iso },
            'aria-label': `${MONTHS[viewMonth]} ${day}, ${viewYear}`,
            'aria-pressed': isSelected ? 'true' : 'false',
            onclick: () => pick(iso),
          },
          String(day),
        );
        if (isSelected || (!isValidISODate(value) && isToday)) btn.setAttribute('autofocus', '');
        cells.push(btn);
      }
      grid.replaceChildren(...cells);
    }

    const shiftMonth = (delta) => {
      let m = viewMonth + delta;
      let y = viewYear;
      if (m < 0) {
        m = 11;
        y -= 1;
      } else if (m > 11) {
        m = 0;
        y += 1;
      }
      if (y < minYear || y > maxYear) return;
      viewMonth = m;
      viewYear = y;
      paintMonth();
    };

    prevBtn.addEventListener('click', () => shiftMonth(-1));
    nextBtn.addEventListener('click', () => shiftMonth(1));
    monthSelect.addEventListener('change', () => {
      viewMonth = Number(monthSelect.value);
      paintMonth();
    });
    yearSelect.addEventListener('change', () => {
      viewYear = Number(yearSelect.value);
      paintMonth();
    });

    paintMonth();

    const content = h(
      'div',
      { class: 'cal' },
      h('div', { class: 'cal-head' }, prevBtn, h('div', { class: 'cal-selects' }, monthSelect, yearSelect), nextBtn),
      h('div', { class: 'cal-weekdays', 'aria-hidden': 'true' }, ...WEEKDAYS.map((d) => h('span', {}, d))),
      grid,
      h(
        'div',
        { class: 'cal-actions' },
        button({ label: 'Today', variant: 'secondary', size: 'sm', onClick: () => pick(today) }),
        h(
          'div',
          { class: 'cal-actions-right' },
          value ? button({ label: 'Clear', variant: 'ghost', size: 'sm', onClick: () => pick('') }) : null,
          button({ label: 'Cancel', variant: 'ghost', size: 'sm', onClick: () => modal.close() }),
        ),
      ),
    );

    const modal = openModal({
      title,
      size: 'sm',
      content,
      onClose: () => settle(null),
    });
  });
}
