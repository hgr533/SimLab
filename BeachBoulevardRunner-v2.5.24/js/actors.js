// Instanced actors: runner (1 draw), soliton echoes (1 draw), crowd (1-3 draws), dogs (1-3 draws),
// leashes (1 draw), proximity rings (1 draw), obstacles (3 draws), rain + spray (1 draw each),
// v2.1 pickups: flow orbs (1 draw) and stamina drinks (1 draw).
import * as THREE from '../vendor/three.module.js';
import { MAX_PEOPLE, MAX_DOGS, MAX_ECHOES, RUNNER_R, lerp, gauss, smooth01 } from './config.js';
import { Builder, hex } from './geo.js';
import { bakedMaterial, U } from './materials.js';
import { personGeometry, runnerGeometry, maleRunnerGeometry, dogGeometry, personNearGeometry, personFarGeometry, dogNearGeometry, dogFarGeometry, runnerNearGeometry, maleRunnerNearGeometry, choreGeometry } from './props.js';
import { TieredSet } from './lod.js';
import { BIN_X } from './places.js';
import { hash2 } from './rng.js';
import { MAX_PICKS, PICK } from './sim.js';
// v2.5.21: droppings + poop bags share one tiny instanced mesh (one draw call, pooled)
const CHORE_CAP = 40;
const DROP_COL = new THREE.Color(0x5a3a1e), BAG_COLS = [0x3fbf6a, 0x3b7be0, 0xe86aa8, 0x8e5bd6, 0xf0c23a].map((c) => new THREE.Color(c));

const SHIRTS = [0xe8473c, 0x2f7fd8, 0xf2c14e, 0x3fae6b, 0xffffff, 0x8a5cd6, 0xf08a5d, 0x1f2a44, 0xe86fa8, 0x46c2c9, 0xd9d2c0, 0x333333].map((h) => new THREE.Color(h));
const COATS = [0xc8964f, 0x6b4a2f, 0xf1e6d0, 0x2a2420, 0xb07a45, 0x8d8d8d, 0xe0c08a, 0x5a3b26].map((h) => new THREE.Color(h));
const _o = new THREE.Object3D();
const _v = new THREE.Vector3();
const _hide = new THREE.Matrix4().makeScale(0, 0, 0).setPosition(0, -1000, 0);

function animAttr(geo, n) {
  const a = new THREE.InstancedBufferAttribute(new Float32Array(n * 4), 4);
  a.setUsage(THREE.DynamicDrawUsage);
  geo.setAttribute('aAnim', a);
  return a;
}

// v2.5.23: is the leash segment (positions i, i+1) closer than r to point p?
function segNear(lp, i, p, r) {
  const ax = lp.getX(i), ay = lp.getY(i), az = lp.getZ(i);
  const bx = lp.getX(i + 1) - ax, by = lp.getY(i + 1) - ay, bz = lp.getZ(i + 1) - az;
  const px = p.x - ax, py = p.y - ay, pz = p.z - az, bb = bx * bx + by * by + bz * bz;
  const t = bb > 1e-9 ? Math.max(0, Math.min(1, (px * bx + py * by + pz * bz) / bb)) : 0;
  const dx = px - bx * t, dy = py - by * t, dz = pz - bz * t;
  return dx * dx + dy * dy + dz * dz < r * r;
}

export class Actors {
  constructor(scene) {
    this.nearR = 0; // v2.5.23 1P near radius (set by main; 0 in 3rd person)
    this.scene = scene;
    // runner: v2.5 near-tier model (rounded limbs, shoes with soles, hair); the echoes keep the
    // lighter v2.4 silhouette of the same runner (they are translucent glows)
    const rg = runnerNearGeometry();
    this.runnerAnim = animAttr(rg, 1);
    this.runner = new THREE.InstancedMesh(rg, bakedMaterial({ rig: true, wet: true }), 1);
    this.runner.frustumCulled = false;
    scene.add(this.runner);
    const eg = new THREE.BufferGeometry();
    const mg = runnerGeometry();
    for (const k of ['position', 'aRig', 'aLight', 'uv']) eg.setAttribute(k, mg.getAttribute(k));
    this.echoAnim = animAttr(eg, MAX_ECHOES);
    this.echoAttr = new THREE.InstancedBufferAttribute(new Float32Array(MAX_ECHOES * 2), 2);
    this.echoAttr.setUsage(THREE.DynamicDrawUsage);
    eg.setAttribute('aEcho', this.echoAttr);
    this.character = 'female';
    this.echo = new THREE.InstancedMesh(eg, bakedMaterial({ rig: true, echo: true }), MAX_ECHOES);
    this.echo.frustumCulled = false; this.echo.renderOrder = 20;
    scene.add(this.echo);
    this.crowdSet = null; this.dogSet = null;
    this.chores = new THREE.InstancedMesh(choreGeometry(), bakedMaterial({ tint: true }), CHORE_CAP);
    this.chores.setColorAt(0, DROP_COL); this.chores.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
    this.chores.frustumCulled = false; this.chores.count = 0; scene.add(this.chores);
    // leashes
    const lg = new THREE.BufferGeometry();
    lg.setAttribute('position', new THREE.BufferAttribute(new Float32Array(MAX_DOGS * 6), 3).setUsage(THREE.DynamicDrawUsage));
    this.leash = new THREE.LineSegments(lg, new THREE.LineBasicMaterial({ color: 0x222222, fog: true }));
    this.leash.frustumCulled = false;
    scene.add(this.leash);
    // proximity rings
    // v2.5.4: soft-edged ring: 4 radial bands with a Gaussian brightness profile (additive, so the
    // edges fade to nothing) instead of a hard 0.42-0.56 m band
    const ring = new THREE.RingGeometry(0.3, 0.7, 24, 4); ring.rotateX(-Math.PI / 2);
    { const pos = ring.attributes.position, cols = new Float32Array(pos.count * 3);
      for (let v = 0; v < pos.count; v++) { const g = gauss(Math.hypot(pos.getX(v), pos.getZ(v)) - 0.5, 0.085); cols[v * 3] = cols[v * 3 + 1] = cols[v * 3 + 2] = g; }
      ring.setAttribute('color', new THREE.BufferAttribute(cols, 3)); }
    this.rings = new THREE.InstancedMesh(ring, new THREE.MeshBasicMaterial({ transparent: true, opacity: 0.95, vertexColors: true, depthWrite: false, blending: THREE.AdditiveBlending, fog: true }), 24);
    this.rings.frustumCulled = false; this.rings.renderOrder = 15;
    for (let i = 0; i < 24; i++) this.rings.setColorAt(i, new THREE.Color(0, 1, 0));
    scene.add(this.rings);
    this.buildObstacles();
    this.buildPickups();
    this.buildFx();
  }
  buildPickups() {
    // flow orb: two-tone octahedron, unlit, tinted per instance (violet trail orbs, gold air orbs)
    const og = new THREE.OctahedronGeometry(0.25, 0);
    const pos = og.getAttribute('position'), col = new Float32Array(pos.count * 3);
    for (let i = 0; i < pos.count; i++) { const k = 0.55 + 0.45 * (pos.getY(i) / 0.25 * 0.5 + 0.5); col.set([k, k, k], i * 3); }
    og.setAttribute('color', new THREE.BufferAttribute(col, 3));
    this.orbs = new THREE.InstancedMesh(og, new THREE.MeshBasicMaterial({ vertexColors: true, fog: true }), MAX_PICKS);
    this.orbs.setColorAt(0, new THREE.Color(1, 1, 1));
    // stamina drink: small baked bottle (teal body, white label and cap)
    const b = new Builder();
    b.cyl(0, 0, 0, 0.12, 0.12, 0.3, 8, hex(0x19b6a4), { cap: false });
    b.cyl(0, 0.09, 0, 0.126, 0.126, 0.11, 8, hex(0xf4f0e6), { cap: false });
    b.cyl(0, 0.3, 0, 0.12, 0.05, 0.08, 8, hex(0x19b6a4), { cap: false });
    b.cyl(0, 0.38, 0, 0.05, 0.05, 0.06, 8, hex(0xffffff), { top: hex(0xffffff) });
    this.drinks = new THREE.InstancedMesh(b.build(), bakedMaterial({}), 12);
    for (const m of [this.orbs, this.drinks]) { m.frustumCulled = false; m.count = 0; m.visible = false; this.scene.add(m); }
    this.orbCol = [new THREE.Color(0.86, 0.5, 1.0), new THREE.Color(1.0, 0.84, 0.3)];
  }
  // v2.5: crowd and dogs in tiers (near detailed / mid v2.4 / far cheap), rebuilt per preset
  buildCrowd(p) {
    if (this.crowdSet) { this.crowdSet.dispose(); this.dogSet.dispose(); }
    const lv = p.lod, mat = (near) => bakedMaterial({ rig: true, tint: true, wet: true, lodFade: true, nearVar: near });
    const cm = mat(false);
    this.crowdSet = new TieredSet(this.scene, { cap: MAX_PEOPLE, name: 'crowd', attrs: { aAnim: 4, aVar: 4 }, tiers: [
      lv.crowd[0] ? { geo: personNearGeometry(), mat: mat(true) } : null, { geo: personGeometry(true), mat: cm }, lv.crowd[2] ? { geo: personFarGeometry(), mat: cm } : null] });
    this.dogSet = new TieredSet(this.scene, { cap: MAX_DOGS, name: 'dogs', attrs: { aAnim: 4 }, tiers: [
      lv.dogs[0] ? { geo: dogNearGeometry(), mat: cm } : null, { geo: dogGeometry(true), mat: cm }, lv.dogs[2] ? { geo: dogFarGeometry(), mat: cm } : null] });
    this.setLodScale(this.lodScale || 1);
  }
  setLodScale(k) {
    this.lodScale = k;
    const c = this.preset.lod, far = c.far * Math.max(0.5, k); // v2.5.24: a shorter range moves the far tier closer (was c.far / k)
    this.crowdSet.configure({ near: c.near * k, nearMax: Math.round(c.nearMax * k), far, hyst: c.hyst, fade: c.fade });
    this.dogSet.configure({ near: c.near * k, nearMax: Math.round(c.nearMax * 0.6 * k), far: far * 0.8, hyst: c.hyst, fade: c.fade });
  }
  // v2.5.21: droppings on the ground + the bag in the owner's free hand (down at the dropping while crouched)
  updateChores(sim, alpha) {
    const ch = this.chores, ai = sim.ai; let n = 0;
    for (const q of ai.drops) {
      if (!q.on || n >= CHORE_CAP) continue;
      _o.position.set(q.x, q.y + 0.004, q.z); _o.rotation.set(0, q.rot, 0); _o.scale.setScalar(q.s); _o.updateMatrix();
      ch.setMatrixAt(n, _o.matrix); ch.setColorAt(n, DROP_COL); n++;
    }
    const P = ai.people;
    for (let i = 0; i < P.length && n < CHORE_CAP; i++) {
      const a = P[i];
      if (!a.active || !(a.bag > 0)) continue;
      const ox = lerp(a.px, a.x, alpha), oz = lerp(a.pz, a.z, alpha), oy = a.y || 0, sc = a.scale;
      const oh = (a.hd !== undefined ? a.hd : (a.dir > 0 ? Math.PI : 0)) + (a.look || 0);
      const px = Math.cos(oh), pz = -Math.sin(oh), fx = -Math.sin(oh), fz = -Math.cos(oh);
      let sd = 1; // leash hand side (toward the dog); the bag goes in the other hand
      const d = a.pet >= 0 ? ai.dogs[a.pet] : null;
      if (d && d.active && d.owner === i) sd = ((d.x - ox) * px + (d.z - oz) * pz) >= 0 ? 1 : -1;
      const c = Math.min(1, (a.crouch || 0) * 1.25);
      const hx = ox - px * sd * 0.27 * sc, hz = oz - pz * sd * 0.27 * sc, hy = oy + 0.5 * sc;
      const gx = ox + fx * 0.36 - px * sd * 0.1, gz = oz + fz * 0.36 - pz * sd * 0.1, gy = oy + 0.02;
      _o.position.set(hx + (gx - hx) * c, hy + (gy - hy) * c, hz + (gz - hz) * c);
      if (a.chore === 6) { const t = Math.min(1, a.choreT / 0.4); _o.position.lerp(_v.set(BIN_X + 0.02, 0.6, a.binZ - 0.05), t * t * (3 - 2 * t)); } // into the bin
      _o.rotation.set(0, oh, 0);
      if (a.bag === 2) _o.scale.set(0.95, 1.9, 0.95); else _o.scale.set(0.75, 1.6, 0.45);
      _o.updateMatrix(); _o.scale.setScalar(1);
      ch.setMatrixAt(n, _o.matrix); ch.setColorAt(n, BAG_COLS[a.bagCol % BAG_COLS.length]); n++;
    }
    ch.count = n; ch.visible = n > 0;
    ch.instanceMatrix.needsUpdate = true; if (ch.instanceColor) ch.instanceColor.needsUpdate = true;
  }
  buildObstacles() {
    // banner bar (unit box scaled to span), posts (unit), barrier planters (one lane unit)
    const bb = new Builder(); 
    bb.box(0, 0, 0, 1, 1, 1, [1, 1, 1], {});
    const barGeo = bb.build();
    const colors = new Float32Array(barGeo.getAttribute('color').count * 3);
    const pos = barGeo.getAttribute('position');
    for (let i = 0; i < pos.count; i++) {
      const stripe = Math.floor((pos.getX(i) + 0.5) * 6) % 2 === 0;
      const c = stripe ? hex(0x1d9aa8) : hex(0xf4f0e6);
      colors.set(pos.getY(i) > 0.5 ? c : hex(0xf08a24), i * 3);
    }
    barGeo.setAttribute('color', new THREE.BufferAttribute(colors, 3));
    this.bars = new THREE.InstancedMesh(barGeo, bakedMaterial({}), 10);
    const pb = new Builder(); pb.box(0, 0, 0, 0.1, 1.5, 0.1, hex(0x3a3d44), { skipBottom: true });
    this.posts = new THREE.InstancedMesh(pb.build(), bakedMaterial({}), 20);
    const kb = new Builder();
    kb.box(0, 0, 0, 1.5, 0.5, 0.55, hex(0xc9b08a), { skipBottom: true, top: hex(0x6a5038) });
    for (let i = 0; i < 3; i++) kb.cyl(-0.45 + i * 0.45, 0.5, 0, 0.12, 0.18, 0.15, 6, hex(0x3f7f3a));
    this.barriers = new THREE.InstancedMesh(kb.build(), bakedMaterial({}), 20);
    for (const m of [this.bars, this.posts, this.barriers]) { m.frustumCulled = false; m.count = 0; this.scene.add(m); }
  }
  buildFx() {
    // rain: line segments animated fully in the vertex shader around the camera
    const N = 1100;
    const g = new THREE.BufferGeometry();
    const p = new Float32Array(N * 2 * 3), e = new Float32Array(N * 2);
    let s = 1;
    const rnd = () => { s = (s * 16807) % 2147483647; return s / 2147483647; };
    for (let i = 0; i < N; i++) {
      const x = rnd(), y = rnd(), z = rnd();
      p.set([x, y, z, x, y, z], i * 6); e[i * 2] = 0; e[i * 2 + 1] = 1;
    }
    g.setAttribute('position', new THREE.BufferAttribute(p, 3));
    g.setAttribute('aEnd', new THREE.BufferAttribute(e, 1));
    this.rainMat = new THREE.ShaderMaterial({
      transparent: true, depthWrite: false,
      uniforms: { uTime: U.uTime, uCam: { value: new THREE.Vector3() }, uI: { value: 0 }, uWind: { value: 0.2 }, uSlant: { value: 0.2 } },
      vertexShader: `attribute float aEnd; uniform float uTime; uniform vec3 uCam; uniform float uWind; uniform float uSlant; varying float vA;
        void main(){ vec3 b = position * vec3(36.0, 16.0, 46.0);
          b.y = mod(b.y - uTime * 15.0, 16.0); b.x = mod(b.x - uCam.x + 18.0 + uTime * uWind * 4.0, 36.0) - 18.0; b.z = mod(b.z - uCam.z, 46.0) - 36.0;
          vec3 w = vec3(uCam.x + b.x, b.y - 1.0, uCam.z + b.z);
          w += vec3(uSlant * 0.12, 0.55, 0.0) * aEnd;
          vA = aEnd; gl_Position = projectionMatrix * viewMatrix * vec4(w, 1.0); }`,
      fragmentShader: `uniform float uI; varying float vA; void main(){ gl_FragColor = vec4(0.8, 0.85, 0.95, (0.15 + 0.35 * vA) * uI); }`,
    });
    this.rain = new THREE.LineSegments(g, this.rainMat);
    this.rain.frustumCulled = false; this.rain.renderOrder = 30;
    this.scene.add(this.rain);
    // sea spray: points drifting inland from the sea
    const M = 520;
    const sg = new THREE.BufferGeometry();
    const sp = new Float32Array(M * 3);
    for (let i = 0; i < M; i++) sp.set([rnd(), rnd(), rnd()], i * 3);
    sg.setAttribute('position', new THREE.BufferAttribute(sp, 3));
    this.sprayMat = new THREE.ShaderMaterial({
      transparent: true, depthWrite: false,
      uniforms: { uTime: U.uTime, uCam: { value: new THREE.Vector3() }, uI: { value: 0 }, uScale: { value: 300 } },
      vertexShader: `uniform float uTime; uniform vec3 uCam; uniform float uScale; varying float vF;
        void main(){ vec3 b = position * vec3(50.0, 6.0, 60.0);
          b.x = mod(b.x + uTime * 3.5, 50.0) - 38.0; b.y = 0.2 + mod(b.y + sin(uTime + position.z * 30.0) * 0.5, 6.0);
          b.z = mod(b.z - uCam.z, 60.0) - 48.0;
          vec3 w = vec3(b.x, b.y, uCam.z + b.z);
          vec4 mv = viewMatrix * vec4(w, 1.0); vF = clamp(1.0 - (b.x + 38.0) / 50.0, 0.0, 1.0);
          gl_PointSize = uScale / max(1.0, -mv.z); gl_Position = projectionMatrix * mv; }`,
      fragmentShader: `uniform float uI; varying float vF; void main(){ vec2 c = gl_PointCoord - 0.5; float a = max(0.0, 1.0 - dot(c, c) * 4.0);
        gl_FragColor = vec4(1.0, 1.0, 1.0, a * 0.35 * uI * (0.3 + 0.7 * vF)); }`,
    });
    this.spray = new THREE.Points(sg, this.sprayMat);
    this.spray.frustumCulled = false; this.spray.renderOrder = 31;
    this.scene.add(this.spray);
  }
  // v2.4: FEMALE / MALE runner. Cosmetic only (the sim hitbox is unchanged). The echoes take the
  // same buffers, so they follow the chosen silhouette.
  setCharacter(c) {
    c = c === 'male' ? 'male' : 'female';
    if (c === this.character) return;
    this.character = c;
    const rg = c === 'male' ? maleRunnerNearGeometry() : runnerNearGeometry();
    rg.setAttribute('aAnim', this.runnerAnim);
    const mg = c === 'male' ? maleRunnerGeometry() : runnerGeometry();
    const eg = new THREE.BufferGeometry();
    for (const k of ['position', 'aRig', 'aLight', 'uv']) eg.setAttribute(k, mg.getAttribute(k));
    eg.setAttribute('aAnim', this.echoAnim); eg.setAttribute('aEcho', this.echoAttr);
    const oldR = this.runner.geometry, oldE = this.echo.geometry;
    this.runner.geometry = rg; this.echo.geometry = eg;
    oldE.dispose(); oldR.dispose();
  }
  applyPreset(p) {
    this.preset = p;
    this.rain.geometry.setDrawRange(0, p.rain * 2);
    this.spray.geometry.setDrawRange(0, p.spray);
    this.echo.count = p.echoes;
    this.leash.visible = p.leash;
    this.rings.visible = p.rings;
    this.buildCrowd(p);
  }

  // Render with interpolation alpha between the previous and current sim step.
  update(sim, alpha, camera, pixelRatio) {
    const r = sim.r;
    const rx = lerp(r.px, r.x, alpha), ry = lerp(r.py, r.y, alpha), rz = lerp(r.pz, r.z, alpha);
    _o.position.set(rx, ry, rz); _o.rotation.set(0, 0, -r.lean * 0.6); _o.scale.setScalar(1); _o.updateMatrix();
    const blink = r.invuln > 0 && Math.floor(r.invuln * 14) % 2 === 0;
    this.runner.setMatrixAt(0, blink ? _hide : _o.matrix);
    this.runner.instanceMatrix.needsUpdate = true;
    this.runnerAnim.setXYZW(0, r.phase, sim.state === 'run' ? (r.sprint ? 0.95 : 0.8) : 0.12, r.slidePose, r.airPose);
    this.runnerAnim.needsUpdate = true;
    // echoes: arrive intact, hold, then go (envelope only; shape never dissolves)
    const n = this.echo.count;
    const list = sim.echoes, fw = smooth01((sim.flow - 55) / 45);
    for (let i = 0; i < n; i++) {
      const e = list[(sim.echoI - 1 - i + list.length * 2) % list.length];
      const age = sim.t - e.born;
      const arrive = 0.07, hold = e.hold || 0.2, go = 0.24;
      let env = 0;
      if (age >= 0 && age < arrive + hold + go) {
        env = age < arrive ? age / arrive : age < arrive + hold ? 1 : 1 - (age - arrive - hold) / go;
        env = env * env * (3 - 2 * env);
      }
      env *= e.s * (1.3 / Math.sqrt(n)) * Math.min(1, age / 0.06); // newest copy never sits on top of the runner
      if (env <= 0.003 || sim.state !== 'run') { this.echo.setMatrixAt(i, _hide); this.echoAttr.setXY(i, 0, 0); continue; }
      // v2.5.4: at high FLOW the echoes are drawn toward the runner's line in a soft spiral
      let ex = e.x, ey = e.y;
      if (fw > 0) { const k = (1 - Math.exp(-age * 2.4)) * fw, ang = age * 6 + i * 0.9; ex += (rx - e.x) * 0.75 * k + Math.sin(ang) * 0.22 * k; ey = Math.max(0, ey + Math.cos(ang) * 0.12 * k); }
      _o.position.set(ex, ey, e.z + age * 0.6); _o.rotation.set(0, 0, 0); _o.scale.setScalar(1); _o.updateMatrix();
      this.echo.setMatrixAt(i, _o.matrix);
      this.echoAnim.setXYZW(i, e.ph, 0.8, e.sl, e.air);
      this.echoAttr.setXY(i, env, ((sim.t * 2.2 + i * 0.37) % 2.6) - 0.3);
    }
    this.echo.instanceMatrix.needsUpdate = true; this.echoAnim.needsUpdate = true; this.echoAttr.needsUpdate = true;
    // crowd (v2.5: tiers picked per person by distance to the camera, packed per frame)
    const P = sim.ai.people, cs = this.crowdSet, ds = this.dogSet;
    for (let i = 0; i < P.length; i++) {
      const a = P[i];
      if (!a.active) { cs.hide(i); continue; }
      _o.position.set(lerp(a.px, a.x, alpha), a.y || 0, lerp(a.pz, a.z, alpha)); // v2.5.20: y on the sand / crossing path
      if (a.hd !== undefined) _o.rotation.set(0, a.hd + (a.look || 0), 0); // v2.5.20 beach walk: face the way they go
      else {
        _o.rotation.set(0, a.dir > 0 ? Math.PI : 0, a.knock > 0 ? a.knock * 0.6 : 0);
        _o.rotation.y += a.vx * 0.25 * (a.dir > 0 ? -1 : 1);
        _o.rotation.y += a.look || 0; // v2.5.6 free will: look around while paused, face a chat partner
      }
      _o.scale.setScalar(a.scale); _o.updateMatrix();
      cs.set(i, _o.matrix, SHIRTS[a.color]);
      // stable look per person while on screen: hat, long hair, skin tone (render-side hash only)
      const hv = hash2(i * 13 + a.color, Math.round(a.scale * 1000));
      cs.setAttr(i, 'aAnim', a.phase, a.amp, -(a.crouch || 0), 0); // v2.5.21: z < 0 = crouch (picking up)
      cs.setAttr(i, 'aVar', hv < 0.28 ? 1 : 0, hash2(i, a.color + 31) < 0.45 ? 1 : 0, hash2(a.color, i * 7 + Math.round(a.scale * 977)), 0);
    }
    cs.update(camera.position.x, camera.position.z, this.dt || 0.016);
    // dogs + leashes
    const D = sim.ai.dogs, lp = this.leash.geometry.getAttribute('position');
    let nl = 0;
    for (let i = 0; i < D.length; i++) {
      const d = D[i];
      if (!d.active) { ds.hide(i); continue; }
      const dx = lerp(d.px, d.x, alpha), dz = lerp(d.pz, d.z, alpha);
      const dy = d.y || 0;
      _o.position.set(dx, dy, dz);
      if (d.hd !== undefined) _o.rotation.set(0, d.hd, 0); // v2.5.20 on the sand: face the way it trots
      else _o.rotation.set(0, (d.dir > 0 ? Math.PI : 0) - d.vx * 0.3 * d.dir, 0);
      // v2.5.21: squat (rear down, a little lower); eased render-side
      d.sqA = (d.sqA || 0) + ((d.squat > 0 ? 1 : 0) - (d.sqA || 0)) * Math.min(1, 8 * (this.dt || 0.016));
      if (d.sqA > 0.01) { _o.rotation.order = 'YXZ'; _o.rotation.x = 0.34 * d.sqA; _o.position.y -= 0.05 * d.scale * d.sqA; }
      _o.scale.setScalar(d.scale); _o.updateMatrix(); _o.rotation.order = 'XYZ';
      ds.set(i, _o.matrix, COATS[d.color]);
      ds.setAttr(i, 'aAnim', d.phase, d.amp, 0, 0);
      if (d.owner >= 0 && P[d.owner] && P[d.owner].active) {
        const o = P[d.owner];
        const ox = lerp(o.px, o.x, alpha), oz = lerp(o.pz, o.z, alpha);
        if (o.hd === undefined && d.hd === undefined) {
          const hand = 0.24 * (d.side >= 0 ? -1 : 1) * (o.dir > 0 ? -1 : 1);
          lp.setXYZ(nl * 2, ox - hand, 0.85 * o.scale, oz);
          lp.setXYZ(nl * 2 + 1, dx, 0.4 * d.scale, dz + (d.dir > 0 ? -0.33 : 0.33) * d.scale);
        } else { // v2.5.20 beach walk: hand on the dog's side of the owner, harness at the dog's back (any heading)
          const oh = o.hd !== undefined ? o.hd : (o.dir > 0 ? Math.PI : 0), dh = d.hd !== undefined ? d.hd : (d.dir > 0 ? Math.PI : 0);
          const px = Math.cos(oh), pz = -Math.sin(oh), sd = ((dx - ox) * px + (dz - oz) * pz) >= 0 ? 1 : -1;
          lp.setXYZ(nl * 2, ox + px * 0.24 * sd, (o.y || 0) + (0.85 - 0.42 * (o.crouch || 0)) * o.scale, oz + pz * 0.24 * sd);
          lp.setXYZ(nl * 2 + 1, dx + Math.sin(dh) * 0.33 * d.scale, dy + 0.4 * d.scale, dz + Math.cos(dh) * 0.33 * d.scale);
        }
        // v2.5.23 1st person: a leash passing within the near radius of the lens is not drawn this frame
        if (this.nearR > 0 && segNear(lp, nl * 2, camera.position, this.nearR)) continue;
        nl++;
      }
    }
    ds.update(camera.position.x, camera.position.z, this.dt || 0.016);
    lp.needsUpdate = true; this.leash.geometry.setDrawRange(0, nl * 2);
    this.updateChores(sim, alpha);
    // proximity field rings: green clean, yellow near miss band, red contact course
    if (this.rings.visible) {
      const near = sim.nearWindow();
      const cand = [];
      const add = (a) => { if (!a.active || a.x < -4.6) return; const dz = a.z - r.z; if (dz < -22 || dz > 1) return; cand.push(a); };
      P.forEach(add); D.forEach(add);
      cand.sort((a, b) => (b.z - a.z));
      const col = new THREE.Color();
      let k = 0;
      for (const a of cand) {
        if (k >= 24) break;
        const gap = Math.abs(a.x - r.x) - (RUNNER_R + a.radius);
        if (a.hit) col.setRGB(1, 0.15, 0.1);
        else if (gap < 0) col.setRGB(0.9, 0.12, 0.08);
        else { // v2.5.4: yellow near-miss band fades softly into green (Gaussian) instead of switching
          const m = gauss(Math.max(0, gap - 0.6 * near), 0.5 * near);
          col.setRGB(0.15 + 0.8 * m, 0.85 - 0.1 * m, 0.3 - 0.2 * m);
        }
        const fade = Math.min(1, (22 + (a.z - r.z)) / 8);
        col.multiplyScalar(fade * 0.8);
        _o.position.set(lerp(a.px, a.x, alpha), 0.05, lerp(a.pz, a.z, alpha)); _o.rotation.set(0, 0, 0); _o.scale.setScalar(a.dog ? 1.1 : 0.9); _o.updateMatrix();
        this.rings.setMatrixAt(k, _o.matrix); this.rings.setColorAt(k, col); k++;
      }
      this.rings.count = k;
      this.rings.instanceMatrix.needsUpdate = true; if (this.rings.instanceColor) this.rings.instanceColor.needsUpdate = true;
    }
    // obstacles
    let nb = 0, np = 0, nk = 0;
    for (const o of sim.obs) {
      if (!o.active) continue;
      const w = o.x1 - o.x0, cx = (o.x0 + o.x1) / 2;
      if (o.type === 0) {
        _o.position.set(cx, 1.08, o.z); _o.rotation.set(0, 0, 0); _o.scale.set(w, 0.5, 0.12); _o.updateMatrix();
        this.bars.setMatrixAt(nb++, _o.matrix);
        for (const px of [o.x0, o.x1]) { _o.position.set(px, 0, o.z); _o.scale.set(1, 1.15, 1); _o.updateMatrix(); this.posts.setMatrixAt(np++, _o.matrix); }
      } else {
        for (let l = o.l0; l <= o.l1; l++) { _o.position.set(o.x0 + (l - o.l0 + 0.5) * 1.6, 0, o.z); _o.rotation.set(0, 0, 0); _o.scale.set(1, 1.1, 1); _o.updateMatrix(); this.barriers.setMatrixAt(nk++, _o.matrix); }
      }
    }
    this.bars.count = nb; this.posts.count = np; this.barriers.count = nk;
    for (const m of [this.bars, this.posts, this.barriers]) m.instanceMatrix.needsUpdate = true;
    this.bars.visible = nb > 0; this.posts.visible = np > 0; this.barriers.visible = nk > 0;
    // pickups: bob and spin; a taken pickup pops up, swells and vanishes in 0.3 s
    let no = 0, nd = 0;
    const tt = sim.t;
    for (const p of sim.picks) {
      if (!p.active || p.z < r.z - 120) continue;
      let sc = 1, y = p.y + Math.sin(tt * 3 + p.z * 0.7) * 0.08;
      if (p.taken >= 0) { const a = tt - p.taken; if (a > 0.3) continue; sc = 1 + a * 4 - a * a * 10; y += a * 2.2; if (sc <= 0.02) continue; }
      _o.position.set(p.x, y, p.z); _o.scale.setScalar(sc);
      if (p.type === PICK.DRINK) {
        if (nd >= 12) continue;
        _o.rotation.set(0.25, tt * 2.2 + p.z, 0); _o.scale.multiplyScalar(1.5); _o.position.y -= 0.25; _o.updateMatrix();
        this.drinks.setMatrixAt(nd++, _o.matrix);
      } else {
        _o.rotation.set(0, tt * 3.2 + p.z, 0); _o.updateMatrix();
        this.orbs.setMatrixAt(no, _o.matrix); this.orbs.setColorAt(no, this.orbCol[p.trail === -2 ? 1 : 0]); no++;
      }
    }
    this.orbs.count = no; this.drinks.count = nd; this.orbs.visible = no > 0; this.drinks.visible = nd > 0;
    this.orbs.instanceMatrix.needsUpdate = true; if (this.orbs.instanceColor) this.orbs.instanceColor.needsUpdate = true;
    this.drinks.instanceMatrix.needsUpdate = true;
    // fx
    const wp = sim.ws.p;
    this.rainMat.uniforms.uI.value = wp.rain; this.rainMat.uniforms.uCam.value.copy(camera.position);
    // v2.5.24: rain slant follows the (chaos-drifted) breeze; the drift speed term stays fixed (no jumps)
    this.rainMat.uniforms.uSlant.value += (0.2 + 1.2 * (wp.wind || 0) - this.rainMat.uniforms.uSlant.value) * Math.min(1, (this.dt || 0.016) * 2);
    this.rain.visible = wp.rain > 0.02;
    this.sprayMat.uniforms.uI.value = wp.spray; this.sprayMat.uniforms.uCam.value.copy(camera.position);
    this.sprayMat.uniforms.uScale.value = 260 * pixelRatio;
    this.spray.visible = wp.spray > 0.08;
  }
}
