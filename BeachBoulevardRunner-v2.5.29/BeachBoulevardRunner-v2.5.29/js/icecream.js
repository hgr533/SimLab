// v2.5.27 ice cream truck. A pastel truck (big cone on the roof, serving window with a striped awning, decals,
// head/tail lights) drives in the traffic lanes; at the stops of places.iceStopsNear it pulls over at the near-lane
// curb, opens the hatch and the sim queue (aicore ICE magnet) lines up on the sidewalk; people served walk off with
// a cone in hand. RAIN: no stops, no jingle (it just drives). Render-only state (own clock from the runner z).
// 3 draws when on screen (truck, hatch/awning, cones in hands).
// v2.5.28: 1 draw (truck + lights + awning merged). The truck is a real member of the traffic: it follows the car
// ahead, brakes to its stop, pulls in at the curb, waits for a gap to merge back, and re-enters the window only
// on a free stretch of lane; decor.updateCars treats it as a lead vehicle (cars behind queue / keep distance).
import * as THREE from '../vendor/three.module.js';
import { Builder, hex, mergeKinds } from './geo.js';
import { U } from './materials.js';
import { iceStopsNear, ICE_X } from './places.js';
import { LANE_IN, LANE_OUT } from './city.js';

function truckGeo() { // front toward -z (like the cars), serving side -x
  const b = new Builder(), pink = hex(0xf7b8d2), mint = hex(0xb8f0dc), cream = hex(0xfff3d6), dark = hex(0x2a2a30), glass = hex(0x6fa8c8);
  b.box(0, 0.45, 0.6, 2.2, 2.1, 4.0, cream, { top: hex(0xffffff) });          // box body
  b.box(0, 0.45, -2.15, 2.15, 1.35, 1.5, pink);                                // cab
  b.box(0, 1.25, -2.92, 1.9, 0.5, 0.04, glass);                                // windscreen
  b.box(0, 0.4, 0.6, 2.24, 0.42, 4.04, mint);                                  // lower stripe
  b.box(0, 2.1, 0.6, 2.24, 0.12, 4.04, pink);                                  // roof trim
  for (let i = 0; i < 6; i++) b.box(-1.125, 0.95, -0.8 + i * 0.55, 0.02, 0.18, 0.18, hex([0xff4d6d, 0xffd166, 0x06d6a0, 0x118ab2, 0xc77dff, 0xff9f1c][i])); // dots decal
  b.box(-1.115, 1.15, 0.6, 0.02, 0.85, 1.7, dark);                             // window opening
  b.box(1.125, 0.95, 0.6, 0.02, 0.9, 1.5, hex(0xff8fab));                      // right-side decal panel
  b.ellip(1.14, 1.4, 0.6, 0.02, 0.32, 0.32, 6, 4, hex(0xffe066));
  for (const z of [-2.0, 1.6]) for (const x of [-1.0, 1.0]) b.cyl(x, 0, z, 0.38, 0.38, 0.3, 8, dark);
  // roof cone: waffle cone + 3 scoops + cherry
  b.cyl(0, 2.22, 0.6, 0.06, 0.42, 0.95, 8, hex(0xd9a35b));
  b.ellip(0, 3.25, 0.6, 0.48, 0.38, 0.48, 8, 4, hex(0xff9ec7)); b.ellip(0, 3.6, 0.6, 0.4, 0.32, 0.4, 8, 4, hex(0xfff1c1)); b.ellip(0, 3.88, 0.6, 0.3, 0.26, 0.3, 8, 4, hex(0x8b5a3c));
  b.ellip(0, 4.17, 0.6, 0.1, 0.1, 0.1, 5, 3, hex(0xe0002a));
  return b.build();
}
function hatchGeo() { const b = new Builder(); // striped awning (pivot at its top edge, folds down when closed)
  for (let i = 0; i < 7; i++) b.box(-0.45, -0.02, -0.85 + i * 0.243 + 0.12, 0.9, 0.04, 0.243, hex(i % 2 ? 0xffffff : 0xff4d6d)); return b.build(); }
function lightsGeo() { const b = new Builder(); for (const x of [-0.8, 0.8]) { b.box(x, 0.75, -2.92, 0.3, 0.18, 0.04, hex(0xfff6d0)); b.box(x, 0.75, 2.62, 0.25, 0.18, 0.04, hex(0xff2020)); } return b.build(); }
function coneGeo() { const b = new Builder(); b.cyl(0, -0.16, 0, 0.012, 0.05, 0.16, 6, hex(0xd9a35b)); b.ellip(0, 0.02, 0, 0.06, 0.055, 0.06, 6, 3, hex(0xffffff)); return b.build(); }
const VERT = `attribute vec4 aLight; attribute vec3 aCol; attribute float aKind; attribute float aKSel; uniform vec3 uAmb; uniform vec3 uSun; uniform float uGlow; varying vec3 vC;
#include <fog_pars_vertex>
void main() { bool show = aKSel < 0.5 ? aKind < 1.5 : abs(aKind - aKSel) < 0.5;
  vec4 mvPosition = viewMatrix * modelMatrix * instanceMatrix * vec4(show ? position : vec3(0.0, -60.0, 0.0), 1.0); gl_Position = projectionMatrix * mvPosition;
  vec3 c = color; vC = (aKind > 0.5 && aKind < 1.5) ? c * (0.55 + (0.01 + uGlow) * 1.6) : c * max(vec3(0.42), uAmb * aLight.y + uSun * (0.35 + aLight.x * 0.75));
  #include <fog_vertex>
}`;
const FRAG = `varying vec3 vC;
#include <fog_pars_fragment>
void main() { gl_FragColor = vec4(min(vC, vec3(1.0)), 1.0);
#include <fog_fragment>
}`;
export const TRUCK_LEN = 5.6;
const CRUISE = 8.2;
export class IceCream {
  constructor(scene) { this.scene = scene; this.enabled = true; this.stats = { stops: 0, open: false, rain: false, cones: 0, merges: 0, respawns: 0 }; this.live = null; this.lane = null; this.o = new THREE.Object3D();
    this.mode = 'off'; this.z = 0; this.v = 0; this.x = LANE_IN; this.dir = 1; this.ph = 0; this.stopId = -1; this.done = new Set(); this.open = 0; }
  applyPreset() {
    if (this.mesh) return;
    const g = mergeKinds([truckGeo(), lightsGeo(), hatchGeo()]);
    g.setAttribute('aCol', new THREE.InstancedBufferAttribute(new Float32Array(9).fill(1), 3));
    this.aK = new THREE.InstancedBufferAttribute(new Float32Array([0, 1, 2]), 1); g.setAttribute('aKSel', this.aK);
    const mat = new THREE.ShaderMaterial({ fog: true, vertexColors: true, side: THREE.DoubleSide, vertexShader: VERT, fragmentShader: FRAG,
      uniforms: { fogColor: { value: new THREE.Color() }, fogNear: { value: 1 }, fogFar: { value: 1000 }, fogDensity: { value: 0 }, uAmb: U.uAmb, uSun: U.uSun, uGlow: { value: 0 } } });
    this.mesh = new THREE.InstancedMesh(g, mat, 2); this.mesh.name = 'icecream-truck'; this.mesh.frustumCulled = false; this.mesh.count = 0; this.mesh.visible = false; this.scene.add(this.mesh);
    this.aK.array[0] = 0; this.aK.array[1] = 2; // instance 0: body + lights, instance 1: awning
    this.truck = this.mesh;
  }
  laneCars(dir) { return (this.cars || []).filter((c) => c.z < 1e8 && c.dir === dir); }
  clearAt(dir, z, fwd = 9, back = 9) { for (const c of this.laneCars(dir)) { const d = (c.z - z) * dir; if (d > -back - c.len * 0.5 && d < fwd + c.len * 0.5) return false; } return true; }
  update(sim, camera, dt, lightLevel) {
    if (!this.mesh) return;
    const rz = sim.r.z, rain = (sim.ws.p.rain || 0) > 0.35, o = this.o, L2 = TRUCK_LEN / 2;
    if (!this.enabled) { this.mesh.visible = false; this.mesh.count = 0; this.live = null; this.lane = null; this.mode = 'off'; return; }
    if (this.mode === 'off' || sim.t < (this.lastT || 0) - 1) { this.mode = 'spawn'; this.done.clear(); }
    this.lastT = sim.t;
    // (re)enter at the far end of the window on a free stretch of lane (near lane when a stop is coming up)
    if (this.mode === 'spawn') {
      const soon = rain ? null : iceStopsNear(rz - 150, 1).find((q) => q.z < rz - 70 && q.z > rz - 215 && !this.done.has(q.id));
      this.dir = soon || this.stats.respawns % 3 !== 2 ? 1 : -1;
      const z0 = this.dir < 0 ? rz + 38 : soon ? Math.max(rz - 240, soon.z - 32) : rz - 205; // a stop coming up: enter just beyond it
      let zz = null; for (let k = 0; k < 12 && zz === null; k++) { const z = z0 + (this.dir > 0 ? -k * 6 : k * 4); if (this.clearAt(this.dir, z, 10, 10)) zz = z; }
      if (zz === null) { this.mesh.visible = false; this.mesh.count = 0; this.live = null; this.lane = null; return; } // lane packed: try next frame
      this.z = zz; this.v = CRUISE * 0.8; this.x = this.dir > 0 ? LANE_IN : LANE_OUT; this.mode = 'drive'; this.stats.respawns++; this.stopId = -1; this.open = 0;
    }
    const laneX = this.dir > 0 ? LANE_IN : LANE_OUT;
    // nearest vehicle ahead in this lane
    let gapA = 1e9, leadV = 0; for (const c of this.laneCars(this.dir)) { const g = (c.z - this.z) * this.dir - (c.len + TRUCK_LEN) * 0.5; if (g > -1.5 && g < gapA) { gapA = g; leadV = c.v; } }
    let vWant = CRUISE;
    if (gapA < 16) vWant = Math.min(vWant, Math.max(0, (gapA - 2.4) * 0.8), leadV + Math.max(0, gapA - 4) * 0.4);
    if (this.mode === 'drive') {
      if (this.dir > 0 && !rain && this.stopId < 0) { const st = iceStopsNear(this.z + 40, 1).find((q) => q.z > this.z + 12 && q.z < this.z + 90 && q.z < rz - 25 && !this.done.has(q.id)); if (st) { this.stopId = st.id; this.stopZ = st.z; } }
      if (this.stopId >= 0) { const dist = this.stopZ - this.z; if (rain || this.stopZ > rz - 8) { this.done.add(this.stopId); this.stopId = -1; }
        else { vWant = Math.min(vWant, Math.sqrt(2 * 1.6 * Math.max(0, dist - 0.3))); if (dist < 0.6 && this.v < 0.6) { this.mode = 'pull'; this.ph = 0; this.stats.stops++; } } }
      this.v += (vWant - this.v) * Math.min(1, dt * 2.0); if (this.v < 0.02) this.v = 0;
      this.z += this.dir * this.v * dt;
      if (gapA < 0.8) this.z -= this.dir * (0.8 - gapA); // never into the car ahead
      this.x += (laneX - this.x) * Math.min(1, dt * 1.5);
    } else if (this.mode === 'pull' || this.mode === 'serve') {
      this.v = 0; this.ph += dt;
      this.x += (ICE_X - this.x) * Math.min(1, dt * 1.2);
      if (this.mode === 'pull' && this.ph > 2.5) { this.mode = 'serve'; this.ph = 0; }
      if (this.mode === 'serve') { this.open = Math.min(1, this.ph / 1.5); if (rain || this.ph > 16 || this.stopZ > rz + 4) { this.mode = 'close'; this.ph = 0; } }
    } else if (this.mode === 'close') { // shut the hatch, wait for a gap behind, merge back
      this.ph += dt; this.open = Math.max(0, 1 - this.ph / 1.0);
      if (this.ph > 1.2 && this.clearAt(this.dir, this.z, 3, 14)) { this.mode = 'merge'; this.done.add(this.stopId); this.stopId = -1; this.stats.merges++; }
    } else if (this.mode === 'merge') {
      this.x += (laneX - this.x) * Math.min(1, dt * 1.4); this.v += (Math.min(vWant, 4) - this.v) * Math.min(1, dt * 1.5); this.z += this.dir * this.v * dt;
      if (gapA < 0.8) this.z -= this.dir * (0.8 - gapA);
      if (Math.abs(this.x - laneX) < 0.08) this.mode = 'drive';
    }
    if (this.mode === 'drive' && (this.z > rz + 46 || this.z < rz - 235)) { this.mode = 'spawn'; this.mesh.visible = false; this.live = null; this.lane = null; return; }
    const x = this.x, z = this.z, fw = this.dir > 0, open = this.open;
    // model front -z, serving side -x. Toward +z: mirror x then turn PI, so the window still faces -x (the curb)
    o.position.set(x, 0, z); o.rotation.set(0, fw ? Math.PI : 0, 0); o.scale.set(fw ? -1 : 1, 1, 1); o.updateMatrix(); this.mesh.setMatrixAt(0, o.matrix);
    this.mesh.material.uniforms.uGlow.value = lightLevel;
    // awning hinged at the top of the window (x - 1.13, y 1.62), hangs down when shut, swings out when open
    o.position.set(x - 1.13, 1.62, z + (fw ? -0.6 : 0.6)); o.scale.set(1, 1, 1); o.rotation.set(0, 0, Math.PI / 2 * (1 - open * 0.88)); o.updateMatrix(); this.mesh.setMatrixAt(1, o.matrix);
    this.mesh.count = open > 0.02 ? 2 : 1; this.mesh.visible = true; this.mesh.instanceMatrix.needsUpdate = true;
    // lane occupancy for decor.updateCars: the truck blocks its lane unless it is fully in at the curb
    this.lane = { dir: this.dir, z, len: TRUCK_LEN, v: this.v, x, occ: Math.abs(x - laneX) < 1.6 || this.mode === 'merge' };
    this.stats.open = open > 0.5; this.stats.rain = rain; this.stats.cones = 0; this.stats.state = this.mode === 'drive' || this.mode === 'merge' ? 'drive' : 'stop'; this.stats.mode = this.mode; this.stats.x = +x.toFixed(2); this.stats.z = +z.toFixed(1);
    this.live = { x, z, v: this.dir * this.v, jingle: !rain && (this.mode !== 'drive' || true), open };
  }
}
