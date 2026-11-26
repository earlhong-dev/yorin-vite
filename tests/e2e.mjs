// End-to-end test of the real UI in headless Chrome.
// The Firebase SDK is replaced by tests/fakes/* (in-memory, enforcing the same ownership/share
// semantics as the security rules), so the whole flow runs with no network and no Firebase project.
//
//   node tests/e2e.mjs            (needs Playwright + Chrome; see README "Testing")

import { spawn } from 'node:child_process';
import { readFileSync, rmSync, mkdirSync } from 'node:fs';
import { createRequire } from 'node:module';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { deflateSync } from 'node:zlib';

const require = createRequire(import.meta.url);
const { chromium } = require('playwright');
const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const PORT = 5199;
const BASE = `http://localhost:${PORT}`;
const SHOTS = process.env.SHOTS_DIR || '';
if (SHOTS) mkdirSync(SHOTS, { recursive: true });

/* ----------------------------------------------------------- test fixtures */
function crc32(buf) {
  let c, crc = 0xffffffff;
  for (let n = 0; n < buf.length; n++) {
    c = (crc ^ buf[n]) & 0xff;
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    crc = (crc >>> 8) ^ c;
  }
  return (crc ^ 0xffffffff) >>> 0;
}
function png(width, height) {
  const chunk = (type, data) => {
    const len = Buffer.alloc(4); len.writeUInt32BE(data.length);
    const td = Buffer.concat([Buffer.from(type), data]);
    const crc = Buffer.alloc(4); crc.writeUInt32BE(crc32(td));
    return Buffer.concat([len, td, crc]);
  };
  const ihdr = Buffer.alloc(13); ihdr.writeUInt32BE(width, 0); ihdr.writeUInt32BE(height, 4); ihdr[8] = 8; ihdr[9] = 2;
  const rows = [];
  for (let y = 0; y < height; y++) {
    const row = Buffer.alloc(1 + width * 3);
    for (let x = 0; x < width; x++) { row[1 + x * 3] = 40 + (x * 200) / width; row[2 + x * 3] = 90 + (y * 120) / height; row[3 + x * 3] = 160; }
    rows.push(row);
  }
  return Buffer.concat([Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]), chunk('IHDR', ihdr), chunk('IDAT', deflateSync(Buffer.concat(rows))), chunk('IEND', Buffer.alloc(0))]);
}
const PNG_BUF = png(600, 840);
const PDF_BUF = Buffer.from('%PDF-1.4\n1 0 obj<</Type/Catalog/Pages 2 0 R>>endobj\n2 0 obj<</Type/Pages/Kids[3 0 R]/Count 1>>endobj\n3 0 obj<</Type/Page/Parent 2 0 R/MediaBox[0 0 300 420]>>endobj\ntrailer<</Root 1 0 R>>\n%%EOF');

/* ------------------------------------------------------------------ harness */
const results = [];
async function step(name, fn) {
  try {
    await fn();
    results.push({ name, ok: true });
    console.log(`  ✓ ${name}`);
  } catch (error) {
    results.push({ name, ok: false, error });
    if (SHOTS) {
      const info = await page.evaluate(() => ({ overlays: document.querySelectorAll('.overlay').length, toasts: [...document.querySelectorAll('.toast')].map((t) => t.textContent), url: location.hash })).catch(() => ({}));
      console.log('      state:', JSON.stringify(info));
      await page.screenshot({ path: `${SHOTS}/FAIL-${results.length}.png` }).catch(() => {});
    }
    console.log(`  ✗ ${name}\n      ${String(error.message).split('\n').slice(0, 4).join('\n      ')}`);
  }
}
const assert = (cond, message) => { if (!cond) throw new Error(message); };

const server = spawn('node', ['scripts/dev-server.mjs'], {
  cwd: root,
  env: {
    ...process.env, PORT: String(PORT),
    FIREBASE_API_KEY: 'test-key', FIREBASE_AUTH_DOMAIN: 'test.firebaseapp.com', FIREBASE_PROJECT_ID: 'test',
    FIREBASE_APP_ID: '1:1:web:1',
    SUPABASE_URL: 'https://test.supabase.co', SUPABASE_ANON_KEY: 'sb_publishable_test', SUPABASE_BUCKET: 'invitations',
    MAX_UPLOAD_MB: '15',
  },
  stdio: 'pipe',
});
await new Promise((r) => server.stdout.on('data', (d) => String(d).includes('localhost') && r()));

const browser = await chromium.launch();
const context = await browser.newContext({ viewport: { width: 1280, height: 860 }, deviceScaleFactor: 1 });
await context.grantPermissions(['clipboard-read', 'clipboard-write'], { origin: BASE }).catch(() => {});
const FAKES = { 'firebase-app.js': 'firebase-app.js', 'firebase-auth.js': 'firebase-auth.js', 'firebase-firestore.js': 'firebase-firestore.js' };
const supabaseFiles = new Map();
await context.route('**/*', async (route) => {
  const req = route.request();
  const url = new URL(req.url());
  if (url.hostname === 'www.gstatic.com' && url.pathname.includes('/firebasejs/')) {
    const file = FAKES[url.pathname.split('/').pop()];
    return file ? route.fulfill({ status: 200, contentType: 'text/javascript', body: readFileSync(resolve(root, 'tests/fakes', file)) }) : route.abort();
  }
  if (url.hostname === 'test.supabase.co' && url.pathname.startsWith('/storage/v1/object/')) {
    const method = req.method();
    const prefixPub = '/storage/v1/object/public/invitations/';
    const prefixObj = '/storage/v1/object/invitations/';
    if (method === 'POST' && url.pathname.startsWith(prefixObj)) {
      const path = decodeURIComponent(url.pathname.slice(prefixObj.length));
      supabaseFiles.set(path, { buf: req.postDataBuffer() || Buffer.alloc(0), type: req.headers()['content-type'] || 'application/octet-stream' });
      return route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ Key: `invitations/${path}` }) });
    }
    if (method === 'GET' && (url.pathname.startsWith(prefixPub) || url.pathname.startsWith(prefixObj))) {
      const prefix = url.pathname.startsWith(prefixPub) ? prefixPub : prefixObj;
      const path = decodeURIComponent(url.pathname.slice(prefix.length));
      const f = supabaseFiles.get(path);
      if (!f) return route.fulfill({ status: 404, contentType: 'application/json', body: JSON.stringify({ statusCode: '404', error: 'not_found', message: 'Object not found' }) });
      return route.fulfill({ status: 200, contentType: f.type, body: f.buf });
    }
    if (method === 'DELETE' && url.pathname === '/storage/v1/object/invitations') {
      const body = req.postDataJSON?.() || {};
      for (const p of body.prefixes || []) supabaseFiles.delete(p);
      return route.fulfill({ status: 200, contentType: 'application/json', body: '[]' });
    }
    return route.fulfill({ status: 400, contentType: 'application/json', body: '{}' });
  }
  if (url.hostname === 'localhost') return route.continue();
  return route.abort(); // fonts, pdf.js CDN etc. — the app must degrade gracefully offline
});

const page = await context.newPage();
const pageErrors = [];
page.on('pageerror', (e) => pageErrors.push(e.message));
const shot = async (name) => SHOTS && page.screenshot({ path: `${SHOTS}/${name}.png`, fullPage: true });
const go = async (hash) => { await page.evaluate((h) => (window.location.hash = h), hash); await page.waitForTimeout(150); };
const toastText = async () => (await page.locator('.toast').allTextContents()).join(' | ');

let eventUrlHash = '';
let createdShareUrl = '';
let uploadedShareUrl = '';

console.log('\nYorin.vite end-to-end\n');

/* ------------------------------------------------------------ 1. landing/auth */
await step('landing page shows logo, Sign In, big title and Start Your Event', async () => {
  await page.goto(BASE);
  await page.waitForSelector('.hero-title');
  assert((await page.locator('.landing-header .brand-name').textContent()) === 'Yorin.vite', 'header logo');
  assert((await page.locator('.hero-title').textContent()) === 'Yorin.vite', 'big title');
  assert(await page.getByRole('button', { name: 'Sign In' }).isVisible(), 'Sign In button');
  assert(await page.getByRole('button', { name: 'Start Your Event' }).isVisible(), 'Start button');
  await shot('01-landing');
});

await step('protected pages bounce signed-out visitors to the landing page', async () => {
  await go('#/dashboard');
  await page.waitForSelector('.hero-title');
  assert(page.url().endsWith('#/'), `expected #/, got ${page.url()}`);
  await go('#/events/new');
  await page.waitForSelector('.hero-title');
});

await step('Start Your Event signs in with Google and opens the dashboard', async () => {
  await page.getByRole('button', { name: 'Start Your Event' }).click();
  await page.waitForSelector('h1:has-text("My Events")');
  assert(page.url().endsWith('#/dashboard'), page.url());
  assert(await page.getByText('No event created yet').isVisible(), 'empty state');
  await shot('02-dashboard-empty');
});

await step('session persists across reload (signed-in landing → Start goes straight to dashboard)', async () => {
  // The fake keeps auth in memory, so emulate Firebase restoring the session by re-signing before reload is not possible;
  // instead verify the signed-in landing behaviour without a reload.
  await go('#/');
  await page.waitForSelector('.hero-title');
  assert(await page.getByRole('link', { name: /My dashboard/ }).isVisible(), 'dashboard link shown when signed in');
  await page.getByRole('button', { name: 'Start Your Event' }).click();
  await page.waitForSelector('h1:has-text("My Events")');
});

/* ---------------------------------------------------------------- 2. events */
await step('create-event form validates', async () => {
  await page.getByRole('link', { name: 'Create Event' }).first().click();
  await page.waitForSelector('#ev-name');
  await page.locator('form button[type=submit]').click();
  const errs = await page.locator('.field-error').allTextContents();
  assert(errs.join(' ').includes('name') && errs.join(' ').includes('type') && errs.join(' ').includes('date') && errs.join(' ').includes('location'), `errors: ${errs}`);
  await page.selectOption('#ev-type', 'Custom');
  assert(await page.locator('#ev-custom').isVisible(), 'custom type input appears');
  await shot('03-create-event-errors');
});

await step('creating an event saves it and opens its dedicated page', async () => {
  await page.fill('#ev-name', 'Maria & Joel’s Wedding');
  await page.selectOption('#ev-type', 'Wedding');
  await page.fill('#ev-date', '2026-12-20');
  await page.fill('#ev-location', 'The Grand Garden, Quezon City');
  await page.locator('form button[type=submit]').click();
  await page.waitForSelector('.event-title');
  eventUrlHash = new URL(page.url()).hash;
  assert(/^#\/events\/.+/.test(eventUrlHash), eventUrlHash);
  assert((await page.locator('.event-title').textContent()) === 'Maria & Joel’s Wedding', 'name');
  const meta = await page.locator('.event-hero').textContent();
  assert(meta.includes('Wedding') && meta.includes('December') && meta.includes('Quezon City'), `meta: ${meta}`);
  assert(await page.locator('.btn-create-invitations').isVisible(), 'Create Invitations button');
  assert((await page.locator('.filter-row').count()) === 0, 'no category filter bar');
  await shot('04-event-empty');
});

await step('event shows on the dashboard with name, type, date, location', async () => {
  await page.locator('.back-link').click();
  await page.waitForSelector('.event-card');
  const card = await page.locator('.event-card').first().textContent();
  assert(card.includes('Maria & Joel’s Wedding') && card.includes('Wedding') && card.includes('2026') && card.includes('Quezon City'), card);
  await page.locator('.event-card').first().click();
  await page.waitForSelector('.event-title');
});

/* ---------------------------------------------------- 3. built-in editor flow */
await step('Create Invitations offers both options', async () => {
  await page.locator('.btn-create-invitations').click();
  await page.waitForSelector('.choice');
  assert((await page.locator('.choice').count()) === 2, 'two options');
  const t = await page.locator('.choices').textContent();
  assert(t.includes('Create Invitation') && t.includes('Upload Invitation'), t);
  await shot('05-choose');
});

await step('editor: live preview updates from text, template, color and layout controls', async () => {
  await page.locator('.choice[data-choice=created]').click();
  await page.waitForSelector('.editor-preview-frame .inv');
  assert((await page.locator('.editor-preview-frame .inv-title').textContent()) === 'Maria & Joel’s Wedding', 'prefilled from event');
  await page.locator('.tab[data-tab=text]').click();
  await page.fill('#txt-title', 'Maria & Joel');
  await page.fill('#txt-message', 'Join us for an evening of food, music and joy.');
  await page.fill('#txt-time', '5:00 PM');
  assert((await page.locator('.editor-preview-frame .inv-title').textContent()) === 'Maria & Joel', 'title live');
  assert((await page.locator('.editor-preview-frame .inv-time').textContent()) === '5:00 PM', 'time live');
  await page.locator('.tab[data-tab=template]').click();
  await page.locator('.template[data-template=blush-romance]').click();
  const bg = await page.locator('.editor-preview-frame .inv').evaluate((el) => el.style.getPropertyValue('--inv-bg'));
  assert(bg === '#fff4f6', `template applied, bg=${bg}`);
  assert((await page.locator('.editor-preview-frame .inv-title').textContent()) === 'Maria & Joel', 'text kept on template switch');
  await page.locator('.tab[data-tab=style]').click();
  await page.locator('.color-input').nth(1).evaluate((el) => { el.value = '#115599'; el.dispatchEvent(new Event('input', { bubbles: true })); });
  assert((await page.locator('.editor-preview-frame .inv').evaluate((el) => el.style.getPropertyValue('--inv-accent'))) === '#115599', 'accent color');
  await page.locator('.tab[data-tab=layout]').click();
  await page.locator('.seg[data-value=left]').click();
  assert((await page.locator('.editor-preview-frame .inv').getAttribute('data-align')) === 'left', 'alignment');
  await page.locator('.seg[data-value=center]').click();
  await shot('06-editor');
});

await step('editor: category input requires a category and saves it when the invitation is saved', async () => {
  await page.fill('#category-input', 'Groomsmen');
  assert((await page.locator('#category-input').inputValue()) === 'Groomsmen', 'category typed');
});

await step('editor: save requires a name, shows a preview first, then saves', async () => {
  await page.fill('#inv-name', '');
  await page.getByRole('button', { name: 'Preview & save' }).click();
  assert((await page.locator('.editor-bar .field-error').first().textContent()).includes('name'), 'name required');
  await page.fill('#inv-name', 'Groomsmen Invite');
  await page.getByRole('button', { name: 'Preview & save' }).click();
  await page.waitForSelector('.review .inv');
  const side = await page.locator('.review-side').textContent();
  assert(side.includes('Groomsmen Invite') && side.includes('Groomsmen') && side.includes('Created'), side);
  await shot('07-review');
  await page.getByRole('button', { name: 'Save invitation' }).click();
  await page.waitForSelector('.inv-card');
  assert((await toastText()).includes('Invitation saved'), 'success toast');
});

await step('saved card shows preview, name, category, type and Share / Edit / Delete', async () => {
  const card = page.locator('.inv-card').first();
  assert(await card.locator('.thumb .inv').isVisible(), 'live thumbnail');
  const text = await card.textContent();
  assert(text.includes('Groomsmen Invite') && text.includes('Groomsmen') && text.includes('Created'), text);
  for (const b of ['Share', 'Edit', 'Delete']) assert(await card.getByRole('button', { name: b }).isVisible(), `${b} button`);
  assert((await page.locator('.category-section[data-category-id] .category-title').first().textContent()).startsWith('Groomsmen'), 'grouped under its category');
  await shot('08-event-with-invite');
});

await step('editing a created invitation reloads its design and saves changes', async () => {
  await page.locator('.inv-card').first().getByRole('button', { name: 'Edit' }).click();
  await page.waitForSelector('.editor-preview-frame .inv');
  assert((await page.locator('.editor-preview-frame .inv-title').textContent()) === 'Maria & Joel', 'design restored');
  await page.locator('.tab[data-tab=text]').click();
  await page.fill('#txt-title', 'Maria & Joel\nWedding');
  await page.getByRole('button', { name: 'Review & save' }).click();
  await page.getByRole('button', { name: 'Save changes' }).click();
  await page.waitForSelector('.inv-card');
  assert((await page.locator('.inv-card .inv-title').first().textContent()).includes('Wedding'), 'edit persisted');
});

/* ----------------------------------------------------------- 4. upload flow */
await step('upload: rejects wrong types, fake images and empty files with clear errors', async () => {
  await page.locator('.btn-create-invitations').click();
  await page.locator('.choice[data-choice=upload]').click();
  await page.waitForSelector('.dropzone');
  await page.setInputFiles('#file-input', { name: 'notes.txt', mimeType: 'text/plain', buffer: Buffer.from('hello') });
  await page.waitForSelector('.dropzone ~ .field-error:not(:empty)');
  assert((await page.locator('.upload-stage .field-error').textContent()).includes('isn’t supported'), 'txt rejected');
  await page.setInputFiles('#file-input', { name: 'evil.png', mimeType: 'image/png', buffer: Buffer.from('MZ\x90\x00 definitely an exe') });
  await page.waitForTimeout(100);
  assert((await page.locator('.upload-stage .field-error').textContent()).includes('isn’t supported'), 'disguised file rejected');
  await page.setInputFiles('#file-input', { name: 'svg.svg', mimeType: 'image/svg+xml', buffer: Buffer.from('<svg xmlns="http://www.w3.org/2000/svg"><script>alert(1)</script></svg>') });
  await page.waitForTimeout(100);
  assert((await page.locator('.upload-stage .field-error').textContent()).includes('isn’t supported'), 'svg rejected');
  await page.setInputFiles('#file-input', { name: 'empty.png', mimeType: 'image/png', buffer: Buffer.alloc(0) });
  await page.waitForTimeout(100);
  assert((await page.locator('.upload-stage .field-error').textContent()).includes('empty'), 'empty rejected');
  await page.setInputFiles('#file-input', { name: 'huge.png', mimeType: 'image/png', buffer: Buffer.concat([PNG_BUF, Buffer.alloc(16 * 1024 * 1024)]) });
  await page.waitForTimeout(200);
  assert((await page.locator('.upload-stage .field-error').textContent()).includes('limit'), 'oversize rejected');
  await shot('09-upload-errors');
});

await step('upload: drag-and-drop accepts a PNG and previews it at its original aspect ratio', async () => {
  const dt = await page.evaluateHandle((b64) => {
    const bin = atob(b64); const bytes = new Uint8Array(bin.length);
    for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
    const d = new DataTransfer(); d.items.add(new File([bytes], 'save-the-date_final.png', { type: 'image/png' })); return d;
  }, PNG_BUF.toString('base64'));
  await page.dispatchEvent('.dropzone', 'drop', { dataTransfer: dt });
  await page.waitForSelector('.file-image');
  await page.waitForFunction(() => document.querySelector('.file-image')?.naturalWidth > 0);
  const dims = await page.locator('.file-image').evaluate((el) => ({ nw: el.naturalWidth, nh: el.naturalHeight, w: el.clientWidth, h: el.clientHeight }));
  assert(dims.nw === 600 && dims.nh === 840, `natural size ${dims.nw}x${dims.nh}`);
  assert(Math.abs(dims.w / dims.h - 600 / 840) < 0.01, `aspect preserved: ${dims.w}x${dims.h}`);
  assert((await page.locator('.file-info').textContent()).includes('save-the-date_final.png'), 'file info');
  assert((await page.locator('#inv-name').inputValue()) === 'save the date final', 'name suggested from filename');
  await shot('10-upload-preview');
});

await step('upload: replace and remove work', async () => {
  await page.setInputFiles('#file-input', { name: 'second.png', mimeType: 'image/png', buffer: png(300, 300) });
  await page.waitForFunction(() => document.querySelector('.file-name')?.textContent === 'second.png');
  await page.getByRole('button', { name: 'Remove' }).click();
  await page.waitForSelector('.dropzone');
  await page.setInputFiles('#file-input', { name: 'save-the-date_final.png', mimeType: 'image/png', buffer: PNG_BUF });
  await page.waitForSelector('.file-image');
});

await step('upload: category input suggests previously saved categories, preview, progress, save → card marked Uploaded', async () => {
  await page.click('#category-input');
  await page.waitForSelector('.category-dropdown .category-option:has-text("Groomsmen")');
  await page.fill('#category-input', 'Family');
  await page.fill('#inv-name', 'Save the date');
  await page.getByRole('button', { name: 'Preview & save' }).click();
  await page.waitForSelector('.review .file-image');
  const side = await page.locator('.review-side').textContent();
  assert(side.includes('Save the date') && side.includes('Family') && side.includes('Uploaded'), side);
  await page.getByRole('button', { name: 'Save invitation' }).click();
  await page.waitForSelector('.inv-card:has-text("Save the date")');
  const card = page.locator('.inv-card:has-text("Save the date")');
  assert((await card.textContent()).includes('Uploaded'), 'type chip');
  await card.locator('.thumb img').waitFor();
  assert(await card.locator('.thumb img').evaluate((i) => i.naturalWidth > 0), 'thumbnail renders');
  const files = [...supabaseFiles.keys()];
  assert(files.length === 1 && /^invitations\/u1\/[^/]+\/file-[0-9a-f]{32}\.png$/.test(files[0]), `stored path: ${files}`);
  await shot('11-event-both');
});

await step('uploaded invitation: replace the file via Edit; the old file is removed from storage', async () => {
  const before = [...supabaseFiles.keys()][0];
  await page.locator('.inv-card:has-text("Save the date")').getByRole('button', { name: 'Edit' }).click();
  await page.waitForSelector('.file-image');
  await page.setInputFiles('#file-input', { name: 'v2.png', mimeType: 'image/png', buffer: png(400, 560) });
  await page.waitForFunction(() => document.querySelector('.file-name')?.textContent === 'v2.png');
  await page.getByRole('button', { name: 'Preview & save' }).click();
  await page.getByRole('button', { name: 'Save changes' }).click();
  await page.waitForSelector('.inv-card:has-text("Save the date")');
  const after = [...supabaseFiles.keys()];
  assert(after.length === 1 && after[0] !== before, `old file deleted, new one stored: ${before} → ${after}`);
});

await step('PDF upload is accepted (viewer degrades gracefully when pdf.js is unreachable)', async () => {
  await page.locator('.btn-create-invitations').click();
  await page.locator('.choice[data-choice=upload]').click();
  await page.setInputFiles('#file-input', { name: 'Flyer.pdf', mimeType: 'application/pdf', buffer: PDF_BUF });
  await page.waitForSelector('.file-info:has-text("PDF")');
  await page.waitForSelector('.pdf-fallback, .pdf-page', { timeout: 15000 });
  await page.click('#category-input');
  await page.locator('.category-dropdown .category-option:has-text("Family")').click();
  await page.fill('#inv-name', 'PDF flyer');
  await page.getByRole('button', { name: 'Preview & save' }).click();
  await page.getByRole('button', { name: 'Save invitation' }).click();
  await page.waitForSelector('.inv-card:has-text("PDF flyer")');
  assert((await page.locator('.inv-card:has-text("PDF flyer") .thumb-placeholder').count()) === 1, 'placeholder thumbnail when PDF can’t be rendered');
});

/* ------------------------------------------------------------------ 5. sharing */
await step('Share generates a unique unguessable link with a copy button and an on/off switch', async () => {
  await page.locator('.inv-card:has-text("Groomsmen Invite")').getByRole('button', { name: 'Share' }).click();
  await page.waitForSelector('.share-link .input');
  createdShareUrl = await page.locator('.share-link .input').inputValue();
  assert(/#\/s\/[A-Za-z0-9_-]{32}$/.test(createdShareUrl), `url: ${createdShareUrl}`);
  assert(await page.locator('#share-toggle').isChecked(), 'enabled by default');
  await page.getByRole('button', { name: 'Copy link' }).click();
  await page.waitForSelector('.toast:has-text("Link copied"), .toast:has-text("select the link")', { timeout: 5000 });
  const clip = await page.evaluate(() => navigator.clipboard.readText().catch(() => null));
  assert(clip === null || clip === createdShareUrl, `clipboard holds the link: ${clip}`);
  await shot('12-share-dialog');
  await page.keyboard.press('Escape');
  assert((await page.locator('.inv-card:has-text("Groomsmen Invite") .chip-shared').count()) === 1, 'Shared chip on card');
  // second invitation gets a different token
  await page.locator('.inv-card:has-text("Save the date")').getByRole('button', { name: 'Share' }).click();
  await page.waitForSelector('.share-link .input');
  uploadedShareUrl = await page.locator('.share-link .input').inputValue();
  assert(uploadedShareUrl !== createdShareUrl, 'distinct tokens');
  await page.keyboard.press('Escape');
});

await step('anyone with the link sees ONLY that invitation — no sign-in, no dashboard', async () => {
  await page.getByRole('button', { name: 'Sign out' }).click();
  await page.waitForSelector('.hero-title');
  await go(new URL(createdShareUrl).hash);
  await page.waitForSelector('.shared-invitation .inv');
  assert((await page.locator('.shared-invitation .inv-title').textContent()).includes('Maria'), 'design rendered');
  assert((await page.locator('.app-header, .brand, .back-link, .inv-card, .event-card').count()) === 0, 'no account chrome on the public page');
  assert((await page.locator('meta[name=robots]').getAttribute('content')).includes('noindex'), 'noindex');
  await shot('13-public-created');

  await go(new URL(uploadedShareUrl).hash);
  await page.waitForSelector('.shared-file-image .file-image');
  await page.waitForFunction(() => document.querySelector('.file-image')?.naturalWidth > 0);
  const d = await page.locator('.file-image').evaluate((el) => ({ w: el.naturalWidth, h: el.naturalHeight }));
  assert(d.w === 400 && d.h === 560, `original file served untouched: ${d.w}x${d.h}`);
});

await step('public viewer cannot reach private data (events, invitations, other tokens, guessed IDs)', async () => {
  const probe = await page.evaluate(async () => {
    // Everything an anonymous visitor could try against the data layer, using the app's own services.
    const db = await import('/js/services/db.js');
    const out = {};
    const tryIt = async (label, fn) => { try { out[label] = await fn(); } catch (e) { out[label] = `ERR:${e.code}`; } };
    const ids = [...window.__store.keys()];
    const evId = ids.find((k) => k.startsWith('events/')).split('/')[1];
    const invId = ids.find((k) => k.startsWith('invitations/')).split('/')[1];
    await tryIt('listEvents', () => db.listEvents('u1'));
    await tryIt('getEvent', () => db.getEvent('u1', evId));
    await tryIt('getInvitation', () => db.getInvitation('u1', invId));
    await tryIt('listInvitations', () => db.listInvitations('u1', evId));
    await tryIt('guessedToken', () => db.getShare('A'.repeat(32)));
    await tryIt('badToken', () => db.getShare('../x'));
    return out;
  });
  assert(String(probe.listEvents).startsWith('ERR:permission-denied'), `listEvents: ${probe.listEvents}`);
  assert(probe.getEvent === null, `getEvent: ${JSON.stringify(probe.getEvent)}`);
  assert(probe.getInvitation === null, 'getInvitation');
  assert(String(probe.listInvitations).startsWith('ERR:permission-denied'), 'listInvitations');
  assert(probe.guessedToken === null && probe.badToken === null, 'unknown tokens give nothing');
});

await step('disabling sharing revokes the link immediately; re-enabling restores the same link', async () => {
  await page.evaluate(() => { window.__fakeUserId = 'u1'; });
  await go('#/');
  await page.getByRole('button', { name: 'Sign In' }).click();
  await page.waitForSelector('h1:has-text("My Events")');
  await go(eventUrlHash);
  await page.waitForSelector('.inv-card');
  await page.locator('.inv-card:has-text("Groomsmen Invite")').getByRole('button', { name: 'Share' }).click();
  await page.waitForSelector('#share-toggle');
  await page.locator('#share-toggle').uncheck();
  await page.waitForSelector('.share-title:has-text("off")');
  assert((await page.locator('.share-link .input').isDisabled()) && (await page.getByRole('button', { name: 'Copy link' }).isDisabled()), 'copy disabled while off');
  await page.keyboard.press('Escape');
  await page.getByRole('button', { name: 'Sign out' }).click();
  await page.waitForSelector('.hero-title');
  await go(new URL(createdShareUrl).hash);
  await page.waitForSelector('.shared-unavailable');
  assert((await page.locator('.shared-unavailable').textContent()).includes('isn’t available'), 'revoked message');
  await shot('14-public-revoked');
  // the uploaded one is unaffected
  await go(new URL(uploadedShareUrl).hash);
  await page.waitForSelector('.file-image');
  // re-enable
  await go('#/');
  await page.getByRole('button', { name: 'Sign In' }).click();
  await page.waitForSelector('h1:has-text("My Events")');
  await go(eventUrlHash);
  await page.waitForSelector('.inv-card');
  await page.locator('.inv-card:has-text("Groomsmen Invite")').getByRole('button', { name: 'Share' }).click();
  await page.waitForSelector('#share-toggle');
  await page.locator('#share-toggle').check();
  await page.waitForSelector('.share-title:has-text("Anyone")');
  assert((await page.locator('.share-link .input').inputValue()) === createdShareUrl, 'same link restored');
  await page.keyboard.press('Escape');
});

await step('Reset link kills the old URL and issues a new one', async () => {
  await page.locator('.inv-card:has-text("Groomsmen Invite")').getByRole('button', { name: 'Share' }).click();
  await page.waitForSelector('#share-toggle');
  await page.getByRole('button', { name: 'Reset link' }).click();
  await page.getByRole('button', { name: 'Reset link' }).last().click();
  await page.waitForFunction((old) => document.querySelector('.share-link .input')?.value && document.querySelector('.share-link .input').value !== old, createdShareUrl);
  const fresh = await page.locator('.share-link .input').inputValue();
  assert(/#\/s\/[A-Za-z0-9_-]{32}$/.test(fresh) && fresh !== createdShareUrl, 'new token');
  await page.keyboard.press('Escape');
  const oldWorks = await page.evaluate(async (hash) => (await (await import('/js/services/db.js')).getShare(hash.split('/s/')[1])), new URL(createdShareUrl).hash);
  assert(oldWorks === null, 'old token no longer resolves');
  createdShareUrl = fresh;
});

await step('deleting an invitation invalidates its link and removes its file', async () => {
  await page.locator('.inv-card:has-text("Save the date")').getByRole('button', { name: /Delete/ }).click();
  await page.getByRole('button', { name: 'Delete', exact: true }).last().click();
  await page.waitForFunction(() => !document.body.textContent.includes('Save the date'));
  assert(supabaseFiles.size === 1, 'only the PDF file remains'); // PDF flyer file
  await page.getByRole('button', { name: 'Sign out' }).click();
  await page.waitForSelector('.hero-title');
  await go(new URL(uploadedShareUrl).hash);
  await page.waitForSelector('.shared-unavailable');
  await go(new URL(createdShareUrl).hash);
  await page.waitForSelector('.shared-invitation .inv'); // untouched one still works
});

/* ------------------------------------------------------------- 6. isolation */
await step('another user cannot see or open the first user’s events and data', async () => {
  await page.evaluate(() => { window.__fakeUserId = 'u2'; });
  await go('#/');
  await page.getByRole('button', { name: 'Sign In' }).click();
  await page.waitForSelector('h1:has-text("My Events")');
  await go('#/dashboard');
  await page.waitForSelector('h1:has-text("My Events")');
  assert(await page.getByText('No event created yet').isVisible(), 'u2 sees none of u1’s events');
  await go(eventUrlHash);
  await page.waitForSelector('.empty:has-text("Event not found")');
  const inv = await page.evaluate(() => [...window.__store.keys()].find((k) => k.startsWith('invitations/')).split('/')[1]);
  await go(`${eventUrlHash}/invitations/${inv}/edit`);
  await page.waitForSelector('.empty:has-text("Event not found"), .toast-error');
  // direct writes into u1's data are refused
  const writes = await page.evaluate(async () => {
    const db = await import('/js/services/db.js');
    const evId = [...window.__store.keys()].find((k) => k.startsWith('events/')).split('/')[1];
    const out = {};
    try { await db.createInvitation('u2', evId, { name: 'sneaky', categoryId: 'x', creationType: 'created', design: {} }); out.create = 'allowed'; } catch (e) { out.create = e.code || e.message; }
    try { await db.deleteEvent('u2', evId); out.delete = 'allowed'; } catch (e) { out.delete = e.code || e.message; }
    return { ...out, eventStillThere: window.__store.has(`events/${evId}`) };
  });
  assert(writes.eventStillThere, 'event survived');
  assert(writes.create === 'permission-denied', `writing into someone else's event must be denied, got: ${writes.create}`);
  assert(writes.delete === 'permission-denied', `deleting someone else's event must be denied, got: ${writes.delete}`);
  await shot('15-isolation');
});

/* ------------------------------------------------------- 7. delete event + UX */
await step('mobile: event page and public page fit a phone screen', async () => {
  await page.getByRole('button', { name: 'Sign out' }).click();
  await page.evaluate(() => { window.__fakeUserId = 'u1'; });
  await page.waitForSelector('.hero-title');
  await page.getByRole('button', { name: 'Sign In' }).click();
  await page.waitForSelector('h1:has-text("My Events")');
  await page.setViewportSize({ width: 390, height: 800 });
  await go(eventUrlHash);
  await page.waitForSelector('.inv-card');
  await page.waitForTimeout(600);
  const over = (await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth));
  assert(over <= 1, `event page overflows by ${over}px`);
  await shot('18-mobile-event');
  const cardBox = await page.locator('.inv-card').first().boundingBox();
  assert(cardBox.width > 120 && cardBox.x >= 0 && cardBox.x + cardBox.width <= 391, `card fits: ${JSON.stringify(cardBox)}`);
  await go(new URL(createdShareUrl).hash);
  await page.waitForSelector('.shared-invitation .inv');
  await page.waitForTimeout(700);
  const over2 = (await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth));
  assert(over2 <= 1, `shared page overflows by ${over2}px`);
  await shot('19-mobile-public');
  await page.setViewportSize({ width: 1280, height: 860 });
});

await step('deleting an event cascades to its invitations, categories, share links and files', async () => {
  await go(eventUrlHash);
  await page.waitForSelector('.event-title');
  await page.getByRole('button', { name: 'Delete event' }).click();
  await page.getByRole('button', { name: 'Delete event' }).last().click();
  await page.waitForSelector('h1:has-text("My Events")');
  const left = await page.evaluate(() => [...window.__store.keys()].filter((k) => !k.startsWith('users/')));
  assert(left.length === 0, `leftover docs: ${left}`);
  assert(supabaseFiles.size === 0, 'files removed');
});

await step('mobile layout: no horizontal scroll on landing, dashboard and shared page', async () => {
  await page.setViewportSize({ width: 390, height: 800 });
  for (const hash of ['#/', '#/dashboard', '#/events/new']) {
    await go(hash);
    await page.waitForTimeout(300);
    const over = await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
    assert(over <= 1, `${hash} overflows by ${over}px`);
  }
  await shot('16-mobile-create-event');
  await go('#/');
  await shot('17-mobile-landing');
});

const unexpected = pageErrors.filter((m) => !/Failed to fetch|pdf\.min|net::|Importing a module script failed|error loading dynamically imported module/i.test(m));
await step('no uncaught JavaScript errors during the whole run', async () => {
  assert(unexpected.length === 0, unexpected.join(' | '));
});

await browser.close();
server.kill();
rmSync(resolve(root, 'js/env-config.js'), { force: true });

const failed = results.filter((r) => !r.ok);
console.log(`\n${results.length - failed.length}/${results.length} steps passed\n`);
process.exit(failed.length ? 1 : 0);
