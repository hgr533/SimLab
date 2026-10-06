// Procedural props and characters. All art is generated from primitives in code.
import { Builder, hex, mul, mix3 } from './geo.js';
import { hash2 } from './rng.js';

const C = {
  trunk: hex(0x7a5a3c), trunk2: hex(0x5e4630), frond: hex(0x3f7f3a), frond2: hex(0x5d9a3e),
  sand: hex(0xe2c48f), sandWet: hex(0xc7a46c), deck: hex(0xd8c3a0), bike: hex(0xb0563f), wall: hex(0xe8dcc4),
  plaza: hex(0xcbb796), asphalt: hex(0x4a4a50), line: hex(0xeeeeee), curb: hex(0xbdb5a8),
  wood: hex(0x8a6038), metal: hex(0x3a3d44), white: hex(0xf2efe8), cream: hex(0xf0e2c0),
  bed: hex(0xf6f1e4), glass: hex(0x6d8ea8), lamp: hex(0xfff2c0), red: hex(0xd23b2e),
};
export const COLORS = C;
const UMB = [hex(0xf4f0e6), hex(0x1d9aa8), hex(0xf08a24), hex(0xe9d34a), hex(0xd8463b), hex(0x2f6fb6)];
const CAFE = [hex(0xf3e9d8), hex(0xe7d2b0), hex(0xd9e4e6), hex(0xf1d6c4)];
const AWN = [hex(0x2d7c8a), hex(0xc9472f), hex(0x3c6e48), hex(0xe0a33a)];

// ----- Palm: curved trunk + closed frond prisms (single sided, no DoubleSide).
export function palm(b, x, z, h, seed, detail) {
  const lean = (hash2(seed, 3) - 0.5) * 0.5, leanZ = (hash2(seed, 5) - 0.5) * 0.4;
  const segs = detail ? 5 : 3, sides = detail ? 6 : 4;
  let px = x, pz = z, py = 0;
  // v2.2 wind: the trunk bends a little near the top, fronds bend more towards their tips
  b.swayFn = (p) => 0.1 * Math.pow(Math.max(0, p.y) / h, 2);
  for (let i = 0; i < segs; i++) {
    const t = (i + 1) / segs;
    const nx = x + lean * t * t * h * 0.3, nz = z + leanZ * t * t * h * 0.3, ny = h * t;
    const r0 = 0.24 - 0.08 * (i / segs), r1 = 0.24 - 0.08 * t;
    // approximate segment as a vertical frustum offset by lean
    b.push(); b.translate(px, py, pz);
    const dx = nx - px, dz = nz - pz, dy = ny - py;
    b.rotZ(-Math.atan2(dx, dy)); b.rotX(Math.atan2(dz, dy));
    b.cyl(0, 0, 0, r0, r1, Math.hypot(dx, dy, dz), sides, i % 2 ? C.trunk : C.trunk2, { cap: i === segs - 1 });
    b.pop();
    px = nx; pz = nz; py = ny;
  }
  const fronds = detail ? 9 : 6;
  const cx0 = px, cz0 = pz;
  b.swayFn = (p) => 0.1 + 0.9 * Math.pow(Math.min(1, Math.hypot(p.x - cx0, p.z - cz0) / 3.3), 1.4);
  for (let f = 0; f < fronds; f++) {
    const a = (f / fronds) * Math.PI * 2 + hash2(seed, f) * 0.4;
    const len = 2.6 + hash2(seed, f + 20) * 0.9;
    frond(b, px, py, pz, a, len, f % 2 ? C.frond : C.frond2, detail);
  }
  b.swayFn = null; b.sway = 0.1;
  b.cyl(px, py - 0.35, pz, 0.32, 0.18, 0.45, sides, mul(C.trunk, 0.8));
  b.sway = 0;
  b.addTrunk(x, z, h, 0.26);
  b.addDisk(px, py, pz, 2.7, fronds);
}
function frond(b, x, y, z, a, len, col, detail) {
  const n = detail ? 3 : 2;
  const ca = Math.cos(a), sa = Math.sin(a);
  let prev = null;
  for (let i = 0; i <= n; i++) {
    const t = i / n;
    const r = t * len;
    const droop = -t * t * 1.5 + t * 0.4;
    const w = 0.42 * Math.sin(Math.PI * Math.min(1, t * 1.1 + 0.08));
    const cx = x + sa * r, cz = z + ca * r, cy = y + droop;
    const L = [cx + ca * w, cy - 0.05, cz - sa * w], R = [cx - ca * w, cy - 0.05, cz + sa * w], M = [cx, cy + 0.07, cz];
    if (prev) {
      // top ridge: two quads
      b.quad(prev.L, L, M, prev.M, col);
      b.quad(prev.M, M, R, prev.R, col);
      // underside
      b.quad(prev.R, R, L, prev.L, mul(col, 0.7));
    }
    prev = { L, R, M };
  }
}

export function umbrellaColor(seed) { return UMB[Math.floor(hash2(seed, 1) * UMB.length)]; }
// v2.5: shadow casters only (the near tier draws these props as instances)
export function palmCasters(b, x, z, h, seed, fronds) {
  const lean = (hash2(seed, 3) - 0.5) * 0.5, leanZ = (hash2(seed, 5) - 0.5) * 0.4;
  b.addTrunk(x, z, h, 0.26); b.addDisk(x + lean * h * 0.3, h, z + leanZ * h * 0.3, 2.7, fronds);
}
export function umbrellaCasters(b, x, z, cafe) { const h = cafe ? 2.3 : 2.1, r = cafe ? 1.5 : 1.25; b.addDisk(x, h + 0.2, z, r * 0.95, 0); }
export function umbrella(b, x, z, seed, detail, cafe) {
  const col = UMB[Math.floor(hash2(seed, 1) * UMB.length)];
  const alt = mix3(col, C.white, 0.6);
  const top = col.slice(); top.alt = alt;
  const h = cafe ? 2.3 : 2.1, r = cafe ? 1.5 : 1.25;
  b.cyl(x, 0, z, 0.035, 0.035, h, 4, C.white, { cap: false });
  b.canopy(x, h, z, r, 0.45, detail ? 10 : 6, top, mul(col, 0.62));
  b.addDisk(x, h + 0.2, z, r * 0.95, 0);
}

export function sunbed(b, x, z, rot, detail) {
  b.push(); b.translate(x, 0, z); b.rotY(rot);
  b.box(0, 0.22, 0, 0.7, 0.08, 1.9, C.bed, { skipBottom: true });
  if (detail) {
    b.push(); b.translate(0, 0.3, -0.75); b.rotX(-0.9); b.box(0, 0, 0, 0.7, 0.06, 0.6, C.bed, { skipBottom: true }); b.pop();
    b.box(-0.3, 0, -0.85, 0.05, 0.22, 0.05, C.metal, { skipBottom: true });
    b.box(0.3, 0, 0.85, 0.05, 0.22, 0.05, C.metal, { skipBottom: true });
  }
  b.pop();
}

export function lifeguard(b, x, z, detail) {
  for (const [ox, oz] of [[-1, -1], [1, -1], [-1, 1], [1, 1]]) b.box(x + ox * 1.1, 0, z + oz * 1.1, 0.16, 3, 0.16, C.white, { skipBottom: true });
  b.box(x, 3, z, 3.0, 0.2, 3.0, C.white);
  b.box(x, 3.2, z, 2.6, 1.8, 2.6, hex(0xe9e4d6), { skipBottom: true });
  if (detail) b.box(x - 1.31, 3.9, z, 0.02, 0.7, 1.8, C.glass, { skipBottom: true });
  b.push(); b.translate(x, 5.0, z); b.box(0, 0, 0, 3.6, 0.3, 3.6, C.red); b.pop();
  b.box(x, 0, z + 2.0, 0.8, 0.12, 2.0, C.wood, { skipBottom: true });
  b.addDisk(x, 5.0, z, 2.0, 0);
}

export function cafe(b, x, z, w, seed, detail) {
  const wall = CAFE[Math.floor(hash2(seed, 2) * CAFE.length)];
  const awn = AWN[Math.floor(hash2(seed, 4) * AWN.length)];
  b.box(x + 2.2, 0, z, 4.4, 3.6, w, wall, { skipBottom: true, top: mul(wall, 0.9) });
  // glass front facing the boulevard (-x side)
  b.box(x - 0.01, 0.3, z, 0.04, 2.3, w * 0.8, C.glass, { skipBottom: true });
  // awning sloped
  b.push(); b.translate(x - 0.9, 3.0, z); b.rotZ(-0.28); b.box(0, 0, 0, 2.2, 0.1, w, awn, { top: awn }); b.pop();
  if (detail) {
    const n = Math.max(2, Math.floor(w / 2.6));
    for (let i = 0; i < n; i++) {
      const tz = z - w / 2 + (i + 0.5) * (w / n);
      b.cyl(x - 2.4, 0, tz, 0.35, 0.35, 0.75, 8, C.white);
      b.box(x - 2.4, 0, tz, 0.08, 0.72, 0.08, C.metal, { skipBottom: true });
      b.box(x - 3.0, 0, tz, 0.4, 0.45, 0.4, C.wood, { skipBottom: true });
      b.box(x - 1.8, 0, tz, 0.4, 0.45, 0.4, C.wood, { skipBottom: true });
    }
    b.box(x + 2.2, 3.6, z, 4.6, 0.25, w + 0.2, mul(wall, 0.85));
  }
  if (detail === 2) { // v2.5 near tier: window mullions, door, awning valance, string lights, planters
    const gw = w * 0.8;
    for (let k = 0; k <= 4; k++) b.box(x - 0.04, 0.3, z - gw / 2 + k * gw / 4, 0.05, 2.3, 0.06, C.white, { skipBottom: true });
    b.box(x - 0.04, 1.4, z, 0.05, 0.05, gw, C.white);
    b.box(x - 0.03, 0, z + gw / 2 - 0.6, 0.03, 2.2, 0.9, mul(C.wood, 0.8), { skipBottom: true });
    const n = Math.max(4, Math.round(w / 0.6));
    for (let k = 0; k < n; k++) { const zz = z - w / 2 + (k + 0.5) * (w / n); b.box(x - 1.92 - 0.02, 2.62, zz, 0.03, 0.18, w / n * 0.9, k % 2 ? awn : C.white, { skipBottom: true }); }
    for (let k = 0; k <= n; k++) { // bulbs hang in a gentle catenary under the awning edge
      const zz = z - w / 2 + k * (w / n), sag = 0.12 * Math.sin(Math.PI * ((k % 3) / 3));
      b.sunBoost = 0; b.ao = 2.6; b.box(x - 1.86, 2.4 - sag, zz, 0.06, 0.08, 0.06, C.lamp); b.ao = 1; b.sunBoost = 1;
    }
    b.box(x - 1.86, 2.48, z, 0.01, 0.01, w, C.metal);
    for (const zz of [z - w / 2 + 0.4, z + w / 2 - 0.4]) { b.box(x - 0.5, 0, zz, 0.5, 0.45, 0.5, hex(0x9a6a44), { skipBottom: true }); b.cyl(x - 0.5, 0.45, zz, 0.28, 0.08, 0.55, 6, C.frond); }
  }
}

export function lamp(b, x, z, detail) {
  if (detail === 2) { b.cyl(x, 0, z, 0.14, 0.1, 0.4, 8, C.metal); b.cyl(x, 4.1, z, 0.03, 0.03, 0.3, 6, C.metal); }
  b.cyl(x, 0, z, 0.07, 0.05, 4.2, detail ? (detail === 2 ? 8 : 6) : 4, C.metal);
  b.box(x - 0.4, 4.1, z, 0.9, 0.08, 0.08, C.metal);
  // v2.5.19: emissive warm-white head (glows with uLights: rain / cloudy / golden; off in sea spray)
  const w0 = b.wet, m0 = b.mapW; b.wet = 3.9; b.mapW = 0;
  b.box(x - 0.85, 3.9, z, 0.3, 0.2, 0.3, LAMP_WARM);
  b.wet = w0; b.mapW = m0;
}
const LAMP_WARM = [1.0, 0.9, 0.68];
export function bench(b, x, z) {
  b.box(x, 0.4, z, 0.5, 0.08, 1.8, C.wood, { skipBottom: true });
  b.box(x + 0.22, 0.48, z, 0.06, 0.4, 1.8, C.wood);
  b.box(x, 0, z - 0.7, 0.4, 0.4, 0.08, C.metal, { skipBottom: true });
  b.box(x, 0, z + 0.7, 0.4, 0.4, 0.08, C.metal, { skipBottom: true });
}
export function kiosk(b, x, z, seed) {
  const col = AWN[Math.floor(hash2(seed, 7) * AWN.length)];
  b.box(x, 0, z, 2.2, 2.4, 2.6, C.cream, { skipBottom: true });
  b.push(); b.translate(x, 2.4, z); b.box(0, 0, 0, 2.8, 0.25, 3.2, col); b.pop();
  b.box(x - 1.12, 0.9, z, 0.04, 0.9, 2.0, C.glass, { skipBottom: true });
}

// Contact shadow: thin opaque strip from the feet along the baked sun direction. It is lit by
// ambient only, so it matches the deck's baked shadow color and vanishes when the sun is gone (rain).
const TEX_AVG = [0.86, 0.8, 0.71];
function contactShadow(b, w, len) {
  const sx = 0.63, sz = 0.77; // horizontal shadow direction (away from the sun)
  const px = -sz * w, pz = sx * w;
  const col = [C.deck[0] * TEX_AVG[0], C.deck[1] * TEX_AVG[1], C.deck[2] * TEX_AVG[2]];
  const ex = sx * len, ez = sz * len;
  const rig = b.rig, tint = b.tint;
  b.sunBoost = 0; b.wet = 1; b.rig = [5, 0, 0]; b.tint = 0; // limb 5 = world-fixed shadow (see RIG shader)
  b.quad([ex + px * 0.4, 0.03, ez + pz * 0.4], [ex - px * 0.4, 0.03, ez - pz * 0.4], [-px, 0.03, -pz], [px, 0.03, pz], col);
  b.sunBoost = 1; b.wet = 0; b.rig = rig; b.tint = tint;
}

// ---------- Characters (rigged via aRig, posed in the vertex shader) ----------
// aRig = (limb, pivotY, kneeY or tailPivotZ); limb: +-1 leg, +-2 arm, 4 tail.
function rigBox(b, rig, tint, cx, y0, cz, sx, sy, sz, col, opt) { b.rig = rig; b.tint = tint; b.box(cx, y0, cz, sx, sy, sz, col, opt); }

export function personGeometry(detail) {
  const b = new Builder({ rig: true, tint: true });
  const skin = hex(0xc58c63), shorts = hex(0x8a8f99), hair = hex(0x2b1d14), shoe = hex(0xeeeeee), shirt = hex(0xffffff);
  // contact shadow blob (opaque, ao only, matches deck shadow color)
  b.rig = [0, 0, 0]; b.tint = 0; b.sunBoost = 0;
  contactShadow(b, 0.17, 2.4);
  b.sunBoost = 1;
  for (const side of [-1, 1]) {
    const lx = side * 0.1;
    rigBox(b, [side, 0.9, 0.48], 0.5, lx, 0.48, 0, 0.14, 0.44, 0.16, shorts, { skipBottom: true });
    rigBox(b, [side, 0.9, 0.48], 0, lx, 0.06, 0, 0.11, 0.44, 0.12, skin, { skipBottom: true });
    rigBox(b, [side, 0.9, 0.48], 0, lx, 0.0, -0.04, 0.12, 0.07, 0.24, shoe);
    rigBox(b, [side * 2, 1.4, 0], 1, side * 0.24, 1.12, 0, 0.09, 0.3, 0.1, shirt, { skipBottom: true });
    rigBox(b, [side * 2, 1.4, 0], 0, side * 0.24, 0.86, 0, 0.08, 0.27, 0.09, skin);
  }
  rigBox(b, [0, 0, 0], 0.5, 0, 0.82, 0, 0.36, 0.2, 0.2, shorts, { skipBottom: true });
  rigBox(b, [0, 0, 0], 1, 0, 1.0, 0, 0.4, 0.46, 0.22, shirt, { skipBottom: true });
  rigBox(b, [0, 0, 0], 0, 0, 1.46, 0, 0.1, 0.06, 0.1, skin, { skipBottom: true });
  rigBox(b, [0, 0, 0], 0, 0, 1.52, 0, 0.2, 0.22, 0.21, skin, { skipBottom: true });
  rigBox(b, [0, 0, 0], 0, 0, 1.68, 0.02, 0.22, 0.08, 0.23, hair);
  if (detail) {
    rigBox(b, [0, 0, 0], 0, 0, 1.56, 0.1, 0.21, 0.14, 0.04, hair, { skipBottom: true });
  }
  return b.build();
}

export function runnerGeometry() {
  const b = new Builder({ rig: true, tint: false });
  const skin = hex(0xd09a72), top = hex(0xf6f6f2), shorts = hex(0x1e1f24), hair = hex(0x3a2617), shoe = hex(0x8fe36a), sole = hex(0xf2f2f2);
  contactShadow(b, 0.16, 2.2);
  b.sunBoost = 1.15;
  for (const side of [-1, 1]) {
    const lx = side * 0.1;
    b.rig = [side, 0.92, 0.5];
    b.box(lx, 0.62, 0, 0.15, 0.3, 0.17, shorts, { skipBottom: true });
    b.box(lx, 0.5, 0, 0.13, 0.14, 0.14, skin, { skipBottom: true });
    b.box(lx, 0.08, 0, 0.11, 0.44, 0.12, skin, { skipBottom: true });
    b.box(lx, 0.0, -0.05, 0.13, 0.09, 0.27, shoe);
    b.box(lx, 0.0, -0.05, 0.135, 0.025, 0.28, sole);
    b.rig = [side * 2, 1.42, 0];
    b.push(); b.translate(side * 0.23, 1.42, 0);
    b.box(0, -0.3, 0, 0.08, 0.3, 0.09, skin, { skipBottom: true });
    b.translate(0, -0.3, 0); b.rotX(0.95);
    b.box(0, -0.26, 0, 0.07, 0.26, 0.08, skin);
    b.pop();
  }
  b.rig = [0, 0, 0];
  b.box(0, 0.84, 0, 0.34, 0.16, 0.2, shorts, { skipBottom: true });
  b.box(0, 1.0, 0, 0.28, 0.16, 0.17, skin, { skipBottom: true });
  b.box(0, 1.16, 0, 0.36, 0.28, 0.21, top, { skipBottom: true });
  b.box(0, 1.44, 0, 0.09, 0.06, 0.09, skin, { skipBottom: true });
  b.box(0, 1.5, 0, 0.19, 0.22, 0.21, skin, { skipBottom: true });
  b.box(0, 1.66, 0.02, 0.21, 0.08, 0.23, hair);
  b.box(0, 1.55, 0.08, 0.2, 0.14, 0.08, hair, { skipBottom: true });
  // ponytail
  b.push(); b.translate(0, 1.62, 0.14); b.rotX(-0.6); b.box(0, -0.32, 0, 0.07, 0.32, 0.07, hair); b.pop();
  return b.build();
}

// v2.4 male runner: same rig pivots (legs 0.92 m, arms 1.42 m) so every animation and the
// soliton echo work unchanged; broader shoulders, short hair, t-shirt, longer running shorts.
// Cosmetic only: the sim hitbox does not depend on the model.
export function maleRunnerGeometry() {
  const b = new Builder({ rig: true, tint: false });
  const skin = hex(0xb9805a), tee = hex(0x2f6fd0), teeTrim = hex(0xf2f2f2), shorts = hex(0x2a2d33), hair = hex(0x1f1610), shoe = hex(0xff7a2e), sole = hex(0xf2f2f2);
  contactShadow(b, 0.19, 2.3);
  b.sunBoost = 1.15;
  for (const side of [-1, 1]) {
    const lx = side * 0.11;
    b.rig = [side, 0.92, 0.5];
    b.box(lx, 0.56, 0, 0.17, 0.36, 0.19, shorts, { skipBottom: true });
    b.box(lx, 0.46, 0, 0.14, 0.12, 0.15, skin, { skipBottom: true });
    b.box(lx, 0.08, 0, 0.12, 0.4, 0.13, skin, { skipBottom: true });
    b.box(lx, 0.0, -0.05, 0.14, 0.09, 0.28, shoe);
    b.box(lx, 0.0, -0.05, 0.145, 0.025, 0.29, sole);
    b.rig = [side * 2, 1.42, 0];
    b.push(); b.translate(side * 0.27, 1.42, 0);
    b.box(0, -0.13, 0, 0.11, 0.15, 0.12, tee, { skipBottom: true }); // short sleeve
    b.box(0, -0.3, 0, 0.09, 0.18, 0.1, skin, { skipBottom: true });
    b.translate(0, -0.3, 0); b.rotX(0.95);
    b.box(0, -0.26, 0, 0.08, 0.26, 0.09, skin);
    b.pop();
  }
  b.rig = [0, 0, 0];
  b.box(0, 0.84, 0, 0.38, 0.16, 0.22, shorts, { skipBottom: true });
  b.box(0, 0.98, 0, 0.36, 0.2, 0.21, tee, { skipBottom: true });
  b.box(0, 1.16, 0, 0.44, 0.3, 0.24, tee, { skipBottom: true });
  b.box(0, 1.28, -0.122, 0.3, 0.05, 0.005, teeTrim); // chest stripe
  b.box(0, 1.44, 0, 0.11, 0.06, 0.11, skin, { skipBottom: true });
  b.box(0, 1.5, 0, 0.2, 0.23, 0.22, skin, { skipBottom: true });
  b.box(0, 1.67, 0.01, 0.215, 0.07, 0.235, hair); // short crop
  b.box(0, 1.58, 0.09, 0.21, 0.1, 0.05, hair, { skipBottom: true });
  return b.build();
}

export function dogGeometry(detail) {
  const b = new Builder({ rig: true, tint: true });
  const nose = hex(0x1c1c1c), collar = hex(0xd33a2c);
  const coat = hex(0xffffff);
  b.rig = [0, 0, 0]; b.tint = 0; b.sunBoost = 0;
  contactShadow(b, 0.2, 0.9);
  b.sunBoost = 1; b.tint = 1;
  b.box(0, 0.3, 0, 0.26, 0.24, 0.62, coat, { skipBottom: false });
  b.box(0, 0.42, -0.38, 0.2, 0.2, 0.22, coat, { skipBottom: true });
  b.box(0, 0.42, -0.52, 0.11, 0.1, 0.12, coat, { skipBottom: true });
  b.tint = 0; b.box(0, 0.48, -0.585, 0.05, 0.04, 0.02, nose);
  b.box(0, 0.4, -0.32, 0.22, 0.04, 0.05, collar);
  b.tint = 1;
  b.box(-0.08, 0.6, -0.36, 0.05, 0.09, 0.05, mul(coat, 0.8), { skipBottom: true });
  b.box(0.08, 0.6, -0.36, 0.05, 0.09, 0.05, mul(coat, 0.8), { skipBottom: true });
  const legs = [[-0.09, -0.22, 1], [0.09, -0.22, -1], [-0.09, 0.22, -1], [0.09, 0.22, 1]];
  for (const [lx, lz, s] of legs) { b.rig = [s, 0.32, 0]; b.box(lx, 0, lz, 0.07, 0.32, 0.07, coat, { skipBottom: true }); }
  b.rig = [4, 0.48, 0.31];
  b.push(); b.translate(0, 0.46, 0.31); b.rotX(-0.8); b.box(0, 0, 0, 0.05, 0.26, 0.05, coat); b.pop();
  return b.build();
}

// =====================================================================================
// v2.5 level of detail: near-tier models (rounded limbs, heads, hair, hats, slats, ears) and
// far-tier very cheap shapes. Same rig pivots and tint codes as the mid (v2.4) models, so the
// same shaders animate them and a tier swap keeps the silhouette.
// Tint codes: 1 shirt (instance color), 2 shorts / helmet (instance color rotated), 3 skin
// (per-instance tone, NEARVAR). Rig codes 6 / 7 / 8 = hat / long hair / short hair (per instance).
// =====================================================================================
const SKIN0 = hex(0xd8a47c), HAIR0 = hex(0x2b1d14), SHOE0 = hex(0xeeeeee), SOLE0 = hex(0x3a3a3e);
const STRAW = hex(0xe6d3a0), BAND = hex(0x7a4b2a);
function tnt(b, t) { b.tint = t; }
function ovalTorso(b, y0, h, rw, rc, depth, col, n) {
  b.push(); b.scale(1, 1, depth); b.cyl(0, y0, 0, rw, rc, h, n, col); b.pop();
}
// head with face hint, short / long hair and an optional hat (rig codes 6 / 7 / 8 when variants)
function nearHead(b, y, skin, hair, opt = {}) {
  const r = opt.r || 1, rig = b.rig;
  b.limb(0, y - 0.13, 0, 0, y - 0.03, 0, 0.05 * r, 0.048 * r, 6, skin, { cap: false });
  b.ellip(0, y + 0.06, 0, 0.1 * r, 0.12 * r, 0.11 * r, 8, 6, skin);
  b.box(0, y + 0.03, -0.115 * r, 0.03, 0.05, 0.03, mul(skin, 0.95)); // nose
  for (const s of [-1, 1]) b.box(s * 0.1 * r, y + 0.04, 0.0, 0.025, 0.05, 0.04, mul(skin, 0.9)); // ears
  const tint = b.tint;
  b.tint = 0;
  if (opt.variants) b.rig = [8, 0, 0];
  if (opt.variants || !opt.long) { // short hair: cap + back
    b.push(); b.translate(0, y + 0.08, 0.012); b.rotX(0.38); b.ellip(0, 0, 0, 0.108 * r, 0.115 * r, 0.12 * r, 8, 3, hair, { hemi: true }); b.pop(); // tilted: forehead free
    b.box(0, y + 0.0, 0.07 * r, 0.19 * r, 0.09, 0.06, hair, { skipBottom: true });
  }
  if (opt.variants) b.rig = [7, 0, 0];
  if (opt.variants || opt.long) { // long hair: fuller cap, hair down the back, ponytail
    b.push(); b.translate(0, y + 0.08, 0.015); b.rotX(0.32); b.ellip(0, 0, 0, 0.112 * r, 0.122 * r, 0.124 * r, 8, 3, hair, { hemi: true }); b.pop();
    b.push(); b.translate(0, y + 0.07, 0.09 * r); b.rotX(-0.12); b.box(0, -0.24, 0, 0.2 * r, 0.26, 0.05, hair); b.pop();
    b.limb(0, y + 0.1, 0.12, 0, y - 0.18, 0.2, 0.035, 0.02, 5, hair);
  }
  if (opt.variants) b.rig = [6, 0, 0];
  if (opt.variants || opt.hat) { // sun hat: straw brim, crown, band
    b.cyl(0, y + 0.115, 0, 0.21 * r, 0.2 * r, 0.018, 12, STRAW, { top: STRAW });
    b.cyl(0, y + 0.13, 0, 0.122 * r, 0.11 * r, 0.1, 10, STRAW, { top: mul(STRAW, 1.04) });
    b.cyl(0, y + 0.13, 0, 0.124 * r, 0.123 * r, 0.03, 10, BAND, { cap: false });
  }
  b.rig = rig; b.tint = tint;
}

export function personNearGeometry() {
  const b = new Builder({ rig: true, tint: true });
  const skin = SKIN0, shorts = hex(0x8a8f99), shirt = hex(0xffffff);
  b.rig = [0, 0, 0]; b.tint = 0; b.sunBoost = 0;
  contactShadow(b, 0.17, 2.4);
  b.sunBoost = 1;
  for (const side of [-1, 1]) {
    const lx = side * 0.1;
    b.rig = [side, 0.9, 0.48];
    b.mapW = MUS_LOW; tnt(b, 2); b.limb(lx, 0.95, 0, lx, 0.62, 0, 0.088, 0.078, 8, shorts);
    b.mapW = MUS_SKIN; tnt(b, 3); b.limb(lx, 0.64, 0, lx, 0.48, 0, 0.066, 0.058, 7, skin, { cap: false });
    b.ellip(lx, 0.48, 0, 0.058, 0.05, 0.06, 6, 3, skin);
    b.limb(lx, 0.48, 0, lx, 0.08, 0.01, 0.057, 0.04, 7, skin, { cap: false });
    b.mapW = 0; tnt(b, 0); b.box(lx, 0.025, -0.035, 0.11, 0.075, 0.24, SHOE0);
    b.ellip(lx, 0.04, -0.15, 0.055, 0.045, 0.05, 6, 2, SHOE0, { hemi: true });
    b.box(lx, 0.0, -0.035, 0.115, 0.025, 0.26, SOLE0, { skipBottom: true });
    b.rig = [side * 2, 1.4, 0];
    b.mapW = MUS_TOP; tnt(b, 1); b.limb(side * 0.2, 1.42, 0, side * 0.235, 1.2, 0, 0.062, 0.058, 8, shirt);
    b.mapW = MUS_SKIN; tnt(b, 3); b.limb(side * 0.235, 1.22, 0, side * 0.245, 1.1, 0, 0.044, 0.04, 6, skin, { cap: false });
    b.ellip(side * 0.245, 1.1, 0, 0.04, 0.035, 0.04, 6, 2, skin);
    b.limb(side * 0.245, 1.1, 0, side * 0.25, 0.86, -0.03, 0.039, 0.033, 6, skin, { cap: false });
    b.ellip(side * 0.25, 0.82, -0.03, 0.035, 0.055, 0.03, 6, 3, skin);
    b.mapW = 0;
  }
  b.rig = [0, 0, 0];
  b.mapW = MUS_LOW; tnt(b, 2); ovalTorso(b, 0.8, 0.18, 0.18, 0.175, 0.62, shorts, 10);
  b.mapW = MUS_TOP; tnt(b, 1); ovalTorso(b, 0.96, 0.46, 0.17, 0.215, 0.6, shirt, 10);
  b.push(); b.scale(1, 1, 0.6); b.ellip(0, 1.42, 0, 0.215, 0.06, 0.215, 10, 2, shirt, { hemi: true }); b.pop();
  b.mapW = 0; tnt(b, 3); nearHead(b, 1.6, skin, HAIR0, { variants: true });
  return b.build();
}

// far tier: 5 boxes, ~50 triangles (legs still swing)
export function personFarGeometry() {
  const b = new Builder({ rig: true, tint: true });
  b.rig = [0, 0, 0]; b.tint = 0; b.sunBoost = 0;
  contactShadow(b, 0.17, 2.4);
  b.sunBoost = 1;
  for (const side of [-1, 1]) { b.rig = [side, 0.9, 0]; b.tint = 0.5; b.box(side * 0.1, 0.0, 0, 0.13, 0.92, 0.15, hex(0x8a8f99), { skipBottom: true }); }
  b.rig = [0, 0, 0]; b.tint = 1; b.box(0, 0.88, 0, 0.44, 0.56, 0.22, hex(0xffffff), { skipBottom: true });
  b.tint = 0; b.box(0, 1.44, 0, 0.2, 0.3, 0.21, hex(0xc58c63), { skipBottom: true });
  b.box(0, 1.66, 0.02, 0.22, 0.08, 0.23, HAIR0);
  return b.build();
}

export function dogNearGeometry() {
  const b = new Builder({ rig: true, tint: true });
  const coat = hex(0xffffff), nose = hex(0x1c1c1c), collar = hex(0xd33a2c), tag = hex(0xf2c14e);
  b.rig = [0, 0, 0]; b.tint = 0; b.sunBoost = 0;
  contactShadow(b, 0.2, 0.9);
  b.sunBoost = 1; b.tint = 1;
  b.push(); b.scale(0.92, 1, 1); b.limb(0, 0.42, 0.3, 0, 0.42, -0.3, 0.13, 0.14, 8, coat); b.pop(); // body along z
  b.ellip(0, 0.43, -0.27, 0.13, 0.14, 0.14, 8, 4, coat); // chest
  b.ellip(0, 0.42, 0.28, 0.12, 0.12, 0.12, 8, 4, coat); // rump
  b.ellip(0, 0.6, -0.44, 0.1, 0.1, 0.11, 8, 5, coat); // head
  b.limb(0, 0.57, -0.5, 0, 0.55, -0.64, 0.055, 0.045, 6, mul(coat, 0.95)); // snout
  b.tint = 0; b.ellip(0, 0.56, -0.645, 0.026, 0.022, 0.02, 6, 3, nose);
  for (const s of [-1, 1]) b.box(s * 0.045, 0.63, -0.535, 0.02, 0.02, 0.01, nose); // eyes
  b.limb(0, 0.5, -0.38, 0, 0.47, -0.3, 0.1, 0.1, 10, collar, { cap: false });
  b.box(0, 0.4, -0.37, 0.03, 0.04, 0.02, tag);
  b.tint = 1;
  for (const s of [-1, 1]) { b.push(); b.translate(s * 0.08, 0.67, -0.43); b.rotZ(s * 0.5); b.rotX(0.15); b.box(0, -0.13, 0, 0.03, 0.14, 0.08, mul(coat, 0.75)); b.pop(); } // floppy ears
  const legs = [[-0.08, -0.25, 1], [0.08, -0.25, -1], [-0.08, 0.25, -1], [0.08, 0.25, 1]];
  for (const [lx, lz, s] of legs) {
    b.rig = [s, 0.34, 0];
    b.limb(lx, 0.38, lz, lx, 0.04, lz, 0.045, 0.034, 6, coat, { cap: false });
    b.ellip(lx, 0.03, lz - 0.015, 0.04, 0.03, 0.05, 6, 2, mul(coat, 0.9), { hemi: true, close: true });
  }
  b.rig = [4, 0.48, 0.34];
  b.limb(0, 0.47, 0.36, 0, 0.66, 0.52, 0.032, 0.014, 5, coat);
  return b.build();
}
export function dogFarGeometry() {
  const b = new Builder({ rig: true, tint: true });
  b.rig = [0, 0, 0]; b.tint = 0; b.sunBoost = 0;
  contactShadow(b, 0.2, 0.9);
  b.sunBoost = 1; b.tint = 1;
  b.box(0, 0.28, 0, 0.24, 0.24, 0.62, hex(0xffffff), { skipBottom: true });
  b.box(0, 0.4, -0.4, 0.18, 0.2, 0.24, hex(0xffffff), { skipBottom: true });
  for (const [lz, s] of [[-0.22, 1], [0.22, -1]]) { b.rig = [s, 0.3, 0]; b.box(0, 0, lz, 0.2, 0.3, 0.07, hex(0xffffff), { skipBottom: true }); }
  return b.build();
}

// v2.5.25: near-tier figures carry a muscle mask in aLight.w (the map weight, unused by every figure material:
// no MAP define), so no extra attribute or geometry. 1 = skin, 0.5 = shirt / top, 0.25 = shorts, 0 = none
// (head, hair, shoes, socks, watch, trims). Only the MUSCLE shader variant (HIGH / ULTRA close-up) reads it.
const MUS_SKIN = 1, MUS_TOP = 0.5, MUS_LOW = 0.25;
// near-tier runners: rounded limbs, shoes with soles, hair; same pivots as the v2.4 runners
function runnerNear(b, o) {
  contactShadow(b, o.shadowW, 2.2);
  b.sunBoost = 1.15;
  const sk = o.skin;
  for (const side of [-1, 1]) {
    const lx = side * o.hipX;
    b.rig = [side, 0.92, 0.5];
    b.mapW = MUS_LOW; b.limb(lx, 0.97, 0, lx, o.shortsEnd, 0, o.thighR + 0.022, o.thighR + 0.012, 8, o.shorts);
    b.mapW = MUS_SKIN; b.limb(lx, o.shortsEnd + 0.02, 0, lx, 0.5, 0, o.thighR, o.thighR - 0.008, 8, sk, { cap: false });
    b.ellip(lx, 0.5, 0, 0.062, 0.052, 0.064, 7, 3, sk);
    b.limb(lx, 0.5, 0, lx, 0.09, 0.01, 0.058, 0.04, 8, sk, { cap: false });
    b.mapW = 0; b.limb(lx, 0.12, 0.005, lx, 0.06, 0.0, 0.045, 0.048, 7, o.sock || hex(0xf2f2f2), { cap: false });
    b.box(lx, 0.03, -0.045, 0.125, 0.08, 0.26, o.shoe);
    b.ellip(lx, 0.05, -0.17, 0.062, 0.05, 0.06, 7, 2, o.shoe, { hemi: true });
    b.box(lx, 0.0, -0.045, 0.13, 0.03, 0.29, o.sole, { skipBottom: true });
    b.box(lx + side * 0.064, 0.05, -0.04, 0.004, 0.03, 0.14, o.sole); // side stripe
    b.rig = [side * 2, 1.42, 0];
    b.mapW = MUS_TOP; if (o.sleeve) b.limb(side * (o.shoulderX - 0.02), 1.43, 0, side * (o.shoulderX + 0.01), 1.27, 0, 0.068, 0.062, 8, o.top);
    b.mapW = MUS_SKIN; b.limb(side * o.shoulderX, 1.42, 0, side * (o.shoulderX + 0.008), 1.13, 0, 0.046, 0.04, 7, sk);
    b.ellip(side * (o.shoulderX + 0.008), 1.13, 0, 0.04, 0.037, 0.04, 6, 3, sk);
    b.limb(side * (o.shoulderX + 0.008), 1.13, 0, side * (o.shoulderX + 0.01), 0.98, -0.21, 0.039, 0.033, 7, sk, { cap: false });
    b.ellip(side * (o.shoulderX + 0.01), 0.965, -0.235, 0.035, 0.045, 0.04, 6, 3, sk);
    b.mapW = 0; if (o.watch && side < 0) b.limb(side * (o.shoulderX + 0.01), 1.0, -0.18, side * (o.shoulderX + 0.01), 0.99, -0.2, 0.04, 0.04, 8, hex(0x1d1d22));
  }
  b.rig = [0, 0, 0];
  b.mapW = MUS_LOW; ovalTorso(b, 0.8, 0.2, o.hipR, o.hipR - 0.005, 0.62, o.shorts, 10);
  b.mapW = 0; b.box(0, 0.975, -0.104, o.hipR * 1.6, 0.025, 0.01, o.waist || mul(o.shorts, 1.6)); // waistband
  if (o.midriff) { b.mapW = MUS_SKIN; ovalTorso(b, 0.99, 0.14, o.hipR - 0.02, o.hipR - 0.03, 0.6, sk, 10); b.mapW = MUS_TOP; ovalTorso(b, 1.12, 0.3, o.hipR - 0.025, o.chestR, 0.6, o.top, 10); }
  else { b.mapW = MUS_TOP; ovalTorso(b, 0.99, 0.43, o.hipR - 0.01, o.chestR, 0.6, o.top, 10); }
  b.mapW = MUS_TOP; b.push(); b.scale(1, 1, 0.6); b.ellip(0, 1.42, 0, o.chestR, 0.055, o.chestR, 10, 2, o.top, { hemi: true }); b.pop();
  b.mapW = 0; if (o.stripe) b.box(0, 1.28, -0.124, 0.3, 0.05, 0.006, o.stripe);
  if (o.backNum) b.box(0, 1.2, 0.123, 0.16, 0.12, 0.006, o.backNum); // visible from the chase camera
  nearHead(b, 1.6, sk, o.hair, { long: o.long, r: 0.98 });
  if (o.band) b.limb(0, 1.68, 0, 0, 1.71, 0, 0.112, 0.112, 10, o.band, { cap: false }); // headband
}
export function runnerNearGeometry() {
  const b = new Builder({ rig: true, tint: false });
  runnerNear(b, { skin: hex(0xd09a72), top: hex(0xf6f6f2), shorts: hex(0x1e1f24), hair: hex(0x3a2617), shoe: hex(0x8fe36a), sole: hex(0xf2f2f2),
    shadowW: 0.16, hipX: 0.095, thighR: 0.07, shortsEnd: 0.74, hipR: 0.165, chestR: 0.18, shoulderX: 0.215, long: true, midriff: true,
    band: hex(0x7c5cff), watch: true, waist: hex(0x7c5cff) });
  return b.build();
}
export function maleRunnerNearGeometry() {
  const b = new Builder({ rig: true, tint: false });
  runnerNear(b, { skin: hex(0xb9805a), top: hex(0x2f6fd0), shorts: hex(0x2a2d33), hair: hex(0x1f1610), shoe: hex(0xff7a2e), sole: hex(0xf2f2f2),
    shadowW: 0.19, hipX: 0.105, thighR: 0.078, shortsEnd: 0.6, hipR: 0.185, chestR: 0.225, shoulderX: 0.255, long: false, sleeve: true,
    stripe: hex(0xf2f2f2), backNum: hex(0xf2f2f2), watch: true });
  return b.build();
}

// ----- palms: near tier (segmented trunk with rings, serrated fronds, dead fronds, coconuts)
// and a very cheap far tier. Same seed rules as palm() so the tiers line up.
export function palmNear(b, x, z, h, seed) {
  const lean = (hash2(seed, 3) - 0.5) * 0.5, leanZ = (hash2(seed, 5) - 0.5) * 0.4;
  const segs = 8, sides = 7;
  let px = x, pz = z, py = 0;
  b.swayFn = (p) => 0.1 * Math.pow(Math.max(0, p.y) / h, 2);
  for (let i = 0; i < segs; i++) {
    const t = (i + 1) / segs;
    const nx = x + lean * t * t * h * 0.3, nz = z + leanZ * t * t * h * 0.3, ny = h * t;
    const r0 = 0.25 - 0.08 * (i / segs), r1 = 0.24 - 0.08 * t;
    b.push(); b.translate(px, py, pz);
    const dx = nx - px, dz = nz - pz, dy = ny - py, len = Math.hypot(dx, dy, dz);
    b.rotZ(-Math.atan2(dx, dy)); b.rotX(Math.atan2(dz, dy));
    const c = i % 2 ? C.trunk : C.trunk2;
    b.cyl(0, 0, 0, r0 * 1.08, r1, len * 0.75, sides, c, { cap: false }); // bulging ring segment
    b.cyl(0, len * 0.75, 0, r1, r1 * 1.07, len * 0.25, sides, mul(c, 0.82), { cap: i === segs - 1 });
    b.pop();
    px = nx; pz = nz; py = ny;
  }
  const cx0 = px, cz0 = pz;
  b.swayFn = (p) => 0.1 + 0.9 * Math.pow(Math.min(1, Math.hypot(p.x - cx0, p.z - cz0) / 3.3), 1.4);
  for (let f = 0; f < 9; f++) {
    const a = (f / 9) * Math.PI * 2 + hash2(seed, f) * 0.4;
    const len = 2.6 + hash2(seed, f + 20) * 0.9;
    frondNear(b, px, py, pz, a, len, f % 2 ? C.frond : C.frond2, 0);
  }
  for (let f = 0; f < 4; f++) { // older drooping fronds, lower and browner
    const a = ((f + 0.5) / 4) * Math.PI * 2 + hash2(seed, f + 40) * 0.5;
    frondNear(b, px, py - 0.25, pz, a, 2.1 + hash2(seed, f + 50) * 0.5, mix3(C.frond, hex(0xa08a4a), 0.55), 1);
  }
  b.swayFn = null; b.sway = 0.1;
  b.cyl(px, py - 0.45, pz, 0.34, 0.2, 0.55, sides, mul(C.trunk, 0.8));
  for (let k = 0; k < 3; k++) { const a = k * 2.1 + seed; b.ellip(px + Math.sin(a) * 0.2, py - 0.32, pz + Math.cos(a) * 0.2, 0.09, 0.1, 0.09, 5, 3, hex(0x6b5a2a)); }
  b.sway = 0;
}
function frondNear(b, x, y, z, a, len, col, old) {
  const n = 6;
  const ca = Math.cos(a), sa = Math.sin(a);
  let prev = null;
  for (let i = 0; i <= n; i++) {
    const t = i / n, r = t * len;
    const droop = old ? -t * t * 2.2 - t * 0.3 : -t * t * 1.5 + t * 0.4;
    const w = (old ? 0.3 : 0.46) * Math.sin(Math.PI * Math.min(1, t * 1.1 + 0.08)) * (i % 2 ? 1.25 : 0.7); // serrated leaflets
    const cx = x + sa * r, cz = z + ca * r, cy = y + droop;
    const L = [cx + ca * w, cy - 0.08, cz - sa * w], R = [cx - ca * w, cy - 0.08, cz + sa * w], M = [cx, cy + 0.06, cz];
    if (prev) {
      b.quad(prev.L, L, M, prev.M, col);
      b.quad(prev.M, M, R, prev.R, mul(col, 1.06));
      b.quad(prev.R, R, L, prev.L, mul(col, 0.7));
    }
    prev = { L, R, M };
  }
}
export function palmFar(b, x, z, h, seed) {
  const lean = (hash2(seed, 3) - 0.5) * 0.5, leanZ = (hash2(seed, 5) - 0.5) * 0.4;
  const tx = x + lean * h * 0.3, tz = z + leanZ * h * 0.3;
  b.swayFn = (p) => 0.1 * Math.pow(Math.max(0, p.y) / h, 2);
  b.push(); b.translate(x, 0, z); b.rotZ(-Math.atan2(tx - x, h)); b.rotX(Math.atan2(tz - z, h));
  b.cyl(0, 0, 0, 0.24, 0.16, Math.hypot(tx - x, h, tz - z), 3, C.trunk, { cap: false }); b.pop();
  b.swayFn = (p) => 0.1 + 0.9 * Math.pow(Math.min(1, Math.hypot(p.x - tx, p.z - tz) / 3.3), 1.4);
  for (let f = 0; f < 5; f++) {
    const a = (f / 5) * Math.PI * 2 + hash2(seed, f) * 0.4, len = 2.8;
    const ca = Math.cos(a), sa = Math.sin(a);
    const e = [tx + sa * len, h - 1.1, tz + ca * len], m = [tx + sa * len * 0.5, h + 0.1, tz + ca * len * 0.5];
    const l = [m[0] + ca * 0.45, m[1] - 0.1, m[2] - sa * 0.45], r = [m[0] - ca * 0.45, m[1] - 0.1, m[2] + sa * 0.45];
    const c0 = [tx, h, tz];
    b.tri(c0, l, m, C.frond); b.tri(c0, m, r, C.frond2); b.tri(m, l, e, C.frond); b.tri(m, e, r, C.frond2);
  }
  b.swayFn = null; b.sway = 0;
}

// ----- umbrellas as instanced kits (tint: instance color = canopy color). Unit = beach size.
export function umbrellaKit(level) {
  const b = new Builder({ tint: true });
  const n = level === 0 ? 16 : level === 1 ? 10 : 6, r = 1.25, h = 2.1, W = [1, 1, 1];
  b.tint = 0; b.cyl(0, 0, 0, 0.035, 0.035, h + 0.1, level === 0 ? 6 : 4, C.white, { cap: false });
  if (level === 0) { b.cyl(0, 0, 0, 0.12, 0.08, 0.06, 8, C.metal); b.cyl(0, h + 0.42, 0, 0.03, 0.0, 0.12, 6, C.white); }
  for (let i = 0; i < n; i++) {
    const a0 = (i / n) * Math.PI * 2, a1 = ((i + 1) / n) * Math.PI * 2;
    const p0 = [Math.sin(a0) * r, h, Math.cos(a0) * r], p1 = [Math.sin(a1) * r, h, Math.cos(a1) * r];
    b.tint = i % 2 ? 1 : 0.4; b.tri([0, h + 0.45, 0], p0, p1, W);
    b.tint = 1; b.tri([0, h + 0.45 * 0.55, 0], p1, p0, mul(W, 0.62));
    if (level === 0) { // valance flap below the rim, with a scalloped lower edge
      b.tint = i % 2 ? 0.4 : 1;
      const d0 = [p0[0] * 1.01, h - 0.13, p0[2] * 1.01], d1 = [p1[0] * 1.01, h - 0.13, p1[2] * 1.01], m = [(p0[0] + p1[0]) * 0.505, h - 0.19, (p0[2] + p1[2]) * 0.505];
      b.quad([p0[0] * 1.01, h + 0.005, p0[2] * 1.01], d0, d1, [p1[0] * 1.01, h + 0.005, p1[2] * 1.01], W);
      b.tri(d0, m, d1, W);
      b.tint = 0; b.limb(0, h + 0.2, 0, p0[0] * 0.95, h - 0.02, p0[2] * 0.95, 0.012, 0.01, 3, C.metal); // rib
    }
  }
  b.tint = 0;
  return b.build();
}
// ----- promenade bench: near tier with slats and cast iron ends (bench runs along z, faces -x)
export function benchNearKit() {
  const b = new Builder();
  const W = C.wood, M = C.metal;
  for (let k = 0; k < 4; k++) b.box(-0.18 + k * 0.12, 0.42, 0, 0.1, 0.045, 1.8, mul(W, k % 2 ? 1 : 0.92), { skipBottom: false });
  for (let k = 0; k < 3; k++) { b.push(); b.translate(0.24, 0.55 + k * 0.13, 0); b.rotZ(-0.18); b.box(0, 0, 0, 0.035, 0.1, 1.8, mul(W, k % 2 ? 0.95 : 1.02)); b.pop(); }
  for (const z of [-0.78, 0.78]) {
    b.limb(-0.2, 0, z, -0.18, 0.42, z, 0.03, 0.03, 5, M, { cap: false });
    b.limb(0.2, 0, z, 0.24, 0.95, z, 0.03, 0.028, 5, M);
    b.box(0.0, 0.38, z, 0.46, 0.04, 0.05, M);
    b.box(-0.03, 0.62, z, 0.4, 0.04, 0.06, M); // armrest
    b.limb(-0.22, 0.62, z, -0.2, 0.42, z, 0.022, 0.022, 4, M);
    b.box(-0.2, 0, z, 0.1, 0.02, 0.12, M, { skipBottom: true });
  }
  return b.build();
}

// v2.5.7: decorated pathway through a sea-wall crossing (local chunk z). Sand/stone strip from the
// promenade onto the beach, flared ramp lips, low wood posts with a rope, shells and footprints.
// Baked into the chunk mesh (shared materials, no extra draw calls). detail=false skips small bits.
export function beachCrossing(b, z, half, detail, variant) {
  const sandH = (x, zl) => -0.25 - Math.max(0, (-x - 5)) * 0.016 + 0.06 * Math.sin(x * 0.7) * Math.sin(zl * 0.5 + (variant || 0));
  const pathCol = mix3(C.sand, C.deck, 0.35), stone = mix3(C.curb, C.sand, 0.25), rope = hex(0x6b4a2e);
  // sand tongue + stone strip (tapers toward the beach)
  const xDeck = -4.25, xBeach = -9.2, n = detail ? 5 : 3;
  for (let i = 0; i < n; i++) {
    const t0 = i / n, t1 = (i + 1) / n;
    const xa = xDeck + (xBeach - xDeck) * t0, xb = xDeck + (xBeach - xDeck) * t1;
    const ya = (i === 0 ? 0.03 : sandH(xa, z) + 0.04), yb = sandH(xb, z) + 0.04;
    const wa = half * (0.92 - t0 * 0.22), wb = half * (0.92 - t1 * 0.22);
    const col = mix3(pathCol, C.sand, t0 * 0.7);
    b.quad([xa, ya, z - wa], [xb, yb, z - wb], [xb, yb, z + wb], [xa, ya, z + wa], col);
    // slightly raised stone edge rails
    if (detail) {
      b.quad([xa, ya + 0.02, z - wa], [xb, yb + 0.02, z - wb], [xb, yb + 0.02, z - wb + 0.12], [xa, ya + 0.02, z - wa + 0.12], stone);
      b.quad([xa, ya + 0.02, z + wa - 0.12], [xb, yb + 0.02, z + wb - 0.12], [xb, yb + 0.02, z + wb], [xa, ya + 0.02, z + wa], stone);
    }
  }
  // short ramp lip on the deck side of the gap (white curb flare into the opening)
  b.box(-4.45, 0, z, 0.35, 0.08, half * 1.7, mix3(C.wall, C.sand, 0.35), { skipBottom: true, top: mix3(C.wall, C.sand, 0.2) });
  // low posts + rope on both sides of the path (deck edge and mid-path)
  const posts = detail ? [[-4.9, half * 0.95], [-4.9, -half * 0.95], [-6.6, half * 0.72], [-6.6, -half * 0.72]] : [[-4.9, half * 0.9], [-4.9, -half * 0.9]];
  for (const [px, pz] of posts) {
    const py = sandH(px, z + pz) + 0.02;
    b.cyl(px, py, z + pz, 0.045, 0.04, 0.85, detail ? 6 : 4, C.wood, { cap: true, top: mul(C.wood, 1.1) });
  }
  if (detail) {
    // rope between paired posts
    for (const side of [1, -1]) {
      const z0 = z + half * 0.95 * side, z1 = z + half * 0.72 * side;
      const y0 = sandH(-4.9, z0) + 0.55, y1 = sandH(-6.6, z1) + 0.55;
      b.limb(-4.9, y0, z0, -6.6, y1, z1, 0.018, 0.016, 4, rope, { cap: false });
    }
    // painted markers on the deck approach
    for (const s of [-0.55, 0, 0.55]) b.box(-4.1, 0.025, z + s * half * 0.5, 0.35, 0.02, 0.12, mix3(C.white, hex(0xe8a020), 0.35), { skipBottom: true });
    // shells / pebbles scattered on the sand tongue
    for (let k = 0; k < 5; k++) {
      const u = hash2(Math.floor(z * 10) + k, 91 + (variant | 0));
      const px = -5.2 - u * 3.2, pz = z + (hash2(k, 44) - 0.5) * half * 1.1;
      const py = sandH(px, pz) + 0.03;
      b.box(px, py, pz, 0.08 + u * 0.06, 0.03, 0.06 + u * 0.04, mix3(C.white, C.sand, 0.4 + u * 0.3), { skipBottom: true });
    }
    // footprint pairs on the sand (flat dark ovals)
    const foot = mix3(C.sandWet, hex(0x5a4030), 0.55);
    for (let k = 0; k < 3; k++) {
      const px = -5.0 - k * 1.15, pz = z + (k % 2 ? 0.18 : -0.18);
      const py = sandH(px, pz) + 0.035;
      b.box(px, py, pz, 0.14, 0.015, 0.08, foot, { skipBottom: true });
      b.box(px - 0.2, py, pz + (k % 2 ? -0.22 : 0.22), 0.14, 0.015, 0.08, foot, { skipBottom: true });
    }
  }
}

// v2.5.21: dog-waste bin with a bag dispenser on a post (faces the deck, +x). Baked into chunks.
export function dogBin(b, x, z, detail) {
  const green = hex(0x2f6b3e), dark = hex(0x1f4a2b), metal = hex(0x8c929a), disp = hex(0xd8462f);
  b.cyl(x, 0, z + 0.2, 0.032, 0.032, 1.18, detail ? 6 : 4, metal, { cap: true, top: metal });
  b.box(x, 0, z - 0.05, 0.26, 0.58, 0.28, green, { skipBottom: true, top: dark });
  b.box(x, 0.58, z - 0.05, 0.3, 0.05, 0.32, dark, {});
  b.box(x + 0.01, 0.86, z + 0.2, 0.11, 0.24, 0.16, disp, { top: mul(disp, 0.8) });
  if (detail) {
    b.box(x + 0.135, 0.28, z - 0.05, 0.012, 0.17, 0.17, hex(0xf2f2ec), {});
    b.box(x + 0.143, 0.33, z - 0.05, 0.008, 0.06, 0.07, hex(0x6b4423), {});
    b.box(x + 0.07, 0.88, z + 0.2, 0.03, 0.05, 0.09, hex(0x3fbf6a), {});
  }
}

// v2.5.21: one tiny low-poly lump; instanced for droppings (brown) and poop bags (colored, scaled tall)
export function choreGeometry() {
  const b = new Builder({ tint: true });
  b.tint = 1;
  b.box(0, 0, 0, 0.13, 0.045, 0.1, hex(0xffffff), { skipBottom: true });
  b.box(0.01, 0.045, 0.005, 0.085, 0.04, 0.07, hex(0xf2f2f2), { skipBottom: true });
  b.box(0.0, 0.085, 0.0, 0.04, 0.03, 0.035, hex(0xe6e6e6), { skipBottom: true });
  return b.build();
}
