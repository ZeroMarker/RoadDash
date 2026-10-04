/**
 * Keyboard + assistive-technology behaviour of the interface layer.
 *
 * tools/design.mjs checks the markup and the stylesheet are shaped right.
 * This drives a real browser to check they behave right: that arrows move the
 * car selection exactly once and carry focus with them, that Tab reaches every
 * control, that the mute button reports its state, and that reduced-motion is
 * honoured. Those are the parts a static check cannot see.
 *
 * Usage: node tools/a11y.mjs [--url http://localhost:5173/]
 */
import puppeteer from 'puppeteer-core';

const args = process.argv.slice(2);
const flag = (n, d) => {
  const i = args.indexOf(`--${n}`);
  return i === -1 ? d : args[i + 1];
};
const CHROME = process.env.CHROME_PATH ?? '/usr/bin/chromium-browser';

let failed = 0;
let total = 0;
const check = (name, ok, detail = '') => {
  total++;
  if (!ok) failed++;
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}${detail ? `  (${detail})` : ''}`);
};

const browser = await puppeteer.launch({
  executablePath: CHROME,
  headless: 'new',
  args: [
    '--no-sandbox',
    '--disable-dev-shm-usage',
    '--use-gl=swiftshader',
    '--enable-unsafe-swiftshader',
    '--mute-audio',
    '--window-size=1280,800',
  ],
});
const page = await browser.newPage();
await page.setViewport({ width: 1280, height: 800 });
const errors = [];
page.on('pageerror', (e) => errors.push(e.message));
await page.goto(flag('url', 'http://localhost:5173/'), { waitUntil: 'networkidle2' });

// --------------------------------------------------------- car picker: arrows
const selectedIndex = () =>
  page.evaluate(() =>
    [...document.querySelectorAll('.car-card')].findIndex((c) =>
      c.classList.contains('selected'),
    ),
  );

check('first car starts selected', (await selectedIndex()) === 0, `index=${await selectedIndex()}`);

await page.evaluate(() => document.querySelectorAll('.car-card')[0]?.focus());
await page.keyboard.press('ArrowRight');
const afterRight = await selectedIndex();
check('ArrowRight moves the selection one step', afterRight === 1, `index=${afterRight}`);

const focusTracks = await page.evaluate(() => {
  const active = document.activeElement;
  const cards = [...document.querySelectorAll('.car-card')];
  return cards.indexOf(active);
});
check(
  'focus follows the selection',
  focusTracks === afterRight,
  `focus=${focusTracks} selection=${afterRight}`,
);

await page.keyboard.press('ArrowLeft');
const afterLeft = await selectedIndex();
check('ArrowLeft moves it back', afterLeft === 0, `index=${afterLeft}`);

await page.keyboard.press('ArrowLeft');
check(
  'selection clamps at the first car',
  (await selectedIndex()) === 0,
  `index=${await selectedIndex()}`,
);

await page.keyboard.press('ArrowRight');
await page.keyboard.press('ArrowRight');
await page.keyboard.press('ArrowRight');
check(
  'selection clamps at the last car',
  (await selectedIndex()) === 2,
  `index=${await selectedIndex()}`,
);

// ------------------------------------------------ tab order (still in the menu)
// Checked before a run starts: once the menu is hidden its controls leave the
// tab order, and the HUD's mute button is the only thing left reachable.
const seen = new Map();
for (let i = 0; i < 6; i++) {
  await page.keyboard.press('Tab');
  const stop = await page.evaluate(() => {
    const el = document.activeElement;
    if (!el || el === document.body) return null;
    const s = getComputedStyle(el);
    return {
      id: el.id || el.className || el.tagName,
      hasRing:
        el.matches(':focus-visible') && (
          (s.boxShadow !== 'none' && !s.boxShadow.includes('inset')) ||
          (s.outlineStyle !== 'none' && parseFloat(s.outlineWidth) > 0)
        ),
    };
  });
  if (stop) seen.set(stop.id, stop);
}

const stops = [...seen.values()];
check(
  'tabbing reaches the car picker and the start button',
  stops.some((s) => s.id.includes('car-card')) && stops.some((s) => s.id === 'startButton'),
  stops.map((s) => s.id).join(' → '),
);
check(
  'every tab stop draws a focus indicator',
  stops.every((s) => s.hasRing),
  stops
    .filter((s) => !s.hasRing)
    .map((s) => s.id)
    .join(', '),
);

// Arrows are the input layer's lane-change verbs during a run; in the menu
// they must not also reach the game as a lane change.
await page.evaluate(() => document.getElementById('startButton')?.click());
const laneAfterArrows = await page.evaluate(() => window.roaddash?.player.lane ?? -1);
check('menu arrows never steer the car', laneAfterArrows === 1, `lane=${laneAfterArrows}`);

// --------------------------------------------------------- radiogroup markup
const group = await page.evaluate(() => {
  const cards = [...document.querySelectorAll('.car-card')];
  return {
    role: document.getElementById('carSelect')?.getAttribute('role'),
    checked: cards.map((c) => c.getAttribute('aria-checked')),
    tabbable: cards.filter((c) => c.tabIndex === 0).length,
    labelled: cards.every((c) => (c.getAttribute('aria-label') ?? '').length > 0),
    stats: cards.every((c) => [...c.querySelectorAll('.bar')].every((b) => !!b.title)),
  };
});
check('car picker is a radiogroup', group.role === 'radiogroup');
check(
  'exactly one card is aria-checked',
  group.checked.filter((v) => v === 'true').length === 1,
  group.checked.join(','),
);
check('the group is a single tab stop', group.tabbable === 1, `${group.tabbable} tabbable`);
check('every card has an accessible name', group.labelled);
check('every stat bar has a text equivalent', group.stats);

// --------------------------------------------------------- tab order / reach
// Roving tabindex deliberately takes two cards out of the tab order, so the
// only thing that matters is that every button is reachable by Tab — which
// means walking the order the way the browser does.
const unreachable = await page.evaluate(() => {
  const focusable = [...document.querySelectorAll('button')].filter((b) => b.tabIndex >= 0);
  return focusable.filter((b) => b.offsetParent === null && !b.closest('[hidden]')).length;
});
check('every button is reachable', unreachable === 0, `${unreachable} unreachable`);

// ------------------------------------------------------------------- overlay
await page.evaluate(() => document.getElementById('startButton')?.click());
await new Promise((r) => setTimeout(r, 200));
await page.focus('#muteButton');
await page.keyboard.press('KeyP');
await new Promise((r) => setTimeout(r, 200));

const paused = await page.evaluate(() => ({
  visible: !document.getElementById('pauseScreen')?.hidden,
  modal: document.getElementById('pauseScreen')?.getAttribute('aria-modal'),
  title: document.getElementById('pauseTitle')?.textContent?.trim(),
  // The pause panel must not present itself as a loss.
  colour: getComputedStyle(document.getElementById('pauseTitle')).color,
  focused: document.activeElement.id,
  backgroundInert: document.getElementById('hud').inert && document.getElementById('scene').inert,
}));
check('pause opens', paused.visible);
check('pause is a modal dialog', paused.modal === 'true');
check('pause is labelled by its title', !!paused.title);
check('opening pause moves focus to resume', paused.focused === 'resumeButton', paused.focused);
check('pause makes the background inert', paused.backgroundInert);
await page.keyboard.down('Shift');
await page.keyboard.press('Tab');
await page.keyboard.up('Shift');
check('Shift+Tab wraps to the last dialog control', await page.evaluate(() => document.activeElement.id === 'quitButton'));
await page.keyboard.press('Tab');
check('Tab wraps to the first dialog control', await page.evaluate(() => document.activeElement.id === 'resumeButton'));
const pauseStops = [];
for (let i = 0; i < 6; i++) {
  await page.keyboard.press('Tab');
  pauseStops.push(await page.evaluate(() => document.activeElement.id));
}
check('tabbing stays inside pause', pauseStops.every(id => ['resumeButton', 'quitButton'].includes(id)), pauseStops.join(' → '));
await page.focus('#muteButton');
check('background controls cannot take focus', await page.evaluate(() => document.getElementById('pauseScreen').contains(document.activeElement)));
// rgb(255, 59, 82) is --danger, the colour the results panel uses to say
// "you lost". A pause panel wearing it would say the same thing.
const DANGER = 'rgb(255, 59, 82)';
check('pause is not styled as a wreck', paused.colour !== DANGER, paused.colour);

// ------------------------------------------------------------------ mute state
await page.keyboard.press('Escape');
check('closing pause restores the previous focus', await page.evaluate(() => document.activeElement.id === 'muteButton'));
check('closing pause restores background interaction', await page.evaluate(() => !document.getElementById('hud').inert && !document.getElementById('scene').inert));
await page.evaluate(() => document.getElementById('muteButton')?.click());
const muted = await page.evaluate(() => {
  const b = document.getElementById('muteButton');
  return {
    pressed: b?.getAttribute('aria-pressed'),
    label: b?.getAttribute('aria-label'),
    dimmed: b?.classList.contains('muted'),
  };
});
check('mute reports pressed=true when muted', muted.pressed === 'true');
check('mute label flips to the action it performs', /unmute/i.test(muted.label ?? ''), muted.label);
check('mute is visually dimmed', muted.dimmed);

await page.evaluate(() => document.getElementById('muteButton')?.click());
const unmuted = await page.evaluate(() => document.getElementById('muteButton')?.getAttribute('aria-pressed'));
check('mute reports pressed=false when unmuted', unmuted === 'false');

// ------------------------------------------------------------------- gauges
await page.evaluate(() => window.roaddash?.startRun?.() ?? document.getElementById('startButton')?.click());
await new Promise((r) => setTimeout(r, 200));

const gauges = await page.evaluate(() => {
  const g = window.roaddash;
  g.hud.setShield(1, 3);
  g.hud.setNitro(0, false);
  return {
    shield: document.getElementById('shieldRow')?.getAttribute('aria-label'),
    pips: [...document.querySelectorAll('#shieldRow .pip')].map((p) =>
      p.className.replace('pip', '').trim() || 'on',
    ),
  };
});
const speedometer = await page.evaluate(() => {
  const hud = window.roaddash.hud;
  const dial = document.querySelector('.speedo');
  hud.setSpeed(170, 0.5, false);
  const normal = dial.getBoundingClientRect().width;
  hud.setSpeed(170, 0.5, true);
  const boosted = dial.getBoundingClientRect().width;
  hud.setSpeed(170, 0.5, false);
  return { normal, boosted };
});
check('boosting does not resize the speedometer', Math.abs(speedometer.normal - speedometer.boosted) < 0.1, JSON.stringify(speedometer));
check('shield state is readable', /Armour 1 of 3/.test(gauges.shield ?? ''), gauges.shield);
check(
  'the last pip is marked as the low state',
  gauges.pips.filter((p) => p === 'low').length === 1,
  gauges.pips.join(','),
);

const nitro = await page.evaluate(() => {
  const g = window.roaddash;
  g.hud.setNitro(50, false);
  const mid = document.querySelector('.nitro-track')?.getAttribute('aria-label');
  g.hud.setNitro(100, false);
  const full = document.querySelector('.nitro-track')?.getAttribute('aria-label');
  return { mid, full, label: document.getElementById('nitroLabel')?.textContent };
});
check('nitro is readable as a value', /50%/.test(nitro.mid ?? ''), nitro.mid);
check('a full bar says so', /100%/.test(nitro.full ?? ''), nitro.full);
check('a full bar is labelled READY', nitro.label === 'READY', nitro.label);

const precise = await page.evaluate(() => [13, 24, 24.99, 25, 88, 99.99, 100].map(value => {
  const g = window.roaddash;
  g.player.nitro = value;
  g.player.nitroActive = false;
  g.hud.setNitro(value, false);
  return {
    value,
    spoken: Number(document.querySelector('.nitro-track').getAttribute('aria-label').match(/[\d.]+/)[0]),
    canActivate: g.player.toggleNitro(),
  };
}));
check('nitro labels stay within a quarter percent without rounding up', precise.every(v => v.spoken <= v.value && v.value - v.spoken < 0.25), JSON.stringify(precise));
check('nitro labels do not promise unavailable activation or a full bar', precise.every(v => (v.spoken < 25 || v.canActivate) && (v.spoken < 100 || v.value === 100)));

// Results are a modal too, and changing cars must not retain a hidden trigger.
await page.evaluate(() => window.roaddash.debugPause(true));
await page.click('#quitButton');
check('changing cars focuses the selected menu option', await page.evaluate(() => document.activeElement.matches('.car-card.selected')));
await page.focus('#startButton');
await page.keyboard.press('Enter');
check('starting a run focuses the canvas and releases inert', await page.evaluate(() => document.activeElement.id === 'scene' && !document.getElementById('scene').inert));
await page.evaluate(() => window.roaddash.debugCrash());
await page.waitForFunction(() => !document.getElementById('overScreen').hidden);
check('results focus the retry button', await page.evaluate(() => document.activeElement.id === 'retryButton'));
await page.keyboard.press('Tab');
check('results trap focus on their only control', await page.evaluate(() => document.activeElement.id === 'retryButton'));
await page.keyboard.press('Enter');
check('retry returns focus to the canvas', await page.evaluate(() => document.activeElement.id === 'scene' && window.roaddash.state === 'playing'));

// The per-frame cache must not stop the HUD from tracking a changing value.
const ticks = await page.evaluate(() => {
  const seen = [];
  for (let i = 0; i < 5; i++) {
    window.roaddash.hud.setNitro(i * 20, false);
    seen.push(document.getElementById('nitroFill')?.style.width);
  }
  return seen;
});
check(
  'repeated updates still write through',
  new Set(ticks).size === 5,
  ticks.join(' '),
);

// -------------------------------------------------------------- reduced motion
const calm = await browser.newPage();
await calm.emulateMediaFeatures([{ name: 'prefers-reduced-motion', value: 'reduce' }]);
await calm.setViewport({ width: 1280, height: 800 });
await calm.goto(flag('url', 'http://localhost:5173/'), { waitUntil: 'networkidle2' });
const motion = await calm.evaluate(() => {
  const police = document.getElementById('policeWarning');
  const animation = getComputedStyle(police).animationDuration;
  const pulse = document.querySelector('#shieldRow .pip');
  return {
    animation,
    iterations: getComputedStyle(police).animationIterationCount,
    // A panel transition must also be collapsed.
    overlay: getComputedStyle(document.getElementById('startScreen')).animationDuration,
    pipShadow: pulse ? getComputedStyle(pulse).boxShadow : 'n/a',
  };
});
check(
  'looping pulses collapse under reduced motion',
  parseFloat(motion.animation) < 0.01 && motion.iterations === '1',
  `duration=${motion.animation} iterations=${motion.iterations}`,
);
check(
  'overlay transitions collapse too',
  parseFloat(motion.overlay) < 0.01,
  `duration=${motion.overlay}`,
);
await calm.close();

// --------------------------------------------------------------- live regions
const live = await page.evaluate(() => {
  const banner = document.getElementById('banner');
  window.roaddash.hud.showBanner('MAGNET', 'COINS INBOUND', 'near', 900);
  return {
    role: banner?.getAttribute('role'),
    politeness: banner?.getAttribute('aria-live'),
    hidden: banner?.hidden,
    text: document.getElementById('bannerTitle')?.textContent,
    // A live region must be present in the DOM before it is filled for the
    // change to be announced; it is (the node is static markup).
    inDom: document.body.contains(banner),
  };
});
check('banner is a polite live region', live.role === 'status' && live.politeness === 'polite');
check('banner was revealed with content', live.hidden === false && !!live.text, live.text);
check('banner node lives in the static markup', live.inDom);

const kinds = await page.evaluate(() => {
  const out = [];
  for (const kind of ['near', 'boost', 'danger', '']) {
    window.roaddash.hud.showBanner('X', 'Y', kind, 900);
    out.push(document.getElementById('banner')?.className);
  }
  return out;
});
check(
  'banner kinds do not accumulate stale modifiers',
  kinds[3] === 'banner',
  kinds.join(' | '),
);

await browser.close();
if (errors.length) {
  console.error('page errors:', errors);
  failed++;
}
console.log(`\n${total - failed}/${total} checks passed`);
if (failed > 0) process.exit(1);
