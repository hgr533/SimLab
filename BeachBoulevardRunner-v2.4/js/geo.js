// Procedural mesh builder with baked lighting.
// Every vertex stores: albedo color, aLight = (sunFactor, ambientOcclusion, wetMask, mapWeight).
// sunFactor = max(0, N.L) * analytic shadow (palms, umbrellas) for ONE fixed sun direction.
// Weather only rescales ambient and sun at draw time; no runtime lights, no shadow map.
import * as THREE from '../vendor/three.module.js';
import { SUN_DIR } from './config.js';

const S = new THREE.Vector3(...SUN_DIR).normalize();
const SH_X = S.x / S.y, SH_Z = S.z / S.y; // horizontal shift per meter of height toward the sun

const _m = new THREE.Matrix4();
const _v = new THREE.Vector3();
const _a = new THREE.Vector3(), _b = new THREE.Vector3(), _c = new THREE.Vector3();
const _n = new THREE.Vector3();

function segDist2(px, pz, ax, az, bx, bz) {
  const abx = bx - ax, abz = bz - az;
  const l2 = abx * abx + abz * abz;
  let t = l2 > 0 ? ((px - ax) * abx + (pz - az) * abz) / l2 : 0;
  t = t < 0 ? 0 : t > 1 ? 1 : t;
  const dx = px - (ax + abx * t), dz = pz - (az + abz * t);
  return dx * dx + dz * dz;
}
function sstep(a, b, x) { const t = Math.min(1, Math.max(0, (x - a) / (b - a))); return t * t * (3 - 2 * t); }

export class Builder {
  constructor(opts = {}) {
    this.pos = []; this.col = []; this.lit = []; this.uvs = [];
    // v2.2: per-vertex sway / bob weight (aSway). swayFn(p) -> weight overrides the constant.
    this.sways = []; this.sway = 0; this.swayFn = null;
    this.rigOn = !!opts.rig; this.tintOn = !!opts.tint;
    this.rigs = []; this.tints = [];
    this.rig = [0, 0, 0]; this.tint = 0;
    this.mat = new THREE.Matrix4();
    this.stack = [];
    this.casters = [];      // shadow casters (local space)
    this.shadowed = false;  // apply caster shadows to the next primitives
    this.ao = 1; this.wet = 0; this.mapW = 0;
    this.uvMode = null;     // null | 'xz' world-plane uv
    this.uvScale = 0.5;
    this.sunBoost = 1;
  }
  push() { this.stack.push(this.mat.clone()); return this; }
  pop() { this.mat.copy(this.stack.pop()); return this; }
  translate(x, y, z) { this.mat.multiply(_m.makeTranslation(x, y, z)); return this; }
  rotY(a) { this.mat.multiply(_m.makeRotationY(a)); return this; }
  rotX(a) { this.mat.multiply(_m.makeRotationX(a)); return this; }
  rotZ(a) { this.mat.multiply(_m.makeRotationZ(a)); return this; }
  scale(x, y, z) { this.mat.multiply(_m.makeScale(x, y, z)); return this; }

  addTrunk(x, z, h, r) { this.casters.push({ t: 0, x, z, h, r }); }
  addDisk(x, y, z, r, star) { this.casters.push({ t: 1, x, y, z, r, star: star || 0 }); }

  shadowAt(px, py, pz) {
    let f = 1;
    for (let i = 0; i < this.casters.length; i++) {
      const c = this.casters[i];
      if (c.t === 0) {
        if (c.h <= py) continue;
        const dh = c.h - py;
        const d2 = segDist2(c.x, c.z, px, pz, px + SH_X * dh, pz + SH_Z * dh);
        const d = Math.sqrt(d2);
        f *= 1 - 0.85 * (1 - sstep(c.r * 0.5, c.r * 1.7, d));
      } else {
        if (c.y <= py) continue;
        const dh = c.y - py;
        const qx = px + SH_X * dh - c.x, qz = pz + SH_Z * dh - c.z;
        const d = Math.sqrt(qx * qx + qz * qz);
        let r = c.r;
        if (c.star) r *= 0.72 + 0.32 * Math.cos(Math.atan2(qz, qx) * c.star);
        f *= 1 - 0.82 * (1 - sstep(r * 0.72, r * 1.06, d));
      }
      if (f < 0.05) break;
    }
    return f;
  }

  // Emit one triangle; points are local (pre-matrix) arrays [x,y,z]; colors [r,g,b] per vertex or shared.
  tri(p0, p1, p2, c0, c1, c2) {
    _a.set(p0[0], p0[1], p0[2]).applyMatrix4(this.mat);
    _b.set(p1[0], p1[1], p1[2]).applyMatrix4(this.mat);
    _c.set(p2[0], p2[1], p2[2]).applyMatrix4(this.mat);
    // CCW front: normal = (b-a)x(c-a)
    _n.subVectors(_b, _a).cross(_v.subVectors(_c, _a)).normalize();
    const ndl = Math.max(0, _n.dot(S));
    const amb = 0.72 + 0.28 * (_n.y * 0.5 + 0.5);
    const pts = [_a, _b, _c], cols = [c0, c1 || c0, c2 || c0];
    for (let k = 0; k < 3; k++) {
      const p = pts[k], c = cols[k];
      this.pos.push(p.x, p.y, p.z);
      this.col.push(c[0], c[1], c[2]);
      let sun = ndl * this.sunBoost;
      if (this.shadowed && sun > 0) sun *= this.shadowAt(p.x, p.y, p.z);
      this.lit.push(sun, this.ao * amb, this.wet, this.mapW);
      if (this.uvMode === 'xz') this.uvs.push(p.x * this.uvScale, p.z * this.uvScale);
      else this.uvs.push(0, 0);
      if (this.rigOn) this.rigs.push(this.rig[0], this.rig[1], this.rig[2]);
      if (this.tintOn) this.tints.push(this.tint);
      this.sways.push(this.swayFn ? this.swayFn(p) : this.sway);
    }
  }
  quad(p0, p1, p2, p3, c, c2) { this.tri(p0, p1, p2, c, c2 && c2[0], c2 && c2[1]); this.tri(p0, p2, p3, c, c2 && c2[1], c2 && c2[2]); }

  // Axis-aligned box (local), center x,z and bottom y0. skipBottom saves 2 tris.
  box(cx, y0, cz, sx, sy, sz, c, opt = {}) {
    const x0 = cx - sx / 2, x1 = cx + sx / 2, z0 = cz - sz / 2, z1 = cz + sz / 2, y1 = y0 + sy;
    const top = opt.top || c;
    this.quad([x0, y1, z1], [x1, y1, z1], [x1, y1, z0], [x0, y1, z0], top);           // top
    this.quad([x0, y0, z1], [x1, y0, z1], [x1, y1, z1], [x0, y1, z1], c);             // +z
    this.quad([x1, y0, z0], [x0, y0, z0], [x0, y1, z0], [x1, y1, z0], c);             // -z
    this.quad([x1, y0, z1], [x1, y0, z0], [x1, y1, z0], [x1, y1, z1], c);             // +x
    this.quad([x0, y0, z0], [x0, y0, z1], [x0, y1, z1], [x0, y1, z0], c);             // -x
    if (!opt.skipBottom) this.quad([x0, y0, z0], [x1, y0, z0], [x1, y0, z1], [x0, y0, z1], c);
  }
  // Cylinder / frustum along +y from y0, n sides, optional top cap.
  cyl(cx, y0, cz, r0, r1, h, n, c, opt = {}) {
    const top = opt.top || c;
    for (let i = 0; i < n; i++) {
      const a0 = (i / n) * Math.PI * 2, a1 = ((i + 1) / n) * Math.PI * 2;
      const s0 = Math.sin(a0), c0 = Math.cos(a0), s1 = Math.sin(a1), c1 = Math.cos(a1);
      this.quad([cx + s0 * r0, y0, cz + c0 * r0], [cx + s1 * r0, y0, cz + c1 * r0],
        [cx + s1 * r1, y0 + h, cz + c1 * r1], [cx + s0 * r1, y0 + h, cz + c0 * r1], c);
      if (opt.cap !== false && r1 > 0.001) this.tri([cx, y0 + h, cz], [cx + s0 * r1, y0 + h, cz + c0 * r1], [cx + s1 * r1, y0 + h, cz + c1 * r1], top);
    }
  }
  // Closed umbrella / canopy: top cone + underside (single-sided, no DoubleSide needed).
  canopy(cx, y, cz, r, h, n, cTop, cUnder) {
    for (let i = 0; i < n; i++) {
      const a0 = (i / n) * Math.PI * 2, a1 = ((i + 1) / n) * Math.PI * 2;
      const p0 = [cx + Math.sin(a0) * r, y, cz + Math.cos(a0) * r];
      const p1 = [cx + Math.sin(a1) * r, y, cz + Math.cos(a1) * r];
      const cc = (i % 2) ? cTop : (cTop.alt || cTop);
      this.tri([cx, y + h, cz], p0, p1, cc);
      this.tri([cx, y + h * 0.55, cz], p1, p0, cUnder);
    }
  }
  // Ground grid in local xz at height fn(x,z); colorFn(x,z) -> [r,g,b].
  grid(x0, x1, z0, z1, nx, nz, colorFn, heightFn) {
    const dx = (x1 - x0) / nx, dz = (z1 - z0) / nz;
    const H = heightFn || (() => 0);
    for (let i = 0; i < nx; i++) for (let j = 0; j < nz; j++) {
      const ax = x0 + i * dx, bx = ax + dx, az = z0 + j * dz, bz = az + dz;
      const p00 = [ax, H(ax, az), az], p10 = [bx, H(bx, az), az], p11 = [bx, H(bx, bz), bz], p01 = [ax, H(ax, bz), bz];
      const c00 = colorFn(ax, az), c10 = colorFn(bx, az), c11 = colorFn(bx, bz), c01 = colorFn(ax, bz);
      this.tri(p00, p01, p11, c00, c01, c11);
      this.tri(p00, p11, p10, c00, c11, c10);
    }
  }

  build() {
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.Float32BufferAttribute(this.pos, 3));
    g.setAttribute('color', new THREE.Float32BufferAttribute(this.col, 3));
    g.setAttribute('aLight', new THREE.Float32BufferAttribute(this.lit, 4));
    g.setAttribute('uv', new THREE.Float32BufferAttribute(this.uvs, 2));
    g.setAttribute('aSway', new THREE.Float32BufferAttribute(this.sways, 1));
    if (this.rigOn) g.setAttribute('aRig', new THREE.Float32BufferAttribute(this.rigs, 3));
    if (this.tintOn) g.setAttribute('aTint', new THREE.Float32BufferAttribute(this.tints, 1));
    g.computeBoundingSphere();
    g.computeBoundingBox();
    return g;
  }
  get triCount() { return this.pos.length / 9; }
}

export function hex(h) { return [((h >> 16) & 255) / 255, ((h >> 8) & 255) / 255, (h & 255) / 255]; }
export function mul(c, k) { return [c[0] * k, c[1] * k, c[2] * k]; }
export function mix3(a, b, t) { return [a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t, a[2] + (b[2] - a[2]) * t]; }
