/**
 * Focused diagnostic for hazard spawning + collision geometry. Prints the live
 * hazard table around the player and the exact overlap math for a chosen
 * hazard, so failures can be attributed to spawning vs. collision.
 *
 * Usage: node tools/inspect.mjs [--spawn sign] [--ahead 30] [--lane 1] [--isVehicle]
 */
import puppeteer from 'puppeteer-core';

const args = process.argv.slice(2);
const flag = (n, d) => {
  const i = args.indexOf(`--${n}`);
  return i === -1 ? d : args[i + 1];
};
const has = (n) => args.includes(`--${n}`);
const CHROME = process.env.CHROME_PATH ?? '/usr/bin/chromium-browser';

const browser = await puppeteer.launch({
  executablePath: CHROME,
  headless: 'new',
  args: [
    '--no-sandbox',
    '--disable-dev-shm-usage',
    '--use-gl=swiftshader',
    '--enable-unsafe-swiftshader',
    '--window-size=1000,640',
    '--mute-audio',
  ],
});
const page = await browser.newPage();
await page.setViewport({ width: 1000, height: 640 });
page.on('pageerror', (e) => console.error('pageerror:', e.message));
await page.goto(flag('url', 'http://localhost:5173/'), { waitUntil: 'networkidle2' });
await page.evaluate(() => document.getElementById('startButton')?.click());
await new Promise((r) => setTimeout(r, 500));

const kind = flag('spawn', 'sign');
const lane = Number(flag('lane', '1'));
const ahead = Number(flag('ahead', '30'));
const isVehicle = has('isVehicle');

await page.evaluate(
  (k, l, a, v) => {
    const g = window.roaddash;
    g.traffic.hazards.length = 0;
    g.traffic.spawnZ = 1e9;
    g.coins.nextZ = 1e9;
    g.props.nextZ = 1e9;
    g.debugSpawn(k, l, a, v);
  },
  kind,
  lane,
  ahead,
  isVehicle,
);

// Sample the hazard vs. player every 100 ms and report the closest approach.
const trace = await page.evaluate(async () => {
  const g = window.roaddash;
  const samples = [];
  const start = performance.now();
  while (performance.now() - start < 2600) {
    await new Promise((r) => setTimeout(r, 60));
    const h = g.traffic.hazards[0];
    const p = g.player;
    if (!h) {
      samples.push({ note: 'hazard gone' });
      continue;
    }
    samples.push({
      dz: +(h.z - g.playerZ).toFixed(1),
      dx: +Math.abs(h.x - (p.group.position.x)).toFixed(2),
      y: +p.y.toFixed(2),
      sliding: p.sliding,
      hp: p.hp,
      top: h.top,
      overhead: h.overhead,
      mode: h.mode,
      launch: h.launch,
      halfW: h.halfWidth,
      halfL: h.halfLength,
      visible: h.obj.visible,
      inScene: Boolean(h.obj.parent),
    });
  }
  return samples;
});

console.log(`spawned ${kind}${isVehicle ? ' (vehicle)' : ''} lane=${lane} ahead=${ahead}`);
console.log(
  '  dz     dx    y    slide hp  top  over  mode   halfW halfL  vis  inScene',
);
for (const s of trace) {
  if (s.note) {
    console.log(`  ${s.note}`);
    continue;
  }
  console.log(
    `  ${String(s.dz).padStart(6)} ${String(s.dx).padStart(5)} ${String(s.y).padStart(5)}  ${String(
      s.sliding,
    ).padEnd(5)} ${String(s.hp).padStart(2)}  ${String(s.top).padStart(4)} ${String(s.overhead).padStart(4)}  ${String(
      s.mode,
    ).padEnd(6)} ${String(s.halfW).padStart(4)} ${String(s.halfL).padStart(4)}  ${String(
      s.visible,
    ).padEnd(5)} ${s.inScene}`,
  );
}
await browser.close();
