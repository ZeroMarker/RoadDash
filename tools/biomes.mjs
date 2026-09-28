/**
 * Biome gallery: fast-forwards to each biome in turn and screenshots it, so
 * every environment can be eyeballed without playing 6 runs.
 *
 * Usage: node tools/biomes.mjs [--url http://localhost:5173/]
 */
import puppeteer from 'puppeteer-core';
import { mkdirSync } from 'node:fs';

const args = process.argv.slice(2);
const flag = (n, d) => {
  const i = args.indexOf(`--${n}`);
  return i === -1 ? d : args[i + 1];
};
const shotDir = flag('shots', 'tools/shots/biomes');
const settleMs = Number(flag('settle', '1400'));
const CHROME = process.env.CHROME_PATH ?? '/usr/bin/chromium-browser';
mkdirSync(shotDir, { recursive: true });

const browser = await puppeteer.launch({
  executablePath: CHROME,
  headless: 'new',
  args: [
    '--no-sandbox',
    '--disable-dev-shm-usage',
    '--use-gl=swiftshader',
    '--enable-unsafe-swiftshader',
    '--window-size=1280,800',
    '--mute-audio',
  ],
});
const page = await browser.newPage();
await page.setViewport({ width: 1280, height: 800 });
const errors = [];
page.on('pageerror', (e) => errors.push(e.message));
page.on('console', (m) => m.type() === 'error' && errors.push(m.text()));

await page.goto(flag('url', 'http://localhost:5173/'), { waitUntil: 'networkidle2' });
await page.evaluate(() => document.getElementById('startButton')?.click());
await new Promise((r) => setTimeout(r, 500));

const BIOME_LENGTH = 760;
for (let i = 0; i < 6; i++) {
  const metres = i * BIOME_LENGTH + 120;
  await page.evaluate((m) => window.roaddash?.debugSkip(m), metres);
  await new Promise((r) => setTimeout(r, settleMs));
  const label = await page.evaluate(() => window.roaddash?.debugBiomeName() ?? 'unknown');
  await page.screenshot({ path: `${shotDir}/${i}-${label}.png` });
  console.log(`captured biome ${i}: ${label}`);
}

await browser.close();
if (errors.length) {
  console.error('errors:', errors);
  process.exit(1);
}
