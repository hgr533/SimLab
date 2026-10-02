// v2.2 decor: beach, buffer strip, plaza and bike-path life. Render side only: it never touches
// the sim or its RNG (own hash-seeded RNG per chunk), so runs stay deterministic.
// Everything is instanced: one InstancedMesh per kit. Kits are filled per world chunk and
// recycled with the chunk streaming (only chunks inside the LOD0 range get decor, which is also
// where the benches, cafe chairs and sunbeds they use exist). Idle motion runs in the vertex
// shader (BOB / DECORWALK); only beach walkers, kids and bike-path riders get matrix updates.
// Bike path riders are decor only: the runner's lanes end at x = 3.5 m, the bike lane starts at
// x = 4.4 m, so the runner can never enter it and riders never collide with anyone.
import * as THREE from '../vendor/three.module.js';
import { CHUNK_LEN } from './config.js';
import { Builder, hex, mul, mix3 } from './geo.js';
import { makeRng, hash2 } from './rng.js';
import { bakedMaterial, U } from './materials.js';
import { personGeometry } from './props.js';

const L = CHUNK_LEN, VARIANTS = 6;
const SHIRTS = [0xe8473c, 0x2f7fd8, 0xf2c14e, 0x3fae6b, 0xffffff, 0x8a5cd6, 0xf08a5d, 0x1f2a44, 0xe86fa8, 0x46c2c9, 0xd9d2c0, 0x333333].map((h) => new THREE.Color(h));
const SKINS = [hex(0xc58c63), hex(0x8d5a3b), hex(0xe0b08a), hex(0x6b4430), hex(0xd9a27a)];
const SHORTS = hex(0x3b4250), HAIR = hex(0x2b1d14), SHOE = hex(0xeeeeee), WHITE = [1, 1, 1];
const WOOD = hex(0x8a6038), METAL = hex(0x3a3d44), TIRE = hex(0x1e1e22), GREEN = hex(0x3f7f3a);
const _o = new THREE.Object3D();
const _hide = new THREE.Matrix4().makeScale(0, 0, 0).setPosition(0, -1000, 0);

// sand height, same formula as the chunk ground (world.js)
export function sandY(x, zl, variant) {
  return -0.25 - Math.max(0, -x - 5) * 0.016 + 0.06 * Math.sin(x * 0.7) * Math.sin(zl * 0.5 + variant);
}

// ---------------- figure builders (all face -z at the origin) ----------------
function seated(b, seatY, t, skin) {
  b.sway = 0; b.tint = 0;
  for (const side of [-1, 1]) {
    const lx = side * 0.1;
    b.box(lx, seatY - 0.07, -0.2, 0.15, 0.15, 0.44, SHORTS);
    b.box(lx, 0.05, -0.41, 0.11, Math.max(0.05, seatY - 0.1), 0.12, skin, { skipBottom: true });
    b.box(lx, 0, -0.46, 0.12, 0.07, 0.22, SHOE);
  }
  b.box(0, seatY - 0.08, 0.02, 0.36, 0.2, 0.24, SHORTS);
  b.sway = 1; b.tint = t;
  b.box(0, seatY + 0.1, 0.04, 0.4, 0.46, 0.22, WHITE, { skipBottom: true });
  for (const side of [-1, 1]) {
    b.tint = t; b.box(side * 0.24, seatY + 0.3, 0.03, 0.09, 0.28, 0.1, WHITE, { skipBottom: true });
    b.tint = 0; b.box(side * 0.22, seatY + 0.12, -0.12, 0.08, 0.08, 0.3, skin);
  }
  b.box(0, seatY + 0.56, 0.04, 0.1, 0.06, 0.1, skin, { skipBottom: true });
  b.box(0, seatY + 0.62, 0.04, 0.2, 0.22, 0.21, skin, { skipBottom: true });
  b.box(0, seatY + 0.8, 0.06, 0.22, 0.08, 0.23, HAIR);
  b.sway = 0; b.tint = 0;
}
function lying(b, y0, t, skin) {
  b.sway = 0; b.tint = 0;
  for (const side of [-1, 1]) {
    b.box(side * 0.1, y0, 0.56, 0.13, 0.12, 0.8, skin);
    b.box(side * 0.1, y0, 0.99, 0.1, 0.18, 0.07, skin);
    b.box(side * 0.27, y0, -0.24, 0.09, 0.09, 0.55, skin);
  }
  b.tint = t; b.box(0, y0, 0.06, 0.36, 0.15, 0.24, WHITE);
  b.sway = 1; b.tint = 0; b.box(0, y0, -0.3, 0.38, 0.17, 0.48, skin, { skipBottom: true });
  b.tint = t; b.box(0, y0 + 0.17, -0.38, 0.32, 0.03, 0.15, WHITE, { skipBottom: true });
  b.sway = 0; b.tint = 0;
  b.box(0, y0, -0.68, 0.2, 0.2, 0.22, skin, { skipBottom: true });
  b.box(0, y0, -0.82, 0.22, 0.2, 0.07, HAIR, { skipBottom: true });
}
function standing(b, t, skin, armCode) {
  b.sway = 0; b.tint = 0;
  for (const side of [-1, 1]) {
    b.box(side * 0.1, 0.06, 0, 0.12, 0.5, 0.13, skin, { skipBottom: true });
    b.box(side * 0.1, 0.0, -0.03, 0.12, 0.07, 0.24, skin);
  }
  b.tint = t; b.box(0, 0.55, 0, 0.36, 0.38, 0.22, WHITE, { skipBottom: true });
  b.sway = 1; b.tint = 0;
  b.box(0, 0.93, 0, 0.38, 0.5, 0.21, skin, { skipBottom: true });
  b.box(-0.24, 1.0, 0, 0.09, 0.42, 0.1, skin);
  b.box(0, 1.43, 0, 0.1, 0.06, 0.1, skin, { skipBottom: true });
  b.box(0, 1.49, 0, 0.2, 0.22, 0.21, skin, { skipBottom: true });
  b.box(0, 1.67, 0.02, 0.22, 0.08, 0.23, HAIR);
  // paddle arm, raised forward
  b.sway = armCode;
  b.push(); b.translate(0.24, 1.38, 0); b.rotX(1.25); b.box(0, -0.48, 0, 0.09, 0.48, 0.1, skin); b.pop();
  b.push(); b.translate(0.24, 1.24, -0.6); b.rotX(Math.PI / 2); b.cyl(0, -0.012, 0, 0.17, 0.17, 0.024, 10, hex(0x2f6fb6)); b.pop();
  b.box(0.24, 1.0, -0.6, 0.04, 0.16, 0.04, WOOD);
  b.sway = 0;
}
function wheel(b, z, y, r, w) {
  b.push(); b.translate(0, y, z); b.rotZ(Math.PI / 2); b.cyl(0, -w / 2, 0, r, r, w, 10, TIRE); b.pop();
}
function bicycle(b, t) {
  wheel(b, -0.52, 0.34, 0.34, 0.05); wheel(b, 0.52, 0.34, 0.34, 0.05);
  b.tint = t;
  b.box(0, 0.76, -0.02, 0.05, 0.05, 0.78, WHITE);
  b.push(); b.translate(0, 0.36, 0.18); b.rotX(-0.62); b.box(0, 0, 0, 0.05, 0.62, 0.05, WHITE); b.pop();
  b.box(0, 0.34, 0.2, 0.05, 0.5, 0.05, WHITE);
  b.box(0, 0.34, -0.48, 0.04, 0.55, 0.04, WHITE);
  b.tint = 0;
  b.box(0, 0.84, 0.22, 0.12, 0.05, 0.22, TIRE);
  b.box(0, 0.8, -0.46, 0.04, 0.16, 0.04, METAL);
  b.box(0, 0.95, -0.46, 0.5, 0.04, 0.04, METAL);
}
function cyclistGeo() {
  const b = new Builder({ tint: true });
  const skin = SKINS[0];
  bicycle(b, 2);
  b.sway = 1;
  for (const side of [-1, 1]) {
    b.push(); b.translate(side * 0.11, 0.9, 0.18); b.rotX(0.9); b.tint = 0; b.box(0, -0.44, 0, 0.14, 0.44, 0.15, SHORTS); b.pop();
    b.push(); b.translate(side * 0.11, 0.62, -0.18); b.rotX(-0.4); b.box(0, -0.38, 0, 0.11, 0.38, 0.12, skin); b.pop();
  }
  b.push(); b.translate(0, 0.9, 0.2); b.rotX(-0.6);
  b.tint = 1; b.box(0, 0, 0, 0.38, 0.5, 0.22, WHITE);
  b.tint = 0; b.box(0, 0.5, 0, 0.1, 0.06, 0.1, skin); b.box(0, 0.56, 0, 0.2, 0.22, 0.21, skin);
  b.box(0, 0.74, 0.01, 0.24, 0.1, 0.26, hex(0xe9e4d6));
  b.pop();
  for (const side of [-1, 1]) { b.push(); b.translate(side * 0.22, 1.27, -0.05); b.rotX(0.89); b.box(0, -0.48, 0, 0.08, 0.48, 0.09, skin); b.pop(); }
  b.sway = 0;
  return b.build();
}
function scooterGeo() {
  const b = new Builder({ tint: true });
  const skin = SKINS[2];
  b.box(0, 0.08, 0, 0.16, 0.05, 0.85, TIRE);
  wheel(b, -0.38, 0.1, 0.1, 0.05); wheel(b, 0.38, 0.1, 0.1, 0.05);
  b.tint = 2; b.box(0, 0.1, -0.4, 0.05, 0.95, 0.05, WHITE); b.tint = 0;
  b.box(0, 1.02, -0.4, 0.45, 0.04, 0.04, METAL);
  b.sway = 1;
  for (const side of [-1, 1]) {
    b.box(side * 0.1, 0.13, 0.05 + side * 0.08, 0.12, 0.76, 0.14, SHORTS, { skipBottom: true });
    b.box(side * 0.1, 0.12, 0.02 + side * 0.08, 0.12, 0.07, 0.24, SHOE);
  }
  b.push(); b.translate(0, 0.88, 0.05); b.rotX(-0.15);
  b.tint = 1; b.box(0, 0, 0, 0.4, 0.5, 0.22, WHITE);
  b.tint = 0; b.box(0, 0.5, 0, 0.1, 0.06, 0.1, skin); b.box(0, 0.56, 0, 0.2, 0.22, 0.21, skin); b.box(0, 0.74, 0.02, 0.22, 0.08, 0.23, HAIR);
  b.pop();
  for (const side of [-1, 1]) { b.push(); b.translate(side * 0.22, 1.32, 0.0); b.rotX(0.81); b.box(0, -0.52, 0, 0.08, 0.52, 0.09, skin); b.pop(); }
  b.sway = 0;
  return b.build();
}
function towel(b, x, z, w, l) {
  b.tint = 2; b.box(x, -0.02, z, w, 0.03, l, WHITE);
  b.tint = 0; for (const s of [-0.3, 0.3]) b.box(x, -0.01, z + s * l, w * 1.01, 0.03, l * 0.08, WHITE);
}
function sunbatherGeo() {
  const b = new Builder({ tint: true });
  towel(b, 0, 0.1, 0.75, 1.95);
  lying(b, 0.02, 1, SKINS[1]);
  return b.build();
}
function benchKitGeo() {
  const b = new Builder({ tint: true });
  b.box(0, 0.4, 0, 1.8, 0.08, 0.5, WOOD, { skipBottom: true });
  b.box(0, 0.48, 0.22, 1.8, 0.4, 0.06, WOOD);
  for (const x of [-0.7, 0.7]) b.box(x, 0, 0, 0.08, 0.4, 0.4, METAL, { skipBottom: true });
  b.push(); b.translate(-0.45, 0, 0); seated(b, 0.48, 1, SKINS[0]); b.pop();
  b.push(); b.translate(0.48, 0, 0); seated(b, 0.48, 2, SKINS[3]); b.pop();
  return b.build();
}
function sitterGeo() {
  const b = new Builder({ tint: true });
  seated(b, 0.47, 1, SKINS[2]);
  return b.build();
}
function campGeo() {
  const b = new Builder({ tint: true });
  // low beach chair, seated person, cooler, beach bag, towel
  for (const x of [-0.25, 0.25]) b.box(x, 0, 0, 0.03, 0.18, 0.45, METAL, { skipBottom: true });
  b.tint = 2; b.box(0, 0.16, 0, 0.55, 0.04, 0.5, WHITE);
  b.push(); b.translate(0, 0.18, 0.24); b.rotX(-0.35); b.box(0, 0, 0, 0.55, 0.6, 0.04, WHITE); b.pop();
  b.tint = 0;
  seated(b, 0.24, 1, SKINS[4]);
  b.box(0.75, 0, 0.05, 0.5, 0.32, 0.34, hex(0xf2efe8), { skipBottom: true });
  b.box(0.75, 0.32, 0.05, 0.52, 0.07, 0.36, hex(0x2f7fd8), { skipBottom: true });
  b.tint = 2; b.box(-0.68, 0, 0.12, 0.38, 0.3, 0.17, mul(WHITE, 0.85), { skipBottom: true }); b.tint = 0;
  b.box(-0.68, 0.3, 0.12, 0.3, 0.1, 0.03, METAL);
  towel(b, 0.1, -1.35, 0.75, 1.7);
  return b.build();
}
function matkotGeo() {
  const b = new Builder({ tint: true });
  b.push(); b.translate(0, 0, -2.8); b.rotY(Math.PI); standing(b, 1, SKINS[0], 2); b.pop();
  b.push(); b.translate(0, 0, 2.8); standing(b, 2, SKINS[3], 2.5); b.pop();
  b.sway = 3; b.box(0, 1.2, 0, 0.07, 0.07, 0.07, hex(0x222222)); b.sway = 0;
  return b.build();
}
function cafeSetGeo() {
  const b = new Builder({ tint: true });
  b.cyl(0, 0, 0, 0.05, 0.05, 0.72, 6, METAL, { cap: false });
  b.cyl(0, 0.72, 0, 0.38, 0.38, 0.04, 10, hex(0xf2efe8));
  b.box(0.1, 0.76, 0.05, 0.06, 0.07, 0.06, hex(0x6b4430));
  for (const s of [-1, 1]) {
    b.push(); b.translate(0, 0, s * 0.62); if (s < 0) b.rotY(Math.PI);
    b.box(0, 0, 0, 0.42, 0.45, 0.42, WOOD, { skipBottom: true });
    b.box(0, 0.45, 0.19, 0.42, 0.45, 0.04, WOOD);
    seated(b, 0.47, s > 0 ? 1 : 2, SKINS[s > 0 ? 2 : 1]);
    b.pop();
  }
  return b.build();
}
function streetGeo() {
  const b = new Builder({ tint: true });
  // bike rack (3 hoops) with two parked bikes, a planter, two rental scooters; row along +x
  for (let i = 0; i < 3; i++) {
    const x = -2.2 + i * 0.7;
    b.box(x, 0, -0.3, 0.05, 0.75, 0.05, METAL, { skipBottom: true }); b.box(x, 0, 0.3, 0.05, 0.75, 0.05, METAL, { skipBottom: true });
    b.box(x, 0.72, 0, 0.05, 0.05, 0.65, METAL);
    if (i < 2) { b.push(); b.translate(x + 0.32, 0, 0.05); bicycle(b, 2); b.pop(); }
  }
  b.box(0.3, 0, 0, 0.9, 0.5, 0.9, hex(0xc9b08a), { skipBottom: true, top: hex(0x6a5038) });
  b.cyl(0.3, 0.5, 0, 0.42, 0.12, 0.7, 7, GREEN);
  b.cyl(0.3, 0.55, 0, 0.3, 0.05, 1.0, 6, mix3(GREEN, [0.5, 0.7, 0.3], 0.4));
  for (let i = 0; i < 2; i++) {
    const x = 1.5 + i * 0.6;
    b.push(); b.translate(x, 0, 0); b.rotZ(0.12);
    b.box(0, 0.06, 0, 0.14, 0.05, 0.8, TIRE);
    wheel(b, -0.36, 0.09, 0.09, 0.05); wheel(b, 0.36, 0.09, 0.09, 0.05);
    b.box(0, 0.08, -0.37, 0.05, 0.95, 0.05, hex(0x7ac943));
    b.box(0, 1.0, -0.37, 0.42, 0.04, 0.04, METAL);
    b.pop();
  }
  return b.build();
}

// Per-preset density (per LOD0 chunk; riders are a pool around the camera).
const DENSITY = {
  LOW:    { sun: 5, walk: 5, bench: 2, sit: 6, camp: 0, matkot: 0, cafe: 0, street: 0, cyc: 3, sco: 0, leaves: 0 },
  MEDIUM: { sun: 5, walk: 6, bench: 2, sit: 6, camp: 2, matkot: 0, cafe: 0, street: 1, cyc: 3, sco: 2, leaves: 36 },
  HIGH:   { sun: 8, walk: 10, bench: 3, sit: 10, camp: 3, matkot: 1, cafe: 2, street: 2, cyc: 5, sco: 4, leaves: 70 },
  ULTRA:  { sun: 10, walk: 13, bench: 3, sit: 12, camp: 4, matkot: 2, cafe: 3, street: 2, cyc: 7, sco: 5, leaves: 100 },
};
const CHUNK_KITS = ['sun', 'walk', 'bench', 'sit', 'camp', 'matkot', 'cafe', 'street'];

// cafes and kiosks per chunk variant (must match world.js buildChunk)
function cafesFor(v) { return v % 2 === 0 ? [[-8, 12], [9, 11]] : [[9, 10], [-9.5, 4]]; }

export function decorTris() { const o = {}; for (const [k, f] of Object.entries({ sun: sunbatherGeo, bench: benchKitGeo, sit: sitterGeo, camp: campGeo, matkot: matkotGeo, cafe: cafeSetGeo, street: streetGeo, cyc: cyclistGeo, sco: scooterGeo })) { const g = f(); o[k] = g.attributes.position.count / 3; } return o; }

export class Decor {
  constructor(scene) {
    this.scene = scene;
    this.geos = {
      sun: sunbatherGeo(), bench: benchKitGeo(), sit: sitterGeo(), camp: campGeo(), matkot: matkotGeo(),
      cafe: cafeSetGeo(), street: streetGeo(), cyc: cyclistGeo(), sco: scooterGeo(), walk: personGeometry(false),
    };
    this.mat = bakedMaterial({ tint: true, bob: true });
    this.walkMat = bakedMaterial({ rig: true, tint: true, wet: true, decorWalk: true });
    this.kits = {}; this.slots = []; this.riders = []; this.movers = [];
    this.leafMat = this.makeLeafMaterial();
    this.onBell = null;
  }
  applyPreset(p) {
    this.preset = p;
    const d = this.d = DENSITY[p.name] || DENSITY.LOW;
    for (const k of Object.values(this.kits)) { this.scene.remove(k.mesh); k.mesh.dispose(); }
    if (this.leaves) { this.scene.remove(this.leaves); this.leaves.dispose(); this.leaves = null; }
    this.kits = {};
    this.D = Math.ceil((p.lod0 + L) / L) + 2;
    const mk = (name, per, mat) => {
      if (per <= 0) return;
      const n = per * (name === 'cyc' || name === 'sco' ? 1 : this.D);
      const geo = this.geos[name];
      let anim = null;
      if (name === 'walk') { anim = new THREE.InstancedBufferAttribute(new Float32Array(n * 4), 4); geo.setAttribute('aAnim', anim); }
      const m = new THREE.InstancedMesh(geo, mat || this.mat, n);
      m.frustumCulled = false; m.renderOrder = 0;
      for (let i = 0; i < n; i++) { m.setMatrixAt(i, _hide); m.setColorAt(i, SHIRTS[i % SHIRTS.length]); }
      m.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
      this.scene.add(m);
      this.kits[name] = { mesh: m, per, anim };
    };
    for (const k of CHUNK_KITS) mk(k, d[k], k === 'walk' ? this.walkMat : null);
    mk('cyc', d.cyc); mk('sco', d.sco);
    this.slots = Array.from({ length: this.D }, () => ({ index: -1e9, shown: false, movers: [] }));
    // riders pool
    this.riders = [];
    const rr = makeRng(0xb1c7c1e);
    for (const kind of ['cyc', 'sco']) for (let i = 0; i < d[kind]; i++) this.riders.push({ kind, i, rng: rr, z: 1e9, x: 0, dir: 1, v: 6, lastDz: 0 });
    // leaves: one instanced draw
    if (d.leaves > 0) {
      const g = new THREE.BufferGeometry();
      g.setAttribute('position', new THREE.Float32BufferAttribute([-0.16, 0, 0, 0, 0.06, 0, 0.16, 0, 0, 0, -0.06, 0], 3));
      g.setIndex([0, 2, 1, 0, 3, 2]);
      const seeds = new Float32Array(d.leaves * 4); const lr = makeRng(77);
      for (let i = 0; i < seeds.length; i++) seeds[i] = lr.next();
      g.setAttribute('aSeed', new THREE.InstancedBufferAttribute(seeds, 4));
      this.leaves = new THREE.InstancedMesh(g, this.leafMat, d.leaves);
      this.leaves.frustumCulled = false; this.leaves.renderOrder = 5;
      this.scene.add(this.leaves);
    }
  }
  makeLeafMaterial() {
    return new THREE.ShaderMaterial({
      side: THREE.DoubleSide,
      uniforms: { uTime: U.uTime, uWind: U.uWind, uAmb: U.uAmb, uSun: U.uSun, uCam: { value: new THREE.Vector3() }, uAmount: { value: 0 } },
      vertexShader: `attribute vec4 aSeed; uniform float uTime; uniform vec4 uWind; uniform vec3 uCam; uniform float uAmount; varying vec3 vC;
        float windGust(float z, float t) { float u = z + t * 18.0; float a = 0.5 + 0.5 * sin(u * 0.0898); float a2 = a * a; return a2 * a2 * a2 * (0.55 + 0.45 * sin(u * 0.031 + 1.7)); }
        void main() {
          if (aSeed.w > uAmount) { vC = vec3(0.0); gl_Position = vec4(0.0, 0.0, 2.0, 1.0); return; }
          float t = uTime;
          float zw = uCam.z - 48.0 + mod(aSeed.z * 58.0 - uCam.z, 58.0);
          float g = windGust(zw, t);
          float x = mod(aSeed.x * 32.0 + t * (2.0 + 7.0 * uWind.w) * (0.7 + 0.6 * aSeed.y), 32.0) - 14.0 + g * 2.5;
          float y = 2.2 + mod(aSeed.y * 7.5 - t * (0.35 + 0.35 * aSeed.x), 7.5) + sin(t * 3.0 + aSeed.x * 20.0) * 0.3;
          float a = t * (3.0 + 5.0 * aSeed.z) + aSeed.x * 10.0, b = a * 0.73;
          vec3 p = position * (0.8 + 0.7 * aSeed.z);
          p.xy = mat2(cos(a), sin(a), -sin(a), cos(a)) * p.xy;
          p.yz = mat2(cos(b), sin(b), -sin(b), cos(b)) * p.yz;
          vC = mix(vec3(0.36, 0.55, 0.22), vec3(0.66, 0.52, 0.27), step(0.6, aSeed.z)) * (0.55 + 0.45 * abs(cos(a)));
          gl_Position = projectionMatrix * viewMatrix * vec4(vec3(x, y, zw) + p, 1.0);
        }`,
      fragmentShader: `uniform vec3 uAmb; uniform vec3 uSun; varying vec3 vC; void main() { gl_FragColor = vec4(vC * (uAmb + uSun * 0.7), 1.0); }`,
    });
  }

  // ---------- chunk fill ----------
  put(kit, idx, x, y, z, rotY, scale = 1, color = -1) {
    const k = this.kits[kit]; if (!k) return;
    _o.position.set(x, y, z); _o.rotation.set(0, rotY, 0); _o.scale.setScalar(scale); _o.updateMatrix();
    k.mesh.setMatrixAt(idx, _o.matrix);
    if (color >= 0) k.mesh.setColorAt(idx, SHIRTS[color % SHIRTS.length]);
  }
  fill(slotI, ci) {
    const slot = this.slots[slotI], d = this.d, p = this.preset;
    const variant = Math.floor(hash2(ci, 99) * VARIANTS), cz = -(ci + 0.5) * L, z0 = -L / 2;
    const r = makeRng((hash2(ci, 4242) * 4294967296) >>> 0);
    const counters = {};
    const base = (kit) => slotI * (this.kits[kit] ? this.kits[kit].per : 0);
    const next = (kit) => { const k = this.kits[kit]; if (!k) return -1; const c = counters[kit] || 0; if (c >= k.per) return -1; counters[kit] = c + 1; return base(kit) + c; };
    const col = () => r.int(0, SHIRTS.length - 1);
    slot.movers = [];
    // sunbathers: on the chunk's sunbeds first, then on towels on the sand
    const rr = (k) => hash2(variant * 131 + 7, k);
    const umbN = p.rich ? 7 : 4;
    for (let k = 0; k < umbN && this.kits.sun; k++) {
      const ux = -10 - rr(k + 400) * 22, uz = z0 + 3 + rr(k + 450) * (L - 6);
      if (r.chance(0.7)) { const i = next('sun'); if (i >= 0) this.put('sun', i, ux + 0.9, 0.3, cz + uz + 0.2, 0.1 + Math.PI, 1, col()); }
      if (p.rich && r.chance(0.5)) { const i = next('sun'); if (i >= 0) this.put('sun', i, ux - 0.9, 0.3, cz + uz + 0.1, -0.1 + Math.PI, 1, col()); }
    }
    for (let i = next('sun'); i >= 0; i = next('sun')) { const x = r.range(-35, -9), zl = r.range(-18, 18); this.put('sun', i, x, sandY(x, zl, variant) + 0.03, cz + zl, r.pick([0, Math.PI]) + r.range(-0.5, 0.5), 1, col()); }
    // beach camps (chair, person, cooler, bag, towel), facing the sea
    for (let i = next('camp'); i >= 0; i = next('camp')) { const x = r.range(-30, -9), zl = r.range(-17, 17); this.put('camp', i, x, sandY(x, zl, variant), cz + zl, Math.PI / 2 + r.range(-0.5, 0.5), 1, col()); }
    // matkot pairs on the wet sand
    for (let i = next('matkot'); i >= 0; i = next('matkot')) { const x = r.range(-37, -31), zl = r.range(-14, 14); this.put('matkot', i, x, sandY(x, zl, variant), cz + zl, r.range(-0.3, 0.3), 1, col()); }
    // buffer strip benches between the palms, facing the sea, two people each
    const palmStep = p.rich ? 6.5 : 9.5;
    const bz = []; for (let zz = z0 + 3 + palmStep / 2; zz < L / 2 - 1; zz += palmStep) bz.push(zz);
    for (let i = next('bench'); i >= 0 && bz.length; i = next('bench')) { const zl = bz.splice(r.int(0, bz.length - 1), 1)[0]; this.put('bench', i, -6.9, sandY(-6.9, zl, variant), cz + zl, Math.PI / 2, 1, col()); }
    // seated people on the promenade benches and the cafe chairs (exist in LOD0 chunks)
    const seats = [];
    for (let zz = z0 + 9; zz < L / 2; zz += 16) seats.push([-3.98, zz, Math.PI / 2]);
    for (const [zc, w] of cafesFor(variant)) {
      const n = Math.max(2, Math.floor(w / 2.6));
      for (let k = 0; k < n; k++) { const tz = zc - w / 2 + (k + 0.5) * (w / n); seats.push([8.0, tz, -Math.PI / 2]); seats.push([9.2, tz, Math.PI / 2]); }
    }
    for (let k = seats.length - 1; k > 0; k--) { const j = r.int(0, k); const tmp = seats[k]; seats[k] = seats[j]; seats[j] = tmp; }
    for (const s of seats) { if (!r.chance(0.6)) continue; const i = next('sit'); if (i < 0) break; this.put('sit', i, s[0], 0, cz + s[1], s[2], 1, col()); }
    // extra cafe tables in the plaza gaps, and street kits (bike rack, planter, rental scooters)
    const busy = cafesFor(variant).map(([zc, w]) => [zc - w / 2 - 1, zc + w / 2 + 1]);
    if (variant % 2 === 1) busy.push([-12, -8]);
    const freeZ = () => { for (let k = 0; k < 8; k++) { const zl = r.range(-18, 18); if (!busy.some(([a, b]) => zl > a && zl < b)) return zl; } return null; };
    for (let i = next('cafe'); i >= 0; i = next('cafe')) { const zl = freeZ(); if (zl === null) break; busy.push([zl - 1.5, zl + 1.5]); this.put('cafe', i, 8.7, 0, cz + zl, r.range(-0.3, 0.3), 1, col()); }
    for (let i = next('street'); i >= 0; i = next('street')) { const zl = r.range(-15, 15); this.put('street', i, 7.35, 0, cz + zl, r.chance(0.5) ? Math.PI / 2 : -Math.PI / 2, 1, col()); }
    // standing / walking people: beach walkers to the water, kids playing, plaza chats, kiosk queue
    const wk = this.kits.walk;
    if (wk) {
      const setAnim = (i, ph, amp) => wk.anim.setXYZW(i, ph, amp, 0, 0);
      let n = wk.per;
      if (variant % 2 === 1 && n >= 3) { // kiosk customers
        for (let k = 0; k < 2; k++) { const i = next('walk'); this.put('walk', i, 8.25, 0, cz - 10 + (k - 0.5) * 1.1, -Math.PI / 2, 1, col()); setAnim(i, r.range(0, 6), 0.03); }
        n -= 2;
      }
      const chat = Math.round(n * 0.3 / 2) * 2;
      for (let k = 0; k < chat; k += 2) {
        const x = r.range(7.0, 10.0), zl = r.range(-17, 17);
        let i = next('walk'); this.put('walk', i, x, 0, cz + zl, Math.PI, 1, col()); setAnim(i, r.range(0, 6), 0.04);
        i = next('walk'); this.put('walk', i, x + r.range(-0.3, 0.3), 0, cz + zl - 0.95, 0, 1, col()); setAnim(i, r.range(0, 6), 0.04);
      }
      for (let i = next('walk'); i >= 0; i = next('walk')) {
        const kid = r.chance(0.35);
        const m = kid
          ? { i, kid: true, cx: r.range(-38, -31), cz: r.range(-15, 15), rad: r.range(0.8, 1.8), w: r.range(0.9, 1.5) * (r.chance(0.5) ? 1 : -1), ph: r.range(0, 6.28) }
          : { i, kid: false, x0: r.range(-26, -12), dist: 0, zl: r.range(-17, 17), v: r.range(0.9, 1.3), ph: r.range(0, 2) };
        if (!kid) m.dist = m.x0 + 39; // walk from x0 to the water line at x = -39 and back
        m.variant = variant; m.cz0 = cz;
        setAnim(i, r.range(0, 6), kid ? 0.8 : 0.42);
        wk.mesh.setColorAt(i, SHIRTS[col()]);
        slot.movers.push(m);
      }
      wk.anim.needsUpdate = true;
    }
    // hide unused instances of this slot
    for (const kit of CHUNK_KITS) {
      const k = this.kits[kit]; if (!k) continue;
      for (let c = counters[kit] || 0; c < k.per; c++) k.mesh.setMatrixAt(base(kit) + c, _hide);
      k.mesh.instanceMatrix.needsUpdate = true; if (k.mesh.instanceColor) k.mesh.instanceColor.needsUpdate = true;
    }
  }
  hideSlot(slotI) {
    for (const kit of CHUNK_KITS) {
      const k = this.kits[kit]; if (!k) continue;
      for (let c = 0; c < k.per; c++) k.mesh.setMatrixAt(slotI * k.per + c, _hide);
      k.mesh.instanceMatrix.needsUpdate = true;
    }
    this.slots[slotI].movers = [];
  }

  // ---------- per frame ----------
  update(camZ, dt, t, runner) {
    const p = this.preset, D = this.D;
    const first = Math.floor(-camZ / L) - 1;
    let shownN = 0;
    for (let ci = first; ci < first + D; ci++) {
      const si = ((ci % D) + D) % D, s = this.slots[si];
      const dist = Math.abs(-(ci + 0.5) * L - camZ) - L / 2;
      const show = dist < p.lod0; // same test as the world's LOD0 choice
      if (s.index !== ci || s.shown !== show) {
        s.index = ci; s.shown = show;
        if (show) this.fill(si, ci); else this.hideSlot(si);
      }
      if (show) shownN++;
    }
    this.shownChunks = shownN;
    // movers: beach walkers (to the water and back) and kids playing on the wet sand
    const wk = this.kits.walk;
    if (wk) {
      let dirty = false;
      for (const s of this.slots) {
        if (!s.shown) continue;
        for (const m of s.movers) {
          if (m.kid) {
            const a = t * m.w + m.ph;
            const x = m.cx + Math.cos(a) * m.rad, zl = m.cz + Math.sin(a) * m.rad;
            this.put('walk', m.i, x, sandY(x, zl, m.variant), m.cz0 + zl, -a + (m.w > 0 ? Math.PI : 0), 0.62);
          } else {
            const u = ((t * m.v / m.dist + m.ph) % 2 + 2) % 2;
            const out = u < 1, x = m.x0 - (out ? u : 2 - u) * m.dist;
            this.put('walk', m.i, x, sandY(x, m.zl, m.variant), m.cz0 + m.zl, out ? Math.PI / 2 : -Math.PI / 2);
          }
          dirty = true;
        }
      }
      if (dirty) wk.mesh.instanceMatrix.needsUpdate = true;
    }
    // bike path riders: two directions, inside the red lane (x 4.4 to 6.4), decor only
    const dirty = {};
    for (const rd of this.riders) {
      const g = rd.rng;
      if (rd.z > camZ + 18 || rd.z < camZ - 170) {
        const init = rd.z === 1e9;
        rd.dir = g.chance(0.5) ? -1 : 1;
        rd.x = rd.dir < 0 ? 4.95 + g.range(-0.15, 0.15) : 5.85 + g.range(-0.15, 0.15);
        rd.v = rd.kind === 'cyc' ? g.range(5, 7.5) : g.range(4, 6);
        rd.z = init ? camZ - g.range(-10, 150) : camZ - g.range(90, 160);
        if (rd.kind === 'cyc' || rd.kind === 'sco') this.kits[rd.kind].mesh.setColorAt(rd.i, SHIRTS[g.int(0, SHIRTS.length - 1)]);
        this.kits[rd.kind].mesh.instanceColor.needsUpdate = true;
        rd.lastDz = rd.z - runner.z;
      }
      rd.z += rd.dir * rd.v * dt;
      const dz = rd.z - runner.z;
      if (Math.sign(dz) !== Math.sign(rd.lastDz) && Math.abs(rd.x - runner.x) < 3.2 && this.onBell && hash2(rd.i * 7 + (rd.kind === 'cyc' ? 1 : 2), Math.floor(rd.z)) < 0.3) this.onBell(rd.kind);
      rd.lastDz = dz;
      this.put(rd.kind, rd.i, rd.x, 0, rd.z, rd.dir < 0 ? 0 : Math.PI);
      dirty[rd.kind] = true;
    }
    for (const k of Object.keys(dirty)) this.kits[k].mesh.instanceMatrix.needsUpdate = true;
  }
  // leaves follow the camera; amount follows the weather wind
  frame(camera, wind) {
    if (!this.leaves) return;
    const amt = Math.min(1, wind * 1.1);
    this.leafMat.uniforms.uAmount.value = amt;
    this.leafMat.uniforms.uCam.value.copy(camera.position);
    this.leaves.visible = amt > 0.02;
  }
  counts() {
    const o = { chunks: this.shownChunks };
    for (const [k, v] of Object.entries(this.kits)) {
      let n = 0; const a = v.mesh.instanceMatrix.array;
      for (let i = 0; i < v.mesh.count; i++) if (a[i * 16] !== 0 || a[i * 16 + 2] !== 0) n++;
      o[k] = n;
    }
    o.leaves = this.leaves ? Math.round(this.leaves.count * this.leafMat.uniforms.uAmount.value) : 0;
    return o;
  }
}
