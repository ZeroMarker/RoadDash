/**
 * Pickup FX test: verifies that collecting coins and power-ups actually fires
 * the new effects, and that the ring pool stays bounded when a magnet sweep
 * pops a whole line in one frame.
 *
 * The effects are asserted on the *game* state, not on pixel output — the ring
 * pool exposes how many rings are alive, which is the thing that can actually
 * regress (unbounded rings = a per-collect allocation = a GC hitch).
 *
 * Usage: node tools/fx.mjs
 */
import puppeteer from 'puppeteer-core';
import { mkdirSync } from 'node:fs';

const args = process.argv.slice(2);
const flag = (n, d) => {
  const i = args.indexOf(`--${n}`);
  return i === -1 ? d : args[i + 1];
};
const shotDir = flag('shots', 'tools/shots/fx');
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
    '--window-size=1000,640',
    '--mute-audio',
  ],
});
const page = await browser.newPage();
await page.setViewport({ width: 1000, height: 640 });
const errors = [];
page.on('pageerror', (e) => errors.push(`pageerror: ${e.message}`));
page.on('console', (m) => m.type() === 'error' && errors.push(`console: ${m.text()}`));
await page.goto(flag('url', 'http://localhost:5173/'), { waitUntil: 'networkidle2' });
await page.evaluate(() => document.getElementById('startButton')?.click());
await new Promise((r) => setTimeout(r, 300));

const results = [];
const check = (name, ok, detail = '') => {
  results.push({ name, ok, detail });
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}${detail ? `  (${detail})` : ''}`);
};

const run = (body) => page.evaluate(`(() => {\n${body}\n})()`);

/**
 * Drop a pickup into the player's path and collect it.
 *
 * coins.freeze() (not reset) is what stops spawning: reset() deliberately
 * re-arms the spawn cursor for a real restart, so using it here would seed one
 * coin and then keep generating more for the rest of the test.
 */
const collectOne = (kind) =>
  run(`
    const g = window.roaddash;
    g.debugFreezeSpawners();
    g.debugResetPlayer(1);
    g.debugSetSpeed(34);
    g.coins.freeze();
    g.rings.clear();
    g.effects.clear();
    g.coinCount = 0;
    g.debugSpawnPickup(${JSON.stringify(kind)}, 1, 14, 1.1);
    let peakRings = 0, peakParticles = 0;
    for (let i = 0; i < 400; i++) {
      g.debugSetSpeed(34);
      g.debugStep(1);
      peakRings = Math.max(peakRings, g.rings.pool.filter((r) => r.life > 0).length);
      peakParticles = Math.max(
        peakParticles,
        g.effects.particles.filter((p) => p.active).length,
      );
    }
    return { peakRings, peakParticles, pool: g.rings.pool.length, coins: g.coinCount };
  `);

// ------------------------------------------------------------- coin pops
let r = await collectOne('coin');
check('collecting a coin spawns a ring', r.peakRings >= 1, `peakRings=${r.peakRings}`);
check('collecting a coin spawns sparks', r.peakParticles >= 3, `particles=${r.peakParticles}`);
check('coin counter advanced', r.coins >= 1, `coins=${r.coins}`);

// Rings must expire rather than accumulating.
r = await run(`
  const g = window.roaddash;
  for (let i = 0; i < 600; i++) g.debugStep(1);
  return { alive: g.rings.pool.filter((x) => x.life > 0).length, pool: g.rings.pool.length };
`);
check('rings expire after the effect', r.alive === 0, `alive=${r.alive}`);
check('ring pool is fixed size', r.pool > 0 && r.pool <= 24, `pool=${r.pool}`);

// -------------------------------------------------------- power-up pops
for (const kind of ['magnet', 'shield', 'nitro']) {
  const res = await collectOne(kind);
  check(`${kind} spawns a ring`, res.peakRings >= 1, `peakRings=${res.peakRings}`);
  check(
    `${kind} spawns more sparks than a coin`,
    res.peakParticles > 8,
    `particles=${res.peakParticles}`,
  );
}

// ------------------------------------------------------- pool saturation
// A magnet sweep can pop a whole coin line in a single frame. Rings beyond the
// pool must recycle the oldest rather than growing the scene graph.
r = await run(`
  const g = window.roaddash;
  g.debugFreezeSpawners();
  g.debugResetPlayer(1);
  g.rings.clear();
  const before = g.rings.pool.length;
  let sceneBefore = 0;
  g.scene.traverse((o) => { if (o.isMesh) sceneBefore++; });
  for (let i = 0; i < 400; i++) {
    // 60 rings' worth of pops, far more than the pool can hold.
    g.rings.pop(g.player.worldX, 1, g.playerZ, 0xffc63a, 0.5, 0.34, g.camera);
  }
  let sceneAfter = 0;
  g.scene.traverse((o) => { if (o.isMesh) sceneAfter++; });
  return {
    before,
    alive: g.rings.pool.filter((x) => x.life > 0).length,
    sceneBefore,
    sceneAfter,
  };
`);
check(
  'saturating the pool does not grow the scene',
  r.sceneAfter === r.sceneBefore,
  `meshes ${r.sceneBefore}→${r.sceneAfter}`,
);
check('pool holds at its fixed size', r.alive <= 24, `alive=${r.alive}`);

// -------------------------------------------------------------- HUD pulse
r = await run(`
  const g = window.roaddash;
  g.hud.pulseCoins();
  const el = document.querySelector('.coins');
  const anim = getComputedStyle(el).animationName;
  return { anim, hasClass: el.classList.contains('bump') };
`);
check('coin counter pulses on pickup', r.anim === 'coinBump', `animation=${r.anim}`);

// ----------------------------------------------------- restart clears them
r = await run(`
  const g = window.roaddash;
  g.rings.pop(g.player.worldX, 1, g.playerZ, 0xffc63a, 1, 5, g.camera);
  const before = g.rings.pool.filter((x) => x.life > 0).length;
  g.debugAction('pause');
  g.debugAction('pause');
  g.startRun ? g.startRun() : null;
  const after = g.rings.pool.filter((x) => x.life > 0).length;
  return { before, after };
`);
check('restart clears lingering rings', r.before > 0 && r.after === 0, JSON.stringify(r));

// Screenshot the effect mid-flight. The ring lives ~0.28 s of sim time, so
// step the sim to the frame where coins are actually being collected and shoot
// immediately after — a wall-clock wait would step straight past it.
await page.evaluate(() => {
  const g = window.roaddash;
  g.debugFreezeSpawners();
  g.debugResetPlayer(1);
  g.coins.freeze();
  g.rings.clear();
  g.effects.clear();
  for (let i = 0; i < 5; i++) g.debugSpawnPickup('coin', 1, 9 + i * 3.4, 1.1);
  // Advance until the first coins are collected, then a few more frames so the
  // ring has expanded but not expired.
  for (let i = 0; i < 400; i++) {
    g.debugSetSpeed(34);
    g.debugStep(1);
    const alive = g.rings.pool.filter((r) => r.life > 0).length;
    if (alive >= 2) break;
  }
  g.rings.update(0.04);
});
await page.screenshot({ path: `${shotDir}/coin-pop.png` });

// Power-up pop: bigger ring, more sparks. Coins must be cleared first, or the
// leftover coin line keeps firing rings and the loop below exits on one of
// those instead of on the magnet.
await page.evaluate(() => {
  const g = window.roaddash;
  g.coins.freeze();
  g.rings.clear();
  g.effects.clear();
  g.debugSpawnPickup('magnet', 1, 10, 1.1);
  for (let i = 0; i < 400; i++) {
    g.debugSetSpeed(34);
    g.debugStep(1);
    if (g.rings.pool.filter((r) => r.life > 0).length >= 1) break;
  }
  g.rings.update(0.06);
});
await page.screenshot({ path: `${shotDir}/powerup-pop.png` });

await browser.close();

const failed = results.filter((r) => !r.ok);
if (errors.length) {
  console.error('\nruntime errors:');
  for (const e of errors) console.error(' -', e);
}
console.log(`\n${results.length - failed.length}/${results.length} checks passed`);
if (failed.length || errors.length) process.exit(1);
