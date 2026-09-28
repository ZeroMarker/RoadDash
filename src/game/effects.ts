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
 * Soft round particle sprite.
 *
 * THREE.PointsMaterial with no map draws hard squares, which read as debris
 * rather than sparks — very obvious at close range next to the car. A small
 * radial-gradient canvas texture fixes it for a few hundred bytes.
 */
function sparkTexture(): THREE.Texture {
  const size = 64;
  const canvas = document.createElement('canvas');
  canvas.width = size;
  canvas.height = size;
  const ctx = canvas.getContext('2d');
  if (ctx) {
    const gradient = ctx.createRadialGradient(size / 2, size / 2, 0, size / 2, size / 2, size / 2);
    // Bright core with a soft falloff, plus alpha fading to nothing at the rim
    // so the square edge never shows.
    gradient.addColorStop(0, 'rgba(255,255,255,1)');
    gradient.addColorStop(0.35, 'rgba(255,255,255,0.75)');
    gradient.addColorStop(0.7, 'rgba(255,255,255,0.18)');
    gradient.addColorStop(1, 'rgba(255,255,255,0)');
    ctx.fillStyle = gradient;
    ctx.fillRect(0, 0, size, size);
  }
  const texture = new THREE.CanvasTexture(canvas);
  texture.needsUpdate = true;
  return texture;
}

/**
 * One pooled point system used for sparks, coin pops and the nitro trail.
 * Cheap enough to leave running on phones.
 */
export class Effects {
  readonly points: THREE.Points;
  private positions: Float32Array;
  private colors: Float32Array;
  private sizes: Float32Array;
  private particles: Particle[] = [];
  private geoRef: THREE.BufferGeometry;
  private texture: THREE.Texture;
  private material: THREE.ShaderMaterial;

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

    this.sizes = new Float32Array(MAX_PARTICLES);
    for (let i = 0; i < MAX_PARTICLES; i++) this.sizes[i] = 0.4;

    this.geoRef = new THREE.BufferGeometry();
    this.geoRef.setAttribute('position', new THREE.BufferAttribute(this.positions, 3));
    this.geoRef.setAttribute('color', new THREE.BufferAttribute(this.colors, 3));
    this.geoRef.setAttribute('size', new THREE.BufferAttribute(this.sizes, 1));
    this.geoRef.boundingSphere = new THREE.Sphere(new THREE.Vector3(), 1e6);

    this.texture = sparkTexture();
    // A tiny custom shader rather than PointsMaterial: we need a per-particle
    // size, and PointsMaterial exposes only one global value. Coin sparks want
    // to be small and tight; crash debris wants to be large.
    this.material = new THREE.ShaderMaterial({
      uniforms: {
        uMap: { value: this.texture },
        uScale: { value: 620 },
      },
      vertexShader: `
        attribute float size;
        varying vec3 vColor;
        uniform float uScale;
        void main() {
          vColor = color;
          vec4 mv = modelViewMatrix * vec4(position, 1.0);
          gl_PointSize = size * (uScale / max(0.001, -mv.z));
          gl_Position = projectionMatrix * mv;
        }
      `,
      fragmentShader: `
        uniform sampler2D uMap;
        varying vec3 vColor;
        void main() {
          float a = texture2D(uMap, gl_PointCoord).a;
          if (a < 0.01) discard;
          gl_FragColor = vec4(vColor, a);
        }
      `,
      vertexColors: true,
      transparent: true,
      depthWrite: false,
      blending: THREE.AdditiveBlending,
    });

    this.points = new THREE.Points(this.geoRef, this.material);
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
      // Shrink as it fades, so sparks read as dissipating embers.
      this.sizes[i] = p.size * (0.35 + t * 0.65);
      col[i * 3] = p.color.r * t;
      col[i * 3 + 1] = p.color.g * t;
      col[i * 3 + 2] = p.color.b * t;
    }
    this.geoRef.attributes.position.needsUpdate = true;
    this.geoRef.attributes.color.needsUpdate = true;
    this.geoRef.attributes.size.needsUpdate = true;
  }

  clear(): void {
    for (const p of this.particles) p.active = false;
  }

  dispose(): void {
    this.geoRef.dispose();
    this.texture.dispose();
    this.material.dispose();
    this.points.parent?.remove(this.points);
  }
}

/**
 * Soft annular gradient for the pickup shockwave: transparent at the centre and
 * at the rim, brightest in a band just inside the edge. This is what stops the
 * ring reading as a solid disc under additive blending.
 */
function ringTexture(): THREE.Texture {
  const size = 128;
  const canvas = document.createElement('canvas');
  canvas.width = size;
  canvas.height = size;
  const ctx = canvas.getContext('2d');
  if (ctx) {
    const image = ctx.createImageData(size, size);
    const centre = size / 2;
    for (let y = 0; y < size; y++) {
      for (let x = 0; x < size; x++) {
        const dx = (x + 0.5 - centre) / centre;
        const dy = (y + 0.5 - centre) / centre;
        const r = Math.sqrt(dx * dx + dy * dy);
        // Gaussian band centred just inside the rim.
        const band = Math.exp(-Math.pow((r - 0.74) / 0.2, 2));
        const inside = r <= 0.98 ? 1 : 0;
        const alpha = Math.max(0, Math.min(1, band * inside));
        const i = (y * size + x) * 4;
        image.data[i] = 255;
        image.data[i + 1] = 255;
        image.data[i + 2] = 255;
        image.data[i + 3] = Math.round(alpha * 255);
      }
    }
    ctx.putImageData(image, 0, 0);
  }
  const texture = new THREE.CanvasTexture(canvas);
  texture.needsUpdate = true;
  return texture;
}

/**
 * Pickup feedback: an expanding shockwave ring, oriented to face the camera.
 *
 * A pool of rings rather than one ring per pickup — coin runs are dense enough
 * that several can be alive at once (a magnet sweep can pop six in a frame),
 * and allocating a mesh per collection is exactly the kind of thing that
 * turns into a GC hitch once the player is chaining a 40-coin line.
 */
export class PickupRings {
  readonly group = new THREE.Group();
  private pool: Ring[] = [];

  constructor(
    scene: THREE.Scene,
    private maxRings = 24,
  ) {
    // A unit ring scaled per-use. A bare RingGeometry has a hard inner and
    // outer edge, which under additive blending fills as a flat disc; the
    // texture carries the falloff so it reads as a wavefront instead.
    const geometry = new THREE.PlaneGeometry(2, 2);
    const material = new THREE.MeshBasicMaterial({
      map: ringTexture(),
      color: 0xffffff,
      transparent: true,
      opacity: 0,
      side: THREE.DoubleSide,
      depthWrite: false,
      blending: THREE.AdditiveBlending,
    });

    for (let i = 0; i < this.maxRings; i++) {
      const mesh = new THREE.Mesh(geometry, material.clone());
      mesh.visible = false;
      mesh.frustumCulled = false;
      this.group.add(mesh);
      this.pool.push({ mesh, life: 0, maxLife: 1, size: 1, spin: 0 });
    }
    scene.add(this.group);
  }

  /**
   * @param camera the rings billboard toward this; without it they read as flat
   *   discs lying in the road, which looks like a bug rather than a flash.
   */
  pop(
    x: number,
    y: number,
    z: number,
    color: number,
    size = 1,
    life = 0.34,
    camera?: THREE.Camera,
  ): void {
    const ring = this.pool.find((r) => r.life <= 0) ?? this.pool[0];
    if (!ring) return;
    ring.life = life;
    ring.maxLife = life;
    ring.size = size;
    ring.spin = (Math.random() - 0.5) * 1.5;
    ring.mesh.visible = true;
    ring.mesh.position.set(x, y, z);
    ring.mesh.rotation.set(0, 0, Math.random() * Math.PI);
    (ring.mesh.material as THREE.MeshBasicMaterial).color.set(color);
    if (camera) ring.mesh.quaternion.copy(camera.quaternion);
  }

  update(dt: number): void {
    for (const r of this.pool) {
      if (r.life <= 0) continue;
      r.life -= dt;
      if (r.life <= 0) {
        r.mesh.visible = false;
        continue;
      }
      // Ease-out expansion: fast at first, settling as it fades, so the ring
      // reads as an impact rather than a linear zoom.
      const t = 1 - r.life / r.maxLife;
      const grow = 1 - Math.pow(1 - t, 3);
      const scale = (0.35 + grow * 2.4) * r.size;
      r.mesh.scale.setScalar(scale);
      r.mesh.rotation.z += r.spin * dt;
      const material = r.mesh.material as THREE.MeshBasicMaterial;
      // Fade on a curve: hold briefly at full strength, then drop away, so the
      // ring registers as a flash rather than a dim smudge on the first frame.
      material.opacity = Math.pow(1 - t, 1.8) * 0.95;
    }
  }

  clear(): void {
    for (const r of this.pool) {
      r.life = 0;
      r.mesh.visible = false;
    }
  }

  dispose(): void {
    // The geometry and base material are shared by every ring in the pool;
    // disposing them per-mesh would free the same resource repeatedly.
    const first = this.group.children[0] as THREE.Mesh | undefined;
    first?.geometry.dispose();
    const base = first?.material as THREE.MeshBasicMaterial | undefined;
    base?.map?.dispose();
    for (const mesh of this.group.children) {
      const material = (mesh as THREE.Mesh).material;
      if (Array.isArray(material)) material.forEach((m) => m.dispose());
      else material.dispose();
    }
    this.group.parent?.remove(this.group);
  }
}

interface Ring {
  mesh: THREE.Mesh;
  life: number;
  maxLife: number;
  size: number;
  spin: number;
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
