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

## Testing

The renderer is not the thing under test, and headless WebGL only manages a few
frames per second, so the mechanics tests drive `Game.debugStep()` at a fixed
timestep instead of waiting on real frames. Actions are injected through the
same entry point the input layer uses.

```bash
npm test              # smoke + mechanics
npm run test:soak     # 60 s of bot play, watching for pool/graph growth
npm run shots         # screenshot every biome into tools/shots/biomes
```

`tools/mechanics.mjs` covers lane changes, jumping, ducking, ramp launches,
crash damage, run-over, near-miss thresholds, nitro and pause. Jump timing is
asserted on *predicted time to contact* rather than distance, because traffic
recedes at its own speed — a fixed lead distance either jumps too early or too
late depending on the obstacle.

`tools/inspect.mjs` dumps a per-frame hazard/player overlap trace, which is the
fastest way to attribute a collision bug to spawning versus collision geometry.
