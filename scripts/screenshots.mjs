// Captures the README screenshots from a running app (pnpm dev:api + pnpm dev:web, corpus seeded).
//   node scripts/screenshots.mjs
import { chromium } from '@playwright/test';
import { mkdir } from 'node:fs/promises';

const base = process.env.WEB_URL ?? 'http://localhost:3000';
const out = 'docs/screenshots';
await mkdir(out, { recursive: true });

const browser = await chromium.launch();
const page = await browser.newPage({
  viewport: { width: 1280, height: 800 },
  deviceScaleFactor: 2,
  colorScheme: 'light',
});

await page.goto(base);
await page.screenshot({ path: `${out}/landing.png` });

await page.goto(`${base}/chat`);
await page.getByLabel('Your question').fill('Can I export invoices to CSV?');
await page.getByRole('button', { name: 'Send' }).click();
await page.getByRole('button', { name: 'Show source 1' }).first().click();
await page.getByText(/tokens · \$/).waitFor();
await page.screenshot({ path: `${out}/chat.png` });

await page.goto(`${base}/admin`);
await page.getByRole('button', { name: 'View as demo user (read-only)' }).click();
await page.getByRole('heading', { name: 'Usage, last 14 days' }).waitFor();
await page.screenshot({ path: `${out}/admin.png`, fullPage: true });

const phone = await browser.newPage({ viewport: { width: 390, height: 844 }, deviceScaleFactor: 3, isMobile: true });
await phone.goto(`${base}/chat`);
await phone.getByLabel('Your question').fill('How do I reset my password?');
await phone.getByRole('button', { name: 'Send' }).click();
await phone.getByText(/tokens · \$/).waitFor();
await phone.getByRole('button', { name: 'Show source 1' }).first().click();
await phone.screenshot({ path: `${out}/chat-mobile.png` });

await browser.close();
console.log(`Saved screenshots to ${out}/`);
