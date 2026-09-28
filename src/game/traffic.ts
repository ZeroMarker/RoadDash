import * as THREE from 'three';
import { VIEW_DIST, curveX, laneX } from './config';
import {
  OBSTACLES,
  VEHICLES,
  buildVehicle,
  type ObstacleKind,
  type VehicleKind,
} from './carModel';
import type { TrackHints } from './hints';

export interface Hazard {
  obj: THREE.Object3D;
  type: 'vehicle' | 'obstacle';
  vehicle: VehicleKind | null;
  obstacle: ObstacleKind | null;
  /** Police run you down from behind instead of being dodged. */
  pursuit: boolean;
  lane: number;
  z: number;
  offset: number;
  baseOffset: number;
  x: number;
  /** World Z velocity; negative drives away, like the player. */
  vz: number;
  halfWidth: number;
  halfLength: number;
  /** Top of a solid mass — jump it if it is low enough. */
  top: number;
  /** Underside of a hanging mass — duck to get under. 0 when none. */
  overhead: number;
  mode: 'solid' | 'launch';
  launch: number;
  passed: boolean;
  /** Guards against a hazard scoring a near miss more than once. */
  scored: boolean;
  wobblePhase: number;
  flash: THREE.Mesh[] | null;
}

const CAR_COLORS = [
  0xd8483c, 0x2f6fd0, 0xe0e2e6, 0x3f8f57, 0xe6b73c, 0x8b5cc7, 0x2c3138, 0xc86a2a, 0x2fa8a8,
];

const VEHICLE_WEIGHTS: {
  kind: VehicleKind;
  weight: number;
  minThreat: number;
}[] = [
  { kind: 'sedan', weight: 6, minThreat: 0 },
  { kind: 'taxi', weight: 3, minThreat: 0 },
  { kind: 'van', weight: 3, minThreat: 0.06 },
  { kind: 'bus', weight: 2, minThreat: 0.2 },
  { kind: 'truck', weight: 2, minThreat: 0.32 },
];

const MAX_HAZARDS = 32;

export interface TrafficContext {
  playerZ: number;
  playerSpeed: number;
  /** 0 → 1 difficulty ramp. */
  threat: number;
}

export class TrafficSystem {
  readonly group = new THREE.Group();
  hazards: Hazard[] = [];
  private pools = new Map<string, THREE.Object3D[]>();
  private spawnZ = 0;
  private police: Hazard | null = null;
  private policeCooldown = 10;
  private random: () => number;

  constructor(
    private scene: THREE.Scene,
    private hints: TrackHints,
    rng: () => number = Math.random,
  ) {
    this.random = rng;
    scene.add(this.group);
  }

  reset(playerZ: number): void {
    for (const h of this.hazards) this.release(h);
    this.hazards.length = 0;
    this.spawnZ = playerZ - 260;
    this.police = null;
    this.policeCooldown = 10;
    this.hints.zones.length = 0;
  }

  update(dt: number, ctx: TrafficContext): void {
    const { playerZ, playerSpeed, threat } = ctx;
    if (this.spawnZ === 0) this.spawnZ = playerZ - 260;

    const limit = playerZ - VIEW_DIST * 0.85;
    let guard = 0;
    while (this.spawnZ > limit && guard++ < 5) {
      this.spawnWave(this.spawnZ, ctx);
      const gap = Math.max(40, 104 - threat * 46);
      this.spawnZ -= gap * (0.75 + this.random() * 0.6);
    }

    for (let i = this.hazards.length - 1; i >= 0; i--) {
      const h = this.hazards[i];
      h.z += h.vz * dt;
      if (h.type === 'vehicle' && !h.pursuit) {
        h.wobblePhase += dt;
        h.offset = h.baseOffset + Math.sin(h.wobblePhase * 0.7) * 0.3;
      }
      h.x = curveX(h.z) + h.offset;
      h.obj.position.set(h.x, 0, h.z);
      h.obj.rotation.y = Math.atan2(-(curveX(h.z - 3) - curveX(h.z)), 3);

      if (h.flash) {
        const t = (performance.now() / 1000) * 7;
        for (let k = 0; k < h.flash.length; k++) {
          const mtl = h.flash[k].material as THREE.MeshLambertMaterial;
          mtl.emissiveIntensity = Math.sin(t + k * Math.PI) > 0 ? 2.6 : 0.15;
        }
      }

      if (h.z > playerZ + 45 || h.z < playerZ - VIEW_DIST * 1.5) {
        if (h === this.police) this.police = null;
        this.release(h);
        this.hazards.splice(i, 1);
      }
    }

    this.updatePolice(dt, playerZ, playerSpeed, threat);
  }

  private updatePolice(dt: number, playerZ: number, playerSpeed: number, threat: number): void {
    this.policeCooldown -= dt;
    if (threat > 0.14 && !this.police && this.policeCooldown <= 0) {
      const p = this.acquireVehicle('police', 0xf2f4f8);
      p.pursuit = true;
      p.lane = 1;
      p.baseOffset = 0;
      p.offset = 0;
      p.z = playerZ + 30;
      p.vz = 0;
      p.passed = true;
      p.scored = true;
      p.flash = p.obj.children.filter((c) => {
        const material = (c as THREE.Mesh).material as
          | THREE.MeshLambertMaterial
          | THREE.Material
          | undefined;
        return (
          material instanceof THREE.MeshLambertMaterial && material.emissiveIntensity === 1.8
        );
      }) as THREE.Mesh[];
      this.police = p;
      this.hazards.push(p);
    }
    const p = this.police;
    if (!p) return;

    const desired = 15 + threat * 13;
    p.vz = playerSpeed > 0 ? Math.max(playerSpeed - desired, 6) : 0;
    p.z += p.vz * dt;
    p.x = curveX(p.z) + p.offset;
    p.obj.position.set(p.x, 0, p.z);
    if (p.z > playerZ + 70) {
      this.release(p);
      this.hazards.splice(this.hazards.indexOf(p), 1);
      this.police = null;
      this.policeCooldown = 20;
    }
  }

  /** Near misses, drifts and ramps shove the police car back down the road. */
  pushPolice(back: number): boolean {
    if (!this.police) return false;
    this.police.z += back;
    return true;
  }

  hasPolice(): boolean {
    return this.police !== null;
  }

  private spawnWave(z: number, ctx: TrafficContext): void {
    const threat = ctx.threat;
    const lanes = shuffle([0, 1, 2], this.random);
    const roll = this.random();

    // 1. Traffic furniture: jump, duck or swerve.
    if (roll < 0.34) {
      const pick = this.random();
      const kind: ObstacleKind =
        pick < 0.5 ? 'barrier' : pick < 0.72 ? 'cones' : pick < 0.92 ? 'sign' : 'ramp';
      this.placeObstacle(kind, lanes[0] as number, z);
      if (this.random() < 0.3) {
        this.placeObstacle(this.random() < 0.5 ? 'blockade' : 'cones', lanes[1] as number, z);
      }
      return;
    }

    // 2. Slalom traffic.
    if (roll < 0.72) {
      const count = threat > 0.45 && this.random() < 0.6 ? 2 : 1;
      for (let i = 0; i < count; i++) {
        const lane = lanes[i] as number;
        this.placeVehicle(pickVehicle(threat, this.random), lane, z - i * 11);
      }
      return;
    }

    // 3. Slab of slow traffic — the signature "get out of the way" wall.
    const heavy: VehicleKind = this.random() < 0.5 ? 'truck' : 'bus';
    this.placeVehicle(heavy, lanes[0] as number, z);
    if (threat > 0.25 && this.random() < 0.5) {
      this.placeVehicle(this.random() < 0.5 ? 'truck' : 'van', lanes[1] as number, z - 5);
    }
  }

  private placeVehicle(kind: VehicleKind, lane: number, z: number): void {
    if (this.hazards.length >= MAX_HAZARDS) return;
    const color = kind === 'taxi' ? 0xf2c31c : kind === 'police' ? 0xf2f4f8 : pick(CAR_COLORS, this.random);
    const h = this.acquireVehicle(kind, color);
    const def = VEHICLES[kind];
    h.type = 'vehicle';
    h.pursuit = false;
    h.lane = lane;
    h.baseOffset = laneX(lane);
    h.offset = h.baseOffset;
    h.z = z;
    h.vz = -(kind === 'truck' || kind === 'bus' ? 13 + this.random() * 4 : 16 + this.random() * 12);
    h.halfWidth = def.halfWidth;
    h.halfLength = def.halfLength;
    h.top = def.height;
    h.overhead = 0;
    h.mode = 'solid';
    h.launch = 0;
    h.passed = false;
    h.wobblePhase = this.random() * 6.3;
    h.obj.visible = true;
    this.group.add(h.obj);
    this.hazards.push(h);
    this.hints.block(lane, z, def.halfLength + 1.5);
  }

  private placeObstacle(kind: ObstacleKind, lane: number, z: number): void {
    if (this.hazards.length >= MAX_HAZARDS) return;
    const def = OBSTACLES[kind];
    const h: Hazard = {
      obj: this.acquireObstacle(kind),
      type: 'obstacle',
      vehicle: null,
      obstacle: kind,
      pursuit: false,
      lane,
      z,
      offset: laneX(lane),
      baseOffset: laneX(lane),
      x: 0,
      vz: kind === 'blockade' ? -(2 + this.random() * 3) : 0,
      halfWidth: def.halfWidth,
      halfLength: def.halfLength,
      top: def.top,
      overhead: def.overhead,
      mode: def.mode,
      launch: def.launch,
      passed: false,
      scored: false,
      wobblePhase: 0,
      flash: null,
    };
    h.obj.visible = true;
    this.group.add(h.obj);
    this.hazards.push(h);
    this.hints.block(lane, z, def.halfLength + 1.2);
  }

  private acquireVehicle(kind: VehicleKind, color: number): Hazard {
    const key = `vehicle:${kind}`;
    let pool = this.pools.get(key);
    if (!pool) {
      pool = [];
      this.pools.set(key, pool);
    }
    const obj = pool.pop() ?? buildVehicle(kind, color);
    const def = VEHICLES[kind];
    return {
      obj,
      type: 'vehicle',
      vehicle: kind,
      obstacle: null,
      pursuit: false,
      lane: 0,
      z: 0,
      offset: 0,
      baseOffset: 0,
      x: 0,
      vz: 0,
      halfWidth: def.halfWidth,
      halfLength: def.halfLength,
      top: def.height,
      overhead: 0,
      mode: 'solid',
      launch: 0,
      passed: false,
      scored: false,
      wobblePhase: 0,
      flash: null,
    };
  }

  private acquireObstacle(kind: ObstacleKind): THREE.Object3D {
    const key = `obstacle:${kind}`;
    let pool = this.pools.get(key);
    if (!pool) {
      pool = [];
      this.pools.set(key, pool);
    }
    const obj = pool.pop() ?? OBSTACLES[kind].build();
    return obj;
  }

  private release(h: Hazard): void {
    this.group.remove(h.obj);
    const key = h.type === 'vehicle' ? `vehicle:${h.vehicle}` : `obstacle:${h.obstacle}`;
    let pool = this.pools.get(key);
    if (!pool) {
      pool = [];
      this.pools.set(key, pool);
    }
    pool.push(h.obj);
  }

  /** Dev helper: clear the road and stop the wave spawner. */
  freeze(): void {
    for (const h of this.hazards) this.release(h);
    this.hazards.length = 0;
    this.police = null;
    this.spawnZ = Number.POSITIVE_INFINITY;
  }

  /**
   * Dev helper: place one hazard `ahead` metres in front of the player.
   * `vehicleSpeed` pins the hazard's own speed so tests can control the
   * closing rate between the two.
   */
  debugSpawn(
    kind: ObstacleKind | VehicleKind,
    lane: number,
    ahead: number,
    playerZ: number,
    isVehicle = false,
    vehicleSpeed?: number,
  ): void {
    if (isVehicle) {
      this.placeVehicle(kind as VehicleKind, lane, playerZ - ahead);
      const h = this.hazards[this.hazards.length - 1];
      if (h && vehicleSpeed !== undefined) h.vz = -Math.abs(vehicleSpeed);
    } else {
      this.placeObstacle(kind as ObstacleKind, lane, playerZ - ahead);
    }
  }

  dispose(): void {
    for (const h of this.hazards) this.release(h);
    this.hazards.length = 0;
    this.scene.remove(this.group);
  }
}

function pick<T>(list: T[], r: () => number): T {
  return list[(r() * list.length) | 0];
}

function shuffle<T>(list: T[], r: () => number): T[] {
  const out = list.slice();
  for (let i = out.length - 1; i > 0; i--) {
    const j = (r() * (i + 1)) | 0;
    const tmp = out[i] as T;
    out[i] = out[j] as T;
    out[j] = tmp;
  }
  return out;
}

function pickVehicle(threat: number, r: () => number): VehicleKind {
  const eligible = VEHICLE_WEIGHTS.filter((v) => threat >= v.minThreat);
  const total = eligible.reduce((a, b) => a + b.weight, 0);
  let roll = r() * total;
  for (const v of eligible) {
    roll -= v.weight;
    if (roll <= 0) return v.kind;
  }
  return 'sedan';
}
