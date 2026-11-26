// Copies the static app into dist/ and bakes in js/env-config.js from your environment.
// Output is ready for `firebase deploy` (see firebase.json) or any static host.

import { cpSync, existsSync, mkdirSync, rmSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { writeConfig } from './generate-config.mjs';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const dist = resolve(root, 'dist');

rmSync(dist, { recursive: true, force: true });
mkdirSync(dist, { recursive: true });

cpSync(resolve(root, 'index.html'), resolve(dist, 'index.html'));
cpSync(resolve(root, 'css'), resolve(dist, 'css'), { recursive: true });
cpSync(resolve(root, 'js'), resolve(dist, 'js'), {
  recursive: true,
  filter: (src) => !src.endsWith('env-config.js'),
});
if (existsSync(resolve(root, 'assets'))) cpSync(resolve(root, 'assets'), resolve(dist, 'assets'), { recursive: true });

const { missing } = writeConfig(resolve(dist, 'js/env-config.js'));
console.log('Built → dist/');
if (missing.length) {
  console.error(`✗ Missing Firebase or Supabase settings: ${missing.join(', ')}. The deployed app would show its setup screen.`);
  process.exitCode = 1;
}
