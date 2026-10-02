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
}

export function lamp(b, x, z, detail) {
  b.cyl(x, 0, z, 0.07, 0.05, 4.2, detail ? 6 : 4, C.metal);
  b.box(x - 0.4, 4.1, z, 0.9, 0.08, 0.08, C.metal);
  b.box(x - 0.85, 3.9, z, 0.3, 0.2, 0.3, C.lamp);
}
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
