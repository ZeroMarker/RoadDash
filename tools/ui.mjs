/**
 * UI gallery: screenshots every overlay and gauge state so the design system
 * can be eyeballed without playing. Biome shots cover the world; this covers
 * the interface — the menu, the HUD at rest, the results panel, the pause
 * panel, focus rings, and the two states a screenshot of a normal run never
 * catches (a burning nitro bar, a shield on its last pip).
 *
 * Usage: node tools/ui.mjs [--url http://localhost:5173/] [--shots DIR]
 */
import puppeteer from 'puppeteer-core';
import { mkdirSync } from 'node:fs';

const args = process.argv.slice(2);
const flag = (n, d) => {
  const i = args.indexOf(`--${n}`);
  return i === -1 ? d : args[i + 1];
};
const shotDir = flag('shots', 'tools/shots/ui');
const settleMs = Number(flag('settle', '700'));
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

const errors = [];
const shot = async (page, name, expectedState) => {
  await page.evaluate(() => window.roaddash.debugFreezeFrame());
  await new Promise((r) => setTimeout(r, settleMs));
  if (expectedState && !await page.evaluate(expectedState)) {
    errors.push(`${name}: expected UI state was lost before the screenshot`);
  }
  await page.screenshot({ path: `${shotDir}/${name}.png` });
  console.log(`captured ${name}`);
};

/** Each viewport gets its own page so media queries are evaluated per page. */
const openAt = async (width, height) => {
  const page = await browser.newPage();
  page.on('pageerror', (e) => errors.push(e.message));
  page.on('console', (m) => m.type() === 'error' && errors.push(m.text()));
  await page.setViewport({ width, height });
  await page.goto(flag('url', 'http://localhost:5173/'), { waitUntil: 'networkidle2' });
  await page.evaluate(() => window.roaddash.debugFreezeFrame());
  return page;
};

const alarmVisible = () => !document.getElementById('policeWarning').hidden
  && document.querySelectorAll('#shieldRow .pip.low').length === 1;

// ---------------------------------------------------------------- desktop
const page = await openAt(1280, 800);

await shot(page, '01-menu');

// Keyboard focus on the car picker: this is the state a mouse-only reviewer
// never sees and the one that used to be invisible.
await page.evaluate(() => document.querySelectorAll('.car-card')[2]?.focus());
await shot(page, '02-menu-focus');

await page.evaluate(() => document.getElementById('startButton')?.click());
await page.evaluate(() => window.roaddash.debugStep(60));
await shot(page, '03-run');

// Burn nitro and lose armour: the two HUD states that only exist mid-incident.
await page.evaluate(() => {
  const g = window.roaddash;
  g.player.nitro = 100;
  g.player.toggleNitro();
  g.debugStep(1);
});
await shot(page, '04-run-nitro', () => document.getElementById('nitroFill').closest('.nitro').classList.contains('active'));

await page.evaluate(() => {
  const g = window.roaddash;
  g.hud.setShield(1, 3);
  g.hud.setPolice(true);
  g.hud.showBanner('NEAR MISS x7', 'NITRO +', 'near', 3000);
});
await shot(page, '05-run-alarm', alarmVisible);

await page.evaluate(() => window.roaddash?.debugCrash('busted'));
await page.waitForFunction(() => !document.getElementById('overScreen').hidden);
await shot(page, '06-results');

await page.evaluate(() => document.getElementById('retryButton')?.click());
await new Promise((r) => setTimeout(r, 300));
await page.evaluate(() => window.roaddash?.debugPause(true));
await shot(page, '07-pause');
await page.close();

// ------------------------------------------------------------------ phone
const phone = await openAt(390, 844);
await shot(phone, '08-phone-menu');
await phone.evaluate(() => document.getElementById('startButton')?.click());
await shot(phone, '09-phone-run');
await phone.close();

// Landscape phones run out of height long before width.
const landscape = await openAt(844, 390);
await shot(landscape, '10-landscape-menu');
await landscape.close();

// ------------------------------------------------------- reduced motion
const calm = await openAt(1280, 800);
await calm.emulateMediaFeatures([{ name: 'prefers-reduced-motion', value: 'reduce' }]);
await calm.evaluate(() => document.getElementById('startButton')?.click());
await calm.evaluate(() => {
  const g = window.roaddash;
  g.hud.setShield(1, 3);
  g.hud.setPolice(true);
});
await shot(calm, '11-reduced-motion', alarmVisible);
await calm.close();

await browser.close();
if (errors.length) {
  console.error('errors:', errors);
  process.exit(1);
}
