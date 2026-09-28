import * as THREE from 'three';

const MAX_PARTICLES = 160;

interface Particle {
  x: number;
  y: number;
  z: number;
  vx: number;
  vy: number;
  vz: number;
  life: number;
  maxLife: number;
  size: number;
  color: THREE.Color;
  active: boolean;
}

/**
 * One pooled instanced quad system used for sparks, coin pops and the nitro
 * trail. Cheap enough to leave running on phones.
 */
export class Effects {
  readonly points: THREE.Points;
  private positions: Float32Array;
  private colors: Float32Array;
  private particles: Particle[] = [];
  private geoRef: THREE.BufferGeometry;

  constructor(scene: THREE.Scene) {
    this.positions = new Float32Array(MAX_PARTICLES * 3);
    this.colors = new Float32Array(MAX_PARTICLES * 3);
    for (let i = 0; i < MAX_PARTICLES; i++) {
      this.particles.push({
        x: 0,
        y: -9999,
        z: 0,
        vx: 0,
        vy: 0,
        vz: 0,
        life: 0,
        maxLife: 1,
        size: 1,
        color: new THREE.Color(),
        active: false,
      });
      this.positions[i * 3 + 1] = -9999;
    }

    this.geoRef = new THREE.BufferGeometry();
    this.geoRef.setAttribute('position', new THREE.BufferAttribute(this.positions, 3));
    this.geoRef.setAttribute('color', new THREE.BufferAttribute(this.colors, 3));
    this.geoRef.boundingSphere = new THREE.Sphere(new THREE.Vector3(), 1e6);

    const material = new THREE.PointsMaterial({
      size: 0.55,
      sizeAttenuation: true,
      vertexColors: true,
      transparent: true,
      opacity: 0.95,
      depthWrite: false,
      blending: THREE.AdditiveBlending,
    });

    this.points = new THREE.Points(this.geoRef, material);
    this.points.frustumCulled = false;
    scene.add(this.points);
  }

  burst(
    x: number,
    y: number,
    z: number,
    count: number,
    options: {
      color: number;
      speed?: number;
      spread?: number;
      life?: number;
      size?: number;
      upward?: number;
    },
  ): void {
    const speed = options.speed ?? 12;
    const spread = options.spread ?? 1;
    const life = options.life ?? 0.6;
    const upward = options.upward ?? 0.5;
    const color = new THREE.Color(options.color);
    let spawned = 0;
    for (const p of this.particles) {
      if (p.active) continue;
      const theta = Math.random() * Math.PI * 2;
      const phi = Math.random() * Math.PI * 0.5;
      const s = speed * (0.4 + Math.random() * 0.8);
      p.active = true;
      p.x = x;
      p.y = y;
      p.z = z;
      p.vx = Math.cos(theta) * Math.sin(phi) * s * spread;
      p.vy = (Math.cos(phi) * s * 0.7 + upward * s) * 0.6;
      p.vz = Math.sin(theta) * Math.sin(phi) * s * spread - speed * 0.4;
      p.life = life * (0.7 + Math.random() * 0.6);
      p.maxLife = p.life;
      p.size = options.size ?? 1;
      p.color.copy(color).offsetHSL(0, 0, (Math.random() - 0.5) * 0.3);
      if (++spawned >= count) break;
    }
  }

  update(dt: number): void {
    const pos = this.positions;
    const col = this.colors;
    for (let i = 0; i < this.particles.length; i++) {
      const p = this.particles[i] as Particle;
      if (!p.active) {
        pos[i * 3 + 1] = -9999;
        continue;
      }
      p.life -= dt;
      if (p.life <= 0) {
        p.active = false;
        pos[i * 3 + 1] = -9999;
        continue;
      }
      p.vy -= 22 * dt;
      p.x += p.vx * dt;
      p.y += p.vy * dt;
      p.z += p.vz * dt;
      if (p.y < 0.05) {
        p.y = 0.05;
        p.vy *= -0.35;
        p.vx *= 0.7;
        p.vz *= 0.7;
      }
      const t = p.life / p.maxLife;
      pos[i * 3] = p.x;
      pos[i * 3 + 1] = p.y;
      pos[i * 3 + 2] = p.z;
      col[i * 3] = p.color.r * t;
      col[i * 3 + 1] = p.color.g * t;
      col[i * 3 + 2] = p.color.b * t;
    }
    this.geoRef.attributes.position.needsUpdate = true;
    this.geoRef.attributes.color.needsUpdate = true;
  }

  clear(): void {
    for (const p of this.particles) p.active = false;
  }

  dispose(): void {
    this.geoRef.dispose();
    (this.points.material as THREE.Material).dispose();
    this.points.parent?.remove(this.points);
  }
}

/**
 * Speed streaks: a ring of thin quads flying past the camera when the nitro
 * is burning. Pure eye candy, but it sells the "too fast" feeling.
 */
export class SpeedLines {
  readonly mesh: THREE.LineSegments;
  private positions: Float32Array;
  private count: number;
  private data: { x: number; y: number; z: number; speed: number }[] = [];

  constructor(scene: THREE.Scene, count = 70) {
    this.count = count;
    this.positions = new Float32Array(count * 6);
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.BufferAttribute(this.positions, 3));
    g.boundingSphere = new THREE.Sphere(new THREE.Vector3(), 1e6);
    const m = new THREE.LineBasicMaterial({
      color: 0xffffff,
      transparent: true,
      opacity: 0,
      depthWrite: false,
      blending: THREE.AdditiveBlending,
    });
    this.mesh = new THREE.LineSegments(g, m);
    this.mesh.frustumCulled = false;
    for (let i = 0; i < count; i++) {
      const angle = Math.random() * Math.PI * 2;
      const radius = 6 + Math.random() * 22;
      this.data.push({
        x: Math.cos(angle) * radius,
        y: 1 + Math.sin(angle) * radius * 0.4,
        z: -Math.random() * 90,
        speed: 90 + Math.random() * 130,
      });
    }
    scene.add(this.mesh);
  }

  update(dt: number, playerZ: number, centerX: number, intensity: number): void {
    const material = this.mesh.material as THREE.LineBasicMaterial;
    material.opacity = Math.min(0.55, intensity * 0.55);
    this.mesh.visible = intensity > 0.02;
    if (!this.mesh.visible) return;
    for (let i = 0; i < this.count; i++) {
      const d = this.data[i] as { x: number; y: number; z: number; speed: number };
      d.z += d.speed * intensity * dt;
      if (d.z > 20) {
        d.z = -90 - Math.random() * 40;
        const angle = Math.random() * Math.PI * 2;
        const radius = 6 + Math.random() * 22;
        d.x = Math.cos(angle) * radius;
        d.y = 1 + Math.sin(angle) * radius * 0.4;
      }
      const p = i * 6;
      this.positions[p] = centerX + d.x;
      this.positions[p + 1] = d.y;
      this.positions[p + 2] = playerZ + d.z;
      this.positions[p + 3] = centerX + d.x;
      this.positions[p + 4] = d.y;
      this.positions[p + 5] = playerZ + d.z - 3 - intensity * 8;
    }
    (this.mesh.geometry.attributes.position as THREE.BufferAttribute).needsUpdate = true;
  }

  dispose(): void {
    (this.mesh.material as THREE.Material).dispose();
    this.mesh.parent?.remove(this.mesh);
  }
}
