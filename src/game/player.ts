import * as THREE from 'three';
import {
  GRAVITY,
  JUMP_V,
  LANE_COUNT,
  LANE_SWITCH_TIME,
  LANE_W,
  NITRO_DRAIN,
  NITRO_MAX,
  RAMP_LAUNCH_V,
  SLIDE_TIME,
  laneX,
} from './config';
import { buildPlayerCar, type CarRig } from './carModel';
import { curveX, type CarSpec } from './config';

export type PlayerEvent = 'jump' | 'land' | 'ramp' | 'drift' | 'hit' | 'shieldBreak' | 'nitroOn' | 'nitroOff';

export class Player {
  readonly rig: CarRig;
  readonly group = new THREE.Group();

  lane = 1;
  /** Smoothed lateral position, so lane changes lean rather than teleport. */
  x = 0;
  targetX = 0;
  laneTimer = 0;

  y = 0;
  vy = 0;
  airborne = false;

  slideTimer = 0;
  sliding = false;
  driftDir = 0;
  driftCharge = 0;

  nitro = 0;
  nitroActive = false;

  hp: number;
  maxHp: number;
  invincible = 0;
  invulnerable = false;
  alive = true;

  /** Smoothed visual roll / pitch for the body mesh. */
  private roll = 0;
  private pitch = 0;
  private wheelSpin = 0;
  private hitFlash = 0;

  constructor(
    private scene: THREE.Scene,
    readonly spec: CarSpec,
  ) {
    this.rig = buildPlayerCar(spec);
    this.group.add(this.rig.root);
    this.maxHp = 2 + spec.armor;
    this.hp = this.maxHp;
    scene.add(this.group);
  }

  /**
   * World-space X. `x` is only the offset from the track centreline, so
   * anything placed in world space (sparks, camera targets, pickups) has to
   * add the centreline back in.
   */
  get worldX(): number {
    return curveX(this.group.position.z) + this.x;
  }

  get slidingOrCrouching(): boolean {
    return this.sliding;
  }

  reset(): void {
    this.lane = 1;
    this.x = 0;
    this.targetX = 0;
    this.laneTimer = 0;
    this.y = 0;
    this.vy = 0;
    this.airborne = false;
    this.slideTimer = 0;
    this.sliding = false;
    this.driftDir = 0;
    this.driftCharge = 0;
    this.nitro = 0;
    this.nitroActive = false;
    this.hp = this.maxHp;
    this.invincible = 0;
    this.invulnerable = false;
    this.alive = true;
    this.roll = 0;
    this.pitch = 0;
    this.hitFlash = 0;
    this.group.visible = true;
    this.rig.root.scale.set(1, 1, 1);
    this.rig.root.position.set(0, 0, 0);
    this.rig.root.rotation.set(0, 0, 0);
  }

  steer(dir: -1 | 1): boolean {
    if (!this.alive) return false;
    const next = this.lane + dir;
    if (next < 0 || next > LANE_COUNT - 1) return false;
    this.lane = next;
    this.targetX = laneX(next);
    this.laneTimer = LANE_SWITCH_TIME;
    if (this.sliding) this.driftDir = dir;
    return true;
  }

  jump(force = JUMP_V): boolean {
    if (!this.alive || this.airborne) return false;
    this.vy = force;
    this.airborne = true;
    return true;
  }

  slide(): boolean {
    if (!this.alive) return false;
    if (this.slideTimer > 0) return false;
    this.slideTimer = SLIDE_TIME;
    this.sliding = true;
    this.driftDir = 0;
    return true;
  }

  addNitro(amount: number): void {
    this.nitro = Math.min(NITRO_MAX, this.nitro + amount * this.spec.nitroGain);
  }

  toggleNitro(): boolean {
    if (!this.alive) return false;
    if (this.nitroActive) {
      this.nitroActive = false;
      return false;
    }
    if (this.nitro < 25) return false;
    this.nitroActive = true;
    this.invulnerable = true;
    return true;
  }

  takeHit(): 'shield' | 'damage' | 'dead' {
    if (this.invincible > 0 || this.nitroActive) return 'shield';
    this.hp -= 1;
    this.invincible = 1.35;
    this.hitFlash = 1;
    // Knock the car off-line a little so hits feel physical.
    this.x += (Math.random() - 0.5) * 0.7;
    this.nitro = Math.max(0, this.nitro - 18);
    if (this.hp <= 0) {
      this.hp = 0;
      this.alive = false;
      return 'dead';
    }
    return 'damage';
  }

  /**
   * @param dt seconds
   * @param speedRatio 0 → 1 how hard the car is being pushed
   * @param events collects feedback callbacks
   */
  update(
    dt: number,
    speedRatio: number,
    playerZ: number,
    events: (e: PlayerEvent) => void,
  ): void {
    const handling = this.spec.handling;

    // Lateral: cross a lane in LANE_SWITCH_TIME, ease back when not steering.
    const maxLateral = (LANE_W / LANE_SWITCH_TIME) * handling;
    this.laneTimer = Math.max(0, this.laneTimer - dt);
    const ease = this.laneTimer > 0 ? maxLateral : maxLateral * 0.4;
    const dx = this.targetX - this.x;
    const previousX = this.x;
    this.x += Math.sign(dx) * Math.min(Math.abs(dx), ease * dt);
    const lateralVelocity = dt > 0 ? (this.x - previousX) / dt : 0;

    // Vertical
    if (this.airborne) {
      this.vy -= GRAVITY * dt;
      this.y += this.vy * dt;
      if (this.y <= 0) {
        this.y = 0;
        this.vy = 0;
        this.airborne = false;
        events('land');
      }
    }

    // Slide / drift
    if (this.slideTimer > 0) {
      this.slideTimer -= dt;
      this.driftCharge += dt * this.spec.nitroGain;
      if (this.driftDir !== 0) {
        this.addNitro(dt * 26);
        this.pushDriftFeedback(dt);
      }
      if (this.slideTimer <= 0) {
        this.sliding = false;
        this.driftDir = 0;
      }
    }

    // Nitro burn
    if (this.nitroActive) {
      this.nitro -= NITRO_DRAIN * dt;
      if (this.nitro <= 0) {
        this.nitro = 0;
        this.nitroActive = false;
        this.invulnerable = false;
        events('nitroOff');
      }
    }

    this.invincible = Math.max(0, this.invincible - dt);
    this.hitFlash = Math.max(0, this.hitFlash - dt * 2.2);

    // --- presentation -----------------------------------------------------
    this.wheelSpin += dt * (14 + speedRatio * 42);
    for (const w of this.rig.wheels) w.rotation.x = this.wheelSpin;
    const steerAngle = THREE.MathUtils.clamp(-lateralVelocity * 0.03, -0.34, 0.34);
    for (const s of this.rig.steer) s.rotation.y = steerAngle;

    const targetRoll = THREE.MathUtils.clamp(lateralVelocity * 0.016, -0.16, 0.16);
    const targetPitch =
      (this.airborne ? -THREE.MathUtils.clamp(this.vy * 0.022, -0.3, 0.3) : speedRatio * -0.02) +
      (this.sliding ? 0.05 : 0);
    this.roll += (targetRoll - this.roll) * Math.min(1, dt * 12);
    this.pitch += (targetPitch - this.pitch) * Math.min(1, dt * 9);
    this.rig.body.rotation.z = this.roll;
    this.rig.body.rotation.x = this.pitch;

    // Duck: squash the body, drop the silhouette.
    const targetScaleY = this.sliding ? 0.62 : 1;
    this.rig.body.scale.y += (targetScaleY - this.rig.body.scale.y) * Math.min(1, dt * 16);
    this.rig.body.position.y = this.sliding ? -0.12 : 0;

    // Boost flame
    this.rig.flame.visible = this.nitroActive;
    if (this.nitroActive) {
      const flicker = 0.75 + Math.random() * 0.5;
      this.rig.flame.scale.set(flicker, flicker, 0.8 + Math.random() * 0.9);
    }

    // Brake lights glow while sliding / braking hard.
    for (const light of this.rig.brakeLights) {
      (light.material as THREE.MeshLambertMaterial).emissiveIntensity = this.sliding ? 2.2 : 1.1;
    }

    // Blink while invulnerable after a hit.
    if (this.invincible > 0) {
      this.group.visible = Math.sin(this.invincible * 40) > -0.3;
    } else {
      this.group.visible = true;
    }

    // `x` is the lane offset; the world position also follows the centreline.
    this.group.position.set(curveX(playerZ) + this.x, this.y, playerZ);
  }

  private pushDriftFeedback(dt: number): void {
    this.x += this.driftDir * 0.9 * dt;
  }

  /** Ramp launch, called by the collision pass. */
  launch(): boolean {
    return this.jump(RAMP_LAUNCH_V);
  }

  /** Collision box half-extents, shrunk while sliding. */
  get halfHeight(): number {
    return this.sliding ? 0.55 : 0.95;
  }

  get halfWidth(): number {
    return 0.95 * this.spec.wide;
  }

  get halfLength(): number {
    return 2.15;
  }

  /** 0 → 1 hit flash for the renderer / post effects. */
  get flash(): number {
    return this.hitFlash;
  }

  dispose(): void {
    this.scene.remove(this.group);
  }
}
