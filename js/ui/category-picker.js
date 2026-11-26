// Category text input with a suggestion dropdown of previously saved categories for the event.
// New category names are persisted to Firestore only when the invitation is saved.

import { addCategory, markCategoryActive } from '../services/db.js';
import { clean, LIMITS, validateCategoryName } from '../lib/validate.js';
import { h } from './dom.js';

export function createCategoryPicker({ uid, eventId, categories = [], value = '', onChange }) {
  let list = [...categories];
  const initialCat = list.find((c) => c.id === value);
  const input = h('input', {
    class: 'input',
    id: 'category-input',
    type: 'text',
    maxlength: LIMITS.categoryName,
    value: initialCat ? initialCat.name : '',
    placeholder: 'Enter a guest list',
    autocomplete: 'off',
    role: 'combobox',
    'aria-autocomplete': 'list',
    'aria-expanded': 'false',
    'aria-controls': 'category-suggestions',
  });
  const dropdown = h('div', { class: 'category-dropdown', id: 'category-suggestions', role: 'listbox', hidden: true });
  const error = h('p', { class: 'field-error', role: 'alert' });
  let activeIndex = -1;
  let visibleMatches = [];

  const closeDropdown = () => {
    dropdown.hidden = true;
    input.setAttribute('aria-expanded', 'false');
    activeIndex = -1;
  };

  const selectName = (name) => {
    input.value = name;
    error.textContent = '';
    input.classList.remove('invalid');
    closeDropdown();
    onChange?.(name);
  };

  const paintDropdown = () => {
    const q = clean(input.value).toLowerCase();
    visibleMatches = list.filter((c) => !c.isDefault && (!q || c.name.toLowerCase().includes(q)));
    if (!visibleMatches.length) {
      closeDropdown();
      return;
    }
    if (activeIndex >= visibleMatches.length) activeIndex = visibleMatches.length - 1;
    dropdown.replaceChildren(
      ...visibleMatches.map((c, idx) =>
        h(
          'button',
          {
            type: 'button',
            role: 'option',
            class: `category-option${idx === activeIndex ? ' active' : ''}`,
            'aria-selected': String(idx === activeIndex),
            onMousedown: (e) => {
              e.preventDefault(); // select before blur fires
              selectName(c.name);
            },
          },
          c.name,
        ),
      ),
    );
    dropdown.hidden = false;
    input.setAttribute('aria-expanded', 'true');
  };

  input.addEventListener('focus', () => {
    activeIndex = -1;
    paintDropdown();
  });

  input.addEventListener('input', () => {
    error.textContent = '';
    input.classList.remove('invalid');
    activeIndex = -1;
    paintDropdown();
    onChange?.(input.value);
  });

  input.addEventListener('keydown', (e) => {
    if (dropdown.hidden) {
      if (e.key === 'ArrowDown') {
        paintDropdown();
        if (!dropdown.hidden) e.preventDefault();
      }
      return;
    }
    if (e.key === 'ArrowDown') {
      e.preventDefault();
      activeIndex = (activeIndex + 1) % visibleMatches.length;
      paintDropdown();
    } else if (e.key === 'ArrowUp') {
      e.preventDefault();
      activeIndex = activeIndex <= 0 ? visibleMatches.length - 1 : activeIndex - 1;
      paintDropdown();
    } else if (e.key === 'Enter' && activeIndex >= 0 && visibleMatches[activeIndex]) {
      e.preventDefault();
      selectName(visibleMatches[activeIndex].name);
    } else if (e.key === 'Escape') {
      closeDropdown();
    }
  });

  input.addEventListener('blur', () => {
    closeDropdown();
  });

  const validate = () => {
    const check = validateCategoryName(input.value);
    if (!check.valid) {
      error.textContent = check.error;
      input.classList.add('invalid');
      return false;
    }
    error.textContent = '';
    input.classList.remove('invalid');
    return true;
  };

  /** Returns the matching existing category ID or creates the category in Firestore on save. */
  const resolveCategoryId = async () => {
    const check = validateCategoryName(input.value);
    if (!check.valid) throw new Error(check.error);
    const lower = check.value.toLowerCase();
    const existing = list.find((c) => (c.nameLower || clean(c.name).toLowerCase()) === lower);
    if (existing) {
      if (existing.isDefault) await markCategoryActive(existing);
      return existing.id;
    }
    const created = await addCategory(uid, eventId, check.value, list);
    list = [...list, created];
    return created.id;
  };

  const el = h(
    'div',
    { class: 'field category-picker' },
    h('label', { class: 'label', for: 'category-input' }, 'Guest list'),
    h('div', { class: 'category-input-wrap' }, input, dropdown),
    error,
  );

  return {
    el,
    get value() {
      const q = clean(input.value).toLowerCase();
      if (!q) return '';
      return list.find((c) => (c.nameLower || clean(c.name).toLowerCase()) === q)?.id || clean(input.value);
    },
    get categories() {
      return list;
    },
    validate,
    resolveCategoryId,
    focus: () => input.focus(),
    setError: (msg) => {
      error.textContent = msg || '';
      input.classList.toggle('invalid', Boolean(msg));
    },
    name: () => clean(input.value),
  };
}
