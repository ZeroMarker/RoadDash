import * as THREE from 'three';
import { ROAD_HALF, VIEW_DIST, curveX, type Biome, type PropKind } from './config';
import { box, cyl, geo, mat } from './gfx';

interface PropDef {
  /** 0 = must straddle the road (tunnel arches), 1 = roadside, 2 = far scenery. */
  placement: 'center' | 'side' | 'far';
  variants: number;
  scale: [number, number];
  spin?: boolean;
}

const DEFS: Record<PropKind, PropDef> = {
  building: { placement: 'far', variants: 4, scale: [0.75, 1.6] },
  streetLight: { placement: 'side', variants: 1, scale: [0.9, 1.1] },
  lamp: { placement: 'side', variants: 1, scale: [0.9, 1.15] },
  tree: { placement: 'side', variants: 3, scale: [0.8, 1.5] },
  palm: { placement: 'side', variants: 2, scale: [0.85, 1.3] },
  cactus: { placement: 'side', variants: 2, scale: [0.8, 1.5] },
  rock: { placement: 'side', variants: 3, scale: [0.7, 2.0] },
  container: { placement: 'far', variants: 5, scale: [0.9, 1.2] },
  pylon: { placement: 'far', variants: 1, scale: [0.9, 1.2] },
  barrierWall: { placement: 'side', variants: 1, scale: [0.95, 1.05] },
  arch: { placement: 'center', variants: 1, scale: [1, 1] },
  snowRock: { placement: 'side', variants: 3, scale: [0.7, 1.8] },
  ridge: { placement: 'far', variants: 3, scale: [0.8, 1.5] },
  sign: { placement: 'side', variants: 1, scale: [0.9, 1.1] },
};

const MAX_PROPS = 220;

interface ActiveProp {
  obj: THREE.Object3D;
  z: number;
  offset: number;
  spin: number;
}

/**
 * Roadside dressing. Props are pooled per kind/variant and placed at absolute
 * world Z, so they only need to be spawned ahead of the player and culled
 * behind — no per-frame matrix churn.
 */
export class PropField {
  private group = new THREE.Group();
  private pools = new Map<string, THREE.Object3D[]>();
  private active: ActiveProp[] = [];
  private nextZ = 0;
  private biome: Biome | null = null;
  private random: () => number;

  constructor(
    private scene: THREE.Scene,
    rng: () => number = Math.random,
  ) {
    this.random = rng;
    scene.add(this.group);
  }

  /**
   * Swap biome. Props that are still beside or behind the player are left
   * alone so nothing pops in the player's face; only the dressing ahead of the
   * car is recycled into the new biome's set.
   */
  setBiome(biome: Biome, playerZ: number): void {
    this.biome = biome;
    for (let i = this.active.length - 1; i >= 0; i--) {
      const p = this.active[i] as ActiveProp;
      // Keep whatever is beside or behind the car, recycle only what is ahead.
      if (p.z < playerZ - 20) {
        this.recycle(p);
        this.active.splice(i, 1);
      }
    }
    this.nextZ = playerZ - 20;
  }

  update(playerZ: number): void {
    const biome = this.biome;
    if (!biome) return;

    // Start the cursor just behind the camera the first time a biome begins.
    if (this.nextZ === 0) this.nextZ = playerZ + 120;

    const limit = playerZ - VIEW_DIST * 0.92;
    let guard = 0;
    while (this.nextZ > limit && guard++ < 80) {
      this.spawn(this.nextZ, biome);
      const entry = pickWeighted(biome.props, this.random);
      this.nextZ -= entry.spacing * (0.7 + this.random() * 0.7);
    }

    // Props keep absolute world Z, so their lateral position only needs
    // recomputing when the centreline function is re-evaluated.
    for (let i = this.active.length - 1; i >= 0; i--) {
      const p = this.active[i];
      if (p.z > playerZ + 140) {
        this.recycle(p);
        this.active.splice(i, 1);
        continue;
      }
      p.obj.position.set(curveX(p.z) + p.offset, 0, p.z);
      if (p.spin !== 0) p.obj.rotation.y += p.spin;
    }
  }

  private spawn(z: number, biome: Biome): void {
    const entry = pickWeighted(biome.props, this.random);
    const def = DEFS[entry.kind];
    const key = `${entry.kind}:${(this.random() * def.variants) | 0}`;
    let pool = this.pools.get(key);
    if (!pool) {
      pool = [];
      this.pools.set(key, pool);
    }
    const obj = pool.pop() ?? makeProp(entry.kind, Number(key.split(':')[1]) || 0);
    if (this.active.length >= MAX_PROPS) return;

    const side = this.random() < 0.5 ? -1 : 1;
    let offset: number;
    if (def.placement === 'center') {
      offset = 0;
    } else if (def.placement === 'side') {
      offset = side * (ROAD_HALF + 2.4 + this.random() * 12);
    } else if (entry.kind === 'ridge') {
      // Distant scenery sits far out and low, so it reads as a skyline.
      offset = side * (190 + this.random() * 260);
    } else {
      offset = side * (ROAD_HALF + 22 + this.random() * 90);
    }

    const s = lerp(def.scale[0], def.scale[1], this.random());
    obj.scale.setScalar(s);
    obj.rotation.y = entry.kind === 'arch' ? 0 : (this.random() - 0.5) * 0.9;
    obj.position.set(curveX(z) + offset, 0, z);
    obj.visible = true;
    this.group.add(obj);
    this.active.push({ obj, z, offset, spin: def.spin ? (this.random() - 0.5) * 0.4 : 0 });
    void biome;
  }

  private recycle(p: ActiveProp): void {
    this.group.remove(p.obj);
    const kind = p.obj.userData.kind as string;
    const variant = String(p.obj.userData.variant);
    const key = `${kind}:${variant}`;
    const pool = this.pools.get(key);
    if (pool) pool.push(p.obj);
  }

  reset(): void {
    for (const p of this.active) this.recycle(p);
    this.active.length = 0;
    this.nextZ = 0;
  }

  /** Dev helper: clear the field and stop spawning. */
  freeze(): void {
    this.reset();
    this.nextZ = Number.POSITIVE_INFINITY;
  }

  dispose(): void {
    this.reset();
    for (const pool of this.pools.values()) {
      disposeDeep(pool[0]);
    }
    this.pools.clear();
    this.scene.remove(this.group);
  }
}

function lerp(a: number, b: number, t: number): number {
  return a + (b - a) * t;
}

interface Weighted {
  kind: PropKind;
  weight: number;
  spacing: number;
}

function pickWeighted(list: Weighted[], r: () => number): Weighted {
  let total = 0;
  for (const w of list) total += w.weight;
  let roll = r() * total;
  for (const w of list) {
    roll -= w.weight;
    if (roll <= 0) return w;
  }
  return list[list.length - 1];
}

function makeProp(kind: PropKind, variant: number): THREE.Object3D {
  const group = new THREE.Group();
  group.userData.kind = kind;
  group.userData.variant = variant;

  switch (kind) {
    case 'building': {
      const h = [22, 34, 16, 28][variant % 4];
      const w = 9 + (variant % 3) * 4;
      const body = new THREE.Color().setHSL(0.6 + variant * 0.03, 0.16, 0.1 + variant * 0.03);
      group.add(box(w, h, w, body.getHex(), {}, `bldg${w}${h}`));
      const band = new THREE.Color().setHSL(0.11, 0.85, 0.6);
      const lit = box(w + 0.3, h * 0.42, w + 0.3, 0x11151f);
      lit.position.y = h * 0.16;
      group.add(lit);
      for (let i = 0; i < 4; i++) {
        const win = box(w + 0.4, 0.7, w + 0.4, band.getHex(), {
          emissive: band,
          emissiveIntensity: 0.7,
        });
        win.position.y = -h * 0.2 + i * (h * 0.13);
        group.add(win);
      }
      group.add(box(w + 0.2, 0.6, w + 0.2, 0x1a1f2b, {}, `cap${w}${h}`).translateY(h / 2 + 0.3));
      break;
    }
    case 'streetLight': {
      const pole = cyl(0.11, 0.16, 8, 0x3a4048, 6);
      pole.position.y = 4;
      group.add(pole);
      const arm = box(2.4, 0.18, 0.18, 0x3a4048);
      arm.position.set(1.1, 7.8, 0);
      group.add(arm);
      const head = box(0.9, 0.24, 0.42, 0xfff2c4, {
        emissive: 0xfff0bb,
        emissiveIntensity: 1.2,
      });
      head.position.set(2.1, 7.6, 0);
      group.add(head);
      break;
    }
    case 'lamp': {
      const post = cyl(0.16, 0.2, 2.6, 0x565b63, 6);
      post.position.y = 1.3;
      group.add(post);
      const glow = new THREE.Mesh(
        geo('lampGlow', () => new THREE.SphereGeometry(0.34, 8, 6)),
        mat(0xffe9a8, { emissive: 0xffd98a, emissiveIntensity: 1.4 }),
      );
      glow.position.y = 2.8;
      group.add(glow);
      break;
    }
    case 'tree': {
      const trunk = cyl(0.22, 0.34, 3.2, 0x5a4030, 6);
      trunk.position.y = 1.6;
      group.add(trunk);
      const g1 = new THREE.Mesh(
        geo('cone1', () => new THREE.ConeGeometry(2.0, 3.4, 7)),
        mat(variant === 1 ? 0x2f6b3a : 0x2b5f34),
      );
      g1.position.y = 4.2;
      group.add(g1);
      const g2 = new THREE.Mesh(
        geo('cone2', () => new THREE.ConeGeometry(1.45, 2.6, 7)),
        mat(0x357a41),
      );
      g2.position.y = 6.1;
      group.add(g2);
      break;
    }
    case 'palm': {
      const trunk = cyl(0.18, 0.3, 7.5, 0x7a6046, 6);
      trunk.position.y = 3.75;
      trunk.rotation.z = 0.12;
      group.add(trunk);
      for (let i = 0; i < 5; i++) {
        const leaf = box(0.5, 0.12, 4.4, i % 2 ? 0x2f7a45 : 0x398f52);
        leaf.position.y = 7.3;
        leaf.rotation.set(0.3, (i / 5) * Math.PI * 2, 0);
        leaf.translateY(1.6);
        group.add(leaf);
      }
      break;
    }
    case 'cactus': {
      const body = cyl(0.42, 0.5, 4.2, 0x3f7a45, 8);
      body.position.y = 2.1;
      group.add(body);
      const armL = cyl(0.24, 0.26, 1.8, 0x37703d, 6);
      armL.rotation.z = Math.PI / 2;
      armL.position.set(-0.8, 2.8, 0);
      group.add(armL);
      const armR = cyl(0.2, 0.22, 1.3, 0x37703d, 6);
      armR.rotation.z = Math.PI / 2;
      armR.position.set(0.7, 1.6, variant * 0.2);
      group.add(armR);
      break;
    }
    case 'rock':
    case 'snowRock': {
      const color = kind === 'rock' ? 0x8a6a52 : 0xdfeaf6;
      const r = new THREE.Mesh(
        geo('ico', () => new THREE.IcosahedronGeometry(1, 0)),
        mat(color),
      );
      r.position.y = 0.7;
      r.scale.set(1.3 + variant * 0.3, 0.9 + variant * 0.2, 1.1);
      r.rotation.set(variant, variant * 1.7, variant * 0.4);
      group.add(r);
      if (variant > 1) {
        const r2 = new THREE.Mesh(geo('ico', () => new THREE.IcosahedronGeometry(1, 0)), mat(color));
        r2.position.set(1.4, 0.4, 0.6);
        r2.scale.set(0.7, 0.55, 0.6);
        group.add(r2);
      }
      break;
    }
    case 'container': {
      const colors = [0xd0563a, 0x3a7fd0, 0x3f9b5a, 0xd0a83a, 0x8a4fb0];
      const c = colors[variant % colors.length];
      const stack = 1 + ((variant % 3) === 0 ? 1 : 0);
      for (let i = 0; i < stack; i++) {
        const b = box(12, 2.6, 2.9, c, {}, 'container');
        b.position.set(0, 1.35 + i * 2.65, 0);
        b.rotation.y = i * 0.02;
        group.add(b);
      }
      break;
    }
    case 'pylon': {
      const h = 16;
      const legL = box(0.4, h, 0.4, 0x9aa2ad);
      legL.position.set(-1.4, h / 2, 0);
      group.add(legL);
      const legR = box(0.4, h, 0.4, 0x9aa2ad);
      legR.position.set(1.4, h / 2, 0);
      group.add(legR);
      for (let i = 0; i < 4; i++) {
        const cross = box(3.2, 0.25, 0.25, 0x8b939e);
        cross.position.y = 2 + i * 3.6;
        group.add(cross);
      }
      const armL = box(6.5, 0.3, 0.3, 0x8b939e);
      armL.position.set(-2.6, h - 1.5, 0);
      group.add(armL);
      const armR = box(6.5, 0.3, 0.3, 0x8b939e);
      armR.position.set(2.6, h - 1.5, 0);
      group.add(armR);
      break;
    }
    case 'barrierWall': {
      const wall = box(1.2, 4.2, 12, 0x6d7178);
      wall.position.y = 2.1;
      group.add(wall);
      for (let i = 0; i < 3; i++) {
        const stripe = box(1.35, 0.5, 12, 0xf0c04a, { emissive: 0x6b4c10, emissiveIntensity: 0.3 });
        stripe.position.y = 0.9 + i * 1.3;
        group.add(stripe);
      }
      break;
    }
    case 'arch': {
      // Tunnel ring: two pillars and a lintel, lit by a cool strip. The strip's
      // emissive is kept modest — ACES tone mapping clips anything much brighter
      // to a flat white slab across the top of the screen.
      for (const s of [-1, 1]) {
        const pillar = box(2.6, 7.5, 1.6, 0x3d444f);
        pillar.position.set(s * (ROAD_HALF + 1.1), 3.75, 0);
        group.add(pillar);
        const rail = box(0.22, 5.4, 0.22, 0xbcdcff, {
          emissive: 0x7fb4ff,
          emissiveIntensity: 0.85,
        });
        rail.position.set(s * (ROAD_HALF - 0.15), 3.4, 0.9);
        group.add(rail);
      }
      const lintel = box((ROAD_HALF + 2.4) * 2, 2.6, 1.8, 0x39404b);
      lintel.position.y = 8.2;
      group.add(lintel);
      const lightStrip = box(2.2, 0.16, 0.4, 0xdceeff, {
        emissive: 0xa8d8ff,
        emissiveIntensity: 0.9,
      });
      lightStrip.position.y = 6.85;
      group.add(lightStrip);
      break;
    }
    case 'ridge': {
      // A low, wide slab: reads as a hill or city block wall on the horizon.
      const h = [26, 44, 16][variant % 3];
      const w = 90 + variant * 40;
      const tone = new THREE.Color().setHSL(0.08 + variant * 0.02, 0.2, 0.11 + variant * 0.03);
      const slab = box(w, h, 26, tone.getHex(), {}, `ridge${w}${h}`);
      slab.position.y = h / 2 - 1;
      group.add(slab);
      const cap = box(w * 0.92, h * 0.16, 27, tone.clone().offsetHSL(0, 0, 0.04).getHex());
      cap.position.y = h - 1;
      group.add(cap);
      break;
    }
    case 'sign': {
      const postL = cyl(0.14, 0.14, 5, 0x8a9099, 6);
      postL.position.set(-1.6, 2.5, 0);
      group.add(postL);
      const postR = cyl(0.14, 0.14, 5, 0x8a9099, 6);
      postR.position.set(1.6, 2.5, 0);
      group.add(postR);
      const board = box(4.6, 2.4, 0.24, 0x1f7a4d, { emissive: 0x0d3a24, emissiveIntensity: 0.4 });
      board.position.y = 4.4;
      group.add(board);
      const bar = box(3.4, 0.5, 0.3, 0xe8f2ff, {}, 'signBar');
      bar.position.set(0, 4.9, 0.05);
      group.add(bar);
      const bar2 = box(2.4, 0.4, 0.3, 0xe8f2ff, {}, 'signBar2');
      bar2.position.set(-0.5, 4.0, 0.05);
      group.add(bar2);
      break;
    }
  }
  return group;
}

function disposeDeep(obj: THREE.Object3D): void {
  obj.traverse((child) => {
    const mesh = child as THREE.Mesh;
    if (mesh.geometry) mesh.geometry.dispose?.();
  });
}
