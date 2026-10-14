// Answer-quality check against a running deployment, driven by evals/questions.json (one or more
// questions per section of every corpus file). Each question is asked in a new conversation, paced
// to stay under the demo's rate limit, and checked for:
//   - retrieval: the expected documents are cited
//   - facts: the answer contains the key facts from the source section
//   - negatives: questions the docs don't cover are declined (pointing to related sections is fine)
//
//   node scripts/eval.mjs                                   # local dev server
//   WEB_URL=https://docs-assistant-ruddy.vercel.app node scripts/eval.mjs
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const base = (process.env.WEB_URL ?? 'http://localhost:3000').replace(/\/$/, '');
const only = process.env.ONLY?.split(',');
const PACE_MS = 6500; // 10 questions per minute per visitor

const DECLINE =
  /not cover|doesn[’']t cover|does not (cover|mention|include|say|contain)|doesn[’']t (mention|say|include|contain)|no information|not mentioned|couldn[’']t find|cannot find|can[’']t find|can[’']t answer|cannot answer|says? nothing about|не (содерж|описыва|упомина|покрыва)|нет (информации|ответа)/i;

const { questions } = JSON.parse(await readFile(join(root, 'evals/questions.json'), 'utf8'));
const selected = only ? questions.filter((q) => only.includes(q.id)) : questions;

let cookie = '';
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function ask(message) {
  for (let attempt = 0; attempt < 3; attempt++) {
    const started = Date.now();
    const res = await fetch(`${base}/api/chat`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', ...(cookie && { cookie }) },
      body: JSON.stringify({ message }),
    });
    const setCookie = res.headers.get('set-cookie');
    if (setCookie) cookie = setCookie.split(';')[0];
    if (res.status === 429) {
      await sleep((Number(res.headers.get('retry-after')) || 10) * 1000);
      continue;
    }
    if (!res.ok) return { error: `HTTP ${res.status}`, text: '', citations: [], ms: Date.now() - started };

    const result = { text: '', citations: [], usage: null, error: null, firstTokenMs: null };
    const reader = res.body.getReader();
    const decoder = new TextDecoder();
    let buffer = '';
    for (;;) {
      const { value, done } = await reader.read();
      if (done) break;
      buffer += decoder.decode(value, { stream: true });
      let i;
      while ((i = buffer.indexOf('\n\n')) !== -1) {
        const block = buffer.slice(0, i);
        buffer = buffer.slice(i + 2);
        if (!block.startsWith('data:')) continue;
        const event = JSON.parse(block.slice(5));
        if (event.type === 'delta') {
          result.firstTokenMs ??= Date.now() - started;
          result.text += event.text;
        } else if (event.type === 'citations') result.citations = event.citations;
        else if (event.type === 'done') result.usage = event.usage;
        else if (event.type === 'error') result.error = event.message;
      }
    }
    return { ...result, ms: Date.now() - started };
  }
  return { error: 'rate limited', text: '', citations: [], ms: 0 };
}

function grade(q, r) {
  const cited = [...new Set(r.citations.map((c) => c.documentTitle))];
  const text = r.text.toLowerCase();
  if (r.error) return { pass: false, retrieval: false, facts: false, cited, note: r.error };
  if (q.kind === 'negative') {
    const declined = DECLINE.test(r.text);
    return {
      // Declining while pointing to related sections ("no Salesforce, but QuickBooks and Xero [1]") is fine
      pass: declined,
      retrieval: true,
      facts: declined,
      cited,
      note: declined ? (cited.length ? 'declined, pointed to related sections' : '') : 'answered instead of declining',
    };
  }
  const retrieval = q.expectDocs.every((d) => cited.includes(d));
  const missing = q.mustInclude.filter((group) => !group.some((alt) => text.includes(alt.toLowerCase())));
  const declined = DECLINE.test(r.text) && missing.length > 0;
  return {
    pass: retrieval && missing.length === 0,
    retrieval,
    facts: missing.length === 0,
    cited,
    note: [
      !retrieval && `expected ${q.expectDocs.filter((d) => !cited.includes(d)).join(', ')}`,
      missing.length > 0 && `missing ${missing.map((g) => g[0]).join(', ')}`,
      declined && 'declined',
    ]
      .filter(Boolean)
      .join('; '),
  };
}

console.log(`Evaluating ${selected.length} questions against ${base}\n`);
const results = [];
for (const [n, q] of selected.entries()) {
  const started = Date.now();
  const r = await ask(q.question);
  const g = grade(q, r);
  results.push({
    ...q,
    ...g,
    answer: r.text,
    citations: r.citations,
    usage: r.usage,
    ms: r.ms,
    firstTokenMs: r.firstTokenMs,
  });
  const mark = g.pass ? 'PASS' : 'FAIL';
  console.log(
    `${String(n + 1).padStart(2)} ${mark} [${q.kind}] ${q.id}  ${(r.ms / 1000).toFixed(1)}s` +
      `${g.cited.length ? `  cites: ${g.cited.join(' | ')}` : ''}${g.note ? `  — ${g.note}` : ''}`,
  );
  if (n < selected.length - 1) await sleep(Math.max(0, PACE_MS - (Date.now() - started)));
}

const by = (list) => `${list.filter((r) => r.pass).length}/${list.length}`;
const kinds = [...new Set(results.map((r) => r.kind))];
const positives = results.filter((r) => r.kind !== 'negative');
const cost = results.reduce((s, r) => s + (r.usage?.costUsd ?? 0), 0);
const tokens = results.reduce((s, r) => s + (r.usage ? r.usage.inputTokens + r.usage.outputTokens : 0), 0);
const median = (xs) => xs.sort((a, b) => a - b)[Math.floor(xs.length / 2)] ?? 0;

console.log(`\nPassed ${by(results)}`);
for (const kind of kinds) console.log(`  ${kind.padEnd(10)} ${by(results.filter((r) => r.kind === kind))}`);
console.log(`Retrieval (expected documents cited): ${positives.filter((r) => r.retrieval).length}/${positives.length}`);
console.log(`Facts present in the answer:          ${positives.filter((r) => r.facts).length}/${positives.length}`);
console.log(
  `Cost: $${cost.toFixed(4)} for ${tokens.toLocaleString('en')} tokens ($${(cost / results.length).toFixed(5)} per question)`,
);
console.log(
  `Median time to first token: ${(median(results.map((r) => r.firstTokenMs ?? r.ms)) / 1000).toFixed(1)}s, ` +
    `to full answer: ${(median(results.map((r) => r.ms)) / 1000).toFixed(1)}s`,
);

const out = join(root, 'evals/results');
await mkdir(out, { recursive: true });
const file = join(out, `${new Date().toISOString().replace(/[:.]/g, '-')}.json`);
await writeFile(file, JSON.stringify({ base, at: new Date().toISOString(), results }, null, 2));
console.log(`\nFull answers: ${file}`);
