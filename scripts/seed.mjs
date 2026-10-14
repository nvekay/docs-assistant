// Uploads corpus/*.md through the admin API, so it works the same locally and against a deployed API.
// Files that are already uploaded (same file name) are skipped, so the script is safe to re-run.
// With --replace, already uploaded files are replaced by the current version: the new copy is uploaded and
// indexed first, then the old one is deleted, so the chat never loses the content.
//
//   pnpm seed                                   # local API, admin login from .env
//   API_URL=https://api.example.com pnpm seed   # deployed API
//   pnpm seed --replace                         # also refresh documents that are already uploaded
import { existsSync } from 'node:fs';
import { readdir, readFile } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
if (existsSync(join(root, '.env'))) process.loadEnvFile(join(root, '.env'));

const apiUrl = (process.env.API_URL ?? `http://localhost:${process.env.PORT ?? 3001}`).replace(/\/$/, '');
const corpusDir = join(root, 'corpus');
const replace = process.argv.includes('--replace');

async function call(path, init = {}) {
  const res = await fetch(`${apiUrl}${path}`, init);
  if (!res.ok) throw new Error(`${init.method ?? 'GET'} ${path} -> ${res.status} ${await res.text()}`);
  return res.status === 204 ? null : res.json();
}

const { accessToken } = await call('/auth/login', {
  method: 'POST',
  headers: { 'Content-Type': 'application/json' },
  body: JSON.stringify({ email: process.env.ADMIN_EMAIL, password: process.env.ADMIN_PASSWORD }),
});
const auth = { Authorization: `Bearer ${accessToken}` };

async function upload(file) {
  const form = new FormData();
  form.append('file', new Blob([await readFile(join(corpusDir, file))], { type: 'text/markdown' }), file);
  const { id } = await call('/documents/upload', { method: 'POST', headers: auth, body: form });
  return id;
}

/** Waits until the worker has indexed a document; returns its final status */
async function indexed(id) {
  for (let i = 0; i < 100; i++) {
    const doc = (await call('/documents', { headers: auth })).find((d) => d.id === id);
    if (!doc || !['queued', 'processing'].includes(doc.status)) return doc?.status ?? 'missing';
    await new Promise((r) => setTimeout(r, 3000));
  }
  return 'timeout';
}

const documents = await call('/documents', { headers: auth });
const files = (await readdir(corpusDir)).filter((f) => f.endsWith('.md') && f !== 'README.md').sort();

for (const file of files) {
  const old = documents.filter((d) => d.sourceRef === file);
  if (old.length && !replace) {
    console.log(`skip    ${file} (already uploaded; --replace refreshes it)`);
    continue;
  }
  const id = await upload(file);
  if (!old.length) {
    console.log(`queued  ${file} -> ${id}`);
    continue;
  }
  const status = await indexed(id);
  if (status !== 'ready') {
    console.log(`kept    ${file}: the new copy ended as "${status}", the old one stays`);
    continue;
  }
  for (const d of old) await call(`/documents/${d.id}`, { method: 'DELETE', headers: auth });
  console.log(`replaced ${file} -> ${id}`);
}
console.log('Done. The worker indexes queued documents in the background; watch progress in /admin.');
