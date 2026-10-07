// v2.5.26 kite flyers on the sand (left side). Render-only, own seeded RNG (never the sim's, the hash is unchanged).
// Low-poly flyers (adults + kids) wander the beach, jog into the wind, stop and tug, holding a line up to a
// diamond / delta / box kite (random colours, tails) that sways and now and then loops with the wind, the gusts and
// the chaos drift (ws.p.wind already carries chaos.wind; windGust(z, t) * chaos.gust). How many are out follows
// the weather: most in SEA SPRAY (wind), some in GOLDEN / CLEAR HAZE / CLOUDY, none in RAIN (they reel in and walk
// off the beach as the rain starts, and come back after). Feet on places.groundY (the sand surface, as the dogs).
// 3 draws while any flyer is out (figures, kites, lines). LOW: fewer flyers, diamond kites only, no tails.
import * as THREE from '../vendor/three.module.js';
import { Builder, hex } from './geo.js';
import { makeRng } from './rng.js';
import { U } from './materials.js';
import { groundY } from './places.js';
import { windGust } from './config.js';

const WEATHER_SHARE = [0.45, 1.0, 0, 0.5, 0.35]; // GOLDEN, SEA SPRAY, RAIN, CLEAR HAZE, CLOUDY
const KCOL = [0xff3b30, 0xff9500, 0xffcc00, 0x34c759, 0x00c7be, 0x007aff, 0x5856d6, 0xaf52de, 0xff2d55, 0xffffff, 0x111111];
const SHIRT = [0xe8473c, 0x2f7fd8, 0xf2c14e, 0x3fae6b, 0xffffff, 0x8a5cd6, 0xff8a3d, 0x22313f];
const W = [1, 1, 1];

function figureGeo() {
  const b = new Builder({ rig: true }), skin = hex(0xc8946a), shorts = hex(0x2c3a4f), hair = hex(0x2a1d14);
  b.rig = [1, 0.85, 0]; b.box(-0.1, 0, 0, 0.13, 0.85, 0.15, skin);    // legs (swing about the hip)
  b.rig = [-1, 0.85, 0]; b.box(0.1, 0, 0, 0.13, 0.85, 0.15, skin);
  b.rig = [0, 0, 0];
  b.box(0, 0.62, 0, 0.36, 0.3, 0.22, shorts);
  b.rig = [3, 0, 0]; b.box(0, 0.9, 0, 0.4, 0.55, 0.24, W);              // shirt (instance colour)
  b.rig = [0, 0, 0];
  b.box(0, 1.47, 0, 0.21, 0.24, 0.22, skin); b.box(0, 1.66, 0.02, 0.23, 0.08, 0.24, hair);
  b.rig = [2, 1.4, 0]; // arms raised forward holding the line (pump in the shader)
  for (const s of [-1, 1]) { b.push(); b.translate(s * 0.24, 1.38, 0); b.rotX(1.1); b.box(0, -0.55, 0, 0.1, 0.55, 0.1, skin); b.pop(); }
  return b.build();
}
// kite types: aRig.x 1 diamond / 2 delta / 3 box / 4 tail (aRig.y = 0..1 along the tail); aRig.z 0 main, 1 second, 2 spar
function kiteGeo(lo) {
  const b = new Builder({ rig: true }), dark = hex(0x222222);
  const tri = (a, c, d, k, col) => { b.rig = [k, 0, col]; b.tri(a, c, d, W); };
  // diamond, nose up (+y), facing +z (the flyer); 1.0 x 1.4 m
  tri([0, 0.9, 0], [-0.5, 0.25, 0], [0, -0.5, 0], 1, 0); tri([0, 0.9, 0], [0, -0.5, 0], [0.5, 0.25, 0], 1, 1);
  if (!lo) {
    tri([0, 0.6, 0], [-1.0, -0.15, 0], [0, -0.35, 0], 2, 0); tri([0, 0.6, 0], [0, -0.35, 0], [1.0, -0.15, 0], 2, 1); // delta
    b.rig = [2, 0, 2]; b.limb(0, 0.6, -0.02, 0, -0.35, -0.02, 0.02, 0.02, 3, dark);
    // box kite: two open square cells
    for (const [y0, cc] of [[0.25, 0], [-0.55, 1]]) { b.rig = [3, 0, cc]; for (let k = 0; k < 4; k++) { const a0 = k * Math.PI / 2 + Math.PI / 4, a1 = a0 + Math.PI / 2, r = 0.32;
      const p0 = [Math.cos(a0) * r, y0, Math.sin(a0) * r], p1 = [Math.cos(a1) * r, y0, Math.sin(a1) * r];
      b.quad(p0, p1, [p1[0], y0 + 0.4, p1[2]], [p0[0], y0 + 0.4, p0[2]], W); } }
    b.rig = [3, 0, 2]; b.limb(0, -0.6, 0, 0, 0.7, 0, 0.02, 0.02, 3, dark);
    // tail: ribbon strip of 8 segments (waves in the shader), bows alternate colours
    for (let i = 0; i < 8; i++) { const y0 = -0.5 - i * 0.28, y1 = y0 - 0.28; b.rig = [4, i / 8, i % 2]; const t0 = i / 8, t1 = (i + 1) / 8;
      b.quad([-0.05, y0, 0], [0.05, y0, 0], [0.05, y1, 0], [-0.05, y1, 0], W); b.rigs.splice(b.rigs.length - 18, 18, ...[t0, t0, t1, t0, t1, t1].flatMap((t) => [4, t, i % 2])); }
  }
  b.rig = [1, 0, 2]; b.limb(0, 0.9, -0.02, 0, -0.5, -0.02, 0.018, 0.018, 3, dark);
  return b.build();
}

const FIG_VERT = `attribute vec3 aRig; attribute vec4 aLight; attribute vec3 aCol; attribute vec2 aAnim; uniform vec3 uAmb; uniform vec3 uSun;
varying vec3 vC;
#include <fog_pars_vertex>
void main() { vec3 p = position; float code = aRig.x;
  if (abs(code) > 0.5 && abs(code) < 1.5) { float a = sin(aAnim.x) * aAnim.y * sign(code); float c = cos(a), s = sin(a); float y = p.y - aRig.y; p.yz = vec2(aRig.y + y * c - p.z * s, y * s + p.z * c); }
  if (code > 1.5 && code < 2.5) { float a = sin(aAnim.x * 0.5) * 0.12 + (aAnim.y < 0.05 ? sin(aAnim.x * 2.0) * 0.25 : 0.0); float c = cos(a), s = sin(a); float y = p.y - aRig.y; p.yz = vec2(aRig.y + y * c - p.z * s, y * s + p.z * c); }
  vec3 col = color; if (code > 2.5) col *= aCol;
  vec4 mvPosition = viewMatrix * (modelMatrix * instanceMatrix * vec4(p, 1.0)); gl_Position = projectionMatrix * mvPosition;
  vC = col * max(vec3(0.45), uAmb * aLight.y + uSun * (0.35 + aLight.x * 0.7));
  #include <fog_vertex>
}`;
const KITE_VERT = `attribute vec3 aRig; attribute vec4 aLight; attribute vec3 aCol; attribute vec4 aCol2; uniform vec3 uAmb; uniform vec3 uSun; uniform float uTime;
varying vec3 vC;
#include <fog_pars_vertex>
void main() { vec3 p = position; float code = aRig.x, kind = aCol2.w;
  float keep = code > 3.5 ? step(0.5, fract(kind) * 2.0) : 1.0 - step(0.5, abs(code - floor(kind)));
  if (keep < 0.5) p = vec3(0.0);
  if (code > 3.5) { float t = aRig.y; p.x += sin(uTime * 7.0 - t * 9.0 + kind * 3.0) * 0.35 * t; p.z += cos(uTime * 5.0 - t * 7.0) * 0.25 * t; }
  vec3 col = aRig.z < 0.5 ? aCol : aRig.z < 1.5 ? aCol2.rgb : color;
  vec4 mvPosition = viewMatrix * (modelMatrix * instanceMatrix * vec4(p, 1.0)); gl_Position = projectionMatrix * mvPosition;
  vC = col * max(vec3(0.62), uAmb * 0.9 + uSun * 0.6);
  #include <fog_vertex>
}`;
const FRAG = `varying vec3 vC;
#include <fog_pars_fragment>
void main() { gl_FragColor = vec4(min(vC, vec3(1.0)), 1.0);
#ifdef USE_FOG
  gl_FragColor.rgb = mix(gl_FragColor.rgb, fogColor, smoothstep(fogNear, fogFar, vFogDepth) * 0.6);
#endif
}`;
const fogU = () => ({ fogColor: { value: new THREE.Color() }, fogNear: { value: 1 }, fogFar: { value: 1000 }, fogDensity: { value: 0 } });
const rgb = (h, a, i) => { a[i] = ((h >> 16) & 255) / 255; a[i + 1] = ((h >> 8) & 255) / 255; a[i + 2] = (h & 255) / 255; };

export class Kites {
  constructor(scene) {
    this.scene = scene; this.rng = makeRng(0x6b17e5); this.max = 12; this.lo = null; this.flyers = []; this.t = 0;
    this.stats = { out: 0, leaving: 0, target: 0, spawned: 0 }; this.maxDy = 0;
    this._o = new THREE.Object3D(); this._m = new THREE.Matrix4(); this._v = new THREE.Vector3(); this._u = new THREE.Vector3();
  }
  applyPreset(p) {
    const lo = p.name === 'LOW'; this.max = { LOW: 4, MEDIUM: 8, HIGH: 12, ULTRA: 16 }[p.name] || 12;
    if (lo === this.lo && this.fig) return;
    this.lo = lo;
    if (this.fig) for (const m of [this.fig, this.kite, this.line]) { this.scene.remove(m); m.geometry.dispose(); }
    const N = 16;
    const fg = figureGeo(); this.aFC = new THREE.InstancedBufferAttribute(new Float32Array(N * 3), 3); this.aFA = new THREE.InstancedBufferAttribute(new Float32Array(N * 2), 2);
    fg.setAttribute('aCol', this.aFC); fg.setAttribute('aAnim', this.aFA);
    this.fig = new THREE.InstancedMesh(fg, new THREE.ShaderMaterial({ fog: true, vertexColors: true, vertexShader: FIG_VERT, fragmentShader: FRAG, uniforms: Object.assign(fogU(), { uAmb: U.uAmb, uSun: U.uSun }) }), N);
    const kg = kiteGeo(lo); this.aK1 = new THREE.InstancedBufferAttribute(new Float32Array(N * 3), 3); this.aK2 = new THREE.InstancedBufferAttribute(new Float32Array(N * 4), 4);
    kg.setAttribute('aCol', this.aK1); kg.setAttribute('aCol2', this.aK2);
    this.kite = new THREE.InstancedMesh(kg, new THREE.ShaderMaterial({ fog: true, vertexColors: true, side: THREE.DoubleSide, vertexShader: KITE_VERT, fragmentShader: FRAG, uniforms: Object.assign(fogU(), { uAmb: U.uAmb, uSun: U.uSun, uTime: U.uTime }) }), N);
    const lg = new THREE.BufferGeometry(); lg.setAttribute('position', new THREE.BufferAttribute(new Float32Array(N * 4 * 3), 3).setUsage(THREE.DynamicDrawUsage));
    this.line = new THREE.LineSegments(lg, new THREE.LineBasicMaterial({ color: 0xf2f2f2, transparent: true, opacity: 0.75, fog: true }));
    for (const m of [this.fig, this.kite, this.line]) { m.frustumCulled = false; m.visible = false; this.scene.add(m); }
    this.fig.count = this.kite.count = 0;
  }
  spawn(camZ, near) {
    const r = this.rng, kid = r.chance(0.25);
    const f = { x: r.range(-40, -17), z: camZ - (near ? r.range(8, 95) : r.range(110, 170)), hd: r.range(0, 6.28), kid, scale: kid ? r.range(0.62, 0.75) : r.range(0.92, 1.08),
      mood: r.next(), state: 'wander', st: r.range(2, 6), v: 0, ph: r.range(0, 6.28), shirt: SHIRT[r.int(0, SHIRT.length - 1)],
      type: this.lo ? 1 : r.pick([1, 1, 2, 2, 3]), tail: !this.lo && r.chance(0.6), c1: KCOL[r.int(0, KCOL.length - 1)], c2: KCOL[r.int(0, KCOL.length - 1)],
      L: r.range(15, 27) * (kid ? 0.7 : 1), reel: near ? 1 : 0.2, kph: r.range(0, 6.28), loop: 0, leaving: false, y: 0 };
    if (f.c2 === f.c1) f.c2 = KCOL[(KCOL.indexOf(f.c1) + 4) % KCOL.length];
    f.y = groundY(f.x, f.z); this.flyers.push(f); this.stats.spawned++;
  }
  update(dt, sim, camera, on = true) {
    if (!this.fig) return;
    const r = this.rng, ws = sim.ws, camZ = camera.position.z;
    this.t += dt;
    const share = (WEATHER_SHARE[ws.prev] ?? 0) + ((WEATHER_SHARE[ws.idx] ?? 0) - (WEATHER_SHARE[ws.prev] ?? 0)) * Math.min(1, ws.k);
    const rain = (ws.p.rain || 0) > 0.25;
    const target = on && !rain ? Math.round(this.max * share) : 0;
    const wind = Math.max(0.15, ws.p.wind || 0.3), gust = Math.min(1.4, windGust(camZ, sim.t) * (sim.chaos ? sim.chaos.gust : 1));
    // retire / recycle
    for (let i = this.flyers.length - 1; i >= 0; i--) { const f = this.flyers[i]; if (f.z > camZ + 40 || f.z < camZ - 260 || (f.leaving && f.x > -7)) this.flyers.splice(i, 1); }
    let active = this.flyers.filter((f) => !f.leaving).length;
    if (active > target) for (const f of this.flyers) { if (active <= target) break; if (!f.leaving) { f.leaving = true; f.state = 'leave'; active--; } }
    if (dt > 0 && active < target && r.chance(dt * 1.5)) this.spawn(camZ, this.flyers.length === 0 && this.t < 3);
    if (dt > 0 && this.flyers.length === 0 && target > 0) for (let k = 0; k < target; k++) this.spawn(camZ, true);
    const o = this._o, lp = this.line.geometry.getAttribute('position');
    let n = 0, out = 0, leaving = 0, maxDy = 0; const live = [];
    for (const f of this.flyers) {
      if (n >= 16) break;
      // free will: wander / jog into the wind (toward the sea) / stop and tug; kids run more
      if (dt > 0) {
        f.st -= dt;
        if (f.state !== 'leave' && f.st <= 0) {
          const u = r.next(), run = f.kid ? 0.45 : 0.15 + 0.2 * f.mood;
          f.state = u < run ? 'jog' : u < run + 0.35 ? 'tug' : 'wander'; f.st = r.range(2.5, 7);
          f.hd = f.state === 'jog' ? Math.PI + r.range(-0.6, 0.6) : r.range(0, 6.28); // jog into the wind (toward +z)
        }
        if (f.state === 'leave') { f.reel = Math.max(0, f.reel - dt * 0.4); f.hd = -Math.PI / 2; }
        else f.reel = Math.min(1, f.reel + dt * 0.12);
        const vT = f.state === 'jog' ? (f.kid ? 3.2 : 2.6) : f.state === 'tug' ? 0 : f.state === 'leave' ? (f.reel < 0.4 ? 2.6 : 0.6) : 0.8;
        f.v += (vT - f.v) * Math.min(1, dt * 2);
        let nx = f.x - Math.sin(f.hd) * f.v * dt, nz = f.z - Math.cos(f.hd) * f.v * dt;
        if (f.state !== 'leave') { if (nx < -42 || nx > -16) { f.hd = -f.hd; nx = Math.max(-42, Math.min(-16, nx)); } }
        f.x = nx; f.z = nz; f.y = groundY(f.x, f.z);
        f.ph += dt * (f.v * 4.2 + (f.state === 'tug' ? 3 : 0.5));
        if (f.loop > 0) f.loop -= dt; else if (gust > 0.9 && f.type !== 1 && r.chance(dt * 0.15)) f.loop = 2.2;
      }
      maxDy = Math.max(maxDy, Math.abs(f.y - groundY(f.x, f.z)));
      // figure (faces the kite: the kite flies downwind, toward +x)
      const yaw = f.state === 'jog' || f.state === 'leave' ? f.hd : Math.atan2(-0.22, 0.975) + Math.sin(f.ph * 0.2) * 0.3; // face the kite
      o.position.set(f.x, f.y, f.z); o.rotation.set(0, yaw, 0); o.scale.setScalar(f.scale); o.updateMatrix();
      this.fig.setMatrixAt(n, o.matrix); rgb(f.shirt, this.aFC.array, n * 3); this.aFA.array[n * 2] = f.ph; this.aFA.array[n * 2 + 1] = f.v > 0.2 ? Math.min(0.7, 0.25 + f.v * 0.15) : 0;
      // kite: downwind (+x), high, swaying with wind + gusts, loops now and then
      const L = f.L * (0.15 + 0.85 * f.reel), el = (0.62 + 0.3 * Math.min(1, wind)) * (0.75 + 0.25 * f.reel) + (f.state === 'jog' ? 0.1 : 0);
      const sw = Math.sin(this.t * (0.6 + 0.5 * wind) + f.kph) * (0.18 + 0.25 * gust) + Math.sin(this.t * 1.7 + f.kph * 2) * 0.06 * (1 + gust);
      // v2.5.26: the breeze runs along the shore (toward -z, a little onshore): kites hang over the sand ahead
      const hz0 = Math.cos(el) * L, DX = 0.22, DZ = -0.975;
      let kx = f.x + DX * hz0 * Math.cos(sw) + 0.975 * hz0 * Math.sin(sw) * 0.8, ky = f.y + 1.4 * f.scale + Math.sin(el) * L, kz = f.z + DZ * hz0 * Math.cos(sw) + 0.22 * hz0 * Math.sin(sw) * 0.8;
      kx = Math.min(kx, -6.5);
      let roll = sw * 1.2;
      if (f.loop > 0) { const a = (1 - f.loop / 2.2) * Math.PI * 2; kz += Math.sin(a) * 3.5; ky += (Math.cos(a) - 1) * 3.5; roll += a; }
      ky += Math.sin(this.t * 3.1 + f.kph) * 0.4 * gust;
      const hx = f.x + 0.08, hy = f.y + 1.45 * f.scale, hz = f.z - 0.35;
      this._m.lookAt(this._v.set(hx, hy, hz), this._u.set(kx, ky, kz), new THREE.Vector3(0, 1, 0)); // kite +z faces the flyer
      o.position.set(kx, ky, kz); o.quaternion.setFromRotationMatrix(this._m); o.rotateZ(roll); o.scale.setScalar((f.kid ? 2.1 : 2.8) * (f.type === 3 ? 1.1 : 1)); o.updateMatrix();
      this.kite.setMatrixAt(n, o.matrix); rgb(f.c1, this.aK1.array, n * 3); rgb(f.c2, this.aK2.array, n * 4); this.aK2.array[n * 4 + 3] = f.type + (f.tail ? 0.5 : 0);
      o.rotation.set(0, 0, 0);
      // line with a little sag (2 segments)
      const mx = (hx + kx) / 2, my = (hy + ky) / 2 - L * 0.04 * (1.2 - gust * 0.5), mz = (hz + kz) / 2;
      lp.setXYZ(n * 4, hx, hy, hz); lp.setXYZ(n * 4 + 1, mx, my, mz); lp.setXYZ(n * 4 + 2, mx, my, mz); lp.setXYZ(n * 4 + 3, kx, ky, kz);
      live.push({ kx, kz, kid: f.kid }); n++; if (f.leaving) leaving++; else out++;
    }
    this.fig.count = this.kite.count = n; this.line.geometry.setDrawRange(0, n * 4);
    for (const m of [this.fig, this.kite, this.line]) m.visible = n > 0;
    if (n) { this.fig.instanceMatrix.needsUpdate = true; this.kite.instanceMatrix.needsUpdate = true; this.aFC.needsUpdate = this.aFA.needsUpdate = this.aK1.needsUpdate = this.aK2.needsUpdate = true; lp.needsUpdate = true; }
    this.live = live; this.stats = { out, leaving, target, spawned: this.stats.spawned }; this.maxDy = Math.max(this.maxDy, maxDy);
  }
}
