// World: streamed chunks (frustum culled, v2.5 tiers near / LOD0 / LOD1 / LOD2 with hysteresis, fog fade),
// near-tier instanced palms, umbrellas and benches, sea strip, sky dome, instanced towers.
import * as THREE from '../vendor/three.module.js';
import { CHUNK_LEN, DECK_HALF, SUN_DIR } from './config.js';
import { Builder, hex, mul, mix3 } from './geo.js';
import { hash2 } from './rng.js';
import { bakedMaterial, skyMaterial, seaMaterial, U } from './materials.js';
import * as P from './props.js';

const C = P.COLORS;
const VARIANTS = 6;

// v2.5.7: openings in the left sea wall so pedestrians can cross boulevard -> beach on decorated
// pathways. Two gaps per 40 m chunk (~20 m apart), each ~3.1 m wide (1-2 walkers). Variant offsets
// keep the boulevard from looking like a perfect grid. Same chunk-index -> variant rule as cafes.
export const CROSS_HALF = 1.55;
export function chunkCrossings(variant) {
  const o = (hash2(variant, 57) - 0.5) * 3.0; // +-1.5 m
  // keep clear of promenade benches (local z -11 and +5)
  return [
    { z: -15.2 + o * 0.45, half: CROSS_HALF },
    { z: 7.5 + o * 0.45, half: CROSS_HALF },
  ];
}
export function chunkVariant(ci) { return Math.floor(hash2(ci, 99) * VARIANTS); }
// Soft 0..1: 1 at a gap centre, ~0 outside the opening (for soft wall holes and leave checks).
export function gapOpen(z) {
  const ci = Math.floor(-z / CHUNK_LEN); let g = 0;
  for (let i = ci - 1; i <= ci + 1; i++) {
    const cz = -(i + 0.5) * CHUNK_LEN;
    for (const c of chunkCrossings(chunkVariant(i))) {
      const d = z - (cz + c.z); g = Math.max(g, Math.exp(-(d * d) / (CROSS_HALF * CROSS_HALF)));
    }
  }
  return g;
}
// Nearest crossing for a walker heading to the sea (prefer a gap ahead in their travel direction).
export function nearestCrossing(z, dir) {
  const ci = Math.floor(-z / CHUNK_LEN); let best = z, bestScore = 1e9;
  const ddir = dir || 1;
  for (let i = ci - 2; i <= ci + 2; i++) {
    const cz0 = -(i + 0.5) * CHUNK_LEN;
    for (const c of chunkCrossings(chunkVariant(i))) {
      const cz = cz0 + c.z, dz = cz - z, ahead = dz * ddir;
      const score = ahead >= -1.5 ? Math.abs(dz) : Math.abs(dz) + 40;
      if (score < bestScore) { bestScore = score; best = cz; }
    }
  }
  return best;
}

const _frustum = new THREE.Frustum(), _pm = new THREE.Matrix4(), _box = new THREE.Box3();

// ---------- v2.5 procedural paving: irregular stones (jittered grid, Voronoi on a torus so the
// texture tiles), mortar joints, a wavy band of darker stones (the old Tel Aviv promenade
// pattern), per-stone tint, worn edges and speckle. The afternoon tint is painted in.
export function makeDeckTexture(size) {
  const cv = document.createElement('canvas');
  cv.width = cv.height = size;
  const g = cv.getContext('2d');
  let seed = 7;
  const rnd = () => { seed = (seed * 16807) % 2147483647; return seed / 2147483647; };
  const N = 7; // stones per tile side (tile = 4 m, so about 0.57 m stones)
  const pts = [];
  for (let j = 0; j < N; j++) for (let i = 0; i < N; i++) {
    const x = (i + 0.5 + (rnd() - 0.5) * 0.75 + (j % 2) * 0.5) / N, y = (j + 0.5 + (rnd() - 0.5) * 0.75) / N;
    const wave = Math.sin(x * Math.PI * 2 + y * Math.PI * 2) > 0.3;
    const base = wave ? [206, 182, 152] : [240, 229, 210];
    const k = 0.9 + rnd() * 0.14, warm = rnd() * 10;
    pts.push({ x: x % 1, y, c: [base[0] * k + warm, base[1] * k + warm * 0.5, base[2] * k] });
  }
  const img = g.createImageData(size, size), d = img.data;
  const mortar = [176, 160, 138], edge = 0.014;
  for (let py = 0; py < size; py++) for (let px = 0; px < size; px++) {
    const u = (px + 0.5) / size, v = (py + 0.5) / size;
    let d1 = 9, d2 = 9, best = null;
    for (const q of pts) {
      let dx = Math.abs(u - q.x), dy = Math.abs(v - q.y);
      if (dx > 0.5) dx = 1 - dx; if (dy > 0.5) dy = 1 - dy;
      const dd = dx * dx + dy * dy;
      if (dd < d1) { d2 = d1; d1 = dd; best = q; } else if (dd < d2) d2 = dd;
    }
    const gap = Math.sqrt(d2) - Math.sqrt(d1); // distance to the joint
    const o = (py * size + px) * 4;
    if (gap < edge * 0.5) { d[o] = mortar[0]; d[o + 1] = mortar[1]; d[o + 2] = mortar[2]; }
    else {
      const bev = Math.min(1, (gap - edge * 0.5) / (edge * 1.6)); // worn, slightly darker edges
      const k = 0.86 + 0.14 * bev;
      d[o] = best.c[0] * k; d[o + 1] = best.c[1] * k; d[o + 2] = best.c[2] * k;
    }
    d[o + 3] = 255;
  }
  g.putImageData(img, 0, 0);
  // speckle + warm sheen (baked hour)
  const dots = size * size / 40;
  for (let k = 0; k < dots; k++) {
    const v = Math.floor(rnd() * 60);
    g.fillStyle = `rgba(${90 + v},${80 + v},${70 + v},0.18)`;
    g.fillRect(rnd() * size, rnd() * size, Math.max(1, size / 256), Math.max(1, size / 256));
  }
  const tex = new THREE.CanvasTexture(cv);
  tex.wrapS = tex.wrapT = THREE.RepeatWrapping;
  tex.anisotropy = size >= 1024 ? 4 : 1;
  tex.generateMipmaps = true;
  tex.minFilter = THREE.LinearMipmapLinearFilter;
  return tex;
}

// ---------- prop layouts shared by the chunk builder and the v2.5 near-tier instances
const L0 = CHUNK_LEN;
export function chunkPalms(rich) {
  const out = [], z0 = -L0 / 2, z1 = L0 / 2;
  const palmStep = rich ? 6.5 : 9.5, palmR = rich ? 10 : 13.333;
  const rowL = (k) => ({ x: -5.7 + (hash2(k, 1) - 0.5) * 0.5, h: 7 + hash2(k, 2) * 2.5 });
  for (let zz = z0 + 3, k = 0; zz < z1 - 1; zz += palmStep, k++) { const q = rowL(k); out.push({ x: q.x, z: zz, h: q.h, seed: k * 17 + 3 }); }
  for (let zz = z0 + 6, k = 0; zz < z1 - 1; zz += palmR, k++) out.push({ x: 7.2, z: zz, h: 6.5 + hash2(k, 3) * 2, seed: k * 23 + 5 });
  return out;
}
export function chunkUmbrellas(variant, rich) {
  const out = [], z0 = -L0 / 2, r = (k) => hash2(variant * 131 + 7, k);
  const umbN = rich ? 7 : 4;
  for (let k = 0; k < umbN; k++) out.push({ x: -10 - r(k + 400) * 22, z: z0 + 3 + r(k + 450) * (L0 - 6), seed: variant * 300 + k, cafe: false, k });
  // v2.5.12: plaza cafe umbrellas only with a boulevard cafe (~every 200 m)
  if (rich && hash2(variant, 71) < 0.2) out.push({ x: 8.5, z: (hash2(variant, 12) - 0.5) * 14, seed: variant * 9 + 1, cafe: true });
  return out;
}
export function chunkBenches() { const out = []; for (let zz = -L0 / 2 + 9; zz < L0 / 2; zz += 16) out.push({ x: -4.0, z: zz }); return out; }

// ---------- Chunk geometry (local z in [-L/2, L/2]).
// v2.5 tiers: 'N' near (as LOD0, but palms, umbrellas and promenade benches come from the
// near-tier instances; cafes and lamps get extra detail), 0 full, 1 simplified, 2 far (very
// cheap palms, coarse ground, no small props). rich = HIGH/ULTRA props.
function buildChunk(variant, lod, rich) {
  const b = new Builder();
  const L = CHUNK_LEN, z0 = -L / 2, z1 = L / 2;
  const near = lod === 'N', det = lod === 0 || near, far = lod === 2;
  const pdet = near ? 2 : det; // prop detail: 2 near, true LOD0, false LOD1 / LOD2
  // 1) shadow casters first (props register casters, ground is baked after)
  const props = new Builder();
  props.casters = b.casters;
  const palmStep = rich ? 6.5 : 9.5;
  // palm rows use the same pattern in every chunk, so the shadows of the neighbouring chunks'
  // palms (long golden-hour shadows cross chunk borders) can be baked in too.
  const rowL = (k) => ({ x: -5.7 + (hash2(k, 1) - 0.5) * 0.5, h: 7 + hash2(k, 2) * 2.5 });
  for (const q of chunkPalms(rich)) {
    if (near) P.palmCasters(props, q.x, q.z, q.h, q.seed, 9);
    else if (far) { P.palmFar(props, q.x, q.z, q.h, q.seed); P.palmCasters(props, q.x, q.z, q.h, q.seed, 6); }
    else P.palm(props, q.x, q.z, q.h, q.seed, det);
  }
  for (const off of [-L, L, -2 * L, 2 * L]) {
    for (let zz = z0 + 3, k = 0; zz < z1 - 1; zz += palmStep, k++) { const q = rowL(k); b.addTrunk(q.x, zz + off, q.h, 0.26); b.addDisk(q.x, q.h, zz + off, 2.7, 8); }
  }
  // beach umbrellas and sunbeds
  for (const u of chunkUmbrellas(variant, rich)) {
    if (near) P.umbrellaCasters(props, u.x, u.z, u.cafe);
    else P.umbrella(props, u.x, u.z, u.seed, det, u.cafe);
    if (!u.cafe && !far && (det || rich)) { P.sunbed(props, u.x + 0.9, u.z + 0.2, 0.1, det); if (rich) P.sunbed(props, u.x - 0.9, u.z + 0.1, -0.1, det); }
  }
  if (variant % 3 === 0) P.lifeguard(props, -20, 4, det);
  if (variant === 4 && det) { // beach volleyball net
    props.box(-26, 0, -3, 0.1, 2.4, 0.1, C.white); props.box(-26, 0, 6, 0.1, 2.4, 0.1, C.white);
    props.box(-26, 1.6, 1.5, 0.03, 0.8, 9, mix3(C.white, C.sand, 0.3));
  }
  // v2.5.12: solid chunk cafés removed — deep glass boulevard cafés are instanced (~every 200 m).
  // Occasional kiosk only; lamps + benches stay.
  if (hash2(variant, 71) >= 0.2 && hash2(variant, 71) < 0.5) {
    P.kiosk(props, 10, (hash2(variant, 14) - 0.5) * 16, variant);
  }
  if (det) {
    for (let zz = z0 + 4; zz < z1; zz += 13) P.lamp(props, 6.8, zz, pdet);
    if (!near) for (const q of chunkBenches()) P.bench(props, q.x, q.z);
  }
  // 2) ground with baked shadows
  b.shadowed = true;
  const deckStep = det ? (rich ? 0.6 : 1.0) : far ? 4 : 2.25;
  const nzDeck = Math.round(L / deckStep), nxDeck = Math.max(far ? 2 : 4, Math.round((DECK_HALF * 2) / deckStep));
  b.wet = 1; b.mapW = 1; b.uvMode = 'xz'; b.uvScale = 0.25;
  b.grid(-DECK_HALF, DECK_HALF, z0, z1, nxDeck, nzDeck, () => C.deck);
  b.mapW = 0; b.uvMode = null;
  b.grid(DECK_HALF, 6.4, z0, z1, far ? 1 : 2, Math.round(L / (det ? 1.2 : far ? 8 : 4)), () => C.bike);
  b.wet = 0.3;
  const sandStep = det ? (rich ? 2 : 3.3) : far ? 10 : 6.6;
  b.grid(-46, -4.9, z0, z1, Math.round(41 / sandStep), Math.round(L / sandStep),
    (x, z) => mix3(C.sand, C.sandWet, Math.max(0, Math.min(1, (-x - 38) / 8)) + 0.06 * Math.sin(x * 1.3 + z * 0.7)),
    (x, z) => -0.25 - Math.max(0, (-x - 5)) * 0.016 + 0.06 * Math.sin(x * 0.7) * Math.sin(z * 0.5 + variant));
  b.wet = 0.6;
  b.grid(6.4, 15.2, z0, z1, det ? 6 : 2, Math.round(L / (det ? 2 : far ? 10 : 6)), (x, z) => mix3(C.plaza, C.deck, 0.3 + 0.2 * Math.sin(z * 0.9)));
  // v2.5.13: two-way city road + tight shop sidewalk (no barren strip to the towers)
  b.wet = 1;
  b.grid(15.2, 22.8, z0, z1, far ? 1 : 3, det ? 10 : 3, () => C.asphalt);
  b.wet = 0.7;
  // cool grey paving on the shop sidewalk (reads as city, not empty sand)
  const pave = (x, z) => mix3(hex(0xb8b3a8), hex(0x9a958c), 0.35 + 0.2 * Math.sin(x * 2.1) * Math.sin(z * 1.7));
  b.grid(22.8, 43.0, z0, z1, far ? 1 : 4, Math.round(L / (det ? 1.8 : far ? 8 : 4)), pave); // v2.5.18: pave out past the glass cafes + fill band
  b.wet = 0.45;
  b.grid(39.0, 43.0, z0, z1, far ? 1 : 2, Math.round(L / (det ? 3 : far ? 10 : 5)), (x, z) => mix3(hex(0x9e9a92), hex(0xb0aaa0), 0.35)); // v2.5.18: service strip behind the cafes
  b.shadowed = false;
  if (det) {
    for (let zz = z0 + 0.6; zz < z1; zz += 3.2) {
      b.quad([18.9, 0.025, zz + 1.4], [19.1, 0.025, zz + 1.4], [19.1, 0.025, zz], [18.9, 0.025, zz], C.line);
    }
    for (const x of [15.55, 22.45]) {
      b.quad([x - 0.05, 0.022, z1], [x + 0.05, 0.022, z1], [x + 0.05, 0.022, z0], [x - 0.05, 0.022, z0], mix3(C.line, C.asphalt, 0.25));
    }
    // sidewalk joint lines
    for (let zz = z0 + 2; zz < z1; zz += 4) {
      b.quad([23.0, 0.03, zz + 0.06], [32.6, 0.03, zz + 0.06], [32.6, 0.03, zz], [23.0, 0.03, zz], mix3(hex(0x9a958c), C.line, 0.15));
    }
  }
  b.wet = 0;
  b.box(15.15, 0, 0, 0.28, 0.14, L, C.curb, { skipBottom: true });
  b.box(22.85, 0, 0, 0.28, 0.14, L, C.curb, { skipBottom: true });
  b.box(43.0, 0, 0, 0.45, 0.16, L, C.curb, { skipBottom: true }); // v2.5.18: back curb past the fill band
  // v2.5.16: fill plaza + recessed right strip (~15 m off asphalt); nothing on the road
  if (!far) {
    const step = det ? 3.8 : 7.0;
    const fillX = 40.6; // v2.5.18: behind the city glass cafes (x 33..38)
    for (let zz = z0 + 2, k = 0; zz < z1 - 1.5; zz += step, k++) {
      const h = hash2(variant, 80 + k);
      // bollards / planters on the right fill band (was curb/road — blocked cars)
      if (det) props.cyl(fillX - 0.4, 0, zz + 1.0, 0.07, 0.07, 0.8, 5, hex(0xc9a227), { cap: true });
      const px = fillX + (h - 0.5) * 0.6;
      props.box(px, 0.12, zz, 0.48, 0.4, 0.48, hex(0x8a6a4a), { skipBottom: true });
      props.cyl(px, 0.5, zz, 0.24, 0.05, 0.4, 6, hex(0x3f7f3a));
      // mid sidewalk planters between curb and recessed restos
      if (h > 0.45) {
        const mx = 24.6 + (h - 0.5) * 0.5; // v2.5.18: off the walker line (26.5)
        props.box(mx, 0.12, zz + 0.6, 0.42, 0.38, 0.42, hex(0x8a6a4a), { skipBottom: true });
        props.cyl(mx, 0.48, zz + 0.6, 0.2, 0.05, 0.35, 6, hex(0x4a8f45));
      }
      // v2.5.18: plaza planters removed from the bake (plaza glass cafes stand there; instanced fill keeps clear)
      if (det) {
        if (k % 2 === 0) {
          const tx = fillX + 1.2 + (h - 0.5) * 0.5;
          props.cyl(tx, 0, zz - 0.8, 0.1, 0.09, 1.6, 5, hex(0x6b4a2e), { cap: true });
          props.cyl(tx, 1.5, zz - 0.8, 0.7, 0.45, 0.95, 6, hex(0x3f7f3a), { cap: true, top: hex(0x5d9a3e) });
        }
        if (k % 4 === 2) {
          // lamp posts with the fill band (not on asphalt)
          props.cyl(fillX - 0.9, 0, zz - 1.5, 0.06, 0.06, 3.2, 5, hex(0x6a6e76), { cap: true });
          props.wet = 3.85; props.mapW = 0; // v2.5.19: emissive warm head (street-lamp glow layer in decor)
          props.box(fillX - 0.9, 3.15, zz - 1.5, 0.35, 0.2, 0.35, [1.0, 0.9, 0.68]);
          props.wet = 0;
        }
      }
    }
  }
  // v2.5.7: sea wall broken into segments with intentional crossing gaps (~3.1 m) onto the beach
  {
    const crosses = chunkCrossings(variant);
    const wallX = -4.7, wallW = 0.45, wallH = 0.45;
    const cuts = [z0];
    for (const c of crosses) { cuts.push(c.z - c.half, c.z + c.half); }
    cuts.push(z1);
    for (let i = 0; i < cuts.length; i += 2) {
      const a = cuts[i], bb = cuts[i + 1];
      if (bb - a < 0.08) continue;
      b.box(wallX, 0, (a + bb) * 0.5, wallW, wallH, bb - a, C.wall, { skipBottom: true, top: mul(C.wall, 1.05) });
      // flared ends at each gap mouth (look intentional, not a crack)
      if (i > 0) b.box(wallX, 0, a, wallW + 0.14, wallH + 0.1, 0.28, mul(C.wall, 1.03), { skipBottom: true, top: mul(C.wall, 1.1) });
      if (i + 1 < cuts.length - 1) b.box(wallX, 0, bb, wallW + 0.14, wallH + 0.1, 0.28, mul(C.wall, 1.03), { skipBottom: true, top: mul(C.wall, 1.1) });
    }
    // decorated pathways through each gap (detail LODs only; far keeps the opening in the wall)
    if (!far) for (const c of crosses) P.beachCrossing(props, c.z, c.half, det, variant);
    // v2.5.21: dog-waste bin + bag dispenser by each crossing (deck edge, past the gap; = places.binZ, BIN_X)
    if (!far) for (const c of crosses) P.dogBin(props, -4.28, c.z + c.half + 0.5, det);
  }
  // v2.5.12: road curbs baked with the asphalt strip above
  // 3) merge props in (props already baked N.L only)
  for (const k of ['pos', 'col', 'lit', 'uvs', 'sways']) { const src = props[k]; for (let i = 0; i < src.length; i++) b[k].push(src[i]); }
  const g = b.build();
  g.userData.tris = b.triCount;
  return g;
}

export class World {
  constructor(scene, preset) {
    this.scene = scene;
    this.cache = new Map();
    this.slots = [];
    this.deckTex = null;
    this.mat = null;
    this.towerMat = bakedMaterial({ instanced: true, tower: true, tint: true });
    this.lodScale = 1;
    this.buildNearProps();
    this.buildSky();
    this.buildTowers();
    this.applyPreset(preset);
  }
  // v2.5 near tier: one instanced draw each for palms (a whole chunk's palm rows per instance,
  // exactly the same seeds as the mid palms), umbrellas (instance color = canopy) and benches
  buildNearProps() {
    this.nearPalmGeo = {};
    this.palmNear = new THREE.InstancedMesh(new THREE.BufferGeometry(), bakedMaterial({ sway: true }), 6);
    this.umbNear = new THREE.InstancedMesh(P.umbrellaKit(0), bakedMaterial({ tint: true }), 64);
    this.benchNear = new THREE.InstancedMesh(P.benchNearKit(), bakedMaterial({}), 18);
    this.umbNear.setColorAt(0, new THREE.Color(1, 1, 1));
    for (const m of [this.palmNear, this.umbNear, this.benchNear]) { m.frustumCulled = false; m.count = 0; m.visible = false; m.instanceMatrix.setUsage(THREE.DynamicDrawUsage); this.scene.add(m); }
    this.nearKey = '';
  }
  palmRowGeo(rich) {
    const k = rich ? 1 : 0;
    if (!this.nearPalmGeo[k]) { const b = new Builder(); for (const q of chunkPalms(rich)) P.palmNear(b, q.x, q.z, q.h, q.seed); this.nearPalmGeo[k] = b.build(); }
    return this.nearPalmGeo[k];
  }
  fillNearProps(list) {
    const p = this.preset, m4 = new THREE.Matrix4(), col = new THREE.Color();
    if (this.palmNear.geometry !== this.palmRowGeo(p.rich)) this.palmNear.geometry = this.palmRowGeo(p.rich);
    let np = 0, nu = 0, nb = 0;
    for (const { ci, variant, cz } of list) {
      if (np < 6) this.palmNear.setMatrixAt(np++, m4.makeTranslation(0, 0, cz));
      for (const u of chunkUmbrellas(variant, p.rich)) {
        if (nu >= 64) break;
        const s = u.cafe ? 1.2 : 1;
        m4.makeScale(s, u.cafe ? 2.3 / 2.1 : 1, s).setPosition(u.x, 0, cz + u.z);
        this.umbNear.setMatrixAt(nu, m4); col.setRGB(...P.umbrellaColor(u.seed)); this.umbNear.setColorAt(nu, col); nu++;
      }
      for (const q of chunkBenches()) if (nb < 18) this.benchNear.setMatrixAt(nb++, m4.makeTranslation(q.x, 0, cz + q.z));
    }
    for (const [m, n] of [[this.palmNear, np], [this.umbNear, nu], [this.benchNear, nb]]) {
      m.count = n; m.visible = n > 0; m.instanceMatrix.needsUpdate = true; if (m.instanceColor) m.instanceColor.needsUpdate = true;
    }
  }
  // decor asks which tier a chunk index currently has (-1 near, 0, 1, 2; 9 = not streamed)
  inView(cz) {
    _box.min.set(-46, -1, cz - CHUNK_LEN / 2); _box.max.set(45, 12, cz + CHUNK_LEN / 2); // v2.5.18: include cafes + fill band
    return _frustum.intersectsBox(_box);
  }
  lodFor(ci) { for (const s of this.slots) if (s.index === ci) return s.lod; return 9; }
  geo(variant, lod, rich) {
    const key = `${variant}:${lod}:${rich ? 1 : 0}`;
    let g = this.cache.get(key);
    if (!g) { g = buildChunk(variant, lod, rich); this.cache.set(key, g); }
    return g;
  }
  applyPreset(p) {
    this.preset = p;
    if (!this.deckTex || this.deckTex.image.width !== p.tex) {
      if (this.deckTex) this.deckTex.dispose();
      this.deckTex = makeDeckTexture(p.tex);
    }
    if (this.mat) this.mat.dispose();
    this.mat = bakedMaterial({ map: this.deckTex, wet: true, reflect: p.reflect, sway: true, glows: true }); // v2.5.19 lamp heads
    for (const s of this.slots) this.scene.remove(s.mesh);
    this.slots = []; this.nearKey = '';
    const n = p.chunksAhead + 2;
    for (let i = 0; i < n; i++) {
      const mesh = new THREE.Mesh(this.geo(0, 1, p.rich), this.mat);
      mesh.frustumCulled = true; mesh.matrixAutoUpdate = true; mesh.renderOrder = 0;
      this.scene.add(mesh);
      this.slots.push({ mesh, index: -999, lod: -1 });
    }
    // sea
    if (this.sea) { this.scene.remove(this.sea); this.sea.geometry.dispose(); this.sea.material.dispose(); }
    const sg = new THREE.PlaneGeometry(520, 900, Math.max(4, Math.floor(p.seaSeg / 3)), p.seaSeg);
    sg.rotateX(-Math.PI / 2);
    sg.translate(-46 - 260, -0.85, 0);
    this.sea = new THREE.Mesh(sg, seaMaterial(p.rich));
    this.sea.frustumCulled = false; this.sea.renderOrder = 0;
    this.scene.add(this.sea);
    this.sky.material.defines = p.clouds ? { CLOUDS: '' } : {};
    this.sky.material.needsUpdate = true;
    this.glare.visible = p.glare;
    this.towers.count = p.rich ? 40 : 24;
    for (const t of this.towerSlots) t.z = 1e9;
  }
  buildSky() {
    const g = new THREE.SphereGeometry(400, 24, 12);
    this.sky = new THREE.Mesh(g, skyMaterial());
    this.sky.frustumCulled = false;
    this.sky.renderOrder = 10; // after all opaque geometry -> hidden sky pixels fail the depth test
    this.scene.add(this.sky);
    // sun glare sprite (HIGH/ULTRA)
    const cv = document.createElement('canvas'); cv.width = cv.height = 128;
    const x = cv.getContext('2d');
    const gr = x.createRadialGradient(64, 64, 0, 64, 64, 64);
    gr.addColorStop(0, 'rgba(255,240,200,1)'); gr.addColorStop(0.15, 'rgba(255,200,140,0.55)');
    gr.addColorStop(0.5, 'rgba(255,160,90,0.12)'); gr.addColorStop(1, 'rgba(255,140,80,0)');
    x.fillStyle = gr; x.fillRect(0, 0, 128, 128);
    const tex = new THREE.CanvasTexture(cv);
    this.glare = new THREE.Sprite(new THREE.SpriteMaterial({ map: tex, blending: THREE.AdditiveBlending, depthWrite: false, fog: false, transparent: true }));
    this.glare.scale.set(150, 150, 1);
    this.glare.renderOrder = 11;
    this.scene.add(this.glare);
  }
  buildTowers() {
    const b = new Builder({ tint: true });
    b.tint = 1;
    b.box(0, 0, 0, 1, 1, 1, [1, 1, 1], { skipBottom: true });
    const g = b.build();
    const MAXT = 40;
    this.towers = new THREE.InstancedMesh(g, this.towerMat, MAXT);
    this.towers.frustumCulled = false; this.towers.renderOrder = 0;
    this.towerSlots = [];
    const pal = [hex(0xd9d4cc), hex(0xbfc6cc), hex(0xe6d9c2), hex(0x9fb0bd), hex(0xcfc2b0)];
    const col = new THREE.Color();
    for (let i = 0; i < MAXT; i++) {
      col.setRGB(...pal[i % pal.length]);
      this.towers.setColorAt(i, col);
      this.towerSlots.push({ z: 1e9 });
    }
    this.scene.add(this.towers);
  }
  placeTower(i, cycle) {
    const n = this.towers.count;
    const span = 760;
    const spacing = span / n;
    const z = -(cycle * n + i) * spacing;
    const h = 22 + hash2(i, cycle) * 95;
    const w = 12 + hash2(i + 7, cycle) * 12;
    const x = 44.5 + w * 0.5 + hash2(i + 3, cycle) * 46; // v2.5.18: front face behind the fill band (x >= 44.5)
    const m = new THREE.Matrix4().compose(new THREE.Vector3(x, 0, z), new THREE.Quaternion(), new THREE.Vector3(w, h, w * (0.8 + hash2(i, cycle + 9) * 0.6)));
    this.towers.setMatrixAt(i, m);
    this.towerSlots[i].z = z; this.towerSlots[i].cycle = cycle;
  }
  update(camZ, fogFar, camera) {
    const L = CHUNK_LEN;
    const p = this.preset, lc = p.lod, k = this.lodScale;
    if (camera) { camera.updateMatrixWorld(); _pm.multiplyMatrices(camera.projectionMatrix, camera.matrixWorldInverse); _frustum.setFromProjectionMatrix(_pm); }
    const first = Math.floor(-camZ / L) - 1;
    const n = this.slots.length;
    let visible = 0;
    const nearList = []; let key = '';
    const nearD = lc.chunkNear * k, lod2 = Math.max(p.lod0 + L, lc.lod2 * Math.max(0.6, k)), band = 6; // metres of hysteresis
    for (let i = first; i < first + n; i++) {
      const s = this.slots[((i % n) + n) % n];
      const centerZ = -(i + 0.5) * L;
      const dist = Math.abs(centerZ - camZ) - L / 2;
      const cur = s.index === i ? s.lod : 9;
      const pick = (lim, lv) => dist < lim + (cur <= lv ? band : -band);
      let lod = nearD > 0 && pick(nearD, -1) ? -1 : pick(p.lod0, 0) ? 0 : pick(lod2, 1) ? 1 : 2;
      if (this.forceLod !== null && this.forceLod !== undefined && dist < 120) lod = this.forceLod; // debug comparison only
      const variant = chunkVariant(i);
      if (s.index !== i || s.lod !== lod) {
        s.index = i; s.lod = lod;
        s.mesh.geometry = this.geo(variant, lod < 0 ? 'N' : lod, p.rich);
        s.mesh.position.z = centerZ;
      }
      s.mesh.visible = dist < fogFar + 10; // beyond fog end: fully faded, skip the draw
      if (s.mesh.visible) visible++;
      // near-tier props only for near chunks inside the view frustum (chunk meshes are culled by three.js)
      if (lod < 0 && (!camera || this.inView(centerZ))) { nearList.push({ ci: i, variant, cz: centerZ }); key += i + ','; }
    }
    if (key !== this.nearKey) { this.nearKey = key; this.fillNearProps(nearList); }
    this.visibleChunks = visible;
    this.nearChunks = nearList.length;
    // towers recycle
    const tn = this.towers.count, spacing = 760 / tn;
    let dirty = false;
    for (let i = 0; i < tn; i++) {
      const sl = this.towerSlots[i];
      if (sl.z > camZ + 60 || sl.z < camZ - 900) {
        const baseCycle = Math.floor((-(camZ + 60) / spacing - i) / tn) + 1;
        this.placeTower(i, Math.max(0, baseCycle));
        dirty = true;
      }
    }
    if (dirty) this.towers.instanceMatrix.needsUpdate = true;
    this.sea.position.z = camZ - 300;
  }
  frame(camera) {
    this.sky.position.copy(camera.position);
    const sd = U.uSunDir.value, gd = camera.far * 0.85;
    this.glare.position.set(camera.position.x + sd.x * gd, camera.position.y + sd.y * gd, camera.position.z + sd.z * gd);
    this.glare.scale.setScalar(gd * 0.4);
  }
}
