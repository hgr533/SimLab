// v2.5.26 street performers (render side; positions from places.performersNear, a pure function shared with the
// sim gatherings). Musicians (solo or 2-3 players: guitar, violin, accordion, darbuka, sax, keyboard; open case /
// hat for tips), living statues on a pedestal (pharaoh, angel, soldier, tramp with bowler + cane, robot, mermaid;
// gold / silver / bronze paint; still, a bow when someone tips) and jugglers (balls / clubs / rings arcing).
// One InstancedMesh per kind (3 draws while any act is near): every variant lives in the geometry (aRig.y =
// variant, -1 = shared) and the vertex shader collapses the ones not selected (aSel), animates strumming /
// swaying, the statue bow and the juggled props. They pack up in the rain (hidden; the sim drops their crowds).
// LOW: musicians + statues only within 60 m, no jugglers' props trail (still 3 draws max).
import * as THREE from '../vendor/three.module.js';
import { Builder, hex, mul } from './geo.js';
import { U } from './materials.js';
import { performersNear } from './places.js';

const SKIN = hex(0xc8946a), DARK = hex(0x22252b), W = [1, 1, 1];
const PAINT = [0xd4a62a, 0xc3c7cc, 0x9c6b3c];
const SHIRT = [0xc0392b, 0x2e86c1, 0x27ae60, 0xf1c40f, 0x8e44ad, 0xecf0f1, 0x34495e, 0xe67e22];
// aRig = (code, variant, param). code 0 fixed colour, 1 instance colour (shirt / paint), +10 = upper body
// (sways / bows about the hip), 2 strumming forearm, 4 juggled prop (param = prop index 0..2)
function figure(b, upCode, colCode, legs = true) {
  const c = (k) => (k ? colCode : 0);
  if (legs) { b.rig = [c(1), -1, 0]; b.box(-0.1, 0, 0, 0.14, 0.88, 0.16, colCode ? W : hex(0x2c3a4f)); b.box(0.1, 0, 0, 0.14, 0.88, 0.16, colCode ? W : hex(0x2c3a4f)); }
  b.rig = [upCode + 1, -1, 0]; b.box(0, 0.86, 0, 0.42, 0.58, 0.25, W);
  b.rig = [upCode + c(1), -1, 0]; b.box(0, 1.46, 0, 0.22, 0.25, 0.23, colCode ? W : SKIN);
  for (const s of [-1, 1]) b.box(s * 0.26, 0.9, 0, 0.1, 0.5, 0.11, colCode ? W : SKIN);
}
function musicianGeo() {
  const b = new Builder({ rig: true }), wood = hex(0x9a5a2b), brass = hex(0xd9b44a);
  figure(b, 10, 0);
  const V = (v, fn) => { const r0 = b.rig; b.rig = [10, v, 0]; fn(); b.rig = r0; };
  V(0, () => { b.ellip(0.02, 0.95, -0.2, 0.22, 0.26, 0.07, 8, 3, wood); b.push(); b.translate(0.05, 1.05, -0.22); b.rotZ(-1.15); b.box(0, 0, 0, 0.06, 0.7, 0.04, DARK); b.pop(); });
  V(1, () => { b.ellip(-0.18, 1.33, -0.12, 0.08, 0.13, 0.04, 6, 3, wood); b.push(); b.translate(0.1, 1.3, -0.25); b.rotZ(1.2); b.box(0, 0, 0, 0.015, 0.6, 0.015, DARK); b.pop(); });
  V(2, () => { b.box(0, 0.85, -0.22, 0.5, 0.36, 0.2, hex(0xb3202a)); b.box(0, 0.85, -0.33, 0.52, 0.3, 0.03, W); });
  V(3, () => { b.cyl(0.18, 0.5, -0.18, 0.15, 0.09, 0.42, 7, hex(0xc9a26b)); });
  V(4, () => { b.limb(0, 1.4, -0.16, 0.05, 0.95, -0.3, 0.03, 0.05, 5, brass); b.limb(0.05, 0.95, -0.3, 0.12, 1.05, -0.38, 0.05, 0.1, 6, brass); });
  V(5, () => { b.box(0, 0.8, -0.5, 0.95, 0.08, 0.3, DARK, { top: hex(0xeeeeee) }); b.box(-0.4, 0, -0.5, 0.04, 0.8, 0.04, DARK); b.box(0.4, 0, -0.5, 0.04, 0.8, 0.04, DARK); });
  b.rig = [2, -1, 0]; b.box(0.26, 0.92, -0.14, 0.1, 0.1, 0.32, SKIN); // strumming forearm
  b.rig = [0, -1, 0]; b.box(0.1, 0, -0.9, 0.7, 0.12, 0.35, hex(0x3a2a20), { top: hex(0x7a1f2a) }); // open case
  return b.build();
}
function statueGeo() {
  const b = new Builder({ rig: true });
  b.rig = [0, -1, 0]; b.box(0, 0, 0, 0.8, 0.45, 0.8, hex(0x6d6a66), { top: hex(0x85817b) }); // pedestal
  b.push(); b.translate(0, 0.45, 0);
  figure(b, 10, 1);
  const V = (v, fn, code = 11) => { const r0 = b.rig; b.rig = [code, v, 0]; fn(); b.rig = r0; };
  V(0, () => { b.box(0, 1.4, 0.05, 0.36, 0.42, 0.3, W); b.box(0.36, 0.5, -0.1, 0.05, 1.3, 0.05, W); });          // pharaoh nemes + staff
  V(1, () => { for (const s of [-1, 1]) b.quad([s * 0.15, 1.3, 0.14], [s * 0.85, 1.65, 0.3], [s * 0.7, 0.75, 0.28], [s * 0.15, 0.85, 0.14], W); b.box(0, 1.78, 0, 0.3, 0.03, 0.3, W); }); // angel
  V(2, () => { b.box(0, 1.58, 0, 0.26, 0.42, 0.26, W); b.box(-0.3, 0.6, -0.05, 0.05, 1.2, 0.06, W); });          // soldier busby + rifle
  V(3, () => { b.ellip(0, 1.62, 0, 0.17, 0.12, 0.17, 7, 3, W, { hemi: true, close: true }); b.box(0, 1.6, 0, 0.36, 0.02, 0.36, W); b.box(0.36, 0, -0.15, 0.04, 0.85, 0.04, W); }); // tramp
  V(4, () => { b.box(0, 1.38, 0, 0.32, 0.34, 0.32, W); b.limb(0, 1.72, 0, 0, 1.95, 0, 0.015, 0.015, 3, W); b.box(0, 0.86, -0.15, 0.3, 0.3, 0.04, W); }); // robot
  V(5, () => { b.limb(0, 0.85, 0, 0, 0.05, -0.25, 0.2, 0.06, 7, W); b.quad([-0.25, 0.05, -0.3], [0.25, 0.05, -0.3], [0, 0.1, -0.5], [0, 0.1, -0.5], W); }, 1); // mermaid tail
  b.pop();
  b.rig = [0, -1, 0]; b.cyl(0, 0, -0.85, 0.15, 0.17, 0.12, 6, DARK, { top: hex(0x3d2c1e) }); // hat for tips
  return b.build();
}
function jugglerGeo() {
  const b = new Builder({ rig: true });
  figure(b, 0, 0);
  for (const s of [-1, 1]) { b.rig = [0, -1, 0]; b.box(s * 0.26, 1.15, -0.2, 0.09, 0.09, 0.3, SKIN); }
  for (let j = 0; j < 3; j++) {
    const col = hex([0xff3b30, 0xffcc00, 0x34c759][j]);
    b.rig = [4, 0, j]; b.ellip(0, 0, 0, 0.06, 0.06, 0.06, 5, 3, col);
    b.rig = [4, 1, j]; b.limb(0, -0.15, 0, 0, 0.18, 0, 0.02, 0.05, 5, col); b.ellip(0, 0.2, 0, 0.05, 0.05, 0.05, 4, 2, col);
    b.rig = [4, 2, j]; for (let k = 0; k < 8; k++) { const a0 = k * Math.PI / 4, a1 = a0 + Math.PI / 4; b.limb(Math.cos(a0) * 0.13, Math.sin(a0) * 0.13, 0, Math.cos(a1) * 0.13, Math.sin(a1) * 0.13, 0, 0.015, 0.015, 3, col, { cap: false }); }
  }
  b.rig = [0, -1, 0]; b.cyl(0.5, 0, -0.6, 0.15, 0.17, 0.12, 6, DARK, { top: hex(0x3d2c1e) });
  return b.build();
}
const VERT = `attribute vec3 aRig; attribute vec4 aLight; attribute vec3 aCol; attribute vec4 aSel; uniform vec3 uAmb; uniform vec3 uSun; uniform float uTime;
varying vec3 vC;
#include <fog_pars_vertex>
vec3 rotX(vec3 p, float y0, float z0, float a) { float c = cos(a), s = sin(a); float y = p.y - y0, z = p.z - z0; return vec3(p.x, y0 + y * c - z * s, z0 + y * s + z * c); }
void main() { vec3 p = position; float code = aRig.x, v = aRig.y;
  if (v > -0.5 && abs(v - aSel.x) > 0.5) p = vec3(0.0, -50.0, 0.0);
  float ph = uTime * aSel.z + aSel.w * 6.28;
  if (code > 3.5 && code < 4.5) { float a = ph * 1.4 + aRig.z * 2.094; p += vec3(sin(a) * 0.32, 1.25 + abs(cos(a)) * 0.85, -0.42); p = rotX(p, p.y, p.z, a * 2.0 * step(0.5, v)); }
  if (code > 9.5) { float hip = aSel.y > 0.0 ? 0.9 + (code > 10.5 && aSel.y > 0.0 ? 0.45 : 0.0) : 0.9; p = rotX(p, hip, 0.0, -aSel.y * 0.6 + sin(ph * 0.5) * 0.04 * aSel.z); }
  if (code > 1.5 && code < 2.5) p = rotX(p, 0.95, -0.02, sin(ph * 2.2) * 0.35);
  vec3 col = color; if (abs(code - 1.0) < 0.5 || abs(code - 11.0) < 0.5) col *= aCol;
  vec4 mvPosition = viewMatrix * (modelMatrix * instanceMatrix * vec4(p, 1.0)); gl_Position = projectionMatrix * mvPosition;
  vec3 L = uAmb * aLight.y + uSun * (0.35 + aLight.x * 0.75);
  vC = col * max(vec3(0.42), L) + (abs(code - 11.0) < 0.5 || abs(code - 1.0) < 0.5 ? col * 0.18 * aCol.r : vec3(0.0));
  #include <fog_vertex>
}`;
const FRAG = `varying vec3 vC;
#include <fog_pars_fragment>
void main() { gl_FragColor = vec4(min(vC, vec3(1.0)), 1.0);
#include <fog_fragment>
}`;
const rgb = (h, a, i) => { a[i] = ((h >> 16) & 255) / 255; a[i + 1] = ((h >> 8) & 255) / 255; a[i + 2] = (h & 255) / 255; };
export class Performers {
  constructor(scene) {
    this.scene = scene; this.meshes = null; this.near = []; this.bow = {}; this.stats = { acts: 0, musicians: 0, statues: 0, jugglers: 0, packed: false };
    this._o = new THREE.Object3D(); this.onTip = null;
  }
  applyPreset(p) {
    this.range = p.name === 'LOW' ? 60 : p.name === 'MEDIUM' ? 90 : 130;
    if (this.meshes) return;
    const mat = new THREE.ShaderMaterial({ fog: true, vertexColors: true, side: THREE.DoubleSide, vertexShader: VERT, fragmentShader: FRAG,
      uniforms: Object.assign({ fogColor: { value: new THREE.Color() }, fogNear: { value: 1 }, fogFar: { value: 1000 }, fogDensity: { value: 0 } }, { uAmb: U.uAmb, uSun: U.uSun, uTime: U.uTime }) });
    const mk = (g, n, name) => { const aC = new THREE.InstancedBufferAttribute(new Float32Array(n * 3), 3), aS = new THREE.InstancedBufferAttribute(new Float32Array(n * 4), 4);
      g.setAttribute('aCol', aC); g.setAttribute('aSel', aS); const m = new THREE.InstancedMesh(g, mat, n); m.name = 'performers-' + name; m.frustumCulled = false; m.count = 0; m.visible = false; this.scene.add(m); return m; };
    this.meshes = [mk(musicianGeo(), 18, 'musicians'), mk(statueGeo(), 6, 'statues'), mk(jugglerGeo(), 6, 'jugglers')];
  }
  update(dt, sim, camera) {
    if (!this.meshes) return;
    const rain = (sim.ws.p.rain || 0) > 0.35, cz = camera.position.z, o = this._o, n = [0, 0, 0], live = [];
    const ai = sim.ai, crowd = {};
    for (const g of ai.gats || []) if (g.perf !== undefined) crowd[g.perf] = g.m.filter((i) => ai.people[i].gatIn).length;
    if (!rain) for (const q of performersNear(cz - 40, 3)) {
      if (q.z > cz + 15 || q.z < cz - this.range) continue;
      const m = this.meshes[q.type], face = q.side > 0 ? Math.PI / 2 : -Math.PI / 2; // face the deck (-z model front turned inward)
      const watchers = crowd[q.id] || 0;
      // statue: still; a bow now and then when someone tips (more watchers, more tips)
      let bow = 0;
      if (q.type === 1) { const B = this.bow[q.id] || (this.bow[q.id] = { t: 0, cd: 3 }); if (dt > 0) { B.cd -= dt * (0.2 + 0.5 * watchers); if (B.cd <= 0 && watchers > 0) { B.t = 1.6; B.cd = 6 + 4 * Math.random(); if (this.onTip) this.onTip(q, 'statue'); } B.t = Math.max(0, B.t - dt); } bow = Math.sin(Math.min(1, B.t / 1.6) * Math.PI); }
      const players = q.type === 0 ? q.n : 1;
      for (let k = 0; k < players; k++) {
        const i = n[q.type]; if (i >= m.count + 99 || i >= m.instanceMatrix.count) break;
        const off = (k - (players - 1) / 2) * 1.0;
        o.position.set(q.x + q.side * 0.05, 0, q.z + off); o.rotation.set(0, face, 0); o.scale.setScalar(1); o.updateMatrix(); m.setMatrixAt(i, o.matrix);
        const aC = m.geometry.getAttribute('aCol').array, aS = m.geometry.getAttribute('aSel').array;
        const sub = q.type === 0 ? (q.sub + k * 2) % 6 : q.sub;
        rgb(q.type === 1 ? PAINT[q.paint] : SHIRT[(q.sub2 + k * 3) % SHIRT.length], aC, i * 3);
        aS[i * 4] = sub; aS[i * 4 + 1] = bow; aS[i * 4 + 2] = q.type === 0 ? 2.4 + k * 0.4 : q.type === 2 ? 2.6 : 0; aS[i * 4 + 3] = (q.id * 0.37 + k * 0.21) % 1;
        n[q.type]++;
        if (q.type === 0) live.push({ x: q.x, z: q.z + off, inst: sub, id: q.id * 4 + k, watchers });
      }
      if (q.type !== 0) live.push({ x: q.x, z: q.z, inst: q.type === 2 ? 'juggle' : 'statue', id: q.id * 4, watchers });
    }
    this.meshes.forEach((m, k) => { m.count = n[k]; m.visible = n[k] > 0; if (n[k]) { m.instanceMatrix.needsUpdate = true; m.geometry.getAttribute('aCol').needsUpdate = true; m.geometry.getAttribute('aSel').needsUpdate = true; } });
    this.live = live; this.stats = { acts: live.length, musicians: n[0], statues: n[1], jugglers: n[2], packed: rain };
  }
}
