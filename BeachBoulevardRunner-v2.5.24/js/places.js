// v2.5.18 shared, pure placement of eateries (no THREE, no decor state), so the sim (aicore free will)
// and the renderer (decor) agree on where every door is. Fully deterministic and preset independent.
//  - beach restaurants (left of the boulevard, by the shore): facade / boulevard door at x = RESTO_X
//  - plaza glass cafes (right of the boulevard, between the bike lane and the city road)
import { CHUNK_LEN } from './config.js';
import { hash2 } from './rng.js';
import { nearestCrossing, chunkVariant, chunkUmbrellas, chunkCrossings } from './world.js';

const L = CHUNK_LEN;
// ---- beach restaurants ----
export const RESTO_X = -6.55;            // boulevard facade (door) x; building runs toward the sea
// v2.5.18: facade 1 m further seaward than v2.5.17 (-5.55) so the sand palm row (x -5.7) stands OUTSIDE
// the glass; a boardwalk landing bridges the sea wall -> door. RESTO_F = that extra front depth.
export const RESTO_F = 1.0;
export const RESTO_EVERY = 250, RESTO_OFF = 130;
export const RESTO_DOOR_HALF = 1.05;     // door gap half width (z)
export function beachBusy(x0, x1, z0, z1) {
  const c0 = Math.floor(-z1 / L), c1 = Math.floor(-z0 / L);
  for (let ci = c0; ci <= c1; ci++) {
    const v = chunkVariant(ci), cz = -(ci + 0.5) * L;
    for (const u of chunkUmbrellas(v, true)) { if (u.cafe) continue; const uz = cz + u.z; if (u.x + 1.8 > x0 && u.x - 1.8 < x1 && uz + 1.5 > z0 && uz - 1.5 < z1) return true; }
    if (v % 3 === 0 && -17.6 > x0 && -22.4 < x1 && cz + 7.2 > z0 && cz + 2.6 < z1) return true;
    if (v === 4 && -25.4 > x0 && -26.6 < x1 && cz + 6.4 > z0 && cz - 3.4 < z1) return true;
  }
  return false;
}
const _rc = new Map();
// door slots (chunk-local z) clear of: the sand palm rows of BOTH presets (rich step 6.5 / plain 9.5, trunks
// >= 1.6 m from the door path), the sea-wall crossings (-15.2 / 7.5 +-0.7, resto +-5.6 never covers a gap)
// and the promenade benches (-11 / +5). Preset independent, so the sim's free will agrees with the renderer.
const RESTO_SLOTS = [-1.5]; // (-5.75 dropped: trunks 1.75 m from the door would pierce the canopy)
export function restoZ(k) {
  if (k < 0) return null;
  if (_rc.has(k)) return _rc.get(k);
  const h1 = hash2(k * 7 + 1, 'resto'.length * 131 + 17);
  const zr = -(RESTO_OFF + k * RESTO_EVERY + (h1 - 0.5) * 24);
  const ci0 = Math.floor(-zr / L);
  let z = null;
  for (let d = 0; d <= 4 && z === null; d++) {
    for (const ci of d === 0 ? [ci0] : [ci0 - d, ci0 + d]) {
      const cz = -(ci + 0.5) * L;
      for (const lz of RESTO_SLOTS) { const zc = cz + lz; if (!beachBusy(RESTO_X - 13.3, RESTO_X + 0.35, zc - 6.2, zc + 6.2)) { z = zc; break; } }
      if (z !== null) break;
    }
  }
  if (z === null) z = -(ci0 + 0.5) * L + RESTO_SLOTS[0];
  _rc.set(k, z); if (_rc.size > 400) _rc.delete(_rc.keys().next().value);
  return z;
}
// nearest beach restaurant door z (or null if none within maxD)
export function restoNear(z, maxD = 60) {
  const kc = Math.round((-z - RESTO_OFF) / RESTO_EVERY);
  let best = null, bd = maxD;
  for (let k = kc - 1; k <= kc + 1; k++) { const rz = restoZ(k); if (rz === null) continue; const d = Math.abs(rz - z); if (d < bd) { bd = d; best = rz; } }
  return best;
}

// ---- plaza glass cafes (between bike lane x 6.4 and the road curb x 15.0) ----
export const PCAFE_X = 8.4;              // front (boulevard) facade + door, faces -x
export const PCAFE_D = 4.5;              // depth (+x): back facade + rear door at x 12.9
export const PCAFE_W = 9.6;              // width along z
export const PCAFE_DOOR_HALF = 1.0;
export const PCAFE_EVERY = 100, PCAFE_OFF = 25;
export const ROAD_KERB_X0 = 15.01, ROAD_KERB_X1 = 22.99; // asphalt + both curbs (no building may touch)
// door spots (chunk-local z) clear of the baked plaza palms (x 7.2, rich and plain rows), lamps (x 6.8)
// and the awning / entrance path; kiosk and plaza umbrella checked per chunk variant below.
const PCAFE_LOCAL = [-9.0, 2.65];
function plazaOk(ci, lz) {
  const v = chunkVariant(ci), h71 = hash2(v, 71);
  const half = PCAFE_W / 2 + 0.4;
  if (h71 >= 0.2 && h71 < 0.5) { const kz = (hash2(v, 14) - 0.5) * 16; if (Math.abs(lz - kz) < half + 1.4) return false; } // kiosk x 10
  if (h71 < 0.2) { const uz = (hash2(v, 12) - 0.5) * 14; if (Math.abs(lz - uz) < half + 1.8) return false; }           // plaza umbrella x 8.5
  return true;
}
const _pc = new Map();
export function plazaCafeZ(k) {
  if (k < 0) return null;
  if (_pc.has(k)) return _pc.get(k);
  const zn = -(PCAFE_OFF + k * PCAFE_EVERY);
  const ci0 = Math.floor(-zn / L);
  let best = null, bd = 1e9;
  for (let ci = ci0 - 1; ci <= ci0 + 1; ci++) {
    const cz = -(ci + 0.5) * L;
    for (const lz of PCAFE_LOCAL) { if (!plazaOk(ci, lz)) continue; const z = cz + lz, d = Math.abs(z - zn); if (d < bd) { bd = d; best = z; } }
  }
  if (best !== null && k > 0) { const prev = plazaCafeZ(k - 1); if (prev !== null && Math.abs(prev - best) < PCAFE_W + 6) best = null; }
  _pc.set(k, best); if (_pc.size > 400) _pc.delete(_pc.keys().next().value);
  return best;
}
export function plazaCafeNear(z, maxD = 60) {
  const kc = Math.round((-z - PCAFE_OFF) / PCAFE_EVERY);
  let best = null, bd = maxD;
  for (let k = kc - 1; k <= kc + 1; k++) { const pz = plazaCafeZ(k); if (pz === null) continue; const d = Math.abs(pz - z); if (d < bd) { bd = d; best = pz; } }
  return best;
}
// is (x, z) inside a plaza cafe footprint or its entrance zone (path, crosswalk, awning)? pad in metres
export function plazaHit(x, z, pad = 0.4) {
  if (x < 4.2 || x > 14.2) return false;
  const pz = plazaCafeNear(z, 12); if (pz === null) return false;
  const dz = Math.abs(z - pz);
  if (x >= PCAFE_X - 0.3 - pad && x <= PCAFE_X + PCAFE_D + 0.3 + pad && dz <= PCAFE_W / 2 + 0.3 + pad) return true; // building
  if (x < PCAFE_X && dz <= 2.7 + pad) return true;            // front path / awning / bike-lane crosswalk
  if (x > PCAFE_X + PCAFE_D && x < PCAFE_X + PCAFE_D + 1.2 && dz <= 1.4 + pad) return true; // rear apron
  return false;
}
// soft 0..1 sinks used by the crowd (Gaussian of the distance to the nearest door)
const g = (d, s) => Math.exp(-(d * d) / (2 * s * s));
export function plazaSink(z) { const pz = plazaCafeNear(z, 40); return pz === null ? 0 : g(z - pz, 9); }
export function restoSink(z) { const rz = restoNear(z, 40); return rz === null ? 0 : g(z - rz, 9); }

// ---- v2.5.20 beach sites (restaurants, volleyball, football, matkot), moved here from decor so the sim's
// dog walkers can route around them. Same formulas as v2.5.19 (the renderer still places exactly these).
export const SITES = { resto: { every: 250, off: 130 }, volley: { every: 300, off: 75 }, foot: { every: 180, off: 35 }, matkot: { every: 200, off: 175 } };
export const SITE_ORDER = ['resto', 'volley', 'foot', 'matkot'];
const _sc = new Map();
// base placement: { type, k, x, z, yaw, box, h } (h(n) = the site's hash stream, used by decor for colours / extras)
export function beachSite(type, k) {
  if (k < 0) return null;
  const key = type + ':' + k;
  if (_sc.has(key)) return _sc.get(key);
  const S = SITES[type], h = (n) => hash2(k * 7 + n, type.length * 131 + 17);
  const zr = -(S.off + k * S.every + (h(1) - 0.5) * 24);
  let s = null;
  const mkS = (x, z, yaw, hx, hz) => ({ type, k, x, z, yaw, h, box: { x0: x - hx, x1: x + hx, z0: z - hz, z1: z + hz } });
  if (type === 'resto') {
    s = mkS(RESTO_X, restoZ(k), 0, 0, 0);
    s.box = { x0: -18.6, x1: -5.2, z0: s.z - 5.9, z1: s.z + 5.9 }; // v2.5.11: covers the terrace <-> sand path
  } else {
    const mid = type === 'volley' ? [-20, -23, -26, -17] : type === 'foot' ? [-19, -22, -25, -16] : [-15.5, -18, -21, -24];
    const [lx, lz] = type === 'volley' ? [4.8, 8.6] : type === 'foot' ? [3.6, 7.4] : [1.0, 3.4];
    for (const dz of [0, 10, -10, 20, -20, 30, -30]) {
      for (const x of mid) {
        const z = zr + dz;
        if (!beachBusy(x - lz, x + lz, z - lx, z + lx) && !siteClash(type, x - lz, x + lz, z - lx, z + lx)) { s = mkS(x, z, Math.PI / 2 + (h(4) - 0.5) * 0.25, lz, lx); break; }
      }
      if (s) break;
    }
    if (!s) {
      for (const x of [-32, -35, -28, -38]) {
        if (!beachBusy(x - lx, x + lx, zr - lz, zr + lz) && !siteClash(type, x - lx, x + lx, zr - lz, zr + lz)) { s = mkS(x, zr, (h(4) - 0.5) * 0.2, lx, lz); break; }
      }
      if (!s) s = mkS(type === 'volley' ? -36 : type === 'foot' ? -37 : -34, zr, 0, lx, lz);
    }
  }
  _sc.set(key, s); if (_sc.size > 800) _sc.delete(_sc.keys().next().value);
  return s;
}
// overlap with the sites of the types placed before this one (deterministic order)
function siteClash(type, x0, x1, z0, z1) {
  for (const o of SITE_ORDER) {
    if (o === type) break;
    const S = SITES[o], kc = Math.round((-(z0 + z1) / 2 - S.off) / S.every);
    for (let k = kc - 1; k <= kc + 1; k++) {
      if (k < 0) continue; const s = beachSite(o, k); if (!s) continue; const b = s.box;
      if (b.x0 - 1 < x1 && b.x1 + 1 > x0 && b.z0 - 1 < z1 && b.z1 + 1 > z0) return true;
    }
  }
  return false;
}
// does a rectangle touch any beach site (restaurant incl. its terrace path, courts, matkot)? all presets
export function beachSiteHit(x0, x1, z0, z1, pad = 0.6) {
  for (const o of SITE_ORDER) {
    const S = SITES[o], kc0 = Math.round((-z1 - S.off) / S.every), kc1 = Math.round((-z0 - S.off) / S.every);
    for (let k = Math.min(kc0, kc1) - 1; k <= Math.max(kc0, kc1) + 1; k++) {
      const s = beachSite(o, k); if (!s) continue; const b = s.box;
      if (b.x0 - pad < x1 && b.x1 + pad > x0 && b.z0 - pad < z1 && b.z1 + pad > z0) return true;
    }
  }
  return false;
}
// ---- v2.5.20 ground under the beach (sand formula of the chunk ground) and through a sea-wall crossing
export function beachY(x, z) {
  const ci = Math.floor(-z / L), cz = -(ci + 0.5) * L;
  return -0.25 - Math.max(0, -x - 5) * 0.016 + 0.06 * Math.sin(x * 0.7) * Math.sin((z - cz) * 0.5 + chunkVariant(ci));
}
// deck (0) -> crossing path ramp (props.beachCrossing: x -4.25 .. -5.24) -> sand. Valid on the deck, in a
// crossing gap and on the beach (nobody crosses the solid wall).
export function groundY(x, z) {
  if (x >= -4.25) return 0;
  if (x <= -5.24) return beachY(x, z) + 0.02;
  const t = (-4.25 - x) / 0.99;
  return 0.03 + (beachY(-5.24, z) + 0.04 - 0.03) * t;
}
// sea-wall crossings (world z) of the chunks around z
export function crossingsNear(z, span = 2) {
  const ci = Math.floor(-z / L), out = [];
  for (let i = ci - span; i <= ci + span; i++) {
    if (i < 0) continue;
    const cz = -(i + 0.5) * L;
    for (const c of chunkCrossings(chunkVariant(i))) out.push(cz + c.z);
  }
  return out;
}

// v2.5.21: dog-waste bins (with bag dispenser) - one per sea-wall crossing, on the deck edge
// just past the crossing (x -4.28, tucked against the wall inside the deck edge), off the walking lanes, road and path.
// Baked into the chunk geometry (no extra draws); the sim reads the same pure positions.
export const BIN_X = -4.28, BIN_DZ = 0.5, BIN_STAND_X = -3.78;
export function binZ(cz, c) { return cz + c.z + c.half + BIN_DZ; }
export function binsNear(z, span = 1) {
  const ci = Math.floor(-z / L), out = [];
  for (let i = ci - span; i <= ci + span; i++) {
    if (i < 0) continue;
    const cz = -(i + 0.5) * L;
    for (const c of chunkCrossings(chunkVariant(i))) out.push(binZ(cz, c));
  }
  return out;
}
