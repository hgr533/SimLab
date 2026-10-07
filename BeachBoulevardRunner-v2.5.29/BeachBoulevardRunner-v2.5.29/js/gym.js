// v2.5.27 outdoor fitness stations on the shore side (Tel Aviv style), one every 400 m on the sand just past the
// sea wall: rubber floor patch, pull-up bars, parallel bars, sit-up bench, leg press, chest press, rower.
// Gym-goers (shirtless men / sports tops, own seeded RNG, render only) walk in from the promenade, do sets with
// simple animations (pull-ups, dips, push-ups, sit-ups, stretching, machine reps), rest / chat between sets, leave.
// Fewer users in rain. Draws: 1 (equipment) + 1 (users) while a station is near. Sound: Gym channel (clank, grunt).
// v2.5.29: pull-ups stop with the chin just under the bar (was: head pushed into the bar with the arms hidden,
// which read as an upside-down figure); elbows flare out so the arms stay visible.
// v2.5.28: equipment + users in ONE draw; real poses: pull-ups hang from the bar (hands on it, feet off the
// ground, arms bend as they pull), dips on the parallel bars, seated leg press / chest press / rower (legs and
// arms hinge at hip / shoulder in the shader: aPose = arm length, leg angle, arm angle).
import * as THREE from '../vendor/three.module.js';
import { Builder, hex, mergeKinds } from './geo.js';
import { U } from './materials.js';
import { makeRng, hash2 } from './rng.js';
import { beachBusy, groundY, restoNear } from './places.js';

export const GYM_EVERY = 400;
const _gz = new Map();
export function gymZ(k) { // world z of station k (moved off umbrellas / restaurants)
  if (_gz.has(k)) return _gz.get(k);
  const z0 = -(200 + GYM_EVERY * k); let z = z0;
  for (const d of [0, 10, -10, 20, -20, 30, -30, 40]) { const zz = z0 + d; if (!beachBusy(-13.5, -5.4, zz - 5, zz + 5) && restoNear(zz, 16) === null) { z = zz; break; } }
  _gz.set(k, z); return z;
}
const STEEL = hex(0x8a9099), DARK = hex(0x2b2f36), RUB = hex(0x3a6b4f), SKIN = hex(0xc58c63), W = [1, 1, 1];
function stationGeo() { // local: x toward the sea (-x), patch 8 x 9 m centred at (0, 0)
  const b = new Builder(), post = (x, z, h) => b.box(x, 0, z, 0.09, h, 0.09, STEEL);
  b.box(0, 0, 0, 7.6, 0.05, 9.2, RUB, { top: RUB }); b.box(0, 0, 0, 7.8, 0.03, 9.4, hex(0x2d5540));
  // pull-up bars (two heights) at z -3.2
  post(-1.6, -3.2, 2.45); post(0.2, -3.2, 2.45); post(2.0, -3.2, 2.2); b.limb(-1.6, 2.4, -3.2, 0.2, 2.4, -3.2, 0.025, 0.025, 5, STEEL); b.limb(0.2, 2.15, -3.2, 2.0, 2.15, -3.2, 0.025, 0.025, 5, STEEL);
  // parallel bars at z -0.6
  for (const x of [-0.25, 0.25]) { post(x - 0, -1.4, 1.25); post(x, 0.2, 1.25); b.limb(x, 1.22, -1.5, x, 1.22, 0.3, 0.025, 0.025, 5, STEEL); }
  // sit-up bench at x 2.2, z -0.6 (inclined)
  b.push(); b.translate(2.4, 0.35, -0.6); b.rotX(-0.25); b.box(0, 0, 0, 0.45, 0.08, 1.5, hex(0x1e3a5f)); b.pop(); post(2.25, 0.0, 0.5); post(2.55, 0.0, 0.5); post(2.25, -1.2, 0.3); post(2.55, -1.2, 0.3);
  // machines along z +2.8: leg press, chest press, rower (yellow frames)
  const Y = hex(0xf2c230);
  b.box(-2.2, 0, 2.8, 0.7, 0.45, 1.3, Y); b.box(-2.2, 0.45, 3.25, 0.5, 0.5, 0.08, DARK); b.box(-2.2, 0.45, 2.45, 0.6, 0.6, 0.06, DARK); // leg press
  b.box(0, 0, 2.8, 0.25, 1.1, 0.25, Y); b.box(0, 0.45, 3.1, 0.5, 0.08, 0.45, DARK); b.box(0, 0.55, 3.35, 0.5, 0.7, 0.08, DARK); b.limb(-0.35, 1.2, 2.6, 0.35, 1.2, 2.6, 0.025, 0.025, 4, STEEL); // chest press
  b.box(2.2, 0, 2.8, 0.25, 0.35, 1.6, Y); b.box(2.2, 0.35, 3.0, 0.4, 0.08, 0.4, DARK); b.limb(2.0, 0.7, 2.1, 2.4, 0.7, 2.1, 0.02, 0.02, 4, STEEL); // rower
  // sign
  post(3.6, 4.4, 2.0); b.box(3.6, 1.6, 4.4, 0.06, 0.45, 0.9, hex(0x0a7d5a)); b.box(3.57, 1.75, 4.4, 0.02, 0.12, 0.6, hex(0xfefefe));
  return b.build();
}
// gym-goer: arms are a separate variant (aRig.x: 0 body, 1 arms down, 2 arms up)
function userGeo() {
  const b = new Builder({ rig: true });
  b.rig = [0, 0, 0];
  b.rig = [0, 1, 0]; for (const s of [-1, 1]) { b.box(s * 0.1, 0, 0, 0.13, 0.52, 0.15, SKIN); } b.rig = [0, 0, 0];
  for (const s of [-1, 1]) b.box(s * 0.1, 0.52, 0, 0.15, 0.3, 0.17, W);
  b.box(0, 0.8, 0, 0.36, 0.2, 0.2, W); b.box(0, 0.98, 0, 0.4, 0.48, 0.22, SKIN); b.box(0, 1.27, 0.0, 0.41, 0.12, 0.23, hex(0xffffff)); // sports-top band (hidden for men in the shader)
  b.box(0, 1.46, 0, 0.1, 0.06, 0.1, SKIN); b.box(0, 1.52, 0, 0.2, 0.22, 0.21, SKIN); b.box(0, 1.68, 0.02, 0.22, 0.08, 0.23, hex(0x2b1d14));
  b.rig = [1, 0, 0]; for (const s of [-1, 1]) b.box(s * 0.25, 0.86, 0, 0.09, 0.58, 0.1, SKIN);
  b.rig = [2, 0, 0]; for (const s of [-1, 1]) b.box(s * 0.25, 1.4, 0, 0.09, 0.62, 0.1, SKIN);
  return b.build();
}
const VERT = `attribute vec4 aLight; attribute vec3 aRig; attribute vec4 aSel; attribute vec3 aPose; attribute float aKind; uniform vec3 uAmb; uniform vec3 uSun; varying vec3 vC;
#include <fog_pars_vertex>
vec3 rx(vec3 p, float py, float pz, float a) { float c = cos(a), s = sin(a), y = p.y - py, z = p.z - pz; return vec3(p.x, py + y * c - z * s, pz + y * s + z * c); }
void main() { vec3 p = position; bool st = aSel.x > 2.5;
  if (st != (aKind > 0.5) || (aRig.x > 0.5 && abs(aRig.x - aSel.x) > 0.5)) p = vec3(0.0, -50.0, 0.0);
  else if (!st) {
    if (aRig.y > 0.5) p = rx(p, 0.52, 0.0, aPose.y);                                   // legs hinge at the hip
    if (aRig.x > 1.5) { p.y = 1.4 + (p.y - 1.4) * aPose.x; p.x += sign(p.x) * (1.0 - aPose.x) * 0.6; } // arms up: hand-shoulder length; v2.5.29 elbows flare out as they pull (arms stay visible beside the head)
    else if (aRig.x > 0.5) { p.y = 1.44 - (1.44 - p.y) * aPose.x; p = rx(p, 1.44, 0.0, aPose.z); } // arms down / forward
  }
  vec3 col = color; bool white = color.r > 0.99 && color.g > 0.99 && color.b > 0.99;
  if (white && !st) { col = aSel.yzw; if (p.y > 1.2 && p.y < 1.4) { if (fract(aSel.y * 7.3) < 0.5) col = vec3(0.77, 0.55, 0.39); } } // top band only for some
  vec4 mvPosition = viewMatrix * modelMatrix * instanceMatrix * vec4(p, 1.0); gl_Position = projectionMatrix * mvPosition;
  float sk = (!st && abs(col.r - 0.773) < 0.03 && abs(col.g - 0.549) < 0.03) ? 1.0 : 0.0; // bare skin: soft muscle-ish relief (cheap)
  float relief = sk * (0.92 + 0.16 * smoothstep(0.0, 1.0, fract(position.y * 3.1 + position.x * 1.7)));
  vC = col * (sk > 0.5 ? relief : 1.0) * max(vec3(0.42), uAmb * aLight.y + uSun * (0.35 + aLight.x * 0.75));
  #include <fog_vertex>
}`;
const FRAG = `varying vec3 vC;\n#include <fog_pars_fragment>\nvoid main() { gl_FragColor = vec4(min(vC, vec3(1.0)), 1.0);\n#include <fog_fragment>\n}`;
const SHORTS = [0x1e88e5, 0xe53935, 0x43a047, 0x212121, 0xfb8c00, 0x8e24aa, 0x00acc1, 0xfdd835];
// equipment slots (local x, z, activity, facing): 0 pull-up, 1 dips, 2 push-ups, 3 sit-ups, 4 stretch, 5 leg press, 6 chest press, 7 rower
const SLOTS = [[-0.7, -3.2, 0, 0, 2.4], [1.1, -3.2, 0, 0, 2.15], [0, -0.6, 1, 0], [-2.0, -0.8, 2, Math.PI / 2], [2.4, -0.6, 3, 0], [-1.0, 1.0, 4, 0.6], [-2.2, 2.6, 5, 0, 0, 3.05], [0, 2.6, 6, 0, 0, 3.12], [2.2, 2.6, 7, 0, 0, 3.0], [1.2, 1.2, 4, -2.4]];
export class Gym {
  constructor(scene) { this.scene = scene; this.enabled = true; this.r = makeRng(0x6b3a11); this.st = new Map(); this.o = new THREE.Object3D(); this.stats = { stations: 0, users: 0, reps: 0 }; this.onClank = null; this.onGrunt = null; }
  applyPreset(p) {
    this.lo = p.name === 'LOW'; if (this.eq) return;
    const mat = (vc) => new THREE.ShaderMaterial({ fog: true, vertexColors: true, side: THREE.DoubleSide, vertexShader: vc, fragmentShader: FRAG,
      uniforms: { fogColor: { value: new THREE.Color() }, fogNear: { value: 1 }, fogFar: { value: 1000 }, fogDensity: { value: 0 }, uAmb: U.uAmb, uSun: U.uSun } });
    const g = mergeKinds([userGeo(), stationGeo()]); // kind 0 users, 1 equipment
    this.aSel = new THREE.InstancedBufferAttribute(new Float32Array(28 * 4), 4); g.setAttribute('aSel', this.aSel);
    this.aPose = new THREE.InstancedBufferAttribute(new Float32Array(28 * 3), 3); g.setAttribute('aPose', this.aPose);
    this.users = new THREE.InstancedMesh(g, mat(VERT), 28); this.users.name = 'gym'; this.users.frustumCulled = false; this.users.count = 0; this.scene.add(this.users);
    this.eq = this.users;
  }
  update(sim, camera, dt) {
    if (!this.eq) return;
    const rz = sim.r.z, t = sim.t, rain = (sim.ws.p.rain || 0) > 0.35, o = this.o, r = this.r;
    let ne = 0, nu = 0; const U0 = 3; /* slots 0-2 equipment, users after */ const k0 = Math.max(0, Math.floor((-rz - 200) / GYM_EVERY) - 1); const live = [];
    for (let k = k0; k <= k0 + 2; k++) {
      const z = gymZ(k); if (z > rz + 40 || z < rz - 180 || !this.enabled) { this.st.delete(k); continue; }
      const cx = -9.4, gy = groundY(cx, z);
      o.position.set(cx, gy, z); o.rotation.set(0, 0, 0); o.scale.setScalar(1); o.updateMatrix(); this.users.setMatrixAt(ne, o.matrix); this.aSel.setXYZW(ne, 3, 1, 1, 1); this.aPose.setXYZ(ne, 1, 0, 0); ne++;
      let S = this.st.get(k); if (!S) { S = { u: [], cd: 0 }; this.st.set(k, S);
        const n0 = rain ? 1 : r.int(3, this.lo ? 4 : 7); for (let i = 0; i < n0; i++) S.u.push(this.newUser(true)); }
      const want = rain ? 1 : this.lo ? 4 : 6;
      if (dt > 0 && (S.cd -= dt) <= 0) { S.cd = r.range(4, 9); if (S.u.length < want && r.chance(0.6)) S.u.push(this.newUser(false)); }
      const used = new Set(S.u.map((u) => u.slot));
      for (let i = S.u.length - 1; i >= 0; i--) {
        const u = S.u[i], sl = SLOTS[u.slot], tx = sl[0], tz = sl[1];
        if (dt > 0) u.t += dt;
        let lx, lz, ly = 0, rx = 0, ry = sl[3], arms = 1, rot2 = 0, aLen = 1, leg = 0, aAng = 0;
        if (u.st === 'in' || u.st === 'out') { // walk from / to the promenade gap (local x +4.6)
          const ax = u.st === 'in' ? 4.8 : tx, az = u.st === 'in' ? u.z0 : tz, bx = u.st === 'in' ? tx : 4.8, bz = u.st === 'in' ? tz : u.z0, d = Math.hypot(bx - ax, bz - az), k2 = Math.min(1, u.t * 1.1 / Math.max(0.1, d));
          lx = ax + (bx - ax) * k2; lz = az + (bz - az) * k2; ry = Math.atan2(-(bx - ax), -(bz - az)); ly = Math.abs(Math.sin(u.t * 7)) * 0.03;
          if (k2 >= 1) { if (u.st === 'out') { S.u.splice(i, 1); continue; } u.st = 'set'; u.t = 0; u.reps = 0; }
        } else {
          lx = tx; lz = tz;
          if (u.st === 'rest' || u.st === 'set') { if (sl[2] >= 5 && u.st === 'set') lz = sl[5]; }
          if (u.st === 'set') { const a = sl[2], f = a === 4 ? 0.5 : 0.75, ph = u.t * f * 6.283, c = 0.5 - 0.5 * Math.cos(ph);
            const rep = Math.floor(u.t * f); if (rep > u.reps) { u.reps = rep; this.stats.reps++; if ((a === 0 || a === 1 || a >= 5) && this.onClank && r.chance(0.35)) this.onClank(cx + lx, z + lz); if (r.chance(0.12) && this.onGrunt) this.onGrunt(cx + lx, z + lz); }
            const us = u.s;
            if (a === 0) { arms = 2; const bar = sl[4]; aLen = 1 - 0.32 * c; ly = bar - 0.06 - (1.4 + 0.62 * aLen) * us; leg = 0.25 + 0.15 * c; } // hang from the bar, pull up (feet off the ground)
            else if (a === 1) { aLen = 1 - 0.38 * c; ly = 1.25 - (1.44 - 0.58 * aLen) * us; leg = 0.9; }        // dips: hands on the parallel bars, knees tucked
            else if (a === 2) { rx = -1.45; ly = 0.18 + c * 0.18; arms = 1; }           // push-ups (body near horizontal)
            else if (a === 3) { rx = -1.2 + c * 0.9; ly = 0.42; }                       // sit-ups on the bench
            else if (a === 4) { arms = 2; rot2 = Math.sin(ph) * 0.35; }                 // stretching: arms up, side bends
            else if (a === 5) { leg = 1.15 + 0.4 * c; ly = 0.40 - 0.52 * us; rx = -0.35; aAng = 0.3; }                   // leg press: seated, legs push the plate
            else if (a === 6) { leg = 1.5; ly = 0.48 - 0.52 * us; aAng = 1.45; aLen = 0.6 + 0.4 * c; }                   // chest press: seated, arms push forward
            else { leg = 1.25 - 0.35 * c; ly = 0.38 - 0.52 * us; aAng = 1.3; aLen = 1 - 0.4 * c; rx = 0.15 - c * 0.35; } // rower: legs + arms pull, lean back
            if (u.t > u.setT) { u.st = 'rest'; u.t = 0; u.restT = r.range(4, 12); u.chat = r.chance(0.5); }
          } else if (u.st === 'rest') { ry = u.chat ? sl[3] + Math.PI * 0.6 : sl[3]; if (sl[2] >= 5 || sl[2] === 1) lx += 0.7; else if (sl[2] === 0) lz += 0.7; else lz += 0.6; arms = 1; ly = 0;
            if (u.t > u.restT) { u.sets--; u.t = 0; if (u.sets <= 0) { u.st = 'out'; } else { u.st = 'set'; u.setT = r.range(6, 14);
              // free will: sometimes switch to a free station between sets
              if (r.chance(0.35)) { const free = SLOTS.map((_, j) => j).filter((j) => !used.has(j)); if (free.length) { used.delete(u.slot); u.slot = free[r.int(0, free.length - 1)]; used.add(u.slot); } } } }
          }
        }
        if (nu >= 25) continue;
        const wx = cx + lx, wz = z + lz, j = U0 + nu;
        o.position.set(wx, groundY(cx, z) + 0.05 + ly, wz); o.rotation.set(rx, ry, rot2, 'YXZ'); o.scale.setScalar(u.s); o.updateMatrix(); this.users.setMatrixAt(j, o.matrix);
        const sc = SHORTS[u.col]; this.aSel.setXYZW(j, arms, ((sc >> 16) & 255) / 255, ((sc >> 8) & 255) / 255, (sc & 255) / 255); this.aPose.setXYZ(j, aLen, leg, aAng); nu++;
        u.pose = { a: u.st === 'set' ? sl[2] : -1, ly: +ly.toFixed(2), aLen: +aLen.toFixed(2), leg: +leg.toFixed(2), handY: arms === 2 ? +(groundY(cx, z) + 0.05 + ly + (1.4 + 0.62 * aLen) * u.s).toFixed(2) : null, bar: sl[4] || null };
        live.push({ x: wx, z: wz });
      }
    }
    for (let j = ne; j < U0; j++) this.aSel.setXYZW(j, 9, 0, 0, 0); // unused equipment slots collapse (kind mismatch below)
    for (let j = ne; j < U0; j++) { o.position.set(0, -80, 0); o.rotation.set(0, 0, 0); o.scale.setScalar(0.001); o.updateMatrix(); this.users.setMatrixAt(j, o.matrix); }
    const tot = ne + nu; this.users.count = tot ? U0 + nu : 0; this.users.visible = tot > 0;
    if (tot) { this.users.instanceMatrix.needsUpdate = true; this.aSel.needsUpdate = true; this.aPose.needsUpdate = true; }
    this.stats.stations = ne; this.stats.users = nu; this.live = live;
  }
  newUser(already) { const r = this.r, slot = r.int(0, SLOTS.length - 1);
    return { slot, st: already ? 'set' : 'in', t: already ? r.range(0, 6) : 0, z0: r.range(-3, 3), sets: r.int(2, 5), setT: r.range(6, 14), reps: 0, col: r.int(0, SHORTS.length - 1), s: r.range(0.94, 1.08) }; }
}
