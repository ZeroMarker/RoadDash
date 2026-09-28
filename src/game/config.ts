/**
 * Central tuning values, track geometry, biome palettes and car stats.
 * Everything gameplay-facing lives here so the feel can be tuned in one place.
 */

export const LANE_COUNT = 3;
export const LANE_W = 3.6;
/** World-space X of a lane index (0 = left, 2 = right). */
export const laneX = (lane: number): number => (lane - 1) * LANE_W;

export const ROAD_HALF = (LANE_COUNT * LANE_W) / 2 + 1.1; // + shoulders
/**
 * Half-width of the ground plane. Must comfortably exceed the furthest biome
 * fog distance, or the ground's outer edge becomes a hard horizon line.
 */
export const GROUND_HALF = 700;

/** Distance the road mesh is rebuilt over, in metres. Fog swallows the far end. */
export const VIEW_DIST = 1000;
/** Ribbon rows: one strip row every 12.5 m, fine enough for dash markings. */
export const ROW_LEN = 12.5;
export const ROAD_ROWS = Math.round(VIEW_DIST / ROW_LEN) + 1;

/**
 * Track centreline. A couple of out-of-phase sine waves give gentle, endless
 * sweepers without ever folding back on themselves or needing segment recycling.
 */
export function curveX(z: number): number {
  return Math.sin(z * 0.00115) * 30 + Math.sin(z * 0.00047 + 1.7) * 46;
}

/** d(curveX)/dz — used for road heading, banking and camera lean. */
export function curveSlope(z: number): number {
  return Math.cos(z * 0.00115) * 0.0345 + Math.cos(z * 0.00047 + 1.7) * 0.0216;
}

/**
 * Jump tuning. Hang time matters more than apex height here: the player has to
 * be above a sedan's roof for the whole overlap window (~2 x (2.2 + 2.15) m of
 * travel), which at 50 m/s is a fraction of a second. A floaty jump with a
 * long window above ~1.5 m is what makes "jump the car" a real option rather
 * than a coin flip.
 *
 *   apex  = JUMP_V^2 / (2 * GRAVITY)      ≈ 2.7 m
 *   air   = 2 * JUMP_V / GRAVITY          ≈ 1.12 s
 *   above 1.5 m for ≈ 0.76 s
 */
export const GRAVITY = 17.5;
export const JUMP_V = 9.8;
export const RAMP_LAUNCH_V = 12.5;

export const START_SPEED = 26;
export const MAX_SPEED = 86;
export const NITRO_SPEED_BONUS = 30;
export const NITRO_DRAIN = 42; // % per second
export const NITRO_MAX = 100;

export const SLIDE_TIME = 0.62;
export const LANE_SWITCH_TIME = 0.17;

export const COIN_VALUE = 10;
export const NEAR_MISS_RADIUS = 3.1;

/** Metres of road covered before the biome changes. */
export const BIOME_LENGTH = 760;

export type PropKind =
  | 'building'
  | 'lamp'
  | 'tree'
  | 'palm'
  | 'cactus'
  | 'rock'
  | 'container'
  | 'pylon'
  | 'barrierWall'
  | 'arch'
  | 'streetLight'
  | 'snowRock'
  | 'ridge'
  | 'sign';

export interface Biome {
  id: string;
  name: string;
  subtitle: string;
  sky: number;
  fog: number;
  fogNear: number;
  fogFar: number;
  ground: number;
  road: number;
  line: number;
  edge: number;
  ambient: number;
  ambientIntensity: number;
  sun: number;
  sunIntensity: number;
  sunHeight: number;
  tunnel: boolean;
  props: { kind: PropKind; weight: number; spacing: number }[];
}

export const BIOMES: Biome[] = [
  {
    id: 'city',
    name: 'DOWNTOWN',
    subtitle: 'Evening rush',
    sky: 0x2b3a63,
    fog: 0x3a4776,
    fogNear: 70,
    fogFar: 520,
    ground: 0x1d2130,
    road: 0x4a4e5a,
    line: 0xf2f0e6,
    edge: 0xf7d26a,
    ambient: 0x93a6d8,
    ambientIntensity: 0.85,
    sun: 0xffb37a,
    sunIntensity: 1.5,
    sunHeight: 0.55,
    tunnel: false,
    props: [
      { kind: 'building', weight: 5, spacing: 16 },
      { kind: 'streetLight', weight: 3, spacing: 30 },
      { kind: 'lamp', weight: 1, spacing: 40 },
      { kind: 'ridge', weight: 1, spacing: 90 },
    ],
  },
  {
    id: 'highway',
    name: 'HIGHWAY 9',
    subtitle: 'Flat out',
    sky: 0x74b6e8,
    fog: 0xa9cfe9,
    fogNear: 120,
    fogFar: 620,
    ground: 0x4e7a3a,
    road: 0x3a3d45,
    line: 0xf4f2ea,
    edge: 0xf7d26a,
    ambient: 0xcfe4ff,
    ambientIntensity: 1.0,
    sun: 0xfff2d0,
    sunIntensity: 1.9,
    sunHeight: 0.85,
    tunnel: false,
    props: [
      { kind: 'pylon', weight: 4, spacing: 46 },
      { kind: 'tree', weight: 4, spacing: 22 },
      { kind: 'streetLight', weight: 1, spacing: 60 },
      { kind: 'ridge', weight: 2, spacing: 110 },
    ],
  },
  {
    id: 'tunnel',
    name: 'EAST TUNNEL',
    subtitle: 'Mind the lights',
    sky: 0x0c0f16,
    fog: 0x0d1119,
    fogNear: 20,
    fogFar: 330,
    ground: 0x23262e,
    road: 0x2c2f37,
    line: 0xf4f2ea,
    edge: 0x7fd8ff,
    ambient: 0x6f86b8,
    ambientIntensity: 0.5,
    sun: 0x8fb6ff,
    sunIntensity: 0.5,
    sunHeight: 0.4,
    tunnel: true,
    props: [
      { kind: 'arch', weight: 10, spacing: 9 },
      { kind: 'barrierWall', weight: 2, spacing: 26 },
    ],
  },
  {
    id: 'port',
    name: 'DOCK SEVEN',
    subtitle: 'Cargo run',
    sky: 0x8fc0d8,
    fog: 0xb6cfd8,
    fogNear: 100,
    fogFar: 560,
    ground: 0x6a6a63,
    road: 0x40424a,
    line: 0xf4f2ea,
    edge: 0xf7d26a,
    ambient: 0xd6ecf5,
    ambientIntensity: 1.05,
    sun: 0xfff0d2,
    sunIntensity: 1.7,
    sunHeight: 0.75,
    tunnel: false,
    props: [
      { kind: 'container', weight: 6, spacing: 13 },
      { kind: 'streetLight', weight: 2, spacing: 34 },
      { kind: 'pylon', weight: 1, spacing: 70 },
      { kind: 'ridge', weight: 1, spacing: 120 },
    ],
  },
  {
    id: 'desert',
    name: 'RED MESA',
    subtitle: 'Dust and heat',
    sky: 0xe0a76a,
    fog: 0xd9a877,
    fogNear: 90,
    fogFar: 520,
    ground: 0xb4794a,
    road: 0x4a443f,
    line: 0xf6e9c8,
    edge: 0xf0e0a8,
    ambient: 0xffd9a8,
    ambientIntensity: 1.1,
    sun: 0xffd08a,
    sunIntensity: 2.0,
    sunHeight: 0.95,
    tunnel: false,
    props: [
      { kind: 'cactus', weight: 5, spacing: 17 },
      { kind: 'rock', weight: 5, spacing: 21 },
      { kind: 'sign', weight: 1, spacing: 70 },
      { kind: 'ridge', weight: 3, spacing: 80 },
    ],
  },
  {
    id: 'snow',
    name: 'FROST PASS',
    subtitle: 'Black ice',
    sky: 0xcfe0f2,
    fog: 0xdfeaf6,
    fogNear: 80,
    fogFar: 480,
    ground: 0xe4eef7,
    road: 0x50555e,
    line: 0xffffff,
    edge: 0xe8f4ff,
    ambient: 0xdbe9ff,
    ambientIntensity: 1.15,
    sun: 0xf2f7ff,
    sunIntensity: 1.8,
    sunHeight: 0.8,
    tunnel: false,
    props: [
      { kind: 'snowRock', weight: 5, spacing: 15 },
      { kind: 'tree', weight: 4, spacing: 19 },
      { kind: 'streetLight', weight: 1, spacing: 50 },
      { kind: 'ridge', weight: 3, spacing: 95 },
    ],
  },
];

export interface CarSpec {
  id: string;
  name: string;
  blurb: string;
  body: number;
  accent: number;
  /** Top speed multiplier. */
  topSpeed: number;
  /** Acceleration multiplier. */
  accel: number;
  /** Lane-change agility multiplier (higher = snappier). */
  handling: number;
  /** Bonus hit points. */
  armor: number;
  /** Nitro gained per near-miss / drift second. */
  nitroGain: number;
  wide: number;
}

export const CARS: CarSpec[] = [
  {
    id: 'comet',
    name: 'COMET GT',
    blurb: 'Balanced all-rounder',
    body: 0xe23b3b,
    accent: 0xf5f5f5,
    topSpeed: 1.0,
    accel: 1.0,
    handling: 1.0,
    armor: 1,
    nitroGain: 1.0,
    wide: 1.0,
  },
  {
    id: 'vector',
    name: 'VECTOR R',
    blurb: 'Top end monster, glass hands',
    body: 0x2f7fe0,
    accent: 0x9fe8ff,
    topSpeed: 1.12,
    accel: 1.18,
    handling: 0.86,
    armor: 0,
    nitroGain: 0.95,
    wide: 0.94,
  },
  {
    id: 'bulldog',
    name: 'BULLDOG 6',
    blurb: 'Slow, brutal, extra armour',
    body: 0x3fbf6a,
    accent: 0xffe08a,
    topSpeed: 0.93,
    accel: 0.92,
    handling: 1.12,
    armor: 2,
    nitroGain: 1.25,
    wide: 1.12,
  },
];

export const STORAGE_KEY = 'roaddash.best';
