// v2.2 decor: beach, buffer strip, plaza and bike-path life. Render side only: it never touches
// the sim or its RNG (own hash-seeded RNG per chunk), so runs stay deterministic.
// Everything is instanced: one InstancedMesh per kit and LOD tier (v2.5: near / mid / far, see
// lod.js; only the instances actually shown are drawn). Kits are filled per world chunk and
// recycled with the chunk streaming (only chunks inside the LOD0 range get decor, which is also
// where the benches, cafe chairs and sunbeds they use exist). Idle motion runs in the vertex
// shader (BOB / DECORWALK); only beach walkers, kids and bike-path riders get matrix updates.
// Bike path riders are decor only: the runner's lanes end at x = 3.5 m, the bike lane starts at
// x = 4.4 m, so the runner can never enter it and riders never collide with anyone.
import * as THREE from '../vendor/three.module.js';
import { CHUNK_LEN } from './config.js';
import { Builder, hex, mul, mix3 } from './geo.js';
import { makeRng, hash2 } from './rng.js';
import { nearestCrossing, chunkVariant, chunkUmbrellas } from './world.js';
import { bakedMaterial, U } from './materials.js';
import { personGeometry, personNearGeometry, personFarGeometry, benchNearKit } from './props.js';
import { TieredSet } from './lod.js';

const L = CHUNK_LEN, VARIANTS = 6;
const SHIRTS = [0xe8473c, 0x2f7fd8, 0xf2c14e, 0x3fae6b, 0xffffff, 0x8a5cd6, 0xf08a5d, 0x1f2a44, 0xe86fa8, 0x46c2c9, 0xd9d2c0, 0x333333].map((h) => new THREE.Color(h));
const SKINS = [hex(0xc58c63), hex(0x8d5a3b), hex(0xe0b08a), hex(0x6b4430), hex(0xd9a27a)];
const SHORTS = hex(0x3b4250), HAIR = hex(0x2b1d14), SHOE = hex(0xeeeeee), WHITE = [1, 1, 1];
const WOOD = hex(0x8a6038), METAL = hex(0x3a3d44), TIRE = hex(0x1e1e22), GREEN = hex(0x3f7f3a);
const _o = new THREE.Object3D();

// sand height, same formula as the chunk ground (world.js)
export function sandY(x, zl, variant) {
  return -0.25 - Math.max(0, -x - 5) * 0.016 + 0.06 * Math.sin(x * 0.7) * Math.sin(zl * 0.5 + variant);
}

// ---------------- figure builders (all face -z at the origin) ----------------
function seated(b, seatY, t, skin, shirt = WHITE) {
  b.sway = 0; b.tint = 0;
  for (const side of [-1, 1]) {
    const lx = side * 0.1;
    b.box(lx, seatY - 0.07, -0.2, 0.15, 0.15, 0.44, SHORTS);
    b.box(lx, 0.05, -0.41, 0.11, Math.max(0.05, seatY - 0.1), 0.12, skin, { skipBottom: true });
    b.box(lx, 0, -0.46, 0.12, 0.07, 0.22, SHOE);
  }
  b.box(0, seatY - 0.08, 0.02, 0.36, 0.2, 0.24, SHORTS);
  b.sway = 1; b.tint = t;
  b.box(0, seatY + 0.1, 0.04, 0.4, 0.46, 0.22, shirt, { skipBottom: true });
  for (const side of [-1, 1]) {
    b.tint = t; b.box(side * 0.24, seatY + 0.3, 0.03, 0.09, 0.28, 0.1, shirt, { skipBottom: true });
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
  for (const side of [-1, 1]) {
    b.sway = side < 0 ? 4 : 4.5; // v2.5 pedalling (legs swing round the hip in the shader)
    b.push(); b.translate(side * 0.11, 0.9, 0.18); b.rotX(0.9); b.tint = 0; b.box(0, -0.44, 0, 0.14, 0.44, 0.15, SHORTS); b.pop();
    b.push(); b.translate(side * 0.11, 0.62, -0.18); b.rotX(-0.4); b.box(0, -0.38, 0, 0.11, 0.38, 0.12, skin); b.pop();
  }
  b.sway = 1;
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


// ---------------- v2.5 near-tier decor figures (rounded limbs, heads, hair, slats, spokes) ----------------
function seatedNear(b, seatY, t, skin, hat) {
  b.sway = 0; b.tint = 0;
  for (const side of [-1, 1]) {
    const lx = side * 0.1;
    b.limb(lx, seatY - 0.02, 0.0, lx, seatY - 0.04, -0.42, 0.08, 0.072, 8, SHORTS);
    b.ellip(lx, seatY - 0.04, -0.42, 0.06, 0.055, 0.06, 6, 3, skin);
    b.limb(lx, seatY - 0.04, -0.42, lx, 0.07, -0.44, 0.055, 0.042, 7, skin, { cap: false });
    b.box(lx, 0.0, -0.49, 0.11, 0.07, 0.22, SHOE);
    b.ellip(lx, 0.035, -0.6, 0.055, 0.04, 0.045, 6, 2, SHOE, { hemi: true });
  }
  b.push(); b.scale(1, 1, 0.62); b.cyl(0, seatY - 0.1, 0.04 / 0.62, 0.18, 0.17, 0.16, 10, SHORTS); b.pop();
  b.sway = 1; b.tint = t;
  b.push(); b.translate(0, 0, 0.04); b.scale(1, 1, 0.6); b.cyl(0, seatY + 0.06, 0, 0.165, 0.205, 0.46, 10, WHITE); b.ellip(0, seatY + 0.52, 0, 0.205, 0.055, 0.205, 10, 2, WHITE, { hemi: true }); b.pop();
  for (const side of [-1, 1]) {
    b.tint = t; b.limb(side * 0.21, seatY + 0.52, 0.04, side * 0.23, seatY + 0.32, 0.03, 0.058, 0.054, 8, WHITE);
    b.tint = 0; b.limb(side * 0.23, seatY + 0.34, 0.03, side * 0.23, seatY + 0.13, 0.0, 0.042, 0.038, 6, skin, { cap: false });
    b.limb(side * 0.23, seatY + 0.13, 0.0, side * 0.16, seatY + 0.14, -0.26, 0.038, 0.033, 6, skin);
    b.ellip(side * 0.15, seatY + 0.14, -0.29, 0.035, 0.03, 0.045, 6, 2, skin);
  }
  b.tint = 0;
  b.limb(0, seatY + 0.5, 0.04, 0, seatY + 0.6, 0.04, 0.05, 0.048, 6, skin, { cap: false });
  b.ellip(0, seatY + 0.7, 0.04, 0.1, 0.12, 0.11, 8, 6, skin);
  b.box(0, seatY + 0.67, -0.075, 0.03, 0.05, 0.03, mul(skin, 0.95));
  b.push(); b.translate(0, seatY + 0.72, 0.052); b.rotX(0.38); b.ellip(0, 0, 0, 0.108, 0.115, 0.12, 8, 3, HAIR, { hemi: true }); b.pop();
  b.box(0, seatY + 0.64, 0.11, 0.19, 0.09, 0.06, HAIR, { skipBottom: true });
  if (hat) {
    const STRAW = hex(0xe6d3a0);
    b.cyl(0, seatY + 0.755, 0.04, 0.21, 0.2, 0.018, 12, STRAW); b.cyl(0, seatY + 0.77, 0.04, 0.122, 0.11, 0.1, 10, STRAW);
    b.cyl(0, seatY + 0.77, 0.04, 0.124, 0.123, 0.03, 10, hex(0x7a4b2a), { cap: false });
  }
  b.sway = 0; b.tint = 0;
}
function slatBenchAlongX(b) {
  for (let k = 0; k < 4; k++) b.box(0, 0.42, -0.18 + k * 0.12, 1.8, 0.045, 0.1, mul(WOOD, k % 2 ? 1 : 0.92));
  for (let k = 0; k < 3; k++) { b.push(); b.translate(0, 0.55 + k * 0.13, 0.24); b.rotX(0.18); b.box(0, 0, 0, 1.8, 0.1, 0.035, mul(WOOD, k % 2 ? 0.95 : 1.02)); b.pop(); }
  for (const x of [-0.78, 0.78]) {
    b.limb(x, 0, -0.2, x, 0.42, -0.18, 0.03, 0.03, 5, METAL, { cap: false });
    b.limb(x, 0, 0.2, x, 0.95, 0.24, 0.03, 0.028, 5, METAL);
    b.box(x, 0.38, 0, 0.05, 0.04, 0.46, METAL);
    b.box(x, 0.62, -0.03, 0.06, 0.04, 0.4, METAL);
    b.limb(x, 0.62, -0.22, x, 0.42, -0.2, 0.022, 0.022, 4, METAL);
  }
}
function benchKitNearGeo() {
  const b = new Builder({ tint: true });
  slatBenchAlongX(b);
  b.push(); b.translate(-0.45, 0, 0); seatedNear(b, 0.47, 1, SKINS[0], false); b.pop();
  b.push(); b.translate(0.48, 0, 0); seatedNear(b, 0.47, 2, SKINS[3], true); b.pop();
  return b.build();
}
function sitterNearGeo() { const b = new Builder({ tint: true }); seatedNear(b, 0.47, 1, SKINS[2], false); return b.build(); }
function cafeSetNearGeo() {
  const b = new Builder({ tint: true });
  b.cyl(0, 0, 0, 0.2, 0.05, 0.05, 10, METAL);
  b.cyl(0, 0.05, 0, 0.035, 0.035, 0.67, 8, METAL, { cap: false });
  b.cyl(0, 0.72, 0, 0.38, 0.38, 0.035, 16, hex(0xf2efe8));
  for (const [x, z] of [[0.12, 0.05], [-0.14, -0.08]]) { b.cyl(x, 0.755, z, 0.04, 0.035, 0.08, 8, hex(0xf6f3ee)); b.cyl(x, 0.755, z, 0.07, 0.07, 0.006, 10, hex(0xf6f3ee)); }
  b.cyl(0.02, 0.755, 0.16, 0.025, 0.03, 0.16, 6, hex(0x3f7f5a)); // bottle
  for (const s of [-1, 1]) {
    b.push(); b.translate(0, 0, s * 0.62); if (s < 0) b.rotY(Math.PI);
    b.box(0, 0.44, 0, 0.42, 0.04, 0.4, WOOD);
    for (const [x, z] of [[-0.18, -0.17], [0.18, -0.17], [-0.18, 0.17], [0.18, 0.17]]) b.limb(x, 0, z, x * 0.95, 0.44, z * 0.95, 0.018, 0.018, 4, METAL, { cap: false });
    for (let k = 0; k < 4; k++) b.box(-0.15 + k * 0.1, 0.48, 0.19, 0.06, 0.42, 0.025, mul(WOOD, k % 2 ? 1 : 0.9));
    b.box(0, 0.86, 0.19, 0.42, 0.05, 0.03, WOOD);
    seatedNear(b, 0.47, s > 0 ? 1 : 2, SKINS[s > 0 ? 2 : 1], s < 0);
    b.pop();
  }
  return b.build();
}
function wheelNear(b, z, code) {
  const sw = b.sway; b.sway = code;
  const r = 0.34, n = 14;
  for (let i = 0; i < n; i++) { // tire ring: 4-sided tube
    const a0 = (i / n) * Math.PI * 2, a1 = ((i + 1) / n) * Math.PI * 2;
    const P = (a, rr, x) => [x, 0.34 + Math.cos(a) * rr, z + Math.sin(a) * rr];
    for (const [rA, xA, rB, xB, c] of [[r + 0.02, -0.022, r + 0.02, 0.022, TIRE], [r - 0.02, 0.022, r - 0.02, -0.022, METAL], [r - 0.02, -0.022, r + 0.02, -0.022, TIRE], [r + 0.02, 0.022, r - 0.02, 0.022, TIRE]])
      b.quad(P(a0, rA, xA), P(a1, rA, xA), P(a1, rB, xB), P(a0, rB, xB), c);
  }
  for (let k = 0; k < 4; k++) { b.push(); b.translate(0, 0.34, z); b.rotX(k * Math.PI / 4); b.box(0, -r + 0.02, 0, 0.01, (r - 0.02) * 2, 0.01, hex(0xb8bcc4)); b.pop(); }
  b.cyl(-0.03, 0.34, z, 0.03, 0.03, 0.06, 6, METAL); // hub (approx)
  b.sway = sw;
}
function cyclistNearGeo() {
  const b = new Builder({ tint: true });
  const skin = SKINS[0];
  wheelNear(b, -0.52, 6); wheelNear(b, 0.52, 6.5);
  b.tint = 2;
  const tube = (a, c2, r = 0.024) => b.limb(a[0], a[1], a[2], c2[0], c2[1], c2[2], r, r, 5, WHITE, { cap: false });
  const BB = [0, 0.36, 0.16], SEAT = [0, 0.86, 0.24], HEAD = [0, 0.82, -0.42], RA = [0, 0.34, 0.52], FA = [0, 0.34, -0.52];
  tube(BB, SEAT); tube(BB, HEAD, 0.028); tube(SEAT, HEAD); tube(BB, RA, 0.018); tube(SEAT, RA, 0.016); tube(HEAD, FA, 0.02);
  b.tint = 0;
  b.box(0, 0.88, 0.25, 0.1, 0.05, 0.24, TIRE); // saddle
  b.limb(0, 0.82, -0.42, 0, 0.98, -0.44, 0.018, 0.018, 5, METAL);
  b.limb(-0.24, 0.98, -0.44, 0.24, 0.98, -0.44, 0.016, 0.016, 5, METAL);
  for (const s of [-1, 1]) b.limb(s * 0.24, 0.98, -0.44, s * 0.26, 0.98, -0.38, 0.022, 0.022, 5, TIRE);
  b.sway = 5; // crank + pedals
  for (const s of [-1, 1]) { b.push(); b.translate(s * 0.06, 0.36, 0.16); b.rotX(s > 0 ? 0 : Math.PI); b.box(0, -0.17, 0, 0.02, 0.17, 0.03, METAL); b.box(s * 0.04, -0.19, 0, 0.09, 0.025, 0.1, TIRE); b.pop(); }
  b.cyl(-0.04, 0.36, 0.16, 0.09, 0.09, 0.08, 10, METAL); // chainring (approx)
  // rider: legs pedal (4 / 4.5), torso bobs (1)
  for (const side of [-1, 1]) {
    b.sway = side < 0 ? 4 : 4.5; b.tint = 0;
    const lx = side * 0.11;
    b.limb(lx, 0.9, 0.18, lx, 0.68, -0.18, 0.08, 0.07, 8, SHORTS);
    b.ellip(lx, 0.68, -0.18, 0.058, 0.055, 0.06, 6, 3, skin);
    b.limb(lx, 0.68, -0.18, lx, 0.3, -0.06, 0.055, 0.04, 7, skin, { cap: false });
    b.box(lx, 0.24, -0.1, 0.1, 0.07, 0.22, SHOE);
  }
  b.sway = 1;
  b.push(); b.translate(0, 0.9, 0.2); b.rotX(-0.62);
  b.tint = 1; b.push(); b.scale(1, 1, 0.6); b.cyl(0, 0, 0, 0.17, 0.205, 0.48, 10, WHITE); b.ellip(0, 0.48, 0, 0.205, 0.055, 0.205, 10, 2, WHITE, { hemi: true }); b.pop();
  b.tint = 0; b.limb(0, 0.48, 0, 0, 0.58, 0, 0.05, 0.048, 6, skin, { cap: false });
  b.ellip(0, 0.67, -0.01, 0.1, 0.12, 0.11, 8, 6, skin);
  b.tint = 2; b.ellip(0, 0.7, 0.0, 0.125, 0.12, 0.14, 8, 3, WHITE, { hemi: true, close: true }); // helmet
  b.tint = 0; b.box(0, 0.67, -0.11, 0.17, 0.035, 0.02, hex(0x222222)); // sunglasses
  b.pop();
  for (const side of [-1, 1]) {
    b.tint = 1; b.limb(side * 0.21, 1.27, -0.06, side * 0.23, 1.17, -0.2, 0.055, 0.05, 8, WHITE);
    b.tint = 0; b.limb(side * 0.23, 1.17, -0.2, side * 0.24, 0.99, -0.42, 0.04, 0.034, 6, skin, { cap: false });
    b.ellip(side * 0.245, 0.985, -0.43, 0.035, 0.035, 0.04, 6, 2, skin);
  }
  b.sway = 0; b.tint = 0;
  return b.build();
}
function cyclistFarGeo() {
  const b = new Builder({ tint: true });
  b.box(0, 0.0, 0, 0.05, 0.7, 1.4, TIRE, { skipBottom: true });
  b.tint = 1; b.push(); b.translate(0, 0.9, 0.15); b.rotX(-0.6); b.box(0, 0, 0, 0.38, 0.55, 0.22, WHITE, { skipBottom: true }); b.pop();
  b.tint = 0; b.box(0, 1.32, -0.1, 0.2, 0.22, 0.21, SKINS[0], { skipBottom: true });
  b.box(0, 0.4, 0.05, 0.22, 0.5, 0.15, SHORTS, { skipBottom: true });
  return b.build();
}

// ---------------- v2.5.5 bike-lane mix (rollerblader, skateboarder, surfer) and sea bathers ----------------
const WETSUIT = hex(0x1c2229), WHEELY = hex(0xe7d24a), DECK = hex(0x6b4a2e);
// vertical body part: a box (mid tier) or a round tapered limb (near tier)
function seg(b, near, x, y, z, w, h, d, c) {
  if (near) b.limb(x, y, z, x, y + h, z, w * 0.5, w * 0.44, 7, c);
  else b.box(x, y, z, w, h, d, c, { skipBottom: true });
}
function headAt(b, near, x, y, z, skin, cap, capTint) {
  const t = b.tint; b.tint = 0;
  if (near) b.ellip(x, y + 0.115, z, 0.1, 0.12, 0.11, 8, 6, skin);
  else b.box(x, y, z, 0.2, 0.22, 0.21, skin, { skipBottom: true });
  b.tint = capTint;
  if (near) b.ellip(x, y + 0.15, z + 0.005, 0.122, 0.115, 0.135, 8, 3, cap, { hemi: true, close: true });
  else b.box(x, y + 0.17, z + 0.01, 0.23, 0.09, 0.24, cap);
  b.tint = t;
}
function arm(b, near, x0, y0, z0, x1, y1, z1, c) {
  if (near) { b.limb(x0, y0, z0, x1, y1, z1, 0.045, 0.036, 6, c); b.ellip(x1, y1, z1, 0.036, 0.04, 0.04, 6, 2, c); return; }
  const len = Math.hypot(x1 - x0, y1 - y0, z1 - z0);
  b.push(); b.translate(x0, y0, z0); b.orient(x1 - x0, y1 - y0, z1 - z0); b.box(0, 0, 0, 0.08, len, 0.09, c); b.pop();
}
// rollerblader: leans forward, legs push out sideways in turn (7 / 7.5), arms swing (8 / 8.5)
function bladerGeo(near) {
  const b = new Builder({ tint: true }), skin = SKINS[4];
  for (const side of [-1, 1]) {
    b.sway = side < 0 ? 7 : 7.5;
    const lx = side * 0.12;
    b.tint = 0; b.box(lx, 0.0, 0.0, 0.05, 0.035, 0.3, METAL);
    if (near) for (let k = 0; k < 4; k++) { b.push(); b.translate(lx, 0.035, -0.11 + k * 0.073); b.rotZ(Math.PI / 2); b.cyl(0, -0.02, 0, 0.035, 0.035, 0.04, 6, WHEELY); b.pop(); }
    else b.box(lx, -0.01, 0.0, 0.04, 0.06, 0.28, WHEELY);
    b.tint = 2; b.box(lx, 0.05, 0.02, 0.12, 0.2, 0.25, WHITE);
    b.tint = 0;
    seg(b, near, lx, 0.25, 0.02, 0.11, 0.3, 0.12, skin);
    seg(b, near, lx, 0.52, 0.01, 0.14, 0.36, 0.15, SHORTS);
    if (near) b.box(lx, 0.46, -0.06, 0.11, 0.1, 0.04, TIRE); // knee pads
  }
  b.sway = 1;
  b.push(); b.translate(0, 0.86, 0.04); b.rotX(-0.45);
  b.tint = 0; b.box(0, -0.06, 0, 0.34, 0.16, 0.22, SHORTS);
  b.tint = 1;
  if (near) { b.push(); b.scale(1, 1, 0.62); b.cyl(0, 0.08, 0, 0.17, 0.2, 0.44, 10, WHITE); b.ellip(0, 0.52, 0, 0.2, 0.05, 0.2, 10, 2, WHITE, { hemi: true }); b.pop(); }
  else b.box(0, 0.08, 0, 0.37, 0.46, 0.22, WHITE);
  b.tint = 0; b.box(0, 0.52, 0, 0.1, 0.07, 0.1, skin);
  headAt(b, near, 0, 0.57, -0.01, skin, WHITE, 2); // helmet in the second instance colour
  if (near) b.box(0, 0.68, -0.115, 0.17, 0.035, 0.02, hex(0x222222));
  b.pop();
  for (const side of [-1, 1]) { b.sway = side < 0 ? 8 : 8.5; arm(b, near, side * 0.22, 1.31, -0.18, side * 0.27, 0.86, -0.1, skin); }
  b.sway = 0; b.tint = 0;
  return b.build();
}
// skateboarder: sideways stance on the deck, back foot kicks (9) then glides with it lifted
function skaterGeo(near) {
  const b = new Builder({ tint: true }), skin = SKINS[1];
  b.sway = 0; b.tint = 2;
  if (near) { b.box(0, 0.075, 0, 0.21, 0.025, 0.7, WHITE); for (const s of [-1, 1]) { b.push(); b.translate(0, 0.075, s * 0.38); b.rotX(s * 0.35); b.box(0, 0, 0, 0.21, 0.022, 0.12, WHITE); b.pop(); } }
  else b.box(0, 0.07, 0, 0.22, 0.03, 0.82, WHITE);
  b.tint = 0;
  for (const s of [-1, 1]) {
    b.box(0, 0.045, s * 0.29, 0.16, 0.03, 0.04, METAL);
    if (near) for (const w of [-1, 1]) { b.push(); b.translate(w * 0.08, 0.03, s * 0.29); b.rotZ(Math.PI / 2); b.cyl(0, -0.02, 0, 0.03, 0.03, 0.04, 6, WHEELY); b.pop(); }
    else b.box(0, 0.0, s * 0.29, 0.21, 0.05, 0.05, WHEELY);
  }
  // front leg on the deck (static), slightly bent
  b.tint = 0;
  seg(b, near, -0.02, 0.1, -0.2, 0.12, 0.38, 0.13, skin);
  seg(b, near, -0.02, 0.46, -0.14, 0.15, 0.42, 0.16, SHORTS);
  b.box(-0.02, 0.1, -0.22, 0.12, 0.08, 0.26, SHOE);
  // back leg: kicks the ground beside the deck
  b.sway = 9;
  seg(b, near, 0.17, 0.06, 0.04, 0.12, 0.42, 0.13, skin);
  seg(b, near, 0.15, 0.46, 0.04, 0.15, 0.42, 0.16, SHORTS);
  b.box(0.17, 0.0, 0.02, 0.12, 0.08, 0.26, SHOE);
  b.sway = 1;
  b.push(); b.translate(0.06, 0.86, -0.05); b.rotY(0.7); b.rotX(-0.15);
  b.tint = 1;
  if (near) { b.push(); b.scale(1, 1, 0.62); b.cyl(0, 0.0, 0, 0.18, 0.21, 0.5, 10, WHITE); b.pop(); }
  else b.box(0, 0.0, 0, 0.4, 0.5, 0.22, WHITE);
  b.tint = 0; b.box(0, 0.5, 0, 0.1, 0.06, 0.1, skin);
  b.pop();
  headAt(b, near, 0.1, 1.42, -0.12, skin, WHITE, 2); // beanie / cap
  // arms out for balance (along the board)
  for (const s of [-1, 1]) arm(b, near, 0.06 + s * 0.13, 1.3, -0.05 + s * 0.15, 0.14 + s * 0.22, 1.05, -0.05 + s * 0.6, skin);
  b.sway = 0; b.tint = 0;
  return b.build();
}
// surfer walking the bike lane with a board under the right arm: legs 10 / 10.5, left arm 11
function surferWalkGeo() {
  const b = new Builder({ tint: true }), skin = SKINS[0];
  for (const side of [-1, 1]) {
    b.sway = side < 0 ? 10 : 10.5; b.tint = 0;
    b.box(side * 0.1, 0.06, 0, 0.12, 0.42, 0.13, skin, { skipBottom: true });
    b.box(side * 0.1, 0.48, 0, 0.14, 0.38, 0.15, WETSUIT, { skipBottom: true });
    b.box(side * 0.1, 0.0, -0.03, 0.11, 0.06, 0.22, skin);
  }
  b.sway = 1;
  b.box(0, 0.84, 0, 0.36, 0.56, 0.22, WETSUIT, { skipBottom: true });
  b.tint = 1; b.box(0, 1.1, 0, 0.37, 0.12, 0.225, WHITE); b.tint = 0; // wetsuit chest stripe (instance colour)
  b.box(0, 1.4, 0, 0.1, 0.06, 0.1, skin);
  headAt(b, false, 0, 1.46, 0, skin, HAIR, 0);
  // right arm round the board, board on its rail (second instance colour) with a stringer line
  b.box(0.24, 0.92, 0, 0.09, 0.44, 0.1, WETSUIT);
  b.tint = 2;
  b.push(); b.translate(0.34, 0.92, -0.08); b.rotX(0.12);
  b.box(0, -0.26, 0, 0.07, 0.52, 1.5, WHITE);
  b.box(0, -0.18, -0.85, 0.06, 0.36, 0.22, WHITE); b.box(0, -0.12, -1.02, 0.05, 0.22, 0.14, WHITE); // nose taper
  b.box(0, -0.2, 0.85, 0.06, 0.42, 0.22, WHITE);
  b.tint = 0; b.box(0, -0.25, 0.9, 0.012, 0.02, 0.3, TIRE); // fin
  b.pop();
  b.box(0.3, 0.86, 0.0, 0.16, 0.08, 0.1, skin); // hand over the board
  b.sway = 11; b.box(-0.24, 0.92, 0, 0.09, 0.44, 0.1, skin);
  b.sway = 0;
  return b.build();
}
// sea bathers cluster (local y 0 = water level): two waders (12 / 12.5 arms) and a crawl swimmer (13 / 13.5)
function seaBathersGeo() {
  const b = new Builder({ tint: true });
  // wader A (adult) at the origin, arms sweeping the surface
  let skin = SKINS[2];
  b.sway = 15; b.tint = 0;
  b.box(0, -0.6, 0, 0.36, 1.0, 0.22, skin, { skipBottom: true });
  b.tint = 1; b.box(0, -0.6, 0, 0.37, 0.5, 0.225, WHITE, { skipBottom: true }); b.tint = 0;
  b.box(0, 0.4, 0, 0.1, 0.06, 0.1, skin);
  headAt(b, false, 0, 0.46, 0, skin, HAIR, 0);
  for (const s of [-1, 1]) { b.sway = s < 0 ? 12 : 12.5; arm(b, false, s * 0.21, 0.36, 0, s * 0.5, 0.02, -0.12, skin); }
  // wader B (child) splashing nearby, hands up
  skin = SKINS[0];
  b.sway = 15;
  b.push(); b.translate(1.5, 0, 1.1); b.scale(0.72, 0.72, 0.72);
  b.box(0, -0.5, 0, 0.36, 0.9, 0.22, skin, { skipBottom: true });
  b.tint = 2; b.box(0, -0.5, 0, 0.37, 0.75, 0.225, WHITE, { skipBottom: true }); b.tint = 0;
  b.box(0, 0.4, 0, 0.1, 0.06, 0.1, skin);
  headAt(b, false, 0, 0.46, 0, skin, HAIR, 0);
  for (const s of [-1, 1]) arm(b, false, s * 0.21, 0.36, 0, s * 0.36, 0.78, -0.08, skin);
  b.pop();
  // swimmer C, head and shoulders at the surface, crawl arms circle the shoulder line (z = -1.85)
  skin = SKINS[3];
  b.push(); b.translate(-1.6, 0, -1.7);
  b.sway = 15;
  b.box(0, -0.1, 0.0, 0.42, 0.12, 0.3, skin);
  b.box(0, -0.18, 0.15, 0.3, 0.1, 0.9, skin);
  b.box(0, -0.06, -0.24, 0.19, 0.2, 0.2, skin);
  b.tint = 2; b.box(0, 0.1, -0.23, 0.21, 0.08, 0.22, WHITE); b.tint = 0; // swim cap
  b.pop();
  for (const s of [-1, 1]) { b.sway = s < 0 ? 13 : 13.5; arm(b, false, -1.6 + s * 0.22, 0.0, -1.85, -1.6 + s * 0.24, 0.0, -2.45, skin); }
  // a little white water round the waders
  b.sway = 15; b.tint = 0;
  b.box(0, 0.0, 0, 0.62, 0.02, 0.46, hex(0xe9f1f2), { skipBottom: true });
  b.box(1.5, 0.0, 1.1, 0.44, 0.02, 0.34, hex(0xe9f1f2), { skipBottom: true });
  b.box(-1.6, 0.0, -1.55, 0.5, 0.02, 0.6, hex(0xe9f1f2), { skipBottom: true });
  b.sway = 0;
  waveSurfer(b);
  return b.build();
}
// wave surfer, part of the sea kit 14 m further out (local x -14): crouched on the board, rolls, bobs and
// rides along the swell (14). Sharing the bathers' kit keeps it to one draw call.
function waveSurfer(b) {
  const skin = SKINS[1];
  b.push(); b.translate(-14, 0.03, 4);
  b.sway = 14;
  b.tint = 2; b.box(0, 0.0, 0, 0.5, 0.06, 1.8, WHITE); b.box(0, 0.0, -1.0, 0.32, 0.05, 0.25, WHITE); b.tint = 0;
  b.box(0, -0.01, 1.05, 0.7, 0.02, 0.5, hex(0xf2f6f6)); b.box(0, -0.01, 1.55, 1.1, 0.02, 0.6, hex(0xe2ecee)); // wake
  for (const s of [-1, 1]) { // legs apart along the board, knees bent
    b.push(); b.translate(0, 0.06, s * 0.3); b.rotX(-s * 0.35); b.box(0, 0, 0, 0.13, 0.5, 0.14, WETSUIT, { skipBottom: true }); b.pop();
  }
  b.push(); b.translate(0, 0.5, 0.0); b.rotX(-0.3); b.rotY(Math.PI / 2 * 0.8);
  b.box(0, 0, 0, 0.38, 0.5, 0.22, WETSUIT);
  b.tint = 1; b.box(0, 0.32, 0, 0.39, 0.1, 0.225, WHITE); b.tint = 0;
  b.box(0, 0.5, 0, 0.1, 0.06, 0.1, skin);
  headAt(b, false, 0, 0.55, 0, skin, HAIR, 0);
  b.pop();
  for (const s of [-1, 1]) arm(b, false, 0, 0.95, s * 0.12, 0.05, 0.95, s * 0.75, WETSUIT);
  b.sway = 0;
  b.pop();
}
// shoreline height for figures walking into the sea: sand until the water edge (x = -46), then waist deep
function shoreY(x, zl, variant) {
  if (x > -45.6) return sandY(x, zl, variant);
  const w = Math.min(1, (-45.6 - x) / 2.6), s = w * w * (3 - 2 * w);
  return Math.min(sandY(Math.max(x, -46), zl, variant), -0.85 - 0.95 * s);
}

// v2.5.7 offshore boats (sailboats + small craft): one shared mesh, instanced pool, gentle bob via BOB/swell.
// Far out on the sea (x about -90 to -170), recycled along z with the camera. One draw call.
function sailboatGeo() {
  const b = new Builder({ tint: true });
  const hull = hex(0xf3eee4), dark = hex(0x3a4550), mast = hex(0x6b5340);
  b.sway = 15; // same sea bob + swell as bathers
  b.box(0, -0.18, 0, 3.4, 0.55, 1.15, hull, { skipBottom: true, top: mul(hull, 1.06) });
  b.box(0, 0.08, 0, 2.9, 0.1, 0.9, mul(hull, 0.92), { skipBottom: true });
  b.box(0.15, 0.18, 0, 1.05, 0.42, 0.72, mix3(hull, dark, 0.2), { skipBottom: true });
  b.cyl(0.05, 0.25, 0, 0.05, 0.032, 4.4, 5, mast, { cap: true });
  b.box(-1.0, 1.15, 0, 2.15, 0.055, 0.055, mast, { skipBottom: true });
  b.tint = 1;
  b.tri([0.05, 4.45, 0.02], [0.05, 1.2, 0.02], [-2.05, 1.25, 0.08], WHITE);
  b.tri([0.05, 4.45, -0.02], [-2.05, 1.25, -0.08], [0.05, 1.2, -0.02], mul(WHITE, 0.9));
  b.tint = 0;
  b.box(0, -0.5, 0, 1.7, 0.22, 0.08, mul(hull, 0.85), { skipBottom: true });
  b.sway = 0;
  return b.build();
}
function dinghyGeo() {
  const b = new Builder({ tint: true });
  const hull = hex(0xe8a85a);
  b.sway = 15;
  b.box(0, -0.08, 0, 2.2, 0.35, 0.95, hull, { skipBottom: true, top: mul(hull, 1.08) });
  b.box(0, 0.1, 0, 1.7, 0.08, 0.75, mul(hull, 0.9), { skipBottom: true });
  b.tint = 1; b.box(0.55, 0.22, 0, 0.35, 0.45, 0.35, WHITE, { skipBottom: true }); b.tint = 0; // tiny cabin / cooler
  b.cyl(0.7, 0.12, 0, 0.04, 0.04, 0.55, 4, hex(0x2a2a30), { cap: true }); // outboard hint
  b.sway = 0;
  return b.build();
}

// ---------------- v2.5.8 beach life: restaurants, volleyball, football, racquet (matkot) ----------------
// Lightweight animated props: the balls fly in the BOB vertex shader (3.25 volleyball side to side over
// the net, 3.45 football air passes, 3 the existing matkot ball), players are static poses that breathe.
// Restaurants are one baked kit (shell + indoor and terrace tables with seated diners), instance colour =
// sign / awning. All share the decor material: no new materials, no shadows, no extra targets.
const DINER = [0xe8473c, 0x2f7fd8, 0xf2c14e, 0x3fae6b, 0xffffff, 0x8a5cd6, 0xf08a5d, 0xe86fa8, 0x46c2c9, 0x1f2a44].map((h) => hex(h));
function sportFig(b, code, shirtT, skin, pose) {
  b.sway = code; b.tint = 0;
  for (const side of [-1, 1]) {
    b.box(side * 0.11, 0.0, 0, 0.13, 0.56, 0.14, skin, { skipBottom: true });
    b.box(side * 0.11, 0.0, -0.04, 0.13, 0.07, 0.24, pose === 'up' ? skin : SHOE);
  }
  b.tint = 2; b.box(0, 0.5, 0, 0.38, 0.3, 0.23, WHITE, { skipBottom: true });
  b.tint = shirtT; b.box(0, 0.78, 0, 0.38, 0.52, 0.22, WHITE, { skipBottom: true }); b.tint = 0;
  b.box(0, 1.3, 0, 0.1, 0.07, 0.1, skin, { skipBottom: true });
  b.box(0, 1.36, 0, 0.21, 0.23, 0.22, skin, { skipBottom: true });
  b.box(0, 1.55, 0.02, 0.23, 0.08, 0.24, HAIR);
  for (const side of [-1, 1]) {
    if (pose === 'up') arm(b, false, side * 0.24, 1.22, 0, side * 0.32, 1.98, -0.14, skin);
    else if (pose === 'tray') arm(b, false, side * 0.24, 1.22, 0, side * 0.3, 1.0, -0.38, skin);
    else arm(b, false, side * 0.24, 1.22, 0, side * 0.38, 0.74, -0.04, skin);
  }
  b.sway = 0;
}
// beach volleyball court (local: net across x at z = 0, ball flies along z between the two pairs)
function volleyGeo() {
  const b = new Builder({ tint: true });
  const tape = hex(0x2f6fb6), post = hex(0xe8e4dc), netC = hex(0x26282e);
  // court lines 8 x 16 m (tape on the sand)
  for (const s of [-1, 1]) { b.box(s * 4.0, 0.04, 0, 0.07, 0.04, 16.0, tape); b.box(0, 0.04, s * 8.0, 8.07, 0.04, 0.07, tape); }
  // posts + net (strands) + white top band
  for (const s of [-1, 1]) b.cyl(s * 4.6, 0, 0, 0.06, 0.05, 2.6, 6, post);
  b.box(0, 2.3, 0, 9.2, 0.09, 0.03, WHITE);
  for (let k = 0; k < 4; k++) b.box(0, 1.5 + k * 0.24, 0, 9.2, 0.018, 0.018, netC);
  for (let k = -7; k <= 7; k++) b.box(k * 0.6, 1.5, 0, 0.018, 0.82, 0.018, netC);
  b.box(0, 1.46, 0, 9.2, 0.05, 0.03, WHITE);
  // four players, two per side, arms up (bump / set pose)
  const P = [[-1.0, 4.3, 0, 1, SKINS[0]], [1.0, 4.6, 0, 2, SKINS[2]], [-1.0, -4.5, Math.PI, 1, SKINS[3]], [1.0, -4.2, Math.PI, 2, SKINS[4]]];
  for (const [x, z, ry, tt, sk] of P) { b.push(); b.translate(x, 0, z); b.rotY(ry); sportFig(b, 1, tt, sk, 'up'); b.pop(); }
  // ball (BOB 3.25), centre height 2.2
  b.sway = 3.25; b.tint = 0; b.ellip(0, 2.2, 0, 0.12, 0.12, 0.12, 6, 4, hex(0xf6e7a8)); b.sway = 0;
  // a water bottle and a towel at the side
  b.box(4.9, 0, 1.2, 0.1, 0.26, 0.1, hex(0x5fb0e8)); b.tint = 1; b.box(5.3, 0.01, -1.0, 0.8, 0.02, 1.5, WHITE); b.tint = 0;
  return b.build();
}
// football on the sand: two passers (ball along z, air passes) + up to three extra players (1.1 / 1.2 / 1.3)
function footGeo() {
  const b = new Builder({ tint: true });
  b.push(); b.translate(0, 0, 5.75); sportFig(b, 1, 1, SKINS[1], 'ready'); b.pop();
  b.push(); b.translate(0.2, 0, -5.75); b.rotY(Math.PI); sportFig(b, 1, 2, SKINS[2], 'ready'); b.pop();
  const X = [[2.7, 1.6, Math.PI / 2, 1.1, 1, SKINS[3]], [-2.9, -1.9, -Math.PI / 2, 1.2, 2, SKINS[0]], [3.1, -3.0, Math.PI / 2 + 0.4, 1.3, 1, SKINS[4]]];
  for (const [x, z, ry, code, tt, sk] of X) { b.push(); b.translate(x, 0, z); b.rotY(ry); sportFig(b, code, tt, sk, 'ready'); b.pop(); }
  // ball (BOB 3.45) and sandal "goal posts"
  b.sway = 3.45; b.tint = 0; b.ellip(0, 0.13, 0, 0.12, 0.12, 0.12, 6, 4, WHITE); b.box(0, 0.13, 0, 0.13, 0.05, 0.05, hex(0x222222)); b.sway = 0;
  for (const z of [-7.0, 7.0]) for (const x of [-1.1, 1.1]) b.box(x, 0, z, 0.14, 0.05, 0.3, hex(0x3a3d44));
  return b.build();
}
// one table with two chairs (along local z) and up to two seated diners
function tableSet(b, x, y, z, rot, occ, k) {
  b.push(); b.translate(x, y, z); b.rotY(rot); b.tint = 0;
  b.cyl(0, 0, 0, 0.05, 0.05, 0.72, 5, METAL, { cap: false });
  b.cyl(0, 0.72, 0, 0.4, 0.4, 0.04, 8, hex(0xf4f0e6));
  b.box(0.12, 0.76, 0.06, 0.07, 0.09, 0.07, k % 2 ? hex(0x6b4430) : hex(0xb8d8e8));
  b.box(-0.1, 0.76, -0.12, 0.2, 0.02, 0.2, hex(0xfafafa));
  for (const s of [-1, 1]) {
    b.push(); b.translate(0, 0, s * 0.62); if (s < 0) b.rotY(Math.PI);
    b.box(0, 0, 0, 0.42, 0.45, 0.42, WOOD, { skipBottom: true });
    b.box(0, 0.45, 0.19, 0.42, 0.45, 0.04, WOOD);
    const j = s < 0 ? 0 : 1;
    if (occ[j]) seated(b, 0.47, 0, SKINS[(k * 2 + j) % SKINS.length], DINER[(k * 3 + j * 5) % DINER.length]);
    b.pop();
  }
  b.pop();
}
// beach restaurant (v2.5.11).
// Local: x = 0 is the BOULEVARD glass facade (with a central entrance); the building runs toward -x
// (the sea). The terrace is on the SEA side of the indoor room. v2.5.11: the sea-facing wall is OPEN
// (no glass in the centre) with a decorated path / steps down onto the sand. Glass panes
// (Builder.wet > 1.4) are emitted LAST. level 0 full, 1 LOW (fewer tables, denser glass), 2 far shell.
function restoGeo(level) {
  const b = new Builder({ tint: true });
  const wall = hex(0xf1e6d2), wood = hex(0xa87a4e), deckC = hex(0xc49a6a), tile = hex(0xb9a48a), roofC = hex(0xd8cdbd);
  const frame = hex(0xe8e0d2), sill = hex(0xd4cbb8), door = hex(0x6b5340);
  const stone = mix3(sill, hex(0xc2b59a), 0.4), pathCol = mix3(deckC, hex(0xd2b48c), 0.35), rope = hex(0x6b4a2e);
  const gWet = level === 1 ? 1.92 : level === 2 ? 1.72 : 1.48;
  const pane = (cx, y0, cz, sx, sy, sz) => {
    const w0 = b.wet; b.wet = gWet;
    b.box(cx, y0, cz, sx, sy, sz, hex(0x9eb8c6), { skipBottom: true, top: hex(0xb8d0dc) });
    b.wet = w0;
  };
  // approximate sand height for path steps (baked at site x ≈ -5.55)
  const pathY = (lx) => sandY(-5.55 + lx, 0, 0);
  b.tint = 0; b.wet = 0;
  // floors: indoor next to the boulevard, terrace further toward the sea
  b.box(-1.85, -0.35, 0, 3.9, 0.55, 11.2, mul(tile, 0.8), { top: tile });              // indoor (x -3.8 .. 0.1)
  b.box(-5.55, -0.35, 0, 3.5, 0.53, 11.2, mul(deckC, 0.8), { top: deckC });            // sea-side terrace (x -7.3 .. -3.8)
  // opaque skirts (sea sill OPEN in the centre for the path)
  b.box(0.05, -0.3, 0, 0.22, 0.55, 11.2, sill, { skipBottom: true });                  // boulevard sill
  for (const [z0, z1] of [[-5.5, -1.9], [1.9, 5.5]]) {
    const mid = (z0 + z1) / 2, len = z1 - z0;
    b.box(-7.35, -0.3, mid, 0.22, 0.55, len, sill, { skipBottom: true });
  }
  for (const s of [-1, 1]) b.box(-3.7, -0.3, s * 5.5, 7.3, 0.55, 0.22, sill, { skipBottom: true });
  // boulevard facade pillars (leave a clear doorway in the centre)
  for (const z of [-5.5, -2.15, 2.15, 5.5]) b.box(0.0, 0.2, z, 0.26, 3.15, 0.26, wall, { skipBottom: true });
  // door frame (central entrance in the boulevard glass wall)
  for (const z of [-1.05, 1.05]) b.box(0.02, 0.2, z, 0.14, 2.45, 0.14, door, { skipBottom: true });
  b.box(0.02, 2.55, 0, 0.16, 0.12, 2.2, door, { skipBottom: true }); // lintel
  // slightly open door leaf (hinged to +z side), readable as an entrance
  b.push(); b.translate(0.05, 0.2, 0.95); b.rotY(-0.55);
  b.box(0.55, 0, 0, 1.1, 2.35, 0.06, mul(door, 1.08), { skipBottom: true, top: mul(door, 1.15) });
  b.box(0.95, 1.05, -0.04, 0.08, 0.08, 0.08, hex(0xc9a227)); // knob
  b.pop();
  // sea-side corner posts (opening stays clear between |z| < ~1.85)
  for (const z of [-5.5, 5.5]) {
    b.box(-7.35, 0.25, z, 0.22, 3.1, 0.22, wall, { skipBottom: true });
    b.box(-3.8, 0.25, z, 0.18, 3.1, 0.18, frame, { skipBottom: true });
  }
  // posts framing the sea-side opening
  for (const z of [-1.85, 1.85]) b.box(-7.35, 0.25, z, 0.16, 3.05, 0.16, wall, { skipBottom: true });
  // mullions (boulevard facade skips the door gap; sea facade skips the open centre)
  const mullZ = level === 2 ? [-3.7, 3.7] : [-4.4, -2.9, 2.9, 4.4];
  for (const z of mullZ) b.box(0.0, 0.25, z, 0.1, 3.05, 0.1, frame, { skipBottom: true });
  for (const z of (level === 2 ? [-3.7, 3.7] : [-4.4, -2.9, 2.9, 4.4])) b.box(-7.35, 0.25, z, 0.1, 3.05, 0.1, frame, { skipBottom: true });
  for (const s of [-1, 1]) for (const x of [-6.4, -4.9, -2.5, -0.9]) b.box(x, 0.25, s * 5.5, 0.1, 3.05, 0.1, frame, { skipBottom: true });
  // rails — boulevard full; sea-side split around the opening; sides full
  b.box(0.0, 1.55, 0, 0.12, 0.1, 11.0, frame, { skipBottom: true });
  b.box(0.0, 3.05, 0, 0.14, 0.12, 11.1, wall, { skipBottom: true });
  for (const [z0, z1] of [[-5.45, -1.95], [1.95, 5.45]]) {
    const mid = (z0 + z1) / 2, len = z1 - z0;
    b.box(-7.35, 1.55, mid, 0.12, 0.1, len, frame, { skipBottom: true });
    b.box(-7.35, 3.05, mid, 0.14, 0.12, len, wall, { skipBottom: true });
  }
  // header beam over the sea-side opening (keeps the roof; wall stays open below)
  b.box(-7.35, 3.05, 0, 0.16, 0.14, 4.0, wall, { skipBottom: true });
  for (const s of [-1, 1]) {
    b.box(-3.7, 1.55, s * 5.5, 7.2, 0.1, 0.12, frame, { skipBottom: true });
    b.box(-3.7, 3.05, s * 5.5, 7.25, 0.12, 0.14, wall, { skipBottom: true });
  }
  b.box(0.0, 2.75, 0, 0.3, 0.55, 11.2, wall); // boulevard header
  b.box(-3.7, 3.35, 0, 7.6, 0.22, 11.8, mul(roofC, 0.85), { top: roofC });
  // sign + awning over the boulevard entrance
  b.tint = 1; b.box(0.12, 3.55, 0, 0.12, 0.58, 5.4, WHITE); b.tint = 0;
  for (let k = 0; k < 6; k++) b.box(0.2, 3.7, -1.9 + k * 0.76, 0.03, 0.28, 0.42, hex(0xfdfbf5), { skipBottom: true });
  b.push(); b.translate(0.85, 2.88, 0); b.rotZ(0.28);
  for (let k = 0; k < 10; k++) { b.tint = k % 2 ? 0 : 1; b.box(0, 0, -5.4 + k * 1.08 + 0.54, 1.7, 0.06, 1.08, WHITE); }
  b.pop(); b.tint = 0;
  // sea-side terrace railing (open in the middle toward the sand / path)
  for (const s of [-1, 1]) {
    b.box(-7.3, 1.0, s * 3.55, 0.06, 0.06, 3.9, WHITE);
    for (let k = 0; k < 3; k++) b.box(-7.3, 0.18, s * (2.0 + k * 1.4), 0.06, 0.85, 0.06, WHITE, { skipBottom: true });
  }
  for (const s of [-1, 1]) { b.box(-7.0, 0.18, s * 5.25, 0.5, 0.45, 0.5, hex(0x9a6a44), { skipBottom: true }); b.cyl(-7.0, 0.63, s * 5.25, 0.3, 0.06, 0.6, 6, GREEN); }

  // v2.5.11: terrace ↔ sand path (steps + plank ramp through the open sea wall)
  {
    const half = 1.55;
    // wood lip at the terrace mouth
    b.box(-7.45, -0.08, 0, 0.4, 0.12, half * 2.05, mul(wood, 1.05), { skipBottom: true, top: wood });
    // stepped planks down onto the sand
    const steps = level === 2
      ? [[-8.1, 0.9], [-9.2, 1.15], [-10.5, 1.35], [-11.8, 1.5]]
      : [[-7.85, 0.75], [-8.45, 0.9], [-9.15, 1.05], [-9.95, 1.2], [-10.85, 1.35], [-11.9, 1.5]];
    for (let i = 0; i < steps.length; i++) {
      const [lx, wz] = steps[i];
      const yTop = Math.max(pathY(lx) + 0.05, -0.22 - i * 0.045);
      const h = 0.1;
      const w = half * (1.95 - i * 0.08);
      b.box(lx, yTop - h * 0.5, 0, wz, h, w * 2, mix3(pathCol, hex(0xcbb89a), i / steps.length), { skipBottom: true, top: mix3(deckC, hex(0xd8c4a0), 0.25 + i * 0.08) });
      // stone edge rails
      if (level !== 2) for (const s of [-1, 1]) b.box(lx, yTop + 0.01, s * (w - 0.06), wz * 0.92, 0.04, 0.12, stone, { skipBottom: true });
    }
    // sand tongue beyond the last step
    if (level !== 2) {
      const xa = -12.4, xb = -14.2, ya = pathY(xa) + 0.03, yb = pathY(xb) + 0.02;
      const wa = half * 1.35, wb = half * 1.05;
      b.quad([xa, ya, -wa], [xb, yb, -wb], [xb, yb, wb], [xa, ya, wa], mix3(pathCol, hex(0xd2b48c), 0.7));
    }
    // posts + rope along the path
    const posts = level === 2
      ? [[-7.6, 1.55], [-7.6, -1.55], [-10.2, 1.25], [-10.2, -1.25]]
      : [[-7.55, 1.65], [-7.55, -1.65], [-9.0, 1.45], [-9.0, -1.45], [-10.8, 1.25], [-10.8, -1.25], [-12.6, 1.05], [-12.6, -1.05]];
    for (const [px, pz] of posts) {
      const py = pathY(px) + 0.02;
      b.cyl(px, py, pz, 0.045, 0.04, 0.78, level === 2 ? 4 : 6, wood, { cap: true, top: mul(wood, 1.1) });
    }
    if (level === 0) {
      for (const side of [1, -1]) {
        for (const [ax, az, bx, bz] of [[-7.55, 1.65, -9.0, 1.45], [-9.0, 1.45, -10.8, 1.25], [-10.8, 1.25, -12.6, 1.05]]) {
          const y0 = pathY(ax) + 0.5, y1 = pathY(bx) + 0.48;
          b.limb(ax, y0, az * side, bx, y1, bz * side, 0.018, 0.016, 4, rope, { cap: false });
        }
      }
      // painted markers on the terrace approach to the opening
      for (const s of [-0.55, 0, 0.55]) b.box(-6.95, -0.05, s * 0.7, 0.28, 0.02, 0.1, mix3(WHITE, hex(0xe8a020), 0.35), { skipBottom: true });
      // planters flanking the path mouth on the sand
      for (const s of [-1, 1]) {
        b.box(-12.9, pathY(-12.9) + 0.12, s * 1.55, 0.42, 0.38, 0.42, hex(0x9a6a44), { skipBottom: true });
        b.cyl(-12.9, pathY(-12.9) + 0.45, s * 1.55, 0.22, 0.05, 0.35, 6, GREEN);
      }
    }
  }

  if (level !== 2) {
    // indoor counter against the north side wall (leaves centre free for waiters / door)
    b.ao = 0.62; b.sunBoost = 0.35;
    b.box(-1.9, 0.2, -4.3, 2.8, 1.0, 0.55, mul(wood, 0.85), { skipBottom: true, top: wood });
    b.box(-1.9, 1.55, -4.55, 2.6, 0.05, 0.18, wood);
    if (level === 0) for (let k = 0; k < 10; k++) b.box(-3.0 + k * 0.28, 1.6, -4.55, 0.08, 0.24, 0.08, [hex(0x3f7f3a), hex(0x9a3a2a), hex(0xd8c070), hex(0x2a4a7a)][k % 4], { skipBottom: true });
    const inZ = level === 0 ? [-2.6, 0.4, 3.2] : [-2.0, 2.4];
    inZ.forEach((z, k) => tableSet(b, -1.9, 0.2, z, Math.PI / 2, [true, k !== 1 || level === 1], k + 1));
    b.ao = 2.6; b.sunBoost = 0;
    for (const z of inZ) b.box(-1.9, 2.55, z, 0.18, 0.12, 0.18, hex(0xffe6a8));
    b.ao = 1; b.sunBoost = 1;
    // terrace tables on the SEA side (kept clear of the centre path |z| < 1.6)
    const outZ = level === 0 ? [-4.4, -2.6, 2.6, 4.4] : [-3.8, 3.8];
    outZ.forEach((z, k) => tableSet(b, -5.5, 0.18, z, Math.PI / 2, [true, k % 3 !== 2], k + 4));
    if (level === 0) for (const z of [-3.5, 3.5]) { b.cyl(-5.5, 0.18, z, 0.04, 0.04, 2.4, 5, WHITE, { cap: false }); b.tint = 2; b.cyl(-5.5, 2.45, z, 1.45, 0.05, 0.5, 8, WHITE); b.tint = 0; }
    // v2.5.10: two waiters inside (near the door and near the counter)
    b.push(); b.translate(-0.85, 0.2, 0.15); b.rotY(Math.PI / 2); sportFig(b, 1, 0, SKINS[1], 'tray'); b.pop();
    b.box(-0.85 - 0.38, 1.2, 0.15, 0.34, 0.03, 0.34, METAL);
    b.push(); b.translate(-2.4, 0.2, -3.2); b.rotY(Math.PI * 0.15); sportFig(b, 1, 2, SKINS[3], 'tray'); b.pop();
    b.box(-2.4 + 0.35, 1.2, -3.2, 0.34, 0.03, 0.34, METAL);
  }

  // glass LAST — boulevard facade has a door gap; sea facade OPEN in the centre (wings only); sides full
  const y0 = 0.25, sy = 2.85;
  // sea-side glass wings only (opening |z| < 1.85 stays clear onto the path)
  for (const [z0, z1] of [[-5.35, -2.0], [2.0, 5.35]]) {
    const mid = (z0 + z1) / 2, len = z1 - z0;
    pane(-7.35, y0, mid, 0.06, sy, len - 0.1);
  }
  for (const s of [-1, 1]) pane(-3.7, y0, s * 5.5, 7.1, sy, 0.06); // long side walls
  // boulevard glass left and right of the entrance (door gap |z| < 1.05 stays open)
  for (const [z0, z1] of [[-5.35, -1.2], [1.2, 5.35]]) {
    const mid = (z0 + z1) / 2, len = z1 - z0;
    pane(0.0, y0, mid, 0.05, sy, len - 0.1);
  }
  // low transom glass above the door
  pane(0.0, 2.7, 0, 0.05, 0.4, 2.0);
  b.wet = 0;
  return b.build();
}

// Per-preset density (per LOD0 chunk; riders are a pool around the camera).
// v2.5.5: part of the cyclists / scooters became rollerbladers, skateboarders and surfers (bike lane),
// plus sea bathers with a wave surfer further out (sea) per chunk, and a pool of beach goers (walk kit, no extra draw).
const DENSITY = {
  LOW:    { sun: 5, walk: 5, bench: 2, sit: 6, camp: 0, matkot: 0, cafe: 0, street: 0, cyc: 2, sco: 0, blade: 1, skate: 0, surf: 0, sea: 0, goers: 3, leaves: 0, boats: 3, dinghies: 0 },
  MEDIUM: { sun: 5, walk: 6, bench: 2, sit: 6, camp: 2, matkot: 0, cafe: 0, street: 1, cyc: 2, sco: 1, blade: 1, skate: 1, surf: 1, sea: 1, goers: 4, leaves: 36, boats: 5, dinghies: 2 },
  HIGH:   { sun: 8, walk: 10, bench: 3, sit: 10, camp: 3, matkot: 1, cafe: 2, street: 2, cyc: 3, sco: 2, blade: 2, skate: 2, surf: 1, sea: 2, goers: 6, leaves: 70, boats: 6, dinghies: 3 },
  ULTRA:  { sun: 10, walk: 13, bench: 3, sit: 12, camp: 4, matkot: 2, cafe: 3, street: 2, cyc: 4, sco: 3, blade: 3, skate: 2, surf: 2, sea: 3, goers: 8, leaves: 100, boats: 8, dinghies: 4 },
};
const CHUNK_KITS = ['sun', 'walk', 'bench', 'sit', 'camp', 'matkot', 'cafe', 'street', 'sea'];
const RIDER_KINDS = ['cyc', 'sco', 'blade', 'skate', 'surf'];
const RIDER_ID = { cyc: 1, sco: 2, blade: 3, skate: 4, surf: 5 };
// v2.5.6 free will on the bike lane: speed range per kind (m/s); riders choose pace, lane position,
// a slow look at the beach, skaters stop and go, and riders may tag along behind another for a while.
const VR = { cyc: [5, 7.5], sco: [4, 6], blade: [4.5, 6.5], skate: [3.5, 5], surf: [1.5, 2.3] };
const dampD = (a, b, k, dt) => a + (b - a) * (1 - Math.exp(-k * dt));

// cafes and kiosks per chunk variant (must match world.js buildChunk)
function cafesFor(v) { return v % 2 === 0 ? [[-8, 12], [9, 11]] : [[9, 10], [-9.5, 4]]; }

export function decorTris() { const o = {}; for (const [k, f] of Object.entries({ sun: sunbatherGeo, bench: benchKitGeo, sit: sitterGeo, camp: campGeo, matkot: matkotGeo, cafe: cafeSetGeo, street: streetGeo, cyc: cyclistGeo, sco: scooterGeo, blade: () => bladerGeo(false), skate: () => skaterGeo(false), surf: surferWalkGeo, sea: seaBathersGeo })) { const g = f(); o[k] = g.attributes.position.count / 3; } return o; }

// v2.5.8 beach sites, fixed in world z (independent of the chunk RNG): restaurants every ~250 m (beach side
// of the sea wall, next to a crossing), volleyball every ~300 m, football every ~180 m, racquet (matkot)
// couples every ~200 m. LOW keeps every other volleyball court / football group and fewer players.
const SITES = { resto: { every: 250, off: 130 }, volley: { every: 300, off: 75 }, foot: { every: 180, off: 35 }, matkot: { every: 200, off: 175 } };
const SITE_ORDER = ['resto', 'volley', 'foot', 'matkot'];
const RESTO_COL = [0, 1, 2, 3, 6, 8, 9];
const RESTO_DINERS = 3; // v2.5.11: walkers who stroll terrace ↔ sand via the open sea wall

// static beach things baked into the chunk meshes (umbrellas + sunbeds, lifeguard tower, old volleyball net)
function beachBusy(x0, x1, z0, z1) {
  const c0 = Math.floor(-z1 / L), c1 = Math.floor(-z0 / L);
  for (let ci = c0; ci <= c1; ci++) {
    const v = chunkVariant(ci), cz = -(ci + 0.5) * L;
    for (const u of chunkUmbrellas(v, true)) { if (u.cafe) continue; const uz = cz + u.z; if (u.x + 1.8 > x0 && u.x - 1.8 < x1 && uz + 1.5 > z0 && uz - 1.5 < z1) return true; }
    if (v % 3 === 0 && -17.6 > x0 && -22.4 < x1 && cz + 7.2 > z0 && cz + 2.6 < z1) return true;
    if (v === 4 && -25.4 > x0 && -26.6 < x1 && cz + 6.4 > z0 && cz - 3.4 < z1) return true;
  }
  return false;
}

export class Decor {
  constructor(scene) {
    this.scene = scene;
    // v2.5: tiers per kit [near, mid (v2.4), far]; builders are called per preset (fresh geometry)
    this.builders = {
      sun: [null, sunbatherGeo, null], bench: [benchKitNearGeo, benchKitGeo, null], sit: [sitterNearGeo, sitterGeo, null],
      camp: [null, campGeo, null], matkot: [null, matkotGeo, null], cafe: [cafeSetNearGeo, cafeSetGeo, null], street: [null, streetGeo, null],
      cyc: [cyclistNearGeo, cyclistGeo, cyclistFarGeo], sco: [null, scooterGeo, null],
      blade: [() => bladerGeo(true), () => bladerGeo(false), null], skate: [() => skaterGeo(true), () => skaterGeo(false), null],
      surf: [null, surferWalkGeo, null], sea: [null, seaBathersGeo, null],
      walk: [() => personNearGeometry(), () => personGeometry(false), () => personFarGeometry()],
      // v2.5.8 beach sites (mid tier everywhere, restaurant far shell on presets with a far tier)
      resto: [null, () => restoGeo(this.lowSites ? 1 : 0), () => restoGeo(2)], volley: [null, volleyGeo, null], foot: [null, footGeo, null],
    };
    this.siteCache = new Map(); this.siteLive = []; this.siteKey = null;
    this.mat = bakedMaterial({ tint: true, bob: true, lodFade: true });
    this.restoMat = bakedMaterial({ tint: true, bob: true, lodFade: true, glass: true }); // v2.5.9 see-through cafe panes
    this.walkMat = bakedMaterial({ rig: true, tint: true, wet: true, decorWalk: true, lodFade: true });
    this.walkNearMat = bakedMaterial({ rig: true, tint: true, wet: true, decorWalk: true, lodFade: true, nearVar: true });
    this.kits = {}; this.slots = []; this.riders = []; this.movers = []; this.goers = [];
    this.leafMat = this.makeLeafMaterial();
    this.onBell = null;
    this.lodFor = null; // world chunk LOD lookup (set by main): decor lives in LOD0 / near chunks only
  }
  applyPreset(p) {
    this.preset = p;
    const d = this.d = DENSITY[p.name] || DENSITY.LOW;
    for (const k of Object.values(this.kits)) k.set.dispose();
    if (this.leaves) { this.scene.remove(this.leaves); this.leaves.dispose(); this.leaves = null; }
    for (const m of (this.boatMeshes || [])) { this.scene.remove(m); m.dispose(); }
    this.boatMeshes = []; this.boats = [];
    this.kits = {};
    this.D = Math.ceil((p.lod0 + L) / L) + 3;
    const lv = p.lod.decor; // which tiers this preset uses
    // v2.5.8 beach sites: range and pool sizes (LOW: shorter range, fewer courts / players, simpler restaurants)
    this.lowSites = p.name === 'LOW';
    this.siteRange = p.name === 'LOW' ? 130 : p.name === 'MEDIUM' ? 190 : p.name === 'HIGH' ? 240 : 290;
    this.siteCap = {}; for (const [tp, S] of Object.entries(SITES)) this.siteCap[tp] = Math.ceil((this.siteRange + 30) / S.every) + 1;
    this.siteKey = null; this.siteLive = [];
    const mk = (name, per) => {
      const extra = name === 'matkot' ? this.siteCap.matkot : 0; // v2.5.8 site couples ride after the chunk ones
      if (per <= 0 && extra <= 0) return;
      const n = per * (RIDER_KINDS.includes(name) ? 1 : this.D) + (name === 'walk' ? (d.goers || 0) + RESTO_DINERS : 0) + extra;
      const walk = name === 'walk';
      const tiers = this.builders[name].map((f, t) => (f && lv[t] ? { geo: f(), mat: walk ? (t === 0 ? this.walkNearMat : this.walkMat) : this.mat } : null));
      if (!tiers[1]) tiers[1] = { geo: this.builders[name][1](), mat: walk ? this.walkMat : this.mat };
      const set = new TieredSet(this.scene, { cap: n, tiers, attrs: walk ? { aAnim: 4, aVar: 4 } : {}, name });
      this.kits[name] = { set, per };
    };
    for (const k of CHUNK_KITS) mk(k, d[k]);
    for (const k of RIDER_KINDS) mk(k, d[k] || 0);
    for (const name of ['resto', 'volley', 'foot']) { // v2.5.8 site kits: one small recycled pool each
      const mat = name === 'resto' ? this.restoMat : this.mat; // v2.5.9: restaurants use the glass material
      const tiers = this.builders[name].map((f, t) => (f && (t === 1 || lv[t]) ? { geo: f(), mat } : null));
      this.kits[name] = { set: new TieredSet(this.scene, { cap: this.siteCap[name], tiers, name }), per: 0, site: true };
    }
    this.slots = Array.from({ length: this.D }, () => ({ index: -1e9, shown: false, movers: [] }));
    this.setLodScale(this.lodScale || 1);
    // riders pool
    this.riders = [];
    this.wr = makeRng(0x5eed256); // v2.5.6 free-will choices (decor only, never the game RNG)
    this.willSlow = p.name === 'LOW' ? 1.5 : 1; this.riderSocial = p.name !== 'LOW';
    this.willStats = { pace: 0, lane: 0, look: 0, stop: 0, together: 0, out: 0, deeper: 0, stay: 0, ret: 0 };
    const rr = makeRng(0xb1c7c1e);
    for (const kind of RIDER_KINDS) for (let i = 0; i < (d[kind] || 0); i++) this.riders.push({ kind, i, rng: rr, z: 1e9, x: 0, dir: 1, v: 6, lastDz: 0 });
    // v2.5.5 beach goers: walkers who left the deck for the sea (extra walk-kit instances after the chunk ones)
    this.goers = [];
    if (this.kits.walk) for (let k = 0; k < (d.goers || 0); k++) { const i = this.kits.walk.per * this.D + k; this.goers.push({ i, on: false, x: 0, z: 0, tx: -48, v: 2.2, wade: false }); this.kits.walk.set.hide(i); }
    // v2.5.11: a few diners stroll the restaurant terrace ↔ sand path (decor free-will stream; aicore untouched)
    this.diners = [];
    if (this.kits.walk) for (let k = 0; k < RESTO_DINERS; k++) {
      const i = this.kits.walk.per * this.D + (d.goers || 0) + k;
      this.diners.push({ i, on: false, x: 0, z: 0, siteK: -1, state: 'idle', hold: 2 + k * 3, dir: -1, v: 1.05 });
      this.kits.walk.set.hide(i);
    }
    this.willStats.diner = 0;
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
    // v2.5.7 offshore boats: sailboats + dinghies, each one InstancedMesh (shared mat/bob), far on the sea
    this.boats = []; this.boatMeshes = [];
    const SAIL_COLS = [0xf2efe8, 0xe8f0f5, 0xf7e2c4, 0xd6e8f0, 0xf0d4c8];
    const mkFleet = (geo, n, kind, seed) => {
      if (n <= 0) return;
      const mesh = new THREE.InstancedMesh(geo, this.mat, n);
      mesh.frustumCulled = false; mesh.count = n; mesh.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
      mesh.setColorAt(0, new THREE.Color(1, 1, 1));
      this.scene.add(mesh); this.boatMeshes.push(mesh);
      const br = makeRng(seed);
      for (let i = 0; i < n; i++) {
        const col = new THREE.Color(SAIL_COLS[br.int(0, SAIL_COLS.length - 1)]);
        mesh.setColorAt(i, col);
        this.boats.push({
          mesh, i, kind,
          x: br.range(-165, -85), z: 1e9,
          yaw: br.range(-0.5, 0.5) + (br.chance(0.5) ? Math.PI : 0),
          v: kind === 'sail' ? br.range(0.35, 0.9) : br.range(0.8, 1.6),
          dir: br.chance(0.55) ? -1 : 1,
          s: kind === 'sail' ? br.range(0.85, 1.35) : br.range(0.7, 1.1),
          ph: br.range(0, 6.28),
        });
      }
      if (mesh.instanceColor) mesh.instanceColor.needsUpdate = true;
    };
    mkFleet(sailboatGeo(), d.boats || 0, 'sail', 0xb0a757);
    mkFleet(dinghyGeo(), d.dinghies || 0, 'dinghy', 0xd116771);
  }
  // v2.5: LOD distances follow the preset, scaled down first by the adaptive safety net
  setLodScale(k) {
    this.lodScale = k;
    const c = this.preset.lod, f = c.fade;
    for (const [name, kit] of Object.entries(this.kits)) {
      const big = name === 'bench' || name === 'cafe';
      kit.set.configure({ near: (big ? c.nearProp : c.near) * k, nearMax: Math.max(0, Math.round((big ? c.nearPropMax : c.nearMax) * k)), far: c.far / Math.max(0.5, k) * (name === 'walk' ? 0.8 : name === 'resto' ? 2.4 : 1), hyst: c.hyst, fade: f });
    }
  }
  makeLeafMaterial() {
    return new THREE.ShaderMaterial({
      side: THREE.DoubleSide,
      uniforms: { uTime: U.uTime, uWind: U.uWind, uAmb: U.uAmb, uSun: U.uSun, uCam: { value: new THREE.Vector3() }, uAmount: { value: 0 } },
      vertexShader: `attribute vec4 aSeed; uniform float uTime; uniform vec4 uWind; uniform vec3 uCam; uniform float uAmount; varying vec3 vC;
        float gustD(float z, float t) { float u = z + t * 18.0 - 17.4922 + 34.9858; return u - floor(u / 69.9716) * 69.9716 - 34.9858; }
        float windGust(float z, float t) { float d = gustD(z, t); float u = z + t * 18.0; return exp(-d * d / 82.81) * (0.55 + 0.45 * sin(u * 0.031 + 1.7)); }
        float gustFlow(float z, float t) { float x = gustD(z, t) / 9.1; float u = z + t * 18.0; return -x * exp(-x * x) * 2.3316 * (0.55 + 0.45 * sin(u * 0.031 + 1.7)); }
        void main() {
          if (aSeed.w > uAmount) { vC = vec3(0.0); gl_Position = vec4(0.0, 0.0, 2.0, 1.0); return; }
          float t = uTime;
          float zw = uCam.z - 48.0 + mod(aSeed.z * 58.0 - uCam.z, 58.0);
          float g = windGust(zw, t), fl = gustFlow(zw, t);
          float x = mod(aSeed.x * 32.0 + t * (2.0 + 7.0 * uWind.w) * (0.7 + 0.6 * aSeed.y), 32.0) - 14.0 + g * 2.5;
          float y = 2.2 + mod(aSeed.y * 7.5 - t * (0.35 + 0.35 * aSeed.x), 7.5) + sin(t * 3.0 + aSeed.x * 20.0) * 0.3;
          // v2.5.4 critical-point gust: the front is a SOURCE (leaves pushed outward / inland), the tail a
          // SINK (pulled back), and inside the gust the leaves near a vortex line over the deck (centre
          // x 1, y 4.5) spiral around it and are drawn inward: Gaussian vortex, strongest within ~6 m.
          x += 1.8 * fl * (0.4 + 0.6 * uWind.w);
          vec2 rv = vec2(x - 1.0, y - 4.5);
          float sp = g * (0.6 + 0.8 * uWind.w), core = exp(-dot(rv, rv) / 36.0);
          float th = 1.6 * sp * core * (aSeed.w > 0.5 ? 1.0 : 0.8);
          rv = mat2(cos(th), sin(th), -sin(th), cos(th)) * rv * (1.0 - 0.3 * sp * core);
          x = 1.0 + rv.x; y = max(0.15, 4.5 + rv.y);
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

  // ---------- v2.5.8 beach sites ----------
  // one site of a type (deterministic in k; null if skipped). Fields: x, y, z, yaw, scale, col, box, lowSkip
  siteAt(type, k) {
    const key = type + ':' + k;
    if (this.siteCache.has(key)) return this.siteCache.get(key);
    const S = SITES[type], h = (n) => hash2(k * 7 + n, type.length * 131 + 17);
    const zr = -(S.off + k * S.every + (h(1) - 0.5) * 24);
    let s = null;
    const mkS = (x, z, yaw, hx, hz, extra) => Object.assign({ type, k, x, z, yaw, scale: 1, col: RESTO_COL[Math.floor(h(2) * RESTO_COL.length)], box: { x0: x - hx, x1: x + hx, z0: z - hz, z1: z + hz }, lowSkip: false }, extra || {});
    if (type === 'resto') {
      // v2.5.11: local x=0 is the boulevard glass facade; sea wall open + path onto sand
      const c = nearestCrossing(zr, -1);
      for (const zc of [c - 7.6, c + 7.6, c - 27, c + 27]) if (!beachBusy(-18.8, -5.2, zc - 6.2, zc + 6.2)) { s = mkS(-5.55, zc, 0, 0, 0); break; }
      if (!s) s = mkS(-5.55, c - 7.6, 0, 0, 0);
      s.box = { x0: -18.6, x1: -5.2, z0: s.z - 5.9, z1: s.z + 5.9 }; s.y = 0; // v2.5.11: cover terrace↔sand path
    } else {
      // try across the view first (yaw pi/2: ball flies sea <-> promenade), mid beach; fall back to the wet sand
      const mid = type === 'volley' ? [-20, -23, -26, -17] : type === 'foot' ? [-19, -22, -25, -16] : [-15.5, -18, -21, -24];
      const [lx, lz] = type === 'volley' ? [4.8, 8.6] : type === 'foot' ? [3.6, 7.4] : [1.0, 3.4]; // local half extents when yaw ~pi/2
      for (const dz of [0, 10, -10, 20, -20, 30, -30]) {
        for (const x of mid) {
          const z = zr + dz;
          if (!beachBusy(x - lz, x + lz, z - lx, z + lx) && !this.siteClash(type, x - lz, x + lz, z - lx, z + lx)) {
            s = mkS(x, z, Math.PI / 2 + (h(4) - 0.5) * 0.25, lz, lx); break;
          }
        }
        if (s) break;
      }
      // wet-sand fallback (still mid-beach if possible), facing along the shore
      if (!s) {
        for (const x of [-32, -35, -28, -38]) {
          if (!beachBusy(x - lx, x + lx, zr - lz, zr + lz) && !this.siteClash(type, x - lx, x + lx, zr - lz, zr + lz)) {
            s = mkS(x, zr, (h(4) - 0.5) * 0.2, lx, lz); break;
          }
        }
        if (!s) s = mkS(type === 'volley' ? -36 : type === 'foot' ? -37 : -34, zr, 0, lx, lz);
      }
      const ci = Math.floor(-s.z / L);
      s.y = sandY(s.x, s.z + (ci + 0.5) * L, chunkVariant(ci));
      if (type === 'foot') { const extra = Math.floor(h(3) * 4); s.extra = extra; s.extraLow = Math.min(1, extra); }
      if ((type === 'volley' || type === 'foot') && k % 2 === 1) s.lowSkip = true;
    }
    this.siteCache.set(key, s);
    if (this.siteCache.size > 600) this.siteCache.delete(this.siteCache.keys().next().value);
    return s;
  }
  // overlap with sites of the types placed before this one (deterministic order: resto, volley, foot, matkot)
  siteClash(type, x0, x1, z0, z1) {
    for (const o of SITE_ORDER) {
      if (o === type) break;
      const S = SITES[o], kc = Math.round((-(z0 + z1) / 2 - S.off) / S.every);
      for (let k = kc - 1; k <= kc + 1; k++) {
        if (k < 0) continue; const s = this.siteAt(o, k); if (!s) continue; const b = s.box;
        if (b.x0 - 1 < x1 && b.x1 + 1 > x0 && b.z0 - 1 < z1 && b.z1 + 1 > z0) return true;
      }
    }
    return false;
  }
  // is a beach point inside a site footprint (chunk decor keeps clear of restaurants and courts)
  siteHit(x, z, pad = 0.6) {
    if (x > -5.2) return false;
    for (const o of SITE_ORDER) {
      const S = SITES[o], kc = Math.round((-z - S.off) / S.every);
      for (let k = kc - 1; k <= kc + 1; k++) {
        if (k < 0) continue; const s = this.siteAt(o, k); if (!s || (this.lowSites && s.lowSkip)) continue; const b = s.box;
        if (x > b.x0 - pad && x < b.x1 + pad && z > b.z0 - pad && z < b.z1 + pad) return true;
      }
    }
    return false;
  }
  // place the sites near the camera into their pools (re-evaluated every 4 m of camera travel)
  updateSites(camZ) {
    const key = Math.round(camZ / 4);
    if (key === this.siteKey) return;
    this.siteKey = key;
    const R = this.siteRange, live = [];
    for (const type of SITE_ORDER) {
      const kit = this.kits[type]; if (!kit) continue;
      const S = SITES[type], cap = this.siteCap[type], base = type === 'matkot' ? kit.per * this.D : 0;
      const kA = Math.max(0, Math.floor((-(camZ + 30) - S.off - 30) / S.every)), kB = Math.ceil((-(camZ - R) - S.off + 30) / S.every);
      const used = this._siteUsed || (this._siteUsed = new Uint8Array(16)); used.fill(0);
      for (let k = kA; k <= kB; k++) {
        const s = this.siteAt(type, k);
        if (!s || (this.lowSites && s.lowSkip) || s.z > camZ + 30 || s.z < camZ - R) continue;
        const slot = k % cap; if (used[slot]) continue; used[slot] = 1;
        const sc = type === 'foot' ? 1 + 0.01 * (this.lowSites ? s.extraLow : s.extra) : 1; // extra footballers ride in the scale
        this.put(type, base + slot, s.x, s.y, s.z, s.yaw, sc, s.col);
        live.push(s);
      }
      for (let slot = 0; slot < cap; slot++) if (!used[slot]) kit.set.hide(base + slot);
    }
    this.siteLive = live;
  }

  // ---------- chunk fill ----------
  put(kit, idx, x, y, z, rotY, scale = 1, color = -1) {
    const k = this.kits[kit]; if (!k || idx < 0) return;
    _o.position.set(x, y, z); _o.rotation.set(0, rotY, 0); _o.scale.setScalar(scale); _o.updateMatrix();
    k.set.set(idx, _o.matrix, color >= 0 ? SHIRTS[color % SHIRTS.length] : null);
  }
  // v2.5.8: beach decor keeps clear of restaurants and sports courts (the index is hidden instead)
  putB(kit, idx, x, y, z, rotY, scale = 1, color = -1) {
    if (this.siteHit(x, z)) { const k = this.kits[kit]; if (k && idx >= 0) k.set.hide(idx); return; }
    this.put(kit, idx, x, y, z, rotY, scale, color);
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
      if (r.chance(0.7)) { const i = next('sun'); if (i >= 0) this.putB('sun', i, ux + 0.9, 0.3, cz + uz + 0.2, 0.1 + Math.PI, 1, col()); }
      if (p.rich && r.chance(0.5)) { const i = next('sun'); if (i >= 0) this.putB('sun', i, ux - 0.9, 0.3, cz + uz + 0.1, -0.1 + Math.PI, 1, col()); }
    }
    for (let i = next('sun'); i >= 0; i = next('sun')) { const x = r.range(-35, -9), zl = r.range(-18, 18); this.putB('sun', i, x, sandY(x, zl, variant) + 0.03, cz + zl, r.pick([0, Math.PI]) + r.range(-0.5, 0.5), 1, col()); }
    // beach camps (chair, person, cooler, bag, towel), facing the sea
    for (let i = next('camp'); i >= 0; i = next('camp')) { const x = r.range(-30, -9), zl = r.range(-17, 17); this.putB('camp', i, x, sandY(x, zl, variant), cz + zl, Math.PI / 2 + r.range(-0.5, 0.5), 1, col()); }
    // matkot pairs on the wet sand
    for (let i = next('matkot'); i >= 0; i = next('matkot')) { const x = r.range(-37, -31), zl = r.range(-14, 14); this.putB('matkot', i, x, sandY(x, zl, variant), cz + zl, r.range(-0.3, 0.3), 1, col()); }
    // buffer strip benches between the palms, facing the sea, two people each
    const palmStep = p.rich ? 6.5 : 9.5;
    const bz = []; for (let zz = z0 + 3 + palmStep / 2; zz < L / 2 - 1; zz += palmStep) bz.push(zz);
    for (let i = next('bench'); i >= 0 && bz.length; i = next('bench')) { const zl = bz.splice(r.int(0, bz.length - 1), 1)[0]; this.putB('bench', i, -6.9, sandY(-6.9, zl, variant), cz + zl, Math.PI / 2, 1, col()); }
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
      // v2.5 near-tier variety per figure (own hash, the chunk layout RNG is untouched)
      const setAnim = (i, ph, amp) => { wk.set.setAttr(i, 'aAnim', ph, amp, 0, 0); const hh = hash2(ci * 53 + i, 17); wk.set.setAttr(i, 'aVar', hh < 0.3 ? 1 : 0, hash2(ci * 53 + i, 23) < 0.45 ? 1 : 0, hash2(ci * 53 + i, 29), 0); };
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
        if (!kid && this.siteHit(m.x0, cz + m.zl, 1.5)) m.x0 = -27.5; // v2.5.8: start clear of a restaurant / court
        if (!kid) m.dist = m.x0 + 39; // walk from x0 to the water line at x = -39 and back
        // v2.5.5: about 45% of the beach walkers go on into the sea, wade to waist depth, stay a while, come back
        if (!kid && hash2(ci * 61 + i, 31) < 0.45) { m.wade = true; m.dist = m.x0 + 46.5 + hash2(ci * 61 + i, 37) * 2.5; m.hold = 1.2 + hash2(ci * 61 + i, 41) * 1.6; m.wading = false; }
        m.variant = variant; m.cz0 = cz;
        setAnim(i, r.range(0, 6), kid ? 0.8 : 0.42);
        wk.set.setColor(i, SHIRTS[col()]);
        slot.movers.push(m);
      }
    }
    // v2.5.5 sea bathers in the shallows and surfers out on the swell (own hash RNG: chunk layout untouched)
    const sr = makeRng((hash2(ci, 5151) * 4294967296) >>> 0);
    for (let i = next('sea'); i >= 0; i = next('sea')) this.put('sea', i, sr.range(-51, -47.5), -0.85, cz + sr.range(-15, 15), sr.range(-0.3, 0.3), sr.range(0.95, 1.06), col());
    // hide unused instances of this slot
    for (const kit of CHUNK_KITS) {
      const k = this.kits[kit]; if (!k) continue;
      for (let c = counters[kit] || 0; c < k.per; c++) k.set.hide(base(kit) + c);
    }
  }
  hideSlot(slotI) {
    for (const kit of CHUNK_KITS) {
      const k = this.kits[kit]; if (!k) continue;
      for (let c = 0; c < k.per; c++) k.set.hide(slotI * k.per + c);
    }
    this.slots[slotI].movers = [];
  }

  // ---------- per frame ----------
  update(camZ, dt, t, runner, camX = 0) {
    const p = this.preset, D = this.D;
    const first = Math.floor(-camZ / L) - 1;
    let shownN = 0;
    for (let ci = first; ci < first + D; ci++) {
      const si = ((ci % D) + D) % D, s = this.slots[si];
      const dist = Math.abs(-(ci + 0.5) * L - camZ) - L / 2;
      // v2.5: follow the world's (hysteresis) LOD choice: decor exists where the chunk has benches / cafe chairs
      const show = this.lodFor ? this.lodFor(ci) <= 0 : dist < p.lod0;
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
      for (const s of this.slots) {
        if (!s.shown) continue;
        for (const m of s.movers) {
          if (m.kid) {
            const a = t * m.w + m.ph;
            const x = m.cx + Math.cos(a) * m.rad, zl = m.cz + Math.sin(a) * m.rad;
            this.put('walk', m.i, x, sandY(x, zl, m.variant), m.cz0 + zl, -a + (m.w > 0 ? Math.PI : 0), 0.62);
          } else if (m.wade) {
            // out (0..1), bathing hold (1..1 + hold), back; the walk swing calms down to a wade in the water
            const P = 2 + m.hold, u = ((t * m.v / m.dist + m.ph) % P + P) % P;
            const k = u < 1 ? u : u < 1 + m.hold ? 1 : P - u, x = m.x0 - k * m.dist;
            const wet = x < -46.2;
            if (wet !== m.wading) { m.wading = wet; wk.set.setAttr(m.i, 'aAnim', m.ph * 3, wet ? 0.07 : 0.42, 0, 0); }
            const face = u < 1 ? Math.PI / 2 : u < 1 + m.hold ? Math.PI / 2 + Math.sin(t * 0.4 + m.ph) * 1.2 : -Math.PI / 2;
            this.put('walk', m.i, x, shoreY(x, m.zl, m.variant) + (u >= 1 && u < 1 + m.hold ? Math.sin(t * 1.7 + m.ph) * 0.04 : 0), m.cz0 + m.zl, face);
          } else {
            const u = ((t * m.v / m.dist + m.ph) % 2 + 2) % 2;
            const out = u < 1, x = m.x0 - (out ? u : 2 - u) * m.dist;
            this.put('walk', m.i, x, sandY(x, m.zl, m.variant), m.cz0 + m.zl, out ? Math.PI / 2 : -Math.PI / 2);
          }
        }
      }
    }
    // v2.5.5 beach goers: walk from the sea wall down the beach and into the sea, then bathe (wade, bob)
    if (wk) for (const g of this.goers) {
      if (!g.on) continue;
      if (g.z > camZ + 30 || g.z < camZ - 280) { g.on = false; wk.set.hide(g.i); continue; }
      // v2.5.6 free will: after bathing a while they choose to come out and stroll the shore, wade
      // deeper, or stay longer (beachy people stay longest)
      let face = Math.PI / 2;
      if (g.state === 'walk') {
        g.x -= g.v * dt;
        if (g.x <= g.tx) { g.x = g.tx; g.wade = true; g.state = 'wade'; wk.set.setAttr(g.i, 'aAnim', g.ph, 0.07, 0, 0); }
      } else if (g.state === 'wade') {
        face = Math.PI / 2 + Math.sin(t * 0.35 + g.ph) * 1.1;
        if ((g.hold -= dt) <= 0) {
          const u = this.wr.next(), WS = this.willStats;
          if (u < 0.5) { g.state = 'out'; g.wade = false; g.tx2 = this.wr.range(-30, -14); wk.set.setAttr(g.i, 'aAnim', g.ph, 0.42, 0, 0); WS.out++; }
          else if (u < 0.75 && g.x > -49.5) { g.state = 'deeper'; g.tx3 = g.x - this.wr.range(0.8, 1.6); WS.deeper++; }
          else { g.hold = this.wr.range(6, 14); WS.stay++; }
        }
      } else if (g.state === 'deeper') {
        g.x -= 0.6 * dt; face = Math.PI / 2;
        if (g.x <= g.tx3) { g.state = 'wade'; g.hold = this.wr.range(6, 16); }
      } else if (g.state === 'out') {
        g.x += 1.15 * dt; face = -Math.PI / 2;
        if (g.x >= g.tx2) { g.state = 'stroll'; g.sd = this.wr.chance(0.5) ? -1 : 1; }
      } else if (g.state === 'return') {
        // v2.5.7: stroll back toward a crossing and leave the beach the way they came
        const gz = g.crossZ, dz = gz - g.z;
        if (Math.abs(dz) > 0.6) { g.z += Math.sign(dz) * 1.15 * dt; face = dz < 0 ? 0 : Math.PI; }
        else { g.x += 1.3 * dt; face = -Math.PI / 2; if (g.x >= -4.6) { g.on = false; wk.set.hide(g.i); continue; } }
      } else { // stroll along the beach; sometimes decide to return via a crossing
        g.z += g.sd * 1.0 * dt; face = g.sd < 0 ? 0 : Math.PI;
        if ((g.retCd = (g.retCd || 12) - dt) <= 0) {
          g.retCd = this.wr.range(14, 28);
          if (this.wr.chance(0.35)) { g.state = 'return'; g.crossZ = nearestCrossing(g.z, g.sd); g.wade = false; wk.set.setAttr(g.i, 'aAnim', g.ph, 0.42, 0, 0); this.willStats.ret = (this.willStats.ret || 0) + 1; }
        }
      }
      const wet = g.state === 'wade' || g.state === 'deeper';
      const y = shoreY(g.x, g.zl, g.variant) + (wet ? Math.sin(t * 1.7 + g.ph) * 0.04 : 0);
      this.put('walk', g.i, g.x, y, g.z, face, g.scale, g.color);
    }
    // bike path riders: two directions, inside the red lane (x 4.4 to 6.4), decor only
    for (const rd of this.riders) {
      const g = rd.rng;
      if (rd.z > camZ + 18 || rd.z < camZ - 170) {
        const init = rd.z === 1e9;
        rd.dir = g.chance(0.5) ? -1 : 1;
        rd.x = rd.dir < 0 ? 4.95 + g.range(-0.15, 0.15) : 5.85 + g.range(-0.15, 0.15);
        if (rd.kind === 'surf') rd.x += rd.dir < 0 ? -0.35 : 0.35; // surfers keep to the lane edges
        rd.v = rd.kind === 'cyc' ? g.range(5, 7.5) : rd.kind === 'blade' ? g.range(4.5, 6.5) : rd.kind === 'skate' ? g.range(3.5, 5) : rd.kind === 'surf' ? g.range(1.5, 2.3) : g.range(4, 6);
        rd.z = init ? camZ - g.range(-10, 150) : camZ - g.range(90, 160);
        rd.color = g.int(0, SHIRTS.length - 1);
        rd.lastDz = rd.z - runner.z;
        const w = this.wr; // v2.5.6 free will
        rd.vT = rd.v; rd.xT = rd.x; rd.will = w.range(1, 4) * this.willSlow; rd.slow = 0; rd.follow = null; rd.pers = w.int(0, 2); rd.state = ''; rd.yaw = 0; rd.choice = '';
      }
      // v2.5.6 free will: decide now and then, ease toward the chosen pace / lane position
      rd.will -= dt;
      if (rd.will <= 0) this.riderDecide(rd);
      if (rd.slow > 0) { rd.slow -= dt; if (rd.slow <= 0) { rd.vT = rd.vBack; rd.state = ''; } }
      if (rd.follow) {
        const f = rd.follow, gap = (f.z - rd.z) * rd.dir;
        if (f.dir !== rd.dir || gap < 1 || gap > 18 || (rd.followT -= dt) <= 0) { rd.follow = null; rd.state = ''; rd.vT = Math.min(rd.vT, VR[rd.kind][1]); }
        else rd.vT = Math.max(VR[rd.kind][0] * 0.6, Math.min(VR[rd.kind][1] * 1.1, f.v + (gap - 3) * 0.6));
      }
      rd.v = dampD(rd.v, rd.vT, rd.state === 'stop' ? 2.5 : 1.2, dt);
      rd.x = dampD(rd.x, rd.xT, 0.9, dt);
      rd.yaw = dampD(rd.yaw, rd.state === 'look' ? (rd.dir < 0 ? 0.3 : -0.3) : 0, 3, dt);
      rd.z += rd.dir * rd.v * dt;
      const dz = rd.z - runner.z;
      if (Math.sign(dz) !== Math.sign(rd.lastDz) && Math.abs(rd.x - runner.x) < 8.5 && this.onBell && rd.kind !== 'surf' && hash2(rd.i * 7 + RIDER_ID[rd.kind], Math.floor(rd.z)) < 0.45) this.onBell(rd.kind, rd.x - runner.x); // v2.5.1: any lane (v2.5.5: wheels for blades / skates)
      rd.lastDz = dz;
      this.put(rd.kind, rd.i, rd.x, 0, rd.z, (rd.dir < 0 ? 0 : Math.PI) + rd.yaw, 1, rd.color);
    }
    // v2.5.7 offshore boats: drift slowly, recycle with the camera, gentle bob is in the BOB shader
    if (this.boats && this.boats.length) {
      const _m = this._boatM || (this._boatM = new THREE.Matrix4());
      const _q = this._boatQ || (this._boatQ = new THREE.Quaternion());
      const _e = this._boatE || (this._boatE = new THREE.Euler());
      const _s = this._boatS || (this._boatS = new THREE.Vector3());
      const _p = this._boatP || (this._boatP = new THREE.Vector3());
      let dirty = false;
      for (const bt of this.boats) {
        if (bt.z > camZ + 40 || bt.z < camZ - 320) {
          bt.z = camZ - (bt.z === 1e9 ? (20 + (bt.i * 37) % 280) : (180 + (bt.i * 53) % 120));
          bt.x = -85 - ((bt.i * 47) % 90) - (bt.kind === 'dinghy' ? 10 : 0);
          dirty = true;
        }
        bt.z += bt.dir * bt.v * dt;
        // waterline ~-0.85; swell matched lightly in JS so LOW (no rich sea chop) still bobs
        const chop = (this.preset && this.preset.rich) ? 1 : 0.55;
        const y = -0.82 + Math.sin(t * 1.1 + bt.ph) * 0.12 * chop + Math.sin(bt.x * 0.15 + t * 1.1) * 0.08 * chop;
        const roll = Math.sin(t * 0.9 + bt.ph) * 0.04;
        _e.set(roll, bt.yaw, Math.sin(t * 0.7 + bt.ph * 1.3) * 0.03);
        _q.setFromEuler(_e); _s.set(bt.s, bt.s, bt.s); _p.set(bt.x, y, bt.z);
        _m.compose(_p, _q, _s); bt.mesh.setMatrixAt(bt.i, _m);
      }
      for (const m of this.boatMeshes) m.instanceMatrix.needsUpdate = true;
    }
    this.updateSites(camZ); // v2.5.8 restaurants, volleyball, football, racquet couples
    // v2.5.11: diners walk terrace ↔ sand through the open sea-side wall (optional life on the path)
    if (wk && this.diners && this.diners.length) {
      const restos = (this.siteLive || []).filter((s) => s.type === 'resto');
      for (const dn of this.diners) {
        if (!dn.on) {
          if ((dn.hold -= dt) > 0) continue;
          if (!restos.length) { dn.hold = this.wr.range(4, 10); continue; }
          const s = restos[this.wr.int(0, restos.length - 1)];
          const toSand = this.wr.chance(0.55);
          const h = hash2(s.k * 17 + dn.i, 113);
          Object.assign(dn, {
            on: true, siteK: s.k, sx: s.x, sz: s.z,
            state: toSand ? 'out' : 'in',
            x: toSand ? s.x - 5.4 : s.x - 12.8,
            z: s.z + (h - 0.5) * 1.1,
            tx: toSand ? s.x - 12.8 : s.x - 5.4,
            v: 0.95 + h * 0.35, ph: h * 6.28, color: this.wr.int(0, SHIRTS.length - 1), scale: 0.96 + h * 0.08,
          });
          wk.set.setAttr(dn.i, 'aAnim', dn.ph, 0.42, 0, 0);
          wk.set.setAttr(dn.i, 'aVar', h < 0.3 ? 1 : 0, h > 0.6 ? 1 : 0, h, 0);
          this.willStats.diner++;
        }
        if (dn.z > camZ + 35 || dn.z < camZ - 260) { dn.on = false; dn.hold = this.wr.range(3, 9); wk.set.hide(dn.i); continue; }
        const toward = dn.tx - dn.x;
        const face = toward < 0 ? Math.PI / 2 : -Math.PI / 2;
        dn.x += Math.sign(toward || -1) * dn.v * dt;
        if (Math.abs(dn.x - dn.tx) < 0.15) {
          dn.x = dn.tx;
          if (dn.state === 'out') {
            // linger on the sand, then walk back up to the terrace
            if (!dn.linger) { dn.linger = this.wr.range(2.5, 6); dn.state = 'sand'; wk.set.setAttr(dn.i, 'aAnim', dn.ph, 0.06, 0, 0); }
          } else if (dn.state === 'in') {
            // brief pause on the terrace then despawn / recycle
            if (!dn.linger) { dn.linger = this.wr.range(1.5, 4); dn.state = 'terr'; wk.set.setAttr(dn.i, 'aAnim', dn.ph, 0.05, 0, 0); }
          }
        }
        if (dn.state === 'sand' || dn.state === 'terr') {
          dn.linger -= dt;
          if (dn.linger <= 0) {
            if (dn.state === 'sand') {
              dn.state = 'in'; dn.tx = dn.sx - 5.4; dn.linger = 0;
              wk.set.setAttr(dn.i, 'aAnim', dn.ph, 0.42, 0, 0);
            } else {
              dn.on = false; dn.hold = this.wr.range(6, 16); dn.linger = 0; wk.set.hide(dn.i); continue;
            }
          }
        }
        const y = sandY(dn.x, dn.z - (dn.sz || dn.z), 0);
        // keep feet near deck height while on the terrace
        const yDeck = dn.x > (dn.sx || 0) - 7.4 ? Math.max(y, -0.05) : y;
        this.put('walk', dn.i, dn.x, yDeck, dn.z, face, dn.scale, dn.color);
      }
    }
    // v2.5: pick near / mid / far per instance and pack the instanced meshes
    for (const k of Object.values(this.kits)) k.set.update(camX, camZ, dt);
  }
  // leaves follow the camera; amount follows the weather wind
  frame(camera, wind) {
    if (!this.leaves) return;
    const amt = Math.min(1, wind * 1.1);
    this.leafMat.uniforms.uAmount.value = amt;
    this.leafMat.uniforms.uCam.value.copy(camera.position);
    this.leaves.visible = amt > 0.02;
  }
  // v2.5.6: one bike-lane decision (every 3 - 7 s per rider; LOW decides less often, no tagging along)
  riderDecide(rd) {
    const w = this.wr, [lo, hi] = VR[rd.kind], WS = this.willStats;
    rd.will = w.range(3, 7) * this.willSlow;
    if (rd.slow > 0 || rd.follow) return;
    const base = (rd.dir < 0 ? 4.95 : 5.85) + (rd.kind === 'surf' ? (rd.dir < 0 ? -0.35 : 0.35) : 0);
    let u = w.next() * 3.3;
    if ((u -= 1) < 0) { const v0 = rd.vT; rd.vT = Math.min(hi * 1.05, Math.max(lo, w.range(lo, hi) * (rd.pers === 1 ? 1.08 : rd.pers === 2 ? 0.92 : 1))); rd.choice = rd.vT > v0 ? 'speeds up' : 'eases off'; WS.pace++; }
    else if ((u -= 0.6) < 0) { rd.xT = base + w.range(-0.25, 0.25); rd.choice = 'moves over'; WS.lane++; }
    else if ((u -= rd.pers === 2 ? 0.7 : 0.35) < 0) { rd.vBack = rd.vT; rd.vT *= 0.55; rd.slow = w.range(1.5, 3); rd.state = 'look'; rd.choice = 'slows to look at the beach'; WS.look++; }
    else if (rd.kind === 'skate' && (u -= 0.6) < 0) { rd.vBack = w.range(lo, hi); rd.vT = 0.25; rd.slow = w.range(0.8, 1.6); rd.state = 'stop'; rd.choice = 'stop and go'; WS.stop++; }
    else if (this.riderSocial && (u -= 0.6) < 0) {
      for (const o of this.riders) {
        const gap = (o.z - rd.z) * rd.dir;
        if (o === rd || o.dir !== rd.dir || o.follow === rd || gap < 3 || gap > 14) continue;
        rd.follow = o; rd.followT = w.range(6, 10); rd.state = 'together'; rd.choice = 'rides along with a ' + o.kind; WS.together++; break;
      }
    }
  }
  // v2.5.5: walkers the sim sent down to the beach become goers (they walk into the sea and bathe)
  takeBathers(q) {
    while (q && q.length) {
      const e = q.shift();
      const g = this.goers.find((o) => !o.on); if (!g) continue;
      const h = hash2(Math.floor(e.z * 10), 71);
      const pers = e.persona | 0, hold = pers === 4 ? this.wr.range(18, 35) : pers === 0 ? this.wr.range(10, 22) : pers === 5 ? this.wr.range(6, 14) : this.wr.range(8, 20);
      Object.assign(g, { on: true, state: 'walk', hold, wade: false, x: -5.2, z: e.z, zl: e.z, variant: 0, tx: -47 - h * 2.2, v: 1.9 + h * 0.7, ph: h * 6.28, scale: e.scale || 1, color: e.color | 0, retCd: this.wr.range(10, 22) });
      const wk = this.kits.walk;
      if (wk) { wk.set.setAttr(g.i, 'aAnim', g.ph, 0.42, 0, 0); wk.set.setAttr(g.i, 'aVar', h < 0.3 ? 1 : 0, h > 0.6 ? 1 : 0, h, 0); }
    }
  }
  counts() {
    const o = { chunks: this.shownChunks, tiers: {} };
    for (const [k, v] of Object.entries(this.kits)) { o[k] = v.set.stats[0] + v.set.stats[1] + v.set.stats[2]; o.tiers[k] = v.set.stats.slice(); }
    o.leaves = this.leaves ? Math.round(this.leaves.count * this.leafMat.uniforms.uAmount.value) : 0;
    o.boats = this.boats ? this.boats.length : 0;
    return o;
  }
}
