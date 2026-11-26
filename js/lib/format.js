// Pure formatting helpers.

const ISO = /^(\d{4})-(\d{2})-(\d{2})$/;

/** Parse "YYYY-MM-DD" as a *local* calendar date (avoids the UTC off-by-one-day bug). */
export function parseISODate(iso) {
  const m = ISO.exec(iso || '');
  if (!m) return null;
  return new Date(Number(m[1]), Number(m[2]) - 1, Number(m[3]));
}

export function formatDate(iso, options = { weekday: 'short', year: 'numeric', month: 'short', day: 'numeric' }) {
  const date = parseISODate(iso);
  return date ? date.toLocaleDateString(undefined, options) : iso || '';
}

export function formatLongDate(iso) {
  return formatDate(iso, { weekday: 'long', year: 'numeric', month: 'long', day: 'numeric' });
}

export function todayISO(now = new Date()) {
  const p = (n) => String(n).padStart(2, '0');
  return `${now.getFullYear()}-${p(now.getMonth() + 1)}-${p(now.getDate())}`;
}

export function isPastDate(iso, now = new Date()) {
  return ISO.test(iso || '') && iso < todayISO(now);
}

export function formatBytes(bytes) {
  if (!Number.isFinite(bytes) || bytes < 0) return '';
  if (bytes < 1024) return `${bytes} B`;
  const units = ['KB', 'MB', 'GB'];
  let value = bytes / 1024;
  let i = 0;
  while (value >= 1024 && i < units.length - 1) {
    value /= 1024;
    i += 1;
  }
  return `${value >= 100 ? Math.round(value) : value.toFixed(1)} ${units[i]}`;
}

export function fileBaseName(filename) {
  return String(filename || '')
    .replace(/\.[^.]+$/, '')
    .replace(/[_-]+/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

export function firstName(name, fallback = 'there') {
  const first = String(name || '').trim().split(/\s+/)[0];
  return first || fallback;
}

export function initials(name) {
  const parts = String(name || '').trim().split(/\s+/).filter(Boolean);
  if (!parts.length) return '?';
  return (parts[0][0] + (parts.length > 1 ? parts[parts.length - 1][0] : '')).toUpperCase();
}
