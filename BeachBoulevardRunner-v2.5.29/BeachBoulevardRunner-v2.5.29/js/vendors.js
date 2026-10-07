// v2.5.27 popsicle vendors (render side of aicore.vend: roaming carts pushed along the deck, beach sellers with a
// cooler on a shoulder strap) + hand-held food & drinks on a share of the crowd (cones, popsicles, falafel pita,
// corn, pizza slice, sandwich, watermelon, cup with straw, can, coconut, coffee) with an occasional eat / sip lift.
// Draws: vendors 2 (beach sellers, carts) + props 1. LOW: props only within 35 m, no coconut/coffee detail.
// v2.5.28: beach sellers, carts, balloon sellers, ATMs and hand-held props share ONE InstancedMesh (aKind).
import * as THREE from '../vendor/three.module.js';
import { Builder, hex, mergeKinds } from './geo.js';
import { U } from './materials.js';
import { hash2 } from './rng.js';
import { groundY, atmsNear } from './places.js';

const SKIN = hex(0xc8946a), W = [1, 1, 1];
function fig(b, shirt) { b.box(-0.1, 0, 0, 0.14, 0.86, 0.16, hex(0x33363d)); b.box(0.1, 0, 0, 0.14, 0.86, 0.16, hex(0x33363d)); b.box(0, 0.86, 0, 0.42, 0.58, 0.25, shirt);
  b.box(0, 1.46, 0, 0.22, 0.25, 0.23, SKIN); b.cyl(0, 1.7, 0, 0.2, 0.2, 0.05, 8, hex(0xf5f5f5)); b.cyl(0, 1.72, 0, 0.13, 0.12, 0.1, 8, hex(0xf5f5f5)); for (const s of [-1, 1]) b.box(s * 0.26, 0.9, 0, 0.1, 0.5, 0.11, SKIN); }
function beachGeo() { const b = new Builder(); fig(b, W);
  b.box(0.38, 0.75, 0, 0.32, 0.36, 0.5, hex(0x2f80ed), { top: hex(0xffffff) }); b.limb(-0.2, 1.36, 0, 0.36, 1.11, 0, 0.02, 0.02, 3, hex(0x222222)); // cooler + strap
  b.box(0.38, 0.86, -0.26, 0.2, 0.12, 0.02, hex(0xffcc00)); return b.build(); }
function cartGeo() { const b = new Builder(); fig(b, W);
  b.box(0, 0.35, -1.0, 0.8, 0.62, 1.1, W, { top: hex(0xffffff) }); b.box(0, 0.5, -1.56, 0.82, 0.3, 0.02, hex(0xffcc00)); // cooler cart + sign
  for (const x of [-0.38, 0.38]) b.cyl(x, 0, -0.65, 0.17, 0.17, 0.06, 8, hex(0x222222)); b.box(0, 0.95, -0.42, 0.7, 0.04, 0.04, hex(0x888888)); // wheels + handle
  b.limb(0, 0.97, -1.0, 0, 2.25, -1.0, 0.025, 0.025, 4, hex(0xdddddd)); b.canopy(0, 2.25, -1.0, 1.05, 0.35, 8, W, hex(0xeeeeee)); return b.build(); }
function atmGeo() { const b = new Builder(); // faces -x (the deck); a slim free-standing cash machine with a little canopy
  b.box(0, 0, 0, 0.5, 1.75, 0.62, hex(0x3b4a5c), { top: hex(0x2e3a48) }); b.box(-0.26, 1.0, 0, 0.02, 0.32, 0.42, hex(0x66d9ff)); // body + screen
  b.box(-0.3, 0.82, 0, 0.12, 0.05, 0.36, hex(0x9aa4ad)); b.box(-0.27, 0.68, 0, 0.02, 0.06, 0.18, hex(0x111111)); // keypad shelf + card slot
  b.box(0, 1.75, 0, 0.62, 0.28, 0.72, hex(0x18a058)); b.box(-0.32, 1.8, 0, 0.02, 0.16, 0.5, hex(0xfafafa)); // green header + label
  b.box(-0.15, 2.03, 0, 0.9, 0.05, 0.9, hex(0x2b2f36)); return b.build(); }
// props, variant in aRig.x; origin = the hand
function propGeo() { const b = new Builder({ rig: true }), V = (v, f) => { b.rig = [v, 0, 0]; f(); };
  V(0, () => { b.cyl(0, -0.14, 0, 0.012, 0.045, 0.14, 6, hex(0xd9a35b)); b.ellip(0, 0.02, 0, 0.055, 0.05, 0.055, 6, 3, hex(0xff9ec7)); });
  V(1, () => { b.box(0, -0.06, 0, 0.012, 0.08, 0.012, hex(0xe8d3a8)); b.box(0, 0.02, 0, 0.06, 0.13, 0.03, hex(0xff4d6d)); });
  V(2, () => { b.ellip(0, 0.02, 0, 0.07, 0.1, 0.05, 6, 3, hex(0xe6c78f)); b.ellip(0, 0.1, 0, 0.05, 0.03, 0.035, 5, 2, hex(0x5aa83a)); });
  V(3, () => { b.limb(0, -0.08, 0, 0, 0.13, 0, 0.035, 0.035, 6, hex(0xffd23f)); b.box(0, -0.13, 0, 0.012, 0.06, 0.012, hex(0xe8d3a8)); });
  V(4, () => { b.tri([-0.07, 0.05, 0], [0.07, 0.05, 0], [0, -0.12, 0], hex(0xf1b24a)); b.box(0, 0.04, 0, 0.15, 0.025, 0.02, hex(0xc8812e)); b.box(0, -0.02, 0.008, 0.03, 0.03, 0.01, hex(0xd8342b)); });
  V(5, () => { b.box(0, -0.04, 0, 0.12, 0.09, 0.05, hex(0xf3dfb0)); b.box(0, 0.0, 0, 0.125, 0.02, 0.055, hex(0x6bbf59)); });
  V(6, () => { b.tri([-0.09, 0.06, 0], [0.09, 0.06, 0], [0, -0.06, 0], hex(0xff4060)); b.box(0, 0.06, 0, 0.19, 0.025, 0.03, hex(0x2e8b3a)); });
  V(7, () => { b.cyl(0, -0.07, 0, 0.032, 0.042, 0.13, 7, hex(0xffffff)); b.box(0, -0.0, 0, 0.09, 0.02, 0.09, hex(0xff5a5f)); b.box(0.015, 0.06, 0, 0.008, 0.12, 0.008, hex(0x2979ff)); });
  V(8, () => { b.cyl(0, -0.055, 0, 0.03, 0.03, 0.11, 7, hex(0xd50000)); b.cyl(0, 0.055, 0, 0.026, 0.026, 0.005, 7, hex(0xcccccc)); });
  V(9, () => { b.ellip(0, 0.0, 0, 0.075, 0.07, 0.075, 6, 3, hex(0x7a4a24)); b.box(0.02, 0.07, 0, 0.006, 0.09, 0.006, hex(0xff8ac0)); });
  V(10, () => { b.cyl(0, -0.06, 0, 0.028, 0.036, 0.11, 7, hex(0xffffff)); b.cyl(0, 0.05, 0, 0.038, 0.035, 0.015, 7, hex(0x4e342e)); b.box(0, -0.06, 0, 0.075, 0.035, 0.075, hex(0x8d6e63)); });
  V(11, () => { b.box(0, -0.32, 0, 0.3, 0.32, 0.12, hex(0xffffff)); b.limb(-0.08, 0, 0, 0.08, 0, 0, 0.01, 0.01, 3, hex(0x222222)); b.box(0, -0.22, 0.062, 0.14, 0.1, 0.005, hex(0xff3b7f)); }); // shopping bag (hangs from the hand)
  return b.build(); }
const LIT = `uniform vec3 uAmb; uniform vec3 uSun; attribute vec4 aLight;`;
const SHADE = `vC = col * max(vec3(0.42), uAmb * aLight.y + uSun * (0.35 + aLight.x * 0.75));`;
const mkMat = (vert) => new THREE.ShaderMaterial({ fog: true, vertexColors: true, side: THREE.DoubleSide, vertexShader: vert,
  fragmentShader: `varying vec3 vC;\n#include <fog_pars_fragment>\nvoid main() { gl_FragColor = vec4(min(vC, vec3(1.0)), 1.0);\n#include <fog_fragment>\n}`,
  uniforms: { fogColor: { value: new THREE.Color() }, fogNear: { value: 1 }, fogFar: { value: 1000 }, fogDensity: { value: 0 }, uAmb: U.uAmb, uSun: U.uSun } });
const V_VERT = `${LIT} attribute vec3 aCol; attribute vec3 aRig; attribute float aSel; attribute float aKind; attribute float aKSel; varying vec3 vC;\n#include <fog_pars_vertex>\nvoid main() { vec3 p = position; if (abs(aKind - aKSel) > 0.5 || (aKind > 3.5 && abs(aRig.x - aSel) > 0.5)) p = vec3(0.0, -50.0, 0.0); vec3 col = color; if (aKind < 2.5 && color.r > 0.99 && color.g > 0.99 && color.b > 0.99) col = aCol; vec4 mvPosition = viewMatrix * modelMatrix * instanceMatrix * vec4(p, 1.0); gl_Position = projectionMatrix * mvPosition; ${SHADE}\n#include <fog_vertex>\n}`;
const VCOL = [0xff6b6b, 0x4dabf7, 0xffd43b, 0x69db7c];
const rgb = (h, a, i) => { a[i] = ((h >> 16) & 255) / 255; a[i + 1] = ((h >> 8) & 255) / 255; a[i + 2] = (h & 255) / 255; };
export class Vendors {
  constructor(scene) { this.scene = scene; this.o = new THREE.Object3D(); this.stats = { beach: 0, carts: 0, props: 0, stopped: 0 }; this.prev = {}; this.onCall = null; this.onLid = null; this.live = []; }
  applyPreset(p) {
    this.lo = p.name === 'LOW'; this.propRange = this.lo ? 35 : p.name === 'MEDIUM' ? 55 : 80; if (this.beach) return;
    const g = mergeKinds([beachGeo(), cartGeo(), (() => { const b = new Builder(); fig(b, W); return b.build(); })(), atmGeo(), propGeo()]); // kinds 0-4
    const N = 4 + 4 + 2 + 4 + 64; this.N = N;
    for (const [k, sz] of [['aCol', 3], ['aSel', 1], ['aKSel', 1]]) g.setAttribute(k, new THREE.InstancedBufferAttribute(new Float32Array(N * sz), sz));
    this.mesh = new THREE.InstancedMesh(g, mkMat(V_VERT), N); this.mesh.name = 'vendors+props'; this.mesh.frustumCulled = false; this.mesh.count = 0; this.mesh.visible = false; this.scene.add(this.mesh);
    this.beach = this.carts = this.balS = this.props = this.mesh;
  }
  update(sim, camera, alpha, dt, visitors) {
    if (!this.mesh) return;
    const ai = sim.ai, rz = sim.r.z, o = this.o, t = sim.t, nb = [0, 0, 0], live = [], M = this.mesh, A = M.geometry.attributes, col = A.aCol.array, sel = A.aSel.array, ks = A.aKSel.array;
    let n = 0, stopped = 0;
    const put = (kind, c, v) => { if (n >= this.N) return -1; o.updateMatrix(); M.setMatrixAt(n, o.matrix); ks[n] = kind; sel[n] = v || 0; rgb(c, col, n * 3); return n++; };
    for (const v of ai.vend || []) {
      const slot = v.bal ? 2 : v.beach ? 0 : 1; if (nb[slot] >= (v.bal ? 2 : 4)) continue;
      const moving = Math.abs(v.vx) + Math.abs(v.vz) > 0.01, hd = moving ? Math.atan2(v.vx, v.vz) + Math.PI : (v.beach ? Math.PI / 2 : Math.PI);
      const y = v.beach ? groundY(v.x, v.z) : 0;
      o.position.set(v.x, y + (moving ? Math.abs(Math.sin(t * 7 + v.id)) * 0.04 : 0), v.z); o.rotation.set(0, hd, 0); o.scale.setScalar(1); put(slot, VCOL[v.col]); nb[slot]++; v._hd = hd; v._y = y;
      const P = this.prev[v.id] || (this.prev[v.id] = { stop: 0, cd: 4 + (v.id % 7) }), stp = v.stop > 0;
      if (stp && !P.stop && this.onLid) { this.onLid(v.x, v.z); stopped++; }
      if (dt > 0 && (P.cd -= dt) <= 0) { P.cd = 9 + hash2(v.id, Math.floor(t)) * 12; if (this.onCall && (sim.ws.p.rain || 0) < 0.35) this.onCall(v.x, v.z, v.beach); }
      P.stop = stp; if (stp) stopped++; live.push({ x: v.x, z: v.z, beach: v.beach, stop: stp, bal: !!v.bal, q: v.q ? v.q.length : 0 });
    }
    // v2.5.28 ATMs on the plaza edge (static props, face the deck)
    let natm = 0; for (const q of atmsNear(rz - 60, 1)) { if (q.z > rz + 30 || q.z < rz - (this.lo ? 120 : 200) || natm >= 4) continue; o.position.set(q.x, 0, q.z); o.rotation.set(0, 0, 0); o.scale.setScalar(1); put(3, 0xffffff); natm++; }
    // hand-held props: ~22 % of walkers / beach-goers carry food or a drink; served people keep cone / popsicle
    this.held = []; const P = ai.people; let np = 0;
    for (let i = 0; i < P.length && np < 64; i++) { const a = P[i]; if (!a.active || Math.abs(a.z - rz) > this.propRange) continue;
      let v = a._cone === 1 ? 0 : a._cone === 2 ? 1 : -1;
      if (v < 0) { const h = hash2(i * 31 + a.color, Math.round(a.scale * 1000)); if (h > 0.22) continue; v = Math.floor(hash2(i, a.color * 17 + 3) * 11); if (this.lo && v > 8) v = 7; }
      if (a._bk) continue; // balloon hand busy
      const s = a.scale, ax = a.px + (a.x - a.px) * alpha, az = a.pz + (a.z - a.pz) * alpha, oh = a.hd !== undefined ? a.hd : (a.dir > 0 ? Math.PI : 0);
      const cyc = (t * 0.17 + hash2(i, 77)) % 1, eat = cyc < 0.12 ? Math.sin(cyc / 0.12 * Math.PI) : 0; // lift to the mouth now and then
      const side = -0.27 * (1 - eat * 0.7), fwd = 0.16 + eat * 0.05;
      o.position.set(ax + Math.cos(oh) * side * s + Math.sin(oh) * fwd * s, (a.y || 0) + (1.0 + eat * 0.42) * s, az - Math.sin(oh) * side * s + Math.cos(oh) * fwd * s); // left hand (balloons go in the right)
      o.rotation.set(eat * 0.6, oh, 0); o.scale.setScalar(1.5 * s); this.held.push(i); put(4, 0xffffff, v); np++; }
    this.bags = 0;
    for (const v of visitors || []) { if (!v.on || !v.item || np >= 64 || Math.abs(v.z - rz) > this.propRange) continue; // v2.5.27 café / shop customers: drink to go, shopping bag
      const oh = (v.face || 0) + Math.PI, s = v.scale || 1, bag = v.item === 1;
      o.position.set(v.x + Math.cos(oh) * 0.27 * s + Math.sin(oh) * (bag ? 0.02 : 0.16) * s, (v.x > 8 ? 0.12 : 0) + (bag ? 0.66 : 1.0) * s, v.z - Math.sin(oh) * 0.27 * s + Math.cos(oh) * (bag ? 0.02 : 0.16) * s);
      o.rotation.set(0, oh, 0); o.scale.setScalar(bag ? 1.2 : 1.5 * s); put(4, 0xffffff, bag ? 11 : 7); np++; this.bags += bag ? 1 : 0; }
    M.count = n; M.visible = n > 0; if (n) { M.instanceMatrix.needsUpdate = true; A.aCol.needsUpdate = true; A.aSel.needsUpdate = true; A.aKSel.needsUpdate = true; }
    this.stats = { balloonSellers: nb[2], beach: nb[0], carts: nb[1], props: np, atms: natm, stopped }; this.live = live;
  }
}
