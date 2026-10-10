// Uploads corpus/*.md through the admin API, so it works the same locally and against a deployed API.
// Files that are already uploaded (same file name) are skipped, so the script is safe to re-run.
//
//   pnpm seed                                   # local API, admin login from .env
//   API_URL=https://api.example.com pnpm seed   # deployed API
import { existsSync } from 'node:fs';
import { readdir, readFile } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
if (existsSync(join(root, '.env'))) process.loadEnvFile(join(root, '.env'));

const apiUrl = (process.env.API_URL ?? `http://localhost:${process.env.PORT ?? 3001}`).replace(/\/$/, '');
const corpusDir = join(root, 'corpus');

async function call(path, init = {}) {
  const res = await fetch(`${apiUrl}${path}`, init);
  if (!res.ok) throw new Error(`${init.method ?? 'GET'} ${path} -> ${res.status} ${await res.text()}`);
  return res.json();
}

const { accessToken } = await call('/auth/login', {
  method: 'POST',
  headers: { 'Content-Type': 'application/json' },
  body: JSON.stringify({ email: process.env.ADMIN_EMAIL, password: process.env.ADMIN_PASSWORD }),
});
const auth = { Authorization: `Bearer ${accessToken}` };

const existing = new Set((await call('/documents', { headers: auth })).map((d) => d.sourceRef));
const files = (await readdir(corpusDir)).filter((f) => f.endsWith('.md') && f !== 'README.md').sort();

for (const file of files) {
  if (existing.has(file)) {
    console.log(`skip    ${file} (already uploaded)`);
    continue;
  }
  const form = new FormData();
  form.append('file', new Blob([await readFile(join(corpusDir, file))], { type: 'text/markdown' }), file);
  const { id } = await call('/documents/upload', { method: 'POST', headers: auth, body: form });
  console.log(`queued  ${file} -> ${id}`);
}
console.log('Done. The worker indexes queued documents in the background; watch progress in /admin.');
