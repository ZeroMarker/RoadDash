import * as THREE from 'three';
import {
  BIOMES,
  BIOME_LENGTH,
  COIN_VALUE,
  MAX_SPEED,
  NEAR_MISS_RADIUS,
  NITRO_SPEED_BONUS,
  ROAD_HALF,
  START_SPEED,
  STORAGE_KEY,
  curveSlope,
  curveX,
  laneX,
} from './config';
import { RoadRibbon } from './road';
import { PropField } from './props';
import { TrackHints } from './hints';
import { TrafficSystem } from './traffic';
import { CollectibleSystem } from './collectibles';
import { Player } from './player';
import { Effects, PickupRings, SpeedLines } from './effects';
import { AudioKit } from './audio';
import { Input } from './input';
import { Hud, type RunStats } from './hud';
import { box } from './gfx';
import type { PickedUp } from './collectibles';
import type { Action } from './input';

type State = 'menu' | 'playing' | 'paused' | 'over';

const CAM_BACK = 12.6;
const CAM_HEIGHT = 5.15;
/**
 * The look target sits just ahead of the car rather than far down the road —
 * aiming deep makes sweeping corners push the car off-centre on screen.
 */
const CAM_LOOK_AHEAD = -7;
const CAM_LOOK_HEIGHT = 1.8;
/** How much of the car's lateral position the camera mirrors. */
const CAM_FOLLOW = 0.7;

export class Game {
  private renderer: THREE.WebGLRenderer;
  private scene = new THREE.Scene();
  private camera: THREE.PerspectiveCamera;
  private clock = new THREE.Clock();

  private ribbon: RoadRibbon;
  private props: PropField;
  private hints = new TrackHints();
  private traffic: TrafficSystem;
  private coins: CollectibleSystem;
  private player: Player;
  private effects: Effects;
  private rings: PickupRings;
  private speedLines: SpeedLines;
  private audio = new AudioKit();
  private hud = new Hud();
  private input: Input;
  private shadow: THREE.Mesh;
  private tunnel: THREE.Group;

  private ambient: THREE.HemisphereLight;
  private sun: THREE.DirectionalLight;
  private fill: THREE.DirectionalLight;

  private state: State = 'menu';
  private best = 0;
  private muted = false;

  // run state
  private speed = 0;
  private distance = 0;
  private score = 0;
  private coinCount = 0;
  private combo = 0;
  private comboTimer = 0;
  private shake = 0;
  private hurtTimer = 0;
  private biomeIndex = -1;
  private magnet = false;
  private magnetTimer = 0;
  private policeGap = 0;

  // environment colours, lerped between biomes
  private env = {
    sky: new THREE.Color(),
    fog: new THREE.Color(),
    ambient: new THREE.Color(),
    sun: new THREE.Color(),
    target: {
      sky: new THREE.Color(),
      fog: new THREE.Color(),
      ambient: new THREE.Color(),
      sun: new THREE.Color(),
      ambientIntensity: 1,
      sunIntensity: 1.5,
      sunHeight: 0.6,
      fogNear: 60,
      fogFar: 460,
    },
  };

  private raf = 0;

  constructor(canvas: HTMLCanvasElement) {
    this.renderer = new THREE.WebGLRenderer({
      canvas,
      antialias: window.devicePixelRatio < 2,
      powerPreference: 'high-performance',
    });
    this.renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
    this.renderer.setSize(window.innerWidth, window.innerHeight, false);
    this.renderer.outputColorSpace = THREE.SRGBColorSpace;
    this.renderer.toneMapping = THREE.ACESFilmicToneMapping;
    this.renderer.toneMappingExposure = 1.05;

    this.camera = new THREE.PerspectiveCamera(
      62,
      window.innerWidth / window.innerHeight,
      0.5,
      1600,
    );
    this.camera.position.set(0, CAM_HEIGHT, CAM_BACK);
    this.scene.fog = new THREE.Fog(0x33406b, 60, 460);

    this.ambient = new THREE.HemisphereLight(0x93a6d8, 0x2a2f3a, 0.9);
    this.scene.add(this.ambient);
    this.sun = new THREE.DirectionalLight(0xffb37a, 1.5);
    this.sun.position.set(-40, 60, 30);
    this.scene.add(this.sun);
    this.fill = new THREE.DirectionalLight(0x88aaff, 0.35);
    this.fill.position.set(50, 20, -40);
    this.scene.add(this.fill);

    this.ribbon = new RoadRibbon();
    this.scene.add(this.ribbon.mesh);

    this.props = new PropField(this.scene);
    this.traffic = new TrafficSystem(this.scene, this.hints);
    this.coins = new CollectibleSystem(this.scene, this.hints);
    this.player = new Player(this.scene, this.hud.car);
    this.effects = new Effects(this.scene);
    this.rings = new PickupRings(this.scene);
    this.speedLines = new SpeedLines(this.scene);

    // Fake contact shadow keeps the car glued to the road without shadow maps.
    this.shadow = box(2.6, 0.02, 5, 0x000000, { transparent: true, opacity: 0.32 });
    this.shadow.position.y = 0.05;
    this.scene.add(this.shadow);

    // Tunnel shell: a dark box the camera sits inside, tiled forward so the
    // night sky never shows through. The first slab starts behind the camera.
    this.tunnel = new THREE.Group();
    for (let i = 0; i < 4; i++) {
      const slab = box((ROAD_HALF + 3) * 2, 15, 62, 0x272c35, { side: THREE.BackSide });
      slab.position.y = 6.5;
      this.tunnel.add(slab);
    }
    this.tunnel.visible = false;
    this.scene.add(this.tunnel);

    this.best = Number(localStorage.getItem(STORAGE_KEY) ?? 0) || 0;
    this.applyBiome(0, true);

    this.input = new Input(canvas);
    this.input.on((action) => this.onAction(action));
    this.wireHud();
    this.hud.showStart(this.best);
    this.hud.setShield(this.player.hp, this.player.maxHp);

    window.addEventListener('resize', this.onResize);
    document.addEventListener('visibilitychange', this.onVisibility);

    this.resetRun();
    this.clock.start();
    this.loop();
  }

  // ------------------------------------------------------------------ setup
  private wireHud(): void {
    this.hud.onStart = () => this.startRun();
    this.hud.onResume = () => this.setPaused(false);
    this.hud.onQuit = () => this.toMenu();
    this.hud.onMute = () => {
      this.muted = !this.muted;
      this.audio.setMuted(this.muted);
      this.hud.setMuted(this.muted);
    };
  }

  private onResize = () => {
    const w = window.innerWidth;
    const h = window.innerHeight;
    this.renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
    this.renderer.setSize(w, h, false);
    this.camera.aspect = w / h;
    this.camera.updateProjectionMatrix();
  };

  private onVisibility = () => {
    if (document.hidden && this.state === 'playing') this.setPaused(true);
  };

  private onAction(action: Action): void {
    this.audio.start();
    switch (action) {
      case 'left':
        if (this.state === 'menu') this.hud.selectCar(this.hud.selectedCar - 1);
        else if (this.state === 'over') this.startRun();
        else this.player.steer(-1);
        break;
      case 'right':
        if (this.state === 'menu') this.hud.selectCar(this.hud.selectedCar + 1);
        else if (this.state === 'over') this.startRun();
        else this.player.steer(1);
        break;
      case 'jump':
        if (this.state === 'menu' || this.state === 'over') this.startRun();
        else if (this.player.jump()) this.effects.burst(this.player.worldX, 0.3, 0, 5, { color: 0xcfd8e8, speed: 5, life: 0.3 });
        break;
      case 'slide':
        if (this.state === 'menu') this.startRun();
        else if (this.player.slide()) this.onDriftStart();
        break;
      case 'nitro':
        if (this.state === 'menu' || this.state === 'over') this.startRun();
        else if (this.player.toggleNitro()) this.onNitroStart();
        break;
      case 'pause':
        if (this.state === 'playing') this.setPaused(true);
        else if (this.state === 'paused') this.setPaused(false);
        break;
      case 'confirm':
        if (this.state === 'over' || this.state === 'menu') this.startRun();
        break;
    }
  }

  // ------------------------------------------------------------------- flow
  private startRun(): void {
    this.audio.start();
    this.resetRun();
    this.state = 'playing';
    this.hud.setHudVisible(true);
    this.hud.hideOverlays();
    this.hud.setHurt(false);
    this.hud.setBoost(false);
  }

  private toMenu(): void {
    this.state = 'menu';
    this.resetRun();
    this.hud.showStart(this.best);
    this.hud.setHudVisible(false);
    this.hud.showPause(false);
  }

  private setPaused(paused: boolean): void {
    if (paused && this.state !== 'playing') return;
    if (!paused && this.state !== 'paused') return;
    this.state = paused ? 'paused' : 'playing';
    this.hud.showPause(paused);
    if (paused) this.audio.update(0, false, false);
  }

  private resetRun(): void {
    this.speed = START_SPEED;
    this.score = 0;
    this.coinCount = 0;
    this.combo = 0;
    this.comboTimer = 0;
    this.shake = 0;
    this.hurtTimer = 0;
    this.magnet = false;
    this.magnetTimer = 0;
    this.policeGap = 0;
    this.biomeIndex = -1;
    // Reset the world anchor first: the systems below place their spawn cursors
    // relative to the player, so doing it afterwards leaves them spawning from
    // the previous run's coordinates.
    this.playerZ = 0;
    this.distance = 0;
    this.player.reset();
    this.traffic.reset(this.playerZ);
    this.coins.reset(this.playerZ);
    this.props.reset();
    this.effects.clear();
    this.rings.clear();
    this.hints.zones.length = 0;
    this.hud.setNitro(0, false);
    this.hud.setShield(this.player.hp, this.player.maxHp);
    this.hud.setPolice(false);
    this.hud.setHurt(false);
    this.hud.setBoost(false);
    this.applyBiome(0, true);
    this.camera.position.set(curveX(CAM_BACK), CAM_HEIGHT, CAM_BACK);
  }

  private playerZ = 0;

  // -------------------------------------------------------------- main loop
  private loop = (): void => {
    this.raf = requestAnimationFrame(this.loop);
    const dt = Math.min(this.clock.getDelta(), 1 / 24);
    if (this.state === 'playing') this.step(dt);
    this.render(dt);
  };

  private step(dt: number): void {
    const spec = this.player.spec;

    // --- speed ------------------------------------------------------------
    const ramp = Math.min(1, this.distance / 5200);
    const target =
      (START_SPEED + (MAX_SPEED - START_SPEED) * Math.pow(ramp, 0.75)) * spec.topSpeed +
      (this.player.nitroActive ? NITRO_SPEED_BONUS : 0);
    this.speed += (target - this.speed) * Math.min(1, dt * 0.55 * spec.accel);
    this.playerZ -= this.speed * dt;
    this.distance = -this.playerZ;

    // --- world ------------------------------------------------------------
    const threat = Math.min(1, this.distance / 2400) * 0.75 + Math.min(0.25, this.speed / 400);
    this.traffic.update(dt, {
      playerZ: this.playerZ,
      playerSpeed: this.speed,
      threat: Math.min(1, threat),
    });
    const collected = this.coins.update(
      dt,
      this.playerZ,
      this.player.worldX,
      this.player.y,
      this.magnet,
    );
    this.hints.prune(this.playerZ);

    if (collected.coins > 0) {
      this.coinCount += collected.coins;
      this.score += collected.coins * COIN_VALUE;
      this.audio.coin();
      this.hud.pulseCoins();
    }
    this.playPickupEffects(collected.picked);
    if (collected.magnet) {
      this.magnet = true;
      this.magnetTimer = 9;
      this.hud.showBanner('MAGNET', 'COINS INBOUND', 'near', 1100);
      this.audio.blip(520, 0.2, 'sine', 0.2);
    }
    if (collected.shield) {
      this.player.hp = Math.min(this.player.maxHp, this.player.hp + 1);
      this.hud.setShield(this.player.hp, this.player.maxHp);
      this.hud.showBanner('ARMOUR', 'DAMAGE ABSORBED', 'near', 1000);
      this.audio.blip(660, 0.16, 'sine', 0.2);
    }
    if (collected.nitro) {
      this.player.addNitro(60);
      this.hud.showBanner('NITRO +', 'CHARGED', 'boost', 900);
      this.audio.blip(880, 0.16, 'sine', 0.2);
    }

    if (this.magnet) {
      this.magnetTimer -= dt;
      if (this.magnetTimer <= 0) this.magnet = false;
    }

    // --- player -----------------------------------------------------------
    const speedRatio = THREE.MathUtils.clamp(
      (this.speed - START_SPEED) / (MAX_SPEED * spec.topSpeed - START_SPEED || 1),
      0,
      1,
    );
    this.player.update(dt, speedRatio, this.playerZ, (event) => {
      if (event === 'land') {
        this.shake = Math.min(0.5, this.shake + 0.22);
        this.effects.burst(this.player.worldX, 0.2, this.playerZ, 8, {
          color: 0x9aa4b4,
          speed: 7,
          life: 0.35,
          spread: 1.6,
        });
      } else if (event === 'nitroOff') {
        this.hud.setBoost(false);
      }
    });

    // Drift builds nitro and pushes the police back.
    if (this.player.sliding && this.player.driftDir !== 0) {
      this.comboTimer = Math.max(this.comboTimer, 0.4);
      this.traffic.pushPolice(dt * 26);
    }

    this.checkCollisions(dt);

    // --- combo decay ------------------------------------------------------
    if (this.comboTimer > 0) {
      this.comboTimer -= dt;
      if (this.comboTimer <= 0) this.combo = 0;
    }

    // --- biomes -----------------------------------------------------------
    const index = Math.floor(this.distance / BIOME_LENGTH);
    if (index !== this.biomeIndex) this.applyBiome(index, false);

    // --- score ------------------------------------------------------------
    this.score += this.speed * dt * 0.42;
    if (this.player.nitroActive) this.score += dt * 120;

    // --- police -----------------------------------------------------------
    this.policeGap = this.traffic.hasPolice() ? 1 : 0;
    this.hud.setPolice(this.policeGap === 1);
    this.audio.setSiren(this.policeGap === 1);

    // --- shake / hurt -----------------------------------------------------
    this.shake = Math.max(0, this.shake - dt * 1.8);
    this.hurtTimer = Math.max(0, this.hurtTimer - dt);
    this.hud.setHurt(this.hurtTimer > 0);
    this.hud.setBoost(this.player.nitroActive);

    // --- hud --------------------------------------------------------------
    this.hud.setSpeed(this.speed * 3.6, speedRatio, this.player.nitroActive);
    this.hud.setScore(this.score, this.distance, this.coinCount, this.best);
    this.hud.setNitro(this.player.nitro, this.player.nitroActive);
    this.hud.tick(dt);
    this.audio.update(speedRatio, true, this.player.nitroActive);

    this.effects.update(dt);
    this.rings.update(dt);
  }

  /**
   * Pop a ring at every pickup, tuned per kind: coins get a small warm ring
   * plus a sparkle, power-ups get a bigger, slower ring so they read as
   * important even in a dense coin run.
   */
  private playPickupEffects(picked: PickedUp[]): void {
    for (const p of picked) {
      if (p.kind === 'coin') {
        // Spawn the pop slightly above the coin: the pickup is collected at
        // roof height, so a ring at the exact point sits half-buried in the car.
        this.rings.pop(p.x, p.y + 0.35, p.z, 0xffc63a, 0.6, 0.3, this.camera);
        // A few sparks, biased upward so they drift like coins spinning away.
        this.effects.burst(p.x, p.y, p.z, 5, {
          color: 0xffd873,
          speed: 4,
          life: 0.3,
          spread: 1,
          upward: 1.2,
          size: 0.45,
        });
      } else {
        const color = p.kind === 'magnet' ? 0x59c8ff : p.kind === 'shield' ? 0x7dff9e : 0xff7ae0;
        this.rings.pop(p.x, p.y, p.z, color, 1.15, 0.5, this.camera);
        this.effects.burst(p.x, p.y, p.z, 16, {
          color,
          speed: 9,
          life: 0.6,
          spread: 1.3,
          upward: 0.8,
        });
      }
    }
  }

  // -------------------------------------------------------------- collisions
  private checkCollisions(dt: number): void {
    const player = this.player;
    const pz = this.playerZ;
    void dt;

    for (const h of this.traffic.hazards) {
      const dx = Math.abs(h.x - player.worldX);
      const dz = Math.abs(h.z - pz);
      const overlapZ = dz < h.halfLength + player.halfLength;

      if (overlapZ && dx < h.halfWidth + player.halfWidth) {
        if (h.mode === 'launch' && h.launch > 0) {
          if (player.launch()) {
            h.launch = 0;
            h.halfWidth = 0;
            this.shake = Math.min(0.7, this.shake + 0.35);
            this.player.addNitro(22);
            this.hud.showBanner('AIRBORNE', 'RAMP LAUNCH', 'boost', 700);
            this.audio.nitroWhoosh();
            this.effects.burst(h.x, 0.3, h.z, 14, {
              color: 0xffd27a,
              speed: 9,
              life: 0.5,
            });
          }
          continue;
        }

        if (h.overhead > 0) {
          // Hanging sign: only a problem if the car is too tall to duck.
          if (player.y + player.halfHeight * 1.7 <= h.overhead) continue;
        } else if (player.y > h.top - 0.12) {
          continue; // jumped clean over it
        }

        if (h.pursuit) {
          this.gameOver('busted', 'The cruiser caught your door handle.');
          return;
        }
        this.onCrash(h.x, h.z);
        if (!player.alive) return;
        continue;
      }

      // Near miss: something in an adjacent lane was passed close but clean.
      // `passed` is the one-way latch that guarantees each hazard scores once.
      if (!h.passed && h.z > pz) {
        h.passed = true;
        const gap = dx - h.halfWidth - player.halfWidth;
        if (gap > 0 && gap < NEAR_MISS_RADIUS && !h.pursuit && !h.scored) {
          h.scored = true;
          this.combo += 1;
          this.comboTimer = 1.5;
          this.score += 40 + this.combo * 20;
          this.player.addNitro(13);
          this.traffic.pushPolice(2.4);
          this.audio.nearMiss();
          this.effects.burst(h.x, 1, pz, 6, {
            color: 0x7fd4ff,
            speed: 8,
            life: 0.35,
            spread: 1.4,
          });
          if (this.combo > 1) {
            this.hud.showBanner(`NEAR MISS x${this.combo}`, 'NITRO +', 'near', 520);
          }
        }
      }
    }
  }

  private onCrash(x: number, z: number): void {
    const result = this.player.takeHit();
    if (result === 'shield') return;
    this.shake = 1;
    this.hurtTimer = 0.55;
    this.speed *= 0.62;
    this.combo = 0;
    this.audio.crash();
    this.effects.burst(x, 1, z, 22, { color: 0xffb060, speed: 15, life: 0.6 });
    this.effects.burst(x, 0.8, z, 10, { color: 0xffffff, speed: 9, life: 0.35 });
    this.hud.setShield(this.player.hp, this.player.maxHp);
    if (result === 'dead') {
      this.gameOver('wrecked', 'You clipped too much metal.');
    } else {
      this.hud.showBanner('IMPACT', `${this.player.hp} ARMOUR LEFT`, 'danger', 800);
    }
  }

  private onDriftStart(): void {
    this.effects.burst(this.player.worldX, 0.25, this.playerZ, 6, {
      color: 0x9aa4b4,
      speed: 6,
      life: 0.4,
      spread: 1.8,
    });
  }

  private onNitroStart(): void {
    this.hud.showBanner('NITRO', 'BURNING', 'boost', 800);
    this.hud.setBoost(true);
    this.audio.nitroWhoosh();
    this.effects.burst(this.player.worldX, 0.6, this.playerZ + 1.5, 18, {
      color: 0x7fd4ff,
      speed: 12,
      life: 0.5,
    });
  }

  private gameOver(reason: RunStats['reason'], reasonText: string): void {
    if (this.state === 'over') return;
    this.state = 'over';
    this.player.alive = false;
    this.audio.setSiren(false);
    this.audio.update(0, false, false);
    this.hud.setPolice(false);
    this.hud.setBoost(false);
    this.shake = 1.4;
    this.effects.burst(this.player.worldX, 1, this.playerZ, 34, {
      color: 0xffa040,
      speed: 18,
      life: 0.9,
      spread: 1.4,
    });
    const finalScore = Math.floor(this.score);
    const isBest = finalScore > this.best;
    if (isBest) {
      this.best = finalScore;
      localStorage.setItem(STORAGE_KEY, String(this.best));
    }
    const stats: RunStats = {
      score: finalScore,
      distance: this.distance,
      coins: this.coinCount,
      best: this.best,
      isBest,
      reason,
      reasonText,
      biome: BIOMES[this.biomeIndex % BIOMES.length]?.name ?? '',
    };
    // Let the crash animation breathe before the panel lands.
    window.setTimeout(() => {
      if (this.state === 'over') this.hud.showGame(stats);
    }, 620);
  }

  // ------------------------------------------------------------------ biomes
  private applyBiome(index: number, immediate: boolean): void {
    const biome = BIOMES[index % BIOMES.length];
    if (!biome) return;
    const first = this.biomeIndex === -1;
    this.biomeIndex = index;

    this.ribbon.setBiome(biome);
    this.props.setBiome(biome, this.playerZ);

    this.env.target.sky.set(biome.sky);
    this.env.target.fog.set(biome.fog);
    this.env.target.ambient.set(biome.ambient);
    this.env.target.sun.set(biome.sun);
    this.env.target.ambientIntensity = biome.ambientIntensity;
    this.env.target.sunIntensity = biome.sunIntensity;
    this.env.target.sunHeight = biome.sunHeight;
    this.env.target.fogNear = biome.fogNear;
    this.env.target.fogFar = biome.fogFar;

    if (immediate || first) {
      this.env.sky.copy(this.env.target.sky);
      this.env.fog.copy(this.env.target.fog);
      this.env.ambient.copy(this.env.target.ambient);
      this.env.sun.copy(this.env.target.sun);
    }
    this.tunnel.visible = biome.tunnel;

    if (!immediate && !first) {
      const loop = Math.floor(index / BIOMES.length);
      this.hud.showBanner(
        biome.name,
        loop > 0 ? `${biome.subtitle} · LOOP ${loop + 1}` : biome.subtitle,
        '',
        1500,
      );
    }
  }

  private lerpEnvironment(dt: number): void {
    const k = Math.min(1, dt * 1.6);
    this.env.sky.lerp(this.env.target.sky, k);
    this.env.fog.lerp(this.env.target.fog, k);
    this.env.ambient.lerp(this.env.target.ambient, k);
    this.env.sun.lerp(this.env.target.sun, k);

    const fog = this.scene.fog as THREE.Fog;
    fog.color.copy(this.env.fog);
    fog.near += (this.env.target.fogNear - fog.near) * k;
    fog.far += (this.env.target.fogFar - fog.far) * k;
    this.scene.background = this.env.sky;

    this.ambient.color.copy(this.env.ambient);
    this.ambient.intensity +=
      (this.env.target.ambientIntensity - this.ambient.intensity) * k;
    this.sun.color.copy(this.env.sun);
    this.sun.intensity += (this.env.target.sunIntensity - this.sun.intensity) * k;
    this.sun.position.set(-60, 20 + this.env.target.sunHeight * 90, 40);
  }

  // ----------------------------------------------------------------- render
  private render(dt: number): void {
    this.lerpEnvironment(dt);
    this.ribbon.update(this.playerZ);
    if (this.state === 'playing' || this.state === 'over') this.props.update(this.playerZ);

    const pz = this.playerZ;
    const px = this.player.x; // lane offset from the centreline
    const pWorldX = curveX(pz) + px;

    // contact shadow
    this.shadow.position.set(pWorldX, 0.05, pz + 0.1);
    const shadowScale = 1 - Math.min(0.5, this.player.y * 0.2);
    this.shadow.scale.set(shadowScale, 1, shadowScale);

    // tunnel shell slabs: the first one straddles the camera
    if (this.tunnel.visible) {
      this.tunnel.children.forEach((slab, i) => {
        const z = pz + 8 - i * 60;
        slab.position.set(curveX(z), 6.5, z);
      });
    }

    // Camera: rides the centreline behind the car, mirroring most of its
    // lateral position so lane changes read as movement rather than a pan.
    const camZ = pz + CAM_BACK;
    const camX = curveX(camZ) + px * CAM_FOLLOW;
    const shakeAmount = this.shake * 0.55;
    this.camera.position.x += (camX - this.camera.position.x) * Math.min(1, dt * 11);
    this.camera.position.y = CAM_HEIGHT + this.player.y * 0.3 + (Math.random() - 0.5) * shakeAmount;
    this.camera.position.z = camZ;

    this.camera.lookAt(
      curveX(pz + CAM_LOOK_AHEAD) + px,
      CAM_LOOK_HEIGHT + this.player.y * 0.5,
      pz + CAM_LOOK_AHEAD,
    );
    const roll = -curveSlope(pz) * 0.55 + (px > 0 ? 0.01 : -0.01);
    this.camera.rotateZ(roll + (Math.random() - 0.5) * shakeAmount * 0.05);

    const speedRatio = this.state === 'playing' ? Math.min(1, this.speed / MAX_SPEED) : 0.3;
    const targetFov = 60 + speedRatio * 9 + (this.player.nitroActive ? 7 : 0);
    this.camera.fov += (targetFov - this.camera.fov) * Math.min(1, dt * 4);
    this.camera.updateProjectionMatrix();

    const intensity = this.player.nitroActive
      ? 1
      : Math.max(0, speedRatio - 0.55) / 0.45;
    this.speedLines.update(dt, pz, curveX(pz) + px * 0.4, intensity);

    // Nitro trail sparks
    if (this.player.nitroActive && Math.random() < dt * 40) {
      this.effects.burst(px, 0.5, pz + 2.4, 1, {
        color: 0x7fd4ff,
        speed: 4,
        life: 0.3,
        size: 0.7,
      });
    }

    this.renderer.render(this.scene, this.camera);
  }

  /**
   * Dev helper: fast-forward the run so a given biome / difficulty band can be
   * inspected without playing there first. Used by tools/probe.mjs.
   */
  debugSkip(metres: number): void {
    this.distance = Math.max(0, metres);
    this.playerZ = -this.distance;
    const index = Math.floor(this.distance / BIOME_LENGTH);
    this.speed = START_SPEED + (MAX_SPEED - START_SPEED) * Math.min(1, this.distance / 5200);
    this.player.reset();
    this.player.nitro = 100;
    this.applyBiome(index, false);
    this.traffic.reset(this.playerZ);
    this.coins.reset(this.playerZ);
    this.props.setBiome(BIOMES[index % BIOMES.length] as (typeof BIOMES)[number], this.playerZ);
    this.biomeIndex = index;
  }

  /** Dev helper: current biome id, for tooling. */
  debugBiomeName(): string {
    const n = BIOMES.length;
    return BIOMES[((this.biomeIndex % n) + n) % n]?.id ?? '?';
  }

  /**
   * Dev helper: drop a specific hazard into a lane so individual mechanics
   * (jump, duck, ramp, crash) can be exercised in isolation.
   */
  debugSpawn(
    kind: string,
    lane = this.player.lane,
    ahead = 60,
    isVehicle = false,
    vehicleSpeed?: number,
  ): void {
    this.traffic.debugSpawn(kind as never, lane, ahead, this.playerZ, isVehicle, vehicleSpeed);
  }

  /**
   * Dev helper: place a pickup `ahead` metres in front of the player, ignoring
   * lane-occupancy hints. Takes a forward distance, not a world Z — the caller
   * should not have to know the sign convention of the player's axis.
   */
  debugSpawnPickup(kind: string, lane = this.player.lane, ahead = 14, y = 1.1): void {
    this.coins.spawnAt(kind as never, lane, this.playerZ - ahead, y);
  }

  /**
   * Dev helper: advance the simulation deterministically, independent of the
   * render loop. Headless/software rendering can drop to a few frames per
   * second, which makes wall-clock-driven tests useless; this lets tests step
   * the sim at a fixed rate and assert on exact outcomes.
   */
  debugStep(frames = 1, dt = 1 / 60): void {
    for (let i = 0; i < frames; i++) {
      if (this.state === 'playing') this.step(dt);
    }
  }

  /** Dev helper: inject an action exactly as the input layer would. */
  debugAction(action: Action): void {
    this.onAction(action);
  }

  /** Dev helper: stop every spawner so a test owns the world. */
  debugFreezeSpawners(): void {
    this.traffic.freeze();
    this.coins.freeze();
    this.props.freeze();
  }

  /** Dev helper: pin the road speed, so tests are not at the mercy of the ramp. */
  debugSetSpeed(speed: number): void {
    this.speed = speed;
  }

  /** Dev helper: reset the car to a known lane with full armour. */
  debugResetPlayer(lane = 1): void {
    this.player.hp = this.player.maxHp;
    this.player.lane = lane;
    this.player.x = laneX(lane);
    this.player.targetX = laneX(lane);
    this.player.y = 0;
    this.player.vy = 0;
    this.player.airborne = false;
    this.player.slideTimer = 0;
    this.player.sliding = false;
    this.player.nitro = 0;
    this.player.invincible = 0;
    this.player.alive = true;
  }

  dispose(): void {
    cancelAnimationFrame(this.raf);
    window.removeEventListener('resize', this.onResize);
    document.removeEventListener('visibilitychange', this.onVisibility);
    this.input.dispose();
    this.audio.dispose();
    this.ribbon.dispose();
    this.props.dispose();
    this.traffic.dispose();
    this.coins.dispose();
    this.player.dispose();
    this.effects.dispose();
    this.rings.dispose();
    this.speedLines.dispose();
    this.renderer.dispose();
  }
}
