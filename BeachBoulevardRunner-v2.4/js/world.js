// World: streamed chunks (frustum culled, LOD0/LOD1, fog fade), sea strip, sky dome, instanced towers.
import * as THREE from '../vendor/three.module.js';
import { CHUNK_LEN, DECK_HALF, SUN_DIR } from './config.js';
import { Builder, hex, mul, mix3 } from './geo.js';
import { hash2 } from './rng.js';
import { bakedMaterial, skyMaterial, seaMaterial, U } from './materials.js';
import * as P from './props.js';

const C = P.COLORS;
const VARIANTS = 6;

// ---------- Procedural color map: promenade pavers with the afternoon tint painted in.
export function makeDeckTexture(size) {
  const cv = document.createElement('canvas');
  cv.width = cv.height = size;
  const g = cv.getContext('2d');
  const n = 8, t = size / n;
  let seed = 7;
  const rnd = () => { seed = (seed * 16807) % 2147483647; return seed / 2147483647; };
  g.fillStyle = '#9c8a74'; g.fillRect(0, 0, size, size);
  for (let i = 0; i < n; i++) for (let j = 0; j < n; j++) {
    // wavy band of darker pavers, like the old Tel Aviv promenade pattern
    const wave = Math.sin((i / n) * Math.PI * 2 + (j / n) * Math.PI * 2) > 0.35;
    const base = wave ? [196, 170, 140] : [236, 224, 204];
    const k = 0.92 + rnd() * 0.12;
    g.fillStyle = `rgb(${Math.floor(base[0] * k)},${Math.floor(base[1] * k)},${Math.floor(base[2] * k)})`;
    const gap = Math.max(1, Math.floor(t * 0.05));
    g.fillRect(i * t + gap, j * t + gap, t - gap * 2, t - gap * 2);
  }
  // speckle + warm sheen streaks (baked hour)
  const dots = size * size / 40;
  for (let d = 0; d < dots; d++) {
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

// ---------- Chunk geometry (local z in [-L/2, L/2]); lod 0 full, 1 simplified. rich = HIGH/ULTRA props.
function buildChunk(variant, lod, rich) {
  const b = new Builder();
  const L = CHUNK_LEN, z0 = -L / 2, z1 = L / 2;
  const det = lod === 0;
  const r = (k) => hash2(variant * 131 + 7, k);
  // 1) shadow casters first (props register casters, ground is baked after)
  const props = new Builder();
  props.casters = b.casters;
  const palmStep = rich ? 6.5 : 9.5;
  // palm rows use the same pattern in every chunk, so the shadows of the neighbouring chunks'
  // palms (long golden-hour shadows cross chunk borders) can be baked in too.
  const rowL = (k) => ({ x: -5.7 + (hash2(k, 1) - 0.5) * 0.5, h: 7 + hash2(k, 2) * 2.5 });
  const palmR = rich ? 10 : 13.333;
  for (let zz = z0 + 3, k = 0; zz < z1 - 1; zz += palmStep, k++) { const q = rowL(k); P.palm(props, q.x, zz, q.h, k * 17 + 3, det); }
  for (let zz = z0 + 6, k = 0; zz < z1 - 1; zz += palmR, k++) P.palm(props, 7.2, zz, 6.5 + hash2(k, 3) * 2, k * 23 + 5, det);
  for (const off of [-L, L, -2 * L, 2 * L]) {
    for (let zz = z0 + 3, k = 0; zz < z1 - 1; zz += palmStep, k++) { const q = rowL(k); b.addTrunk(q.x, zz + off, q.h, 0.26); b.addDisk(q.x, q.h, zz + off, 2.7, 8); }
  }
  // beach umbrellas and sunbeds
  const umbN = rich ? 7 : 4;
  for (let k = 0; k < umbN; k++) {
    const ux = -10 - r(k + 400) * 22, uz = z0 + 3 + r(k + 450) * (L - 6);
    P.umbrella(props, ux, uz, variant * 300 + k, det, false);
    if (det || rich) { P.sunbed(props, ux + 0.9, uz + 0.2, 0.1, det); if (rich) P.sunbed(props, ux - 0.9, uz + 0.1, -0.1, det); }
  }
  if (variant % 3 === 0) P.lifeguard(props, -20, 4, det);
  if (variant === 4 && det) { // beach volleyball net
    props.box(-26, 0, -3, 0.1, 2.4, 0.1, C.white); props.box(-26, 0, 6, 0.1, 2.4, 0.1, C.white);
    props.box(-26, 1.6, 1.5, 0.03, 0.8, 9, mix3(C.white, C.sand, 0.3));
  }
  // right side: cafes, kiosks, lamps, benches
  if (variant % 2 === 0) { P.cafe(props, 11, -8, 12, variant * 7, det); if (rich) P.umbrella(props, 8.5, -10, variant * 9 + 1, det, true); }
  else { P.kiosk(props, 10, -10, variant); P.cafe(props, 11, 9, 10, variant * 7 + 3, det); }
  if (rich) P.umbrella(props, 8.6, 9, variant * 9 + 2, det, true);
  P.cafe(props, 11, variant % 2 === 0 ? 9 : -9.5, variant % 2 === 0 ? 11 : 4, variant * 11 + 5, det);
  if (det) {
    for (let zz = z0 + 4; zz < z1; zz += 13) P.lamp(props, 6.8, zz, true);
    for (let zz = z0 + 9; zz < z1; zz += 16) P.bench(props, -4.0 - 0.0, zz);
  }
  // 2) ground with baked shadows
  b.shadowed = true;
  const deckStep = det ? (rich ? 0.6 : 1.0) : 2.25;
  const nzDeck = Math.round(L / deckStep), nxDeck = Math.max(4, Math.round((DECK_HALF * 2) / deckStep));
  b.wet = 1; b.mapW = 1; b.uvMode = 'xz'; b.uvScale = 0.25;
  b.grid(-DECK_HALF, DECK_HALF, z0, z1, nxDeck, nzDeck, () => C.deck);
  b.mapW = 0; b.uvMode = null;
  b.grid(DECK_HALF, 6.4, z0, z1, 2, Math.round(L / (det ? 1.2 : 4)), () => C.bike);
  b.wet = 0.3;
  const sandStep = det ? (rich ? 2 : 3.3) : 6.6;
  b.grid(-46, -4.9, z0, z1, Math.round(41 / sandStep), Math.round(L / sandStep),
    (x, z) => mix3(C.sand, C.sandWet, Math.max(0, Math.min(1, (-x - 38) / 8)) + 0.06 * Math.sin(x * 1.3 + z * 0.7)),
    (x, z) => -0.25 - Math.max(0, (-x - 5)) * 0.016 + 0.06 * Math.sin(x * 0.7) * Math.sin(z * 0.5 + variant));
  b.wet = 0.6;
  b.grid(6.4, 15, z0, z1, det ? 6 : 2, Math.round(L / (det ? 2 : 6)), (x, z) => mix3(C.plaza, C.deck, 0.3 + 0.2 * Math.sin(z * 0.9)));
  b.wet = 1;
  b.grid(15, 23, z0, z1, 2, det ? 8 : 2, () => C.asphalt);
  b.shadowed = false;
  if (det) for (let zz = z0 + 1; zz < z1; zz += 6) b.quad([18.9, 0.02, zz + 3], [19.1, 0.02, zz + 3], [19.1, 0.02, zz], [18.9, 0.02, zz], C.line);
  b.wet = 0;
  b.box(23.5, 0, 0, 1.0, 0.15, L, C.curb, { skipBottom: true });
  b.box(-4.7, 0, 0, 0.45, 0.45, L, C.wall, { skipBottom: true, top: mul(C.wall, 1.05) });
  b.box(15, 0, 0, 0.3, 0.15, L, C.curb, { skipBottom: true });
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
    this.buildSky();
    this.buildTowers();
    this.applyPreset(preset);
  }
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
    this.slots = [];
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
  update(camZ, fogFar) {
    const L = CHUNK_LEN;
    const p = this.preset;
    const first = Math.floor(-camZ / L) - 1;
    const n = this.slots.length;
    let visible = 0;
    for (let i = first; i < first + n; i++) {
      const s = this.slots[((i % n) + n) % n];
      const centerZ = -(i + 0.5) * L;
      const dist = Math.abs(centerZ - camZ) - L / 2;
      const lod = dist < p.lod0 ? 0 : 1;
      if (s.index !== i || s.lod !== lod) {
        s.index = i; s.lod = lod;
        const variant = Math.floor(hash2(i, 99) * VARIANTS);
        s.mesh.geometry = this.geo(variant, lod, p.rich);
        s.mesh.position.z = centerZ;
      }
      s.mesh.visible = dist < fogFar + 10; // beyond fog end: fully faded, skip the draw
      if (s.mesh.visible) visible++;
    }
    this.visibleChunks = visible;
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
