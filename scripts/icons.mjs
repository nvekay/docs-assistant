// Renders the favicon set from apps/web/src/app/icon.svg (the source of truth):
//   favicon.ico     16, 32 and 48 px PNGs in one .ico, for browsers that don't use SVG icons
//   apple-icon.png  180 px, square and opaque (iOS rounds the corners itself)
// Next.js picks up icon.svg, favicon.ico and apple-icon.png in src/app automatically.
//   node scripts/icons.mjs
import { chromium } from '@playwright/test';
import { readFile, writeFile } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const appDir = join(dirname(fileURLToPath(import.meta.url)), '../apps/web/src/app');
const svg = await readFile(join(appDir, 'icon.svg'), 'utf8');
// The home-screen icon fills the whole square; iOS applies its own rounded mask
const squareSvg = svg.replace(/ rx="[\d.]+"/, '');

const browser = await chromium.launch();
const page = await browser.newPage();

async function render(source, size) {
  await page.setViewportSize({ width: size, height: size });
  await page.setContent(
    `<style>html,body{margin:0;background:transparent}svg{display:block;width:${size}px;height:${size}px}</style>${source}`,
  );
  return page.screenshot({ omitBackground: true, type: 'png' });
}

/** An .ico file is a small directory followed by the images; modern .ico files may hold PNGs directly */
function ico(images) {
  const header = Buffer.alloc(6);
  header.writeUInt16LE(0, 0);
  header.writeUInt16LE(1, 2); // 1 = icon
  header.writeUInt16LE(images.length, 4);
  const entries = [];
  let offset = 6 + 16 * images.length;
  for (const { size, png } of images) {
    const entry = Buffer.alloc(16);
    entry.writeUInt8(size >= 256 ? 0 : size, 0);
    entry.writeUInt8(size >= 256 ? 0 : size, 1);
    entry.writeUInt16LE(1, 4); // color planes
    entry.writeUInt16LE(32, 6); // bits per pixel
    entry.writeUInt32LE(png.length, 8);
    entry.writeUInt32LE(offset, 12);
    entries.push(entry);
    offset += png.length;
  }
  return Buffer.concat([header, ...entries, ...images.map((i) => i.png)]);
}

const sizes = [16, 32, 48];
const images = [];
for (const size of sizes) images.push({ size, png: await render(svg, size) });
await writeFile(join(appDir, 'favicon.ico'), ico(images));
await writeFile(join(appDir, 'apple-icon.png'), await render(squareSvg, 180));
await browser.close();
console.log(`Wrote favicon.ico (${sizes.join(', ')} px) and apple-icon.png (180 px) to ${appDir}`);
