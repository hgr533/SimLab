// v2.5.29 bikes & scooters for the crowd (render only, own seeded RNG; the sim / determinism never see it).
// - Rental docks (Tel-O-Fun style: green bikes in a rail + pay kiosk) with a shared e-scooter parking spot, on the
//   plaza just past the red bike lane, ~every 270 m, kept clear of plaza cafes, ATMs and ice cream truck stops.
// - Free will: a passer-by with money walks up, pays at the kiosk (unified wallet: walletFor / payFrom), takes a
//   bike or scooter, rides with the flow (bike lane by direction; some scooters on the deck, as in real life),
//   then docks / parks at a later station (scooters are sometimes just left lying on the plaza).
// - Owners ride their own bikes (kids' bike, cruiser, road bike) or scooters (kick, e-scooter); some stop at a plaza
//   cafe, lock up at the rack and go in. Riders yield to crosswalks, keep a gap to the decor riders, and deck scooters
//   steer around the runner and walkers (decor only, like the existing cyclists: no hits, no unfair blocks).
// - Rain: fewer riders, no scooters ridden (they stay parked).
// ONE InstancedMesh (aKind selects the part): docks, parked / docked vehicles, riders and their vehicles = 1 draw.
import * as THREE from '../vendor/three.module.js';
import { Builder, hex, mergeKinds } from './geo.js';
import { U } from './materials.js';
import { makeRng, hash2 } from './rng.js';
import { plazaResolve, plazaHit, plazaObstacles, atmsNear, iceCorridor, plazaCafeNear, PCAFE_X } from './places.js';
import { walletFor, payFrom } from './aicore.js';

export const DOCK_X = 9.2, DOCK_EVERY = 270, DOCK_OFF = 160, DOCK_LEN = 6.4, SCO_DZ = 7.6; // dock rail z..z+6.4, scooter spot z+7.6..+10
const _dz = new Map();
export function dockZ(k) {
  if (_dz.has(k)) return _dz.get(k);
  const z0 = -(DOCK_OFF + DOCK_EVERY * k); let z = null;
  const clear = (zz) => { for (let s = -1; s <= 11; s += 1.5) if (plazaHit(DOCK_X, zz + s, 1.6)) return false;
    if (iceCorridor(zz, 3) || iceCorridor(zz + 10, 3)) return false;
    for (const a of atmsNear(zz, 1)) if (a.z > zz - 4 && a.z < zz + 14) return false;
    for (const o of plazaObstacles(zz)) if (o.x < DOCK_X + 1.6 + o.r && o.x > DOCK_X - 0.7 - o.r && o.z > zz - 1 - o.r && o.z < zz + 11 + o.r) return false;
    return true; };
  for (const d of [0, 8, -8, 16, -16, 24, -24, 32, -32, 40, -40]) { const zz = z0 + d; if (clear(zz)) { z = zz; break; } }
  _dz.set(k, z); if (_dz.size > 200) _dz.delete(_dz.keys().next().value); return z;
}
export function docksNear(z, span = 1) { const c = Math.round((-z - DOCK_OFF) / DOCK_EVERY), out = []; for (let k = c - span; k <= c + span; k++) { if (k < 0) continue; const zz = dockZ(k); if (zz !== null) out.push({ id: k, x: DOCK_X, z: zz }); } return out; }

// ---------------- geometry (local: forward is -z, ground y 0) ----------------
const STEEL = hex(0x8a9099), DARK = hex(0x22252b), TYRE = hex(0x161616), SKIN = hex(0xc58c63), W = [1, 1, 1], GREEN = hex(0x2e9e48);
function wheel(b, z, y, r, c = TYRE) { // tyre ring (10 segments) + two spokes + hub: see-through like a real wheel
  const n = 10, w = 2 * r * Math.sin(Math.PI / n) + 0.01;
  for (let i = 0; i < n; i++) { const a = (i + 0.5) / n * Math.PI * 2; b.push(); b.translate(0, y + Math.cos(a) * r, z + Math.sin(a) * r); b.rotX(a); b.box(0, -0.025, 0, 0.045, 0.05, w, c); b.pop(); }
  b.box(0, y - r, z, 0.012, 2 * r, 0.012, STEEL); b.push(); b.translate(0, y, z); b.rotX(Math.PI / 2); b.box(0, -r, 0, 0.012, 2 * r, 0.012, STEEL); b.pop(); b.box(0, y - 0.03, z, 0.06, 0.06, 0.06, STEEL); }
function bikeGeo(o) { // o: frame colour (W = tinted per instance), wheel r, saddle h, bar h, basket
  const b = new Builder(), r = o.r, f = o.c, zf = -0.52 * o.s, zr = 0.52 * o.s;
  wheel(b, zf, r, r); wheel(b, zr, r, r);
  b.limb(0, r, zr, 0, o.sad - 0.06, zr * 0.25, 0.022, 0.022, 4, f); // seat tube
  b.limb(0, o.sad - 0.1, zr * 0.25, 0, o.bar - 0.08, zf * 0.75, 0.024, 0.024, 4, f); // top tube
  b.limb(0, r, zr * 0.1, 0, o.bar - 0.12, zf * 0.75, 0.024, 0.024, 4, f); // down tube
  b.limb(0, r, zr, 0, r, zr * 0.1, 0.018, 0.018, 4, f); b.limb(0, r, zf, 0, o.bar, zf * 0.8, 0.02, 0.02, 4, f); // chain stay, fork
  b.box(0, o.sad - 0.05, zr * 0.25, 0.14, 0.06, 0.24, DARK); // saddle
  b.limb(-0.26, o.bar, zf * 0.8 + 0.06, 0.26, o.bar, zf * 0.8 + 0.06, 0.016, 0.016, 4, o.road ? f : DARK); // handlebar
  if (o.basket) b.box(0, o.bar - 0.18, zf - 0.02, 0.32, 0.2, 0.26, o.basket);
  if (o.fender) b.box(0, r * 2 + 0.01, zr, 0.08, 0.02, 0.5, f);
  return b.build();
}
function scooterGeo(e) { const b = new Builder(), c = e ? hex(0x3c3f46) : W;
  wheel(b, -0.42, 0.1, 0.1); wheel(b, 0.38, 0.1, 0.1);
  b.box(0, 0.08, -0.02, 0.15, 0.06, 0.78, c, { top: DARK }); b.limb(0, 0.12, -0.42, 0, 1.0, -0.36, 0.02, 0.02, 4, e ? hex(0xb8c0c8) : STEEL);
  b.limb(-0.22, 1.0, -0.36, 0.22, 1.0, -0.36, 0.016, 0.016, 4, DARK);
  if (e) { b.box(0, 0.72, -0.4, 0.12, 0.2, 0.05, hex(0x9be15d)); b.box(0, 0.05, 0.38, 0.1, 0.1, 0.12, hex(0xe53935)); } // shared e-scooter: lime panel, tail light
  return b.build(); }
function personGeo() { // rig.x: 1 left leg, 2 right leg, 3 arms, 4 upper body (hinged at hip 0.82)
  const b = new Builder({ rig: true });
  b.rig = [1, 0, 0]; b.box(-0.1, 0, 0, 0.13, 0.5, 0.15, SKIN); b.box(-0.1, 0.5, 0, 0.15, 0.32, 0.17, hex(0x2f3b52)); b.box(-0.1, 0, -0.04, 0.14, 0.07, 0.24, DARK);
  b.rig = [2, 0, 0]; b.box(0.1, 0, 0, 0.13, 0.5, 0.15, SKIN); b.box(0.1, 0.5, 0, 0.15, 0.32, 0.17, hex(0x2f3b52)); b.box(0.1, 0, -0.04, 0.14, 0.07, 0.24, DARK);
  b.rig = [4, 0, 0]; b.box(0, 0.8, 0, 0.36, 0.6, 0.22, W); b.box(0, 1.4, 0, 0.1, 0.06, 0.1, SKIN); b.box(0, 1.46, 0, 0.2, 0.22, 0.21, SKIN); b.box(0, 1.62, 0.02, 0.22, 0.08, 0.23, hex(0x2b1d14));
  b.rig = [3, 0, 0]; for (const s of [-1, 1]) { b.box(s * 0.24, 0.82, 0, 0.09, 0.56, 0.1, W); b.box(s * 0.24, 0.78, 0, 0.08, 0.1, 0.09, SKIN); }
  return b.build(); }
function dockGeo() { // along +z from 0 to DOCK_LEN at local x 0 (bikes stand at x ~ +0.2 pointing +x); kiosk at z -0.6
  const b = new Builder();
  b.box(0.3, 0, DOCK_LEN / 2, 1.9, 0.02, DOCK_LEN + 1.4, hex(0x8f8a80));
  b.box(-0.35, 0, DOCK_LEN / 2, 0.12, 0.42, DOCK_LEN, hex(0x3b3f46)); // rail
  for (let i = 0; i < 7; i++) b.box(-0.25, 0, 0.35 + i * 0.95, 0.14, 0.55, 0.1, hex(0x1f7a38)); // docking posts
  b.box(-0.3, 0, -0.75, 0.42, 1.55, 0.36, hex(0x1f7a38)); b.box(-0.08, 1.0, -0.75, 0.04, 0.32, 0.26, hex(0x0d1b2a)); b.box(-0.3, 1.55, -0.75, 0.6, 0.12, 0.5, GREEN);
  b.box(-0.3, 1.67, -0.75, 0.06, 0.6, 0.06, STEEL); b.box(-0.3, 2.25, -0.75, 0.08, 0.36, 0.9, GREEN); b.box(-0.25, 2.3, -0.75, 0.02, 0.24, 0.6, hex(0xffffff)); // sign
  // shared e-scooter parking: painted box + post
  b.box(0.15, 0.005, SCO_DZ + 1.2, 1.5, 0.02, 2.6, hex(0x7cc243)); b.box(0.15, 0.012, SCO_DZ + 1.2, 1.3, 0.02, 2.4, hex(0x6c6a66));
  b.box(-0.6, 0, SCO_DZ, 0.06, 1.2, 0.06, STEEL); b.box(-0.6, 1.0, SCO_DZ, 0.05, 0.3, 0.4, hex(0x7cc243));
  return b.build(); }
function rackGeo() { const b = new Builder(); for (let i = 0; i < 3; i++) { const z = i * 0.8; b.limb(0, 0, z - 0.25, 0, 0.7, z - 0.25, 0.025, 0.025, 4, STEEL); b.limb(0, 0.7, z - 0.25, 0, 0.7, z + 0.25, 0.025, 0.025, 4, STEEL); b.limb(0, 0, z + 0.25, 0, 0.7, z + 0.25, 0.025, 0.025, 4, STEEL); } return b.build(); }
// kinds (merge order): 0 person, 1 rental bike, 2 e-scooter, 3 kids' bike, 4 cruiser, 5 road bike, 6 kick scooter, 7 dock, 8 rack
const K = { P: 0, RENT: 1, ESC: 2, KID: 3, CRU: 4, ROAD: 5, KICK: 6, DOCK: 7, RACK: 8 };
const SAD = { 1: 0.9, 3: 0.58, 4: 0.86, 5: 0.95 }; // saddle height per bike kind
const VMAX = { 1: [3.8, 5.5], 2: [4, 6], 3: [2.2, 3.2], 4: [3.2, 4.6], 5: [6, 8], 6: [2.4, 3.6] };
const VERT = `attribute vec4 aLight; attribute vec3 aRig; attribute vec4 aSel; attribute vec3 aPose; attribute float aKind; uniform vec3 uAmb; uniform vec3 uSun; varying vec3 vC;
#include <fog_pars_vertex>
vec3 rx(vec3 p, float py, float pz, float a) { float c = cos(a), s = sin(a), y = p.y - py, z = p.z - pz; return vec3(p.x, py + y * c - z * s, pz + y * s + z * c); }
void main() { vec3 p = position;
  if (abs(aKind - aSel.x) > 0.5) p = vec3(0.0, -60.0, 0.0);
  else if (aKind < 0.5) { // rider pose: aPose.x mode (0 walk, 1 seated pedal, 2 stand on scooter, 3 stand), y phase, z lean
    float m = aPose.x, ph = aPose.y, a = 0.0;
    if (aRig.x > 0.5 && aRig.x < 2.5) { float sd = aRig.x < 1.5 ? 0.0 : 3.14159;
      if (m < 0.5) a = 0.45 * sin(ph + sd); else if (m < 1.5) a = 0.95 + 0.42 * sin(ph + sd); else if (m < 2.5) a = aRig.x < 1.5 ? 0.12 : -0.08;
      p = rx(p, 0.82, 0.0, a); }
    if (aRig.x > 2.5) { float aa = m < 0.5 ? -0.4 * sin(ph) : (m < 2.5 ? 1.05 : 0.1); p = rx(p, 1.36, 0.0, aa); }
    if (aRig.x > 2.5) p = rx(p, 0.82, 0.0, -aPose.z);
  }
  vec3 col = color; if (color.r > 0.99 && color.g > 0.99 && color.b > 0.99) col = aSel.yzw;
  vec4 mvPosition = viewMatrix * modelMatrix * instanceMatrix * vec4(p, 1.0); gl_Position = projectionMatrix * mvPosition;
  vC = col * max(vec3(0.42), uAmb * aLight.y + uSun * (0.35 + aLight.x * 0.75));
  #include <fog_vertex>
}`;
const FRAG = `varying vec3 vC;\n#include <fog_pars_fragment>\nvoid main() { gl_FragColor = vec4(min(vC, vec3(1.0)), 1.0);\n#include <fog_fragment>\n}`;
const SHIRT = [0xe53935, 0x1e88e5, 0xfdd835, 0x43a047, 0xffffff, 0x8e24aa, 0xfb8c00, 0x00acc1, 0x212121, 0xf06292];
const FRAME = [0xd32f2f, 0x1565c0, 0x212121, 0xf5f5f5, 0x00897b, 0xf9a825, 0x6a1b9a, 0x90a4ae];
const rgb = (c) => [((c >> 16) & 255) / 255, ((c >> 8) & 255) / 255, (c & 255) / 255];
const MAXI = 190;
const POOL = { LOW: 3, MEDIUM: 5, HIGH: 7, ULTRA: 9 };

export class Bikes {
  constructor(scene) { this.scene = scene; this.enabled = true; this.r = makeRng(0x5b1e29); this.ag = []; this.dockN = new Map(); this.scoN = new Map(); this.left = []; this.locked = [];
    this.o = new THREE.Object3D(); this.econ = { spent: 0, buys: 0, tips: 0, broke: 0, rent: 0, skipped: 0 };
    this.stats = { rentals: 0, returns: 0, parked: 0, leftLying: 0, locked: 0, owners: 0, deck: 0, lane: 0, refused: 0, inst: 0, riders: 0 }; this.onBell = null; this.onDock = null; this.live = []; }
  applyPreset(p) {
    this.name = p.name; this.lo = p.name === 'LOW'; this.pool = POOL[p.name] || 3; this.range = this.lo ? 110 : p.name === 'MEDIUM' ? 140 : 170;
    while (this.ag.length < this.pool) this.ag.push({ on: false, cd: this.r.range(0, 4), i: this.ag.length });
    this.ag.length = this.pool; for (const a of this.ag) if (a.on) this.finish(a, true);
    if (this.mesh) return;
    const g = mergeKinds([personGeo(), bikeGeo({ c: GREEN, r: 0.33, s: 1, sad: 0.9, bar: 0.98, basket: hex(0x1f7a38), fender: true }), scooterGeo(true),
      bikeGeo({ c: W, r: 0.22, s: 0.72, sad: 0.58, bar: 0.66 }), bikeGeo({ c: W, r: 0.34, s: 1.05, sad: 0.86, bar: 1.02, basket: hex(0x8d6e63), fender: true }),
      bikeGeo({ c: W, r: 0.34, s: 1.02, sad: 0.95, bar: 0.9, road: true }), scooterGeo(false), dockGeo(), rackGeo()]);
    this.aSel = new THREE.InstancedBufferAttribute(new Float32Array(MAXI * 4), 4); g.setAttribute('aSel', this.aSel);
    this.aPose = new THREE.InstancedBufferAttribute(new Float32Array(MAXI * 3), 3); g.setAttribute('aPose', this.aPose);
    this.mesh = new THREE.InstancedMesh(g, new THREE.ShaderMaterial({ fog: true, vertexColors: true, side: THREE.DoubleSide, vertexShader: VERT, fragmentShader: FRAG,
      uniforms: { fogColor: { value: new THREE.Color() }, fogNear: { value: 1 }, fogFar: { value: 1000 }, fogDensity: { value: 0 }, uAmb: U.uAmb, uSun: U.uSun } }), MAXI);
    this.mesh.name = 'bikes'; this.mesh.frustumCulled = false; this.mesh.count = 0; this.scene.add(this.mesh);
  }
  docked(k) { if (!this.dockN.has(k)) this.dockN.set(k, 2 + Math.floor(hash2(k, 7301) * 5)); return this.dockN.get(k); }
  scoots(k) { if (!this.scoN.has(k)) this.scoN.set(k, 1 + Math.floor(hash2(k, 7302) * 4)); return this.scoN.get(k); }
  put(kind, x, y, z, ry, s, col, pose, rz = 0, rx = 0) {
    if (this.n >= MAXI) return; const o = this.o, j = this.n++;
    o.position.set(x, y, z); o.rotation.set(rx, ry, rz, 'YXZ'); o.scale.setScalar(s); o.updateMatrix(); this.mesh.setMatrixAt(j, o.matrix);
    const c = rgb(col); this.aSel.setXYZW(j, kind, c[0], c[1], c[2]); if (pose) this.aPose.setXYZ(j, pose[0], pose[1], pose[2]); else this.aPose.setXYZ(j, 3, 0, 0);
  }
  spawn(a, sim, camZ, rain, docks, decor) {
    const r = this.r; const ahead = docks.filter((d) => d.z < camZ - 25 && d.z > camZ - this.range + 20);
    const rent = ahead.length && r.chance(0.6);
    const dir = r.chance(0.5) ? -1 : 1; let veh;
    Object.assign(a, { on: true, inLane: false, t: 0, dir, ph: r.range(0, 6.28), col: SHIRT[r.int(0, SHIRT.length - 1)], s: r.range(0.94, 1.06), cash: walletFor(r.int(0, 4), r), xT: 0, lean: 0, deck: false, stopAt: null, target: null, lock: null });
    if (rent && r.chance(0.45)) { // mid-trip rental riding toward the camera, returning at a dock ahead
      const far = ahead.filter((d) => d.z < camZ - 75), d = far.length ? far[r.int(0, far.length - 1)] : ahead[ahead.length - 1], esc = !rain && r.chance(0.45);
      Object.assign(a, { own: false, veh: esc ? K.ESC : K.RENT, dock: { id: d.id + 1 }, dir: 1, z: d.z + (esc ? SCO_DZ : 3) - r.range(10, 24) });
      this.mountRide(a, sim); a.x = a.xT; a.v = a.vT; a.target = d; this.stats.midTrip = (this.stats.midTrip || 0) + 1; return;
    }
    if (rent) {
      const d = ahead[r.int(0, ahead.length - 1)]; veh = rain || r.chance(0.55) ? K.RENT : K.ESC;
      if (veh === K.RENT && this.docked(d.id) <= 0) veh = K.ESC; if (veh === K.ESC && this.scoots(d.id) <= 0) veh = K.RENT;
      if (veh === K.RENT && this.docked(d.id) <= 0) { a.on = false; a.cd = 2; return; }
      Object.assign(a, { own: false, veh, st: 'walkin', dock: d, x: 12.2 + r.range(-0.5, 1.2), z: d.z + (veh === K.RENT ? r.range(1, 5) : SCO_DZ + 1), v: 1.25 });
      a.tx = DOCK_X + 0.9; a.tz = veh === K.RENT ? d.z - 0.75 : d.z + SCO_DZ + 1.2; if (veh === K.RENT) a.tx = DOCK_X + 0.55;
    } else {
      const own = [K.KID, K.CRU, K.CRU, K.ROAD, K.ROAD, K.KICK, K.ESC]; veh = own[r.int(0, own.length - 1)]; if (rain && (veh === K.KICK || veh === K.ESC)) veh = K.CRU;
      const z = dir < 0 ? camZ + r.range(5, 15) : camZ - this.range + r.range(0, 20);
      Object.assign(a, { own: true, veh, st: 'ride', z, frame: FRAME[r.int(0, FRAME.length - 1)] }); this.stats.owners++;
      if (veh === K.KID) a.s = r.range(0.66, 0.74);
      this.mountRide(a, sim); a.x = a.xT; a.v = a.vT;
      if (r.chance(0.3)) { const cz = plazaCafeNear(a.z + dir * 40, 40); if (cz !== null && (cz - a.z) * dir > 15 && this.rackZ(cz) !== null) a.stopAt = cz; }
    }
  }
  mountRide(a, sim) { const r = this.r, sc = a.veh === K.ESC || a.veh === K.KICK;
    a.deck = sc && r.chance(0.4); a.st = 'ride'; a.vT = r.range(...VMAX[a.veh]) * (a.deck ? 0.7 : 1); a.v = a.v || 0.5;
    a.xT = a.deck ? (a.dir < 0 ? r.range(-3.0, -1.6) : r.range(1.6, 3.0)) : (a.dir < 0 ? 4.95 : 5.85) + r.range(-0.15, 0.15);
    if (a.deck) this.stats.deck++; else this.stats.lane++;
    if (!a.own) { const later = []; for (let k = a.dock.id + a.dir * -1; Math.abs(k - a.dock.id) <= 3; k -= a.dir) { if (k < 0) break; const z = dockZ(k); if (z !== null) later.push({ id: k, x: DOCK_X, z }); }
      a.target = later.length ? later[r.int(0, Math.min(1, later.length - 1))] : null; }
  }
  finish(a, quiet) { a.on = false; a.cd = this.r.range(this.rain ? 8 : 1.5, this.rain ? 18 : 6); }
  update(sim, camera, dt, decor) {
    if (!this.mesh) return;
    const t = sim.t, rain = (sim.ws.p.rain || 0) > 0.35, camZ = camera.position.z, rz = sim.r.z, rxr = sim.r.x, r = this.r; this.rain = rain; this.n = 0;
    if (!this.enabled) { this.mesh.count = 0; this.mesh.visible = false; this.live = []; return; }
    const docks = docksNear(camZ - this.range * 0.45, 2).filter((d) => d.z < camZ + 30 && d.z > camZ - this.range - 10);
    // static: docks, docked bikes, parked scooters, cafe racks with locked bikes
    for (const d of docks) { const far = d.z < camZ - (this.lo ? 70 : 120);
      this.put(K.DOCK, d.x, 0, d.z, 0, 1, 0xffffff);
      if (!far) { const nb = this.docked(d.id); for (let i = 0; i < Math.min(7, nb); i++) this.put(K.RENT, d.x + 0.25, 0, d.z + 0.35 + i * 0.95, Math.PI / 2, 1, 0xffffff);
        const ns = rain ? Math.max(this.scoots(d.id), 3) : this.scoots(d.id); for (let i = 0; i < Math.min(5, ns); i++) this.put(K.ESC, d.x + 0.15, 0, d.z + SCO_DZ + 0.2 + i * 0.5, Math.PI / 2 + 0.15, 1, 0xffffff); } }
    const cafes = []; for (let z = Math.ceil(camZ / 100) * 100; z > camZ - this.range; z -= 50) { const c = plazaCafeNear(z, 30); if (c !== null && !cafes.includes(c) && c < camZ + 20 && c > camZ - this.range) cafes.push(c); }
    for (const cz of cafes) { const rz0 = this.rackZ(cz); if (rz0 === null) continue; this.put(K.RACK, 8.0, 0, rz0, 0, 1, 0xffffff);
      const nl = Math.floor(hash2(Math.round(cz), 7303) * 3); for (let i = 0; i < nl; i++) { const kk = [K.CRU, K.ROAD, K.KID][Math.floor(hash2(Math.round(cz) + i, 7304) * 3)]; this.put(kk, 8.0, 0, rz0 + i * 0.8, Math.PI / 2, kk === K.KID ? 1 : 1, FRAME[Math.floor(hash2(Math.round(cz), 7305 + i) * FRAME.length)]); } }
    this.locked = this.locked.filter((l) => l.z < camZ + 30 && l.z > camZ - this.range - 20); for (const l of this.locked) this.put(l.veh, l.x, 0, l.z, Math.PI / 2, 1, l.col);
    this.left = this.left.filter((l) => l.z < camZ + 30 && l.z > camZ - this.range - 20); for (const l of this.left) this.put(K.ESC, l.x, 0.06, l.z, l.ry, 1, 0xffffff, null, 1.42);
    // agents
    const P = sim.ai.people, live = [];
    for (const a of this.ag) {
      if (!a.on) { if (dt > 0 && (a.cd -= dt) <= 0) { if (rain && r.chance(0.6)) a.cd = r.range(6, 14); else this.spawn(a, sim, camZ, rain, docks, decor); } if (!a.on) continue; }
      if (a.z > camZ + 35 || a.z < camZ - this.range - 40) { this.finish(a); continue; }
      a.t += dt; let pose = [0, a.ph, 0], y = 0, ry = a.dir < 0 ? 0 : Math.PI, onVeh = false;
      if (a.st === 'walkin' || a.st === 'walkout') {
        const dx = a.tx - a.x, dz = a.tz - a.z, d = Math.hypot(dx, dz);
        if (d > 0.08) { const st = Math.min(d, a.v * dt); a.x += dx / d * st; a.z += dz / d * st; plazaResolve(a, 0.3); ry = Math.atan2(-dx, -dz); a.ph += dt * 7; }
        else if (a.st === 'walkin') { a.st = 'pay'; a.t = 0; } else { this.finish(a); continue; }
        pose = [0, a.ph, 0];
      } else if (a.st === 'pay') { ry = a.veh === K.RENT ? Math.PI / 2 : Math.PI / 2; pose = [3, 0, 0];
        if (a.t > 2.6) { const cost = a.veh === K.RENT ? 6 : 5;
          if (payFrom(a, cost, this.econ, 'rent') < cost) { this.stats.refused++; a.st = 'walkout'; a.tx = 12.6; a.tz = a.z + 3; }
          else { this.stats.rentals++; if (a.veh === K.RENT) this.dockN.set(a.dock.id, this.docked(a.dock.id) - 1); else this.scoN.set(a.dock.id, this.scoots(a.dock.id) - 1);
            if (this.onDock) this.onDock(a.x, a.z, 'unlock'); a.st = 'mount'; a.t = 0; a.x = DOCK_X + 1.25; a.v = 0; } } }
      else if (a.st === 'mount') { onVeh = true; ry = a.dir < 0 ? 0 : Math.PI; pose = [3, 0, 0]; if (a.t > 0.9) this.mountRide(a, sim); }
      else if (a.st === 'ride' || a.st === 'arrive') {
        onVeh = true; let vT = rain && !a.deck ? a.vT * 0.85 : a.vT;
        if (rain && (a.veh === K.ESC || a.veh === K.KICK) && !a.target && a.stopAt === null) { // rain: scooters go park at the next dock
          const nx = docksNear(a.z, 2).filter((d) => (d.z - a.z) * a.dir > 12).sort((p, q) => Math.abs(p.z - a.z) - Math.abs(q.z - a.z))[0];
          if (nx && !a.own) a.target = nx; else if (a.own && a.stopAt === null) { const cz = plazaCafeNear(a.z + a.dir * 30, 40); if (cz !== null && (cz - a.z) * a.dir > 12) a.stopAt = cz; else vT = 0; } }
        // goal: a later dock (rental), a cafe rack (owner), or ride out of range
        const goal = a.target ? a.target.z + (a.veh === K.RENT ? 3 : SCO_DZ + 1) : a.stopAt !== null ? (this.rackZ(a.stopAt) ?? a.stopAt + 6.6) + 0.8 : null;
        if (goal !== null) { const togo = (goal - a.z) * a.dir; if (togo < 18) { a.st = 'arrive'; vT = Math.min(vT, Math.max(0.6, togo * 0.35)); a.deck = false; a.xT = togo < (a.own ? 3.5 : 9) ? (a.own ? 7.7 : DOCK_X + 1.2) : 6.15; }
          if (togo < 0.6 || (a.st === 'arrive' && a.v < 0.7 && togo < 1.5)) { this.arrive(a); if (!a.on) continue; } }
        if (a.st === 'ride' || a.st === 'arrive') {
          // flow: crosswalk yield and gap to decor riders in the lane; deck scooters avoid the runner and walkers
          if (!a.deck) { for (const xz of decor.xwalkBusy || []) { const ah = (xz - a.z) * a.dir; if (ah > -0.6 && ah < 9) vT = Math.min(vT, Math.max(0, (ah - 2.2) * 0.9)); }
            for (const o of decor.riders || []) { if (o.dir !== a.dir || Math.abs(o.x - a.x) > 0.7) continue; const gap = (o.z - a.z) * a.dir; if (gap > 0 && gap < 4) vT = Math.min(vT, o.v * (gap / 4)); } }
          else { a.near = 99; let dodge = 0;
            if (Math.abs(rz - a.z) < 16 && Math.abs(rxr - a.x) < 2.2) dodge = a.x > rxr ? 1 : -1;
            for (const p of P) { if (!p.active) continue; const ah = (p.z - a.z) * a.dir, lx = Math.abs(p.x - a.x); if (ah > -0.5 && ah < 4 && lx < 0.85) { vT = Math.min(vT, Math.max(0, (ah - 1.0) * 0.8)); if (!dodge) dodge = p.x > a.x ? -0.6 : 0.6; } const dd = Math.hypot(p.x - a.x, p.z - a.z); if (dd < a.near) a.near = dd; if (dd < 1.2) { vT = Math.min(vT, 0.25); if (dd < 0.7) { const k = (0.7 - dd) / Math.max(dd, 1e-3); a.x -= (p.x - a.x) * k; a.z -= (p.z - a.z) * k * 0.5; } } }
            a.xT = Math.max(-3.3, Math.min(3.3, a.xT + dodge * dt * 2.5)); if (dodge && Math.abs(rxr - a.xT) < 2.2) a.xT = rxr + Math.sign(a.xT - rxr || 1) * 2.3; a.xT = Math.max(-3.3, Math.min(3.3, a.xT)); }
          for (const o of this.ag) { if (o === a || !o.on || o.deck !== a.deck || o.dir !== a.dir || (o.st !== 'ride' && o.st !== 'arrive')) continue; const gap = (o.z - a.z) * a.dir; if (gap > 0 && gap < 3 && Math.abs(o.x - a.x) < 0.7) vT = Math.min(vT, o.v * gap / 3); }
          a.v += (vT - a.v) * (1 - Math.exp(-1.6 * dt)); a.x += (a.xT - a.x) * (1 - Math.exp(-1.2 * dt)); if (a.x > 4.5 && a.x < 6.3) a.inLane = true; const dzs = a.dir * a.v * dt; a.z += dzs; if (a.x > 6.5) plazaResolve(a, 0.45);
          a.ph += dt * a.v * (a.veh === K.KID ? 3.6 : 2.4);
          const pass = Math.sign(a.z - rz) !== Math.sign(a.z - dzs - rz); if (pass && Math.abs(a.x - rxr) < 8 && this.onBell && r.chance(0.5)) this.onBell(a.veh === K.ESC ? 'esc' : a.veh === K.KICK ? 'kick' : 'bell', a.x, a.z);
          if (a.veh === K.ESC && a.v > 1.5) live.push({ x: a.x, z: a.z, v: a.v });
        }
      }
      if (!a.on) continue;
      const sc = a.veh === K.ESC || a.veh === K.KICK;
      if (onVeh) { const vry = a.dir < 0 ? 0 : Math.PI; this.put(a.veh, a.x, 0, a.z, vry, a.veh === K.KID ? 1 : 1, a.own ? a.frame : 0xffffff);
        if (sc) { pose = [2, 0, 0.08]; y = 0.14; } else { pose = [a.st === 'mount' ? 3 : 1, a.ph, a.veh === K.ROAD ? 0.55 : a.veh === K.CRU ? 0.12 : 0.3]; y = a.st === 'mount' ? 0 : (SAD[a.veh] - 0.82 * a.s); }
        if (a.st === 'mount') { this.put(K.P, a.x + 0.45, 0, a.z, vry, a.s, a.col, [3, 0, 0]); live.push({ x: a.x, z: a.z, st: a.st }); continue; }
        this.put(K.P, a.x, y, a.z + (sc ? 0.05 : (a.veh === K.KID ? 0.08 : 0.12)) * (a.dir < 0 ? 1 : -1), vry, a.s, a.col, pose);
      } else this.put(K.P, a.x, 0, a.z, ry, a.s, a.col, pose);
    }
    this.stats.inst = this.n; this.stats.riders = this.ag.filter((a) => a.on && (a.st === 'ride' || a.st === 'arrive')).length;
    this.mesh.count = this.n; this.mesh.visible = this.n > 0; if (this.n) { this.mesh.instanceMatrix.needsUpdate = true; this.aSel.needsUpdate = true; this.aPose.needsUpdate = true; }
    this.liveScooters = live.filter((l) => l.v); this.agents = this.ag;
  }
  rackZ(cz) { const k = Math.round(cz * 10); this._rk = this._rk || new Map(); if (!this._rk.has(k)) { let z = null; for (const o of [6.6, -9.2]) if (this.rackOK(cz + o)) { z = cz + o; break; } this._rk.set(k, z); if (this._rk.size > 100) this._rk.delete(this._rk.keys().next().value); } return this._rk.get(k); }
  rackOK(z) { if (plazaHit(8.0, z + 0.8, 0.4)) return false; for (const o of plazaObstacles(z)) if (Math.abs(o.x - 8.0) < o.r + 0.6 && o.z > z - 0.6 - o.r && o.z < z + 2.2 + o.r) return false; for (const q of atmsNear(z, 1)) if (Math.abs(q.z - z - 0.8) < 2.5) return false; return true; }
  arrive(a) { const r = this.r;
    if (!a.own && a.target) { const d = a.target;
      if (a.veh === K.ESC && r.chance(0.18) && !plazaHit(11.1, a.z, 1.5)) { this.left.push({ x: r.range(10.6, 11.6), z: a.z + r.range(-2, 2), ry: r.range(0, 6.28) }); this.stats.leftLying++; }
      else if (a.veh === K.RENT) { this.dockN.set(d.id, Math.min(7, this.docked(d.id) + 1)); this.stats.returns++; if (this.onDock) this.onDock(d.x, d.z, 'dock'); }
      else { this.scoN.set(d.id, Math.min(5, this.scoots(d.id) + 1)); this.stats.parked++; }
      a.st = 'walkout'; a.tx = 12.6; a.tz = a.z + r.range(-4, 4); a.v = 1.25; a.t = 0; return; }
    if (a.own && a.stopAt !== null) { const n0 = Math.floor(hash2(Math.round(a.stopAt), 7303) * 3), n = n0 + this.locked.filter((l) => Math.abs(l.z - this.rackZ(a.stopAt) - 0.8) < 2).length; if (n < 3 && this.rackZ(a.stopAt) !== null) { this.locked.push({ veh: a.veh, x: 8.0, z: this.rackZ(a.stopAt) + 0.8 * n, col: a.frame }); this.stats.locked++; if (this.onDock) this.onDock(8.0, this.rackZ(a.stopAt), 'lock'); }
      a.st = 'walkout'; a.tx = PCAFE_X - 0.4; a.tz = a.stopAt; a.v = 1.2; a.t = 0; return; }
    a.target = null; a.stopAt = null; a.st = 'ride';
  }
}
