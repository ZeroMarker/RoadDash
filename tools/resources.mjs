/** Resource/cache regressions; runs without a browser or a WebGL context. */
import assert from 'node:assert/strict';
import { fileURLToPath } from 'node:url';
import * as THREE from 'three';
import { createServer } from 'vite';

const server = await createServer({
  root: fileURLToPath(new URL('../', import.meta.url)),
  configFile: false,
  server: { middlewareMode: true },
  appType: 'custom',
});
let passed = 0;
const check = (name, test) => {
  test();
  passed++;
  console.log(`PASS  ${name}`);
};

try {
  const { box, mat, disposeCaches } = await server.ssrLoadModule('/src/game/gfx.ts');
  const { buildPlayerCar } = await server.ssrLoadModule('/src/game/carModel.ts');
  const { PropField } = await server.ssrLoadModule('/src/game/props.ts');
  const { CARS, BIOMES } = await server.ssrLoadModule('/src/game/config.ts');

  check('unnamed boxes reuse geometry across materials', () => {
    assert.equal(box(2, 3, 4, 0xff0000).geometry, box(2, 3, 4, 0x00ff00).geometry);
  });
  check('named parts retain their actual dimensions', () => {
    const narrow = box(2, 3, 4, 0xff0000, {}, 'body');
    const wide = box(3, 3, 4, 0xff0000, {}, 'body');
    assert.notEqual(narrow.geometry, wide.geometry);
    assert.equal(wide.geometry.parameters.width, 3);
    assert.equal(box(3, 3, 4, 0xff0000, {}, 'body').geometry, wide.geometry);
  });
  check('every selectable car has its specified chassis width', () => {
    for (const spec of CARS) {
      const rig = buildPlayerCar(spec);
      const chassis = rig.body.children[0];
      chassis.geometry.computeBoundingBox();
      const width = chassis.geometry.boundingBox.getSize(new THREE.Vector3()).x;
      assert.ok(Math.abs(width - 1.94 * spec.wide) < 1e-6, `${spec.name}: ${width}`);
    }
  });
  check('material reuse is independent of option order', () => {
    assert.equal(
      mat(0x272c35, { side: THREE.BackSide, opacity: 0.5, transparent: true }),
      mat(0x272c35, { transparent: true, opacity: 0.5, side: THREE.BackSide }),
    );
  });
  check('tunnel interiors keep their back-facing material', () => {
    const front = mat(0x272c35);
    const back = mat(0x272c35, { side: THREE.BackSide });
    assert.notEqual(front, back);
    assert.equal(front.side, THREE.FrontSide);
    assert.equal(back.side, THREE.BackSide);
  });
  check('depth and wireframe options cannot alias normal materials', () => {
    const normal = mat(0xabcdef);
    for (const options of [{ depthWrite: false }, { depthTest: false }, { wireframe: true }]) {
      const material = mat(0xabcdef, options);
      assert.notEqual(normal, material);
      for (const [name, value] of Object.entries(options)) assert.equal(material[name], value);
    }
  });
  check('texture references share only when they match', () => {
    const a = new THREE.Texture();
    const b = new THREE.Texture();
    assert.equal(mat(0xffffff, { map: a }), mat(0xffffff, { map: a }));
    assert.notEqual(mat(0xffffff, { map: a }), mat(0xffffff, { map: b }));
    a.dispose();
    b.dispose();
  });
  check('mutating a colour option selects the correct material', () => {
    const emissive = new THREE.Color(0xff0000);
    const red = mat(0xffffff, { emissive });
    emissive.setHex(0x00ff00);
    const green = mat(0xffffff, { emissive });
    assert.notEqual(red, green);
    assert.equal(red.emissive.getHex(), 0xff0000);
    assert.equal(green.emissive.getHex(), 0x00ff00);
  });

  let randomCalls = 0;
  const field = new PropField(new THREE.Scene(), () => {
    randomCalls++;
    return 0.25;
  });
  const biome = { ...BIOMES[0], props: [{ kind: 'streetLight', weight: 1, spacing: 18 }] };
  field.setBiome(biome, 0);
  for (let i = 0; i < 220; i++) field.spawn(-i * 18, biome);
  check('full prop field does not consume pooled objects or allocate models', () => {
    assert.equal(field.active.length, 220);
    const pool = field.pools.get('streetLight:0');
    const spare = new THREE.Group();
    pool.push(spare);
    const before = randomCalls;
    for (let i = 0; i < 100; i++) field.spawn(-5000 - i, biome);
    assert.equal(field.active.length, 220);
    assert.equal(pool.at(-1), spare);
    assert.equal(randomCalls, before);
    pool.pop();
  });
  check('freezing scenery stops spawning and preserves the pool', () => {
    field.freeze();
    const before = randomCalls;
    const pooled = [...field.pools.values()].reduce((n, pool) => n + pool.length, 0);
    for (let i = 0; i < 100; i++) field.update(-i * 100);
    assert.equal(field.active.length, 0);
    assert.equal(field.group.children.length, 0);
    assert.equal(randomCalls, before);
    assert.equal([...field.pools.values()].reduce((n, pool) => n + pool.length, 0), pooled);
  });
  check('resetting frozen scenery resumes spawning with cached geometry', () => {
    const geometry = box(2.4, 0.18, 0.18, 0x3a4048).geometry;
    field.reset();
    field.setBiome(biome, 0);
    field.update(0);
    assert.ok(field.active.length > 0);
    assert.equal(box(2.4, 0.18, 0.18, 0x3a4048).geometry, geometry);
  });
  field.dispose();
  disposeCaches();
  console.log(`\n${passed}/${passed} resource checks passed`);
} finally {
  await server.close();
}
