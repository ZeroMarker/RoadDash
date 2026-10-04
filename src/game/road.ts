import * as THREE from 'three';
import {
  GROUND_HALF,
  LANE_W,
  ROAD_HALF,
  ROAD_ROWS,
  ROW_LEN,
  curveX,
  type Biome,
} from './config';

/** Vertical stacking of the flat quads that make up the track surface. */
const Y_GROUND = 0;
const Y_SHOULDER = 0.008;
const Y_ROAD = 0.016;
const Y_EDGE = 0.024;
const Y_DASH = 0.024;

const SHOULDER_W = 2.6;
const VERGE_W = 16;

/** Horizontal strip of the road cross-section, tagged with its colour role. */
type Band = { x0: number; x1: number; y: number; role: ColorRole };
type ColorRole = 'road' | 'edge' | 'ground' | 'shoulder' | 'far' | 'dash' | 'hidden';

const MARKER_W = 0.11;

/**
 * The whole road surface (asphalt, shoulders, verge, markings) is one
 * non-indexed buffer that gets rewritten every frame from the centreline
 * function. One draw call, exact curvature, zero segment recycling.
 */
export class RoadRibbon {
  readonly mesh: THREE.Mesh;
  private positions: Float32Array;
  private colors: Float32Array;
  private bands: Band[] = [];
  private palette: Biome | null = null;
  private tmpColor = new THREE.Color();
  private lastPlayerZ: number | null = null;

  constructor() {
    this.bands = buildBands();
    const pairs = ROAD_ROWS - 1;
    const quadsPerPair = this.bands.length + 2; // one slot per dashed lane divider
    const vertexCount = pairs * quadsPerPair * 6;

    this.positions = new Float32Array(vertexCount * 3);
    this.colors = new Float32Array(vertexCount * 3);

    const geo = new THREE.BufferGeometry();
    geo.setAttribute(
      'position',
      new THREE.BufferAttribute(this.positions, 3).setUsage(THREE.DynamicDrawUsage),
    );
    geo.setAttribute('color', new THREE.BufferAttribute(this.colors, 3));

    const normals = new Float32Array(vertexCount * 3);
    for (let i = 0; i < vertexCount; i++) normals[i * 3 + 1] = 1;
    geo.setAttribute('normal', new THREE.BufferAttribute(normals, 3));

    // The ribbon is rebuilt each frame; a bounding sphere would only cost time.
    geo.boundingSphere = new THREE.Sphere(new THREE.Vector3(), 1e6);

    const mat = new THREE.MeshLambertMaterial({ vertexColors: true });
    this.mesh = new THREE.Mesh(geo, mat);
    this.mesh.frustumCulled = false;
    this.mesh.renderOrder = -1;
  }

  setBiome(biome: Biome): void {
    this.palette = biome;
    this.writeColors();
  }

  /** Rewrite the strip positions for a player anchored at `playerZ`. */
  update(playerZ: number): void {
    // Menus and pause keep the same world anchor: avoid rebuilding and uploading
    // the entire road buffer while the camera and environment settle.
    if (playerZ === this.lastPlayerZ) return;
    this.lastPlayerZ = playerZ;
    const pos = this.positions;
    const startZ = playerZ + ROW_LEN * 2;
    let p = 0;

    for (let row = 0; row < ROAD_ROWS - 1; row++) {
      const z0 = startZ - row * ROW_LEN;
      const z1 = z0 - ROW_LEN;
      const x0 = curveX(z0);
      const x1 = curveX(z1);

      for (const band of this.bands) {
        p = quad(
          pos,
          p,
          x0 + band.x0,
          band.y,
          z0,
          x0 + band.x1,
          band.y,
          z0,
          x1 + band.x1,
          band.y,
          z1,
          x1 + band.x0,
          band.y,
          z1,
        );
      }

      // Two dashed lane dividers; the dash cycle is keyed to world distance.
      const dashOn = ((-z0) % 13 + 13) % 13 < 6.8;
      for (let sign = -1; sign <= 1; sign += 2) {
        const cx0 = x0 + (sign * LANE_W) / 2;
        const cx1 = x1 + (sign * LANE_W) / 2;
        if (dashOn) {
          p = quad(
            pos,
            p,
            cx0 - MARKER_W,
            Y_DASH,
            z0,
            cx0 + MARKER_W,
            Y_DASH,
            z0,
            cx1 + MARKER_W,
            Y_DASH,
            z1,
            cx1 - MARKER_W,
            Y_DASH,
            z1,
          );
        } else {
          // Collapse to a single point below the world: a zero-area triangle.
          p = degenerate(pos, p, cx0, -400, z0);
        }
      }
    }

    this.mesh.geometry.attributes.position.needsUpdate = true;
  }

  /** Bank the whole strip so hard sweepers feel like a real cambered road. */
  private writeColors(): void {
    const bio = this.palette;
    if (!bio) return;
    const col = this.colors;
    const road = new THREE.Color(bio.road);
    const edge = new THREE.Color(bio.edge);
    const line = new THREE.Color(bio.line);
    const ground = new THREE.Color(bio.ground);
    const shoulder = road.clone().multiplyScalar(0.82);
    const far = ground.clone().multiplyScalar(0.86);
    const dash = line;

    const byRole: Record<ColorRole, THREE.Color> = {
      road,
      edge,
      dash,
      ground,
      shoulder,
      far,
      hidden: road,
    };

    let c = 0;
    for (let row = 0; row < ROAD_ROWS - 1; row++) {
      for (const band of this.bands) {
        this.tmpColor.copy(byRole[band.role]);
        c = colorQuad(col, c, this.tmpColor);
      }
      for (let i = 0; i < 2; i++) c = colorQuad(col, c, dash);
    }
    col.fill(0, c);
    this.mesh.geometry.attributes.color.needsUpdate = true;
  }

  dispose(): void {
    this.mesh.geometry.dispose();
    (this.mesh.material as THREE.Material).dispose();
  }
}

function buildBands(): Band[] {
  const bands: Band[] = [
    { x0: -ROAD_HALF - GROUND_HALF, x1: -ROAD_HALF - VERGE_W, y: Y_GROUND, role: 'far' },
    { x0: -ROAD_HALF - VERGE_W, x1: -ROAD_HALF - SHOULDER_W, y: Y_GROUND, role: 'ground' },
    { x0: -ROAD_HALF - SHOULDER_W, x1: -ROAD_HALF, y: Y_SHOULDER, role: 'shoulder' },
    { x0: -ROAD_HALF, x1: ROAD_HALF, y: Y_ROAD, role: 'road' },
    { x0: ROAD_HALF, x1: ROAD_HALF + SHOULDER_W, y: Y_SHOULDER, role: 'shoulder' },
    { x0: ROAD_HALF + SHOULDER_W, x1: ROAD_HALF + VERGE_W, y: Y_GROUND, role: 'ground' },
    { x0: ROAD_HALF + VERGE_W, x1: GROUND_HALF + ROAD_HALF, y: Y_GROUND, role: 'far' },
    { x0: -ROAD_HALF, x1: -ROAD_HALF + 0.26, y: Y_EDGE, role: 'edge' },
    { x0: ROAD_HALF - 0.26, x1: ROAD_HALF, y: Y_EDGE, role: 'edge' },
  ];
  return bands;
}

function quad(
  out: Float32Array,
  p: number,
  ax: number,
  ay: number,
  az: number,
  bx: number,
  by: number,
  bz: number,
  cx: number,
  cy: number,
  cz: number,
  dx: number,
  dy: number,
  dz: number,
): number {
  out[p++] = ax;
  out[p++] = ay;
  out[p++] = az;
  out[p++] = bx;
  out[p++] = by;
  out[p++] = bz;
  out[p++] = cx;
  out[p++] = cy;
  out[p++] = cz;
  out[p++] = ax;
  out[p++] = ay;
  out[p++] = az;
  out[p++] = cx;
  out[p++] = cy;
  out[p++] = cz;
  out[p++] = dx;
  out[p++] = dy;
  out[p++] = dz;
  return p;
}

function degenerate(out: Float32Array, p: number, x: number, y: number, z: number): number {
  for (let i = 0; i < 6; i++) {
    out[p++] = x;
    out[p++] = y;
    out[p++] = z;
  }
  return p;
}

function colorQuad(out: Float32Array, p: number, c: THREE.Color): number {
  for (let i = 0; i < 6; i++) {
    out[p++] = c.r;
    out[p++] = c.g;
    out[p++] = c.b;
  }
  return p;
}
