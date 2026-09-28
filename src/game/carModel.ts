import * as THREE from 'three';
import { box, cyl, geo, mat, sphere } from './gfx';
import type { CarSpec } from './config';

export interface CarRig {
  root: THREE.Group;
  /** Sub-group that gets body roll / squat so the wheels stay planted. */
  body: THREE.Group;
  wheels: THREE.Mesh[];
  steer: THREE.Group[];
  flame: THREE.Mesh;
  brakeLights: THREE.Mesh[];
  headlights: THREE.Mesh[];
}

function makeWheel(radius: number, width: number): THREE.Group {
  const g = new THREE.Group();
  const tire = new THREE.Mesh(
    geo(`tire${radius}_${width}`, () =>
      new THREE.CylinderGeometry(radius, radius, width, 14).rotateZ(Math.PI / 2),
    ),
    mat(0x14161a),
  );
  g.add(tire);
  const hub = new THREE.Mesh(
    geo(`hub${radius}_${width}`, () =>
      new THREE.CylinderGeometry(radius * 0.55, radius * 0.55, width + 0.04, 10).rotateZ(
        Math.PI / 2,
      ),
    ),
    mat(0xb9c0c8),
  );
  g.add(hub);
  const spoke = new THREE.Mesh(
    geo(`spoke${radius}`, () => new THREE.BoxGeometry(width + 0.06, radius * 1.1, 0.08)),
    mat(0x8e959d),
  );
  g.add(spoke);
  return g;
}

/** The player's car. Forward is -Z. */
export function buildPlayerCar(spec: CarSpec): CarRig {
  const root = new THREE.Group();
  const body = new THREE.Group();
  root.add(body);

  const w = 1.94 * spec.wide;
  const accent = spec.accent;

  const chassis = box(w, 0.52, 4.3, spec.body, {}, 'chassis');
  chassis.position.y = 0.66;
  body.add(chassis);

  const skirt = box(w + 0.06, 0.24, 3.7, 0x1a1d22, {}, 'skirt');
  skirt.position.y = 0.42;
  body.add(skirt);

  const nose = box(w * 0.92, 0.3, 0.7, spec.body, {}, 'nose');
  nose.position.set(0, 0.5, -2.15);
  body.add(nose);

  const splitter = box(w + 0.1, 0.1, 0.6, 0x1a1d22, {}, 'splitter');
  splitter.position.set(0, 0.36, -2.2);
  body.add(splitter);

  const cabin = box(w * 0.84, 0.56, 2.15, spec.body, {}, 'cabin');
  cabin.position.set(0, 1.16, 0.12);
  body.add(cabin);

  const glass = box(w * 0.86, 0.34, 1.85, 0x18202c, { emissive: 0x0d1a2a, emissiveIntensity: 0.6 }, 'glass');
  glass.position.set(0, 1.2, 0.05);
  body.add(glass);

  const stripe = box(w * 0.9, 0.1, 3.9, accent, {}, 'stripe');
  stripe.position.set(0, 0.93, -0.1);
  body.add(stripe);

  const stripe2 = box(w * 0.3, 0.06, 1.7, accent, {}, 'stripe2');
  stripe2.position.set(0, 1.45, 0.15);
  body.add(stripe2);

  const wingPost = box(0.12, 0.34, 0.12, 0x22262c, {}, 'wingPost');
  wingPost.position.set(-w * 0.34, 1.4, 1.95);
  body.add(wingPost);
  const wingPost2 = wingPost.clone();
  wingPost2.position.x = w * 0.34;
  body.add(wingPost2);
  const wing = box(w * 0.94, 0.09, 0.5, accent, {}, 'wing');
  wing.position.set(0, 1.6, 1.95);
  body.add(wing);

  const headlights: THREE.Mesh[] = [];
  for (const s of [-1, 1]) {
    const hl = box(0.44, 0.16, 0.12, 0xfff6d8, { emissive: 0xffeab0, emissiveIntensity: 1.6 }, 'hl');
    hl.position.set(s * w * 0.3, 0.74, -2.16);
    body.add(hl);
    headlights.push(hl);
  }

  const brakeLights: THREE.Mesh[] = [];
  for (const s of [-1, 1]) {
    const tl = box(0.5, 0.14, 0.12, 0x7a1414, { emissive: 0xff2a1a, emissiveIntensity: 1.1 }, 'tl');
    tl.position.set(s * w * 0.28, 0.8, 2.18);
    body.add(tl);
    brakeLights.push(tl);
  }

  const flame = new THREE.Mesh(
    geo('flame', () => new THREE.ConeGeometry(0.22, 1.5, 8).rotateX(-Math.PI / 2)),
    mat(0x7fd4ff, { emissive: 0x59b8ff, emissiveIntensity: 2.2, transparent: true, opacity: 0.9 }),
  );
  flame.position.set(0, 0.45, 2.9);
  flame.visible = false;
  root.add(flame);

  for (const s of [-1, 1]) {
    const pipe = cyl(0.12, 0.14, 0.5, 0x30363d, 6, 'pipe');
    pipe.rotation.x = Math.PI / 2;
    pipe.position.set(s * 0.3, 0.45, 2.2);
    body.add(pipe);
  }

  const wheels: THREE.Mesh[] = [];
  const steer: THREE.Group[] = [];
  const wheelPositions: [number, number, boolean][] = [
    [-w * 0.48, -1.38, true],
    [w * 0.48, -1.38, true],
    [-w * 0.48, 1.4, false],
    [w * 0.48, 1.4, false],
  ];
  for (const [x, z, isFront] of wheelPositions) {
    const holder = new THREE.Group();
    holder.position.set(x, 0.44, z);
    const wheel = makeWheel(0.46, 0.36);
    holder.add(wheel);
    root.add(holder);
    if (isFront) steer.push(holder);
    wheels.push(wheel.children[0] as THREE.Mesh);
  }

  return { root, body, wheels, steer, flame, brakeLights, headlights };
}

export type VehicleKind = 'sedan' | 'taxi' | 'van' | 'truck' | 'bus' | 'police';

export interface VehicleDef {
  halfWidth: number;
  halfLength: number;
  height: number;
  build: (color: number) => THREE.Group;
}

function wheelsFor(root: THREE.Object3D, positions: [number, number, number][]): void {
  for (const [x, y, z] of positions) {
    const w = makeWheel(0.42, 0.32);
    w.position.set(x, y, z);
    root.add(w);
  }
}

const sedanBuild = (color: number): THREE.Group => {
  const g = new THREE.Group();
  const body = box(1.86, 0.66, 4.3, color, {}, 'vbody');
  body.position.y = 0.7;
  g.add(body);
  const cabin = box(1.7, 0.62, 2.1, color, {}, 'vcabin');
  cabin.position.set(0, 1.28, 0.15);
  g.add(cabin);
  const glass = box(1.74, 0.34, 1.9, 0x1a2430, { emissive: 0x0b1420, emissiveIntensity: 0.5 }, 'vglass');
  glass.position.set(0, 1.3, 0.1);
  g.add(glass);
  const bumper = box(1.92, 0.26, 4.0, 0x20242a, {}, 'vbumper');
  bumper.position.y = 0.48;
  g.add(bumper);
  for (const s of [-1, 1]) {
    const tl = box(0.42, 0.14, 0.1, 0x6a1010, { emissive: 0xff2a1a, emissiveIntensity: 0.8 }, 'vtl');
    tl.position.set(s * 0.6, 0.85, 2.16);
    g.add(tl);
  }
  wheelsFor(g, [
    [-0.92, 0.42, -1.35],
    [0.92, 0.42, -1.35],
    [-0.92, 0.42, 1.4],
    [0.92, 0.42, 1.4],
  ]);
  return g;
};

export const VEHICLES: Record<VehicleKind, VehicleDef> = {
  sedan: { halfWidth: 0.95, halfLength: 2.2, height: 1.6, build: sedanBuild },
  taxi: {
    halfWidth: 0.95,
    halfLength: 2.2,
    height: 1.75,
    build: (color) => {
      const g = sedanBuild(color);
      const sign = box(0.9, 0.24, 0.3, 0x1a1a1a, { emissive: 0xffd23a, emissiveIntensity: 1.2 }, 'taxiSign');
      sign.position.set(0, 1.66, 0.1);
      g.add(sign);
      return g;
    },
  },
  police: {
    halfWidth: 0.97,
    halfLength: 2.2,
    height: 1.75,
    build: (color) => {
      const g = sedanBuild(color);
      const bar = box(1.3, 0.16, 0.3, 0x101418, { emissive: 0xffffff, emissiveIntensity: 1.4 }, 'pbar');
      bar.position.set(0, 1.62, 0.2);
      g.add(bar);
      const red = box(0.5, 0.14, 0.3, 0xff2b2b, { emissive: 0xff2020, emissiveIntensity: 1.8 }, 'pred');
      red.position.set(-0.35, 1.7, 0.2);
      g.add(red);
      const blue = box(0.5, 0.14, 0.3, 0x2b6bff, { emissive: 0x2050ff, emissiveIntensity: 1.8 }, 'pblue');
      blue.position.set(0.35, 1.7, 0.2);
      g.add(blue);
      return g;
    },
  },
  van: {
    halfWidth: 1.05,
    halfLength: 2.6,
    height: 2.4,
    build: (color) => {
      const g = new THREE.Group();
      const body = box(2.1, 1.7, 5.0, color, {}, 'vanBody');
      body.position.y = 1.2;
      g.add(body);
      const cab = box(2.0, 0.8, 1.1, color, {}, 'vanCab');
      cab.position.set(0, 0.9, -2.3);
      g.add(cab);
      const glass = box(2.04, 0.5, 0.14, 0x1a2430, { emissive: 0x0b1420, emissiveIntensity: 0.5 }, 'vanGlass');
      glass.position.set(0, 1.15, -2.5);
      g.add(glass);
      wheelsFor(g, [
        [-1.0, 0.42, -1.6],
        [1.0, 0.42, -1.6],
        [-1.0, 0.42, 1.6],
        [1.0, 0.42, 1.6],
      ]);
      return g;
    },
  },
  bus: {
    halfWidth: 1.28,
    halfLength: 5.6,
    height: 3.1,
    build: (color) => {
      const g = new THREE.Group();
      const body = box(2.55, 2.3, 11.0, color, {}, 'busBody');
      body.position.y = 1.6;
      g.add(body);
      const stripe = box(2.6, 0.28, 10.6, 0xf0f0f0, {}, 'busStripe');
      stripe.position.y = 1.2;
      g.add(stripe);
      const glass = box(2.58, 0.8, 10.0, 0x1a2430, { emissive: 0x0b1420, emissiveIntensity: 0.4 }, 'busGlass');
      glass.position.y = 2.2;
      g.add(glass);
      wheelsFor(g, [
        [-1.2, 0.5, -3.8],
        [1.2, 0.5, -3.8],
        [-1.2, 0.5, 3.4],
        [1.2, 0.5, 3.4],
      ]);
      return g;
    },
  },
  truck: {
    halfWidth: 1.32,
    halfLength: 6.6,
    height: 3.4,
    build: (color) => {
      const g = new THREE.Group();
      const cab = box(2.5, 1.9, 2.6, color, {}, 'truckCab');
      cab.position.set(0, 1.5, -4.4);
      g.add(cab);
      const glass = box(2.54, 0.7, 0.16, 0x1a2430, { emissive: 0x0b1420, emissiveIntensity: 0.5 }, 'truckGlass');
      glass.position.set(0, 1.85, -5.7);
      g.add(glass);
      const trailer = box(2.6, 2.7, 8.4, 0xd8dde3, {}, 'trailer');
      trailer.position.set(0, 2.0, 1.4);
      g.add(trailer);
      const band = box(2.66, 0.5, 8.2, 0x2f6fd0, {}, 'trailerBand');
      band.position.set(0, 1.2, 1.4);
      g.add(band);
      wheelsFor(g, [
        [-1.2, 0.5, -4.6],
        [1.2, 0.5, -4.6],
        [-1.2, 0.5, 2.2],
        [1.2, 0.5, 2.2],
        [-1.2, 0.5, 3.6],
        [1.2, 0.5, 3.6],
      ]);
      return g;
    },
  },
};

export function buildVehicle(kind: VehicleKind, color: number): THREE.Group {
  return VEHICLES[kind].build(color);
}

export type ObstacleKind = 'barrier' | 'sign' | 'cones' | 'ramp' | 'blockade';

export type ObstacleMode = 'solid' | 'launch';

/**
 * Vertical collision model. `top` is the height of a solid mass (jump it when
 * `top` is low enough); `overhead` is the underside of a hanging mass — duck to
 * get under it. Both are measured up from the road surface.
 */
export interface ObstacleDef {
  halfWidth: number;
  halfLength: number;
  top: number;
  overhead: number;
  mode: ObstacleMode;
  launch: number;
  build: () => THREE.Group;
}

const STRIPE = 0xf0c04a;

export const OBSTACLES: Record<ObstacleKind, ObstacleDef> = {
  barrier: {
    halfWidth: 1.7,
    halfLength: 0.45,
    top: 1.15,
    overhead: 0,
    mode: 'solid',
    launch: 0,
    build: () => {
      const g = new THREE.Group();
      for (const s of [-1, 1]) {
        const post = box(0.18, 1.15, 0.18, 0x3a3f47);
        post.position.set(s * 1.5, 0.57, 0);
        g.add(post);
      }
      for (let i = 0; i < 3; i++) {
        const bar = box(3.3, 0.28, 0.16, 0xf5f0e2);
        bar.position.set(0, 0.26 + i * 0.36, 0);
        g.add(bar);
      }
      const warn = box(3.3, 0.2, 0.2, STRIPE, {
        emissive: 0xff3b1a,
        emissiveIntensity: 0.8,
      });
      warn.position.set(0, 1.05, 0);
      g.add(warn);
      return g;
    },
  },
  cones: {
    halfWidth: 1.5,
    halfLength: 1.4,
    top: 0.9,
    overhead: 0,
    mode: 'solid',
    launch: 0,
    build: () => {
      const g = new THREE.Group();
      for (let i = -1; i <= 1; i++) {
        const cone = new THREE.Mesh(
          geo('cone', () => new THREE.ConeGeometry(0.32, 0.9, 8)),
          mat(0xff7a2a),
        );
        cone.position.set(i * 1.1, 0.45, i * 0.5);
        g.add(cone);
        const base = box(0.7, 0.08, 0.7, 0x2b2f36);
        base.position.set(i * 1.1, 0.04, i * 0.5);
        g.add(base);
      }
      return g;
    },
  },
  sign: {
    halfWidth: 1.75,
    halfLength: 0.35,
    top: 0,
    overhead: 1.25,
    mode: 'solid',
    launch: 0,
    build: () => {
      const g = new THREE.Group();
      for (const s of [-1, 1]) {
        const post = box(0.18, 2.9, 0.18, 0x4c525b);
        post.position.set(s * 1.62, 1.45, 0);
        g.add(post);
      }
      const board = box(3.9, 1.4, 0.24, 0x1f6fd0, { emissive: 0x0d3a6b, emissiveIntensity: 0.5 });
      board.position.y = 1.95;
      g.add(board);
      const text = box(2.6, 0.42, 0.3, 0xf2f6ff, {}, 'signText');
      text.position.set(0, 2.05, 0.02);
      g.add(text);
      const arrow = sphere(0.2, 0xf2f6ff, {}, 8);
      arrow.position.set(1.3, 1.95, 0.05);
      g.add(arrow);
      return g;
    },
  },
  blockade: {
    halfWidth: 1.75,
    halfLength: 0.6,
    top: 3.2,
    overhead: 0,
    mode: 'solid',
    launch: 0,
    build: () => {
      const g = new THREE.Group();
      const truck = box(3.5, 2.2, 1.1, 0xd0d5db, {}, 'blockade');
      truck.position.y = 1.2;
      g.add(truck);
      for (let i = 0; i < 4; i++) {
        const light = box(0.4, 0.24, 0.2, 0xffb020, { emissive: 0xff8a00, emissiveIntensity: 1.4 });
        light.position.set(-1.2 + i * 0.8, 2.45, 0);
        g.add(light);
      }
      const bar = box(3.5, 0.4, 0.2, STRIPE, {
        emissive: 0x3a2a06,
        emissiveIntensity: 0.4,
      });
      bar.position.set(0, 0.5, 0);
      g.add(bar);
      return g;
    },
  },
  ramp: {
    halfWidth: 1.6,
    halfLength: 2.2,
    top: 0,
    overhead: 0,
    mode: 'launch',
    launch: 1,
    build: () => {
      const g = new THREE.Group();
      const wedge = box(3.2, 0.24, 4.4, 0x2f3540);
      wedge.position.set(0, 0.6, 0);
      wedge.rotation.x = -0.27;
      g.add(wedge);
      for (const s of [-1, 1]) {
        const rail = box(0.16, 0.5, 4.4, 0xf0c04a, { emissive: 0x4a3a08, emissiveIntensity: 0.4 });
        rail.position.set(s * 1.6, 0.7, 0);
        rail.rotation.x = -0.27;
        g.add(rail);
      }
      const lip = box(3.2, 0.3, 0.3, 0xf0f4ff, { emissive: 0x6a86b8, emissiveIntensity: 0.6 });
      lip.position.set(0, 1.1, -2.1);
      g.add(lip);
      return g;
    },
  },
};
