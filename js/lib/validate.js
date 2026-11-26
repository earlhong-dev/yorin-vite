// Pure validation helpers (no DOM, no Firebase) so they are easy to unit test.
// The same limits are enforced again server-side in firestore.rules.

export const EVENT_TYPES = ['Wedding', 'Birthday', 'Graduation', 'Anniversary', 'Corporate Event', 'Other', 'Custom'];

export const LIMITS = {
  eventName: 100,
  customType: 40,
  location: 200,
  invitationName: 80,
  categoryName: 40,
  maxCategoriesPerEvent: 50,
};

export const clean = (value) => String(value ?? '').replace(/\s+/g, ' ').trim();

export function isValidISODate(value) {
  if (typeof value !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(value)) return false;
  const [y, m, d] = value.split('-').map(Number);
  if (y < 1900 || y > 2200) return false;
  const date = new Date(Date.UTC(y, m - 1, d));
  return date.getUTCFullYear() === y && date.getUTCMonth() === m - 1 && date.getUTCDate() === d;
}

export function validateEvent(input = {}) {
  const value = {
    name: clean(input.name),
    type: String(input.type ?? ''),
    customType: clean(input.customType),
    date: String(input.date ?? '').trim(),
    location: clean(input.location),
  };
  const errors = {};

  if (!value.name) errors.name = 'Give your event a name.';
  else if (value.name.length > LIMITS.eventName) errors.name = `Keep the name under ${LIMITS.eventName} characters.`;

  if (!EVENT_TYPES.includes(value.type)) errors.type = 'Choose a type of event.';
  if (value.type === 'Custom') {
    if (!value.customType) errors.customType = 'Name your custom event type.';
    else if (value.customType.length > LIMITS.customType) errors.customType = `Keep it under ${LIMITS.customType} characters.`;
  } else {
    value.customType = '';
  }

  if (!value.date) errors.date = 'Pick the date of the event.';
  else if (!isValidISODate(value.date)) errors.date = 'That date doesn’t look right.';

  if (!value.location) errors.location = 'Add a location.';
  else if (value.location.length > LIMITS.location) errors.location = `Keep the location under ${LIMITS.location} characters.`;

  return { valid: Object.keys(errors).length === 0, errors, value };
}

export function eventTypeLabel(event) {
  return event?.type === 'Custom' ? event.customType || 'Custom' : event?.type || 'Event';
}

export function validateInvitationName(name) {
  const value = clean(name);
  if (!value) return { valid: false, value, error: 'Give this invitation a name.' };
  if (value.length > LIMITS.invitationName) {
    return { valid: false, value, error: `Keep the name under ${LIMITS.invitationName} characters.` };
  }
  return { valid: true, value, error: null };
}

export function validateCategoryName(name, existingNames = []) {
  const value = clean(name);
  if (!value) return { valid: false, value, error: 'Type a guest list name.' };
  if (value.length > LIMITS.categoryName) {
    return { valid: false, value, error: `Keep it under ${LIMITS.categoryName} characters.` };
  }
  if (existingNames.some((n) => clean(n).toLowerCase() === value.toLowerCase())) {
    return { valid: false, value, error: 'This event already has a guest list with that name.' };
  }
  return { valid: true, value, error: null };
}
