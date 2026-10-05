// v2.5 seagulls: a flock of gulls flies through the view. One InstancedMesh (one draw while a
// flock is in the air), wings flap in the vertex shader (inner and outer wing segments, flap /
// glide per bird). Render side only: own RNG, never the sim's, so runs stay deterministic.
// onCall(pan, dist) lets the audio add a gull call (Seagulls ambience channel).
// v2.5.1: flight paths are planned in view space when a flock spawns (from the camera FOV and
// aspect, so they also work on a narrow portrait phone): z is relative to the camera, so the
// runner does not simply overtake them. First flock 8-12 s after the run starts, then every
// 15-25 s; bigger birds with dark wingtips, flying low over the beach and the promenade.
import * as THREE from '../vendor/three.module.js';
import { Builder, hex, mul } from './geo.js';
import { makeRng } from './rng.js';
import { U } from './materials.js';

const MAXB = 28; // v2.5.8: denser flocks
function gullGeometry() {
  const b = new Builder({ rig: true });
  const white = hex(0xf6f4f0), grey = hex(0x949da8), dark = hex(0x1c1d21), beak = hex(0xe9b43a);
  b.rig = [0, 0, 0];
  b.ellip(0, 0, 0, 0.09, 0.08, 0.3, 6, 4, white);
  b.ellip(0, 0.05, -0.27, 0.06, 0.06, 0.08, 6, 3, white);
  b.limb(0, 0.04, -0.33, 0, 0.03, -0.42, 0.018, 0.006, 4, beak);
  b.limb(0, 0.0, 0.22, 0, 0.0, 0.42, 0.07, 0.02, 4, mul(white, 0.95)); // tail
  for (const s of [-1, 1]) {
    // inner wing (code 1) and outer wing (code 2) with dark tip; closed thin slabs
    const wing = (x0, x1, zf0, zb0, zf1, zb1, c, code) => {
      b.rig = [s * code, 0, 0];
      const A = [s * x0, 0.02, zf0], B = [s * x1, 0.02, zf1], Cc = [s * x1, 0.02, zb1], D = [s * x0, 0.02, zb0];
      const A2 = [s * x0, -0.01, zf0], B2 = [s * x1, -0.01, zf1], C2 = [s * x1, -0.01, zb1], D2 = [s * x0, -0.01, zb0];
      if (s > 0) { b.quad(A, D, Cc, B, c); b.quad(A2, B2, C2, D2, mul(c, 0.8)); } else { b.quad(A, B, Cc, D, c); b.quad(A2, D2, C2, B2, mul(c, 0.8)); }
    };
    wing(0.05, 0.42, -0.1, 0.12, -0.06, 0.14, grey, 1);
    wing(0.42, 0.62, -0.06, 0.14, 0.0, 0.11, grey, 2);
    wing(0.62, 0.84, 0.0, 0.11, 0.07, 0.09, dark, 2); // black wingtips (yellow-legged gull)
  }
  return b.build();
}

export class Birds {
  constructor(scene) {
    const g = gullGeometry();
    this.attr = new THREE.InstancedBufferAttribute(new Float32Array(MAXB * 4), 4); this.attr.setUsage(THREE.DynamicDrawUsage);
    g.setAttribute('aBird', this.attr);
    const mat = new THREE.ShaderMaterial({
      fog: true, vertexColors: true,
      uniforms: Object.assign({ fogColor: { value: new THREE.Color() }, fogNear: { value: 1 }, fogFar: { value: 1000 }, fogDensity: { value: 0 } },
        { uTime: U.uTime, uAmb: U.uAmb, uSun: U.uSun }),
      vertexShader: `attribute vec3 aRig; attribute vec4 aLight; attribute vec4 aBird; uniform float uTime; uniform vec3 uAmb; uniform vec3 uSun;
        varying vec3 vC;
        #include <fog_pars_vertex>
        vec3 rotZp(vec3 p, float px, float a) { float c = cos(a), s = sin(a); float x = p.x - px; return vec3(px + x * c - p.y * s, x * s + p.y * c, p.z); }
        void main() {
          vec3 p = position; float w = aRig.x, side = sign(w), aw = abs(w);
          float flap = sin(uTime * aBird.z + aBird.x) * aBird.y + 0.1 + aBird.w;
          if (aw > 1.5) p = rotZp(p, side * 0.42, side * (flap * 0.7 - aBird.w * 2.2));
          if (aw > 0.5) p = rotZp(p, 0.0, side * flap);
          vec4 mvPosition = viewMatrix * (modelMatrix * instanceMatrix * vec4(p, 1.0));
          gl_Position = projectionMatrix * mvPosition;
          // v2.5.1: a floor on the light so the white body and dark tips read in every weather
          vC = color * max(vec3(0.62), uAmb * aLight.y + uSun * (0.35 + aLight.x * 0.8));
          #include <fog_vertex>
        }`,
      fragmentShader: `varying vec3 vC;
        #include <fog_pars_fragment>
        void main() { gl_FragColor = vec4(min(vC, vec3(1.0)), 1.0);
        // v2.5.1: only about half the fog, so the gulls stay readable in RAIN and SEA SPRAY
        #ifdef USE_FOG
          gl_FragColor.rgb = mix(gl_FragColor.rgb, fogColor, smoothstep(fogNear, fogFar, vFogDepth) * 0.55);
        #endif
        }`,
    });
    this.mesh = new THREE.InstancedMesh(g, mat, MAXB);
    // positions change every frame and the flock moves with the camera: never frustum-cull it
    this.mesh.frustumCulled = false; this.mesh.count = 0; this.mesh.visible = false; this.mesh.renderOrder = 6;
    scene.add(this.mesh);
    this.rng = makeRng(0x6a11);
    this.flocks = []; this.max = 8; this.next = 10; this.spawned = 0; this.onCall = null; this.wasRunning = false;
    this.maxFlocks = 2; // v2.5.8: more concurrent flocks on richer presets
    this.scale = 2.3; this.camVz = 0; this.lastCz = null; this.visible = 0; this.onScreen = 0; this.nearest = Infinity;
    this._o = new THREE.Object3D(); this._v = new THREE.Vector3();
  }
  applyPreset(p) { this.max = Math.min(MAXB, Math.max(4, p.lod.birds)); this.maxFlocks = p.name === 'LOW' ? 2 : p.name === 'MEDIUM' ? 3 : 4; }
  // Plan a path in view space. kind: 'cross' (sea side to city side, 24-42 m ahead), 'glide'
  // (from far ahead, low over the beach, passing over the camera), 'along' (overtake the runner
  // from behind and fly on ahead). Positions: x and y in world metres, z relative to the camera.
  spawn(camera, kind, opt) {
    const r = this.rng;
    kind = kind || r.pick(['cross', 'cross', 'glide', 'along', 'high', 'beach']); // v2.5.8: more path variety
    const n = Math.max(3, Math.round(this.max * 0.5 * r.range(0.75, 1.15))); // v2.5.8: several flocks share the total cap
    const fovV = (camera.fov * Math.PI) / 180, tanV = Math.tan(fovV / 2), tanH = tanV * camera.aspect;
    const top = Math.max(0.12, fovV / 2 - 0.16); // camera looks about 9 deg down
    const cy = camera.position.y, cx = camera.position.x;
    const f = { kind, birds: [], t: 0, callT: r.range(0.3, 1.0) };
    if (kind === 'cross') {
      const d = r.range(24, 40), hw = d * tanH + 5, dir = r.chance(0.75) ? 1 : -1, y = cy + d * Math.tan(Math.max(0.1, top * r.range(0.35, 0.65)));
      f.T = r.range(8, 11);
      f.a = new THREE.Vector3(cx - dir * hw, y, -d); f.b = new THREE.Vector3(cx + dir * hw, y + r.range(-1.5, 2), -d - r.range(-4, 10));
    } else if (kind === 'glide') {
      const d = r.range(52, 62), x0 = cx - d * tanH * r.range(0.15, 0.45);
      f.T = r.range(9, 12);
      f.a = new THREE.Vector3(x0, cy + r.range(9, 12), -d); f.b = new THREE.Vector3(cx + r.range(-6, -1), cy + r.range(6.5, 8), 6);
    } else if (kind === 'high') {
      // v2.5.8: high cross, enters/exits the top of the frustum
      const d = r.range(30, 48), hw = d * tanH + 8, dir = r.chance(0.5) ? 1 : -1;
      f.T = r.range(7, 10);
      f.a = new THREE.Vector3(cx - dir * hw, cy + d * Math.tan(top * r.range(0.55, 0.95)), -d);
      f.b = new THREE.Vector3(cx + dir * hw, cy + d * Math.tan(top * r.range(0.4, 0.8)), -d + r.range(-12, 8));
    } else if (kind === 'beach') {
      // low over the beach, sea -> promenade and out the far side
      const d = r.range(18, 32), dir = r.chance(0.7) ? 1 : -1;
      f.T = r.range(8, 11);
      f.a = new THREE.Vector3(cx - 28, cy + r.range(3.5, 6), -d);
      f.b = new THREE.Vector3(cx + dir * (d * tanH + 6), cy + r.range(5, 9), -d - r.range(0, 16));
    } else {
      f.T = r.range(10, 12);
      f.a = new THREE.Vector3(cx + r.range(-9, -6), cy + r.range(7.5, 9), 5); f.b = new THREE.Vector3(cx + r.range(-12, -2), cy + r.range(9, 13), -r.range(70, 85));
    }
    if (opt && opt.t0) f.t = opt.t0 * f.T; // tests / screenshots: start part way along the path
    for (let i = 0; i < n; i++) {
      const row = Math.ceil(i / 2), side = i % 2 ? 1 : -1; // loose V
      f.birds.push({ o: new THREE.Vector3(side * row * r.range(1.6, 2.6), r.range(-1, 1), row * r.range(1.4, 2.4) + r.range(-0.6, 0.6)),
        ph: r.range(0, 6.28), rate: r.range(7, 9.5), amp: 0.7, ampT: 0.7, sw: r.range(0, 6.28), sw2: r.range(0.4, 0.9), flapT: r.range(0.5, 3) });
    }
    this.flocks.push(f); this.spawned++;
    return f;
  }
  // running: the first flock comes 8-12 s after a run starts, then every 15-25 s (no spawns on
  // the title card, where the camera looks back at the runner)
  update(dt, camera, running = true) {
    const r = this.rng, cx = camera.position.x, cz = camera.position.z, o = this._o;
    if (this.lastCz !== null && dt > 0) this.camVz += ((cz - this.lastCz) / dt - this.camVz) * Math.min(1, dt * 4);
    this.lastCz = cz;
    if (running && !this.wasRunning) { this.next = r.range(4, 8); this.flocks.length = 0; } // v2.5.8: sooner first flock
    this.wasRunning = running;
    if (running) {
      this.next -= dt;
      if (this.next <= 0 && this.flocks.length < this.maxFlocks) { this.spawn(camera); this.next = r.range(7, 14); } // v2.5.8 denser
    }
    let k = 0, on = 0, nearest = Infinity;
    camera.updateMatrixWorld();
    for (let fi = this.flocks.length - 1; fi >= 0; fi--) {
      const f = this.flocks[fi];
      f.t += dt;
      if (f.t > f.T) { this.flocks.splice(fi, 1); continue; }
      const u = f.t / f.T, e = u * u * (3 - 2 * u) * 0.35 + u * 0.65; // gentle ease
      const px = f.a.x + (f.b.x - f.a.x) * e, py = f.a.y + (f.b.y - f.a.y) * e, pz = cz + f.a.z + (f.b.z - f.a.z) * e;
      // heading from the world velocity (path speed plus the camera's own speed)
      const vx = (f.b.x - f.a.x) / f.T, vz = (f.b.z - f.a.z) / f.T + this.camVz;
      const yaw = Math.atan2(-vx, -vz);
      const dist = Math.hypot(px - cx, pz - cz);
      if (dist < nearest) nearest = dist;
      const fade = Math.min(1, (f.T - f.t) / 0.8, f.t / 0.5 + (f.a.z > 0 || Math.abs(f.a.x - cx) > 10 ? 1 : 0));
      f.callT -= dt;
      if (f.callT <= 0) { f.callT = r.range(1.2, 3.2); if (this.onCall && dist < 120) this.onCall(Math.max(-1, Math.min(1, (px - cx) / 25)), dist); }
      for (const b of f.birds) {
        if (k >= this.max) break;
        b.flapT -= dt;
        if (b.flapT <= 0) { const flap = b.ampT < 0.3; b.ampT = flap ? r.range(0.55, 0.8) : 0.06; b.flapT = flap ? r.range(1.2, 2.6) : r.range(1.5, 3.5); }
        b.amp += (b.ampT - b.amp) * Math.min(1, dt * 3);
        const t = f.t, wob = Math.sin(t * b.sw2 + b.sw);
        const ca = Math.cos(yaw), sa = Math.sin(yaw);
        const ox = b.o.x * ca + b.o.z * sa, oz = -b.o.x * sa + b.o.z * ca;
        o.position.set(px + ox + wob * 0.6, py + b.o.y + Math.sin(t * 0.9 + b.sw) * 0.5, pz + oz);
        // never let a gull fill the screen right next to the camera
        const near = Math.min(1, Math.max(0, (o.position.distanceTo(camera.position) - 4) / 5));
        o.rotation.set(0, yaw + wob * 0.08, -wob * 0.25, 'YXZ'); o.scale.setScalar(this.scale * Math.max(0.001, fade * near)); o.updateMatrix();
        this.mesh.setMatrixAt(k, o.matrix);
        this.attr.setXYZW(k, b.ph, b.amp, b.rate, b.amp < 0.2 ? 0.08 : 0);
        // on-screen count (for the debug overlay and the tests)
        this._v.copy(o.position).project(camera);
        if (this._v.z < 1 && Math.abs(this._v.x) < 1 && Math.abs(this._v.y) < 1) on++;
        k++;
      }
    }
    this.mesh.count = k; this.mesh.visible = k > 0;
    if (k) { this.mesh.instanceMatrix.needsUpdate = true; this.attr.needsUpdate = true; }
    this.visible = k; this.onScreen = on; this.nearest = nearest;
  }
}
