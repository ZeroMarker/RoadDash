# RoadDash

A three-lane endless racer for the browser: **Subway Surfers × Burnout**. One
thumb, no brakes — swap lanes, jump ramps, duck signage, and shunt traffic at
140+ km/h while the world keeps changing underneath you.

Built with TypeScript, Vite and three.js. No art assets: every car, building,
cactus and tunnel ring is built from primitives at runtime.

## Play

```bash
npm install
npm run dev      # http://localhost:5173
```

| Action | Keyboard | Touch |
| --- | --- | --- |
| Change lane | `←` `→` / `A` `D` | swipe left / right, or tap the screen edge |
| Jump | `↑` / `W` | swipe up |
| Drift / duck | `↓` / `S` | swipe down |
| Nitro | `Space` | (no touch binding yet) |
| Pause | `Esc` / `P` | — |

## How it plays

The car accelerates on its own. You only manage three things:

- **Lanes.** Traffic drives at its own speed, so the gap closes at a rate you
  have to read, not one you set.
- **Height.** Barriers and cones are low enough to jump, overhead signage has to
  be ducked, and trucks are neither.
- **Nitro.** Squeezing past a car in the next lane, drifting through a corner,
  or hitting a ramp all charge the bar. Nitro adds 30 m/s and makes you
  untouchable while it burns.

A collision costs armour rather than ending the run outright; the run ends when
armour hits zero, or when a police cruiser that starts tailing you around 2 km
catches up. Near misses and drift push the cruiser back.

Six biomes cycle every 760 m — downtown, highway, tunnel, dock, desert, frost —
each with its own palette, fog, prop set and light rig. The loop repeats with a
higher counter.

Three cars trade top end against armour and agility. The best score is kept in
`localStorage`.

## Architecture

```
src/
  main.ts            bootstrap
  styles.css         the design system: tokens, then parts
  game/
    config.ts        all tuning: lane width, curve, biome palettes, car stats
    game.ts          orchestration, state machine, camera, collisions, scoring
    road.ts          the whole road surface as one rewritten-per-frame buffer
    props.ts         pooled roadside dressing
    traffic.ts       vehicles + obstacles, wave spawner, police pursuit
    collectibles.ts  coins and power-ups
    player.ts        lane / jump / drift / nitro / damage
    carModel.ts      every car and obstacle, built from boxes
    gfx.ts           shared geometry + material cache
    effects.ts       particle bursts, speed lines
    audio.ts         synthesised engine, wind, siren, blips
    input.ts         keyboard + touch/swipe → one verb set
    hud.ts           DOM overlay
```

Two decisions shape most of the rest:

**The road is one draw call.** `RoadRibbon` keeps a single non-indexed buffer of
strips (asphalt, shoulders, verge, lane dashes, edge lines) and rewrites every
vertex each frame from a two-sine centreline function, `curveX(z)`. Curvature,
lane markings and biome recolouring all fall out of that, with no segment
recycling and no popping at the horizon. Fog swallows the far end.

**The player is on the centreline, not at world X zero.** `Player.x` is a lane
offset; world position is `curveX(playerZ) + x`. Anything placed in world space
must add the centreline back in — `Player.worldX` exists so that is one call,
not an easy mistake.

Entities that stay a fixed distance apart on screen (the car's lateral
position, the camera) get explicit naming: `px` is the lane offset, `pWorldX` is
where the car actually is.

## Design system

`src/styles.css` is split in two: a **token block** that holds the whole visual
spec, and the **parts** that consume it. Nothing below the block may hard-code
a colour, a radius, a spacing step, a duration or a shadow.

The scales are the point, not the individual values:

| Scale | Steps |
| --- | --- |
| Type | `--fs-2xs` … `--fs-7xl`, 12 steps, monotonic at every breakpoint |
| Space | `--s-1` … `--s-8` on a 4 px step, plus fluid `--gap-*` |
| Radius | `--r-0` … `--r-5` and `--r-full` |
| Motion | `--dur-1` … `--dur-4` with three easings |
| Colour | surface/ink ramp, then one trio per accent hue |
| Layer | `--z-boost` < `--z-hurt` < `--z-overlay` |

Monotonicity is what lets a component ask for "the label step" or "the display
step" by name. Picking a size by feel is what produced the original HUD, where
two places had each invented their own small-caps label and ended up a pixel
apart.

Three conventions worth knowing before editing:

- **Accents come in trios.** A hue that gets a tinted treatment ships a base, a
  `-soft` wash and a `-stroke` border. "Orange button" and "orange banner" are
  the same tokens, so they cannot drift.
- **The HUD scrims sit at `z-index: -1`** and that only works because `.hud`
  does not open a stacking context. Give it a `z-index` or a `transform` and
  they have to move.
- **Durations are exempted by name.** `tools/design.mjs` allows literal
  durations only on the three looping pulses, which need to beat differently.

### Accessibility

The interface is a keyboard game first, so this is load-bearing rather than
polish:

- Arrow keys move the car selection **and** carry focus with it; the picker is a
  `radiogroup` with roving tabindex, so it is one tab stop.
- Dialogs move focus to their controls and keep Tab inside. Background content
  is inert until the dialog closes; resuming restores the previous focus.
- Banners and the police warning are polite live regions. The speed and score
  readouts deliberately are not — a per-frame live region is noise.
- Armour and nitro report their state in text, not only as pips and a bar.
- Nitro readouts round down in 0.25% steps, so they never promise an unavailable
  activation charge or a full bar.
- Every animation is decorative confirmation of something already seen
  visually, so `prefers-reduced-motion` collapses them all to 1 ms.

### Guards

Two suites sit outside the game:

- `tools/design.mjs` reads the stylesheet and the markup. It fails the tests on
  a colour, font-size, radius or duration literal below the token block, on a
  token that is defined but unused or used but undefined, on a HUD id missing
  from the markup, and on an accessibility hook that quietly went away.
- `tools/a11y.mjs` drives a browser and checks the same things behave: the
  arrows, the tab order, the mute state, the gauge labels, reduced motion.

Both are part of `npm test`. The design guard is a plain static read — no
browser — so it runs first and fails fast.

## Deploying

**GitHub Pages** — push to `main`; `.github/workflows/deploy.yml` builds and
publishes. Live at <https://zeromarker.github.io/RoadDash/>.

**Local Caddy** — `./deploy/deploy-local.sh` builds, publishes and reloads
Caddy. Live at <https://road.20070809.xyz/>.

```
deploy/
  caddy-site.roaddash   the site block (no auth, unlike the other subdomains)
  deploy-local.sh       build → publish → validate → reload
```

Releases are immutable directories under `/srv/roaddash/releases/<UTC stamp>`,
with `current` a symlink Caddy serves from. Publishing is an atomic symlink swap,
so the site never serves a half-written directory, and a rollback is a symlink
swap rather than a rebuild. The script validates the Caddyfile before reloading
and refuses to reload on failure, leaving the previous config live; it also
backs up `Caddyfile` before appending the import line.

## Testing

The renderer is not the thing under test, and headless WebGL only manages a few
frames per second, so the mechanics tests drive `Game.debugStep()` at a fixed
timestep instead of waiting on real frames. Actions are injected through the
same entry point the input layer uses.

```bash
npm test              # resources + design + smoke + mechanics + fx + a11y
npm run test:design   # design-system guard alone (no browser)
npm run test:a11y     # keyboard / live-region / reduced-motion checks
npm run test:soak     # 60 s of bot play, watching for pool/graph growth
npm run shots         # screenshot every biome into tools/shots/biomes
npm run shots:ui      # screenshot every overlay and HUD state into tools/shots/ui
```

`tools/mechanics.mjs` covers lane changes, jumping, ducking, ramp launches,
crash damage, run-over, near-miss thresholds, nitro and pause. Jump timing is
asserted on *predicted time to contact* rather than distance, because traffic
recedes at its own speed — a fixed lead distance either jumps too early or too
late depending on the obstacle.

`tools/fx.mjs` covers the pickup effects: that collecting a coin or power-up
fires a ring and sparks, that the ring pool stays a fixed size under a magnet
sweep that pops a whole line in one frame, and that the HUD coin counter
animates. Pool boundedness is the assertion that matters — a ring allocated per
collection is exactly the kind of thing that only shows up as a GC hitch once a
player is chaining a 40-coin line.

Both suites drive `Game.debugStep()` at a fixed timestep and inject actions
through the same entry point the input layer uses. The tools take `--url`, so
they can be pointed at a deployed build.

`tools/inspect.mjs` dumps a per-frame hazard/player overlap trace, which is the
fastest way to attribute a collision bug to spawning versus collision geometry.

`tools/ui.mjs` screenshots the interface rather than the world: menu, focus
rings, both gauge alarm states, results, pause, phone portrait, phone
landscape and reduced motion. Automatic game frames stop before capturing;
the tool checks that the alarm and nitro states survive the screenshot delay.
