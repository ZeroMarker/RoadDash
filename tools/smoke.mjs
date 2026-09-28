/**
 * Headless smoke test: boots the game in Chromium, plays a few seconds with
 * synthetic input, and fails on any console error, page error, WebGL loss or
 * NaN leaking into the render loop.
 *
 * Usage: node tools/smoke.mjs [--seconds 8] [--url http://localhost:5173/]
 */
import puppeteer from 'puppeteer-core';
import { mkdirSync } from 'node:fs';

const args = process.argv.slice(2);
const flag = (name, fallback) => {
  const i = args.indexOf(`--${name}`);
  return i === -1 ? fallback : args[i + 1];
};

const seconds = Number(flag('seconds', '8'));
const url = flag('url', 'http://localhost:5173/');
const shotDir = flag('shots', 'tools/shots');
const CHROME =
  process.env.CHROME_PATH ??
  ['/usr/bin/chromium-browser', '/usr/bin/chromium', '/snap/bin/chromium'].find(Boolean);

mkdirSync(shotDir, { recursive: true });

const browser = await puppeteer.launch({
  executablePath: CHROME,
  headless: 'new',
  args: [
    '--no-sandbox',
    '--disable-dev-shm-usage',
    '--use-gl=swiftshader',
    '--enable-unsafe-swiftshader',
    '--enable-webgl',
    '--window-size=1280,800',
    '--mute-audio',
  ],
});

const page = await browser.newPage();
await page.setViewport({ width: 1280, height: 800, deviceScaleFactor: 1 });

const problems = [];
page.on('console', (msg) => {
  const type = msg.type();
  if (type === 'error' || type === 'warning') problems.push(`console.${type}: ${msg.text()}`);
});
page.on('pageerror', (err) => problems.push(`pageerror: ${err.message}`));
page.on('requestfailed', (req) =>
  problems.push(`requestfailed: ${req.url()} ${req.failure()?.errorText ?? ''}`),
);

await page.goto(url, { waitUntil: 'networkidle2', timeout: 45000 });

// Fail fast if the canvas never got a WebGL context.
const gl = await page.evaluate(() => {
  const c = document.getElementById('scene');
  return {
    hasCanvas: Boolean(c),
    w: c?.width ?? 0,
    h: c?.height ?? 0,
    context: Boolean(c?.getContext('webgl2') || c?.getContext('webgl')),
    startVisible: !document.getElementById('startScreen')?.hidden,
    cards: document.querySelectorAll('.car-card').length,
  };
});
if (!gl.hasCanvas || !gl.context) problems.push(`no webgl context: ${JSON.stringify(gl)}`);
if (gl.cards !== 3) problems.push(`expected 3 car cards, got ${gl.cards}`);

await page.screenshot({ path: `${shotDir}/01-menu.png` });

// Start the run, then drive it with a scripted "player" so the sim is
// actually exercised: lane changes, jumps, slides, nitro.
await page.evaluate(() => {
  const btn = document.getElementById('startButton');
  btn?.click();
});
await new Promise((r) => setTimeout(r, 600));

const started = await page.evaluate(() => ({
  hudVisible: !document.getElementById('hud')?.hidden,
  overHidden: document.getElementById('overScreen')?.hidden,
  state: window.roaddash ? 'ok' : 'missing',
}));
if (!started.hudVisible) problems.push(`hud not visible after start: ${JSON.stringify(started)}`);

const key = async (code, times = 1, gap = 260) => {
  for (let i = 0; i < times; i++) {
    await page.keyboard.press(code);
    await new Promise((r) => setTimeout(r, gap));
  }
};

await page.screenshot({ path: `${shotDir}/02-run.png` });
await key('ArrowLeft', 2, 320);
await key('ArrowUp', 2, 420);
await key('ArrowDown', 3, 340);
await key('Space', 2, 500);
await key('ArrowRight', 2, 320);
await page.screenshot({ path: `${shotDir}/03-actions.png` });

// Play out the rest of the window.
const deadline = Date.now() + seconds * 1000;
let nudges = 0;
while (Date.now() < deadline) {
  await new Promise((r) => setTimeout(r, 220));
  if (nudges++ % 4 === 0) await key(['ArrowLeft', 'ArrowRight', 'ArrowUp', 'ArrowDown'][nudges % 4]);
  const over = await page.evaluate(() => !document.getElementById('overScreen')?.hidden);
  if (over) {
    // Restart and keep going so we exercise the game-over path too.
    await page.evaluate(() => document.getElementById('retryButton')?.click());
    await new Promise((r) => setTimeout(r, 500));
  }
}

// Health probe: read the sim state straight out of the page.
const health = await page.evaluate(() => {
  const canvas = document.getElementById('scene');
  const gl = canvas?.getContext('webgl2') || canvas?.getContext('webgl');
  return {
    lost: gl ? gl.isContextLost() : true,
    score: Number(document.getElementById('scoreValue')?.textContent?.replace(/,/g, '') ?? NaN),
    distance: Number(
      document.getElementById('distanceValue')?.textContent?.replace(/,/g, '') ?? NaN,
    ),
    speed: Number(document.getElementById('speedValue')?.textContent ?? NaN),
    nitroWidth: document.getElementById('nitroFill')?.style.width ?? '',
    pips: document.querySelectorAll('#shieldRow .pip').length,
    fps: window.__frames ?? null,
  };
});

if (health.lost) problems.push('webgl context lost');
if (!Number.isFinite(health.score) || !Number.isFinite(health.speed)) {
  problems.push(`non-finite HUD numbers: ${JSON.stringify(health)}`);
}
if (health.pips < 1) problems.push('shield pips missing');
if (!(health.distance > 0)) problems.push(`distance did not advance: ${health.distance}`);

await page.screenshot({ path: `${shotDir}/04-final.png` });
await browser.close();

console.log('health:', JSON.stringify(health, null, 2));
if (problems.length) {
  console.error(`\n${problems.length} problem(s):`);
  for (const p of problems) console.error(` - ${p}`);
  process.exit(1);
}
console.log('\nsmoke: OK');
