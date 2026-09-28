/**
 * Runtime probe: boots the game, starts a run, and dumps internal state so
 * positioning / spawning bugs can be diagnosed without a debugger attached.
 *
 * Usage: node tools/probe.mjs [--seconds 3] [--drive]
 */
import puppeteer from 'puppeteer-core';
import { mkdirSync } from 'node:fs';

const args = process.argv.slice(2);
const flag = (n, d) => {
  const i = args.indexOf(`--${n}`);
  return i === -1 ? d : args[i + 1];
};
const seconds = Number(flag('seconds', '3'));
const drive = args.includes('--drive');
const shotDir = flag('shots', 'tools/shots');
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
page.on('pageerror', (e) => console.error('pageerror:', e.message));
page.on('console', (m) => {
  if (m.type() === 'error') console.error('console.error:', m.text());
});

await page.goto(flag('url', 'http://localhost:5173/'), { waitUntil: 'networkidle2' });

// Expose internals: the Game keeps systems private, so reach in by name.
await page.evaluate(() => {
  const g = window.roaddash;
  window.__peek = () => {
    const p = g.player ?? g['player'];
    const cam = g.camera ?? g['camera'];
    const world = {
      playerZ: p ? p.group.position.z : null,
      playerX: p ? p.group.position.x : null,
      playerY: p ? p.group.position.y : null,
      carVisible: p ? p.group.visible : null,
      carChildren: p ? p.rig.root.children.length : null,
      /** Lane offset — the world position also includes the centreline. */
      laneOffsetX: p ? +p.x.toFixed(2) : null,
      worldX: p ? +p.worldX.toFixed(2) : null,
      carScale: p ? p.rig.root.scale.toArray() : null,
      carBodyScaleY: p ? p.rig.body.scale.y : null,
      camera: cam ? cam.position.toArray().map((n) => +n.toFixed(2)) : null,
      cameraFov: cam ? +cam.fov.toFixed(1) : null,
      hazards: g['traffic'] ? g['traffic'].hazards.length : null,
      police: g['traffic'] ? g['traffic'].hasPolice() : null,
      pickups: g['coins'] ? g['coins'].pickups.length : null,
      distance: g['distance'],
      speed: g['speed'],
      biome: g['biomeIndex'],
      state: g['state'],
      score: g['score'],
    };
    return world;
  };
});

await page.evaluate(() => document.getElementById('startButton')?.click());
await new Promise((r) => setTimeout(r, 400));

if (drive) {
  for (let i = 0; i < 8; i++) {
    await page.keyboard.press(['ArrowLeft', 'ArrowUp', 'ArrowRight', 'ArrowDown'][i % 4]);
    await new Promise((r) => setTimeout(r, 200));
  }
}

await new Promise((r) => setTimeout(r, seconds * 1000));
const peek = await page.evaluate(() => window.__peek());
console.log(JSON.stringify(peek, null, 2));
await page.screenshot({ path: `${shotDir}/probe.png` });
await browser.close();
