// Beach Boulevard Runner v2.5.1 - bootstrap, fixed-step loop with interpolation, camera, quality presets,
// procedural audio, haptics, results screen and run stats.
import THREE from './setup.js';
import { DT, MAX_STEPS, SEED, PRESETS, PRESET_NAMES, PRESET_KEY, BEST_KEY, STATS_KEY, OPT_KEY, VERSION, clamp, lerp } from './config.js';
import { U } from './materials.js';
import { World } from './world.js';
import { Actors } from './actors.js';
import { Sim } from './sim.js';
import { Input } from './input.js';
import { Hud } from './hud.js';
import { Sfx, AMB_CHANNELS } from './audio.js';
import { Birds } from './birds.js';
import { Decor } from './decor.js';

const params = new URLSearchParams(location.search);
// localStorage can be blocked for file:// or content:// pages on some phones: fall back to memory.
const memStore = {};
const store = {
  get(k) { try { return window.localStorage.getItem(k); } catch (e) { return k in memStore ? memStore[k] : null; } },
  set(k, v) { try { window.localStorage.setItem(k, v); } catch (e) { memStore[k] = String(v); } },
};
const stage = document.getElementById('stage');
const hud = new Hud();
const fsBtn = document.getElementById('fs');
const fsEl = document.documentElement;
if (!(fsEl.requestFullscreen || fsEl.webkitRequestFullscreen)) fsBtn.style.display = 'none';
fsBtn.addEventListener('click', (e) => {
  e.stopPropagation();
  const d = document;
  if (d.fullscreenElement || d.webkitFullscreenElement) (d.exitFullscreen || d.webkitExitFullscreen).call(d);
  else { const r = (fsEl.requestFullscreen || fsEl.webkitRequestFullscreen).call(fsEl, { navigationUI: 'hide' }); if (r && r.catch) r.catch(() => {}); }
});
document.addEventListener('fullscreenchange', () => { fsBtn.textContent = document.fullscreenElement ? 'EXIT FS' : 'FULLSCREEN'; setTimeout(resize, 120); });
const sfx = new Sfx();
// v2.5.1: create / resume the audio context inside real gestures (touch, pointer, key), and try
// again whenever the page becomes visible or fullscreen changes (phones suspend audio then)
// (activation events only: touchend / pointerup / click / keydown / mousedown; not touchstart, so
// the one-time setup never delays the swipe / tap handlers)
for (const ev of ['touchend', 'pointerup', 'mousedown', 'keydown', 'click']) document.addEventListener(ev, () => sfx.unlock(), { capture: true, passive: true });
document.addEventListener('visibilitychange', () => { if (!document.hidden) sfx.resume(); });
document.addEventListener('fullscreenchange', () => sfx.resume());
for (const id of ['verTitle', 'verSet']) { const e = document.getElementById(id); if (e) e.textContent = VERSION; }
// ---------- options (sound / music / haptics), saved
const opts = Object.assign({ sound: true, music: true, haptics: true, character: 'female' }, (() => { try { return JSON.parse(store.get(OPT_KEY)) || {}; } catch (e) { return {}; } })());
function saveOpts() { store.set(OPT_KEY, JSON.stringify(opts)); }
sfx.muted = !opts.sound; sfx.musicOn = opts.music;
// v2.3: background song; PC loads it over http, the phone file has it embedded
// v2.4: it is the only music (procedural music removed; ambience kept); volumes 0..100 saved
delete opts.musicMode;
opts.vol = Object.assign({ master: 100, music: 100, amb: 100, sfx: 100 }, opts.vol || {});
for (const k of ['master', 'music', 'amb', 'sfx']) { opts.vol[k] = Math.max(0, Math.min(100, Math.round(Number(opts.vol[k])))); if (!isFinite(opts.vol[k])) opts.vol[k] = 100; sfx.vol[k] = opts.vol[k]; }
if (opts.character !== 'male') opts.character = 'female';
// v2.5 per-sound ambience channels (on/off + 0..100), saved
opts.ambCh = Object.assign({}, opts.ambCh || {});
delete opts.ambCh.waves; // v2.5.1: the distant-waves bed was removed
for (const [k] of AMB_CHANNELS) {
  const c = Object.assign({ on: true, v: 100 }, opts.ambCh[k] || {});
  c.on = c.on !== false; c.v = Math.max(0, Math.min(100, Math.round(Number(c.v)))); if (!isFinite(c.v)) c.v = 100;
  opts.ambCh[k] = c; sfx.setAmbChannel(k, c.on, c.v);
}
saveOpts(); // v2.5.1: write the migrated settings back (older saves had no ambience keys)
sfx.loadSong('assets/audio/boulevard-theme.mp3');
// ---------- haptics: navigator.vibrate where available (Android Chrome); silently ignored elsewhere
const haptics = { count: 0, last: null, supported: typeof navigator.vibrate === 'function' };
function buzz(pattern) {
  if (!opts.haptics || !haptics.supported) return;
  haptics.count++; haptics.last = pattern;
  try { navigator.vibrate(pattern); } catch (e) { /* not allowed yet */ }
}
const HAPTIC = { near: 14, hurdle: 10, slide: 10, leash: [12, 30, 12], trail: [10, 25, 18], drink: 22, contact: [40, 30, 70], over: [90, 60, 180], heat: [15, 40, 15, 40, 25] };

// ---------- device / GPU detection (probe context, before the real renderer picks MSAA)
function probeGpu() {
  try {
    const c = document.createElement('canvas');
    const gl = c.getContext('webgl2') || c.getContext('webgl');
    if (!gl) return { ok: false, name: '' };
    const ext = gl.getExtension('WEBGL_debug_renderer_info');
    const name = ext ? String(gl.getParameter(ext.UNMASKED_RENDERER_WEBGL)) : String(gl.getParameter(gl.RENDERER));
    const lose = gl.getExtension('WEBGL_lose_context'); if (lose) lose.loseContext();
    return { ok: !!c.getContext, webgl2: typeof WebGL2RenderingContext !== 'undefined' && gl instanceof WebGL2RenderingContext, name };
  } catch (e) { return { ok: false, name: '' }; }
}
const gpu = probeGpu();
const isMobile = (/Android|iPhone|iPad|iPod|Mobile|Silk|HarmonyOS/i.test(navigator.userAgent) || (navigator.maxTouchPoints > 1 && /Macintosh/.test(navigator.userAgent))) && (navigator.maxTouchPoints > 0 || 'ontouchstart' in window);
const weakGpu = /Radeon( \(TM\))? HD|\bHD ?[456][0-9]{3}\b|Intel\(R\)? HD Graphics|Intel HD|\bGMA\b|Mali-[4T]|Adreno \(TM\) [3-5]|SwiftShader|llvmpipe|Basic Render/i.test(gpu.name) || /\bATI\b/.test(gpu.name);
function autoPreset() { if (isMobile) return 'HIGH'; if (weakGpu) return 'LOW'; return 'HIGH'; }
let presetName = (params.get('preset') || '').toUpperCase();
let detectedReason = 'saved';
if (!PRESETS[presetName]) {
  presetName = store.get(PRESET_KEY);
  if (!PRESETS[presetName]) { presetName = autoPreset(); detectedReason = isMobile ? 'phone/tablet' : weakGpu ? 'weak GPU' : 'desktop'; store.set(PRESET_KEY, presetName); }
} else detectedReason = 'url';
let preset = PRESETS[presetName];
if (isMobile) document.body.classList.add('touch');
let adaptive = params.get('noadapt') !== '1' && store.get('bbr2-adaptive') !== '0';

// ---------- renderer (recreated only when MSAA on/off changes)
let renderer = null;
function makeRenderer(aa) {
  if (renderer) { renderer.dispose(); renderer.forceContextLoss(); renderer.domElement.remove(); }
  renderer = new THREE.WebGLRenderer({ antialias: aa, alpha: false, stencil: false, depth: true, powerPreference: 'high-performance' });
  renderer.outputColorSpace = THREE.LinearSRGBColorSpace;
  renderer.shadowMap.enabled = false;
  renderer.sortObjects = true;
  // opaque: renderOrder then strict front-to-back (sky has renderOrder 10, drawn last)
  renderer.setOpaqueSort((a, b) => (a.renderOrder - b.renderOrder) || (a.z - b.z));
  renderer.domElement.id = 'gl';
  stage.prepend(renderer.domElement);
  renderer.aa = aa;
  resize();
}
const scene = new THREE.Scene();
scene.fog = new THREE.Fog(0xffffff, 50, 300);
const camera = new THREE.PerspectiveCamera(62, 1, 0.3, 400);
function resize() {
  if (!renderer) return;
  const w = window.innerWidth, h = window.innerHeight;
  renderer.setPixelRatio(preset.pixelRatio(window.devicePixelRatio || 1));
  renderer.setSize(w, h, false);
  renderer.domElement.style.width = w + 'px'; renderer.domElement.style.height = h + 'px';
  camera.aspect = w / Math.max(1, h);
  camera.updateProjectionMatrix();
}
window.addEventListener('resize', resize);
window.addEventListener('orientationchange', () => setTimeout(resize, 200));
if (window.visualViewport) window.visualViewport.addEventListener('resize', resize);

const sim = new Sim(Number(params.get('seed')) || SEED);
const world = new World(scene, preset);
const actors = new Actors(scene);
actors.setCharacter(opts.character); // v2.4 FEMALE / MALE (cosmetic)
const decor = new Decor(scene); // v2.2 beach / plaza / bike path life (render only)
decor.onBell = (kind, dx) => sfx.play('bell', { x: dx || 2 });
decor.lodFor = (ci) => world.lodFor(ci); // v2.5: decor follows the world's chunk tiers
const birds = new Birds(scene); // v2.5 seagull flocks (render only)
birds.onCall = (pan, dist) => sfx.gull(pan, dist); // calls on the Seagulls ambience channel
let lodScale = 1; // v2.5: the adaptive safety net shortens LOD distances before it drops a preset
function setLodScale(k) { lodScale = k; world.lodScale = k; actors.setLodScale(k); decor.setLodScale(k); }
makeRenderer(preset.antialias);

function setPreset(name, why) {
  if (!PRESETS[name]) return;
  presetName = name; preset = PRESETS[name];
  store.set(PRESET_KEY, name);
  if (renderer.aa !== preset.antialias) makeRenderer(preset.antialias);
  resize();
  world.applyPreset(preset);
  actors.applyPreset(preset);
  decor.applyPreset(preset);
  birds.applyPreset(preset);
  setLodScale(1);
  sim.setPeople(preset.people, preset.dogs);
  sim.echoEvery = preset.echoEvery;
  camera.far = preset.far; camera.updateProjectionMatrix();
  perf.grace = 4;
  updateSettingsUi();
  if (why) hud.toast(why);
}

// ---------- input + hooks
let paused = false, showDebug = params.get('debug') === '1', settingsOpen = false;
const input = new Input(stage, {
  onKey: (code) => {
    sfx.unlock();
    if (code === 'F3') { showDebug = !showDebug; document.getElementById('debug').style.display = showDebug ? 'block' : 'none'; return true; }
    if (code === 'KeyQ') { const i = (PRESET_NAMES.indexOf(presetName) + 1) % PRESET_NAMES.length; setPreset(PRESET_NAMES[i], 'Quality: ' + PRESET_NAMES[i]); return true; }
    if (code === 'KeyP' || code === 'Escape') { if (settingsOpen) toggleSettings(false); else togglePause(); return true; }
    if (code === 'KeyM') { opts.sound = !opts.sound; sfx.muted = !opts.sound; saveOpts(); updateSettingsUi(); hud.toast(sfx.muted ? 'Sound off' : 'Sound on', 1.2); return true; }
    if (code === 'KeyR' && sim.state !== 'title') { restartRun(); return true; }
    return false;
  },
  onPause: () => { if (sim.state === 'run') togglePause(); },
});
function togglePause(force) { paused = force !== undefined ? force : !paused; document.getElementById('pause').style.display = paused && !settingsOpen ? 'flex' : 'none'; }
document.addEventListener('visibilitychange', () => { if (document.hidden && sim.state === 'run') togglePause(true); });

// ---------- settings panel
const settingsEl = document.getElementById('settings');
function toggleSettings(open) {
  settingsOpen = open; settingsEl.style.display = open ? 'flex' : 'none';
  if (open) updateSettingsUi();
  document.getElementById('title').style.visibility = open ? 'hidden' : '';
  if (sim.state === 'run') togglePause(open);
}
document.getElementById('gear').addEventListener('click', (e) => { e.stopPropagation(); toggleSettings(!settingsOpen); });
document.getElementById('closeSettings').addEventListener('click', () => toggleSettings(false));
for (const btn of document.querySelectorAll('[data-preset]')) btn.addEventListener('click', () => setPreset(btn.dataset.preset, 'Quality: ' + btn.dataset.preset));
const adaptBox = document.getElementById('adaptive');
adaptBox.addEventListener('change', () => { adaptive = adaptBox.checked; store.set('bbr2-adaptive', adaptive ? '1' : '0'); });
document.getElementById('redetect').addEventListener('click', () => setPreset(autoPreset(), 'Auto-detected: ' + autoPreset()));
function updateSettingsUi() {
  for (const btn of document.querySelectorAll('[data-preset]')) btn.classList.toggle('on', btn.dataset.preset === presetName);
  adaptBox.checked = adaptive;
  document.getElementById('gpuName').textContent = (gpu.name || 'unknown GPU') + (isMobile ? ' (mobile)' : '');
  document.getElementById('qchip').textContent = presetName;
  document.getElementById('optSound').checked = opts.sound;
  document.getElementById('optMusic').checked = opts.music;
  for (const [k, id] of [['master', 'volMaster'], ['music', 'volMusic'], ['amb', 'volAmb'], ['sfx', 'volSfx']]) { document.getElementById(id).value = opts.vol[k]; document.getElementById(id + 'Txt').textContent = opts.vol[k]; }
  for (const btn of document.querySelectorAll('[data-char]')) btn.classList.toggle('on', btn.dataset.char === opts.character);
  for (const [k] of AMB_CHANNELS) { const c = opts.ambCh[k]; const row = document.getElementById('amb-' + k); if (!row) continue; row.querySelector('input[type=checkbox]').checked = c.on; row.querySelector('input[type=range]').value = c.v; row.querySelector('b').textContent = c.v; row.classList.toggle('off', !c.on); }
  document.getElementById('optHaptics').checked = opts.haptics;
  document.getElementById('optHaptics').disabled = !haptics.supported;
}
document.getElementById('optSound').addEventListener('change', (e) => { opts.sound = e.target.checked; sfx.unlock(); sfx.muted = !opts.sound; saveOpts(); });
document.getElementById('optMusic').addEventListener('change', (e) => { opts.music = e.target.checked; sfx.unlock(); sfx.setMusic(opts.music); saveOpts(); });
// v2.4 volume sliders (0..100): applied smoothly while dragging, saved in localStorage
for (const [k, id] of [['master', 'volMaster'], ['music', 'volMusic'], ['amb', 'volAmb'], ['sfx', 'volSfx']]) {
  const el = document.getElementById(id), txt = document.getElementById(id + 'Txt');
  const apply = () => { opts.vol[k] = Math.round(Number(el.value)); txt.textContent = opts.vol[k]; sfx.setVolume(k, opts.vol[k]); };
  el.addEventListener('input', apply);
  el.addEventListener('change', () => { apply(); saveOpts(); });
}
// v2.5 ambience channels: one row per sound (on/off + volume) under the Ambience slider
{
  const box = document.getElementById('ambList');
  for (const [k, label] of AMB_CHANNELS) {
    const row = document.createElement('div'); row.className = 'ambrow'; row.id = 'amb-' + k;
    row.innerHTML = '<label class="ambon"><input type="checkbox"><span></span></label><input type="range" min="0" max="100" step="1"><b>100</b>';
    row.querySelector('span').textContent = label;
    const chk = row.querySelector('input[type=checkbox]'), rng = row.querySelector('input[type=range]'), txt = row.querySelector('b');
    chk.setAttribute('aria-label', label + ' on'); rng.setAttribute('aria-label', label + ' volume');
    chk.addEventListener('change', () => { sfx.unlock(); opts.ambCh[k].on = chk.checked; row.classList.toggle('off', !chk.checked); sfx.setAmbChannel(k, chk.checked, null); saveOpts(); });
    const apply = () => { opts.ambCh[k].v = Math.round(Number(rng.value)); txt.textContent = opts.ambCh[k].v; sfx.setAmbChannel(k, null, opts.ambCh[k].v); };
    rng.addEventListener('input', apply);
    rng.addEventListener('change', () => { apply(); saveOpts(); });
    box.appendChild(row);
  }
  // v2.5.1: play each ambience sound once (marks the row that is playing)
  document.getElementById('ambTest').addEventListener('click', (e) => {
    e.stopPropagation(); sfx.unlock();
    const go = () => sfx.test((k) => { for (const [kk] of AMB_CHANNELS) { const r = document.getElementById('amb-' + kk); if (r) r.classList.toggle('testing', kk === k); } });
    if (sfx.ctx) go(); else setTimeout(go, 50);
  });
  document.getElementById('ambAllOn').addEventListener('click', () => { for (const [k] of AMB_CHANNELS) { opts.ambCh[k] = { on: true, v: 100 }; sfx.setAmbChannel(k, true, 100); } saveOpts(); updateSettingsUi(); });
}
// v2.4 runner choice (settings and title card), saved; cosmetic only
function setCharacter(c) { opts.character = c === 'male' ? 'male' : 'female'; actors.setCharacter(opts.character); saveOpts(); updateSettingsUi(); }
for (const btn of document.querySelectorAll('[data-char]')) btn.addEventListener('click', (e) => { e.stopPropagation(); setCharacter(btn.dataset.char); });
document.getElementById('optHaptics').addEventListener('change', (e) => { opts.haptics = e.target.checked; saveOpts(); if (opts.haptics) buzz(30); });
document.getElementById('pause').addEventListener('click', () => togglePause(false));

// ---------- overlays
function overlay(which) {
  document.getElementById('title').style.display = which === 'title' ? 'flex' : 'none';
  document.getElementById('over').style.display = which === 'over' ? 'flex' : 'none';
}
function loadBest() { try { return JSON.parse(store.get(BEST_KEY)) || { score: 0 }; } catch (e) { return { score: 0 }; } }
function loadStats() {
  let st = null; try { st = JSON.parse(store.get(STATS_KEY)); } catch (e) { st = null; }
  return Object.assign({ runs: 0, total: 0, longest: 0, mostNear: 0, bestCombo: 1, bestGrade: '' }, st || {});
}
function showBest() {
  const b = loadBest(), st = loadStats();
  document.getElementById('best').textContent = b.score ? 'Best: ' + b.score + '  (' + b.dist + ' m' + (b.grade ? ', grade ' + b.grade : '') + ')' + (st.runs ? '   Runs: ' + st.runs : '') : '';
}
showBest();
let overT = 0, lastResult = null;
// Grade from the final score, HEAT reached and style (near misses + hops per 100 m).
function gradeRun(sim) {
  const sc = Math.floor(sim.score), style = (sim.nearMisses + sim.leashHops) / Math.max(1, sim.distance / 100);
  const pts = sc / 1000 + (sim.maxHeat - 1) * 2 + Math.min(6, style * 2);
  if (pts >= 75) return ['S', 'Supreme flow. The boulevard opened for you.'];
  if (pts >= 45) return ['A', 'Strong run. Fluent line through heavy traffic.'];
  if (pts >= 25) return ['B', 'Solid pace. A few gaps got the better of you.'];
  if (pts >= 12) return ['C', 'Warming up. Chase near misses to build combo.'];
  return ['D', 'Rough start. Swipe early, read the rings.'];
}
function finishRun() {
  const b = loadBest(), st = loadStats();
  const sc = Math.floor(sim.score), dist = Math.floor(sim.distance);
  const [grade, label] = gradeRun(sim);
  const newBest = sc > (b.score || 0);
  if (newBest) store.set(BEST_KEY, JSON.stringify({ score: sc, dist, grade }));
  st.runs++; st.total += dist; st.longest = Math.max(st.longest, dist); st.mostNear = Math.max(st.mostNear, sim.nearMisses);
  st.bestCombo = Math.max(st.bestCombo, sim.bestCombo);
  if (!st.bestGrade || 'SABCD'.indexOf(grade) < 'SABCD'.indexOf(st.bestGrade)) st.bestGrade = grade;
  st.last = { score: sc, dist, grade, near: sim.nearMisses, t: Math.round(sim.t) };
  store.set(STATS_KEY, JSON.stringify(st));
  const secs = Math.floor(sim.t);
  lastResult = {
    score: sc, dist, time: Math.floor(secs / 60) + ':' + String(secs % 60).padStart(2, '0'), near: sim.nearMisses, leash: sim.leashHops,
    hurdles: sim.hurdles, orbs: sim.orbs, trails: sim.trails, drinks: sim.drinks, bestCombo: sim.bestCombo, heat: sim.maxHeat, hits: sim.hits,
    best: Math.max(sc, b.score || 0), grade, label, newBest, runs: st.runs, total: st.total, longest: st.longest, mostNear: st.mostNear,
  };
  hud.results(lastResult);
  if (newBest && st.runs > 1) sfx.play('best');
  showBest();
}
function restartRun() { sim.reset(); sim.start(); overlay('none'); kick = 0; }
document.getElementById('again').addEventListener('click', (e) => { e.stopPropagation(); sfx.unlock(); if (sim.state === 'over') restartRun(); });

// ---------- perf monitor + adaptive safety net
const perf = { frames: 0, acc: 0, fps: 60, ms: 16, low: 0, grace: 4, steps: 0 };
function perfTick(dt) {
  perf.frames++; perf.acc += dt; perf.ms = lerp(perf.ms, dt * 1000, 0.1);
  if (perf.acc >= 1) {
    perf.fps = perf.frames / perf.acc; perf.frames = 0; perf.acc = 0;
    if (perf.grace > 0) perf.grace--;
    else if (adaptive && !paused && !document.hidden) {
      perf.low = perf.fps < 45 ? perf.low + 1 : 0;
      if (perf.low >= 3) {
        perf.low = 0;
        const i = PRESET_NAMES.indexOf(presetName);
        // v2.5: first shrink the LOD distances (1 -> 0.75 -> 0.55), then drop one preset
        if (lodScale > 0.56 && (preset.lod.near > 0 || preset.lod.chunkNear > 0)) { setLodScale(lodScale > 0.9 ? 0.75 : 0.55); perf.grace = 2; hud.toast('Low FPS (' + Math.round(perf.fps) + ') - detail range shortened', 2); }
        else if (i > 0) setPreset(PRESET_NAMES[i - 1], 'Low FPS (' + Math.round(perf.fps) + ') - quality lowered to ' + PRESET_NAMES[i - 1]);
      }
    }
  }
}

// ---------- weather -> uniforms (every frame, values already blended by the sim world state)
const skyU = world.sky.material.uniforms;
function applyWeather() {
  const p = sim.ws.p;
  U.uAmb.value.setRGB(...p.amb); U.uSun.value.setRGB(...p.sun); U.uWet.value = p.wet;
  U.uSkyRefl.value.setRGB(...p.skyRefl); U.uSunRefl.value.setRGB(...p.sunRefl); U.uWindow.value.setRGB(...p.window);
  U.uEchoColor.value.setRGB(...p.echo);
  scene.fog.color.setRGB(...p.fog);
  const far = Math.min(p.fogFar * preset.fogScale, camera.far - 5);
  scene.fog.near = p.fogNear * preset.fogScale; scene.fog.far = far;
  skyU.uTop.value.setRGB(...p.top); skyU.uHor.value.setRGB(...p.fog.map((v, i) => (v + p.hor[i]) / 2));
  skyU.uSunCol.value.setRGB(...p.sunCol); skyU.uSunSize.value = p.sunSize; skyU.uCloud.value = p.cloud; skyU.uCity.value.setRGB(...p.city);
  skyU.uJaffa.value.set(0.8 + 0.6 * Math.min(1, sim.distance / 5000), clamp((p.fogFar - 90) / 260, 0.3, 0.88));
  const su = world.sea.material.uniforms;
  su.uDeep.value.setRGB(...p.deep); su.uShallow.value.setRGB(...p.shallow); su.uGlitter.value = p.glitter; su.uChop.value = p.chop; su.uSunCol.value.setRGB(...p.sunCol);
  world.glare.material.opacity = Math.min(1, p.sunSize);
  // v2.2 wind: steady breeze, gust strength, flutter, overall amount (SEA SPRAY strong ... CLEAR HAZE light)
  const w = p.wind;
  U.uWind.value.set(0.12 + 0.3 * w, 0.25 + 1.25 * w, 0.25 + 0.75 * w, w);
  return far;
}

// ---------- camera
const camPos = new THREE.Vector3(0, 3, 7), look = new THREE.Vector3();
let kick = 0, roll = 0; // v2.1: FOV punch on near miss / dash, slight camera roll into lane changes
function updateCamera(alpha, dt) {
  const r = sim.r;
  const rx = lerp(r.px, r.x, alpha), ry = lerp(r.py, r.y, alpha), rz = lerp(r.pz, r.z, alpha);
  const title = sim.state === 'title';
  // portrait phones: pull back, raise and widen so all five lanes stay in view
  const portrait = clamp((1.2 - camera.aspect) / 0.7, 0, 1);
  const back = 6.8 + portrait * 2.8, up = 3.0 + portrait * 1.2;
  const tx = title ? 2.6 : rx * 0.55, ty = title ? 1.9 : up + ry * 0.35, tz = rz + (title ? -3.2 - portrait * 1.5 : back);
  const k = 1 - Math.exp(-dt * 7);
  camPos.x += (tx - camPos.x) * k; camPos.y += (ty - camPos.y) * k; camPos.z = title ? tz : lerp(camPos.z, tz, 1 - Math.exp(-dt * 12));
  camera.position.copy(camPos);
  if (sim.shake > 0) { const s = sim.shake * sim.shake * 0.18; camera.position.x += Math.sin(sim.t * 61) * s; camera.position.y += Math.sin(sim.t * 47) * s; }
  if (title) look.set(rx - 0.5, 1.2, rz + 2.0); else look.set(rx * 0.75, 1.3 + ry * 0.3, rz - 9);
  camera.lookAt(look);
  roll = lerp(roll, title ? 0 : clamp(-r.lean * 0.05, -0.05, 0.05), 1 - Math.exp(-dt * 6));
  if (roll) camera.rotateZ(roll);
  kick = Math.max(0, kick - dt * 9);
  const minH = 55 * Math.PI / 180;
  const portraitFov = Math.min(88, 2 * Math.atan(Math.tan(minH / 2) / camera.aspect) * 180 / Math.PI);
  const fov = Math.max(60, portraitFov) + clamp((r.speed - 9) * 0.9, 0, 8) + (r.dashT > 0 ? 5 : 0);
  const target = fov + kick;
  if (Math.abs(camera.fov - target) > 0.05) { camera.fov = lerp(camera.fov, target, kick > 0 ? 1 - Math.exp(-dt * 30) : k); camera.updateProjectionMatrix(); }
}

// ---------- v2.5 ambience drivers (render side, Math.random only: never the sim RNG)
function ambienceTick(dt) {
  if (!sfx.ctx) return;
  const r = sim.r; let near = 0;
  for (const a of sim.ai.people) if (a.active && Math.abs(a.z - r.z) < 30) near++;
  const k = decor.kits, seated = (k.sit ? k.sit.set.stats[0] + k.sit.set.stats[1] : 0) + (k.cafe ? (k.cafe.set.stats[0] + k.cafe.set.stats[1]) * 2 : 0);
  sfx.crowdLevel = Math.min(1, near / 10) * 0.75 + Math.min(1, seated / 30) * 0.25 + (sim.state === 'title' ? 0.3 : 0);
  sfx.cafeLevel = Math.min(1, seated / 24);
  if (sim.state === 'run') for (const d of sim.ai.dogs) {
    if (!d.active) continue;
    const dz = Math.abs(d.z - r.z);
    if (dz < 25 && Math.random() < dt * 0.12) { sfx.bark(Math.max(-0.8, Math.min(0.8, (d.x - r.x) * 0.25)), Math.hypot(d.x - r.x, dz)); break; }
  }
}

// ---------- main loop: fixed-step accumulator + interpolated rendering
let acc = 0, last = performance.now();
const evCount = {};
setPreset(presetName, null);
overlay('title');
function frame(now) {
  let dt = (now - last) / 1000; last = now;
  if (dt > 0.25) dt = 0.25;
  const padId = input.pollGamepad();
  let steps = 0;
  if (!paused) {
    acc += dt;
    while (acc >= DT && steps < MAX_STEPS) {
      const inp = input.consume();
      if (inp.start || inp.jump || inp.dash || inp.left || inp.right) sfx.unlock();
      if (sim.state === 'title' && (inp.start)) { sim.start(); overlay('none'); inp.jump = false; inp.dash = false; }
      else if (sim.state === 'over' && inp.start && overT > 1.2) { restartRun(); inp.jump = false; inp.dash = false; }
      sim.step(inp);
      acc -= DT; steps++;
    }
    if (steps === MAX_STEPS) acc = 0; // spiral-of-death guard
  } else { const inp = input.consume(); if (inp.start && !settingsOpen) togglePause(false); }
  perf.steps = steps;
  const alpha = paused ? 1 : acc / DT;
  // events -> HUD + sound
  for (const e of sim.events) {
    if (e.type === 'over') { overT = 0; overlay('over'); finishRun(); }
    if (e.type !== 'jump' && e.type !== 'slide') hud.pop(e.text, e.type);
    sfx.play(e.type, e, sim);
    if (HAPTIC[e.type]) buzz(HAPTIC[e.type]);
    evCount[e.type] = (evCount[e.type] || 0) + 1;
    if (e.type === 'near') { kick = Math.max(kick, 3.2); hud.flash('near'); }
    else if (e.type === 'contact') hud.flash('contact');
    else if (e.type === 'trail' || e.type === 'leash' || e.type === 'drink') { kick = Math.max(kick, 2); hud.flash('pick'); }
    else if (e.type === 'heat') { hud.flash('heat'); hud.toast(e.text, 2.5); }
    else if (e.type === 'dash') kick = Math.max(kick, 2.5);
  }
  sim.events.length = 0;
  sfx.update(sim, dt, sim.state === 'run' && !paused, paused);
  if (sim.state === 'over') overT += dt;
  U.uTime.value = sim.t + now * 0.0;
  if (sim.state !== 'run') U.uTime.value = now / 1000;
  const fogFar = applyWeather();
  updateCamera(alpha, dt);
  world.update(camera.position.z, fogFar, camera);
  world.frame(camera);
  decor.update(camera.position.z, paused ? 0 : dt, U.uTime.value, sim.r, camera.position.x);
  decor.frame(camera, sim.ws.p.wind);
  actors.dt = dt;
  actors.update(sim, alpha, camera, renderer.getPixelRatio());
  birds.update(paused ? 0 : dt, camera, sim.state === 'run');
  if (!paused) ambienceTick(dt);
  renderer.render(scene, camera);
  perfTick(dt);
  hud.update(sim, dt);
  if (showDebug) drawDebug(padId);
  requestAnimationFrame(frame);
}
const dbg = document.getElementById('debug');
dbg.style.display = showDebug ? 'block' : 'none';
let dbgAcc = 0;
function drawDebug(padId) {
  dbgAcc++;
  if (dbgAcc % 10) return;
  const i = renderer.info;
  const active = sim.ai.people.filter((a) => a.active).length, dogs = sim.ai.dogs.filter((a) => a.active).length;
  dbg.textContent =
    `FPS ${perf.fps.toFixed(0)}  (${perf.ms.toFixed(1)} ms)  steps/frame ${perf.steps}\n` +
    `draw calls ${i.render.calls}   triangles ${i.render.triangles}\n` +
    `geometries ${i.memory.geometries}  textures ${i.memory.textures}  programs ${i.programs ? i.programs.length : '-'}\n` +
    `preset ${presetName}  px ratio ${renderer.getPixelRatio().toFixed(2)}  MSAA ${renderer.aa ? 'on' : 'off'}  adaptive ${adaptive ? 'on' : 'off'}\n` +
    `chunks visible ${world.visibleChunks}/${world.slots.length} (near ${world.nearChunks})  crowd ${active}  dogs ${dogs}\n` +
    `LOD x${lodScale.toFixed(2)}  crowd n/m/f ${actors.crowdSet.stats.join('/')}  dogs ${actors.dogSet.stats.join('/')}  birds ${birds.onScreen || 0}/${birds.visible || 0}\n` +
    `weather ${sim.ws.name} (${sim.ws.timeLeft.toFixed(0)} s)  line ${sim.line > 0 ? '+1' : sim.line}  q ${sim.quality.toFixed(2)}\n` +
    `tick ${sim.tick}  seed ${sim.seed}  gpu ${gpu.name.slice(0, 48)}${padId ? '\npad ' + padId.slice(0, 40) : ''}`;
}
window.__bbr = {
  sim, setPreset, get preset() { return presetName; }, renderer: () => renderer, perf, gpu, isMobile, weakGpu, detectedReason,
  sfx, opts, haptics, evCount, stats: loadStats, best: loadBest, get lastResult() { return lastResult; }, camera, version: VERSION, setCharacter, actors, decor, U, world, birds,
  get lodScale() { return lodScale; }, setLodScale,
  // debug / screenshots: force every LOD set and chunk to one tier ('near' | 'mid' | 'far'), null = normal
  forceLod(mode) {
    world.forceLod = mode === 'near' ? -1 : mode === 'mid' ? 0 : mode === 'far' ? 2 : null; world.nearKey = '#';
    if (!mode) { setLodScale(lodScale); return; }
    const cfg = mode === 'near' ? { near: 1e9, nearMax: 999, far: 1e9 } : mode === 'mid' ? { near: 0, far: 1e9 } : { near: 0, far: 0 };
    for (const set of [actors.crowdSet, actors.dogSet, ...Object.values(decor.kits).map((k) => k.set)]) set.configure(cfg);
  },
  info: () => ({ calls: renderer.info.render.calls, triangles: renderer.info.render.triangles, fps: perf.fps, preset: presetName }),
};
window.__bbrBooted = true;
requestAnimationFrame(frame);
if (detectedReason !== 'saved' && detectedReason !== 'url') hud.toast('Quality ' + presetName + ' (' + detectedReason + ')' + (isMobile ? ' - tap SET to change' : ' - SET or Q to change'), 4);
