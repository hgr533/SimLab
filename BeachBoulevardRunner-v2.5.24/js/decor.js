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
import { restoZ, RESTO_X, RESTO_F, beachBusy, plazaCafeZ, plazaCafeNear, plazaHit, PCAFE_X, PCAFE_D, PCAFE_W, ROAD_KERB_X0, ROAD_KERB_X1, SITES, SITE_ORDER, beachSite } from './places.js';
import { bakedMaterial, glowMaterial, U } from './materials.js';
import { personGeometry, personNearGeometry, personFarGeometry, benchNearKit } from './props.js';
import { TieredSet } from './lod.js';
import {
  carGeo, carColors, trafficLightGeo, zebraGeo, roadSignGeo, shopGeo, cafeSideGeo,
  blvdCafeGeo, roadRestoGeo, streetFurnGeo, streetLampGeo, SLAMP_HEAD,
  ROAD_X0, ROAD_X1, ROAD_MID, LANE_IN, LANE_OUT, SHOP_X, BLVD_CAFE_X, SIDE_A, SIDE_B, FILL_X,
  lightPhase, carsGreen, pedsWalk, lightTint,
} from './city.js';

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

// ---------------- v2.5.18 ESTABLISHMENT LIGHTS (multicolour, cheap) ----------------
// Shared layouts: the same bulb / lamp / pool positions feed the baked emissive meshes (GLOWS: aLight.z =
// 3 + intensity, aLight.w = chase phase) and the additive sprite / ground-pool layer (glowMaterial).
// Everything fades in with U.uLights (dusk / rain / overcast) — no real lights, no shadows, no post.
const NEON = [0xff2d55, 0xff9f0a, 0xffd60a, 0x30d158, 0x40c8e0, 0x0a84ff, 0xbf5af2, 0xff375f, 0x64d2ff, 0xffffff].map((h) => hex(h)).map((c, i) => i === 9 ? c : c);
const RAINBOW = [0xff3b30, 0xff9500, 0xffd60a, 0x34c759, 0x32d6e0, 0x0a6cff, 0xaf52de, 0xff4fa3].map((h) => hex(h));
const WARM = hex(0xffd59a);
function festoonPts(out, x0, y0, z0, x1, y1, z1, n, spans, sag, hue0) {
  for (let i = 0; i < n; i++) {
    const u = n > 1 ? i / (n - 1) : 0.5, f = (u * spans) % 1;
    out.push({ x: x0 + (x1 - x0) * u, y: y0 + (y1 - y0) * u - sag * Math.sin(Math.PI * (i === n - 1 ? 1 : f)), z: z0 + (z1 - z0) * u, c: RAINBOW[(hue0 + i) % 8], ph: (i * 0.125) % 1, wire: out.wireId });
  }
  out.wireId = (out.wireId || 0) + 1;
}
// emit bulbs (+ thin wires on level 0) into a Builder
function emitBulbs(b, L, level) {
  const w0 = b.wet, m0 = b.mapW, t0 = b.tint;
  b.tint = 0;
  if (level === 0) for (let i = 1; i < L.bulbs.length; i++) {
    const a = L.bulbs[i - 1], c = L.bulbs[i];
    if (a.wire !== c.wire) continue;
    b.wet = 0; b.mapW = 0; b.limb(a.x, a.y + 0.05, a.z, c.x, c.y + 0.05, c.z, 0.008, 0.008, 3, hex(0x2b2b2b), { cap: false });
  }
  for (const q of L.bulbs) { b.wet = 3.85; b.mapW = q.ph; b.box(q.x, q.y - 0.045, q.z, 0.09, 0.1, 0.09, q.c, { skipBottom: true }); }
  for (const q of L.lanterns) { // little posts with a coloured lantern head
    b.wet = 0; b.mapW = 0; b.cyl(q.x, q.y0, q.z, 0.035, 0.035, q.y - q.y0 - 0.08, 5, hex(0x2f3136), { cap: false });
    b.box(q.x, q.y - 0.1, q.z, 0.16, 0.03, 0.16, hex(0x2f3136));
    b.wet = 3.9; b.mapW = q.ph; b.box(q.x, q.y - 0.07, q.z, 0.12, 0.17, 0.12, q.c, { skipBottom: true });
    b.wet = 0; b.box(q.x, q.y + 0.1, q.z, 0.17, 0.04, 0.17, hex(0x2f3136));
  }
  b.wet = w0; b.mapW = m0; b.tint = t0;
}
// table lamp (also inside tableSet): small dark base + coloured glowing shade
function tableLamp(b, k) {
  const w0 = b.wet, m0 = b.mapW;
  b.wet = 0; b.box(0, 0.76, 0, 0.1, 0.03, 0.1, hex(0x2f3136));
  b.wet = 3.8; b.mapW = (k * 0.37) % 1; b.box(0, 0.79, 0, 0.08, 0.13, 0.08, RAINBOW[(k * 3) % 8], { skipBottom: true });
  b.wet = w0; b.mapW = m0;
}
function restoLights(level) {
  const L = { bulbs: [], lanterns: [], lamps: [], pools: [] };
  if (level === 2) return L;
  const nA = level === 0 ? 17 : 9, nT = level === 0 ? 15 : 8;
  festoonPts(L.bulbs, 0.3, 3.05, -5.35, 0.3, 3.05, 5.35, nA, 4, 0.2, 0);      // along the facade header
  festoonPts(L.bulbs, 1.68, 3.0, -1.9, 1.68, 3.0, 1.9, level === 0 ? 7 : 4, 2, 0.1, 4); // door canopy lip
  festoonPts(L.bulbs, -7.5, 2.95, -5.35, -7.5, 2.95, 5.35, nT, 3, 0.2, 3);   // terrace / sea edge
  if (level === 0) for (const s of [-1, 1]) festoonPts(L.bulbs, -0.1, 3.0, s * 5.75, -7.4, 3.0, s * 5.75, 9, 2, 0.14, s > 0 ? 5 : 1);
  // lanterns on the entrance planters and along the sea-side path posts
  for (const s of [-1, 1]) L.lanterns.push({ x: 1.42 + RESTO_F, y0: 0.4, y: 1.05, z: s * 1.75, c: RAINBOW[s > 0 ? 7 : 4], ph: s > 0 ? 0.2 : 0.7 });
  const posts = level === 0 ? [[-7.55, 1.65], [-9.0, 1.45], [-10.8, 1.25], [-12.6, 1.05]] : [[-7.55, 1.65], [-10.8, 1.25]];
  posts.forEach(([px, pz], i) => { for (const s of [-1, 1]) { const y0 = sandY(RESTO_X + px, 0, 0) + 0.8; L.lanterns.push({ x: px, y0: y0 - 0.02, y: y0 + 0.2, z: s * pz, c: RAINBOW[(i * 2 + (s > 0 ? 1 : 0)) % 8], ph: (i * 0.25) % 1 }); } });
  // table lamps (indoor + terrace) — same spots as the tableSets
  const inZ = level === 0 ? [-2.6, 0.4, 3.2] : [-2.0, 2.4], outZ = level === 0 ? [-4.4, -2.6, 2.6, 4.4] : [-3.8, 3.8];
  inZ.forEach((z, k) => L.lamps.push({ x: -1.9, y: 0.2 + 0.86, z, c: RAINBOW[((k + 1) * 3) % 8] }));
  outZ.forEach((z, k) => L.lamps.push({ x: -5.5, y: 0.18 + 0.86, z, c: RAINBOW[((k + 4) * 3) % 8] }));
  // coloured glow pools: entrance inlay, steps, terrace, sand path, light spill on the deck under the awning
  L.pools.push({ x: 2.45 + RESTO_F, y: 0.05, z: 0, sx: 1.7, sz: 1.6, c: mix3(RAINBOW[7], WARM, 0.35), k: 0.55 });
  L.pools.push({ x: 0.75 + RESTO_F / 2, y: 0.5, z: 0, sx: 0.8 + RESTO_F / 2, sz: 1.4, c: WARM, k: 0.45 });
  L.pools.push({ x: -5.5, y: 0.24, z: 0, sx: 1.9, sz: 3.6, c: mix3(RAINBOW[6], WARM, 0.3), k: 0.45 });
  L.pools.push({ x: -10.2, y: sandY(RESTO_X - 10.2, 0, 0) + 0.12, z: 0, sx: 2.2, sz: 1.7, c: RAINBOW[4], k: 0.4 });
  for (const [s, hi] of [[-1, 1], [1, 3]]) L.pools.push({ x: 1.95 + RESTO_F, y: 0.05, z: s * 3.6, sx: 0.85, sz: 1.9, c: RAINBOW[hi], k: 0.35 });
  return L;
}
function cafeLights(level, o) {
  const D = o.depth || 4.5, W = o.width || 9.6, hw = W / 2, aw = o.awningW || 2.6, pathLen = o.pathLen || 0, v = o.variant | 0;
  const L = { bulbs: [], lanterns: [], lamps: [], pools: [] };
  if (level === 2) return L;
  festoonPts(L.bulbs, -1.42, 2.9, -aw, -1.42, 2.9, aw, Math.max(5, Math.round(aw * 2 / (level === 0 ? 0.5 : 0.9)) + 1), 2, 0.12, v);
  festoonPts(L.bulbs, -0.32, 3.2, -hw, -0.32, 3.2, hw, level === 0 ? 17 : 9, 3, 0.26, v + 2);
  if (level === 0) for (const s of [-1, 1]) festoonPts(L.bulbs, 0.0, 3.2, s * (hw + 0.28), D, 3.2, s * (hw + 0.28), 8, 2, 0.16, v + (s > 0 ? 4 : 6));
  if (o.rearDoor) festoonPts(L.bulbs, D + 0.3, 3.2, -hw, D + 0.3, 3.2, hw, level === 0 ? 13 : 7, 2, 0.22, v + 5);
  // lanterns along the paved entrance path (both edges) and at the door
  if (pathLen > 0) {
    const n = Math.max(1, Math.floor((pathLen - 0.6) / 1.6));
    for (let i = 0; i < n; i++) { const x = -pathLen + 0.95 + i * 1.6; for (const s of [-1, 1]) L.lanterns.push({ x, y0: 0.02, y: 0.95, z: s * 1.36, c: RAINBOW[(v + i * 2 + (s > 0 ? 1 : 0)) % 8], ph: ((i + (s > 0 ? 0.5 : 0)) * 0.21) % 1 }); }
  }
  const tz = level === 0 ? [-hw + 1.1, -2.1, 2.2] : [-hw + 1.3, 2.2];
  tz.forEach((z, k) => L.lamps.push({ x: D * 0.5, y: 0.12 + 0.86, z, c: RAINBOW[((k + 1 + v) * 3) % 8] }));
  L.pendants = tz.map((z) => ({ x: D * 0.5, y: 2.55, z }));
  // pools: along the entrance path (colour cycling), the door, inside, rear apron
  if (pathLen > 0) for (let x = -pathLen + 0.7, i = 0; x < -0.3; x += 1.5, i++) L.pools.push({ x, y: 0.04, z: 0, sx: 1.05, sz: 1.35, c: RAINBOW[(v + i * 3 + 1) % 8], k: 0.42 });
  L.pools.push({ x: -0.9, y: 0.045, z: 0, sx: 1.2, sz: aw * 0.9, c: mix3(RAINBOW[(v + 7) % 8], WARM, 0.4), k: 0.45 });
  L.pools.push({ x: D * 0.45, y: 0.14, z: 0, sx: D * 0.42, sz: hw * 0.8, c: WARM, k: 0.3 });
  if (o.rearDoor) L.pools.push({ x: D + 0.65, y: 0.04, z: 0, sx: 0.9, sz: 1.5, c: RAINBOW[(v + 4) % 8], k: 0.4 });
  return L;
}
// additive sprite / pool geometry for one establishment kind (instanced per building)
class GlowGeo {
  constructor() { this.p = []; this.g = []; this.s = []; this.ph = []; this.c = []; this.idx = []; }
  q(x, y, z, kind, sx, sz, c, ph, k) {
    const n = this.p.length / 3;
    for (const [cx, cy] of [[-1, -1], [1, -1], [1, 1], [-1, 1]]) { this.p.push(x, y, z); this.g.push(cx, cy, kind); this.s.push(sx, sz); this.ph.push(ph); this.c.push(c[0] * k, c[1] * k, c[2] * k); }
    // v2.5.19: ground pools wound to face UP (they were back-face culled from above before)
    if (kind === 1) this.idx.push(n, n + 2, n + 1, n, n + 3, n + 2);
    else this.idx.push(n, n + 1, n + 2, n, n + 2, n + 3);
  }
  sprite(x, y, z, r, c, ph = 0, k = 1) { this.q(x, y, z, 0, r, r, c, ph, k); }
  pool(x, y, z, sx, sz, c, k = 0.5) { this.q(x, y, z, 1, sx, sz, c, 0, k); }
  tail(x, y, z, r, c, k = 1) { this.q(x, y, z, 2, r, r, c, -1, k); }
  build() {
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.Float32BufferAttribute(this.p, 3));
    g.setAttribute('aG', new THREE.Float32BufferAttribute(this.g, 3));
    g.setAttribute('aS', new THREE.Float32BufferAttribute(this.s, 2));
    g.setAttribute('aPh', new THREE.Float32BufferAttribute(this.ph, 1));
    g.setAttribute('color', new THREE.Float32BufferAttribute(this.c, 3));
    g.setIndex(this.idx);
    g.boundingSphere = new THREE.Sphere(new THREE.Vector3(), 40);
    return g;
  }
}
function lightsGlowGeo(L, low) {
  const G = new GlowGeo();
  L.bulbs.forEach((q, i) => { if (!low || i % 2 === 0) G.sprite(q.x, q.y - 0.02, q.z, low ? 0.7 : 0.6, q.c, q.ph, 1.3); });
  for (const q of L.lanterns) G.sprite(q.x, q.y - 0.05, q.z, 0.95, q.c, q.ph, 1.3);
  for (const q of L.lamps) G.sprite(q.x, q.y, q.z, 0.55, q.c, 0.5, 0.9);
  for (const q of L.pendants || []) G.sprite(q.x, q.y, q.z, 0.8, WARM, 0, 0.75);
  for (const q of L.pools) G.pool(q.x, q.y, q.z, q.sx * 1.2, q.sz * 1.2, q.c, q.k * 2.4);
  return G.build();
}
// car lights: headlights + beam pool (with uLights), taillights brighten when braking (instance colour r)
function carGlowGeo(kind) {
  const lens = [4.15, 3.55, 4.75, 4.45][kind], wid = [1.82, 1.72, 1.92, 1.9][kind];
  const G = new GlowGeo(), head = hex(0xfff0c8), red = hex(0xff2a1a);
  for (const s of [-1, 1]) { G.q(s * wid * 0.3, 0.52, -lens * 0.49, 0, 0.42, 0.42, head, -1, 1.0); G.tail(s * wid * 0.3, 0.52, lens * 0.49, 0.34, red, 1.0); }
  G.q(0, 0.04, -lens * 0.5 - 3.1, 1, 1.25, 3.2, mul(head, 0.9), -1, 0.5);
  return G.build();
}
// v2.5.19 street lamps: warm-white halo at the head + soft ground pool (steady, no twinkle).
// Chunk lamps (baked into LOD0 / near world chunks): boulevard / plaza posts (x 6.8, head x 5.95, local
// z -16 / -3 / 10) and the fill-band posts behind the city cafes (x 39.7, local z -11.9 / 3.3).
const LAMP_HALO = hex(0xffdb9c), LAMP_CORE = hex(0xfff1d6), LAMP_POOL = hex(0xffcf8a);
function chunkLampGlowGeo(low) {
  const G = new GlowGeo();
  for (const z of [-16, -3, 10]) {
    G.sprite(5.95, 3.86, z, 1.05, LAMP_HALO, -1, 0.5);
    if (!low) G.sprite(5.95, 3.84, z, 0.34, LAMP_CORE, -1, 0.6);
    G.q(5.95, 0.035, z, 1, 2.9, 2.9, LAMP_POOL, -1, 0.42);
  }
  for (const z of [-11.9, 3.3]) {
    G.sprite(39.7, 3.2, z, 0.95, LAMP_HALO, -1, 0.5);
    G.q(39.7, 0.035, z, 1, 2.4, 2.4, LAMP_POOL, -1, 0.38);
  }
  return G.build();
}
// road street lamp (local frame of streetLampGeo: head over the road at local -x)
function roadLampGlowGeo(low) {
  const G = new GlowGeo(), [hx, hy] = SLAMP_HEAD;
  G.sprite(hx, hy - 0.06, 0, 1.25, LAMP_HALO, -1, 0.5);
  if (!low) G.sprite(hx, hy - 0.08, 0, 0.4, LAMP_CORE, -1, 0.6);
  G.q(hx + 0.2, 0.04, 0, 1, 3.4, 3.4, LAMP_POOL, -1, 0.4);
  return G.build();
}
// one table with two chairs (along local z) and up to two seated diners
function tableSet(b, x, y, z, rot, occ, k) {
  b.push(); b.translate(x, y, z); b.rotY(rot); b.tint = 0;
  b.cyl(0, 0, 0, 0.05, 0.05, 0.72, 5, METAL, { cap: false });
  b.cyl(0, 0.72, 0, 0.4, 0.4, 0.04, 8, hex(0xf4f0e6));
  b.box(0.12, 0.76, 0.06, 0.07, 0.09, 0.07, k % 2 ? hex(0x6b4430) : hex(0xb8d8e8));
  b.box(-0.1, 0.76, -0.12, 0.2, 0.02, 0.2, hex(0xfafafa));
  tableLamp(b, k); // v2.5.18 coloured table lamp
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
  const pathY = (lx) => sandY(RESTO_X + lx, 0, 0);
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
  b.tint = 1; b.wet = 3.55; b.box(0.12, 3.55, 0, 0.12, 0.58, 5.4, WHITE); b.tint = 0; // v2.5.18 neon sign (hue per restaurant)
  b.wet = 3.6; for (let k = 0; k < 6; k++) { b.mapW = k * 0.04; b.box(0.2, 3.7, -1.9 + k * 0.76, 0.03, 0.28, 0.42, hex(0xfdfbf5), { skipBottom: true }); }
  b.wet = 0; b.mapW = 0;
  b.push(); b.translate(0.85, 2.88, 0); b.rotZ(0.28); // v2.5.18: door canopy only (palms stand beside the facade)
  for (let k = 0; k < 5; k++) { b.tint = k % 2 ? 0 : 1; b.box(0, 0, -1.9 + k * 0.76 + 0.38, 1.7, 0.06, 0.76, WHITE); }
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
    b.wet = 3.7; for (const z of inZ) b.box(-1.9, 2.55, z, 0.18, 0.12, 0.18, hex(0xffe6a8)); b.wet = 0; // v2.5.18 warm pendants
    b.ao = 1; b.sunBoost = 1;
    // terrace tables on the SEA side (kept clear of the centre path |z| < 1.6)
    const outZ = level === 0 ? [-4.4, -2.6, 2.6, 4.4] : [-3.8, 3.8];
    outZ.forEach((z, k) => tableSet(b, -5.5, 0.18, z, Math.PI / 2, [true, k % 3 !== 2], k + 4));
    if (level === 0) for (const z of [-3.5, 3.5]) { b.cyl(-5.5, 0.18, z, 0.04, 0.04, 2.4, 5, WHITE, { cap: false }); b.tint = 2; b.cyl(-5.5, 2.45, z, 1.45, 0.05, 0.5, 8, WHITE); b.tint = 0; }
    // v2.5.10: two waiters inside (near the door and near the counter)
    b.push(); b.translate(-0.85, 0.2, 1.45); b.rotY(Math.PI / 2); sportFig(b, 1, 0, SKINS[1], 'tray'); b.pop(); // v2.5.18: out of the door aisle
    b.box(-0.85 - 0.38, 1.2, 1.45, 0.34, 0.03, 0.34, METAL);
    b.push(); b.translate(-2.4, 0.2, -3.2); b.rotY(Math.PI * 0.15); sportFig(b, 1, 2, SKINS[3], 'tray'); b.pop();
    b.box(-2.4 + 0.35, 1.2, -3.2, 0.34, 0.03, 0.34, METAL);
  }

  // v2.5.18: paved boulevard entrance — decorated tile inlay on the deck (flat, runner-safe), stone
  // edging, planters at the mouth and steps up over the low sea wall onto a landing at the door.
  // Local x = world x - RESTO_X (+6.55): deck edge x=-4.4 -> 2.15; sea wall -4.925..-4.475 -> 1.63..2.08;
  // a raised boardwalk landing runs from the wall to the door over the sand (palm trunks stay beside it).
  const F = RESTO_F;
  {
    const tA = hex(0xd9c7a3), tB = hex(0xb4613f), edge = hex(0x8f8577), step = mix3(sill, hex(0xcfc3ad), 0.5);
    const zH = 1.2, xa = 1.15 + F, xb = (level === 2 ? 2.6 : 3.75) + F;
    if (level !== 2) {
      // checker inlay (two-tone tiles) framed by a darker stone band
      const nx = level === 0 ? 6 : 3, nz = level === 0 ? 4 : 2;
      const dx = (xb - xa - 0.24) / nx, dz = (zH * 2 - 0.24) / nz;
      for (let i = 0; i < nx; i++) for (let j = 0; j < nz; j++) {
        const x0 = xa + 0.12 + i * dx, z0 = -zH + 0.12 + j * dz;
        b.quad([x0, 0.016, z0 + dz], [x0 + dx, 0.016, z0 + dz], [x0 + dx, 0.016, z0], [x0, 0.016, z0], (i + j) % 2 ? tB : tA);
      }
      for (const s of [-1, 1]) b.quad([xa, 0.018, s > 0 ? zH : -zH + 0.12], [xb, 0.018, s > 0 ? zH : -zH + 0.12], [xb, 0.018, s > 0 ? zH - 0.12 : -zH], [xa, 0.018, s > 0 ? zH - 0.12 : -zH], edge);
      b.quad([xb - 0.12, 0.018, zH], [xb, 0.018, zH], [xb, 0.018, -zH], [xb - 0.12, 0.018, -zH], edge);
      // low stone kerbs along the sides of the path (2 cm, never an obstacle)
      for (const s of [-1, 1]) b.box((xa + xb) / 2, 0, s * (zH + 0.07), xb - xa, 0.03, 0.12, mul(edge, 1.1), { skipBottom: true });
      // planters flanking the steps at the deck edge (outside the running lanes)
      for (const s of [-1, 1]) { b.box(1.42 + F, 0, s * 1.75, 0.42, 0.4, 0.42, hex(0x9a6a44), { skipBottom: true }); b.cyl(1.42 + F, 0.4, s * 1.75, 0.22, 0.06, 0.38, 6, GREEN); }
    } else {
      b.quad([xa, 0.03, zH], [xb, 0.03, zH], [xb, 0.03, -zH], [xa, 0.03, -zH], mix3(tA, tB, 0.35));
    }
    // steps: deck -> landing over the wall -> door threshold
    b.box(1.21 + F, 0, 0, 0.26, 0.23, zH * 2, step, { skipBottom: true, top: mul(step, 1.06) });          // step A (deck side)
    b.box(0.69 + F / 2, -0.4, 0, 0.78 + F, 0.86, zH * 2 + 0.1, step, { skipBottom: true, top: mix3(tA, step, 0.4) }); // landing: sea wall -> door (boardwalk over the sand)
    b.box(0.18, 0, 0, 0.26, 0.33, zH * 2, step, { skipBottom: true, top: mul(step, 1.04) });          // step B (into the room)
    if (level === 0) for (const s of [-1, 1]) { // brass posts at the landing corners
      b.cyl(1.05 + F, 0.46, s * (zH + 0.05), 0.04, 0.04, 0.85, 6, hex(0xc9a227), { cap: true });
      b.cyl(0.33, 0.46, s * (zH + 0.05), 0.04, 0.04, 0.85, 6, hex(0xc9a227), { cap: true });
      b.limb(1.05 + F, 1.28, s * (zH + 0.05), 0.33, 1.28, s * (zH + 0.05), 0.022, 0.022, 4, hex(0xc9a227), { cap: false });
    }
  }

  emitBulbs(b, restoLights(level), level); // v2.5.18 rainbow festoons, lanterns
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

// v2.5.18 glass cafe, same visual language as the beach restaurant (dithered glass panes with solid
// frames, striped awning, sign, tiled floor, tables with diners, two waiters). Local x = 0 is the
// FRONT facade with the entrance (faces -x); the room runs toward +x. Optional rear door (+x).
// A paved entrance path (two-tone tiles + stone edge + planters) leads in from -pathLen. For plaza
// cafes a painted crosswalk over the bike lane (local x crossA..crossB) connects to the deck.
// level 0 full, 1 LOW (fewer tables / denser glass), 2 far shell. Glass emitted LAST.
export function glassCafeGeo(level = 0, o = {}) {
  const D = o.depth || 4.5, W = o.width || 9.6, wallH = 3.1, rear = !!o.rearDoor, pathLen = o.pathLen || 0;
  const v = o.variant | 0;
  const walls = [hex(0xf1e6d2), hex(0xf3e9d8), hex(0xe8dcc8), hex(0xf1e0d0)];
  const wall = walls[v % walls.length], frame = hex(0xe8e0d2), sill = hex(0xd4cbb8), door = hex(0x6b5340);
  const tile = hex(0xb9a48a), roofC = hex(0xd8cdbd), wood = hex(0xa87a4e);
  const tA = hex(0xd9c7a3), tB = [hex(0xb4613f), hex(0x5f7f8f), hex(0x7a8f5a), hex(0xa4704a)][v % 4], edge = hex(0x8f8577);
  const gWet = level === 1 ? 1.92 : level === 2 ? 1.72 : 1.48;
  const b = new Builder({ tint: true });
  const pane = (cx, y0, cz, sx, sy, sz) => { const w0 = b.wet; b.wet = gWet; b.box(cx, y0, cz, sx, sy, sz, hex(0x9eb8c6), { skipBottom: true, top: hex(0xb8d0dc) }); b.wet = w0; };
  const hw = W / 2, dh = 1.0; // door half width
  b.tint = 0; b.wet = 0;
  // floor slab (slightly raised) + opaque skirts
  b.box(D / 2, 0, 0, D, 0.12, W, mul(tile, 0.85), { skipBottom: true, top: tile });
  for (const [z0, z1] of [[-hw, -dh - 0.1], [dh + 0.1, hw]]) b.box(0.0, 0, (z0 + z1) / 2, 0.2, 0.3, z1 - z0, sill, { skipBottom: true });
  if (rear) for (const [z0, z1] of [[-hw, -dh - 0.1], [dh + 0.1, hw]]) b.box(D, 0, (z0 + z1) / 2, 0.2, 0.3, z1 - z0, sill, { skipBottom: true });
  else b.box(D, 0, 0, 0.2, 0.3, W, sill, { skipBottom: true });
  for (const s of [-1, 1]) b.box(D / 2, 0, s * hw, D, 0.3, 0.2, sill, { skipBottom: true });
  // corner pillars, door frames, mullions
  for (const x of [0, D]) for (const s of [-1, 1]) b.box(x, 0.1, s * hw, 0.26, wallH, 0.26, wall, { skipBottom: true });
  const doorFrame = (x, sgn) => {
    for (const z of [-dh, dh]) b.box(x, 0.1, z, 0.14, 2.45, 0.14, door, { skipBottom: true });
    b.box(x, 2.5, 0, 0.16, 0.12, dh * 2 + 0.2, door, { skipBottom: true });
    b.push(); b.translate(x + sgn * 0.04, 0.12, dh - 0.08); b.rotY(sgn * 0.55);
    b.box(sgn * 0.5, 0, 0, 1.0, 2.3, 0.06, mul(door, 1.08), { skipBottom: true, top: mul(door, 1.15) });
    b.box(sgn * 0.88, 1.05, -0.04, 0.08, 0.08, 0.08, hex(0xc9a227));
    b.pop();
  };
  doorFrame(0.02, 1); if (rear) doorFrame(D - 0.02, -1);
  const mz = level === 2 ? [-hw * 0.6, hw * 0.6] : [-hw * 0.72, -hw * 0.42, hw * 0.42, hw * 0.72];
  for (const z of mz) { b.box(0, 0.25, z, 0.1, wallH - 0.2, 0.1, frame, { skipBottom: true }); b.box(D, 0.25, z, 0.1, wallH - 0.2, 0.1, frame, { skipBottom: true }); }
  for (const s of [-1, 1]) for (const f of [0.33, 0.66]) b.box(D * f, 0.25, s * hw, 0.1, wallH - 0.2, 0.1, frame, { skipBottom: true });
  // rails, header, roof
  b.box(0, 1.5, 0, 0.12, 0.1, W - 0.2, frame, { skipBottom: true });
  b.box(D, 1.5, 0, 0.12, 0.1, W - 0.2, frame, { skipBottom: true });
  for (const s of [-1, 1]) b.box(D / 2, 1.5, s * hw, D - 0.2, 0.1, 0.12, frame, { skipBottom: true });
  b.box(0, wallH - 0.3, 0, 0.3, 0.5, W + 0.1, wall);
  b.box(D, wallH - 0.3, 0, 0.3, 0.5, W + 0.1, wall);
  for (const s of [-1, 1]) b.box(D / 2, wallH - 0.3, s * hw, D, 0.5, 0.3, wall);
  b.box(D / 2, wallH + 0.1, 0, D + 0.4, 0.22, W + 0.4, mul(roofC, 0.85), { top: roofC });
  // sign + striped awning over the entrance (narrow canopy: clear of the palms beside it)
  b.tint = 1; b.wet = 3.55; b.box(-0.1, wallH + 0.3, 0, 0.12, 0.5, Math.min(5.2, W * 0.55), WHITE); b.tint = 0; // v2.5.18 neon sign (hue per cafe)
  b.wet = 3.6; for (let k = 0; k < 6; k++) { b.mapW = k * 0.04; b.box(-0.18, wallH + 0.42, -1.9 + k * 0.76, 0.03, 0.26, 0.4, hex(0xfdfbf5), { skipBottom: true }); }
  b.wet = 0; b.mapW = 0;
  const aw = o.awningW || 2.6;
  b.push(); b.translate(-0.7, wallH - 0.35, 0); b.rotZ(-0.28);
  const nA = 6; for (let k = 0; k < nA; k++) { b.tint = k % 2 ? 0 : 1; b.box(0, 0, -aw + (k + 0.5) * (aw * 2 / nA), 1.45, 0.06, aw * 2 / nA, WHITE); }
  b.pop(); b.tint = 0;
  // paved entrance path (front) + crosswalk over the bike lane (plaza cafes)
  if (pathLen > 0) {
    const zH = 1.2, xa = -pathLen, xb = -0.1;
    if (level !== 2) {
      const nx = Math.max(2, Math.round(pathLen / 0.55)), nz = level === 0 ? 4 : 2;
      const dx = (xb - xa) / nx, dz = (zH * 2 - 0.24) / nz;
      for (let i = 0; i < nx; i++) for (let j = 0; j < nz; j++) {
        const x0 = xa + i * dx, z0 = -zH + 0.12 + j * dz;
        b.quad([x0, 0.02, z0 + dz], [x0 + dx, 0.02, z0 + dz], [x0 + dx, 0.02, z0], [x0, 0.02, z0], (i + j) % 2 ? tB : tA);
      }
      for (const s of [-1, 1]) b.box((xa + xb) / 2, 0, s * (zH - 0.06), xb - xa, 0.05, 0.12, edge, { skipBottom: true });
      if (pathLen > 1.4) for (const s of [-1, 1]) { b.box(xa + 0.35, 0, s * (zH + 0.45), 0.42, 0.38, 0.42, hex(0x9a6a44), { skipBottom: true }); b.cyl(xa + 0.35, 0.38, s * (zH + 0.45), 0.21, 0.06, 0.36, 6, GREEN); }
      for (const s of [-1, 1]) { b.box(-0.45, 0, s * (zH + 0.45), 0.4, 0.36, 0.4, hex(0x9a6a44), { skipBottom: true }); b.cyl(-0.45, 0.36, s * (zH + 0.45), 0.2, 0.06, 0.34, 6, GREEN); }
    } else b.quad([xa, 0.03, zH], [xb, 0.03, zH], [xb, 0.03, -zH], [xa, 0.03, -zH], mix3(tA, tB, 0.4));
    if (o.crossA !== undefined && level !== 2) { // painted pedestrian crossing on the red bike lane
      for (let i = 0; i < 5; i++) { const z0 = -zH + 0.1 + i * 0.5; b.quad([o.crossA, 0.022, z0 + 0.3], [o.crossB, 0.022, z0 + 0.3], [o.crossB, 0.022, z0], [o.crossA, 0.022, z0], hex(0xf2efe6)); }
    }
  }
  if (rear && level !== 2) { // rear apron onto the sidewalk
    for (let i = 0; i < 2; i++) for (let j = 0; j < 4; j++) { const x0 = D + 0.12 + i * 0.45, z0 = -1.1 + j * 0.55; b.quad([x0, 0.02, z0 + 0.55], [x0 + 0.45, 0.02, z0 + 0.55], [x0 + 0.45, 0.02, z0], [x0, 0.02, z0], (i + j) % 2 ? tB : tA); }
  }
  if (level !== 2) {
    // counter along the +z side wall (aisle on the door axis stays clear)
    b.ao = 0.62; b.sunBoost = 0.35;
    b.box(D * 0.5, 0.12, hw - 0.6, Math.min(2.6, D - 1.2), 0.98, 0.5, mul(wood, 0.85), { skipBottom: true, top: wood });
    b.box(D * 0.5, 1.6, hw - 0.3, Math.min(2.4, D - 1.4), 0.05, 0.18, wood);
    if (level === 0) for (let k = 0; k < 8; k++) b.box(D * 0.5 - 1.0 + k * 0.28, 1.65, hw - 0.3, 0.08, 0.24, 0.08, [hex(0x3f7f3a), hex(0x9a3a2a), hex(0xd8c070), hex(0x2a4a7a)][k % 4], { skipBottom: true });
    const tz = level === 0 ? [-hw + 1.1, -2.1, 2.2] : [-hw + 1.3, 2.2];
    tz.forEach((z, k) => tableSet(b, D * 0.5, 0.12, z, Math.PI / 2, [true, k !== 1 || level === 1], k + 1 + v));
    b.ao = 2.6; b.sunBoost = 0;
    b.wet = 3.7; for (const z of tz) b.box(D * 0.5, 2.6, z, 0.18, 0.12, 0.18, hex(0xffe6a8)); b.wet = 0; // v2.5.18 warm pendants
    b.ao = 1; b.sunBoost = 1;
    // two waiters (beach resto style)
    b.push(); b.translate(D * 0.32, 0.12, -1.35); b.rotY(-Math.PI / 2); sportFig(b, 1, 0, SKINS[1], 'tray'); b.pop();
    b.box(D * 0.32 + 0.38, 1.12, -1.35, 0.34, 0.03, 0.34, METAL);
    b.push(); b.translate(D * 0.72, 0.12, hw - 1.25); b.rotY(Math.PI * 0.85); sportFig(b, 1, 2, SKINS[3], 'tray'); b.pop();
    b.box(D * 0.72 - 0.2, 1.12, hw - 1.25 - 0.3, 0.34, 0.03, 0.34, METAL);
  }
  emitBulbs(b, cafeLights(level, o), level); // v2.5.18 festoons + path lanterns
  // glass LAST: front (door gap), rear (door gap if rear door), sides, transoms
  const y0 = 0.3, sy = wallH - 0.75;
  const run = (x) => { for (const [z0, z1] of [[-hw + 0.15, -dh - 0.12], [dh + 0.12, hw - 0.15]]) pane(x, y0, (z0 + z1) / 2, 0.05, sy, z1 - z0 - 0.06); pane(x, 2.62, 0, 0.05, 0.18, dh * 2); };
  run(0.0);
  if (rear) run(D); else pane(D, y0, 0, 0.05, sy, W - 0.3);
  for (const s of [-1, 1]) pane(D / 2, y0, s * hw, D - 0.3, sy, 0.05);
  b.wet = 0;
  return b.build();
}

// Per-preset density (per LOD0 chunk; riders are a pool around the camera).
// v2.5.5: part of the cyclists / scooters became rollerbladers, skateboarders and surfers (bike lane),
// plus sea bathers with a wave surfer further out (sea) per chunk, and a pool of beach goers (walk kit, no extra draw).
const DENSITY = {
  // v2.5.16: no fill on asphalt; restos +10 m back; cars/two-way/lights kept
  LOW:    { sun: 5, walk: 5, bench: 2, sit: 6, camp: 0, matkot: 0, cafe: 0, street: 0, cyc: 2, sco: 0, blade: 1, skate: 0, surf: 0, sea: 0, goers: 3, leaves: 0, boats: 3, dinghies: 0, cars: 10, roadXers: 4, sideWalkers: 4, shops: 4, lights: 3, crosses: 3, signs: 3, blvdCafes: 3, furn: 10, visitors: 4 },
  MEDIUM: { sun: 5, walk: 6, bench: 2, sit: 6, camp: 2, matkot: 0, cafe: 0, street: 1, cyc: 2, sco: 1, blade: 1, skate: 1, surf: 1, sea: 1, goers: 4, leaves: 36, boats: 5, dinghies: 2, cars: 18, roadXers: 8, sideWalkers: 8, shops: 5, lights: 4, crosses: 4, signs: 5, blvdCafes: 4, furn: 16, visitors: 6 },
  HIGH:   { sun: 8, walk: 10, bench: 3, sit: 10, camp: 3, matkot: 1, cafe: 2, street: 2, cyc: 3, sco: 2, blade: 2, skate: 2, surf: 1, sea: 2, goers: 6, leaves: 70, boats: 6, dinghies: 3, cars: 28, roadXers: 12, sideWalkers: 14, shops: 7, lights: 5, crosses: 5, signs: 6, blvdCafes: 5, furn: 24, visitors: 10 },
  ULTRA:  { sun: 10, walk: 13, bench: 3, sit: 12, camp: 4, matkot: 2, cafe: 3, street: 2, cyc: 4, sco: 3, blade: 3, skate: 2, surf: 2, sea: 3, goers: 8, leaves: 100, boats: 8, dinghies: 4, cars: 34, roadXers: 16, sideWalkers: 18, shops: 8, lights: 6, crosses: 6, signs: 8, blvdCafes: 6, furn: 30, visitors: 12 },
};
const CHUNK_KITS = ['sun', 'walk', 'bench', 'sit', 'camp', 'matkot', 'cafe', 'street', 'sea'];
const RIDER_KINDS = ['cyc', 'sco', 'blade', 'skate', 'surf'];
const RIDER_ID = { cyc: 1, sco: 2, blade: 3, skate: 4, surf: 5 };
// v2.5.6 free will on the bike lane: speed range per kind (m/s); riders choose pace, lane position,
// a slow look at the beach, skaters stop and go, and riders may tag along behind another for a while.
const VR = { cyc: [5, 7.5], sco: [4, 6], blade: [4.5, 6.5], skate: [3.5, 5], surf: [1.5, 2.3] };
const dampD = (a, b, k, dt) => a + (b - a) * (1 - Math.exp(-k * dt));

// cafes and kiosks per chunk variant (must match world.js buildChunk)
function cafesFor(v) {
  // v2.5.12: seating only where a boulevard cafe exists (~every 200 m)
  if (hash2(v, 71) >= 0.2) return [];
  return [[(hash2(v, 12) - 0.5) * 16, 9 + hash2(v, 13) * 2]];
}

export function decorTris() { const o = {}; for (const [k, f] of Object.entries({ sun: sunbatherGeo, bench: benchKitGeo, sit: sitterGeo, camp: campGeo, matkot: matkotGeo, cafe: cafeSetGeo, street: streetGeo, cyc: cyclistGeo, sco: scooterGeo, blade: () => bladerGeo(false), skate: () => skaterGeo(false), surf: surferWalkGeo, sea: seaBathersGeo })) { const g = f(); o[k] = g.attributes.position.count / 3; } return o; }

// v2.5.8 beach sites, fixed in world z (independent of the chunk RNG): restaurants every ~250 m (beach side
// of the sea wall, next to a crossing), volleyball every ~300 m, football every ~180 m, racquet (matkot)
// couples every ~200 m. LOW keeps every other volleyball court / football group and fewer players.
// v2.5.17: carGeo body lengths (metres, before per-car scale)
const CAR_LEN = [4.15, 3.55, 4.75, 4.45];
// v2.5.12 city strip (world-z sites, independent of chunk RNG)
const CITY = {
  cross: { every: 130, off: 40 },
  light: { every: 180, off: 55 },
  shop: { every: 100, off: 50 },    // v2.5.14: glass restos ~every 100 m on the right
  sign: { every: 70, off: 15 },
  blvd: { every: 100, off: 25 },    // plaza-edge cafés also ~100 m
  furn: { every: 16, off: 5 },  // v2.5.14: denser street fill
  slamp: { every: 15, off: 8 }, // v2.5.19: road street lamps, alternating curbs (30 m per side)
};
const RESTO_COL = [0, 1, 2, 3, 6, 8, 9];
const RESTO_DINERS = 3; // v2.5.11: walkers who stroll terrace ↔ sand via the open sea wall

// static beach things baked into the chunk meshes (umbrellas + sunbeds, lifeguard tower, old volleyball net)
// v2.5.18: beachBusy moved to places.js (shared with the sim's free will)

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
    this.mat = bakedMaterial({ tint: true, bob: true, lodFade: true, glows: true }); // v2.5.18 glows: car lamps
    this.restoMat = bakedMaterial({ tint: true, bob: true, lodFade: true, glass: true, glows: true });
    this.glowMat = glowMaterial(); // v2.5.18 additive halos / ground pools (one draw per fleet) // v2.5.9 see-through cafe panes
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
    for (const m of (this.cityMeshes || [])) { this.scene.remove(m); if (m.dispose) m.dispose(); }
    this.cityMeshes = []; this.cars = []; this.cityLights = []; this.cityCross = []; this.cityShops = []; this.citySigns = []; this.cityBlvd = []; this.cityFurn = []; this.cityLamps = [];
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
      const n = per * (RIDER_KINDS.includes(name) ? 1 : this.D) + (name === 'walk' ? (d.goers || 0) + RESTO_DINERS + (d.roadXers || 0) + (d.sideWalkers || 0) + (d.visitors || 0) : 0) + extra;
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
    // v2.5.12: pedestrians crossing the city road both ways (free-will stream)
    this.roadXers = [];
    if (this.kits.walk) for (let k = 0; k < (d.roadXers || 0); k++) {
      const i = this.kits.walk.per * this.D + (d.goers || 0) + RESTO_DINERS + k;
      this.roadXers.push({ i, on: false, x: 0, z: 0, state: 'idle', hold: 1 + k * 2.2, dir: 1, v: 1.2 });
      this.kits.walk.set.hide(i);
    }
    this.willStats.road = 0;
    // v2.5.13: free-will sidewalk crowds on plaza (A) and shop (B) sides of the road
    this.sideWalkers = [];
    if (this.kits.walk) for (let k = 0; k < (d.sideWalkers || 0); k++) {
      const i = this.kits.walk.per * this.D + (d.goers || 0) + RESTO_DINERS + (d.roadXers || 0) + k;
      this.sideWalkers.push({ i, on: false, x: 0, z: 0, state: 'idle', hold: 0.5 + k * 0.7, side: k % 2, v: 1.1 });
      this.kits.walk.set.hide(i);
    }
    this.willStats.side = 0;
    // v2.5.18: eatery visitors (in through the door, linger inside, out through a door; never through glass)
    this.visitors = []; this.xwalkBusy = [];
    if (this.kits.walk) for (let k = 0; k < (d.visitors || 0); k++) {
      const i = this.kits.walk.per * this.D + (d.goers || 0) + RESTO_DINERS + (d.roadXers || 0) + (d.sideWalkers || 0) + k;
      this.visitors.push({ i, on: false, hold: 1.5 + k * 1.3, route: null, wi: 0 });
      this.kits.walk.set.hide(i);
    }
    this.willStats.visit = 0; this.willStats.visitSim = 0;
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
    // v2.5.12 city road fleets (cars + static road furniture recycled with the camera)
    this.cityMeshes = []; this.cars = []; this.cityLights = []; this.cityCross = []; this.cityShops = []; this.citySigns = []; this.cityBlvd = []; this.cityFurn = []; this.cityLamps = [];
    const gMat = this.restoMat; // v2.5.18: real see-through glass (cityGlassMat was never defined -> solid panes)
    const mkCity = (geo, n, seed, list, kind, mat) => {
      if (n <= 0) return null;
      const mesh = new THREE.InstancedMesh(geo, mat || this.mat, n);
      mesh.frustumCulled = false; mesh.count = n; mesh.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
      mesh.setColorAt(0, new THREE.Color(1, 1, 1));
      this.scene.add(mesh); this.cityMeshes.push(mesh);
      const cr = makeRng(seed);
      for (let i = 0; i < n; i++) {
        const col = new THREE.Color();
        if (kind === 'car') col.setHex(carColors()[cr.int(0, carColors().length - 1)]);
        else if (kind === 'shop' || kind === 'cafe' || kind === 'blvd') col.setRGB(...NEON[(i * 3 + (seed & 7)) % NEON.length]); // v2.5.18 neon hue
        else col.setRGB(1, 1, 1);
        mesh.setColorAt(i, col);
        list.push({ mesh, i, kind, z: 1e9, x: 0, dir: 1, v: 8, yaw: 0, s: 1, ph: cr.range(0, 6.28), k: i, wait: 0 });
      }
      if (mesh.instanceColor) mesh.instanceColor.needsUpdate = true;
      return mesh;
    };
    const nCars = d.cars || 0;
    const shares = [0.35, 0.25, 0.2, 0.2];
    let left = nCars;
    for (let kind = 0; kind < 4; kind++) {
      const n = kind === 3 ? left : Math.max(0, Math.round(nCars * shares[kind]));
      left -= n;
      mkCity(carGeo(kind), n, 0xc2a700 + kind, this.cars, 'car');
      for (const c of this.cars) if (c.body === undefined) c.body = kind; // v2.5.17: real body kind (c.kind is 'car')
    }
    // v2.5.17: alternate lanes over the whole fleet so both lanes are evenly dense
    this.cars.forEach((c, g) => {
      c.g = g; c.dir = g % 2 === 0 ? -1 : 1;
      c.len = CAR_LEN[c.body] || 4.2;
    });
    this.carLaneInit = false;
    mkCity(trafficLightGeo(!this.lowSites), d.lights || 0, 0x71a00, this.cityLights, 'light');
    mkCity(zebraGeo(), d.crosses || 0, 0x2eb2a, this.cityCross, 'cross');
    // v2.5.14: roadside glass restaurants (~every 100 m), beach-resto style with waiters
    const restoLv = this.lowSites ? 1 : 0;
    const nShop = d.shops || 0;
    const cityPath = SHOP_X - (SIDE_B + 0.55); // paved path from the shop sidewalk to the door
    mkCity(glassCafeGeo(restoLv, { depth: 5.0, width: 10.4, pathLen: cityPath, variant: 0, awningW: 2.8 }), Math.ceil(nShop * 0.5), 0x50a11, this.cityShops, 'shop', gMat);
    mkCity(glassCafeGeo(restoLv, { depth: 5.0, width: 10.4, pathLen: cityPath, variant: 2, awningW: 2.8 }), Math.floor(nShop * 0.5), 0x50a22, this.cityShops, 'cafe', gMat);
    mkCity(roadSignGeo(0), Math.ceil((d.signs || 0) * 0.5), 0x51901, this.citySigns, 'sign');
    mkCity(roadSignGeo(1), Math.floor((d.signs || 0) * 0.5), 0x51902, this.citySigns, 'sign');
    // v2.5.19 road street lamps on both curbs (one instanced draw, recycled with the camera)
    this.cityLamps = [];
    const nLamp = Math.ceil(((this.siteRange || 200) + 40) / CITY.slamp.every) + 1;
    mkCity(streetLampGeo(!this.lowSites), nLamp, 0x5a3b1, this.cityLamps, 'slamp');
    this.cityFurn = [];
    const nF = d.furn || 0;
    const NK = 8; // v2.5.14 fill kinds
    for (let fi = 0; fi < NK; fi++) {
      const n = fi < NK - 1 ? Math.floor(nF / NK) : nF - (NK - 1) * Math.floor(nF / NK);
      mkCity(streetFurnGeo(fi), Math.max(0, n), 0x81f00 + fi, this.cityFurn, 'furn');
      for (const slot of this.cityFurn) if (slot.furnKind === undefined && slot.kind === 'furn') slot.furnKind = fi;
    }
    // plaza-edge cafés (also ~100 m)
    // v2.5.18: plaza glass cafes fully inside the plaza (x 8.4..12.9, curb at 15.0), front door + path +
    // bike-lane crosswalk toward the boulevard, rear door onto the plaza sidewalk
    mkCity(glassCafeGeo(restoLv, { depth: PCAFE_D, width: PCAFE_W, rearDoor: true, pathLen: PCAFE_X - 6.45, crossA: 4.45 - PCAFE_X, crossB: 6.4 - PCAFE_X, variant: 1, awningW: 2.3 }), d.blvdCafes || 0, 0x60b01, this.cityBlvd, 'blvd', gMat);

    // v2.5.18 establishment + car light layers (additive sprites / pools, mirrored from the fleets)
    this.glow = [];
    const mkGlow = (geo, n, src) => {
      if (n <= 0) return null;
      const m = new THREE.InstancedMesh(geo, this.glowMat, n);
      m.frustumCulled = false; m.count = 0; m.renderOrder = 3; m.visible = false;
      m.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
      this.scene.add(m); const e = { mesh: m, src }; this.glow.push(e); return e;
    };
    const lowG = this.lowSites;
    mkGlow(lightsGlowGeo(cafeLights(restoLv, { depth: 5.0, width: 10.4, pathLen: cityPath, awningW: 2.8 }), lowG), nShop, 'shops');
    mkGlow(lightsGlowGeo(cafeLights(restoLv, { depth: PCAFE_D, width: PCAFE_W, rearDoor: true, pathLen: PCAFE_X - 6.45, variant: 1, awningW: 2.3 }), lowG), d.blvdCafes || 0, 'blvd');
    mkGlow(lightsGlowGeo(restoLights(lowG ? 1 : 0), lowG), this.siteCap ? (this.siteCap.resto || 3) : 3, 'resto');
    // v2.5.19 street lamps: road lamps mirror their fleet; chunk lamps follow the streamed LOD0 / near chunks
    mkGlow(roadLampGlowGeo(lowG), this.cityLamps.length, 'slamp');
    mkGlow(chunkLampGlowGeo(lowG), Math.ceil(((p.lod0 || 120) + 80) / L) + 2, 'chunk');
    // cars: one glow mesh per body-kind mesh (same instance indices), brake = instance colour r
    for (const cm of new Set(this.cars.map((c) => c.mesh))) {
      const c0 = this.cars.find((c) => c.mesh === cm);
      const e = mkGlow(carGlowGeo(c0.body | 0), cm.count, 'cars');
      e.carMesh = cm; e.mesh.count = cm.count; e.mesh.visible = true;
      for (let i = 0; i < cm.count; i++) e.mesh.setColorAt(i, new THREE.Color(0, 0, 0));
    }
    this.cityBldgs = []; // v2.5.14: discarded tall glass roadside buildings
    this.cityKey = null;
  }
  // v2.5: LOD distances follow the preset, scaled down first by the adaptive safety net
  // (v2.5.24: the far tier now moves closer with a shorter range too; it used to move away)
  setLodScale(k) {
    this.lodScale = k;
    const c = this.preset.lod, f = c.fade;
    for (const [name, kit] of Object.entries(this.kits)) {
      const big = name === 'bench' || name === 'cafe';
      kit.set.configure({ near: (big ? c.nearProp : c.near) * k, nearMax: Math.max(0, Math.round((big ? c.nearPropMax : c.nearMax) * k)), far: c.far * Math.max(0.5, k) * (name === 'walk' ? 0.8 : name === 'resto' ? 2.4 : 1), hyst: c.hyst, fade: f });
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
    // v2.5.20: the placement itself is shared with the sim (places.js beachSite, same formulas as before)
    const b = beachSite(type, k);
    if (!b) return null;
    const s = { type, k, x: b.x, z: b.z, yaw: b.yaw, scale: 1, col: RESTO_COL[Math.floor(b.h(2) * RESTO_COL.length)], box: b.box, lowSkip: false };
    if (type === 'resto') s.y = 0;
    else {
      const ci = Math.floor(-s.z / L);
      s.y = sandY(s.x, s.z + (ci + 0.5) * L, chunkVariant(ci));
      if (type === 'foot') { const extra = Math.floor(b.h(3) * 4); s.extra = extra; s.extraLow = Math.min(1, extra); }
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
  // v2.5.12: place road furniture + shops by world-z, drive cars, crosswalk pedestrians
  cityAt(type, k) {
    const S = CITY[type];
    const z = -(S.off + k * S.every);
    const h = hash2(k * 13 + type.length * 9, 44);
    if (type === 'cross') return { type, k, x: (ROAD_X0 + ROAD_X1) * 0.5, z, yaw: 0 };
    if (type === 'light') {
      // v2.5.13: snap near the nearest zebra so lights and crossings read together
      const ck = Math.round((-z - CITY.cross.off) / CITY.cross.every);
      const cz = -(CITY.cross.off + Math.max(0, ck) * CITY.cross.every);
      const side = (k % 2 === 0) ? ROAD_X0 - 0.65 : ROAD_X1 + 0.28; // v2.5.15: right pole on curb lip
      return { type, k, x: side, z: cz + (h - 0.5) * 2.5, cz, yaw: side < ROAD_MID ? Math.PI / 2 : -Math.PI / 2, ped: true };
    }
    if (type === 'shop') {
      const x = SHOP_X + (h - 0.5) * 0.5;
      return { type, k, x, z: z + (h - 0.5) * 6, yaw: 0, kind: (k % 2 === 0) ? 'shop' : 'cafe', col: Math.floor(h * 9) };
    }
    if (type === 'blvd') {
      const pz = plazaCafeZ(k); if (pz === null) return null; // v2.5.18: snapped clear of palms / lamps / kiosks
      return { type, k, x: PCAFE_X, z: pz, yaw: 0, col: Math.floor(h * 7) };
    }
    if (type === 'sign') {
      const side = h > 0.5 ? ROAD_KERB_X0 - 0.6 : FILL_X; // v2.5.18: plaza signs fully off the curb (panel ends 14.97)
      return { type, k, x: side, z: z + (h - 0.5) * 12, yaw: 0 };
    }
    if (type === 'slamp') {
      // v2.5.19: alternate curbs; keep clear of zebras + traffic-light poles (+-5 m) and plaza road signs
      const sideA = k % 2 === 0;
      const z0 = z + (h - 0.5) * 3;
      const clear = (zz) => {
        const ck = Math.max(0, Math.round((-zz - CITY.cross.off) / CITY.cross.every));
        if (Math.abs(zz + CITY.cross.off + ck * CITY.cross.every) < 5) return false;
        if (!sideA) return true;
        const S2 = CITY.sign, sk = Math.round((-zz - S2.off) / S2.every);
        for (let j = sk - 1; j <= sk + 1; j++) {
          if (j < 0) continue; const sg = this.cityAt('sign', j);
          if (sg && sg.x < ROAD_MID && Math.abs(sg.z - zz) < 2.2) return false;
        }
        return true;
      };
      let zz = null;
      for (const off of [0, 2.5, -2.5, 5, -5, 7.5, -7.5]) if (clear(z0 + off)) { zz = z0 + off; break; }
      if (zz === null) return null;
      return { type, k, x: sideA ? ROAD_KERB_X0 - 0.36 : ROAD_KERB_X1 + 0.36, z: zz, yaw: sideA ? Math.PI : 0 };
    }
    if (type === 'furn') {
      // v2.5.18: never on asphalt, never inside a cafe / on its entrance path, off the walker lines:
      // plaza (x 9.4 / 11.2), between the curb and the shop-side walkers (24.6), between the walkers and
      // the city cafes (28.7), and the fill band behind the city cafes (FILL_X)
      const band = Math.floor(h * 6); // 0..5
      const xs = [9.4, 11.2, 24.6, 28.7, FILL_X - 0.8, FILL_X + 0.9];
      const x = xs[band] + (hash2(k, 91) - 0.5) * 0.4, zz = z + (h - 0.5) * 6;
      if (plazaHit(x, zz, 1.4)) return null;
      if (x > 27 && x < 33 && this.shopNear(zz, 2.6)) return null;
      return { type, k, x, z: zz, yaw: (h - 0.5) * 0.6, kind: Math.floor(hash2(k, 57) * 8) };
    }
    return null;
  }
  // v2.5.18: is a city glass cafe door within dz of z? (keeps their entrance paths clear)
  shopNear(z, dz) {
    const S = CITY.shop, kc = Math.round((-z - S.off) / S.every);
    for (let k = kc - 1; k <= kc + 1; k++) { if (k < 0) continue; const s = this.cityAt('shop', k); if (s && Math.abs(s.z - z) < dz + 5.4) return s; }
    return null;
  }
  nearestCityLight(z) {
    const S = CITY.light;
    const k = Math.round((-z - S.off) / S.every);
    let best = null, bestD = 1e9;
    for (let kk = k - 1; kk <= k + 1; kk++) {
      if (kk < 0) continue;
      const L = this.cityAt('light', kk);
      const d = Math.abs(L.z - z);
      if (d < bestD) { bestD = d; best = L; }
    }
    return best;
  }
  putCity(list, cap, placeFn) {
    const used = new Uint8Array(Math.max(1, cap));
    let n = 0;
    for (let i = 0; i < list.length; i++) {
      const slot = list[i];
      const s = placeFn(i, slot);
      if (!s) { slot.z = 1e9; continue; }
      const idx = i; // one instance each
      _o.position.set(s.x, s.y || 0, s.z);
      _o.rotation.set(0, s.yaw || 0, 0);
      _o.scale.setScalar(s.s || 1);
      _o.updateMatrix();
      slot.mesh.setMatrixAt(slot.i, _o.matrix);
      if (s.col && slot.mesh.instanceColor) {
        const c = new THREE.Color(s.col);
        slot.mesh.setColorAt(slot.i, c);
      }
      slot.z = s.z; slot.x = s.x; slot.k = s.k; slot.meta = s;
      n++;
    }
    return n;
  }
  updateCity(camZ, t, dt) {
    const R = this.siteRange || 200;
    const key = Math.round(camZ / 5);
    // place static city furniture when the camera band moves
    if (key !== this.cityKey) {
      this.cityKey = key;
      const placeBand = (type, list) => {
        if (!list.length) return;
        const S = CITY[type === 'cafe' ? 'shop' : type] || CITY.shop;
        const kA = Math.max(0, Math.floor((-(camZ + 40) - S.off) / S.every));
        const kB = Math.ceil((-(camZ - R) - S.off) / S.every);
        const slots = list.slice();
        let si = 0;
        const usedK = new Set();
        for (let k = kA; k <= kB && si < slots.length; k++) {
          const s = this.cityAt(type === 'cafe' ? 'shop' : type, k);
          if (!s || s.z > camZ + 35 || s.z < camZ - R) continue;
          if (type === 'shop' && s.kind !== 'shop') continue;
          if (type === 'cafe' && s.kind !== 'cafe') continue;
          if (usedK.has(k)) continue; usedK.add(k);
          // v2.5.14: prefer a fleet slot whose geometry matches the wanted kind
          let slot = null;
          if (type === 'furn' && s.kind != null) {
            const want = ((s.kind % 8) + 8) % 8;
            const j = slots.findIndex((x, i) => i >= si && (x.furnKind | 0) === want);
            if (j >= 0) { slot = slots[j]; slots[j] = slots[si]; slots[si] = slot; si++; }
          }
          if (!slot) slot = slots[si++];
          _o.position.set(s.x, 0, s.z);
          // glass façades face -x (toward boulevard / road)
          if (type === 'cross') _o.rotation.set(0, 0, 0);
          else if (type === 'light') _o.rotation.set(0, s.yaw, 0);
          else if (type === 'sign') _o.rotation.set(0, s.x < ROAD_MID ? Math.PI / 2 : -Math.PI / 2, 0);
          else if (type === 'shop' || type === 'cafe' || type === 'blvd') _o.rotation.set(0, 0, 0);
          else if (type === 'furn') _o.rotation.set(0, s.yaw || 0, 0);
          else _o.rotation.set(0, s.yaw || 0, 0);
          _o.scale.setScalar(1);
          _o.updateMatrix();
          slot.mesh.setMatrixAt(slot.i, _o.matrix);
          slot.z = s.z; slot.x = s.x; slot.k = s.k; slot.meta = s;
        }
        while (si < slots.length) {
          const slot = slots[si++];
          _o.position.set(0, -20, 1e6); _o.scale.setScalar(0.001); _o.updateMatrix();
          slot.mesh.setMatrixAt(slot.i, _o.matrix);
          slot.z = 1e9;
        }
        const seen = new Set();
        for (const slot of list) {
          if (seen.has(slot.mesh)) continue; seen.add(slot.mesh);
          slot.mesh.instanceMatrix.needsUpdate = true;
          if (slot.mesh.instanceColor) slot.mesh.instanceColor.needsUpdate = true;
        }
      };
      // split shop list by kind
      const shops = this.cityShops.filter((s) => s.kind === 'shop');
      const cafes = this.cityShops.filter((s) => s.kind === 'cafe');
      placeBand('cross', this.cityCross);
      placeBand('light', this.cityLights);
      placeBand('shop', shops);
      placeBand('cafe', cafes);
      placeBand('sign', this.citySigns);
      placeBand('blvd', this.cityBlvd || []);
      placeBand('furn', this.cityFurn || []);
      placeBand('slamp', this.cityLamps || []);
      this.cityLiveLights = this.cityLights.filter((L) => L.z < 1e8).map((L) => L.meta || this.cityAt('light', L.k));
      this.cityLiveCross = this.cityCross.filter((c) => c.z < 1e8).map((c) => ({ z: c.z, x: c.x }));
    }
    // tint traffic lights by phase
    const col = new THREE.Color();
    for (const L of this.cityLights) {
      if (L.z > 1e8) continue;
      const ph = lightPhase(t, L.k | 0);
      const tint = lightTint(ph);
      col.setRGB(tint[0], tint[1], tint[2]);
      L.mesh.setColorAt(L.i, col);
      L.ph = ph;
    }
    if (this.cityLights.length && this.cityLights[0].mesh.instanceColor) this.cityLights[0].mesh.instanceColor.needsUpdate = true;
    // unique meshes for light color update
    const lMeshes = new Set(this.cityLights.map((L) => L.mesh));
    for (const m of lMeshes) if (m.instanceColor) m.instanceColor.needsUpdate = true;

    // v2.5.17: two-way right-hand traffic. Player looks toward -z with the city on the right (+x):
    // cars heading -z (away, same way as the runner) keep right -> far lane LANE_OUT;
    // cars heading +z (toward the camera) keep right -> near lane LANE_IN. Model front (-z local)
    // always points along travel (yaw 0 for -z, PI for +z). Per-lane spacing, no overlap, stop at red.
    if (this.cars && this.cars.length) this.updateCars(camZ, t, dt);
  }
  // v2.5.19 car sound events. Honks: sensible triggers + a global cooldown (a few per minute near the
  // player at most); whoosh when a car passes the runner; a shared hum level from the nearby cars.
  carHonk(kind, c, pattern) {
    const r = this.runnerRef; if (!r || !this.onHonk || this.honkCd > 0) return false;
    const dx = c.x - r.x, dz = c.z - r.z;
    if (Math.hypot(dx, dz) > 70) return false;           // only where the player can hear it
    const p = kind === 'brake' ? 0.75 : kind === 'green' ? 0.6 : 0.35;
    if (!this.wr.chance(p)) { this.honkCd = 1.5; return false; }
    this.honkCd = this.wr.range(9, 17);                  // global cooldown => ~4-6 / min near the player
    this.honkStats[kind] = (this.honkStats[kind] || 0) + 1;
    this.onHonk(pattern, dx, dz, c.g);
    return true;
  }
  updateCars(camZ, t, dt) {
    const Z0 = camZ - 200, Z1 = camZ + 40, SPAN = Z1 - Z0;
    const cars = this.cars;
    if (!this.honkStats) { this.honkStats = { brake: 0, green: 0, ped: 0 }; this.honkCd = 6; this.whooshCd = 0; this.whooshN = 0; this.trafficHum = { level: 0, v: 0, pan: 0 }; }
    if (this.honkCd > 0) this.honkCd -= dt;
    if (this.whooshCd > 0) this.whooshCd -= dt;
    const laneOf = (c) => (c.dir < 0 ? 1 : 0); // 0 = near (LANE_IN, +z), 1 = far (LANE_OUT, -z)
    const setup = (c) => {
      c.x = c.dir < 0 ? LANE_OUT : LANE_IN;           // centred in lane
      c.yaw = c.dir < 0 ? 0 : Math.PI;
      c.s = 0.98 + (c.g % 4) * 0.05;                  // v2.5.15 people-proportionate scale
      c.len = (CAR_LEN[c.body] || 4.2) * c.s;
      c.cruise = 8 + (c.body === 2 ? -1.6 : c.body === 3 ? -0.6 : 0.4) + ((c.g * 7) % 5) * 0.35;
      c.wait = 0; c.commitK = -1; c.stopK = -1;
    };
    const lanes = [[], []];
    for (const c of cars) lanes[laneOf(c)].push(c);
    // (re)layout a lane evenly when it has no live cars (first frame, camera jump, preset change)
    for (const L of lanes) {
      const live = L.filter((c) => c.z < 1e8 && c.z > Z0 - 20 && c.z < Z1 + 20);
      if (live.length) continue;
      const step = SPAN / L.length;
      L.forEach((c, j) => {
        setup(c);
        const jit = (hash2(c.g, 17) - 0.5) * step * 0.35;
        c.z = Z1 - step * (j + 0.5) + jit + (c.dir < 0 ? 0 : step * 0.5);
        c.v = c.cruise;
      });
    }
    // recycle cars that left the window to the opposite end of their own lane, behind the last car
    for (const L of lanes) {
      for (const c of L) {
        if (c.z < 1e8 && c.z >= Z0 && c.z <= Z1) continue;
        const exitedFront = c.z < 1e8 && c.z < Z0;
        let zs = L.filter((o) => o !== c && o.z < 1e8 && o.z >= Z0 - 10 && o.z <= Z1 + 10).map((o) => o.z);
        setup(c);
        // v2.5.24: a car beyond the auto-tune traffic cap waits off-screen (the fleet thins as cars leave the view)
        if ((c.rank ?? (c.rank = hash2(c.g + 911, 29))) >= (this.carCap ?? 1)) { c.z = 1e9 + 1; continue; }
        // v2.5.24 chaos drift: traffic density (0.85..1.15) scales the free spacing between recycled cars
        const gap = c.len + (7 + hash2(c.g, Math.floor(t * 3)) * 9) / (this.traffic || 1);
        if (!exitedFront) {
          const far = zs.length ? Math.min(...zs) : Z1;
          const z = Math.min(far - gap, Z1 - 6);
          if (z < Z0) { c.z = 1e9 + 1; continue; } // lane full: wait off-screen
          c.z = z;
        } else {
          const near = zs.length ? Math.max(...zs) : Z0;
          const z = Math.max(near + gap, Z0 + 6);
          if (z > Z1) { c.z = 1e9 + 1; continue; }
          c.z = z;
        }
        c.v = c.cruise;
      }
    }
    // drive: car-following within each lane + stop before the zebra on a red, own direction only
    for (const L of lanes) {
      const live = L.filter((c) => c.z < 1e8);
      // order by progress along travel (leader first)
      live.sort((a, b) => (b.z - a.z) * a.dir);
      for (let i = 0; i < live.length; i++) {
        const c = live[i];
        let vWant = c.cruise, hardCap = 1e9;
        const light = this.nearestCityLight(c.z);
        if (light) {
          const zc = light.cz != null ? light.cz : light.z;
          const stopZ = zc - c.dir * 3.0;            // stop line before the zebra in travel direction
          const ahead = (stopZ - c.z) * c.dir - c.len * 0.5;
          if (ahead > -0.6 && ahead < 24 && c.commitK !== light.k) {
            // anticipate the (deterministic) signal: go only if it stays green until the car has
            // cleared the zebra; otherwise brake smoothly to the stop line. Emergency-only commit.
            // enter only if the car reaches the stop line in green with >= 0.5 s of green left
            // (the v2.5.16 signal cycle is short: ~2 s green, so "green until clear" would starve lanes)
            const vv = Math.max(c.v, 3.0), tA = Math.max(0, ahead) / vv;
            let allGreen = true;
            for (let s = 0; s <= 5; s++) if (!carsGreen(lightPhase(t + tA + 0.5 * s / 5, light.k))) { allGreen = false; break; }
            if (!allGreen) {
              const need = (c.v * c.v) / (2 * 7.5);
              if (ahead < need - 0.5 && c.stopK !== light.k) c.commitK = light.k;   // cannot stop: clear the box
              else { c.stopK = light.k; hardCap = Math.sqrt(2 * 5.5 * Math.max(0, ahead - 0.3)); vWant = Math.min(vWant, hardCap); }
            } else if (c.stopK === light.k && carsGreen(lightPhase(t, light.k))) c.stopK = -1;
          }
          if (ahead < -c.len - 8) { if (c.commitK === light.k) c.commitK = -1; if (c.stopK === light.k) c.stopK = -1; }
        }
        let gapL = 1e9, leadC = null;
        if (i > 0) {
          const lead = live[i - 1]; leadC = lead;
          const gap = (lead.z - c.z) * c.dir - (lead.len + c.len) * 0.5; // bumper to bumper
          gapL = gap;
          if (gap < 14) vWant = Math.min(vWant, Math.max(0, (gap - 2.2) * 0.8), lead.v + Math.max(0, gap - 4) * 0.4);
        }
        c.v += (vWant - c.v) * Math.min(1, dt * 2.4);
        if (c.v > hardCap) c.v = hardCap;             // physical braking curve to the stop line
        if (c.v < 0.02) c.v = 0;
        // v2.5.18 brake lights: decelerating, or held at a stop (smoothed so they do not flicker)
        { const decel = ((c.vPrev ?? c.v) - c.v) / Math.max(dt, 1e-3); c.vPrev = c.v;
          const want = (c.v < 0.4 && vWant < 1) || decel > 0.8 ? 1 : 0;
          c.brakeL = (c.brakeL || 0) + (want - (c.brakeL || 0)) * Math.min(1, dt * (want ? 10 : 4));
          // v2.5.19 honks: (1) braking hard right behind another car
          if (dt > 0 && decel > 3.2 && leadC && gapL < 7 && c.v > 1.5) this.carHonk('brake', c, this.wr.chance(0.5) ? 'double' : 'long');
          // (2) light is green but the car ahead (queued at the line) is slow to go: a short tap
          if (leadC && light && gapL < 6 && c.v < 0.5 && leadC.v < 0.5 && carsGreen(lightPhase(t, light.k))) {
            c.greenWait = (c.greenWait || 0) + dt;
            if (c.greenWait > 1.1) { this.carHonk('green', c, 'tap'); c.greenWait = -6; }
          } else if ((c.greenWait || 0) > 0) c.greenWait = 0;
          else if ((c.greenWait || 0) < 0) c.greenWait += dt;
          // (3) now and then at a pedestrian on the zebra ahead (first car of the queue only)
          if (!leadC && light && c.stopK === light.k && c.v < 2.5 && this.wr.next() < dt * 0.25) {
            const zc = light.cz != null ? light.cz : light.z;
            const ped = (this.roadXers || []).concat(this.sideWalkers || []).some((p) => p.on && p.state === 'cross' && Math.abs(p.z - zc) < 3 && p.x > 15 && p.x < 23);
            if (ped) this.carHonk('ped', c, 'tap');
          } }
        c.z += c.dir * c.v * dt;
        if (i > 0) { // hard no-overlap clamp
          const lead = live[i - 1];
          const minD = (lead.len + c.len) * 0.5 + 1.6;
          if ((lead.z - c.z) * c.dir < minD) { c.z = lead.z - c.dir * minD; c.v = Math.min(c.v, lead.v); }
        }
      }
    }
    // v2.5.19 pass-by whoosh + shared engine-hum level (relative to the runner)
    const r = this.runnerRef;
    if (r) {
      const rv = this._rzPrev != null && dt > 0 ? (r.z - this._rzPrev) / dt : 0; this._rzPrev = r.z;
      let lv = 0, vs = 0, ps = 0;
      for (const c of cars) {
        if (c.z > 1e8) { c.relZ = undefined; continue; }
        const dx = c.x - r.x, dz = c.z - r.z, d = Math.hypot(dx, dz);
        const w = Math.exp(-(d * d) / (2 * 22 * 22)) * (0.35 + 0.65 * Math.min(1, c.v / 9));
        lv += w; vs += w * c.v; ps += w * Math.sign(dx);
        // only the nearer lane (closest cars to the runner), a real closing speed, and a short random gap
        if (c.relZ !== undefined && dt > 0 && Math.sign(dz) !== Math.sign(c.relZ) && Math.abs(dx) < 19.5) {
          const relV = Math.abs(c.dir * c.v - rv);
          if (relV > 6 && this.whooshCd <= 0 && this.onWhoosh) {
            this.whooshCd = this.wr.range(1.4, 2.8);
            if (this.wr.chance(0.7)) { this.whooshN++; this.onWhoosh(dx, relV); }
          }
        }
        c.relZ = dz;
      }
      const H = this.trafficHum;
      H.level = Math.min(1, lv / 2.2); H.v = lv > 0 ? vs / lv : 0; H.pan = lv > 0 ? 0.75 * ps / lv : 0;
    }
    for (const c of cars) {
      if (c.z > 1e8) { _o.position.set(0, -20, 1e6); _o.rotation.set(0, 0, 0); _o.scale.setScalar(0.001); }
      else { _o.position.set(c.x, 0, c.z); _o.rotation.set(0, c.yaw, 0); _o.scale.setScalar(c.s); }
      _o.updateMatrix();
      c.mesh.setMatrixAt(c.i, _o.matrix);
    }
    const seen = new Set();
    for (const c of cars) {
      if (seen.has(c.mesh)) continue; seen.add(c.mesh);
      c.mesh.instanceMatrix.needsUpdate = true;
    }
  }
  updateRoadXers(camZ, t, dt) {
    const wk = this.kits.walk;
    if (!wk || !this.roadXers || !this.roadXers.length) return;
    const crosses = this.cityLiveCross || [];
    for (const p of this.roadXers) {
      if (!p.on) {
        if ((p.hold -= dt) > 0) continue;
        if (!crosses.length) { p.hold = this.wr.range(0.8, 2.5); continue; }
        const c = crosses[this.wr.int(0, crosses.length - 1)];
        const toShop = this.wr.chance(0.5);
        const light = this.nearestCityLight(c.z);
        Object.assign(p, {
          on: true, z: c.z + this.wr.range(-0.8, 0.8),
          x: toShop ? SIDE_A : SIDE_B,
          tx: toShop ? SIDE_B : SIDE_A,
          state: 'wait', hold: this.wr.range(0.2, 0.9),
          lightK: light ? light.k : 0, v: 1.2 + this.wr.range(0, 0.4),
          color: this.wr.int(0, SHIRTS.length - 1), scale: 0.95 + this.wr.range(0, 0.1),
          ph: this.wr.range(0, 6.28),
        });
        wk.set.setAttr(p.i, 'aAnim', p.ph, 0.05, 0, 0);
        this.willStats.road++;
      }
      if (p.z > camZ + 45 || p.z < camZ - 220) { p.on = false; p.hold = this.wr.range(0.5, 2.5); wk.set.hide(p.i); continue; }
      const ph = lightPhase(t, p.lightK | 0);
      let face = p.tx > p.x ? -Math.PI / 2 : Math.PI / 2;
      if (p.state === 'wait') {
        p.hold -= dt;
        if (p.hold <= 0) {
          if (pedsWalk(ph) || this.wr.chance(0.14)) {
            p.state = 'cross'; wk.set.setAttr(p.i, 'aAnim', p.ph, 0.42, 0, 0);
          } else p.hold = this.wr.range(0.2, 0.7);
        }
      } else if (p.state === 'cross') {
        const toward = p.tx - p.x;
        p.x += Math.sign(toward || 1) * p.v * dt;
        if (Math.abs(p.x - p.tx) < 0.12) {
          p.x = p.tx;
          p.state = 'linger'; p.hold = this.wr.range(3, 9);
          p.sd = this.wr.chance(0.5) ? -1 : 1;
          wk.set.setAttr(p.i, 'aAnim', p.ph, 0.06, 0, 0);
        }
      } else if (p.state === 'linger') {
        p.hold -= dt;
        p.z += (p.sd || 1) * 0.85 * dt;
        face = (p.sd || 1) < 0 ? 0 : Math.PI;
        // free will: chat pause, reverse, or re-cross
        if (p.hold <= 0) {
          const u = this.wr.next();
          if (u < 0.45) {
            p.tx = (p.x > ROAD_MID) ? SIDE_A : SIDE_B;
            p.state = 'wait'; p.hold = this.wr.range(0.15, 0.7);
            wk.set.setAttr(p.i, 'aAnim', p.ph, 0.05, 0, 0);
          } else if (u < 0.75) {
            p.sd *= -1; p.hold = this.wr.range(2.5, 7); this.willStats.side++;
          } else {
            p.on = false; p.hold = this.wr.range(1.5, 4); wk.set.hide(p.i); continue;
          }
        }
      }
      this.put('walk', p.i, p.x, 0, p.z, face, p.scale, p.color);
    }
  }
  // v2.5.13: dense free-will strollers on both sidewalks (rarely hop into a crossing)
  updateSideWalkers(camZ, t, dt) {
    const wk = this.kits.walk;
    if (!wk || !this.sideWalkers || !this.sideWalkers.length) return;
    const crosses = this.cityLiveCross || [];
    for (const p of this.sideWalkers) {
      if (!p.on) {
        if ((p.hold -= dt) > 0) continue;
        const side = p.side | 0; // 0 = plaza A, 1 = shop B
        const x0 = side === 0 ? SIDE_A : SIDE_B;
        Object.assign(p, {
          on: true, x: x0 + this.wr.range(-0.35, 0.35),
          z: camZ - this.wr.range(5, 140),
          sd: this.wr.chance(0.5) ? -1 : 1,
          state: 'stroll', hold: this.wr.range(4, 14),
          v: 0.95 + this.wr.range(0, 0.45),
          color: this.wr.int(0, SHIRTS.length - 1), scale: 0.94 + this.wr.range(0, 0.12),
          ph: this.wr.range(0, 6.28),
        });
        wk.set.setAttr(p.i, 'aAnim', p.ph, 0.42, 0, 0);
        this.willStats.side++;
      }
      if (p.z > camZ + 40 || p.z < camZ - 200) { p.on = false; p.hold = this.wr.range(0.4, 2); wk.set.hide(p.i); continue; }
      let face = p.sd < 0 ? 0 : Math.PI;
      if (p.state === 'stroll') {
        p.z += p.sd * p.v * dt;
        p.hold -= dt;
        if (p.hold <= 0) {
          const u = this.wr.next();
          if (u < 0.25 && crosses.length) {
            // decide to cross the road
            const c = crosses.reduce((b, o) => Math.abs(o.z - p.z) < Math.abs(b.z - p.z) ? o : b, crosses[0]);
            p.z = c.z + this.wr.range(-0.5, 0.5);
            p.tx = p.x < ROAD_MID ? SIDE_B : SIDE_A;
            p.state = 'wait'; p.hold = this.wr.range(0.2, 0.8);
            const light = this.nearestCityLight(p.z); p.lightK = light ? light.k : 0;
            wk.set.setAttr(p.i, 'aAnim', p.ph, 0.05, 0, 0);
            this.willStats.road++;
          } else if (u < 0.45) {
            p.state = 'pause'; p.hold = this.wr.range(1.5, 4); wk.set.setAttr(p.i, 'aAnim', p.ph, 0.05, 0, 0);
          } else if (u < 0.7) {
            p.sd *= -1; p.hold = this.wr.range(5, 12);
          } else {
            p.hold = this.wr.range(5, 12);
          }
        }
      } else if (p.state === 'pause') {
        p.hold -= dt; face = Math.PI / 2 + Math.sin(t + p.ph) * 0.8;
        if (p.hold <= 0) { p.state = 'stroll'; p.hold = this.wr.range(4, 12); wk.set.setAttr(p.i, 'aAnim', p.ph, 0.42, 0, 0); }
      } else if (p.state === 'wait') {
        p.hold -= dt;
        const ph = lightPhase(t, p.lightK | 0);
        if (p.hold <= 0) {
          if (pedsWalk(ph) || this.wr.chance(0.12)) { p.state = 'cross'; wk.set.setAttr(p.i, 'aAnim', p.ph, 0.42, 0, 0); }
          else p.hold = this.wr.range(0.2, 0.6);
        }
        face = p.tx > p.x ? -Math.PI / 2 : Math.PI / 2;
      } else if (p.state === 'cross') {
        const toward = p.tx - p.x;
        p.x += Math.sign(toward || 1) * (p.v + 0.15) * dt;
        face = toward > 0 ? -Math.PI / 2 : Math.PI / 2;
        if (Math.abs(p.x - p.tx) < 0.12) {
          p.x = p.tx; p.side = p.x > ROAD_MID ? 1 : 0;
          p.state = 'stroll'; p.hold = this.wr.range(4, 11); p.sd = this.wr.chance(0.5) ? -1 : 1;
          wk.set.setAttr(p.i, 'aAnim', p.ph, 0.42, 0, 0);
        }
      }
      this.put('walk', p.i, p.x, 0, p.z, face, p.scale, p.color);
    }
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
  // v2.5.18: plaza decor keeps clear of the plaza glass cafes and their entrance paths (index hidden)
  putP(kit, idx, x, y, z, rotY, scale = 1, color = -1) {
    if (plazaHit(x, z, 0.5)) { const k = this.kits[kit]; if (k && idx >= 0) k.set.hide(idx); return; }
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
    for (const s of seats) { if (!r.chance(0.6)) continue; const i = next('sit'); if (i < 0) break; this.putP('sit', i, s[0], 0, cz + s[1], s[2], 1, col()); }
    // extra cafe tables in the plaza gaps, and street kits (bike rack, planter, rental scooters)
    const busy = cafesFor(variant).map(([zc, w]) => [zc - w / 2 - 1, zc + w / 2 + 1]);
    if (variant % 2 === 1) busy.push([-12, -8]);
    const freeZ = () => { for (let k = 0; k < 8; k++) { const zl = r.range(-18, 18); if (!busy.some(([a, b]) => zl > a && zl < b)) return zl; } return null; };
    for (let i = next('cafe'); i >= 0; i = next('cafe')) { const zl = freeZ(); if (zl === null) break; busy.push([zl - 1.5, zl + 1.5]); this.putP('cafe', i, 8.7, 0, cz + zl, r.range(-0.3, 0.3), 1, col()); }
    for (let i = next('street'); i >= 0; i = next('street')) { const zl = r.range(-15, 15); this.putP('street', i, 7.35, 0, cz + zl, r.chance(0.5) ? Math.PI / 2 : -Math.PI / 2, 1, col()); }
    // standing / walking people: beach walkers to the water, kids playing, plaza chats, kiosk queue
    const wk = this.kits.walk;
    if (wk) {
      // v2.5 near-tier variety per figure (own hash, the chunk layout RNG is untouched)
      const setAnim = (i, ph, amp) => { wk.set.setAttr(i, 'aAnim', ph, amp, 0, 0); const hh = hash2(ci * 53 + i, 17); wk.set.setAttr(i, 'aVar', hh < 0.3 ? 1 : 0, hash2(ci * 53 + i, 23) < 0.45 ? 1 : 0, hash2(ci * 53 + i, 29), 0); };
      let n = wk.per;
      if (variant % 2 === 1 && n >= 3) { // kiosk customers
        for (let k = 0; k < 2; k++) { const i = next('walk'); this.putP('walk', i, 8.25, 0, cz - 10 + (k - 0.5) * 1.1, -Math.PI / 2, 1, col()); setAnim(i, r.range(0, 6), 0.03); }
        n -= 2;
      }
      const chat = Math.round(n * 0.3 / 2) * 2;
      for (let k = 0; k < chat; k += 2) {
        const x = r.range(7.0, 10.0), zl = r.range(-17, 17);
        let i = next('walk'); this.putP('walk', i, x, 0, cz + zl, Math.PI, 1, col()); setAnim(i, r.range(0, 6), 0.04);
        i = next('walk'); this.putP('walk', i, x + r.range(-0.3, 0.3), 0, cz + zl - 0.95, 0, 1, col()); setAnim(i, r.range(0, 6), 0.04);
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
    this.runnerRef = runner; // v2.5.19 car sounds are relative to the runner
    this._camZ = camZ; // v2.5.19 street-lamp glow follows the streamed chunks
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
      // v2.5.18: yield to people on a plaza-cafe crosswalk ahead (bike lane x 4.4..6.4)
      let yieldV = -1;
      for (const xz of this.xwalkBusy) { const ahead = (xz - rd.z) * -rd.dir; if (ahead > -0.6 && ahead < 9) { yieldV = Math.max(0, (ahead - 2.2) * 0.9); break; } }
      if (yieldV >= 0 && yieldV < rd.v) rd.v = dampD(rd.v, yieldV, 4, dt);
      else rd.v = dampD(rd.v, rd.vT, rd.state === 'stop' ? 2.5 : 1.2, dt);
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
    this.updateCity(camZ, t, dt); // v2.5.12 road / shops / cars
    this.updateGlow(dt); // v2.5.18 establishment / car lights
    this.updateRoadXers(camZ, t, dt);
    this.updateSideWalkers(camZ, t, dt);
    this.updateVisitors(camZ, t, dt); // v2.5.18
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
  // v2.5.18: mirror the eatery / car instance matrices into the additive light layers (hidden by day)
  updateGlow(dt) {
    if (!this.glow || !this.glow.length) return;
    const lv = U.uLights.value, on = lv > 0.02;
    const m = this._gm || (this._gm = new THREE.Matrix4()), q = this._gq || (this._gq = new THREE.Quaternion()), sc = this._gs || (this._gs = new THREE.Vector3(1, 1, 1)), ps = this._gp || (this._gp = new THREE.Vector3()), up = this._gu || (this._gu = new THREE.Vector3(0, 1, 0));
    const bc = this._gc || (this._gc = new THREE.Color());
    for (const e of this.glow) {
      const g = e.mesh;
      if (e.src === 'cars') {
        g.instanceMatrix.array.set(e.carMesh.instanceMatrix.array);
        g.instanceMatrix.needsUpdate = true;
        for (const c of this.cars) if (c.mesh === e.carMesh) { bc.setRGB(c.brakeL || 0, 0, 0); g.setColorAt(c.i, bc); }
        if (g.instanceColor) g.instanceColor.needsUpdate = true;
        continue;
      }
      g.visible = on;
      if (!on) continue;
      let n = 0;
      if (e.src === 'chunk') {
        // v2.5.19: one instance per streamed chunk that carries lamps (LOD0 / near tiers)
        const cz0 = this._camZ || 0, R = (this.siteRange || 200) + 20;
        const ciA = Math.floor(-(cz0 + 30) / L), ciB = Math.floor(-(cz0 - R) / L);
        q.identity();
        for (let ci = Math.max(0, ciA); ci <= ciB && n < g.instanceMatrix.count; ci++) {
          if (!this.lodFor || this.lodFor(ci) > 0) continue;
          ps.set(0, 0, -(ci + 0.5) * L); m.compose(ps, q, sc); g.setMatrixAt(n++, m);
        }
      } else if (e.src === 'slamp') {
        for (const s of this.cityLamps || []) { if (s.z > 1e8 || n >= g.instanceMatrix.count) continue; s.mesh.getMatrixAt(s.i, m); g.setMatrixAt(n++, m); }
      } else if (e.src === 'resto') {
        for (const s of this.siteLive || []) {
          if (s.type !== 'resto' || n >= g.instanceMatrix.count) continue;
          ps.set(s.x, 0, s.z); q.setFromAxisAngle(up, s.yaw || 0); m.compose(ps, q, sc); g.setMatrixAt(n++, m);
        }
      } else {
        const list = e.src === 'blvd' ? (this.cityBlvd || []) : (this.cityShops || []);
        for (const s of list) { if (s.z > 1e8 || n >= g.instanceMatrix.count) continue; s.mesh.getMatrixAt(s.i, m); g.setMatrixAt(n++, m); }
      }
      g.count = n; g.instanceMatrix.needsUpdate = true;
    }
  }
  // ---------------- v2.5.18 VISITORS: free will into and out of the eateries ----------------
  // Routes are waypoint lists through the real doors (beach resto boulevard door + sea opening, plaza cafe
  // front / rear doors, city cafe front door). The sim (aicore) hands deck walkers over at a door
  // (toVisit queue); the rest start from the sidewalks. Feet follow the resto steps / cafe floors.
  visitFree() { let n = 0; for (const v of this.visitors || []) if (!v.on) n++; return n; }
  visitY(x, kind) {
    if (kind === 'resto') {
      const lx = x - RESTO_X;
      if (lx > 1.34 + RESTO_F) return 0;
      if (lx > 1.08 + RESTO_F) return 0.23;
      if (lx > 0.30) return 0.46;
      if (lx > 0.05) return 0.33;
      if (lx > -3.8) return 0.2;
      if (lx > -7.3) return 0.18;
      return Math.max(sandY(x, 0, 0) + 0.04, Math.min(0.1, -0.15 - (-7.6 - lx) * 0.04));
    }
    return 0;
  }
  // inside-floor height for cafes: [x0, x1) floors at 0.12
  cafeY(x, v) { return v.fx0 !== undefined && x > v.fx0 + 0.02 && x < v.fx1 - 0.02 ? 0.12 : 0.02; }
  restoRoute(dz, x0, toBeach, wr) {
    const X = (lx) => RESTO_X + lx, Z = (lz) => dz + lz;
    const F = RESTO_F, R = [{ x: x0, z: dz }, { x: X(1.25 + F), z: Z(0) }, { x: X(0.7), z: Z(0) }, { x: X(-0.45), z: Z(0) }];
    if (toBeach) {
      // walk the aisle, out through the terrace and the sea opening, down the steps onto the sand
      R.push({ x: X(-1.0), z: Z(-1.1) }, { x: X(-3.3), z: Z(-1.1) }, { x: X(-3.9), z: Z(0) });
      if (wr.chance(0.5)) R.push({ x: X(-4.6), z: Z(0.3), linger: wr.range(2, 5), face: Math.PI / 2 });
      R.push({ x: X(-7.4), z: Z(0) }, { x: X(-12.6), z: Z(wr.range(-0.4, 0.4)) });
    } else {
      // order at the counter, then back out the same door onto the boulevard
      R.push({ x: X(-0.9), z: Z(-1.1) }, { x: X(-0.9), z: Z(-3.5), linger: wr.range(4, 9), face: 0 }, { x: X(-0.9), z: Z(-1.1) },
        { x: X(-0.45), z: Z(0) }, { x: X(0.7), z: Z(0) }, { x: X(1.25 + F), z: Z(0) }, { x: -4.05, z: Z(0.6) });
    }
    return R;
  }
  // cafe facing -x with its front facade at fx; door at z = dz; depth D (rear door if rear)
  cafeRoute(fx, dz, D, hw, fromRear, outRear, startX, wr) {
    const R = [];
    const counter = { x: fx + 0.75, z: dz + hw - 1.55, linger: wr.range(4, 10), face: Math.PI };
    const table = { x: fx + D * 0.5 - 0.95, z: dz + 1.3, linger: wr.range(6, 14), face: Math.PI }; // by the +z table (waiter stands at -z)
    const front = [{ x: fx - 0.35, z: dz }, { x: fx + 0.6, z: dz }], rear = [{ x: fx + D + 0.45, z: dz }, { x: fx + D - 0.6, z: dz }];
    R.push({ x: startX, z: dz });
    R.push(...(fromRear ? rear : front));
    const stop = wr.chance(0.55) ? counter : table;
    R.push({ x: stop.x, z: dz }, stop, { x: stop.x, z: dz });
    const out = outRear ? rear.slice().reverse() : front.slice().reverse();
    R.push(...out);
    return R;
  }
  liveCafes(camZ) {
    const out = [];
    for (const s of this.cityBlvd || []) if (s.z < 1e8 && s.z < camZ - 12 && s.z > camZ - 150) out.push({ kind: 'pcafe', x: s.x, z: s.z });
    for (const s of this.cityShops || []) if (s.z < 1e8 && s.z < camZ - 12 && s.z > camZ - 150) out.push({ kind: 'city', x: s.x, z: s.z });
    return out;
  }
  startVisit(v, plan) {
    const wk = this.kits.walk;
    const h = this.wr.next();
    Object.assign(v, { on: true, wi: 1, hold: 0, x: plan.route[0].x, z: plan.route[0].z, v: 0.95 + h * 0.35, ph: h * 6.28,
      color: plan.color != null ? plan.color : this.wr.int(0, SHIRTS.length - 1), scale: plan.scale || (0.95 + h * 0.1) }, plan);
    v.state = 'walk'; v.face = 0; v.t = 0;
    wk.set.setAttr(v.i, 'aAnim', v.ph, 0.42, 0, 0);
    wk.set.setAttr(v.i, 'aVar', h < 0.3 ? 1 : 0, h > 0.6 ? 1 : 0, h, 0);
    this.willStats.visit++;
  }
  // sim hand-over: deck walkers who chose an eatery (they arrive at the door edge of the deck)
  takeVisitors(q) {
    while (q && q.length) {
      const e = q.shift();
      let v = (this.visitors || []).find((o) => !o.on);
      // pool full: the oldest stroller has melted back into the crowd already (keeps the hand-over seamless)
      if (!v) { v = (this.visitors || []).find((o) => o.state === 'stroll'); if (v) this.kits.walk.set.hide(v.i); }
      if (!v) continue;
      v.src = 'sim';
      const wr = this.wr;
      if (e.kind === 'resto') {
        const toBeach = wr.chance(e.persona === 4 || e.persona === 0 ? 0.6 : 0.35);
        this.startVisit(v, { kind: 'resto', doorZ: e.door, route: this.restoRoute(e.door, e.x, toBeach, wr), end: toBeach ? 'beach' : 'deck', color: e.color, scale: e.scale });
      } else {
        const outRear = wr.chance(0.55);
        const R = this.cafeRoute(PCAFE_X, e.door, PCAFE_D, PCAFE_W / 2, false, outRear, e.x, wr);
        R.splice(1, 0, { x: 4.3, z: e.door, cross: true }, { x: 6.5, z: e.door, cross: true });
        if (!outRear) R.push({ x: 6.5, z: e.door }, { x: 4.3, z: e.door, cross: true }, { x: 4.05, z: e.door + 0.6 });
        else R.push({ x: SIDE_A, z: e.door });
        this.startVisit(v, { kind: 'pcafe', doorZ: e.door, fx0: PCAFE_X, fx1: PCAFE_X + PCAFE_D, route: R, end: outRear ? 'sideA' : 'deck', color: e.color, scale: e.scale });
      }
      this.willStats.visitSim++;
    }
  }
  updateVisitors(camZ, t, dt) {
    const wk = this.kits.walk;
    this.xwalkBusy.length = 0;
    if (!wk || !this.visitors || !this.visitors.length) return;
    let live = null, sidewalkOn = 0;
    for (const v of this.visitors) if (v.on && (v.src === 'side')) sidewalkOn++;
    for (const v of this.visitors) {
      if (!v.on) {
        if ((v.hold -= dt) > 0) continue;
        v.hold = this.wr.range(2, 6);
        // spontaneous visits from the sidewalks (sim hand-overs take the other free slots)
        if (sidewalkOn >= Math.ceil(this.visitors.length * 0.5)) continue;
        live = live || this.liveCafes(camZ);
        if (!live.length) continue;
        const c = live[this.wr.int(0, live.length - 1)], wr = this.wr;
        if (c.kind === 'pcafe') {
          // from the plaza sidewalk in through the rear door; out the front, across the bike lane to the deck
          const outFront = wr.chance(0.6);
          const R = this.cafeRoute(c.x, c.z, PCAFE_D, PCAFE_W / 2, true, !outFront, SIDE_A, wr);
          R[0] = { x: SIDE_A, z: c.z + wr.range(-4, 4) }; R.splice(1, 0, { x: SIDE_A - 0.2, z: c.z });
          if (outFront) R.push({ x: 6.5, z: c.z }, { x: 4.3, z: c.z, cross: true }, { x: 4.05, z: c.z + 0.6 });
          else R.push({ x: SIDE_A, z: c.z });
          this.startVisit(v, { kind: 'pcafe', src: 'side', doorZ: c.z, fx0: c.x, fx1: c.x + PCAFE_D, route: R, end: outFront ? 'deck' : 'sideA' });
        } else {
          // from the shop sidewalk along the paved entrance path, in, linger, back out
          const R = this.cafeRoute(c.x, c.z, 5.0, 5.2, false, false, SIDE_B, wr);
          R[0] = { x: SIDE_B, z: c.z + wr.range(-5, 5) }; R.splice(1, 0, { x: SIDE_B + 0.3, z: c.z });
          R.push({ x: SIDE_B + 0.3, z: c.z }, { x: SIDE_B, z: c.z + wr.range(-1, 1) });
          this.startVisit(v, { kind: 'city', src: 'side', doorZ: c.z, fx0: c.x, fx1: c.x + 5.0, route: R, end: 'sideB' });
        }
        sidewalkOn++;
      }
      if (v.z > camZ + 40 || v.z < camZ - 230) { v.on = false; v.src = null; v.hold = this.wr.range(1, 4); wk.set.hide(v.i); continue; }
      let y = 0;
      if (v.state === 'walk') {
        const w = v.route[v.wi];
        const dx = w.x - v.x, dzz = w.z - v.z, d = Math.hypot(dx, dzz);
        // wait at the bike-lane edge until it is clear of riders (and riders yield once someone is on it)
        if (w.cross && v.x < 4.45 && dx > 0 || w.cross && v.x > 6.35 && dx < 0) {
          let busy = false;
          for (const rd of this.riders) { const ahead = (v.z - rd.z) * -rd.dir; if (ahead > 0 && ahead < 6 && rd.v > 1.2) { busy = true; break; } }
          if (busy) { v.face = dx > 0 ? -Math.PI / 2 : Math.PI / 2; wk.set.setAttr(v.i, 'aAnim', v.ph, 0.05, 0, 0); v.waiting = true; }
          else if (v.waiting) { v.waiting = false; wk.set.setAttr(v.i, 'aAnim', v.ph, 0.42, 0, 0); }
          if (busy) { y = v.kind === 'resto' ? this.visitY(v.x, 'resto') : this.cafeY(v.x, v); this.put('walk', v.i, v.x, y, v.z, v.face, v.scale, v.color); continue; }
        }
        const stepL = v.v * dt;
        if (d <= stepL + 0.02) {
          v.x = w.x; v.z = w.z; v.wi++;
          if (w.linger) { v.state = 'linger'; v.hold = w.linger; v.face = w.face || 0; wk.set.setAttr(v.i, 'aAnim', v.ph, 0.05, 0, 0); }
          if (v.wi >= v.route.length) {
            v.state = 'end';
            if (v.end === 'beach') {
              // hand over to the beach goers (they head for the sea and bathe)
              const g = this.goers.find((o) => !o.on);
              wk.set.hide(v.i); v.on = false; v.src = null; v.hold = this.wr.range(2, 6);
              if (g) {
                const hh = hash2(Math.floor(v.z * 10), 71);
                Object.assign(g, { on: true, state: 'walk', hold: this.wr.range(8, 20), wade: false, x: v.x, z: v.z, zl: v.z, variant: 0, tx: -47 - hh * 2.2, v: 1.6 + hh * 0.6, ph: v.ph, scale: v.scale, color: v.color, retCd: this.wr.range(10, 22) });
                this.put('walk', g.i, g.x, shoreY(g.x, g.zl, 0), g.z, Math.PI / 2, g.scale, g.color);
              }
              continue;
            }
            v.state = 'stroll'; v.sd = this.wr.chance(0.6) ? 1 : -1; v.hold = this.wr.range(12, 30);
            v.sx = v.end === 'deck' ? (v.x < 0 ? -4.05 : 4.05) : v.end === 'sideA' ? SIDE_A : SIDE_B;
            wk.set.setAttr(v.i, 'aAnim', v.ph, 0.42, 0, 0);
          }
        } else {
          v.x += dx / d * stepL; v.z += dzz / d * stepL;
          v.face = Math.atan2(-dx, -dzz);
        }
        if (v.x > 4.3 && v.x < 6.55 && v.kind === 'pcafe') this.xwalkBusy.push(v.z);
      } else if (v.state === 'linger') {
        v.hold -= dt;
        if (v.hold <= 0) { v.state = 'walk'; wk.set.setAttr(v.i, 'aAnim', v.ph, 0.42, 0, 0); }
      } else if (v.state === 'stroll') {
        // a short stroll along the deck edge / sidewalk, then they melt back into the crowd
        v.x = dampD(v.x, v.sx, 0.6, dt);
        v.z += v.sd * v.v * dt; v.face = v.sd < 0 ? 0 : Math.PI;
        v.hold -= dt;
        if (v.hold <= 0) { v.on = false; v.src = null; v.hold = this.wr.range(1, 4); wk.set.hide(v.i); continue; }
      }
      y = v.kind === 'resto' ? this.visitY(v.x, 'resto') : this.cafeY(v.x, v);
      if (v.state === 'stroll' && v.kind === 'resto') y = 0;
      this.put('walk', v.i, v.x, y, v.z, v.face, v.scale, v.color);
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
