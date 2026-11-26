import assert from 'node:assert/strict';
import { test } from 'node:test';

import { createDefaultDesign, applyTemplate, sanitizeDesign } from '../js/lib/design.js';
import { inspectFile, sniffMime } from '../js/lib/filetype.js';
import { formatBytes, formatDate, isPastDate, todayISO } from '../js/lib/format.js';
import { findRoute, matchPath, parseHash } from '../js/lib/route-match.js';
import { generateToken, isPlausibleToken, randomHex } from '../js/lib/token.js';
import { isValidISODate, validateCategoryName, validateEvent, validateInvitationName } from '../js/lib/validate.js';
import { buildConfig, parseEnv } from '../scripts/generate-config.mjs';
import { resolveRequestPath } from '../scripts/dev-server.mjs';

const bytes = (...arr) => new Uint8Array(arr);
const ascii = (s) => [...s].map((c) => c.charCodeAt(0));

test('event validation accepts a good event and trims whitespace', () => {
  const r = validateEvent({ name: '  Maria  &  Joel  ', type: 'Wedding', date: '2026-06-14', location: ' Garden ' });
  assert.equal(r.valid, true);
  assert.equal(r.value.name, 'Maria & Joel');
  assert.equal(r.value.location, 'Garden');
});

test('event validation reports every bad field', () => {
  const r = validateEvent({ name: '', type: 'Nope', date: '2026-02-31', location: '' });
  assert.equal(r.valid, false);
  assert.deepEqual(Object.keys(r.errors).sort(), ['date', 'location', 'name', 'type']);
});

test('Custom event type requires a custom name; other types drop it', () => {
  assert.equal(validateEvent({ name: 'x', type: 'Custom', date: '2026-01-01', location: 'y' }).errors.customType !== undefined, true);
  const ok = validateEvent({ name: 'x', type: 'Custom', customType: 'Baby Shower', date: '2026-01-01', location: 'y' });
  assert.equal(ok.valid, true);
  assert.equal(validateEvent({ name: 'x', type: 'Birthday', customType: 'ignored', date: '2026-01-01', location: 'y' }).value.customType, '');
});

test('date validation', () => {
  assert.equal(isValidISODate('2024-02-29'), true);
  assert.equal(isValidISODate('2023-02-29'), false);
  assert.equal(isValidISODate('2026-13-01'), false);
  assert.equal(isValidISODate('06/14/2026'), false);
});

test('category names: required, length-limited, unique per event (case-insensitive)', () => {
  assert.equal(validateCategoryName('', []).valid, false);
  assert.equal(validateCategoryName('x'.repeat(41), []).valid, false);
  assert.equal(validateCategoryName('family', ['Family']).valid, false);
  assert.equal(validateCategoryName('  VIP   Guests ', ['Family']).value, 'VIP Guests');
});

test('invitation name validation', () => {
  assert.equal(validateInvitationName('   ').valid, false);
  assert.equal(validateInvitationName('Ok').valid, true);
  assert.equal(validateInvitationName('x'.repeat(81)).valid, false);
});

test('share tokens are long, URL-safe, unique and plausible', () => {
  const set = new Set(Array.from({ length: 500 }, () => generateToken()));
  assert.equal(set.size, 500);
  for (const t of set) {
    assert.match(t, /^[A-Za-z0-9_-]{32}$/);
    assert.equal(isPlausibleToken(t), true);
  }
  assert.equal(isPlausibleToken('abc'), false);
  assert.equal(isPlausibleToken('../../etc/passwd'.padEnd(40, 'a')), false);
  assert.match(randomHex(16), /^[0-9a-f]{32}$/);
});

test('file sniffing trusts bytes, not names', () => {
  assert.equal(sniffMime(bytes(0xff, 0xd8, 0xff, 0xe0, 0, 0)), 'image/jpeg');
  assert.equal(sniffMime(bytes(0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a)), 'image/png');
  assert.equal(sniffMime(bytes(...ascii('RIFF'), 0, 0, 0, 0, ...ascii('WEBP'))), 'image/webp');
  assert.equal(sniffMime(bytes(...ascii('GIF89a'))), 'image/gif');
  assert.equal(sniffMime(bytes(0, 0, 0, 0x1c, ...ascii('ftypavif'))), 'image/avif');
  assert.equal(sniffMime(bytes(...ascii('%PDF-1.7\n'))), 'application/pdf');
  assert.equal(sniffMime(bytes(...ascii('<svg xmlns="http://www.w3.org/2000/svg"></svg>'))), null, 'SVG must be rejected');
  assert.equal(sniffMime(bytes(...ascii('<html><script>alert(1)</script>'))), null);
  assert.equal(sniffMime(bytes(0x4d, 0x5a, 0x90, 0)), null, 'executables rejected');
});

test('inspectFile enforces size and type', async () => {
  const png = new Blob([bytes(0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0, 0)], { type: 'image/png' });
  assert.deepEqual(await inspectFile(png, 1024), { ok: true, mime: 'image/png', kind: 'image' });
  assert.equal((await inspectFile(png, 4)).ok, false);
  assert.equal((await inspectFile(new Blob([]), 1024)).ok, false);
  const fake = new Blob([bytes(...ascii('MZ-not-an-image'))], { type: 'image/png' }); // lying MIME type
  assert.equal((await inspectFile(fake, 1024)).ok, false);
  const pdf = new Blob([bytes(...ascii('%PDF-1.4 hello'))], { type: 'application/octet-stream' });
  assert.equal((await inspectFile(pdf, 1024)).mime, 'application/pdf');
});

test('designs are sanitized: bad colors, fonts, enums and oversize text are clamped', () => {
  const d = sanitizeDesign({
    templateId: 'does-not-exist',
    text: { title: 'x'.repeat(999), message: 'a\u0000b\r\nc' },
    style: { textColor: 'red; background:url(x)', titleFont: 'Comic Sans', deco: 'evil', titleScale: 99, bodyScale: 'abc', align: 'diagonal' },
  });
  assert.equal(d.templateId, 'golden-classic');
  assert.equal(d.text.title.length, 120);
  assert.equal(d.text.message, 'ab\nc');
  assert.match(d.style.textColor, /^#[0-9a-f]{6}$/);
  assert.equal(d.style.titleFont, 'Cormorant Garamond');
  assert.equal(d.style.deco, 'none');
  assert.equal(d.style.titleScale, 1.6);
  assert.equal(d.style.bodyScale, 1);
  assert.equal(d.style.align, 'center');
  assert.deepEqual(sanitizeDesign(d), d, 'idempotent');
  assert.deepEqual(sanitizeDesign(null).text.title, '');
});

test('default design is prefilled from the event; switching template keeps the words', () => {
  const d = createDefaultDesign({ name: 'Maria & Joel', type: 'Wedding', date: '2026-06-14', location: 'Garden' });
  assert.equal(d.text.title, 'Maria & Joel');
  assert.match(d.text.date, /2026/);
  const next = applyTemplate(d, 'midnight-gala');
  assert.equal(next.templateId, 'midnight-gala');
  assert.equal(next.text.title, 'Maria & Joel');
  assert.equal(next.style.bgColor, '#14183a');
});

test('formatting helpers', () => {
  assert.equal(formatBytes(512), '512 B');
  assert.equal(formatBytes(1536), '1.5 KB');
  assert.equal(formatBytes(5 * 1024 * 1024), '5.0 MB');
  // "2026-06-14" must render as June 14 in every timezone (no UTC off-by-one)
  assert.match(formatDate('2026-06-14', { day: 'numeric', month: 'long' }), /14/);
  assert.equal(todayISO(new Date(2026, 0, 5)), '2026-01-05');
  assert.equal(isPastDate('2020-01-01', new Date(2026, 0, 5)), true);
  assert.equal(isPastDate('2030-01-01', new Date(2026, 0, 5)), false);
});

test('router matching', () => {
  assert.deepEqual(parseHash('#/events/a?cat=b'), { path: '/events/a', query: { cat: 'b' } });
  assert.deepEqual(parseHash(''), { path: '/', query: {} });
  assert.deepEqual(matchPath('/events/:id', '/events/42'), { id: '42' });
  assert.equal(matchPath('/events/:id', '/events/42/x'), null);
  assert.equal(matchPath('/s/:t', '/s/%E0%A4%A'), null, 'malformed encoding is not a match');
  const routes = [{ path: '/events/new' }, { path: '/events/:id' }];
  assert.equal(findRoute(routes, '/events/new').route.path, '/events/new', 'static route wins over :id');
});

test('.env parsing and missing-value detection', () => {
  const env = parseEnv('# c\nFIREBASE_API_KEY="abc"\nFIREBASE_PROJECT_ID=p # note\n\nBAD LINE\n');
  assert.deepEqual(env, { FIREBASE_API_KEY: 'abc', FIREBASE_PROJECT_ID: 'p' });
  const { missing } = buildConfig({
    envFile: '/nonexistent',
    env: {
      FIREBASE_API_KEY: 'k',
      FIREBASE_AUTH_DOMAIN: 'your-project-id.firebaseapp.com',
      SUPABASE_URL: 'https://your-project-ref.supabase.co',
      SUPABASE_ANON_KEY: 'your-supabase-anon-or-publishable-key',
      SUPABASE_BUCKET: 'invitations',
    },
  });
  assert.ok(missing.includes('FIREBASE_AUTH_DOMAIN'), 'placeholder values count as missing');
  assert.ok(missing.includes('FIREBASE_APP_ID'));
  assert.ok(missing.includes('SUPABASE_URL'), 'placeholder Supabase URL counts as missing');
  assert.ok(missing.includes('SUPABASE_ANON_KEY'));
  assert.ok(!missing.includes('SUPABASE_BUCKET'));
});

test('dev server only serves app files, never secrets or traversal paths', () => {
  assert.ok(resolveRequestPath('/'));
  assert.ok(resolveRequestPath('/js/main.js'));
  assert.equal(resolveRequestPath('/.env'), null);
  assert.equal(resolveRequestPath('/package.json'), null);
  assert.equal(resolveRequestPath('/firestore.rules'), null);
  assert.equal(resolveRequestPath('/../etc/passwd'), null);
  assert.equal(resolveRequestPath('/js/../.env'), null);
  assert.equal(resolveRequestPath('/js/%2e%2e/.env'), null);
});
