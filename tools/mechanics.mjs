/**
 * Mechanics test: drives the game through each core interaction in isolation
 * — lane change, jump, duck, ramp, crash damage, near-miss, nitro, pause.
 *
 * The simulation is advanced with Game.debugStep() at a fixed timestep rather
 * than by waiting on wall-clock frames: headless/software WebGL can render at
 * only a few frames per second, which makes real-time assertions meaningless.
 *
 * Usage: node tools/mechanics.mjs
 */
import puppeteer from 'puppeteer-core';
import { mkdirSync } from 'node:fs';

const args = process.argv.slice(2);
const flag = (n, d) => {
  const i = args.indexOf(`--${n}`);
  return i === -1 ? d : args[i + 1];
};
const shotDir = flag('shots', 'tools/shots/mech');
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

/**
 * Evaluate a function body string in the page against the live game instance.
 * The body is wrapped here rather than at each call site so the tests read as
 * plain code.
 */
const run = (body) => page.evaluate(`(() => {\n${body}\n})()`);

const readState = () =>
  page.evaluate(() => {
    const g = window.roaddash;
    const p = g.player;
    return {
      lane: p.lane,
      x: +p.x.toFixed(2),
      y: +p.y.toFixed(2),
      airborne: p.airborne,
      sliding: p.sliding,
      hp: p.hp,
      maxHp: p.maxHp,
      alive: p.alive,
      nitro: +p.nitro.toFixed(1),
      speed: +g.speed.toFixed(1),
      distance: +g.distance.toFixed(1),
      state: g.state,
      combo: g.combo,
      score: +g.score.toFixed(0),
    };
  });

const results = [];
const check = (name, ok, detail = '') => {
  results.push({ name, ok, detail });
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}${detail ? `  (${detail})` : ''}`);
};

/**
 * Standard preamble: clear the road, park the car in `lane` with full armour,
 * and pin the road speed.
 *
 * The speed pin matters more than it looks. The game's speed ramp is a function
 * of distance travelled, so by the time a late test runs the car may be doing
 * 50 m/s; when that happens to match a sedan's own speed the closing rate goes
 * to zero, any time-to-contact estimate diverges, and a correctly-timed jump
 * lands before the car ever arrives. Fixing the speed makes the relative rate
 * deterministic.
 */
const clean = (lane = 1, speed = 34) => `
  g.debugFreezeSpawners();
  g.debugResetPlayer(${lane});
  g.debugSetSpeed(${speed});
  g.combo = 0;
`;

// ---------------------------------------------------------------- lane change
let s = await readState();
{
  const res = await run(`
    const g = window.roaddash;
    ${clean(1)}
    g.debugAction('left');
    for (let i = 0; i < 20; i++) g.debugStep(1);
    const afterLeft = { lane: g.player.lane, x: +g.player.x.toFixed(2) };
    g.debugAction('right');
    g.debugAction('right');
    for (let i = 0; i < 20; i++) g.debugStep(1);
    const afterRight = { lane: g.player.lane, x: +g.player.x.toFixed(2) };
    g.debugAction('right');           // already at the right edge
    for (let i = 0; i < 10; i++) g.debugStep(1);
    const clamped = g.player.lane;
    return { afterLeft, afterRight, clamped };
  `);
  check(
    'lane change left then right',
    res.afterLeft.lane === 0 && res.afterLeft.x < -3.3 && res.afterRight.lane === 2,
    JSON.stringify(res),
  );
  check('lane clamps at the right edge', res.clamped === 2, `lane=${res.clamped}`);
}

let obs = await run(`
  const g = window.roaddash;
  ${clean(1)}
  g.debugAction('jump');
  let peak = 0;
  for (let i = 0; i < 90; i++) { g.debugStep(1); peak = Math.max(peak, g.player.y); }
  return { peak: +peak.toFixed(2) };
`);
check('jump reaches a useful height', obs.peak > 1.2, `peak=${obs.peak}`);

// ------------------------------------------------------- jump over a barrier
/**
 * Fire `action` when the hazard is `lead` seconds away, computed from the
 * closing speed (player speed plus the hazard's own Z velocity, which is
 * negative as it drives away). Distance alone is the wrong measure: every
 * hazard kind recedes at a different rate, so a fixed lead distance either
 * jumps too early or too late.
 */
const timedRun = (kind, action, lead, lane, isVehicle, vehicleSpeed, ahead = 120) =>
  run(`
    const g = window.roaddash;
    ${clean(lane)}
    g.debugSpawn(${JSON.stringify(kind)}, ${lane}, ${ahead}, ${isVehicle}, ${
      vehicleSpeed ?? 'undefined'
    });
    let fired = false, peak = 0, minHeightInWindow = Infinity, actionTook = null;
    for (let i = 0; i < 1200; i++) {
      // Re-pin every frame: step() eases speed back toward its distance-based
      // target, so a one-shot set drifts as the run progresses.
      g.debugSetSpeed(${34});
      const h = g.traffic.hazards[0];
      if (h) {
        const closing = g.speed + h.vz;
        // Lead time is measured to the moment the boxes first touch, not to the
        // hazard's centre: a long truck overlaps the player long before its
        // middle arrives.
        const touchAt = h.halfLength + g.player.halfLength;
        const toTouch = (g.playerZ - h.z - touchAt) / Math.max(1, closing);
        if (!fired && toTouch > 0 && toTouch <= ${lead}) {
          const before = {
            y: g.player.y,
            airborne: g.player.airborne,
            sliding: g.player.sliding,
            slideTimer: g.player.slideTimer,
            state: g.state,
          };
          g.debugAction(${JSON.stringify(action)});
          fired = true;
          actionTook = {
            yBefore: +before.y.toFixed(2),
            yAfter: +g.player.y.toFixed(2),
            airborneBefore: before.airborne,
            airborneAfter: g.player.airborne,
            slidingBefore: before.sliding,
            slidingAfter: g.player.sliding,
            state: before.state,
          };
        }
        // Track the car's height across the whole overlap window, not just at
        // the hazard's centre: the leading edge is what actually clips you.
        const dz = h.z - g.playerZ;
        if (fired && Math.abs(dz) < touchAt) {
          minHeightInWindow = Math.min(minHeightInWindow, g.player.y);
        }
        if (fired && dz > 6) break;
      }
      g.debugStep(1);
      peak = Math.max(peak, g.player.y);
    }
    return {
      peak: +peak.toFixed(2),
      minHeightInWindow:
        minHeightInWindow === Infinity ? null : +minHeightInWindow.toFixed(2),
      fired,
      actionTook,
      hp: g.player.hp,
      maxHp: g.player.maxHp,
    };
  `);

{
  const res = await timedRun('barrier', 'jump', 0.3, 1, false);
  check(
    'jump clears a barrier',
    res.hp === res.maxHp,
    `hp=${res.hp}/${res.maxHp} minHeightOverBarrier=${res.minHeightInWindow}`,
  );
  check('jump apex clears barrier height', res.peak > 1.2, `peak=${res.peak}`);
}

{
  const res = await timedRun('cones', 'jump', 0.3, 1, false);
  check('jump clears cones', res.hp === res.maxHp, `hp=${res.hp}/${res.maxHp}`);
}

// Pin the sedan's speed so the closing rate is deterministic. Left to the
// spawner's 16–28 m/s range, a car doing 25 m/s against a player doing 34 m/s
// closes at 9 m/s, which stretches the overlap window to roughly a second — the
// whole hang time — and a correctly-timed jump no longer clears it. That is a
// real (if marginal) gameplay situation, not a bug, so it gets its own check
// below rather than being hidden by a lucky speed.
{
  const res = await timedRun('sedan', 'jump', 0.3, 1, true, 18);
  check(
    'jump clears a receding sedan',
    res.hp === res.maxHp,
    `hp=${res.hp}/${res.maxHp} minHeightOverCar=${res.minHeightInWindow}`,
  );
}

// Matched-speed traffic: the car is effectively alongside for over a second, so
// the jump runs out before the overlap does and the player has to change lanes
// instead. The car keeps hitting afterwards, so assert only that the jump did
// not save it, not on an exact armour count.
{
  // Spawned closer: at this closing rate 120 m takes 40 s of simulated time.
  const res = await timedRun('sedan', 'jump', 0.3, 1, true, 31, 40);
  check(
    'matched-speed traffic cannot be jumped',
    res.hp < res.maxHp,
    `hp=${res.hp}/${res.maxHp} minHeightOverCar=${res.minHeightInWindow}`,
  );
}

// A tall truck is out of reach no matter how early you jump.
{
  const res = await timedRun('truck', 'jump', 0.3, 1, true);
  check('a truck cannot be jumped', res.hp === res.maxHp - 1, `hp=${res.hp}/${res.maxHp}`);
}

{
  const res = await timedRun('sign', 'slide', 0.25, 1, false);
  check('duck clears an overhead sign', res.hp === res.maxHp, `hp=${res.hp}/${res.maxHp}`);
}

// ------------------------------------------------------- jump clears a sedan
// Jumping too early must fail — the jump is a timing skill, not a free pass.
{
  const res = await timedRun('sedan', 'jump', 0.85, 1, true);
  check('jumping far too early still fails', res.hp === res.maxHp - 1, `hp=${res.hp}/${res.maxHp}`);
}

// Standing into the same sign must cost armour.
{
  const res = await run(`
    const g = window.roaddash;
    g.debugFreezeSpawners();
    g.debugResetPlayer(1);
    g.debugSpawn('sign', 1, 60);
    for (let i = 0; i < 600; i++) {
      g.debugStep(1);
      if (g.player.hp < g.player.maxHp) break;
    }
    return { hp: g.player.hp, maxHp: g.player.maxHp };
  `);
  check('standing into a sign costs armour', res.hp === res.maxHp - 1, `hp=${res.hp}/${res.maxHp}`);
}

// ------------------------------------------------------------- ramp launch
{
  const res = await run(`
    const g = window.roaddash;
    g.debugFreezeSpawners();
    g.debugResetPlayer(1);
    g.debugSpawn('ramp', 1, 60);
    let peak = 0;
    for (let i = 0; i < 600; i++) {
      g.debugStep(1);
      peak = Math.max(peak, g.player.y);
      if (g.player.y > 0.5 && g.player.y < 0.02) break;
    }
    return { peak: +peak.toFixed(2), nitro: +g.player.nitro.toFixed(1) };
  `);
  check('ramp launches the car', res.peak > 1.6, `peak=${res.peak}`);
  check('ramp charges nitro', res.nitro > 0, `nitro=${res.nitro}`);
}

// ------------------------------------------------------------------- crashes
{
  const res = await run(`
    const g = window.roaddash;
    g.debugFreezeSpawners();
    g.debugResetPlayer(1);
    const before = g.speed;
    g.debugSpawn('truck', 1, 60, true);
    let hit = false;
    for (let i = 0; i < 600; i++) {
      g.debugStep(1);
      if (g.player.hp < g.player.maxHp) { hit = true; break; }
    }
    return { hit, hp: g.player.hp, maxHp: g.player.maxHp, before: +before.toFixed(1), after: +g.speed.toFixed(1) };
  `);
  check('hitting a truck costs armour', res.hp === res.maxHp - 1, `hp=${res.hp}/${res.maxHp}`);
  check('crash scrubs speed', res.after < res.before, `${res.before}→${res.after}`);
}

// Armour running out ends the run.
{
  const res = await run(`
    const g = window.roaddash;
    g.debugFreezeSpawners();
    g.debugResetPlayer(1);
    g.player.hp = 1;
    g.debugSpawn('bus', 1, 60, true);
    for (let i = 0; i < 600; i++) {
      g.debugStep(1);
      if (g.state === 'over') break;
    }
    return { state: g.state, alive: g.player.alive };
  `);
  check('armour running out ends the run', res.state === 'over' && !res.alive, JSON.stringify(res));
}

// ------------------------------------------------------------------ restart
await new Promise((r) => setTimeout(r, 900));
{
  const visible = await page.evaluate(() => !document.getElementById('overScreen').hidden);
  check('results panel appears', visible, `visible=${visible}`);
  await page.screenshot({ path: `${shotDir}/gameover.png` });
  await page.evaluate(() => document.getElementById('retryButton')?.click());
  await new Promise((r) => setTimeout(r, 500));
  s = await readState();
  check(
    'restart resets the run',
    s.state === 'playing' && s.hp === s.maxHp && s.distance < 500,
    `hp=${s.hp}/${s.maxHp} d=${s.distance}`,
  );
}

// ----------------------------------------------------------------- near miss
{
  const res = await run(`
    const g = window.roaddash;
    ${clean(0)}          // sit in the left lane
    g.debugSpawn('sedan', 1, 60, true);   // traffic in the centre lane
    const nitroBefore = g.player.nitro;
    for (let i = 0; i < 900; i++) {
      g.debugSetSpeed(34);
      g.debugStep(1);
      if (g.player.nitro > nitroBefore) break;
    }
    return {
      nitroBefore: +nitroBefore.toFixed(1),
      nitro: +g.player.nitro.toFixed(1),
      hp: g.player.hp,
      maxHp: g.player.maxHp,
      combo: g.combo,
    };
  `);
  check('near miss charges nitro', res.nitro > res.nitroBefore, JSON.stringify(res));
  check('near miss does no damage', res.hp === res.maxHp, `hp=${res.hp}/${res.maxHp}`);
}

// Far-away traffic should NOT count as a near miss.
{
  const res = await run(`
    const g = window.roaddash;
    ${clean(0)}
    g.debugSpawn('sedan', 2, 60, true);   // far lane, wide gap
    for (let i = 0; i < 900; i++) {
      g.debugSetSpeed(34);
      g.debugStep(1);
      if (g.traffic.hazards.length === 0) break;
    }
    return { nitro: +g.player.nitro.toFixed(1) };
  `);
  check('distant traffic gives no near-miss', res.nitro === 0, `nitro=${res.nitro}`);
}

// --------------------------------------------------------------------- nitro
{
  const res = await run(`
    const g = window.roaddash;
    ${clean(1)}
    for (let i = 0; i < 240; i++) g.debugStep(1);
    const before = +g.speed.toFixed(1);
    g.player.nitro = 100;
    g.debugAction('nitro');
    const active = g.player.nitroActive;
    for (let i = 0; i < 240; i++) g.debugStep(1);
    return { active, before, after: +g.speed.toFixed(1), nitro: +g.player.nitro.toFixed(1) };
  `);
  check('nitro engages', res.active, `active=${res.active}`);
  check('nitro raises top speed', res.after > res.before + 5, `${res.before}→${res.after}`);
  check('nitro burn drains the bar', res.nitro < 100, `nitro=${res.nitro}`);
}

// ------------------------------------------------------------------ pause
{
  await run(`
    const g = window.roaddash;
    ${clean(1)}
    g.player.nitro = 100;
  `);
  await page.keyboard.press('KeyP');
  await new Promise((r) => setTimeout(r, 250));
  const paused = await page.evaluate(() => ({
    panel: !document.getElementById('pauseScreen').hidden,
    state: window.roaddash.state,
  }));
  check('pause opens the panel', paused.panel && paused.state === 'paused', JSON.stringify(paused));
  const frozen = await run(`
    const g = window.roaddash;
    const snapshot = () => JSON.stringify({
      lane: g.player.lane, y: g.player.y, vy: g.player.vy,
      airborne: g.player.airborne, sliding: g.player.sliding,
      nitroActive: g.player.nitroActive, nitro: g.player.nitro,
      distance: g.distance, score: g.score,
    });
    const before = snapshot();
    for (const action of ['left', 'right', 'jump', 'slide', 'nitro', 'confirm']) {
      g.debugAction(action);
    }
    g.debugStep(60);
    return { before, after: snapshot() };
  `);
  check('pause ignores driving actions and freezes simulation', frozen.before === frozen.after);
  await page.evaluate(() => window.dispatchEvent(new KeyboardEvent('keydown', {
    code: 'KeyP', repeat: true, cancelable: true,
  })));
  check('holding pause does not resume', await page.evaluate(() => window.roaddash.state === 'paused'));
  await page.focus('#resumeButton');
  await page.keyboard.press('Enter');
  check('keyboard activates resume button', await page.evaluate(() => window.roaddash.state === 'playing'));
  await page.keyboard.press('KeyP');
  await page.keyboard.press('KeyP');
  await new Promise((r) => setTimeout(r, 250));
  const resumed = await page.evaluate(() => window.roaddash.state);
  check('pause resumes', resumed === 'playing', resumed);
}

// ---------------------------------------------------------- keyboard toggles
{
  const held = await run(`
    const g = window.roaddash;
    ${clean(1)}
    g.player.nitro = 100;
    const key = repeat => window.dispatchEvent(new KeyboardEvent('keydown', {
      code: 'Space', repeat, cancelable: true,
    }));
    key(false);
    const activated = g.player.nitroActive;
    key(true);
    window.dispatchEvent(new KeyboardEvent('keyup', { code: 'Space' }));
    return { activated, stillActive: g.player.nitroActive };
  `);
  check('holding nitro does not cancel the boost', held.activated && held.stillActive);
  const mutedBefore = await page.evaluate(() => window.roaddash.muted);
  await page.focus('#muteButton');
  await page.keyboard.press('Space');
  const mute = await page.evaluate(() => ({
    muted: window.roaddash.muted,
    nitroActive: window.roaddash.player.nitroActive,
  }));
  check('space activates mute without toggling nitro', mute.muted !== mutedBefore && mute.nitroActive);
}

// ---------------------------------------------------------- road buffer safety
{
  const road = await run(`
    const g = window.roaddash;
    g.debugAction('pause');
    const ribbon = g.ribbon;
    const position = ribbon.mesh.geometry.attributes.position;
    const color = ribbon.mesh.geometry.attributes.color;
    const verticesPerRow = (ribbon.bands.length + 2) * 6;
    const wholeRows = Number.isInteger(position.count / verticesPerRow);
    ribbon.update(-123);
    const z0 = position.array[position.array.length - 34];
    const anchor = -123 + ((-z0 % 13 + 13) % 13) - 1;
    ribbon.update(anchor); // put the final row inside the painted dash phase
    const version = position.version;
    ribbon.update(anchor);
    const unchanged = position.version === version;
    // The last row must contain both lane dividers, with road-marking height
    // and a real palette colour; a short buffer used to drop these vertices.
    const last = Array.from(position.array.slice(-36));
    const lastColors = Array.from(color.array.slice(-36));
    const complete = wholeRows && last.every(Number.isFinite) &&
      last.filter((_, i) => i % 3 === 1).every(y => Math.abs(y - 0.024) < 1e-6) &&
      lastColors.every(c => c > 0);
    const facesUp = [0, 18].every(i => {
      const abX = last[i + 3] - last[i];
      const abZ = last[i + 5] - last[i + 2];
      const acX = last[i + 6] - last[i];
      const acZ = last[i + 8] - last[i + 2];
      return abZ * acX - abX * acZ > 0;
    });
    ribbon.update(anchor - 1);
    return { unchanged, complete, facesUp, moved: position.version === version + 1 };
  `);
  check('road retains both dividers in the final row', road.complete);
  check('both lane dividers face the camera above the road', road.facesUp);
  check('stationary road skips GPU uploads', road.unchanged);
  check('moving road refreshes GPU buffer', road.moved);
}

await browser.close();

const failed = results.filter((r) => !r.ok);
if (errors.length) {
  console.error('\nruntime errors:');
  for (const e of errors) console.error(' -', e);
}
console.log(`\n${results.length - failed.length}/${results.length} checks passed`);
if (failed.length || errors.length) process.exit(1);
