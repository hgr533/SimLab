// v2.5.27 balloon people. Every 13 s of sim time (sim.t, frozen while paused) a walker who has just come into view
// ahead of the runner turns out to be carrying a bunch of 1-12 helium balloons (some are kids, smaller figure).
// Carriers are ordinary crowd people (free will, gatherings, collisions all unchanged - they are normal obstacles);
// the balloons themselves are render-only with their own seeded RNG, so the sim / determinism hash is untouched.
// Sizes small / medium / large + long (sausage) balloons, colours from a wide palette, thin strings converging to
// the hand, bob + sway from ws.p.wind and windGust (more in SEA SPRAY). Rare: one slips away and floats up.
// Running through a carrier pops a balloon (sound on the Balloons channel). RAIN: no new carriers, carriers'
// balloons are packed away (hidden) while it rains. 2 draws (balloons, strings). LOW: up to 5 per bunch.
import * as THREE from '../vendor/three.module.js';
import { makeRng } from './rng.js';
import { U } from './materials.js';
import { windGust } from './config.js';

export const BALLOON_EVERY = 13;
const PAL = [0xff1744, 0xff5252, 0xff9100, 0xffc400, 0xffea00, 0xc6ff00, 0x00e676, 0x1de9b6, 0x00e5ff, 0x2979ff,
  0x3d5afe, 0x651fff, 0xd500f9, 0xf50057, 0xff80ab, 0xffffff, 0xb0bec5, 0xffd700, 0xc0c0c0, 0x8d6e63, 0x212121, 0x76ff03];
const SIZES = [0.17, 0.24, 0.32]; // radius (m)
const MAXB = 120;
const VERT = `attribute vec3 aCol; uniform vec3 uAmb; uniform vec3 uSun; varying vec3 vC; varying vec3 vN; varying vec3 vV;
#include <fog_pars_vertex>
void main() { vec4 wp = modelMatrix * instanceMatrix * vec4(position, 1.0); vec4 mvPosition = viewMatrix * wp;
  vN = normalize(mat3(viewMatrix) * mat3(modelMatrix) * mat3(instanceMatrix) * normal); vV = normalize(-mvPosition.xyz);
  vC = aCol * max(vec3(0.5), uAmb * 0.9 + uSun * 0.6); gl_Position = projectionMatrix * mvPosition;
  #include <fog_vertex>
}`;
const FRAG = `varying vec3 vC; varying vec3 vN; varying vec3 vV;
#include <fog_pars_fragment>
void main() { vec3 n = normalize(vN); float r = max(0.0, dot(n, normalize(vec3(-0.4, 0.6, 0.7))));
  float hl = pow(r, 28.0) * 0.85 + pow(1.0 - max(0.0, dot(n, vV)), 3.0) * 0.18; // fake gloss + rim (no lights)
  gl_FragColor = vec4(min(vC * (0.75 + 0.35 * r) + vec3(hl), vec3(1.0)), 1.0);
#include <fog_fragment>
}`;
export class Balloons {
  constructor(scene) {
    this.scene = scene; this.enabled = true; this.rng = makeRng(0x0ba11007); this.carriers = []; this.free = []; this.shreds = []; this.limp = [];
    this.next = BALLOON_EVERY; this.log = []; this.stats = { carriers: 0, balloons: 0, spawned: 0, popped: 0, slipped: 0, skippedRain: 0 };
    this.onPop = null; this.onSqueak = null; this._o = new THREE.Object3D(); this.lo = false; this.lastT = 0;
  }
  applyPreset(p) {
    this.lo = p.name === 'LOW'; this.maxN = this.lo ? 5 : 12;
    if (this.mesh) { this.mesh.geometry.dispose(); this.mesh.geometry = this._geo(); return; }
    const mat = new THREE.ShaderMaterial({ fog: true, vertexShader: VERT, fragmentShader: FRAG,
      uniforms: { fogColor: { value: new THREE.Color() }, fogNear: { value: 1 }, fogFar: { value: 1000 }, fogDensity: { value: 0 }, uAmb: U.uAmb, uSun: U.uSun } });
    this.aCol = new THREE.InstancedBufferAttribute(new Float32Array(MAXB * 3), 3);
    const g = this._geo();
    this.mesh = new THREE.InstancedMesh(g, mat, MAXB); this.mesh.name = 'balloons'; this.mesh.frustumCulled = false; this.mesh.count = 0; this.mesh.visible = false;
    this.scene.add(this.mesh);
    const lg = new THREE.BufferGeometry(); lg.setAttribute('position', new THREE.BufferAttribute(new Float32Array(MAXB * 6), 3));
    this.line = new THREE.LineSegments(lg, new THREE.LineBasicMaterial({ color: 0xeeeeee, transparent: true, opacity: 0.55, fog: true }));
    this.line.name = 'balloon-strings'; this.line.frustumCulled = false; this.line.visible = false; this.scene.add(this.line);
  }
  _geo() { const g = new THREE.IcosahedronGeometry(1, this.lo ? 1 : 2); g.setAttribute('aCol', this.aCol); return g; }
  reset() { for (const c of this.carriers) { const a = c.a; if (a) a._bk = 0; } this.carriers.length = 0; this.free.length = 0; this.shreds.length = 0; this.limp.length = 0; this.next = BALLOON_EVERY; this.log.length = 0; }
  _bunch(kid) {
    const r = this.rng, n = Math.min(this.maxN, r.chance(0.12) ? r.int(8, 12) : r.chance(0.35) ? 1 : r.int(2, 7));
    const mono = r.chance(0.2) ? r.pick(PAL) : -1, bs = [];
    for (let i = 0; i < n; i++) {
      const long = !this.lo && r.chance(0.1), sz = long ? 1 : r.int(0, kid ? 1 : 2), rad = SIZES[sz] * (kid ? 0.9 : 1);
      const ang = i * 2.39996 + r.range(0, 0.4), ring = n === 1 ? 0 : 0.18 + 0.22 * Math.sqrt(i / n);
      bs.push({ col: mono >= 0 && r.chance(0.8) ? mono : r.pick(PAL), sz: long ? 'long' : ['S', 'M', 'L'][sz], rad, long,
        ox: Math.cos(ang) * ring * (1 + rad), oz: Math.sin(ang) * ring * (1 + rad), len: r.range(1.05, 1.5) * (kid ? 0.8 : 1) + (n > 6 ? r.range(0, 0.35) : 0), ph: r.range(0, 6.28) });
    }
    return bs;
  }
  _burst(c, q, x, y, z, t, hx, hy, hz) { // v2.5.27 pop: shreds fall, string goes limp, carrier flinches
    this.stats.popped++; for (let k = 0; k < (this.lo ? 4 : 7); k++) this.shreds.push({ x, y, z, vx: this.rng.range(-1.6, 1.6), vy: this.rng.range(0.2, 2.2), vz: this.rng.range(-1.6, 1.6), col: q.col, t0: t, r: this.rng.range(0.06, 0.1) });
    this.limp.push({ c, ox: q.ox * 0.3, len: q.len * 0.55, t0: t }); c.a._fl = 1; c.flT = t;
    if (this.onPop) this.onPop(x, y, z, c.kid ? (this.rng.chance(0.5) ? 'cry' : 'laugh') : '');
    this.lastPop = { t, x, y, z };
    if (this._P) { let ng = 0; for (const a of this._P) { if (!a.active || a === c.a) continue; const d = Math.hypot(a.x - x, a.z - z); if (d < 10) { a._gl = { x, z, t: t + Math.min(0.35, d * 0.03) }; ng++; } } this.stats.glances = (this.stats.glances || 0) + ng; this.lastPop.glances = ng; } // v2.5.28 heads turn
  }
  update(sim, camera, alpha) {
    if (!this.mesh) return;
    this._P = sim.ai.people;
    const t = sim.t, P = sim.ai.people, rain = (sim.ws.p.rain || 0) > 0.35, R = sim.r, rz = R.z;
    if (t < this.lastT - 1) this.reset(); this.lastT = t;
    if (sim.state === 'run' && t >= this.next) {
      this.next += BALLOON_EVERY;
      if (!this.enabled) {} else if (rain) this.stats.skippedRain++;
      else {
        // pick a walker coming into view ahead (40-110 m), not already carrying, prefer not mid-gathering
        let best = null, bs = -1;
        for (const a of P) { if (!a.active || a._bk || a.z > rz - 35 || a.z < rz - 120) continue; const s = this.rng.next() + (a.gatIn ? -0.5 : 0) + (a.bch === 2 ? -0.2 : 0); if (s > bs) { bs = s; best = a; } }
        if (best) {
          const kid = this.rng.chance(0.35), c = { a: best, kid, b: this._bunch(kid), t0: t, slip: this.rng.chance(0.18) ? t + this.rng.range(4, 12) : -1, pop: t + this.rng.range(15, 60) };
          best._bk = kid ? 0.68 : 1; this.carriers.push(c); this.stats.spawned++;
          if (this.log.length < 400) this.log.push({ t: +t.toFixed(2), kid, n: c.b.length, sizes: c.b.map((q) => q.sz).join(''), colors: c.b.map((q) => '#' + q.col.toString(16).padStart(6, '0')) });
        }
      }
    }
    // v2.5.27 bought balloons: buyers of the roaming sellers become carriers (1-3 balloons, same sway / pops)
    for (const a of P) if (a.active && a._buyBal && !a._bk && !rain) { const b = this._bunch(false).slice(0, a._buyBal); while (b.length < a._buyBal) b.push(...this._bunch(false).slice(0, 1)); a._bk = 1; a._buyBal = 0;
      this.carriers.push({ a, kid: false, b, t0: t, slip: -1, pop: t + this.rng.range(20, 60), bought: true }); this.stats.bought = (this.stats.bought || 0) + 1; }
    const o = this._o, lp = this.line.geometry.attributes.position, wind = sim.ws.p.wind || 0, ca = this.aCol.array;
    let n = 0;
    const put = (x, y, z, sx, sy, col, hx, hy, hz) => { if (n >= MAXB) return; o.position.set(x, y, z); o.scale.set(sx, sy, sx); o.updateMatrix(); this.mesh.setMatrixAt(n, o.matrix);
      ca[n * 3] = ((col >> 16) & 255) / 255; ca[n * 3 + 1] = ((col >> 8) & 255) / 255; ca[n * 3 + 2] = (col & 255) / 255;
      if (hx !== undefined) { lp.setXYZ(n * 2, hx, hy, hz); lp.setXYZ(n * 2 + 1, x, y - sy, z); } else { lp.setXYZ(n * 2, x, y - sy, z); lp.setXYZ(n * 2 + 1, x, y - sy - 0.9, z); }
      n++; };
    for (let ci = this.carriers.length - 1; ci >= 0; ci--) {
      const c = this.carriers[ci], a = c.a;
      if (!a.active || a.z > rz + 30 || (!c.b.length && !this.limp.some((L) => L.c === c)) || !a._bk) { a._bk = 0; this.carriers.splice(ci, 1); continue; }
      if (rain) continue; // packed away while it rains
      const s = a.scale * a._bk, ax = a.px + (a.x - a.px) * alpha, az = a.pz + (a.z - a.pz) * alpha, ay = a.y || 0;
      const oh = (a.hd !== undefined ? a.hd : (a.dir > 0 ? Math.PI : 0));
      const hx = ax + Math.cos(oh) * 0.27 * s, hz = az - Math.sin(oh) * 0.27 * s, hy = ay + 1.05 * s;
      // runner contact: pop one
      if (sim.state === 'run' && Math.abs(R.x - ax) < 0.75 && Math.abs(rz - az) < 0.75 && !c.hit) { c.hit = true; const q = c.b.pop(); this._burst(c, q, hx + q.ox, hy + q.len, hz + q.oz, t); }
      if (t >= c.pop && c.b.length) { c.pop = t + this.rng.range(20, 60); const q = c.b.splice(this.rng.int(0, c.b.length - 1), 1)[0]; this._burst(c, q, hx + q.ox, hy + q.len, hz + q.oz, t); }
      if (a._fl) a._fl = Math.max(0, 1 - (t - c.flT) / 1.2);
      c.hx = hx; c.hy = hy; c.hz = hz;
      if (c.slip > 0 && t >= c.slip && c.b.length > 1) { c.slip = -1; const q = c.b.splice(this.rng.int(0, c.b.length - 1), 1)[0]; this.stats.slipped++; this.free.push({ q, x: hx + q.ox, y: hy + q.len, z: hz + q.oz, t0: t }); if (this.onSqueak) this.onSqueak(hx, hz); }
      const g = windGust(az, t), wx = (0.12 + wind * 0.5) * (0.6 + 0.4 * g);
      for (const q of c.b) {
        const sw = Math.sin(t * 1.3 + q.ph) * (0.06 + wind * 0.12) + wx, bob = Math.sin(t * 2.1 + q.ph * 1.7) * 0.04;
        const bx = hx + q.ox + sw * q.len * 0.6, bz = hz + q.oz - wx * q.len * 0.7 + Math.cos(t * 1.1 + q.ph) * 0.05, by = hy + q.len + bob;
        if (q.long) put(bx, by + 0.25, bz, 0.09, 0.42, q.col, hx, hy, hz); else put(bx, by + q.rad * 1.15, bz, q.rad, q.rad * 1.18, q.col, hx, hy, hz);
      }
    }
    if (!rain) for (const v of sim.ai.vend || []) { if (!v.bal || Math.abs(v.z - rz) > 150) continue; // seller's big multicolour bunch
      const B = v._bunch || (v._bunch = Array.from({ length: this.lo ? 8 : 18 }, (_, i) => ({ col: PAL[(i * 5 + v.id) % PAL.length], rad: SIZES[i % 3], ox: Math.cos(i * 2.4) * (0.25 + 0.5 * Math.sqrt(i / 18)), oz: Math.sin(i * 2.4) * (0.25 + 0.5 * Math.sqrt(i / 18)), len: 1.3 + (i % 4) * 0.18, ph: i * 1.3 })));
      const oh = v._hd || 0, hx = v.x + Math.cos(oh) * 0.27, hz = v.z - Math.sin(oh) * 0.27, hy = (v._y || 0) + 1.15, wx = 0.12 + wind * 0.5;
      for (const q of B) { const sw = Math.sin(t * 1.3 + q.ph) * (0.06 + wind * 0.12) + wx; put(hx + q.ox + sw * q.len * 0.6, hy + q.len + q.rad * 1.15 + Math.sin(t * 2.1 + q.ph) * 0.04, hz + q.oz - wx * q.len * 0.7, q.rad, q.rad * 1.18, q.col, hx, hy, hz); } }
    for (let i = this.free.length - 1; i >= 0; i--) { const f = this.free[i], dt = t - f.t0; if (dt > 14 || dt < 0) { this.free.splice(i, 1); continue; }
      const q = f.q; put(f.x + dt * (0.4 + wind * 0.8), f.y + dt * 1.1 + q.rad, f.z - dt * 0.3 + Math.sin(dt * 1.7) * 0.2, q.long ? 0.09 : q.rad, q.long ? 0.42 : q.rad * 1.18, q.col); }
    for (let i = this.shreds.length - 1; i >= 0; i--) { const f = this.shreds[i], d = t - f.t0; if (d > 2.2 || d < 0) { this.shreds.splice(i, 1); continue; }
      const y = Math.max(0.02, f.y + f.vy * d - 1.2 * d * d); put(f.x + f.vx * d * 0.6, y, f.z + f.vz * d * 0.6, f.r, f.r * 0.35, f.col); }
    for (let i = this.limp.length - 1; i >= 0; i--) { const L = this.limp[i], d = t - L.t0, c = L.c; if (d > 2.5 || d < 0 || !c.a.active || c.hx === undefined || n >= MAXB) { this.limp.splice(i, 1); continue; }
      const sx = Math.sin(d * 5) * 0.08 * (1 - d / 2.5); lp.setXYZ(n * 2, c.hx, c.hy, c.hz); lp.setXYZ(n * 2 + 1, c.hx + L.ox + sx, c.hy + L.len * (1 - d / 2.5) * 0.4 - 0.15, c.hz); o.position.set(0, -50, 0); o.scale.setScalar(0.001); o.updateMatrix(); this.mesh.setMatrixAt(n, o.matrix); n++; }
    this.mesh.count = n; this.line.geometry.setDrawRange(0, n * 2); this.mesh.visible = this.line.visible = n > 0;
    if (n) { this.mesh.instanceMatrix.needsUpdate = true; this.aCol.needsUpdate = true; lp.needsUpdate = true; }
    this.stats.carriers = this.carriers.length; this.stats.balloons = n;
    this.live = rain ? [] : this.carriers.map((c) => ({ x: c.a.x, z: c.a.z, n: c.b.length }));
  }
}
