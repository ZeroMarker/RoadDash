import * as THREE from 'three';
import { VIEW_DIST, curveX, laneX } from './config';
import { cyl, geo, mat } from './gfx';
import type { TrackHints } from './hints';

export type PickupKind = 'coin' | 'magnet' | 'shield' | 'nitro';

export interface Pickup {
  obj: THREE.Object3D;
  kind: PickupKind;
  lane: number;
  z: number;
  x: number;
  y: number;
  spin: number;
  pulled: boolean;
  collected: boolean;
}

const MAX_PICKUPS = 120;

const PICKUP_INFO: Record<PickupKind, { color: number; emissive: number }> = {
  coin: { color: 0xffc63a, emissive: 0xffae1a },
  magnet: { color: 0x59c8ff, emissive: 0x2f9fe0 },
  shield: { color: 0x7dff9e, emissive: 0x35c46a },
  nitro: { color: 0xff7ae0, emissive: 0xe035b0 },
};

function makePickupMesh(kind: PickupKind): THREE.Object3D {
  if (kind === 'coin') {
    const g = new THREE.Group();
    const disc = cyl(0.42, 0.42, 0.09, 0xffc63a, 12, 'coinDisc');
    disc.rotation.x = Math.PI / 2;
    g.add(disc);
    const rim = cyl(0.32, 0.32, 0.12, 0xffe08a, 10, 'coinRim');
    rim.rotation.x = Math.PI / 2;
    g.add(rim);
    return g;
  }
  const g = new THREE.Group();
  const info = PICKUP_INFO[kind];
  const shell = new THREE.Mesh(
    geo(`pu${kind}`, () => new THREE.IcosahedronGeometry(0.62, 0)),
    mat(info.color, { emissive: info.emissive, emissiveIntensity: 0.7, transparent: true, opacity: 0.9 }),
  );
  g.add(shell);
  const glyph = new THREE.Mesh(
    geo(`pug${kind}`, () => new THREE.BoxGeometry(0.9, 0.16, 0.16)),
    mat(0xffffff, { emissive: 0xffffff, emissiveIntensity: 0.8 }),
  );
  if (kind === 'nitro') glyph.rotation.z = Math.PI / 2;
  g.add(glyph);
  if (kind === 'shield') {
    const ring = new THREE.Mesh(
      geo('puRing', () => new THREE.TorusGeometry(0.9, 0.07, 6, 14)),
      mat(info.color, { emissive: info.emissive, emissiveIntensity: 0.6 }),
    );
    ring.rotation.x = Math.PI / 2;
    g.add(ring);
  }
  if (kind === 'magnet') {
    const ring = new THREE.Mesh(
      geo('puRing', () => new THREE.TorusGeometry(0.95, 0.08, 6, 14)),
      mat(info.color, { emissive: info.emissive, emissiveIntensity: 0.6 }),
    );
    g.add(ring);
  }
  return g;
}

export interface PickedUp {
  kind: PickupKind;
  /** World-space position, so effects can pop at the actual pickup point. */
  x: number;
  y: number;
  z: number;
}

export interface CollectResult {
  coins: number;
  magnet: boolean;
  shield: boolean;
  nitro: boolean;
  /** One entry per pickup collected this frame, in collection order. */
  picked: PickedUp[];
}

export class CollectibleSystem {
  readonly group = new THREE.Group();
  pickups: Pickup[] = [];
  private pools = new Map<string, THREE.Object3D[]>();
  private nextZ = 0;
  private random: () => number;
  private coinLane = 1;

  constructor(
    private scene: THREE.Scene,
    private hints: TrackHints,
    rng: () => number = Math.random,
  ) {
    this.random = rng;
    scene.add(this.group);
  }

  reset(playerZ: number): void {
    for (const p of this.pickups) this.release(p);
    this.pickups.length = 0;
    this.nextZ = playerZ - 60;
  }

  /** Dev helper: clear pickups and stop spawning. */
  freeze(): void {
    this.reset(0);
    this.nextZ = Number.POSITIVE_INFINITY;
  }

  update(dt: number, playerZ: number, playerX: number, playerY: number, magnet: boolean): CollectResult {
    const result: CollectResult = {
      coins: 0,
      magnet: false,
      shield: false,
      nitro: false,
      picked: [],
    };
    if (this.nextZ === 0) this.nextZ = playerZ - 60;

    const limit = playerZ - VIEW_DIST * 0.8;
    let guard = 0;
    while (this.nextZ > limit && guard++ < 6) {
      this.spawnPattern(this.nextZ);
      this.nextZ -= 26 + this.random() * 34;
    }

    // --- move + collect ----------------------------------------------------
    for (let i = this.pickups.length - 1; i >= 0; i--) {
      const p = this.pickups[i];
      p.spin += dt;

      if (magnet && p.kind === 'coin' && !p.collected) {
        const dz = p.z - playerZ;
        if (dz < 2 && dz > -34) {
          p.pulled = true;
          const tx = playerX;
          const tz = playerZ;
          const k = Math.min(1, dt * 9);
          p.x += (tx - p.x) * k;
          p.z += (tz - p.z) * k;
          p.y += (playerY + 1.1 - p.y) * k;
        }
      }

      p.obj.position.set(p.x, p.y + (p.pulled ? 0 : Math.sin(p.spin * 2.6) * 0.12), p.z);
      p.obj.rotation.y = p.spin * 2.4;
      p.obj.rotation.x = p.kind === 'coin' ? 0 : p.spin * 1.3;

      if (!p.collected) {
        const dx = p.x - playerX;
        const dz = p.z - playerZ;
        const dy = p.y - (playerY + 0.9);
        if (Math.abs(dz) < 1.5 && Math.abs(dx) < 1.7 && Math.abs(dy) < 2.1) {
          p.collected = true;
          result.picked.push({ kind: p.kind, x: p.x, y: p.y, z: p.z });
          if (p.kind === 'coin') result.coins++;
          else if (p.kind === 'magnet') result.magnet = true;
          else if (p.kind === 'shield') result.shield = true;
          else result.nitro = true;
          this.group.remove(p.obj);
        }
      }

      if (p.z > playerZ + 30) {
        if (p.collected) this.pickups.splice(i, 1);
        else {
          this.release(p);
          this.pickups.splice(i, 1);
        }
      }
    }

    return result;
  }

  private spawnPattern(z: number): void {
    const roll = this.random();
    if (roll < 0.09) {
      const kind: PickupKind = this.random() < 0.34 ? 'magnet' : this.random() < 0.5 ? 'shield' : 'nitro';
      this.spawn(kind, (this.random() * 3) | 0, z, 1.4);
      return;
    }
    // Coin run: a gentle weave through clear lanes.
    const length = 5 + ((this.random() * 6) | 0);
    for (let i = 0; i < length; i++) {
      const zz = z - i * 4.2;
      if (this.random() < 0.25)
        this.coinLane = Math.max(0, Math.min(2, this.coinLane + (this.random() < 0.5 ? -1 : 1)));
      if (this.hints.isBlocked(this.coinLane, zz, 1.5)) continue;
      this.spawn('coin', this.coinLane, zz, 1.1);
    }
  }

  private spawn(kind: PickupKind, lane: number, z: number, y: number): void {
    if (this.pickups.length >= MAX_PICKUPS) return;
    if (this.hints.isBlocked(lane, z, 1.2)) return;
    this.spawnAt(kind, lane, z, y);
  }

  /**
   * Spawn a pickup, ignoring lane-occupancy hints. Used by tooling to place a
   * pickup in a known spot — the hints exist to stop coins generating inside
   * trucks, which is a spawner concern, not an invariant of the pickup itself.
   */
  spawnAt(kind: PickupKind, lane: number, z: number, y: number): void {
    if (this.pickups.length >= MAX_PICKUPS) return;
    const key = `${kind}`;
    let pool = this.pools.get(key);
    if (!pool) {
      pool = [];
      this.pools.set(key, pool);
    }
    const obj = pool.pop() ?? makePickupMesh(kind);
    obj.visible = true;
    const x = curveX(z) + laneX(lane);
    obj.position.set(x, y, z);
    this.group.add(obj);
    this.pickups.push({
      obj,
      kind,
      lane,
      z,
      x,
      y,
      spin: this.random() * 3,
      pulled: false,
      collected: false,
    });
  }

  private release(p: Pickup): void {
    this.group.remove(p.obj);
    const key = `${p.kind}`;
    let pool = this.pools.get(key);
    if (!pool) {
      pool = [];
      this.pools.set(key, pool);
    }
    pool.push(p.obj);
  }

  dispose(): void {
    for (const p of this.pickups) this.release(p);
    this.pickups.length = 0;
    this.scene.remove(this.group);
  }
}
