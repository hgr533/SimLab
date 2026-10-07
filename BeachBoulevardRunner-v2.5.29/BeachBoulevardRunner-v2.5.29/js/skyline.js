// v2.5.26 layered right-side skyline (replaces the plain instanced tower boxes behind the road / cafes).
// Three depth rows over a 450 m repeating band (instanced 2-3 times along the run):
//   A  front row (x 45..): 3-7 floor Tel Aviv style - white Bauhaus with ribbon windows, rounded corners and
//      balconies, older stone / plaster with punched windows and shutters; awnings + glowing shop signs at street
//      level, AC units, roof water tanks + solar heaters, roof gardens, people on balconies and roofs
//   B  middle row (x 64..): 8-16 floors, glass or plaster, setbacks, roof lights, antennas
//   C  back row (x 96..): 20-42 floor towers with 1-3 setbacks, crown lights, antennas with red beacons
// One merged geometry (1 draw for all buildings + baked roof / balcony figures) + one additive halo layer
// (glowMaterial, 1 draw; hidden when the lights are off). Windows are procedural in the fragment shader (grid
// per style, randomly lit warm / cool, a few flickering / TV-blue, silhouettes of people in lit windows on
// HIGH / ULTRA) and turn on with U.uLights (RAIN 1.0, CLOUDY 0.7, GOLDEN 0.5, CLEAR HAZE 0.15, SEA SPRAY 0).
// Layout comes from its own seeded RNG (never the sim's). LOW: rows A + C only, no balconies / people / halos.
import * as THREE from '../vendor/three.module.js';
import { Builder, hex, mul, mix3 } from './geo.js';
import { makeRng } from './rng.js';
import { U, glowMaterial } from './materials.js';

export const SKY_P = 450; // m, repeat period along z
const C = (h) => hex(h);
const BAUHAUS = [0xf3efe6, 0xece6d9, 0xf6f3ee, 0xe9e2d2].map(C);
const PLASTER = [0xe6d5ba, 0xd9c6a6, 0xc9d4d6, 0xe7c9b6, 0xd8d2c4, 0xcfd9c8].map(C);
const STONE = [0xcbb79a, 0xb9a88d, 0xc7b192, 0xa89880].map(C);
const GLASS = [0x6f8796, 0x58707f, 0x86a0ad, 0x445b6b, 0x7a8f8a, 0x5d6f86].map(C);
const ACCENT = [0xc0392b, 0x2e86c1, 0x16a085, 0xf1c40f, 0xe67e22, 0x7d3c98, 0x2c3e50].map(C);
const SIGN = [0xff5a3c, 0x3cd2ff, 0xffd24a, 0x7dff6a, 0xff4fb3, 0xffffff].map(C);
const SKIN = [0xc58c63, 0x8d5a3b, 0xe0b08a, 0x6b4430].map(C);
const SHIRT = [0xe8473c, 0x2f7fd8, 0xf2c14e, 0x3fae6b, 0xffffff, 0x8a5cd6, 0x222222].map(C);
const GREY = C(0x8d9196), DARK = C(0x2b2e33), WHITE = [1, 1, 1], GREEN = C(0x4f8a3c), SOLAR = C(0x1e2f4a);

// style codes in uv.x: 0 plain, 1 glass facade, 2 Bauhaus ribbon windows, 3 punched windows (stone / plaster),
// 4 emissive (uv.y = intensity), 5 red aviation beacon (blinks); facade styles carry the building seed in uv.y
function tag(b, style, val, fn) { const n0 = b.uvs.length; fn(); for (let i = n0; i < b.uvs.length; i += 2) { b.uvs[i] = style; b.uvs[i + 1] = val; } }

function person(b, R, x, y, z) {
  const sk = SKIN[R.int(0, 3)], sh = SHIRT[R.int(0, SHIRT.length - 1)];
  b.box(x, y, z, 0.32, 0.8, 0.26, mul(sh, 0.55));          // legs
  b.box(x, y + 0.8, z, 0.42, 0.62, 0.3, sh);               // torso
  b.box(x, y + 1.44, z, 0.22, 0.26, 0.22, sk);             // head
}

export function skylineGeo(level) { // level 0 LOW, 1 MEDIUM, 2 HIGH, 3 ULTRA
  const b = new Builder({}), R = makeRng(0x5c1e2526), halos = [];
  const det = level >= 2, mid = level >= 1;
  const halo = (x, y, z, r, c, ph = -1) => halos.push({ x, y, z, r, c, ph });
  const FH = 3.3;
  // ---------- row A: Tel Aviv street front
  for (let z = -2; z > -SKY_P + 8;) {
    const w = R.range(10, 19), gap = R.range(0.8, 3.5), zc = z - w / 2;
    if (zc - w / 2 < -SKY_P + 2) break;
    const kind = R.next(), floors = R.int(3, 7), H = floors * FH, d = R.range(10, 15), x0 = 45 + R.range(0, 3.5);
    const bau = kind < 0.45, st = bau ? 2 : 3, seed = R.next();
    const col = bau ? BAUHAUS[R.int(0, 3)] : kind < 0.75 ? PLASTER[R.int(0, PLASTER.length - 1)] : STONE[R.int(0, STONE.length - 1)];
    const acc = ACCENT[R.int(0, ACCENT.length - 1)];
    b.ao = 1;
    tag(b, st, seed, () => b.box(x0 + d / 2, 0, zc, d, H, w, col, { skipBottom: true, top: mul(col, 0.82) }));
    if (bau && R.chance(0.5)) tag(b, st, seed, () => b.cyl(x0 + 2.2, 0, zc - w / 2 + 2.2, 2.3, 2.3, H, mid ? 10 : 6, col, { top: mul(col, 0.82) })); // rounded corner
    b.box(x0 + d / 2, H, zc, d + 0.3, 0.5, w + 0.3, mul(col, 0.92), { skipBottom: true });  // parapet band
    // street level: awning + sign (glow)
    if (R.chance(0.8)) {
      b.box(x0 - 0.9, 2.7, zc, 1.8, 0.18, w * 0.8, acc, { top: mul(acc, 1.1) });
      if (mid) for (let k = 0; k < 3; k++) b.box(x0 - 1.75, 2.4, zc - w * 0.36 + k * w * 0.36, 0.06, 0.3, w * 0.24, mul(acc, 0.8));
      const sc = SIGN[R.int(0, SIGN.length - 1)], sw = Math.min(w * 0.6, R.range(3, 7));
      tag(b, 4, 0.9, () => b.box(x0 - 0.12, 3.05, zc, 0.22, 0.75, sw, sc));
      if (mid) halo(x0 - 0.5, 3.4, zc, sw * 0.55, sc, R.next());
    }
    if (mid) { // balconies on the front face (Bauhaus: long slabs; others: small with shutters)
      const bays = Math.max(1, Math.floor(w / (bau ? 6 : 4)));
      for (let f = 1; f < floors; f++) for (let k = 0; k < bays; k++) {
        if (!bau && R.chance(0.35)) continue;
        const bw = bau ? w / bays - 0.6 : 2.4, bz = zc - w / 2 + (k + 0.5) * (w / bays), by = f * FH;
        b.box(x0 - 0.7, by - 0.15, bz, 1.4, 0.18, bw, mul(col, 0.95));
        b.box(x0 - 1.35, by, bz, 0.08, 0.95, bw, bau ? mul(col, 0.97) : DARK, { skipBottom: true });
        if (!bau) for (const s of [-1, 1]) b.box(x0 - 0.05, by + 0.1, bz + s * (bw / 2 + 0.35), 0.12, 2.1, 0.6, acc);
        if (det && R.chance(0.16)) person(b, R, x0 - 0.75, by, bz + R.range(-bw / 3, bw / 3));
        if (det && R.chance(0.08)) { tag(b, 4, 0.6, () => b.box(x0 - 0.05, by + 2.3, bz, 0.14, 0.22, 0.22, C(0xffe2a8))); halo(x0 - 0.3, by + 2.4, bz, 0.7, C(0xffd9a0)); }
      }
      for (let k = 0; k < (det ? 4 : 2); k++) if (R.chance(0.6)) b.box(x0 - 0.35, R.int(1, floors - 1) * FH + 1.0, zc + R.range(-w / 2 + 1, w / 2 - 1), 0.7, 0.6, 0.9, GREY); // AC units
    }
    // roof: water tanks + solar heaters (Tel Aviv), roof garden, people
    const rx = x0 + d / 2;
    if (mid || R.chance(0.5)) {
      for (let k = 0; k < R.int(1, 3); k++) {
        const tz = zc + R.range(-w / 2 + 2, w / 2 - 2), tx = rx + R.range(-d / 3, d / 3);
        b.cyl(tx, H + 0.5, tz, 0.55, 0.55, 1.4, mid ? 6 : 4, R.chance(0.5) ? C(0xf0f0ee) : GREY);
        if (mid) b.box(tx, H, tz, 1.2, 0.5, 1.2, DARK, { skipBottom: true });
        if (mid) { b.push(); b.translate(tx - 1.6, H + 0.5, tz); b.rotZ(0.6); b.box(0, 0, 0, 1.0, 0.06, 1.9, SOLAR, { top: C(0x35507a) }); b.pop(); }
      }
      if (det && R.chance(0.35)) { // roof garden
        b.box(rx, H, zc + w / 4, d * 0.5, 0.6, w * 0.35, C(0x6b4a2e));
        for (let k = 0; k < 3; k++) b.ellip(rx + R.range(-d / 5, d / 5), H + 1.2, zc + w / 4 + R.range(-w / 7, w / 7), 0.8, 0.8, 0.8, 5, 3, mul(GREEN, R.range(0.8, 1.2)));
        tag(b, 4, 0.5, () => { for (let k = 0; k < 4; k++) b.box(rx - d / 4 + k * d / 6, H + 0.6, zc + w / 4 - w * 0.18, 0.12, 0.12, 0.12, C(0xffe6b0)); });
        for (let k = 0; k < 4; k++) halo(rx - d / 4 + k * d / 6, H + 0.7, zc + w / 4 - w * 0.18, 0.6, C(0xffd9a0), R.next());
      }
      if (det) for (let k = 0; k < R.int(0, 2); k++) person(b, R, rx + R.range(-d / 3, d / 3), H, zc + R.range(-w / 3, w / 3));
    }
    z -= w + gap;
  }
  // ---------- row B: mid-rise (MEDIUM+)
  if (mid) for (let z = -6; z > -SKY_P + 10;) {
    const w = R.range(14, 26), gap = R.range(3, 9), zc = z - w / 2;
    if (zc - w / 2 < -SKY_P + 4) break;
    const floors = R.int(8, 16), H = floors * FH, d = R.range(14, 22), x0 = 64 + R.range(0, 8), seed = R.next();
    const glass = R.chance(0.45), col = glass ? GLASS[R.int(0, GLASS.length - 1)] : R.chance(0.5) ? PLASTER[R.int(0, PLASTER.length - 1)] : BAUHAUS[R.int(0, 3)];
    const st = glass ? 1 : R.chance(0.5) ? 2 : 3;
    tag(b, st, seed, () => b.box(x0 + d / 2, 0, zc, d, H, w, col, { skipBottom: true, top: mul(col, 0.8) }));
    let top = H;
    if (R.chance(0.5)) { const h2 = R.int(2, 4) * FH; tag(b, st, seed, () => b.box(x0 + d / 2 + 2, H, zc, d * 0.7, h2, w * 0.7, col, { skipBottom: true, top: mul(col, 0.8) })); top = H + h2; }
    if (!glass && det) for (let k = 0; k < 6; k++) b.box(x0 - 0.35, R.int(1, floors - 1) * FH + 1, zc + R.range(-w / 2 + 1, w / 2 - 1), 0.7, 0.6, 0.9, GREY);
    if (!glass && det) for (let f = 2; f < floors; f += 2) b.box(x0 - 0.6, f * FH - 0.15, zc, 1.2, 0.16, w * 0.85, mul(col, 0.93)); // balcony bands
    b.cyl(x0 + d / 2 + 2, top, zc + w / 4, 0.7, 0.7, 1.6, 6, GREY);
    if (R.chance(0.6)) { b.limb(x0 + d / 2, top, zc - w / 5, x0 + d / 2, top + R.range(4, 9), zc - w / 5, 0.08, 0.04, 4, DARK); }
    if (R.chance(0.5)) { const sc = SIGN[R.int(0, SIGN.length - 1)]; tag(b, 4, 1.0, () => b.box(x0 - 0.15, top - 2.2, zc, 0.25, 1.6, w * 0.5, sc)); halo(x0 - 1, top - 1.4, zc, w * 0.35, sc, -1); }
    if (det && R.chance(0.3)) person(b, R, x0 + d / 2, top, zc + R.range(-w / 4, w / 4));
    z -= w + gap;
  }
  // ---------- row C: towers
  for (let z = -10; z > -SKY_P + 14;) {
    const w = R.range(18, 30), gap = R.range(8, 26), zc = z - w / 2;
    if (zc - w / 2 < -SKY_P + 6) break;
    const floors = R.int(20, 42), d = R.range(18, 28), x0 = 96 + R.range(0, 30), seed = R.next();
    const glass = R.chance(0.7), col = glass ? GLASS[R.int(0, GLASS.length - 1)] : R.chance(0.5) ? PLASTER[R.int(0, PLASTER.length - 1)] : STONE[R.int(0, STONE.length - 1)];
    const st = glass ? 1 : 3, tiers = level ? R.int(1, 3) : 1;
    let y = 0, cw = w, cd = d, cx = x0 + d / 2, left = floors;
    for (let t = 0; t < tiers; t++) {
      const fl = t === tiers - 1 ? left : Math.max(4, Math.round(left * R.range(0.45, 0.7))); left -= fl;
      tag(b, st, seed, () => b.box(cx, y, zc, cd, fl * FH, cw, col, { skipBottom: true, top: mul(col, 0.78) }));
      y += fl * FH; cw *= R.range(0.65, 0.85); cd *= R.range(0.65, 0.85); cx += R.range(0, 2);
    }
    if (mid) { // crown lights + antenna with beacon
      tag(b, 4, 0.8, () => b.box(cx, y - 0.6, zc, cd + 0.1, 0.35, cw + 0.1, R.chance(0.5) ? C(0xbfe6ff) : C(0xffe0b0)));
      halo(cx - cd / 2, y - 0.4, zc, cw * 0.4, C(0xcfe8ff), -1);
    }
    if (R.chance(0.7)) {
      const ah = R.range(6, 16);
      b.limb(cx, y, zc, cx, y + ah, zc, 0.18, 0.06, 4, DARK);
      tag(b, 5, 1, () => b.box(cx, y + ah, zc, 0.5, 0.5, 0.5, C(0xff2a1a)));
      halo(cx, y + ah + 0.25, zc, 2.2, C(0xff3020), -1);
    }
    z -= w + gap;
  }
  const g = b.build(); g.userData.tris = b.triCount; g.userData.halos = halos.length;
  return { g, halos };
}

function haloGeo(halos) {
  const n = halos.length, pos = new Float32Array(n * 12), aG = new Float32Array(n * 12), aS = new Float32Array(n * 8), aPh = new Float32Array(n * 4), col = new Float32Array(n * 12), idx = [];
  const cs = [[-1, -1], [1, -1], [1, 1], [-1, 1]];
  halos.forEach((h, i) => {
    for (let k = 0; k < 4; k++) {
      const v = i * 4 + k; pos.set([h.x, h.y, h.z], v * 3); aG.set([cs[k][0], cs[k][1], 0], v * 3); aS.set([h.r, h.r], v * 2); aPh[v] = h.ph; col.set(h.c, v * 3);
    }
    idx.push(i * 4, i * 4 + 1, i * 4 + 2, i * 4, i * 4 + 2, i * 4 + 3);
  });
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.BufferAttribute(pos, 3)); g.setAttribute('aG', new THREE.BufferAttribute(aG, 3));
  g.setAttribute('aS', new THREE.BufferAttribute(aS, 2)); g.setAttribute('aPh', new THREE.BufferAttribute(aPh, 1));
  g.setAttribute('color', new THREE.BufferAttribute(col, 3)); g.setIndex(idx);
  return g;
}

const VERT = `attribute vec4 aLight; varying vec3 vCol; varying vec4 vLight; varying vec3 vWorld; varying vec2 vSt;
#include <fog_pars_vertex>
void main() {
  vec4 wp = modelMatrix * instanceMatrix * vec4(position, 1.0);
  vWorld = wp.xyz; vCol = color; vLight = aLight; vSt = uv;
  vec4 mvPosition = viewMatrix * wp; gl_Position = projectionMatrix * mvPosition;
  #include <fog_vertex>
}`;
const FRAG = `uniform vec3 uAmb; uniform vec3 uSun; uniform vec3 uSkyRefl; uniform float uLights; uniform float uTime;
varying vec3 vCol; varying vec4 vLight; varying vec3 vWorld; varying vec2 vSt;
#include <fog_pars_fragment>
float h1(vec2 p) { return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453); }
void main() {
  float st = vSt.x;
  vec3 lit = uAmb * vLight.y + uSun * vLight.x;
  vec3 c = vCol * lit;
  if (st > 4.5) { // aviation beacon
    float on = step(fract(uTime * 0.75 + vWorld.z * 0.01), 0.35);
    c = mix(c, vec3(1.0, 0.16, 0.08) * (0.6 + 1.2 * on), 0.35 + 0.65 * max(on, uLights));
  } else if (st > 3.5) { // signs / roof + balcony lamps
    float tw = 0.85 + 0.15 * sin(uTime * 2.1 + vWorld.z * 0.37);
    c = mix(c, vCol * (0.8 + 0.7 * vSt.y) * tw, uLights);
  } else if (st > 0.5) {
    vec3 n = normalize(cross(dFdx(vWorld), dFdy(vWorld)));
    if (abs(n.y) < 0.5) {
      float u = abs(n.x) > abs(n.z) ? vWorld.z : vWorld.x;
      float cw = st < 1.5 ? 1.7 : st < 2.5 ? 1.25 : 2.5;
      vec2 q = vec2(u / cw, vWorld.y / 3.3), cell = floor(q), f = fract(q);
      float m;
      if (st < 1.5) m = step(0.07, f.x) * step(f.x, 0.95) * step(0.12, f.y) * step(f.y, 0.94);
      else if (st < 2.5) m = step(0.36, f.y) * step(f.y, 0.8) * step(0.04, f.x);
      else m = step(0.3, f.x) * step(f.x, 0.72) * step(0.28, f.y) * step(f.y, 0.82);
      m *= step(0.8, vWorld.y);
      if (m > 0.5) {
        vec2 key = cell + vec2(vSt.y * 517.0, floor(vSt.y * 97.0));
        float a = h1(key), b2 = h1(key + 13.1), d = h1(key + 41.7);
        // day: dark glass with a sky reflection (glass towers brighter / bluer)
        vec3 day = mix(vec3(0.16, 0.2, 0.25), uSkyRefl * 0.75, (st < 1.5 ? 0.45 : 0.22) + 0.25 * f.y) * (0.55 + 0.6 * lit);
        float on = step(a, 0.1 + 0.55 * uLights);
        vec3 wc = b2 < 0.62 ? vec3(1.0, 0.76, 0.45) : b2 < 0.9 ? vec3(0.78, 0.88, 1.0) : vec3(0.45, 0.6, 1.0);
        if (d < 0.05) wc *= 0.6 + 0.4 * sin(uTime * (6.0 + d * 160.0) + a * 30.0);   // flicker / TV
        float glow = on * (0.06 + 0.94 * uLights) * (0.75 + 0.25 * h1(key + 7.7));
#ifdef PEOPLE
        if (on > 0.5 && d > 0.6) { // silhouette in a lit window: head + shoulders
          float px = 0.25 + 0.5 * h1(key + 3.3);
          vec2 hp = vec2((f.x - px) * cw, (f.y - (st < 2.5 ? 0.62 : 0.6)) * 3.3);
          float body = step(length(hp * vec2(1.0, 0.8)), 0.16) + step(abs(hp.x), 0.27) * step(hp.y, -0.2);
          glow *= 1.0 - 0.85 * clamp(body, 0.0, 1.0);
        }
#endif
        c = mix(day, wc * 1.25, clamp(glow, 0.0, 1.0));
      } else if (st < 1.5) c = vCol * lit * 0.8; // mullions
    }
  }
  gl_FragColor = vec4(c, 1.0);
  #include <fog_fragment>
}`;

export class Skyline {
  constructor(scene) { this.scene = scene; this.level = -1; this.mesh = null; this.halo = null; this.glowMat = glowMaterial(); this.stats = { tris: 0, halos: 0, inst: 0 }; }
  applyPreset(p) {
    const level = { LOW: 0, MEDIUM: 1, HIGH: 2, ULTRA: 3 }[p.name] ?? 2;
    if (level === this.level) return;
    this.level = level;
    if (this.mesh) { this.scene.remove(this.mesh); this.mesh.geometry.dispose(); this.scene.remove(this.halo); this.halo.geometry.dispose(); }
    const { g, halos } = skylineGeo(level);
    const mat = new THREE.ShaderMaterial({ fog: true, vertexColors: true, vertexShader: VERT, fragmentShader: FRAG, defines: level >= 2 ? { PEOPLE: '' } : {},
      uniforms: Object.assign({ fogColor: { value: new THREE.Color() }, fogNear: { value: 1 }, fogFar: { value: 1000 }, fogDensity: { value: 0 } },
        { uAmb: U.uAmb, uSun: U.uSun, uSkyRefl: U.uSkyRefl, uLights: U.uLights, uTime: U.uTime }) });
    this.mesh = new THREE.InstancedMesh(g, mat, 4); this.mesh.name = 'skyline'; this.mesh.frustumCulled = false; this.mesh.count = 0; this.mesh.renderOrder = 0;
    this.halo = new THREE.InstancedMesh(haloGeo(level ? halos : []), this.glowMat, 4); this.halo.name = 'skyline-halos'; this.halo.frustumCulled = false; this.halo.count = 0; this.halo.renderOrder = 7;
    this.scene.add(this.mesh); this.scene.add(this.halo);
    this.stats = { tris: g.userData.tris, halos: level ? halos.length : 0, inst: 0 };
    this.key = '';
  }
  update(camera) {
    if (!this.mesh) return;
    const cz = camera.position.z, far = camera.far;
    const k0 = Math.floor(-(cz + 60) / SKY_P), k1 = Math.floor(-(cz - far) / SKY_P);
    const key = k0 + ':' + k1;
    if (key !== this.key) {
      this.key = key; let n = 0; const m = new THREE.Matrix4();
      for (let k = Math.max(0, k0 - 0); k <= k1 && n < 4; k++) { m.makeTranslation(0, 0, -k * SKY_P); this.mesh.setMatrixAt(n, m); this.halo.setMatrixAt(n, m); n++; }
      if (k0 < 0) { /* start of the run: the band begins at z 0 (behind the start is empty sand / city) */ }
      this.mesh.count = n; this.halo.count = n; this.mesh.instanceMatrix.needsUpdate = true; this.halo.instanceMatrix.needsUpdate = true;
      this.stats.inst = n;
    }
    this.halo.visible = this.stats.halos > 0 && U.uLights.value > 0.02;
  }
}
