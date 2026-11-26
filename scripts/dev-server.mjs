// Tiny zero-dependency static server for local development.
// Only serves index.html, css/, js/ and assets/ — never .env or other project files.

import { createServer } from 'node:http';
import { readFile, stat } from 'node:fs/promises';
import { dirname, extname, join, normalize, resolve, sep } from 'node:path';
import { fileURLToPath } from 'node:url';
import { writeConfig } from './generate-config.mjs';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const port = Number(process.env.PORT) || 5173;
const ALLOWED_TOP = new Set(['index.html', 'css', 'js', 'assets']);

const MIME = {
  '.html': 'text/html; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.mjs': 'text/javascript; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.ico': 'image/x-icon',
  '.woff2': 'font/woff2',
};

export function resolveRequestPath(urlPath) {
  let decoded;
  try {
    decoded = decodeURIComponent(urlPath.split('?')[0]);
  } catch {
    return null;
  }
  if (decoded.includes('\0')) return null;
  const rel = normalize(decoded === '/' ? 'index.html' : decoded.replace(/^\/+/, ''));
  if (rel.startsWith('..') || rel.split(sep).some((part) => part.startsWith('.') && part !== '.')) return null;
  const top = rel.split(sep)[0];
  if (!ALLOWED_TOP.has(top)) return null;
  const full = join(root, rel);
  return full.startsWith(root + sep) ? full : null;
}

if (import.meta.url === `file://${process.argv[1]}` || process.argv[1]?.endsWith('dev-server.mjs')) {
  const { missing, hasFile } = writeConfig();
  if (!hasFile) console.warn('! No .env file found — copy .env.example to .env (see FIREBASE_SETUP.md & SUPABASE_SETUP.md).');
  if (missing.length) console.warn(`! Settings missing: ${missing.join(', ')} — the app will show a setup screen.`);

  createServer(async (req, res) => {
    const file = resolveRequestPath(req.url || '/');
    if (!file) {
      res.writeHead(404, { 'Content-Type': 'text/plain' });
      res.end('Not found');
      return;
    }
    try {
      const info = await stat(file);
      if (!info.isFile()) throw new Error('not a file');
      const data = await readFile(file);
      res.writeHead(200, {
        'Content-Type': MIME[extname(file).toLowerCase()] || 'application/octet-stream',
        'Cache-Control': 'no-store',
        'X-Content-Type-Options': 'nosniff',
        'Cross-Origin-Opener-Policy': 'same-origin-allow-popups',
      });
      res.end(data);
    } catch {
      res.writeHead(404, { 'Content-Type': 'text/plain' });
      res.end('Not found');
    }
  }).listen(port, () => {
    console.log(`\n  Yorin.vite dev server → http://localhost:${port}\n`);
  });
}
