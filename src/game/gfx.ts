import * as THREE from 'three';

/**
 * Tiny shared geometry/material cache. Everything in the world is built from
 * low-poly primitives, so a handful of cached meshes covers the whole scene.
 */
const matCache = new Map<string, THREE.Material>();
const geoCache = new Map<string, THREE.BufferGeometry>();
const optionIds = new WeakMap<object, number>();
let nextOptionId = 0;

/** Keep object-valued options (such as textures) distinct without serialising them. */
function optionKey(value: unknown): unknown {
  if (value instanceof THREE.Color) return { color: value.getHex() };
  if (value !== null && typeof value === 'object') {
    let id = optionIds.get(value);
    if (id === undefined) {
      id = ++nextOptionId;
      optionIds.set(value, id);
    }
    return { ref: id };
  }
  return value;
}

export function mat(
  color: number,
  opts: Partial<THREE.MeshLambertMaterialParameters> = {},
): THREE.MeshLambertMaterial {
  const options = Object.entries(opts)
    .filter(([, value]) => value !== undefined)
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([name, value]) => [name, optionKey(value)]);
  const key = JSON.stringify([color, options]);
  let m = matCache.get(key) as THREE.MeshLambertMaterial | undefined;
  if (!m) {
    m = new THREE.MeshLambertMaterial({ color, ...opts });
    matCache.set(key, m);
  }
  return m;
}

export function geo<T extends THREE.BufferGeometry>(key: string, make: () => T): T {
  let g = geoCache.get(key) as T | undefined;
  if (!g) {
    g = make();
    geoCache.set(key, g);
  }
  return g;
}

export function box(
  w: number,
  h: number,
  d: number,
  color: number,
  opts: Partial<THREE.MeshLambertMaterialParameters> = {},
  key?: string,
): THREE.Mesh {
  // A part name alone is insufficient: each car has its own width. Unnamed
  // boxes also share geometry, so repeated scenery does not allocate buffers.
  const g = geo(`box:${key ?? ''}:${w}:${h}:${d}`, () => new THREE.BoxGeometry(w, h, d));
  return new THREE.Mesh(g, mat(color, opts));
}

export function cyl(
  rTop: number,
  rBottom: number,
  h: number,
  color: number,
  segments: number,
  key?: string,
): THREE.Mesh {
  const k = key ?? `c${rTop}_${rBottom}_${h}_${segments}`;
  const g = geo(k, () => new THREE.CylinderGeometry(rTop, rBottom, h, segments));
  return new THREE.Mesh(g, mat(color));
}

export function sphere(
  r: number,
  color: number,
  opts: Partial<THREE.MeshLambertMaterialParameters> = {},
  segments = 10,
): THREE.Mesh {
  const g = geo(`s${r}_${segments}`, () => new THREE.SphereGeometry(r, segments, Math.max(4, segments - 3)));
  return new THREE.Mesh(g, mat(color, opts));
}

export function disposeCaches(): void {
  for (const m of matCache.values()) m.dispose();
  for (const g of geoCache.values()) g.dispose();
  matCache.clear();
  geoCache.clear();
}
