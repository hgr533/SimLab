// v2.5.26 aircraft: a small plane along the shore every 13 s, a helicopter on its route 2.4 s behind, a big
// airliner from the sea across the boulevard every 15 s. Flight plans + liveries: flightplan.js (per-pass seeded
// RNG, never the sim's). Render: one InstancedMesh per type (pool of 2), drawn only while a pass is in the air
// (0-3 extra draws). Body / accent colours are per-instance attributes over a white-tagged model; propeller and
// rotors spin in the vertex shader; navigation lights (red / green steady, white strobe, red beacon) are
// emissive, keep a minimum on-screen size and swell + shrug off fog in rain / low light. Beyond ~85 % of the
// camera far plane a craft is drawn nearer and proportionally smaller (same angular size, never clipped).
// LOW: lighter models (fewer sides, 2-blade rotor, no wheels / engines detail).
import * as THREE from '../vendor/three.module.js';
import { Builder, hex, mul, mergeKinds } from './geo.js';
import { U } from './materials.js';
import { planePlan, routeAt, jetPlan, jetAt, alive, PLANE_FIRST, PLANE_EVERY, HELI_LAG, PLANE_DUR, JET_FIRST, JET_EVERY, JET_DUR } from './flightplan.js';

// part codes in aRig.x: 0 fixed colour, 1 body colour, 2 accent, 3 main rotor (spin about y at x 0 / z aRig.z),
// 4 propeller (spin about z at y aRig.y), 5 tail rotor (spin about x at y aRig.y / z aRig.z),
// 6 nav red, 7 nav green, 8 white strobe, 9 red beacon; lights carry their centre in (uv.x, aRig.y, aRig.z)
const W = [1, 1, 1];
function light(b, code, x, y, z, r, c) {
  b.rig = [code, y, z]; const n0 = b.uvs.length;
  b.ellip(x, y, z, r, r, r, 4, 2, c);
  for (let i = n0; i < b.uvs.length; i += 2) b.uvs[i] = x;
  b.rig = [0, 0, 0];
}
function planeGeo(lo) {
  const b = new Builder({ rig: true }), n = lo ? 5 : 8, glass = hex(0x1b2633), dark = hex(0x2a2d33);
  b.rig = [1, 0, 0];
  b.limb(0, 1.0, -2.6, 0, 1.05, 3.9, 0.62, 0.22, n, W);           // fuselage, nose toward -z
  b.ellip(0, 1.0, -2.6, 0.62, 0.62, 1.0, n, 3, W);                 // cowling
  b.box(0, 1.72, -0.6, 11.2, 0.14, 1.55, W);                      // high wing
  b.box(0, 1.15, 3.6, 3.8, 0.1, 0.85, W);                         // stabiliser
  b.rig = [2, 0, 0];
  b.box(0, 1.15, 3.55, 0.12, 1.75, 1.05, W);                      // fin (accent)
  b.box(0, 0.95, 0.4, 1.3, 0.16, 5.0, W);                         // cheat line
  for (const s of [-1, 1]) b.box(s * 5.1, 1.71, -0.6, 1.0, 0.16, 1.57, W); // wing tips
  b.rig = [0, 0, 0];
  b.box(0, 1.15, -1.1, 1.18, 0.5, 1.5, glass, { skipBottom: true }); // cabin glass
  if (!lo) {
    for (const s of [-1, 1]) { b.limb(s * 0.55, 0.9, -0.4, s * 1.1, 0.15, -0.4, 0.05, 0.05, 4, dark); b.box(s * 1.1, 0, -0.4, 0.18, 0.36, 0.42, dark); }
    b.box(0, 0, -2.3, 0.15, 0.4, 0.35, dark);
  }
  b.rig = [4, 1.0, -3.65];
  b.box(0, 0.05, -3.65, 0.16, 1.9, 0.05, dark);                  // propeller (spins about z)
  b.rig = [0, 0, 0];
  light(b, 6, -5.65, 1.79, -0.6, 0.22, hex(0xff2a1a)); light(b, 7, 5.65, 1.79, -0.6, 0.22, hex(0x22ff55));
  light(b, 8, 0, 2.95, 4.05, 0.2, hex(0xffffff));
  return b.build();
}
function heliGeo(lo) {
  const b = new Builder({ rig: true }), n = lo ? 5 : 8, glass = hex(0x1d2a38), dark = hex(0x24272c);
  b.rig = [1, 0, 0];
  b.ellip(0, 1.35, 0, 1.15, 1.1, 2.3, n, lo ? 3 : 5, W);           // cabin pod
  b.limb(0, 1.55, 1.6, 0, 1.8, 6.3, 0.42, 0.16, n, W);             // tail boom
  b.rig = [2, 0, 0];
  b.box(0, 1.7, 6.2, 0.1, 1.5, 0.75, W);                          // fin
  b.box(0, 1.85, 5.6, 2.0, 0.08, 0.5, W);                         // stabiliser
  b.box(0, 0.95, 0.1, 2.36, 0.25, 3.6, W);                        // stripe band
  b.rig = [0, 0, 0];
  b.ellip(0, 1.55, -1.3, 0.95, 0.75, 1.15, n, 3, glass, { hemi: true }); // canopy
  for (const s of [-1, 1]) { b.box(s * 0.85, 0, 0, 0.12, 0.1, 3.4, dark); b.box(s * 0.75, 0.05, -0.8, 0.08, 0.35, 0.08, dark); b.box(s * 0.75, 0.05, 0.9, 0.08, 0.35, 0.08, dark); }
  b.cyl(0, 2.35, 0.1, 0.22, 0.14, 0.45, 5, dark);                 // mast
  b.rig = [3, 0, 0.1];
  const blades = lo ? 2 : 4;
  for (let i = 0; i < blades; i++) { b.push(); b.translate(0, 2.8, 0.1); b.rotY(i * Math.PI * 2 / blades); b.box(0, 0, 2.6, 0.32, 0.06, 5.2, dark); b.pop(); }
  b.rig = [5, 1.95, 6.35];
  b.box(0.22, 1.2, 6.35, 0.05, 1.5, 0.16, dark);                  // tail rotor (spins about x)
  b.rig = [0, 0, 0];
  light(b, 6, -1.0, 1.85, 5.6, 0.16, hex(0xff2a1a)); light(b, 7, 1.0, 1.85, 5.6, 0.16, hex(0x22ff55));
  light(b, 9, 0, 2.15, -0.3, 0.2, hex(0xff2a1a)); light(b, 8, 0, 2.5, 6.6, 0.16, hex(0xffffff));
  return b.build();
}
function jetGeo(lo) {
  const b = new Builder({ rig: true }), n = lo ? 6 : 10, glass = hex(0x16202b), grey = hex(0xb9bec6), dark = hex(0x3a3f47);
  const slab = (pts, y, c) => { const [a, bb, cc, d] = pts.map((p) => [p[0], y, p[1]]); b.quad(a, bb, cc, d, c); b.quad(d, cc, bb, a, mul(c, 0.85)); };
  b.rig = [1, 0, 0];
  b.limb(0, 0, -15, 0, 0, 15, 2.0, 2.0, n, W);                    // fuselage (top colour)
  b.ellip(0, 0, -15, 2.0, 2.0, 3.6, n, 4, W);                     // nose
  b.limb(0, 0.1, 15, 0, 0.9, 21, 2.0, 0.45, n, W);                // tail cone
  b.rig = [0, 0, 0];
  b.box(0, -2.0, 0, 3.6, 1.2, 30, hex(0xeceef0));                  // pale belly
  b.box(0, 0.35, -16.6, 2.3, 0.6, 1.3, glass);                     // cockpit
  if (!lo) for (const s of [-1, 1]) b.box(s * 1.98, 0.55, 0, 0.06, 0.32, 26, glass); // window bands
  b.rig = [2, 0, 0];
  for (const s of [-1, 1]) b.box(s * 1.97, -0.25, -1, 0.1, 0.42, 30, W); // cheat line
  const fin = [[0, 14.5], [0, 20.5]];
  b.quad([0, 1.5, 14.5], [0, 1.5, 20.4], [0, 9.5, 21.8], [0, 9.5, 18.6], W); b.quad([0, 9.5, 18.6], [0, 9.5, 21.8], [0, 1.5, 20.4], [0, 1.5, 14.5], W); // fin (accent)
  b.rig = [0, 0, 0];
  for (const s of [-1, 1]) {
    slab([[s * 1.8, -4], [s * 17.5, 5.5], [s * 17.5, 7.6], [s * 1.8, 4.5]], -1.0, grey);   // swept wing
    slab([[s * 0.6, 17], [s * 6.8, 20.5], [s * 6.8, 21.8], [s * 0.6, 20.8]], 0.9, grey);   // stabiliser
    b.limb(s * 6.2, -2.0, -4.2, s * 6.2, -2.0, 0.6, 0.95, 0.8, lo ? 6 : 8, dark);           // engine
    if (!lo) b.box(s * 6.2, -1.5, -1.2, 0.25, 0.6, 2.4, grey);                                 // pylon
    b.rig = [2, 0, 0]; b.box(s * 17.5, -1.0, 6.6, 0.12, 2.0, 1.6, W); b.rig = [0, 0, 0];       // winglets (accent)
  }
  light(b, 6, -17.7, -0.8, 6.0, 0.35, hex(0xff2a1a)); light(b, 7, 17.7, -0.8, 6.0, 0.35, hex(0x22ff55));
  light(b, 8, 0, 1.0, 21.3, 0.3, hex(0xffffff)); light(b, 9, 0, 2.1, 2.0, 0.32, hex(0xff2a1a)); light(b, 9, 0, -2.7, 2.0, 0.32, hex(0xff2a1a));
  return b.build();
}

const VERT = `attribute vec3 aRig; attribute vec4 aLight; attribute vec3 aBody; attribute vec4 aAcc;
uniform float uTime; uniform vec3 uAmb; uniform vec3 uSun; uniform float uGlow;
varying vec3 vC; varying float vL;
#include <fog_pars_vertex>
vec3 rotY(vec3 p, float x, float z, float a) { float c = cos(a), s = sin(a); float dx = p.x - x, dz = p.z - z; return vec3(x + dx * c + dz * s, p.y, z - dx * s + dz * c); }
attribute float aKind; attribute float aKSel;
void main() {
  if (abs(aKind - aKSel) > 0.5) { gl_Position = vec4(2.0, 2.0, 2.0, 1.0); vC = vec3(0.0); vL = 0.0; return; } // v2.5.28 one mesh for all three types
  vec3 p = position; float code = aRig.x; float ph = aAcc.w;
  if (code > 2.5 && code < 3.5) p = rotY(p, 0.0, aRig.z, uTime * 31.0 + ph);
  else if (code > 3.5 && code < 4.5) { float a = uTime * 47.0 + ph, c = cos(a), s = sin(a); vec2 q = p.xy - vec2(0.0, aRig.y); p.xy = vec2(q.x * c - q.y * s, q.x * s + q.y * c) + vec2(0.0, aRig.y); }
  else if (code > 4.5 && code < 5.5) { float a = uTime * 53.0 + ph, c = cos(a), s = sin(a); vec2 q = p.yz - aRig.yz; p.yz = vec2(q.x * c - q.y * s, q.x * s + q.y * c) + aRig.yz; }
  vL = 0.0;
  vec4 mv;
  if (code > 5.5) {
    vec3 ctr = vec3(uv.x, aRig.y, aRig.z);
    vec4 mc = viewMatrix * (modelMatrix * instanceMatrix * vec4(ctr, 1.0));
    vec3 off = (viewMatrix * (modelMatrix * instanceMatrix * vec4(p - ctr, 0.0))).xyz;
    float r0 = max(1e-4, length(off)), R = max(r0, -mc.z * (0.0032 + 0.003 * uGlow));
    mv = vec4(mc.xyz + off * (R / r0), 1.0);
    float t = uTime + ph;
    float on = code < 7.5 ? 1.0 : code < 8.5 ? step(fract(t * 0.9), 0.07) + step(abs(fract(t * 0.9) - 0.16), 0.035) : step(fract(t * 1.1), 0.18);
    vL = 1.0; vC = color * (code < 7.5 ? 1.1 : 1.6) * (0.08 + 0.92 * on) * (0.75 + 0.6 * uGlow);
  } else {
    mv = viewMatrix * (modelMatrix * instanceMatrix * vec4(p, 1.0));
    vec3 c = color;
    if (code > 0.5 && code < 1.5) c *= aBody; else if (code > 1.5 && code < 2.5) c *= aAcc.rgb;
    vC = c * max(vec3(0.5), uAmb * aLight.y + uSun * (0.4 + aLight.x * 0.75));
  }
  vec4 mvPosition = mv;
  gl_Position = projectionMatrix * mvPosition;
  #include <fog_vertex>
}`;
const FRAG = `varying vec3 vC; varying float vL;
#include <fog_pars_fragment>
void main() { gl_FragColor = vec4(min(vC, vec3(1.0)), 1.0);
#ifdef USE_FOG
  gl_FragColor.rgb = mix(gl_FragColor.rgb, fogColor, smoothstep(fogNear, fogFar, vFogDepth) * (vL > 0.5 ? 0.12 : 0.5));
#endif
}`;

const col = (h, o, i) => { o[i] = ((h >> 16) & 255) / 255; o[i + 1] = ((h >> 8) & 255) / 255; o[i + 2] = (h & 255) / 255; };
export class Aircraft {
  constructor(scene) {
    this.scene = scene; this.enabled = true; this.lo = null; this.meshes = null;
    this.uGlow = { value: 0 };
    this.mat = new THREE.ShaderMaterial({ fog: true, vertexColors: true, side: THREE.DoubleSide, vertexShader: VERT, fragmentShader: FRAG,
      uniforms: Object.assign({ fogColor: { value: new THREE.Color() }, fogNear: { value: 1 }, fogFar: { value: 1000 }, fogDensity: { value: 0 } },
        { uTime: U.uTime, uAmb: U.uAmb, uSun: U.uSun, uGlow: this.uGlow }) });
    this.plans = { plane: new Map(), jet: new Map() };
    this.log = []; this.live = []; this.onScreen = 0; this.visible = 0; this.lastT = -1;
    this._o = new THREE.Object3D(); this._v = new THREE.Vector3(); this._p = {};
  }
  applyPreset(p) {
    const lo = p.name === 'LOW';
    if (lo === this.lo) return;
    this.lo = lo;
    if (this.mesh) { this.scene.remove(this.mesh); this.mesh.geometry.dispose(); }
    // v2.5.28: one InstancedMesh for plane / heli / jet (slots 0-1, 2-3, 4-5): 1 draw instead of 3
    const g = mergeKinds([planeGeo(lo), heliGeo(lo), jetGeo(lo)]);
    const aB = new THREE.InstancedBufferAttribute(new Float32Array(6 * 3), 3), aA = new THREE.InstancedBufferAttribute(new Float32Array(6 * 4), 4), aK = new THREE.InstancedBufferAttribute(new Float32Array(6).fill(-1), 1);
    for (const a of [aB, aA, aK]) a.setUsage(THREE.DynamicDrawUsage);
    g.setAttribute('aBody', aB); g.setAttribute('aAcc', aA); g.setAttribute('aKSel', aK);
    const m = new THREE.InstancedMesh(g, this.mat, 6); m.name = 'aircraft';
    m.frustumCulled = false; m.count = 0; m.visible = false; m.renderOrder = 5; this.scene.add(m);
    this.mesh = m; this.meshes = { all: m };
  }
  // plan for pass k, made when it is first needed from the runner state at its start time (rz0 back-projected)
  plan(kind, k, t0, sim) {
    const M = this.plans[kind]; let p = M.get(k);
    if (!p) {
      const vr = Math.max(4, sim.r.speed || 0), rz0 = sim.r.z + vr * Math.max(0, sim.t - t0);
      p = kind === 'plane' ? planePlan(k, rz0, vr) : jetPlan(k, sim.r.x, rz0, vr);
      M.set(k, p);
      if (M.size > 6) M.delete(M.keys().next().value);
      if (kind === 'plane') {
        this.log.push({ kind: 'plane', k, t0: p.t0, shoreX: +p.shoreX.toFixed(1), alt: +p.alt.toFixed(1), v: +p.v.toFixed(1), dir: p.dir, body: p.plane.body, accent: p.plane.accent });
      } else this.log.push({ kind: 'jet', k, t0: p.t0, band: p.band, off: +p.off.toFixed(1), alt: +p.alt.toFixed(1), v: +p.v.toFixed(1), headingDeg: +(p.th * 57.3).toFixed(1), body: p.liv.body, accent: p.liv.accent });
      if (this.log.length > 200) this.log.shift();
    }
    return p;
  }
  heliLogged(k, p) { if (!p.heliLogged) { p.heliLogged = 1; this.log.push({ kind: 'heli', k, t0: +(p.t0 + HELI_LAG).toFixed(2), alt: +p.heliAlt.toFixed(1), body: p.heli.body, accent: p.heli.accent }); } }
  update(sim, camera, glow) {
    if (!this.meshes) return;
    const M = this.meshes, t = sim.t, o = this._o, P = this._p, live = [];
    this.uGlow.value = glow || 0;
    if (sim.t < this.lastT - 0.5) { this.plans.plane.clear(); this.plans.jet.clear(); } // new run
    this.lastT = sim.t;
    const n = { plane: 0, heli: 0, jet: 0 };
    let on = 0;
    const far = camera.far * 0.85, cp = camera.position;
    const put = (kind, pos, liv, ph) => {
      const m = this.mesh, ki = kind === 'plane' ? 0 : kind === 'heli' ? 1 : 2; if (n[kind] >= 2) return; const i = ki * 2 + n[kind];
      let x = pos.x, y = pos.y, z = pos.z, sc = kind === 'jet' ? 1.35 : 2.2; // cosmetic: a bit larger than life so they read at 150-500 m
      const dx = x - cp.x, dy = y - cp.y, dz = z - cp.z, d = Math.hypot(dx, dy, dz);
      if (d > far) { const k = far / d; x = cp.x + dx * k; y = cp.y + dy * k; z = cp.z + dz * k; sc *= k; }
      const yaw = Math.atan2(-pos.vx, -pos.vz), pitch = Math.atan2(pos.vy || 0, Math.hypot(pos.vx, pos.vz));
      o.position.set(x, y, z); o.rotation.set(pitch, yaw, pos.bank || 0, 'YXZ'); o.scale.setScalar(sc); o.updateMatrix();
      m.setMatrixAt(i, o.matrix);
      const aB = m.geometry.getAttribute('aBody'), aA = m.geometry.getAttribute('aAcc');
      col(liv.body, aB.array, i * 3); col(liv.accent, aA.array, i * 4); aA.array[i * 4 + 3] = ph; m.geometry.getAttribute('aKSel').array[i] = ki;
      this._v.set(x, y, z).project(camera);
      const vis = this._v.z < 1 && Math.abs(this._v.x) < 1 && Math.abs(this._v.y) < 1; if (vis) on++;
      live.push({ kind, x: pos.x, y: pos.y, z: pos.z, vx: pos.vx, vz: pos.vz, d, vis });
      n[kind]++;
    };
    if (this.enabled && sim.state === 'run') {
      for (const k of alive(t, PLANE_FIRST, PLANE_EVERY, PLANE_DUR + HELI_LAG)) {
        const p = this.plan('plane', k, PLANE_FIRST + k * PLANE_EVERY, sim), s = t - p.t0;
        if (s < PLANE_DUR) put('plane', routeAt(p, s, P, false), p.plane, k * 1.7);
        if (s >= HELI_LAG) { this.heliLogged(k, p); put('heli', routeAt(p, s - HELI_LAG, P, true), p.heli, k * 2.3); }
      }
      for (const j of alive(t, JET_FIRST, JET_EVERY, JET_DUR)) {
        const p = this.plan('jet', j, JET_FIRST + j * JET_EVERY, sim);
        put('jet', jetAt(p, t - p.t0, P), p.liv, j * 1.3);
      }
    }
    { const m = this.mesh, ks = m.geometry.getAttribute('aKSel'), tot = n.plane + n.heli + n.jet; // unused slots collapse
      ['plane', 'heli', 'jet'].forEach((kind, ki) => { for (let j = n[kind]; j < 2; j++) ks.array[ki * 2 + j] = -1; });
      m.count = tot ? 6 : 0; m.visible = tot > 0;
      if (tot) { m.instanceMatrix.needsUpdate = true; m.geometry.getAttribute('aBody').needsUpdate = true; m.geometry.getAttribute('aAcc').needsUpdate = true; ks.needsUpdate = true; } }
    this.live = live; this.visible = live.length; this.onScreen = on;
  }
}
