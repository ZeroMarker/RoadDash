/**
 * Design-system guard.
 *
 * The token block in src/styles.css is the spec; everything below it has to
 * consume those tokens. A hard-coded colour or font size below the block is
 * how a UI starts drifting — two components each invent their own "small caps
 * label" and end up a pixel apart, and nothing complains until someone
 * screenshots both. This check makes that a build failure instead.
 *
 * Run with: node tools/design.mjs
 */

import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const cssPath = join(root, 'src', 'styles.css');
const htmlPath = join(root, 'index.html');
const css = readFileSync(cssPath, 'utf8');
const html = readFileSync(htmlPath, 'utf8');

let failed = 0;
let total = 0;
const check = (name, ok, detail = '') => {
  total++;
  if (!ok) failed++;
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}${detail ? `  (${detail})` : ''}`);
};

/** Split the sheet at the end of the token block. */
const TOKEN_END = css.indexOf('/* ========================== 2.');
if (TOKEN_END === -1) {
  console.error('could not find the "2." section marker; the token block layout changed');
  process.exit(1);
}
const tokens = css.slice(0, TOKEN_END);
const parts = css.slice(TOKEN_END);
const PART_BASE = css.slice(0, TOKEN_END).split('\n').length;
/** Line number of an offset inside `parts`, in whole-file terms. */
const lineAt = (offset) => parts.slice(0, offset).split('\n').length + PART_BASE;

// ---------------------------------------------------------------- 1. the block
const tokenNames = [...tokens.matchAll(/^\s{2}(--[a-z0-9-]+):/gim)].map((m) => m[1]);
check('token block declares tokens', tokenNames.length > 40, `${tokenNames.length} tokens`);
check('token names are unique', new Set(tokenNames).size === tokenNames.length);

// ------------------------------------------------------- 2. no literals below
/**
 * Colour literals: hex, rgb()/rgba(), hsl(), color-mix() and the colour
 * keywords. `white-space` is guarded against explicitly — otherwise the
 * keyword match fires on a property name.
 */
const COLOR_RE =
  /#[0-9a-f]{3,8}\b|\brgba?\s*\(|\bhsla?\s*\(|\bcolor-mix\s*\(|(?<![\w-])(white|black)(?![\w-])/g;
const colourHits = [...parts.matchAll(COLOR_RE)].map((m) => lineAt(m.index));
check(
  'no colour literals below the token block',
  colourHits.length === 0,
  colourHits.length ? `lines ${colourHits.join(', ')}` : `${parts.split('\n').length} lines scanned`,
);

// font-size with a literal length: var(--fs-*) is the only allowed form.
const fontSizeHits = [...parts.matchAll(/font-size:\s*([^;]+);/g)]
  .map((m) => [m[1], lineAt(m.index)])
  .filter(([value]) => !/^var\(--fs-/.test(value.trim()));
check(
  'every font-size comes from the type scale',
  fontSizeHits.length === 0,
  fontSizeHits.map(([v, l]) => `L${l} ${v}`).join(', '),
);

// Duration literals are allowed only where a scale token does not fit the
// beat: the looping pulses, which are tuned by feel and need to differ.
const DURATION_EXEMPT = new Set([
  '.pip.low', // 0.6s — faster beat than the generic pulse
  '.nitro.full .nitro-fill', // 0.7s
  '.new-best', // 1.1s — slow, celebratory
]);
const durationHits = [...parts.matchAll(/(\.[a-z-][\w.-]*(?:\s[^{]+?)?)\s*\{([^}]*)\}/g)]
  .map((m) => [m[1].trim(), m[2], lineAt(m.index)])
  .filter(([, body]) => /(transition|animation)[^;]*\b\d+m?s\b/.test(body))
  .filter(([selector]) => !DURATION_EXEMPT.has(selector));
check(
  'transitions use the motion scale',
  durationHits.length === 0,
  durationHits.map(([s, , l]) => `L${l} ${s}`).join(', '),
);

const radiusHits = [...parts.matchAll(/border-radius:\s*([^;]+);/g)]
  .map((m) => [m[1], lineAt(m.index)])
  .filter(([value]) => !/var\(--r-/.test(value));
check(
  'every radius comes from the scale',
  radiusHits.length === 0,
  radiusHits.map(([v, l]) => `L${l} ${v}`).join(', '),
);

/**
 * A fluid clamp() that interpolates between two scale steps is fine — that is
 * how the type scale itself is written. One that invents its own endpoints is
 * the ad-hoc pattern this whole file exists to remove.
 */
const CLAMP_EXEMPT = new Set([':root']);
const clampHits = [...parts.matchAll(/^\s*([.#:@][^{]*)\{([^}]*)\}/gm)]
  .filter(([, selector]) => !CLAMP_EXEMPT.has(selector.trim()))
  .map(([full, selector, body]) => [selector.trim(), body, lineAt(full.index)])
  .filter(([, body]) => /clamp\([^)]*(?:px|em)/.test(body))
  .filter(([selector, body]) =>
    // Allow clamps whose endpoints are all var(--s-*).
    ![...body.matchAll(/clamp\(([^)]*)\)/g)].every(
      ([, args]) => !/(^|,)\s*(?:\d*\.?\d+px)/.test(args.replace(/var\(--s-\d+\)/g, '').replace(/,\s*/g, ',')),
    ),
  );
check(
  'no component invents its own fluid ramp',
  clampHits.length === 0,
  clampHits.map(([s, , l]) => `L${l} ${s}`).join(', '),
);

// ------------------------------------------------- 3. tokens are all defined
const defined = new Set(tokenNames);
const used = new Set([...css.matchAll(/var\((--[a-z0-9-]+)/g)].map((m) => m[1]));
const undefined_ = [...used].filter((name) => !defined.has(name));
check('no token is referenced but never defined', undefined_.length === 0, undefined_.join(', '));

const unused = [...defined].filter(
  (name) => ![...css.matchAll(new RegExp(`var\\(${name}[,)]`, 'g'))].length,
);
check('no token is dead weight', unused.length === 0, unused.join(', '));

// ---------------------------------------------------- 4. tokens live in :root
const rootStart = tokens.indexOf(':root');
const rootBody = tokens.slice(rootStart, tokens.indexOf('\n}', rootStart));
const outsideRoot = [...defined].filter((name) => !new RegExp(`^\\s{2}${name}:`, 'm').test(rootBody));
check('every token is declared in :root', outsideRoot.length === 0, outsideRoot.join(', '));
check('the sheet declares a colour scheme', /color-scheme:\s*dark/.test(rootBody));

// -------------------------------------------------- 5. markup uses the hooks
const requiredIds = [
  'hud',
  'speedValue',
  'scoreValue',
  'distanceValue',
  'coinValue',
  'bestValue',
  'shieldRow',
  'nitroFill',
  'nitroLabel',
  'banner',
  'policeWarning',
  'startScreen',
  'overScreen',
  'pauseScreen',
  'overTitle',
  'overReason',
  'overWhere',
  'finalScore',
  'finalDistance',
  'finalCoins',
  'finalBest',
  'newBest',
  'carSelect',
  'startBest',
  'startButton',
  'retryButton',
  'resumeButton',
  'quitButton',
  'muteButton',
];
const missingIds = requiredIds.filter((id) => !html.includes(`id="${id}"`));
check('every id the HUD binds exists in the markup', missingIds.length === 0, missingIds.join(', '));

const requiredClasses = ['car-card', 'bar', 'pip', 'coins', 'speedo', 'nitro-track', 'shield'];
const missingClasses = requiredClasses.filter(
  (cls) => !css.includes(`.${cls}`) || (!html.includes(cls) && !['car-card', 'bar'].includes(cls)),
);
check('every class the HUD toggles is styled and present', missingClasses.length === 0, missingClasses.join(', '));

// ------------------------------------------------------------- 6. a11y basics
const dialogs = [...html.matchAll(/class="overlay"([^>]*)>/g)].map((m) => m[1]);
check(
  'all three overlays are labelled dialogs',
  dialogs.length === 3 && dialogs.every((a) => /role="dialog"/.test(a) && /aria-modal="true"/.test(a) && /aria-labelledby=/.test(a)),
  `${dialogs.length} overlays`,
);

const liveRegions = ['banner', 'policeWarning'].filter((id) =>
  new RegExp(`id="${id}"[^>]*role="status"`).test(html),
);
check('event banners are polite live regions', liveRegions.length === 2, liveRegions.join(', '));

// A live region must not also be aria-hidden, or it announces nothing.
check(
  'no live region is aria-hidden',
  !/id="(?:banner|policeWarning)"[^>]*aria-hidden/.test(html),
);

check('mute button exposes its pressed state', /id="muteButton"[\s\S]{0,200}?aria-pressed/.test(html));

check(
  'shield pips carry a readable label, not just colour',
  /id="shieldRow"[^>]*aria-label/.test(html),
);

check(
  'car picker is a labelled radiogroup',
  /id="carSelect"[^>]*role="radiogroup"/.test(html) && /id="carSelect"[^>]*aria-label=/.test(html),
);

check('motion has a reduced-motion path', /@media \(prefers-reduced-motion: reduce\)/.test(css));

// Focus must be visible somewhere, and must not be removed without a
// replacement — `outline: none` alone is the usual keyboard-accessibility bug.
check('focus styles exist', /:focus-visible/.test(css));
const outlineNone = [...parts.matchAll(/:focus-visible\s*\{([^}]*)\}/g)].filter((m) =>
  /outline:\s*none/.test(m[1]),
);
check(
  'no focus-visible rule removes the ring without replacing it',
  outlineNone.every((m) => /box-shadow|border-color/.test(m[1])),
);

// The dialogs must never sit under the vignette layers.
check(
  'overlays layer above the vignettes',
  Number(getToken('--z-overlay')) > Number(getToken('--z-hurt')) &&
    Number(getToken('--z-hurt')) > Number(getToken('--z-boost')),
  `overlay ${getToken('--z-overlay')} > hurt ${getToken('--z-hurt')} > boost ${getToken('--z-boost')}`,
);

function getToken(name) {
  const m = css.match(new RegExp(`^\\s{2}${name}:\\s*([^;]+);`, 'm'));
  return m ? m[1].trim() : 'NaN';
}

// ------------------------------------------------------------------ verdict
console.log(`\n${total - failed}/${total} checks passed`);
if (failed > 0) process.exit(1);
