/**
 * Soak test: runs a long session on a fixed timestep and watches for the
 * failure modes that only show up over time — unbounded scene graph growth
 * from pooling mistakes, runaway counters, and entity counts that never
 * settle.
 *
 * Usage: node tools/soak.mjs [--seconds 60]
 */
import puppeteer from 'puppeteer-core';

const args = process.argv.slice(2);
const flag = (n, d) => {
  const i = args.indexOf(`--${n}`);
  return i === -1 ? d : args[i + 1];
};
const seconds = Number(flag('seconds', '60'));
const CHROME = process.env.CHROME_PATH ?? '/usr/bin/chromium-browser';

const browser = await puppeteer.launch({
  executablePath: CHROME,
  headless: 'new',
  args: [
    '--no-sandbox',
    '--disable-dev-shm-usage',
    '--use-gl=swiftshader',
    '--enable-unsafe-swiftshader',
    '--window-size=900,600',
    '--mute-audio',
  ],
});
const page = await browser.newPage();
await page.setViewport({ width: 900, height: 600 });
const errors = [];
page.on('pageerror', (e) => errors.push(e.message));
page.on('console', (m) => m.type() === 'error' && errors.push(m.text()));
await page.goto(flag('url', 'http://localhost:5173/'), { waitUntil: 'networkidle2' });
await page.evaluate(() => document.getElementById('startButton')?.click());
await new Promise((r) => setTimeout(r, 300));

// A simple bot: dodge, jump, duck, boost — enough to exercise every system.
await page.evaluate(`(() => {
  const g = window.roaddash;
  window.__bot = (frames) => {
    for (let i = 0; i < frames; i++) {
      const p = g.player;
      // Steer toward the emptiest lane.
      const threat = [0, 1, 2].map((lane) => {
        let n = 0;
        for (const h of g.traffic.hazards) {
          if (h.lane === lane && h.z - g.playerZ > -30 && h.z - g.playerZ < 90) n += 1;
        }
        return n;
      });
      const best = threat.indexOf(Math.min(...threat));
      if (best !== p.lane && i % 40 === 0) g.debugAction(best < p.lane ? 'left' : 'right');
      // React to whatever is directly ahead.
      const ahead = g.traffic.hazards
        .filter((h) => h.lane === p.lane)
        .map((h) => ({ h, d: h.z - g.playerZ }))
        .sort((a, b) => a.d - b.d)[0];
      if (ahead) {
        const closing = g.speed + ahead.h.vz;
        const t = (g.playerZ - ahead.h.z - (ahead.h.halfLength + p.halfLength)) / Math.max(1, closing);
        if (t > 0 && t < 0.4) {
          if (ahead.h.overhead > 0) g.debugAction('slide');
          else if (ahead.h.top < 1.6) g.debugAction('jump');
          else if (best !== p.lane) g.debugAction(best < p.lane ? 'left' : 'right');
        }
      }
      if (p.nitro > 90 && i % 200 === 0) g.debugAction('nitro');
      g.debugStep(1);
      if (g.state === 'over') g.debugAction('jump'); // restart via the action layer
    }
  };
})()`);

const samples = [];
const totalFrames = Math.round(seconds * 60);
const chunk = 600;
for (let done = 0; done < totalFrames; done += chunk) {
  const s = await page.evaluate((frames) => {
    window.__bot(frames);
    const g = window.roaddash;
    let meshes = 0;
    g.scene.traverse((o) => {
      if (o.isMesh || o.isPoints || o.isLine) meshes++;
    });
    return {
      simSeconds: +((g.distance / Math.max(1, g.speed)) || 0).toFixed(0),
      distance: Math.round(g.distance),
      sceneChildren: g.scene.children.length,
      meshes,
      hazards: g.traffic.hazards.length,
      pickups: g.coins.pickups.length,
      props: g.props.active.length,
      zones: g.hints.zones.length,
      score: Math.round(g.score),
      state: g.state,
      best: g.best,
    };
  }, Math.min(chunk, totalFrames - done));
  samples.push(s);
  process.stdout.write(
    `t+${String(Math.round(((done + chunk) / totalFrames) * seconds)).padStart(3)}s  ` +
      `dist=${String(s.distance).padStart(6)}  meshes=${String(s.meshes).padStart(4)}  ` +
      `hazards=${String(s.hazards).padStart(2)}  pickups=${String(s.pickups).padStart(3)}  ` +
      `props=${String(s.props).padStart(3)}  zones=${String(s.zones).padStart(4)}  score=${s.score}\n`,
  );
}

await browser.close();

const first = samples[1] ?? samples[0];
const last = samples[samples.length - 1];
const problems = [];
if (errors.length) problems.push(...errors);
if (last.meshes > first.meshes * 1.5 + 40) {
  problems.push(`scene graph grew: ${first.meshes} → ${last.meshes} meshes`);
}
if (last.zones > 2000) problems.push(`track hints not pruned: ${last.zones} zones`);
if (last.pickups > 200) problems.push(`pickup pool overrun: ${last.pickups}`);
if (last.hazards > 60) problems.push(`hazard pool overrun: ${last.hazards}`);
if (last.props > 260) problems.push(`prop pool overrun: ${last.props}`);

console.log(`\nbest score reached: ${last.best}`);
if (problems.length) {
  console.error('\nproblems:');
  for (const p of problems) console.error(' -', p);
  process.exit(1);
}
console.log('soak: OK');
