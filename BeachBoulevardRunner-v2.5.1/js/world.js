// World: streamed chunks (frustum culled, v2.5 tiers near / LOD0 / LOD1 / LOD2 with hysteresis, fog fade),
// near-tier instanced palms, umbrellas and benches, sea strip, sky dome, instanced towers.
import * as THREE from '../vendor/three.module.js';
import { CHUNK_LEN, DECK_HALF, SUN_DIR } from './config.js';
import { Builder, hex, mul, mix3 } from './geo.js';
import { hash2 } from './rng.js';
import { bakedMaterial, skyMaterial, seaMaterial, U } from './materials.js';
import * as P from './props.js';

const C = P.COLORS;
const VARIANTS = 6;
const _frustum = new THREE.Frustum(), _pm = new THREE.Matrix4(), _box = new THREE.Box3();

// ---------- v2.5 procedural paving: irregular stones (jittered grid, Voronoi on a torus so the
// texture tiles), mortar joints, a wavy band of darker stones (the old Tel Aviv promenade
// pattern), per-stone tint, worn edges and speckle. The afternoon tint is painted in.
export function makeDeckTexture(size) {
  const cv = document.createElement('canvas');
  cv.width = cv.height = size;
  const g = cv.getContext('2d');
  let seed = 7;
  const rnd = () => { seed = (seed * 16807) % 2147483647; return seed / 2147483647; };
  const N = 7; // stones per tile side (tile = 4 m, so about 0.57 m stones)
  const pts = [];
  for (let j = 0; j < N; j++) for (let i = 0; i < N; i++) {
    const x = (i + 0.5 + (rnd() - 0.5) * 0.75 + (j % 2) * 0.5) / N, y = (j + 0.5 + (rnd() - 0.5) * 0.75) / N;
    const wave = Math.sin(x * Math.PI * 2 + y * Math.PI * 2) > 0.3;
    const base = wave ? [206, 182, 152] : [240, 229, 210];
    const k = 0.9 + rnd() * 0.14, warm = rnd() * 10;
    pts.push({ x: x % 1, y, c: [base[0] * k + warm, base[1] * k + warm * 0.5, base[2] * k] });
  }
  const img = g.createImageData(size, size), d = img.data;
  const mortar = [176, 160, 138], edge = 0.014;
  for (let py = 0; py < size; py++) for (let px = 0; px < size; px++) {
    const u = (px + 0.5) / size, v = (py + 0.5) / size;
    let d1 = 9, d2 = 9, best = null;
    for (const q of pts) {
      let dx = Math.abs(u - q.x), dy = Math.abs(v - q.y);
      if (dx > 0.5) dx = 1 - dx; if (dy > 0.5) dy = 1 - dy;
      const dd = dx * dx + dy * dy;
      if (dd < d1) { d2 = d1; d1 = dd; best = q; } else if (dd < d2) d2 = dd;
    }
    const gap = Math.sqrt(d2) - Math.sqrt(d1); // distance to the joint
    const o = (py * size + px) * 4;
    if (gap < edge * 0.5) { d[o] = mortar[0]; d[o + 1] = mortar[1]; d[o + 2] = mortar[2]; }
    else {
      const bev = Math.min(1, (gap - edge * 0.5) / (edge * 1.6)); // worn, slightly darker edges
      const k = 0.86 + 0.14 * bev;
      d[o] = best.c[0] * k; d[o + 1] = best.c[1] * k; d[o + 2] = best.c[2] * k;
    }
    d[o + 3] = 255;
  }
  g.putImageData(img, 0, 0);
  // speckle + warm sheen (baked hour)
  const dots = size * size / 40;
  for (let k = 0; k < dots; k++) {
    const v = Math.floor(rnd() * 60);
    g.fillStyle = `rgba(${90 + v},${80 + v},${70 + v},0.18)`;
    g.fillRect(rnd() * size, rnd() * size, Math.max(1, size / 256), Math.max(1, size / 256));
  }
  const tex = new THREE.CanvasTexture(cv);
  tex.wrapS = tex.wrapT = THREE.RepeatWrapping;
  tex.anisotropy = size >= 1024 ? 4 : 1;
  tex.generateMipmaps = true;
  tex.minFilter = THREE.LinearMipmapLinearFilter;
  return tex;
}

// ---------- prop layouts shared by the chunk builder and the v2.5 near-tier instances
const L0 = CHUNK_LEN;
export function chunkPalms(rich) {
  const out = [], z0 = -L0 / 2, z1 = L0 / 2;
  const palmStep = rich ? 6.5 : 9.5, palmR = rich ? 10 : 13.333;
  const rowL = (k) => ({ x: -5.7 + (hash2(k, 1) - 0.5) * 0.5, h: 7 + hash2(k, 2) * 2.5 });
  for (let zz = z0 + 3, k = 0; zz < z1 - 1; zz += palmStep, k++) { const q = rowL(k); out.push({ x: q.x, z: zz, h: q.h, seed: k * 17 + 3 }); }
  for (let zz = z0 + 6, k = 0; zz < z1 - 1; zz += palmR, k++) out.push({ x: 7.2, z: zz, h: 6.5 + hash2(k, 3) * 2, seed: k * 23 + 5 });
  return out;
}
export function chunkUmbrellas(variant, rich) {
  const out = [], z0 = -L0 / 2, r = (k) => hash2(variant * 131 + 7, k);
  const umbN = rich ? 7 : 4;
  for (let k = 0; k < umbN; k++) out.push({ x: -10 - r(k + 400) * 22, z: z0 + 3 + r(k + 450) * (L0 - 6), seed: variant * 300 + k, cafe: false, k });
  if (variant % 2 === 0 && rich) out.push({ x: 8.5, z: -10, seed: variant * 9 + 1, cafe: true });
  if (rich) out.push({ x: 8.6, z: 9, seed: variant * 9 + 2, cafe: true });
  return out;
}
export function chunkBenches() { const out = []; for (let zz = -L0 / 2 + 9; zz < L0 / 2; zz += 16) out.push({ x: -4.0, z: zz }); return out; }

// ---------- Chunk geometry (local z in [-L/2, L/2]).
// v2.5 tiers: 'N' near (as LOD0, but palms, umbrellas and promenade benches come from the
// near-tier instances; cafes and lamps get extra detail), 0 full, 1 simplified, 2 far (very
// cheap palms, coarse ground, no small props). rich = HIGH/ULTRA props.
function buildChunk(variant, lod, rich) {
  const b = new Builder();
  const L = CHUNK_LEN, z0 = -L / 2, z1 = L / 2;
  const near = lod === 'N', det = lod === 0 || near, far = lod === 2;
  const pdet = near ? 2 : det; // prop detail: 2 near, true LOD0, false LOD1 / LOD2
  // 1) shadow casters first (props register casters, ground is baked after)
  const props = new Builder();
  props.casters = b.casters;
  const palmStep = rich ? 6.5 : 9.5;
  // palm rows use the same pattern in every chunk, so the shadows of the neighbouring chunks'
  // palms (long golden-hour shadows cross chunk borders) can be baked in too.
  const rowL = (k) => ({ x: -5.7 + (hash2(k, 1) - 0.5) * 0.5, h: 7 + hash2(k, 2) * 2.5 });
  for (const q of chunkPalms(rich)) {
    if (near) P.palmCasters(props, q.x, q.z, q.h, q.seed, 9);
    else if (far) { P.palmFar(props, q.x, q.z, q.h, q.seed); P.palmCasters(props, q.x, q.z, q.h, q.seed, 6); }
    else P.palm(props, q.x, q.z, q.h, q.seed, det);
  }
  for (const off of [-L, L, -2 * L, 2 * L]) {
    for (let zz = z0 + 3, k = 0; zz < z1 - 1; zz += palmStep, k++) { const q = rowL(k); b.addTrunk(q.x, zz + off, q.h, 0.26); b.addDisk(q.x, q.h, zz + off, 2.7, 8); }
  }
  // beach umbrellas and sunbeds
  for (const u of chunkUmbrellas(variant, rich)) {
    if (near) P.umbrellaCasters(props, u.x, u.z, u.cafe);
    else P.umbrella(props, u.x, u.z, u.seed, det, u.cafe);
    if (!u.cafe && !far && (det || rich)) { P.sunbed(props, u.x + 0.9, u.z + 0.2, 0.1, det); if (rich) P.sunbed(props, u.x - 0.9, u.z + 0.1, -0.1, det); }
  }
  if (variant % 3 === 0) P.lifeguard(props, -20, 4, det);
  if (variant === 4 && det) { // beach volleyball net
    props.box(-26, 0, -3, 0.1, 2.4, 0.1, C.white); props.box(-26, 0, 6, 0.1, 2.4, 0.1, C.white);
    props.box(-26, 1.6, 1.5, 0.03, 0.8, 9, mix3(C.white, C.sand, 0.3));
  }
  // right side: cafes, kiosks, lamps, benches
  if (variant % 2 === 0) P.cafe(props, 11, -8, 12, variant * 7, pdet);
  else { P.kiosk(props, 10, -10, variant); P.cafe(props, 11, 9, 10, variant * 7 + 3, pdet); }
  P.cafe(props, 11, variant % 2 === 0 ? 9 : -9.5, variant % 2 === 0 ? 11 : 4, variant * 11 + 5, pdet);
  if (det) {
    for (let zz = z0 + 4; zz < z1; zz += 13) P.lamp(props, 6.8, zz, pdet);
    if (!near) for (const q of chunkBenches()) P.bench(props, q.x, q.z);
  }
  // 2) ground with baked shadows
  b.shadowed = true;
  const deckStep = det ? (rich ? 0.6 : 1.0) : far ? 4 : 2.25;
  const nzDeck = Math.round(L / deckStep), nxDeck = Math.max(far ? 2 : 4, Math.round((DECK_HALF * 2) / deckStep));
  b.wet = 1; b.mapW = 1; b.uvMode = 'xz'; b.uvScale = 0.25;
  b.grid(-DECK_HALF, DECK_HALF, z0, z1, nxDeck, nzDeck, () => C.deck);
  b.mapW = 0; b.uvMode = null;
  b.grid(DECK_HALF, 6.4, z0, z1, far ? 1 : 2, Math.round(L / (det ? 1.2 : far ? 8 : 4)), () => C.bike);
  b.wet = 0.3;
  const sandStep = det ? (rich ? 2 : 3.3) : far ? 10 : 6.6;
  b.grid(-46, -4.9, z0, z1, Math.round(41 / sandStep), Math.round(L / sandStep),
    (x, z) => mix3(C.sand, C.sandWet, Math.max(0, Math.min(1, (-x - 38) / 8)) + 0.06 * Math.sin(x * 1.3 + z * 0.7)),
    (x, z) => -0.25 - Math.max(0, (-x - 5)) * 0.016 + 0.06 * Math.sin(x * 0.7) * Math.sin(z * 0.5 + variant));
  b.wet = 0.6;
  b.grid(6.4, 15, z0, z1, det ? 6 : 2, Math.round(L / (det ? 2 : far ? 10 : 6)), (x, z) => mix3(C.plaza, C.deck, 0.3 + 0.2 * Math.sin(z * 0.9)));
  b.wet = 1;
  b.grid(15, 23, z0, z1, far ? 1 : 2, det ? 8 : 2, () => C.asphalt);
  b.shadowed = false;
  if (det) for (let zz = z0 + 1; zz < z1; zz += 6) b.quad([18.9, 0.02, zz + 3], [19.1, 0.02, zz + 3], [19.1, 0.02, zz], [18.9, 0.02, zz], C.line);
  b.wet = 0;
  b.box(23.5, 0, 0, 1.0, 0.15, L, C.curb, { skipBottom: true });
  b.box(-4.7, 0, 0, 0.45, 0.45, L, C.wall, { skipBottom: true, top: mul(C.wall, 1.05) });
  if (!far) b.box(15, 0, 0, 0.3, 0.15, L, C.curb, { skipBottom: true });
  // 3) merge props in (props already baked N.L only)
  for (const k of ['pos', 'col', 'lit', 'uvs', 'sways']) { const src = props[k]; for (let i = 0; i < src.length; i++) b[k].push(src[i]); }
  const g = b.build();
  g.userData.tris = b.triCount;
  return g;
}

export class World {
  constructor(scene, preset) {
    this.scene = scene;
    this.cache = new Map();
    this.slots = [];
    this.deckTex = null;
    this.mat = null;
    this.towerMat = bakedMaterial({ instanced: true, tower: true, tint: true });
    this.lodScale = 1;
    this.buildNearProps();
    this.buildSky();
    this.buildTowers();
    this.applyPreset(preset);
  }
  // v2.5 near tier: one instanced draw each for palms (a whole chunk's palm rows per instance,
  // exactly the same seeds as the mid palms), umbrellas (instance color = canopy) and benches
  buildNearProps() {
    this.nearPalmGeo = {};
    this.palmNear = new THREE.InstancedMesh(new THREE.BufferGeometry(), bakedMaterial({ sway: true }), 6);
    this.umbNear = new THREE.InstancedMesh(P.umbrellaKit(0), bakedMaterial({ tint: true }), 64);
    this.benchNear = new THREE.InstancedMesh(P.benchNearKit(), bakedMaterial({}), 18);
    this.umbNear.setColorAt(0, new THREE.Color(1, 1, 1));
    for (const m of [this.palmNear, this.umbNear, this.benchNear]) { m.frustumCulled = false; m.count = 0; m.visible = false; m.instanceMatrix.setUsage(THREE.DynamicDrawUsage); this.scene.add(m); }
    this.nearKey = '';
  }
  palmRowGeo(rich) {
    const k = rich ? 1 : 0;
    if (!this.nearPalmGeo[k]) { const b = new Builder(); for (const q of chunkPalms(rich)) P.palmNear(b, q.x, q.z, q.h, q.seed); this.nearPalmGeo[k] = b.build(); }
    return this.nearPalmGeo[k];
  }
  fillNearProps(list) {
    const p = this.preset, m4 = new THREE.Matrix4(), col = new THREE.Color();
    if (this.palmNear.geometry !== this.palmRowGeo(p.rich)) this.palmNear.geometry = this.palmRowGeo(p.rich);
    let np = 0, nu = 0, nb = 0;
    for (const { ci, variant, cz } of list) {
      if (np < 6) this.palmNear.setMatrixAt(np++, m4.makeTranslation(0, 0, cz));
      for (const u of chunkUmbrellas(variant, p.rich)) {
        if (nu >= 64) break;
        const s = u.cafe ? 1.2 : 1;
        m4.makeScale(s, u.cafe ? 2.3 / 2.1 : 1, s).setPosition(u.x, 0, cz + u.z);
        this.umbNear.setMatrixAt(nu, m4); col.setRGB(...P.umbrellaColor(u.seed)); this.umbNear.setColorAt(nu, col); nu++;
      }
      for (const q of chunkBenches()) if (nb < 18) this.benchNear.setMatrixAt(nb++, m4.makeTranslation(q.x, 0, cz + q.z));
    }
    for (const [m, n] of [[this.palmNear, np], [this.umbNear, nu], [this.benchNear, nb]]) {
      m.count = n; m.visible = n > 0; m.instanceMatrix.needsUpdate = true; if (m.instanceColor) m.instanceColor.needsUpdate = true;
    }
  }
  // decor asks which tier a chunk index currently has (-1 near, 0, 1, 2; 9 = not streamed)
  inView(cz) {
    _box.min.set(-46, -1, cz - CHUNK_LEN / 2); _box.max.set(24, 12, cz + CHUNK_LEN / 2);
    return _frustum.intersectsBox(_box);
  }
  lodFor(ci) { for (const s of this.slots) if (s.index === ci) return s.lod; return 9; }
  geo(variant, lod, rich) {
    const key = `${variant}:${lod}:${rich ? 1 : 0}`;
    let g = this.cache.get(key);
    if (!g) { g = buildChunk(variant, lod, rich); this.cache.set(key, g); }
    return g;
  }
  applyPreset(p) {
    this.preset = p;
    if (!this.deckTex || this.deckTex.image.width !== p.tex) {
      if (this.deckTex) this.deckTex.dispose();
      this.deckTex = makeDeckTexture(p.tex);
    }
    if (this.mat) this.mat.dispose();
    this.mat = bakedMaterial({ map: this.deckTex, wet: true, reflect: p.reflect, sway: true });
    for (const s of this.slots) this.scene.remove(s.mesh);
    this.slots = []; this.nearKey = '';
    const n = p.chunksAhead + 2;
    for (let i = 0; i < n; i++) {
      const mesh = new THREE.Mesh(this.geo(0, 1, p.rich), this.mat);
      mesh.frustumCulled = true; mesh.matrixAutoUpdate = true; mesh.renderOrder = 0;
      this.scene.add(mesh);
      this.slots.push({ mesh, index: -999, lod: -1 });
    }
    // sea
    if (this.sea) { this.scene.remove(this.sea); this.sea.geometry.dispose(); this.sea.material.dispose(); }
    const sg = new THREE.PlaneGeometry(520, 900, Math.max(4, Math.floor(p.seaSeg / 3)), p.seaSeg);
    sg.rotateX(-Math.PI / 2);
    sg.translate(-46 - 260, -0.85, 0);
    this.sea = new THREE.Mesh(sg, seaMaterial(p.rich));
    this.sea.frustumCulled = false; this.sea.renderOrder = 0;
    this.scene.add(this.sea);
    this.sky.material.defines = p.clouds ? { CLOUDS: '' } : {};
    this.sky.material.needsUpdate = true;
    this.glare.visible = p.glare;
    this.towers.count = p.rich ? 40 : 24;
    for (const t of this.towerSlots) t.z = 1e9;
  }
  buildSky() {
    const g = new THREE.SphereGeometry(400, 24, 12);
    this.sky = new THREE.Mesh(g, skyMaterial());
    this.sky.frustumCulled = false;
    this.sky.renderOrder = 10; // after all opaque geometry -> hidden sky pixels fail the depth test
    this.scene.add(this.sky);
    // sun glare sprite (HIGH/ULTRA)
    const cv = document.createElement('canvas'); cv.width = cv.height = 128;
    const x = cv.getContext('2d');
    const gr = x.createRadialGradient(64, 64, 0, 64, 64, 64);
    gr.addColorStop(0, 'rgba(255,240,200,1)'); gr.addColorStop(0.15, 'rgba(255,200,140,0.55)');
    gr.addColorStop(0.5, 'rgba(255,160,90,0.12)'); gr.addColorStop(1, 'rgba(255,140,80,0)');
    x.fillStyle = gr; x.fillRect(0, 0, 128, 128);
    const tex = new THREE.CanvasTexture(cv);
    this.glare = new THREE.Sprite(new THREE.SpriteMaterial({ map: tex, blending: THREE.AdditiveBlending, depthWrite: false, fog: false, transparent: true }));
    this.glare.scale.set(150, 150, 1);
    this.glare.renderOrder = 11;
    this.scene.add(this.glare);
  }
  buildTowers() {
    const b = new Builder({ tint: true });
    b.tint = 1;
    b.box(0, 0, 0, 1, 1, 1, [1, 1, 1], { skipBottom: true });
    const g = b.build();
    const MAXT = 40;
    this.towers = new THREE.InstancedMesh(g, this.towerMat, MAXT);
    this.towers.frustumCulled = false; this.towers.renderOrder = 0;
    this.towerSlots = [];
    const pal = [hex(0xd9d4cc), hex(0xbfc6cc), hex(0xe6d9c2), hex(0x9fb0bd), hex(0xcfc2b0)];
    const col = new THREE.Color();
    for (let i = 0; i < MAXT; i++) {
      col.setRGB(...pal[i % pal.length]);
      this.towers.setColorAt(i, col);
      this.towerSlots.push({ z: 1e9 });
    }
    this.scene.add(this.towers);
  }
  placeTower(i, cycle) {
    const n = this.towers.count;
    const span = 760;
    const spacing = span / n;
    const z = -(cycle * n + i) * spacing;
    const h = 22 + hash2(i, cycle) * 95;
    const w = 12 + hash2(i + 7, cycle) * 12;
    const x = 32 + hash2(i + 3, cycle) * 70;
    const m = new THREE.Matrix4().compose(new THREE.Vector3(x, 0, z), new THREE.Quaternion(), new THREE.Vector3(w, h, w * (0.8 + hash2(i, cycle + 9) * 0.6)));
    this.towers.setMatrixAt(i, m);
    this.towerSlots[i].z = z; this.towerSlots[i].cycle = cycle;
  }
  update(camZ, fogFar, camera) {
    const L = CHUNK_LEN;
    const p = this.preset, lc = p.lod, k = this.lodScale;
    if (camera) { camera.updateMatrixWorld(); _pm.multiplyMatrices(camera.projectionMatrix, camera.matrixWorldInverse); _frustum.setFromProjectionMatrix(_pm); }
    const first = Math.floor(-camZ / L) - 1;
    const n = this.slots.length;
    let visible = 0;
    const nearList = []; let key = '';
    const nearD = lc.chunkNear * k, lod2 = Math.max(p.lod0 + L, lc.lod2 * Math.max(0.6, k)), band = 6; // metres of hysteresis
    for (let i = first; i < first + n; i++) {
      const s = this.slots[((i % n) + n) % n];
      const centerZ = -(i + 0.5) * L;
      const dist = Math.abs(centerZ - camZ) - L / 2;
      const cur = s.index === i ? s.lod : 9;
      const pick = (lim, lv) => dist < lim + (cur <= lv ? band : -band);
      let lod = nearD > 0 && pick(nearD, -1) ? -1 : pick(p.lod0, 0) ? 0 : pick(lod2, 1) ? 1 : 2;
      if (this.forceLod !== null && this.forceLod !== undefined && dist < 120) lod = this.forceLod; // debug comparison only
      const variant = Math.floor(hash2(i, 99) * VARIANTS);
      if (s.index !== i || s.lod !== lod) {
        s.index = i; s.lod = lod;
        s.mesh.geometry = this.geo(variant, lod < 0 ? 'N' : lod, p.rich);
        s.mesh.position.z = centerZ;
      }
      s.mesh.visible = dist < fogFar + 10; // beyond fog end: fully faded, skip the draw
      if (s.mesh.visible) visible++;
      // near-tier props only for near chunks inside the view frustum (chunk meshes are culled by three.js)
      if (lod < 0 && (!camera || this.inView(centerZ))) { nearList.push({ ci: i, variant, cz: centerZ }); key += i + ','; }
    }
    if (key !== this.nearKey) { this.nearKey = key; this.fillNearProps(nearList); }
    this.visibleChunks = visible;
    this.nearChunks = nearList.length;
    // towers recycle
    const tn = this.towers.count, spacing = 760 / tn;
    let dirty = false;
    for (let i = 0; i < tn; i++) {
      const sl = this.towerSlots[i];
      if (sl.z > camZ + 60 || sl.z < camZ - 900) {
        const baseCycle = Math.floor((-(camZ + 60) / spacing - i) / tn) + 1;
        this.placeTower(i, Math.max(0, baseCycle));
        dirty = true;
      }
    }
    if (dirty) this.towers.instanceMatrix.needsUpdate = true;
    this.sea.position.z = camZ - 300;
  }
  frame(camera) {
    this.sky.position.copy(camera.position);
    const sd = U.uSunDir.value, gd = camera.far * 0.85;
    this.glare.position.set(camera.position.x + sd.x * gd, camera.position.y + sd.y * gd, camera.position.z + sd.z * gd);
    this.glare.scale.setScalar(gd * 0.4);
  }
}
