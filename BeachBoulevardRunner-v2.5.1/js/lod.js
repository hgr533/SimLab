// v2.5 level of detail for instanced things (crowd, dogs, decor figures, cyclists, umbrellas,
// benches). One InstancedMesh per tier per type: 0 = near (detailed), 1 = mid (the v2.4 model),
// 2 = far (very cheap shape). The game writes each instance once into a source array; every
// frame update() picks a tier per instance from its distance to the camera, with hysteresis
// (no flicker on the threshold), a budget for the near tier (only the N nearest get it) and an
// optional short screen-door cross-fade, then packs the instances of each tier tightly so
// hidden instances cost nothing (mesh.count = what is shown). Render side only: no sim RNG.
import * as THREE from '../vendor/three.module.js';

export const NEAR = 0, MID = 1, FAR = 2;
const _c = new THREE.Color();

export class TieredSet {
  // tiers: [near, mid, far] entries { geo, mat } or null; attrs: { aAnim: 4, aVar: 4 } per instance
  constructor(scene, { cap, tiers, attrs = {}, color = true, renderOrder = 0, name = '' }) {
    this.scene = scene; this.cap = cap; this.name = name; this.attrNames = Object.keys(attrs);
    this.attrSize = attrs;
    this.src = new Float32Array(cap * 16);
    this.col = new Float32Array(cap * 3).fill(1);
    this.att = {}; for (const k of this.attrNames) this.att[k] = new Float32Array(cap * attrs[k]);
    this.active = new Uint8Array(cap);
    this.lvl = new Int8Array(cap).fill(-1);  // current tier
    this.prev = new Int8Array(cap).fill(-1); // tier we are fading out of
    this.ft = new Float32Array(cap).fill(1); // fade progress 0..1
    this.dist = new Float32Array(cap);
    this.n = 0; // highest active index + 1
    this.lastSw = new Float32Array(cap).fill(-9); this.lastFrom = new Int8Array(cap).fill(-1);
    this.clock = 0; this.switches = 0; this.flips = 0; // flips = back to the previous tier within 0.6 s (should stay ~0)
    this.tiers = tiers.map((t, i) => {
      if (!t) return null;
      const g = t.geo, out = { mesh: null, attrs: {}, fade: null, count: 0 };
      for (const k of this.attrNames) { const a = new THREE.InstancedBufferAttribute(new Float32Array(cap * attrs[k]), attrs[k]); a.setUsage(THREE.DynamicDrawUsage); g.setAttribute(k, a); out.attrs[k] = a; }
      out.fade = new THREE.InstancedBufferAttribute(new Float32Array(cap), 1); out.fade.setUsage(THREE.DynamicDrawUsage); g.setAttribute('aFade', out.fade);
      const m = new THREE.InstancedMesh(g, t.mat, cap);
      m.frustumCulled = false; m.renderOrder = renderOrder; m.count = 0; m.visible = false;
      m.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
      if (color) { m.setColorAt(0, _c.setRGB(1, 1, 1)); m.instanceColor.setUsage(THREE.DynamicDrawUsage); }
      m.name = name + ':' + ['near', 'mid', 'far'][i];
      scene.add(m); out.mesh = m;
      return out;
    });
    this.cfg = { near: 0, nearMax: 0, far: 1e9, hyst: 0.12, fade: 0 };
    this.stats = [0, 0, 0];
  }
  dispose() { for (const t of this.tiers) if (t) { this.scene.remove(t.mesh); t.mesh.dispose(); } }
  // matrix: THREE.Matrix4 (or Float32Array-like of 16); color: THREE.Color or null; attrs { aAnim: [..] }
  set(i, matrix, color, attrs) {
    if (!this.active[i]) this.lastFrom[i] = -1;
    this.src.set(matrix.elements || matrix, i * 16);
    if (color) { this.col[i * 3] = color.r; this.col[i * 3 + 1] = color.g; this.col[i * 3 + 2] = color.b; }
    if (attrs) for (const k in attrs) { const v = attrs[k], s = this.attrSize[k]; for (let j = 0; j < s; j++) this.att[k][i * s + j] = v[j] || 0; }
    if (!this.active[i]) { this.active[i] = 1; this.lvl[i] = -1; this.prev[i] = -1; this.ft[i] = 1; }
    if (i >= this.n) this.n = i + 1;
  }
  setAttr(i, k, a, b, c, d) { const s = this.attrSize[k], o = i * s, A = this.att[k]; A[o] = a; if (s > 1) A[o + 1] = b; if (s > 2) A[o + 2] = c; if (s > 3) A[o + 3] = d; }
  setColor(i, color) { this.col[i * 3] = color.r; this.col[i * 3 + 1] = color.g; this.col[i * 3 + 2] = color.b; }
  hide(i) { this.active[i] = 0; this.lvl[i] = -1; this.prev[i] = -1; }
  hideAll() { this.active.fill(0); this.lvl.fill(-1); this.prev.fill(-1); this.n = 0; }
  // cfg: { near, nearMax, far, hyst, fade (seconds, 0 = hard switch) }
  configure(cfg) { Object.assign(this.cfg, cfg); }
  has(t) { return !!this.tiers[t]; }
  update(cx, cz, dt) {
    const c = this.cfg, h = c.hyst, n = this.n;
    const hasN = this.tiers[0] && c.near > 0 && c.nearMax > 0, hasF = !!this.tiers[2] && c.far < 1e8;
    const midT = this.tiers[1] ? 1 : (this.tiers[2] ? 2 : 0);
    // 1) wanted tier per instance, with hysteresis bands around each threshold
    let nearCand = 0;
    const want = this._want || (this._want = new Int8Array(this.cap));
    while (this.n > 0 && !this.active[this.n - 1]) this.n--;
    for (let i = 0; i < n; i++) {
      if (!this.active[i]) { want[i] = -1; continue; }
      const dx = this.src[i * 16 + 12] - cx, dz = this.src[i * 16 + 14] - cz;
      const d = Math.sqrt(dx * dx + dz * dz); this.dist[i] = d;
      const cur = this.lvl[i];
      let w = midT;
      if (hasN && d < c.near * (cur === 0 ? 1 + h : 1 - h)) { w = 0; nearCand++; }
      else if (hasF && d > c.far * (cur === 2 ? 1 - h : 1 + h)) w = 2;
      want[i] = w;
    }
    // 2) near budget: keep the nearest (current near ones get a small bonus = hysteresis)
    if (nearCand > c.nearMax) {
      const list = this._list || (this._list = []); list.length = 0;
      for (let i = 0; i < n; i++) if (want[i] === 0) list.push(i);
      const bonus = c.near * h;
      list.sort((a, b) => (this.dist[a] - (this.lvl[a] === 0 ? bonus : 0)) - (this.dist[b] - (this.lvl[b] === 0 ? bonus : 0)));
      for (let k = c.nearMax; k < list.length; k++) want[list[k]] = midT;
    }
    // 3) tier changes start a fade; pack every tier
    const fadeOn = c.fade > 0, step = fadeOn ? dt / c.fade : 1;
    this.clock += dt;
    const T = this.tiers;
    for (const t of T) if (t) t.count = 0;
    for (let i = 0; i < n; i++) {
      const w = want[i]; if (w < 0) continue;
      if (this.lvl[i] !== w) {
        if (this.lvl[i] >= 0) { this.switches++; if (w === this.lastFrom[i] && this.clock - this.lastSw[i] < 0.6) this.flips++; this.lastFrom[i] = this.lvl[i]; this.lastSw[i] = this.clock; }
        this.prev[i] = fadeOn && this.lvl[i] >= 0 ? this.lvl[i] : -1;
        this.ft[i] = this.prev[i] >= 0 ? 0 : 1;
        this.lvl[i] = w;
      } else if (this.ft[i] < 1) { this.ft[i] = Math.min(1, this.ft[i] + step); if (this.ft[i] >= 1) this.prev[i] = -1; }
      const f = this.ft[i];
      this.emit(T[w], i, f < 1 ? Math.max(0.02, f) : 0);
      if (f < 1 && this.prev[i] >= 0 && T[this.prev[i]]) this.emit(T[this.prev[i]], i, -f || -0.0001);
    }
    for (let k = 0; k < 3; k++) {
      const t = T[k]; this.stats[k] = t ? t.count : 0; if (!t) continue;
      const m = t.mesh; m.count = t.count; m.visible = t.count > 0;
      if (t.count > 0) {
        m.instanceMatrix.needsUpdate = true; if (m.instanceColor) m.instanceColor.needsUpdate = true;
        t.fade.needsUpdate = true; for (const a of Object.values(t.attrs)) a.needsUpdate = true;
      }
    }
  }
  emit(t, i, fade) {
    const k = t.count++, m = t.mesh;
    m.instanceMatrix.array.set(this.src.subarray(i * 16, i * 16 + 16), k * 16);
    if (m.instanceColor) { const a = m.instanceColor.array; a[k * 3] = this.col[i * 3]; a[k * 3 + 1] = this.col[i * 3 + 1]; a[k * 3 + 2] = this.col[i * 3 + 2]; }
    for (const name of this.attrNames) { const s = this.attrSize[name]; t.attrs[name].array.set(this.att[name].subarray(i * s, i * s + s), k * s); }
    t.fade.array[k] = fade;
  }
  tris() { let s = 0; for (const t of this.tiers) if (t) s += t.count * (t.mesh.geometry.attributes.position.count / 3); return s; }
}
