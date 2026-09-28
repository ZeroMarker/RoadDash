/**
 * Screen-space alignment check: projects the car and the lane divider lines to
 * pixels so lane centring can be verified numerically instead of by eye.
 *
 * Usage: node tools/align.mjs
 */
import puppeteer from 'puppeteer-core';

const args = process.argv.slice(2);
const flag = (n, d) => {
  const i = args.indexOf(`--${n}`);
  return i === -1 ? d : args[i + 1];
};
const CHROME = process.env.CHROME_PATH ?? '/usr/bin/chromium-browser';

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
await page.goto(flag('url', 'http://localhost:5173/'), { waitUntil: 'networkidle2' });
await page.evaluate(() => document.getElementById('startButton')?.click());
await new Promise((r) => setTimeout(r, 300));

// Sample several points along the run and report where the car sits relative
// to the two lane dividers, in pixels.
const samples = [];
for (let i = 0; i < 8; i++) {
  await new Promise((r) => setTimeout(r, 900));
  const s = await page.evaluate(() => {
    const g = window.roaddash;
    const cam = g.camera ?? g['camera'];
    const p = g.player ?? g['player'];
    const three = cam.constructor;
    const project = (x, y, z) => {
      const v = new cam.position.constructor(x, y, z);
      v.project(cam);
      return [(v.x * 0.5 + 0.5) * window.innerWidth, (-v.y * 0.5 + 0.5) * window.innerHeight];
    };
    void three;
    const pz = p.group.position.z;
    const cx = p.group.position.x;
    // Divider lines are at laneX(0)+LANE_W/2 and laneX(2)-LANE_W/2.
    const curveX = (z) => Math.sin(z * 0.00115) * 30 + Math.sin(z * 0.00047 + 1.7) * 46;
    const laneW = 3.6;
    const near = [
      project(curveX(pz - 4) - laneW / 2, 0.05, pz - 4),
      project(curveX(pz - 4) + laneW / 2, 0.05, pz - 4),
    ];
    return {
      carPx: project(cx, 0.8, pz)[0],
      dividerLeftPx: near[0][0],
      dividerRightPx: near[1][0],
      lane: p.lane,
      x: p.x,
    };
  });
  samples.push(s);
}

console.log('sample  car_px  divL_px  divR_px  mid_px  offset_px  lane');
for (const s of samples) {
  const mid = (s.dividerLeftPx + s.dividerRightPx) / 2;
  console.log(
    `        ${s.carPx.toFixed(0).padStart(6)}  ${s.dividerLeftPx.toFixed(0).padStart(7)}  ${s.dividerRightPx
      .toFixed(0)
      .padStart(7)}  ${mid.toFixed(0).padStart(6)}  ${(s.carPx - mid).toFixed(0).padStart(9)}  ${s.lane}`,
  );
}
await browser.close();
