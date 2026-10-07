// Beach Boulevard Runner v2.5.28 - bootstrap, fixed-step loop with interpolation, camera, quality presets,
// procedural audio, haptics, results screen and run stats.
// v2.5.26: layered right-side skyline (3 depth rows, lit windows, people, roof life); kite flyers on the sand;
// v2.5.26: aircraft (small plane every 13 s along the shore, helicopter 2.4 s behind it, airliner from the sea every
//   15 s; varied routes + liveries per pass, own seeded RNG on the sim clock); dog ground fix (pooled dogs kept a sand height).
// v2.5.25: close-up muscle shading on HIGH / ULTRA (SET on/off, Softer/Normal/Stronger, bare-skin-only; MUSC / B quick mute).
// v2.5.5: the sea gently draws walkers down to bathe (Gaussian sea sink), bike lane mix of cyclists, scooters,
// rollerbladers, skateboarders and surfers, bathers / swimmers / wave surfers in the sea.
// v2.5.11: sea-wall crossings (decorated pathways boulevard -> beach); free will routes bathers through gaps;
// offshore sailboats / dinghies (instanced, gentle bob).
// v2.5.24: SET > Auto-tune graphics (Bayesian: GP + Expected Improvement over resolution / detail range / crowd / traffic,
//   16 trials of real rAF timing, best kept per preset), Lorenz chaos drift (sim.chaos), honest-meter audit.
// v2.5.23: 1st person no longer clips through people: baked shaders dither out anything within 0.8 m of the 1P lens
//   (people, dogs, bags, props; leashes near the lens skipped), and the eye eases up to 17 cm aside so passers-by brush
//   past at shoulder distance (visual only; sim, collisions and near misses unchanged). Restaurant / cafe clearance checked.
// v2.5.22: SET > Show FPS overlay (rAF timing: current / average / 1% low / min / ms, preset, weather, draws; DOM text
//          at 4 Hz, paused time not counted) and an on-screen pause button with Resume / SET / Restart.
// v2.5.21: picking up after the dog (leashed dogs squat every 60-120 s; the owner bags it, crouches, picks it up and
//          bins it at the dog-waste bins by each sea-wall crossing, or carries it; GOOD CITIZEN +10 when passing a chore).
// v2.5.20: dog walkers on the sand (free will: down a sea-wall crossing, dry sand or shoreline, dog plays at the
//   waterline on its leash, back up another crossing; clear of courts, matkot and restaurants).
// v2.5.19: car sounds (positional honks, engine hum, pass whoosh; Horns + Traffic in SET), street lamps glow
//   with the weather light level (emissive heads, warm halos, ground pools); road street lamps on both curbs.
// v2.5.18: eateries off the road (plaza glass cafes inside the plaza, see-through city cafes with paved paths),
// paved decorated entrances over the sea wall at beach restaurants, free-will eatery visits, night lights.
// v2.5.17: two-way right-hand traffic in both lanes (fixed all-cars-one-lane bug), spacing, red-light stops.
// v2.5.16: clear road (fill +15x); restos ~10 m back from curb.
// v2.5.15: restos flush on right curb; cars sized to people.
// v2.5.14: roadside glass restos ~100 m (no tall glass bldgs); smaller two-way cars.
// v2.5.13: denser right-side city (shops closer, filled strip, crowds, clearer traffic).
// v2.5.12: city road (cars, lights, crossings, signs), shops beyond, thinner boulevard cafes.
// v2.5.11: open sea-side cafe wall + terrace↔sand path; diners may stroll it.
// v2.5.11: beach restaurants, volleyball / football / racquet on sand, CLOUDY weather, denser gulls.
// v2.5.6: free will within the rules: personas, pauses, chats, pace changes, choosing to go bathing,
// bike-lane riders choosing pace / lane position / a look at the beach, beach goers choosing what next.
import THREE from './setup.js';
import { DT, MAX_STEPS, SEED, PRESETS, PRESET_NAMES, PRESET_KEY, BEST_KEY, STATS_KEY, OPT_KEY, VERSION, clamp, lerp, gauss } from './config.js';
import { U, setNearFade, setMuscle, muscleState } from './materials.js';
import { World } from './world.js';
import { Actors } from './actors.js';
import { Sim } from './sim.js';
import { Input } from './input.js';
import { Hud } from './hud.js';
import { Sfx, AMB_CHANNELS, SONG_FILES } from './audio.js';
import { Birds } from './birds.js';
import { Aircraft } from './aircraft.js'; // v2.5.26
import { setGatherLevel } from './aicore.js'; // v2.5.26 crowd gatherings
import { Kites } from './kites.js';
import { Balloons } from './balloons.js'; // v2.5.27
import { IceCream } from './icecream.js'; // v2.5.27
import { setIceOn, setVendorsOn } from './aicore.js';
import { Vendors } from './vendors.js'; // v2.5.27
import { Gym } from './gym.js'; // v2.5.27
import { Bikes } from './bikes.js'; // v2.5.29
import { Performers } from './performers.js'; // v2.5.26 street performers // v2.5.26 kite flyers on the sand
import { Skyline } from './skyline.js'; // v2.5.26 layered right-side skyline
import { Decor } from './decor.js';
import { cafeSink } from './aicore.js'; // v2.5.4 cafe proximity for the cafe clinks
import { FpsMeter } from './fpsmeter.js'; // v2.5.22 SET > Show FPS
import { AutoTuner, TUNE } from './autotune.js'; // v2.5.24 Bayesian graphics auto-tune (GP + EI)

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
const opts = Object.assign({ sound: true, music: true, haptics: true, character: 'female', showFps: false, cam: '3p', headBob: true, tune: null, muscle: true, muscleStr: 'normal', muscleBare: false }, (() => { try { return JSON.parse(store.get(OPT_KEY)) || {}; } catch (e) { return {}; } })());
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
// v2.5.24 auto-tune preference (a graphics setting, not run state): on/off, target FPS (0 = auto), result per preset
opts.tune = Object.assign({ on: false, target: 0, byPreset: {} }, opts.tune || {});
if (![0, 30, 45, 60].includes(opts.tune.target)) opts.tune.target = 0;
if (!opts.tune.byPreset || typeof opts.tune.byPreset !== 'object') opts.tune.byPreset = {};
// v2.5.25 muscle shading prefs (graphics look; HIGH / ULTRA only pay the cost)
if (opts.muscle !== false) opts.muscle = true;
opts.gym = opts.gym !== false; // v2.5.27 SET > Gym
opts.bikes = opts.bikes !== false; // v2.5.29 SET > Bikes & scooters
opts.vendors = opts.vendors !== false; setVendorsOn(opts.vendors); // v2.5.27 SET > Vendors
opts.icecream = opts.icecream !== false; setIceOn(opts.icecream); // v2.5.27 SET > Ice cream truck
opts.balloons = opts.balloons !== false; // v2.5.27 SET > Balloon people (default on)
opts.aircraft = opts.aircraft !== false; // v2.5.26 SET > Aircraft (default on)
if (![0, 1, 2].includes(opts.gather)) opts.gather = 1; // v2.5.26 SET > Crowd gatherings (Off / Some / Lots)
setGatherLevel(opts.gather);
if (!['soft', 'normal', 'strong'].includes(opts.muscleStr)) opts.muscleStr = 'normal';
opts.muscleBare = !!opts.muscleBare;
saveOpts(); // v2.5.1: write the migrated settings back (older saves had no ambience keys)
// v2.5.3: music playlist (Boulevard theme, Track 2, Track 3), plays in order and wraps
sfx.loadSongs(SONG_FILES.map((f) => 'assets/audio/' + f));
sfx.loadSfx('assets/sound/'); // v2.5.2 Grok sound pack (phone file: embedded)
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
  renderer.setPixelRatio(prCur || preset.pixelRatio(window.devicePixelRatio || 1)); // v2.5.24: auto-tune may lower it
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
decor.onHonk = (pattern, dx, dz, seed) => sfx.honk(pattern, dx, dz, seed); // v2.5.19 car horns (positional)
decor.onWhoosh = (dx, relV) => sfx.whoosh(dx, relV); // v2.5.19 pass-by whoosh
decor.onBell = (kind, dx) => sfx.play(kind === 'blade' || kind === 'skate' ? 'wheels' : 'bell', { x: dx || 2 }); // v2.5.5 wheels roll past for blades / skates
decor.lodFor = (ci) => world.lodFor(ci); // v2.5: decor follows the world's chunk tiers
const birds = new Birds(scene); // v2.5 seagull flocks (render only)
birds.onCall = (pan, dist) => sfx.gull(pan, dist); // calls on the Seagulls ambience channel
const performers = new Performers(scene); // v2.5.26
performers.onTip = (q) => { const dx = q.x - camera.position.x, dz = q.z - camera.position.z; sfx.surprise(clamp(dx / 20, -0.8, 0.8), Math.hypot(dx, dz)); };
const vendors = new Vendors(scene); // v2.5.27
const gym = new Gym(scene); gym.enabled = opts.gym;
const bikes = new Bikes(scene); bikes.enabled = opts.bikes; // v2.5.29
const _ps = (x, z) => { const dx = x - camera.position.x, dz = z - camera.position.z; return [clamp(dx / 12, -0.8, 0.8), Math.hypot(dx, dz)]; };
vendors.onCall = (x, z, beach) => { const [p, d] = _ps(x, z); sfx.vendorCall(p, d, beach); };
vendors.onLid = (x, z) => { const [p, d] = _ps(x, z); sfx.coolerLid(p, d); };
bikes.onBell = (k, x, z) => { const [p, d] = _ps(x, z); sfx.bikeSound(k, p, d); }; bikes.onDock = (x, z, k) => { const [p, d] = _ps(x, z); sfx.bikeSound(k, p, d); };
gym.onClank = (x, z) => { const [p, d] = _ps(x, z); sfx.gymClank(p, d); }; gym.onGrunt = (x, z) => { const [p, d] = _ps(x, z); sfx.gymGrunt(p, d); };
decor.onBuy = (x, z, kind) => { const [p, d] = _ps(x, z); sfx.chaChing(p, d, 'cafe'); }; // v2.5.27
const icecream = new IceCream(scene); icecream.enabled = opts.icecream; // v2.5.27
Object.defineProperty(icecream, "cars", { get: () => decor.cars }); decor.truckRef = icecream; // v2.5.28 truck <-> traffic
const balloons = new Balloons(scene); balloons.enabled = opts.balloons; // v2.5.27
balloons.onPop = (x, y, z, kid) => { const dx = x - camera.position.x, dz = z - camera.position.z, pan = clamp(dx / 10, -0.8, 0.8), d = Math.hypot(dx, dz); sfx.balloonPop(pan, d); if (kid) setTimeout(() => sfx.balloonKid(pan, d, kid), 250); };
balloons.onSqueak = (x, z) => { const dx = x - camera.position.x, dz = z - camera.position.z; sfx.balloonSqueak(clamp(dx / 10, -0.8, 0.8), Math.hypot(dx, dz)); };
const kites = new Kites(scene); // v2.5.26 (render only, own RNG)
const skyline = new Skyline(scene); // v2.5.26 (replaces world.towers)
const aircraft = new Aircraft(scene); // v2.5.26 small plane + helicopter along the shore, airliner across (render only)
aircraft.enabled = opts.aircraft !== false;
let lodScale = 1; // v2.5: the adaptive safety net shortens LOD distances before it drops a preset
// v2.5.24 auto-tune overrides (null = the preset as designed). u = normalised [res, lod, crowd, traffic] in 0..1,
// 1 = the preset's own value. Resolution and fog distance ease over ~0.4 s; LOD tiers cross-fade, the crowd and
// the traffic thin or fill as people and cars come and go, so a change never pops.
let tuneU = null, prCur = 0, prWant = 0, fogMul = 1, fogWant = 1;
const tuner = new AutoTuner();
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
  applyMuscle(); // v2.5.25: MUSCLE variant only on HIGH / ULTRA when opted in
  birds.applyPreset(preset);
  aircraft.applyPreset(preset); // v2.5.26
  kites.applyPreset(preset); performers.applyPreset(preset); balloons.applyPreset(preset); icecream.applyPreset(preset); vendors.applyPreset(preset); gym.applyPreset(preset); bikes.applyPreset(preset);
  skyline.applyPreset(preset); world.towers.visible = !!params.get('oldtowers'); // v2.5.26 layered skyline replaces the plain towers
  setLodScale(1);
  sim.setPeople(preset.people, preset.dogs);
  decor.carCap = 1;
  // v2.5.24: a preset change ends a tuning pass; the saved auto-tune result for this preset (if any) comes back
  if (tuner.active) tuner.stop();
  tuneU = null; prCur = prWant = 0; fogMul = fogWant = 1;
  const saved = opts.tune && opts.tune.on ? opts.tune.byPreset[name] : null;
  if (saved && saved.u) applyTune(saved.u, true);
  sim.echoEvery = preset.echoEvery;
  camera.far = preset.far; camera.updateProjectionMatrix();
  perf.grace = 4;
  updateSettingsUi();
  if (why) hud.toast(why);
}

// ---------- v2.5.25 close-up muscle shading (HIGH / ULTRA only; LOW / MEDIUM never compile the variant).
// SET prefs persist; MUSC button / B key are a quick mute of the same saved on/off.
const MUSCLE_STR = { soft: 0.5, normal: 1.0, strong: 1.7 }; // Softer / Normal / Stronger paint + flex
function muscleAllowed() { return presetName === 'HIGH' || presetName === 'ULTRA'; }
function applyMuscleStrength() {
  const s = MUSCLE_STR[opts.muscleStr] || 1;
  U.uMus.value.z = s; U.uMus.value.w = s; // painted contrast and stride flex scale together
  U.uMusBare.value = opts.muscleBare ? 1 : 0;
}
function applyMuscle() {
  applyMuscleStrength();
  setMuscle(!!opts.muscle && muscleAllowed());
  const b = document.getElementById('musBtn');
  if (b) {
    const on = !!opts.muscle && muscleAllowed();
    b.querySelector('b').textContent = !muscleAllowed() ? 'n/a' : opts.muscle ? 'ON' : 'OFF';
    b.classList.toggle('on', on);
  }
}
function toggleMuscle(toast, force) {
  opts.muscle = force !== undefined ? !!force : !opts.muscle; saveOpts(); applyMuscle(); updateSettingsUi();
  if (toast) hud.toast(!muscleAllowed() ? 'Muscle shading: HIGH / ULTRA only' : 'Muscle shading ' + (opts.muscle ? 'ON' : 'OFF'), 1.4);
}

// ---------- v2.5.24 auto-tune: normalised config -> real settings
function prMaxNow() { return preset.pixelRatio(window.devicePixelRatio || 1); }
function tuneCfg(u) {
  const hi = prMaxNow(), lo = Math.max(0.45, hi * 0.5);
  return { pr: lo + (hi - lo) * u[0], prMax: hi, lod: 0.45 + 0.55 * u[1], fog: 0.8 + 0.2 * u[1], crowd: 0.5 + 0.5 * u[2], cars: 0.4 + 0.6 * u[3] };
}
function applyTune(u, instant) {
  tuneU = u.slice(); const c = tuneCfg(u);
  prWant = c.pr; fogWant = c.fog; if (instant || !prCur) { prCur = prWant; fogMul = fogWant; resize(); }
  setLodScale(c.lod);
  sim.setPeople(Math.max(6, Math.round(preset.people * c.crowd)), Math.max(2, Math.round(preset.dogs * c.crowd)));
  decor.carCap = c.cars;
}
function clearTune() {
  tuneU = null; prWant = prCur = 0; fogMul = fogWant = 1; resize();
  setLodScale(1); sim.setPeople(preset.people, preset.dogs); decor.carCap = 1;
}
function tuneEase(dt) { // resolution steps at most every 0.1 s (each step resizes the canvas), fog eases smoothly
  fogMul += (fogWant - fogMul) * Math.min(1, dt * 5);
  if (!prWant || Math.abs(prCur - prWant) < 0.005) return;
  tuneEase.acc = (tuneEase.acc || 0) + dt; if (tuneEase.acc < 0.1) return; tuneEase.acc = 0;
  const step = Math.max(0.12, Math.abs(prWant - prCur) * 0.5);
  prCur = Math.abs(prWant - prCur) <= step ? prWant : prCur + Math.sign(prWant - prCur) * step; resize();
}
function startTune() {
  delete opts.tune.byPreset[presetName]; saveOpts();
  tuner.start(tuneU ? tuneU.slice() : [1, 1, 1, 1], opts.tune.target || 0);
  applyTune(tuner.u, false); perf.low = 0;
  updateSettingsUi();
}
function tuneFrame(now) {
  if (!opts.tune.on) return;
  const ok = sim.state === 'run' && !paused && !settingsOpen && !document.hidden;
  if (!tuner.active && ok && !opts.tune.byPreset[presetName]) { startTune(); hud.toast('Auto-tune: trying ' + TUNE.trials + ' settings while you run', 2.5); return; }
  const r = tuner.frame(now, ok);
  if (r === 'next') applyTune(tuner.u, false);
  else if (r === 'done') {
    const b = tuner.best, c = tuneCfg(b.u);
    opts.tune.byPreset[presetName] = { u: b.u, avg: +b.avg.toFixed(1), low: +b.low.toFixed(1), frames: b.frames, target: tuner.target, targetAuto: !opts.tune.target,
      confirmed: !!b.confirm, held: b.slack >= 0, trials: tuner.trials.length, pr: +c.pr.toFixed(2), prMax: +c.prMax.toFixed(2), at: Date.now() };
    const ck = tuner.trials[tuner.trials.length - 1]; // the re-measurement of the winner, shown too when it was not kept
    if (!b.confirm && ck && ck.confirm) opts.tune.byPreset[presetName].check = { avg: +ck.avg.toFixed(1), low: +ck.low.toFixed(1), same: ck.u.join() === b.u.join() };
    saveOpts(); applyTune(b.u, false); perf.low = 0; perf.grace = 4;
    hud.toast('Auto-tune done: ' + b.avg.toFixed(0) + ' FPS avg, 1% low ' + b.low.toFixed(0) + ' (target ' + tuner.target + ')', 3);
    updateSettingsUi();
  }
  if (r && settingsOpen) updateSettingsUi();
}

// ---------- input + hooks
let paused = false, showDebug = params.get('debug') === '1', settingsOpen = false;
const input = new Input(stage, {
  onKey: (code) => {
    sfx.unlock();
    if (code === 'F3') { showDebug = !showDebug; document.getElementById('debug').style.display = showDebug ? 'block' : 'none'; return true; }
    if (code === 'KeyQ') { const i = (PRESET_NAMES.indexOf(presetName) + 1) % PRESET_NAMES.length; setPreset(PRESET_NAMES[i], 'Quality: ' + PRESET_NAMES[i]); return true; }
    if (code === 'KeyP' || code === 'Escape') { if (settingsOpen) toggleSettings(false); else if (sim.state === 'run' || paused) togglePause(); return true; }
    if (code === 'KeyM') { opts.sound = !opts.sound; sfx.muted = !opts.sound; saveOpts(); updateSettingsUi(); hud.toast(sfx.muted ? 'Sound off' : 'Sound on', 1.2); return true; }
    if (code === 'KeyR' && sim.state !== 'title') { restartRun(); return true; }
    if (code === 'KeyV') { setCam(opts.cam === '1p' ? '3p' : '1p', true); return true; } // v2.5.22 camera
    if (code === 'KeyB') { toggleMuscle(true); return true; } // v2.5.25 muscle quick mute
    return false;
  },
  onPause: () => { if (sim.state === 'run') togglePause(); },
});
function togglePause(force) {
  paused = force !== undefined ? force : !paused;
  document.getElementById('pause').style.display = 'none'; // v2.5.27: pause just freezes the picture / sim (no card, sound keeps playing); the same button resumes
  document.body.classList.toggle('paused', paused); // v2.5.22: pause button shows a play icon
  pauseBtn.setAttribute('aria-label', paused ? 'Resume' : 'Pause'); pauseBtn.title = paused ? 'Resume (P / Esc)' : 'Pause (P / Esc)';
}
// pause automatically when the tab / app goes to the background (phones: app switch, screen off)
document.addEventListener('visibilitychange', () => { if (document.hidden && sim.state === 'run') togglePause(true); });
window.addEventListener('pagehide', () => { if (sim.state === 'run') togglePause(true); });
// v2.5.22: on-screen pause button (shown while running) + pause card shortcuts (Resume / SET / Restart)
const pauseBtn = document.getElementById('pauseBtn');
document.querySelector('.pausecard').addEventListener('click', (e) => e.stopPropagation()); // only outside the card resumes
const uiTap = (id, fn) => document.getElementById(id).addEventListener('click', (e) => { e.stopPropagation(); e.currentTarget.blur(); sfx.unlock(); fn(); });
uiTap('pauseBtn', () => { if (sim.state === 'run') togglePause(); });
uiTap('musBtn', () => toggleMuscle(true)); // v2.5.25
uiTap('pResume', () => togglePause(false));
uiTap('pSet', () => toggleSettings(true));
uiTap('pRestart', () => { togglePause(false); restartRun(); });

// ---------- settings panel
const settingsEl = document.getElementById('settings');
let pausedBeforeSet = false;
function toggleSettings(open) {
  if (open && !settingsOpen) pausedBeforeSet = paused; // v2.5.22: SET opened from the pause card returns to it
  settingsOpen = open; settingsEl.style.display = open ? 'flex' : 'none';
  if (open) updateSettingsUi();
  document.getElementById('title').style.visibility = open ? 'hidden' : '';
  if (sim.state === 'run') togglePause(open || pausedBeforeSet);
}
document.getElementById('gear').addEventListener('click', (e) => { e.stopPropagation(); toggleSettings(!settingsOpen); });
document.getElementById('closeSettings').addEventListener('click', () => toggleSettings(false));
for (const btn of document.querySelectorAll('[data-preset]')) btn.addEventListener('click', () => setPreset(btn.dataset.preset, 'Quality: ' + btn.dataset.preset));
const adaptBox = document.getElementById('adaptive');
adaptBox.addEventListener('change', () => { adaptive = adaptBox.checked; store.set('bbr2-adaptive', adaptive ? '1' : '0'); });
// v2.5.24 SET > Auto-tune graphics (toggle, target FPS, Re-tune)
const tuneBox = document.getElementById('optTune');
tuneBox.addEventListener('change', () => {
  opts.tune.on = tuneBox.checked; saveOpts();
  if (!opts.tune.on) { tuner.stop(); clearTune(); }
  else { const sv = opts.tune.byPreset[presetName]; if (sv && sv.u) applyTune(sv.u, false); } // else it starts with the next run
  updateSettingsUi();
});
for (const btn of document.querySelectorAll('[data-tgt]')) btn.addEventListener('click', (e) => {
  e.stopPropagation(); const t = Number(btn.dataset.tgt) || 0; if (t === opts.tune.target) return;
  opts.tune.target = t; opts.tune.byPreset = {}; saveOpts(); // results were scored for the old target
  if (tuner.active) tuner.stop();
  updateSettingsUi();
});
uiTap('tuneRetune', () => { if (!opts.tune.on) { opts.tune.on = true; } tuner.stop(); delete opts.tune.byPreset[presetName]; saveOpts(); updateSettingsUi(); hud.toast('Auto-tune starts when you run', 1.6); });
// v2.5.22: Show FPS (saved with the other options) + Reset (SET and on the overlay)
const fpsMeter = new FpsMeter(document.getElementById('fpsBox'));
fpsMeter.setOn(opts.showFps);
const fpsBox = document.getElementById('optFps');
fpsBox.addEventListener('change', () => { opts.showFps = fpsBox.checked; saveOpts(); fpsMeter.setOn(opts.showFps); });
uiTap('fpsResetSet', () => { fpsMeter.reset(); hud.toast('FPS stats reset', 1.2); });
uiTap('fpsReset', () => fpsMeter.reset());
const fpsInfo = () => (tuner.active ? 'Tuning ' + tuner.index + '/' + TUNE.trials + '\n' : '') + presetName + (tuneU ? ' AUTO ' + renderer.getPixelRatio().toFixed(2) + 'x' : '') + (lodScale < 0.99 ? ' LOD x' + lodScale.toFixed(2) : '') + '\n' + sim.ws.name + '\n' + renderer.info.render.calls + ' draws';
// v2.5.22: camera 3rd / 1st person (SET, on-screen button, V), head-bob comfort option; all saved
const camTxt = document.getElementById('camTxt'), camBtnEl = document.getElementById('camBtn');
function setCam(mode, toast) {
  opts.cam = mode === '1p' ? '1p' : '3p'; saveOpts(); updateSettingsUi();
  if (toast) hud.toast('Camera: ' + (opts.cam === '1p' ? '1st person' : '3rd person'), 1.2);
}
function camUi() {
  const fp = opts.cam === '1p';
  camTxt.textContent = fp ? '1P' : '3P'; camBtnEl.title = 'Camera: ' + (fp ? '1st' : '3rd') + ' person - tap for ' + (fp ? '3rd' : '1st') + ' (V)';
  document.body.classList.toggle('fp', fp);
}
for (const btn of document.querySelectorAll('[data-cam]')) btn.addEventListener('click', (e) => { e.stopPropagation(); setCam(btn.dataset.cam, false); });
uiTap('camBtn', () => setCam(opts.cam === '1p' ? '3p' : '1p', true));
// v2.5.26 SET > Aircraft on / off (visuals; the sound has its own Aircraft channel in the sound section)
const airBox = document.getElementById('optAircraft');
const gymBox = document.getElementById('optGym'); // v2.5.27
const bikeBox = document.getElementById('optBikes'); // v2.5.29
bikeBox.addEventListener('change', () => { opts.bikes = bikeBox.checked; bikes.enabled = opts.bikes; saveOpts(); });
gymBox.addEventListener('change', () => { opts.gym = gymBox.checked; gym.enabled = opts.gym; saveOpts(); });
const venBox = document.getElementById('optVendors'); // v2.5.27
venBox.addEventListener('change', () => { opts.vendors = venBox.checked; setVendorsOn(opts.vendors); saveOpts(); });
const iceBox = document.getElementById('optIceCream'); // v2.5.27
iceBox.addEventListener('change', () => { opts.icecream = iceBox.checked; icecream.enabled = opts.icecream; setIceOn(opts.icecream); saveOpts(); });
const balBox = document.getElementById('optBalloons'); // v2.5.27
balBox.addEventListener('change', () => { opts.balloons = balBox.checked; balloons.enabled = opts.balloons; saveOpts(); });
airBox.addEventListener('change', () => { opts.aircraft = airBox.checked; aircraft.enabled = opts.aircraft; saveOpts(); });
for (const btn of document.querySelectorAll('[data-gather]')) btn.addEventListener('click', (e) => { e.stopPropagation(); opts.gather = Number(btn.dataset.gather); setGatherLevel(opts.gather); saveOpts(); updateSettingsUi(); });
const bobBox = document.getElementById('optBob');
bobBox.addEventListener('change', () => { opts.headBob = bobBox.checked; saveOpts(); });
// v2.5.25 SET > Muscle shading
const muscleBox = document.getElementById('optMuscle');
const muscleBareBox = document.getElementById('optMuscleBare');
muscleBox.addEventListener('change', () => { opts.muscle = muscleBox.checked; saveOpts(); applyMuscle(); updateSettingsUi(); });
muscleBareBox.addEventListener('change', () => { opts.muscleBare = muscleBareBox.checked; saveOpts(); applyMuscleStrength(); });
for (const btn of document.querySelectorAll('[data-mstr]')) btn.addEventListener('click', (e) => {
  e.stopPropagation(); const s = btn.dataset.mstr; if (!MUSCLE_STR[s] || s === opts.muscleStr) return;
  opts.muscleStr = s; saveOpts(); applyMuscleStrength(); updateSettingsUi();
});
document.getElementById('redetect').addEventListener('click', () => setPreset(autoPreset(), 'Auto-detected: ' + autoPreset()));
// v2.5.24: auto-tune section text (only measured numbers; nothing estimated is shown as a result)
function tuneUi() {
  const T = opts.tune, sv = T.byPreset[presetName], el = document.getElementById('tuneSum');
  tuneBox.checked = !!T.on;
  for (const b of document.querySelectorAll('[data-tgt]')) b.classList.toggle('on', Number(b.dataset.tgt) === (T.target || 0));
  document.getElementById('tuneRetune').disabled = tuner.active;
  const pct = (v) => Math.round(v * 100) + ' %';
  let txt;
  if (!T.on) txt = sv ? 'Off (a saved result for ' + presetName + ' is kept for when you turn it back on).' : 'Off: the preset is used as designed.';
  else if (tuner.active) {
    const done = tuner.trials.length, last = tuner.trials[done - 1];
    txt = 'Tuning ' + tuner.index + '/' + TUNE.trials + (tuner.confirming ? ' (re-measuring the winner)' : '') + ' - keep running; it waits while paused, in SET or in the background.' +
      (last ? ' Last trial: ' + last.avg.toFixed(1) + ' FPS avg, 1% low ' + last.low.toFixed(0) + '.' : '');
  } else if (sv) {
    const live = tuneU && tuneU.join() !== sv.u.join(), c = tuneCfg(live ? tuneU : sv.u); // honest: show what is applied now
    txt = presetName + ', target ' + sv.target + ' FPS' + (sv.targetAuto ? ' (auto from the display)' : '') + ': resolution ' + c.pr.toFixed(2) + 'x (preset max ' + c.prMax.toFixed(2) + 'x), detail range ' + pct(c.lod) +
      ', crowd ' + pct(c.crowd) + ', traffic ' + pct(c.cars) + '. Measured here: ' + sv.avg.toFixed(1) + ' FPS average, 1% low ' + sv.low.toFixed(0) + ' FPS (' + sv.frames + ' frames' +
      (sv.confirmed ? ', confirmation run' : ', best trial') + (sv.held ? '' : '; no trial held the target, kept the one that came closest') + ').' +
      (sv.check ? ' Re-check of ' + (sv.check.same ? 'this' : 'the top') + ' setting: ' + sv.check.avg.toFixed(1) + ' FPS average, 1% low ' + sv.check.low.toFixed(0) + '.' : '') +
      (live ? ' Since lowered by the emergency fallback (low FPS).' : '') + ' ' + sv.trials + ' trials, ' + new Date(sv.at).toLocaleString() + '.';
  } else txt = 'On: starts with your next run (' + TUNE.trials + ' trials of about ' + (TUNE.settle + TUNE.measure).toFixed(0) + ' s).';
  el.textContent = txt;
  document.getElementById('adaptTxt').textContent = tuneU && !tuner.active
    ? 'Adaptive safety net (auto-tuned: emergency only - if FPS stays under 60 % of the target for 5 s, lower the tuned settings)'
    : tuner.active ? 'Adaptive safety net (paused while auto-tune measures)' : 'Adaptive safety net (if FPS stays under 45: shorten the detail range, then drop one preset)';
}
function updateSettingsUi() {
  for (const btn of document.querySelectorAll('[data-preset]')) btn.classList.toggle('on', btn.dataset.preset === presetName);
  adaptBox.checked = adaptive;
  tuneUi();
  fpsBox.checked = !!opts.showFps;
  airBox.checked = opts.aircraft !== false; // v2.5.26
  balBox.checked = opts.balloons !== false; // v2.5.27
  iceBox.checked = opts.icecream !== false; venBox.checked = opts.vendors !== false; gymBox.checked = opts.gym !== false; bikeBox.checked = opts.bikes !== false;
  for (const btn of document.querySelectorAll('[data-gather]')) btn.classList.toggle('on', Number(btn.dataset.gather) === opts.gather);
  for (const btn of document.querySelectorAll('[data-cam]')) btn.classList.toggle('on', btn.dataset.cam === opts.cam);
  bobBox.checked = opts.headBob !== false;
  camUi();
  document.getElementById('gpuName').textContent = (gpu.name || 'unknown GPU') + (isMobile ? ' (mobile)' : '');
  document.getElementById('qchip').textContent = presetName;
  document.getElementById('optSound').checked = opts.sound;
  document.getElementById('optMusic').checked = opts.music;
  updateTrackUi();
  for (const [k, id] of [['master', 'volMaster'], ['music', 'volMusic'], ['amb', 'volAmb'], ['sfx', 'volSfx']]) { document.getElementById(id).value = opts.vol[k]; document.getElementById(id + 'Txt').textContent = opts.vol[k]; }
  for (const btn of document.querySelectorAll('[data-char]')) btn.classList.toggle('on', btn.dataset.char === opts.character);
  for (const [k] of AMB_CHANNELS) { const c = opts.ambCh[k]; const row = document.getElementById('amb-' + k); if (!row) continue; row.querySelector('input[type=checkbox]').checked = c.on; row.querySelector('input[type=range]').value = c.v; row.querySelector('b').textContent = c.v; row.classList.toggle('off', !c.on); }
  document.getElementById('optHaptics').checked = opts.haptics;
  document.getElementById('optHaptics').disabled = !haptics.supported;
  // v2.5.25 muscle SET (honest: on/off matches the live preference; n/a note via button when not HIGH/ULTRA)
  muscleBox.checked = !!opts.muscle;
  muscleBareBox.checked = !!opts.muscleBare;
  for (const btn of document.querySelectorAll('[data-mstr]')) btn.classList.toggle('on', btn.dataset.mstr === opts.muscleStr);
  const musBtn = document.getElementById('musBtn');
  if (musBtn) {
    const on = !!opts.muscle && muscleAllowed();
    musBtn.querySelector('b').textContent = !muscleAllowed() ? 'n/a' : opts.muscle ? 'ON' : 'OFF';
    musBtn.classList.toggle('on', on);
  }
}
document.getElementById('optSound').addEventListener('change', (e) => { opts.sound = e.target.checked; sfx.unlock(); sfx.muted = !opts.sound; saveOpts(); });
document.getElementById('optMusic').addEventListener('change', (e) => { opts.music = e.target.checked; sfx.unlock(); sfx.setMusic(opts.music); saveOpts(); updateTrackUi(); });
// v2.5.3: song indicator ("Song 2/3 - Track 2") and Next song in SET
function updateTrackUi() {
  const el = document.getElementById('musicTrack'); if (!el) return;
  const n = sfx.songCount;
  if (!n || sfx.songFailed) { el.textContent = 'Song: not available'; return; }
  el.textContent = 'Song ' + (sfx.songIdx + 1) + '/' + n + ' - ' + sfx.songName + (opts.music ? '' : ' (music off)');
}
sfx.onTrack = updateTrackUi; updateTrackUi();
document.getElementById('musicNext').addEventListener('click', (e) => { e.stopPropagation(); sfx.unlock(); sfx.nextTrack(); updateTrackUi(); });
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
    else if (tuner.active) perf.low = 0; // v2.5.24: the safety net waits while auto-tune measures
    else if (tuneU && adaptive && !paused && !document.hidden && sim.state === 'run') {
      // v2.5.24: after auto-tune the safety net is an emergency fallback only
      const tgt = (opts.tune.byPreset[presetName] || {}).target || 60;
      perf.low = perf.fps < 0.6 * tgt ? perf.low + 1 : 0;
      if (perf.low >= 5) {
        perf.low = 0; perf.grace = 3;
        if (tuneU.some((v) => v > 0)) { applyTune(tuneU.map((v) => Math.max(0, v - 0.25)), false); hud.toast('Emergency: ' + Math.round(perf.fps) + ' FPS - auto-tuned settings lowered', 2.5); }
        else { const i = PRESET_NAMES.indexOf(presetName); if (i > 0) setPreset(PRESET_NAMES[i - 1], 'Emergency: ' + Math.round(perf.fps) + ' FPS - quality lowered to ' + PRESET_NAMES[i - 1]); }
      }
    } else if (adaptive && !paused && !document.hidden && !tuneU) {
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
  U.uLights.value = p.lights || 0; // v2.5.18 establishment lights (dusk / rain / overcast)
  scene.fog.color.setRGB(...p.fog);
  const far = Math.min(p.fogFar * preset.fogScale * fogMul, camera.far - 5); // v2.5.24 fogMul: auto-tune view distance
  scene.fog.near = p.fogNear * preset.fogScale * fogMul; scene.fog.far = far;
  skyU.uTop.value.setRGB(...p.top); skyU.uHor.value.setRGB(...p.fog.map((v, i) => (v + p.hor[i]) / 2));
  skyU.uSunCol.value.setRGB(...p.sunCol); skyU.uSunSize.value = p.sunSize; skyU.uCloud.value = p.cloud; skyU.uCity.value.setRGB(...p.city);
  skyU.uOvercast.value = p.overcast || 0; // v2.5.11 CLOUDY cloud deck
  skyU.uJaffa.value.set(0.8 + 0.6 * Math.min(1, sim.distance / 5000), clamp((p.fogFar - 90) / 260, 0.3, 0.88));
  const su = world.sea.material.uniforms;
  su.uDeep.value.setRGB(...p.deep); su.uShallow.value.setRGB(...p.shallow); su.uGlitter.value = p.glitter; su.uChop.value = p.chop; su.uSunCol.value.setRGB(...p.sunCol);
  U.uSeaChop.value = preset.rich ? p.chop : 0; // v2.5.5 bathers / wave surfers ride the same swell
  world.glare.material.opacity = Math.min(1, p.sunSize);
  // v2.2 wind: steady breeze, gust strength, flutter, overall amount (SEA SPRAY strong ... CLEAR HAZE light)
  const w = p.wind;
  U.uWind.value.set(0.12 + 0.3 * w, (0.25 + 1.25 * w) * sim.chaos.gust, 0.25 + 0.75 * w, w); // v2.5.24 chaos drift: gust +-25 %
  decor.traffic = sim.chaos.traffic; // v2.5.24 chaos drift: road traffic spacing
  return far;
}

// ---------- camera
const camPos = new THREE.Vector3(0, 3, 7), look = new THREE.Vector3();
let kick = 0, roll = 0; // v2.1: FOV punch on near miss / dash, slight camera roll into lane changes
// v2.5.22 1st person: eye height, smoothed lane follow, slide / jump follow, speed-scaled head-bob (optional)
let camFP = false, fpX = 0, bobAmp = 0, camOverride = null; // v2.5.25 screenshot / video cam hook
// v2.5.23: 1P near fade radius (m) for people / dogs / leashes / props, and the shoulder-brush side offset
const NEAR_R = 0.8, BRUSH_MAX = 0.17;
let fpSide = 0;
// visual only (never feeds the sim): ease the eye away from a pedestrian / dog passing within ~1 m so they brush
// past at shoulder distance instead of through the lens
function brushTarget(cx, cz) {
  let best = 0, bw = 0;
  const one = (a, reach) => {
    if (!a.active) return;
    const dz = a.z - cz, dx = a.x - cx; // dz < 0: ahead
    if (dz < -2.2 || dz > 0.9) return;
    const ad = Math.abs(dx); if (ad > reach) return;
    const w = (1 - ad / reach) * Math.exp(-(dz + 0.35) * (dz + 0.35) / 0.9);
    if (w > bw) { bw = w; best = (dx >= 0 ? -1 : 1) * w; }
  };
  for (const a of sim.ai.people) one(a, 1.1);
  for (const d of sim.ai.dogs) one(d, 0.9);
  return clamp(best * 1.6, -1, 1) * BRUSH_MAX;
}
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
  const fp = opts.cam === '1p' && !title;
  if (fp !== camFP) { camFP = fp; fpX = rx; fpSide = 0; camera.near = fp ? 0.12 : 0.3; camera.updateProjectionMatrix(); setNearFade(fp); } // v2.5.23 near fade only in 1P
  if (fp) {
    fpX += (rx - fpX) * (1 - Math.exp(-dt * 16)); // lane changes / dodges: quick but smooth
    const spd = clamp(r.speed / 12, 0, 1.3);
    bobAmp = lerp(bobAmp, opts.headBob !== false && r.ground && r.slideT <= 0 && sim.state === 'run' ? spd : 0, 1 - Math.exp(-dt * 6));
    const by = (Math.abs(Math.sin(r.phase)) - 0.5) * 0.05 * bobAmp, sway = Math.sin(r.phase) * 0.022 * bobAmp;
    const eye = 1.58 - 0.8 * r.slidePose; // slides duck the view under banners
    if (!paused) fpSide += (brushTarget(fpX, rz) - fpSide) * (1 - Math.exp(-dt * 9));
    camera.position.set(fpX + sway + fpSide, ry + eye + by, rz - 0.06);
    look.set(fpX * 0.97 + sway * 0.4 + fpSide, ry * 0.85 + eye - 0.62, rz - 16);
  } else if (title) look.set(rx - 0.5, 1.2, rz + 2.0); else look.set(rx * 0.75, 1.3 + ry * 0.3, rz - 9);
  if (sim.shake > 0) { const s = sim.shake * sim.shake * 0.18; camera.position.x += Math.sin(sim.t * 61) * s; camera.position.y += Math.sin(sim.t * 47) * s; }
  camera.lookAt(look);
  roll = lerp(roll, title ? 0 : clamp(-r.lean * (fp ? 0.04 : 0.05), -0.05, 0.05), 1 - Math.exp(-dt * 6));
  if (roll) camera.rotateZ(roll);
  if (camOverride) { // v2.5.25 screenshot / video rig (window.__bbr.camOverride = { pos, look, fov, rel? })
    const o = camOverride, ox = o.rel ? rx : 0, oz = o.rel ? rz : 0;
    camera.position.set(o.pos[0] + ox, o.pos[1], o.pos[2] + oz); camera.up.set(0, 1, 0); camera.lookAt(o.look[0] + ox, o.look[1], o.look[2] + oz);
    if (o.fov && Math.abs(camera.fov - o.fov) > 0.01) { camera.fov = o.fov; camera.updateProjectionMatrix(); }
    U.uNear.value.set(camera.position.x, camera.position.y, camera.position.z, fp ? NEAR_R : 0);
    return;
  }
  U.uNear.value.set(camera.position.x, camera.position.y, camera.position.z, fp ? NEAR_R : 0); // v2.5.23
  kick = Math.max(0, kick - dt * 9);
  const minH = 55 * Math.PI / 180;
  const portraitFov = Math.min(88, 2 * Math.atan(Math.tan(minH / 2) / camera.aspect) * 180 / Math.PI);
  // 1st person: slightly wider (72 deg, portrait keeps ~64 deg horizontal so all five lanes read), smaller speed punch
  const fpPortrait = Math.min(100, 2 * Math.atan(Math.tan(64 * Math.PI / 360) / camera.aspect) * 180 / Math.PI);
  const fov = fp ? Math.max(72, fpPortrait) + clamp((r.speed - 9) * 0.6, 0, 5) + (r.dashT > 0 ? 4 : 0)
    : Math.max(60, portraitFov) + clamp((r.speed - 9) * 0.9, 0, 8) + (r.dashT > 0 ? 5 : 0);
  const target = fov + kick;
  if (Math.abs(camera.fov - target) > 0.05) { camera.fov = lerp(camera.fov, target, kick > 0 ? 1 - Math.exp(-dt * 30) : k); camera.updateProjectionMatrix(); }
}

// ---------- v2.5 ambience drivers (render side, Math.random only: never the sim RNG)
function ambienceTick(dt) {
  if (!sfx.ctx) return;
  const r = sim.r; let near = 0;
  // v2.5.4: chatter follows a Gaussian of each person's distance (sigma 20 m) instead of a 30 m count
  for (const a of sim.ai.people) if (a.active) near += gauss(Math.hypot(a.x - r.x, a.z - r.z), 20);
  const k = decor.kits, seated = (k.sit ? k.sit.set.stats[0] + k.sit.set.stats[1] : 0) + (k.cafe ? (k.cafe.set.stats[0] + k.cafe.set.stats[1]) * 2 : 0);
  const cafeNear = cafeSink(r.z); // 0..1, Gaussian of the distance to the nearest cafe
  sfx.crowdLevel = Math.min(1, near / 7) * 0.75 + Math.min(1, seated / 30) * (0.15 + 0.1 * cafeNear) + (sim.state === 'title' ? 0.3 : 0);
  sfx.cafeLevel = Math.min(1, seated / 24) * (0.3 + 0.7 * cafeNear); // v2.5.4: clinks peak next to a cafe
  // v2.5.2: soft seagull bed while a flock is visible and near (calls stay one-shots)
  sfx.gullBedLevel = birds.visible > 0 ? clamp(1 - (birds.nearest - 25) / 95, 0, 1) : 0;
  if (sim.state === 'run') for (const d of sim.ai.dogs) {
    if (!d.active) continue;
    const dist = Math.hypot(d.x - r.x, d.z - r.z); // v2.5.4: bark chance falls off softly (Gaussian, 14 m), no 25 m cut
    if (Math.random() < dt * 0.2 * gauss(dist, 14)) { sfx.bark(Math.max(-0.8, Math.min(0.8, (d.x - r.x) * 0.25)), dist); break; }
  }
}

// ---------- main loop: fixed-step accumulator + interpolated rendering
let acc = 0, last = performance.now(), lastRunning = null;
const _airFwd = new THREE.Vector3(), _airRight = new THREE.Vector3(); // v2.5.26
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
  sfx.lowAudio = presetName === 'LOW'; // v2.5.19: no road-noise layer on LOW
  sfx.traffic(paused ? null : decor.trafficHum); // v2.5.19 shared engine hum from nearby cars
  if (sim.state === 'over') overT += dt;
  U.uTime.value = sim.t + now * 0.0;
  if (sim.state !== 'run') U.uTime.value = now / 1000;
  const fogFar = applyWeather();
  updateCamera(alpha, dt);
  world.update(camera.position.z, fogFar, camera);
  world.frame(camera);
  skyline.update(camera); // v2.5.26
  kites.update(paused ? 0 : dt, sim, camera); // v2.5.26
  performers.update(paused ? 0 : dt, sim, camera); // v2.5.26
  if (!paused && sim.state === 'run') { // v2.5.26 sound for kites, gatherings, performers, city windows
    const ai = sim.ai, P = ai.people;
    sfx.life({ cam: camera.position, right: _airRight, dt, rain: sim.ws.p.rain || 0, wind: sim.ws.p.wind || 0, lights: U.uLights.value, kites: kites.live,
      gats: ai.gats.map((g) => ({ x: g.x, z: g.z, n: g.m.length, perf: g.perf !== undefined })), perf: performers.live, balloons: balloons.live });
  }
  decor.takeBathers(sim.ai.toBeach); // v2.5.5 walkers who stepped down to the beach
  sim.ai.visitMax = Math.ceil((decor.visitors ? decor.visitors.length : 0) * 0.5); // v2.5.18 preset constant
  decor.takeVisitors(sim.ai.toVisit); // v2.5.18 walkers who stepped into a restaurant / cafe
  decor.update(camera.position.z, paused ? 0 : dt, U.uTime.value, sim.r, camera.position.x);
  decor.frame(camera, sim.ws.p.wind);
  actors.dt = dt;
  actors.nearR = camFP ? NEAR_R : 0; // v2.5.23: leashes near the 1P lens are skipped
  actors.update(sim, alpha, camera, renderer.getPixelRatio());
  balloons.update(sim, camera, alpha); // v2.5.27
  vendors.update(sim, camera, alpha, paused ? 0 : dt, decor.visitors); // v2.5.27
  gym.update(sim, camera, paused ? 0 : dt); // v2.5.27
  bikes.update(sim, camera, paused ? 0 : dt, decor); // v2.5.29
  if (sim.ai.buys.length) { for (const e of sim.ai.buys.splice(0)) { const [p, d] = _ps(e.x, e.z); if (paused) continue; if (e.kind === 'tip') sfx.coins(p, d); else sfx.chaChing(p, d, 'vendors'); } } // v2.5.27 economy sounds
  actors.runner.visible = !camFP; actors.echo.visible = !camFP; // 1st person: own body + echoes hidden (fewer draws)
  birds.update(paused ? 0 : dt, camera, sim.state === 'run');
  { // v2.5.26 aircraft (sim clock: frozen while paused); nav lights swell in rain / low light
    const wp = sim.ws.p, am = U.uAmb.value, lum = 0.3 * am.r + 0.59 * am.g + 0.11 * am.b;
    aircraft.update(sim, camera, clamp((wp.rain || 0) * 0.8 + (0.42 - lum) * 2.2, 0, 1));
    icecream.update(sim, camera, paused ? 0 : dt, clamp((wp.rain || 0) * 0.8 + (0.42 - lum) * 2.2, 0, 1)); // v2.5.27
    sfx.iceTruck(paused || !icecream.live ? null : icecream.live, camera.position, _airRight);
    camera.getWorldDirection(_airFwd); _airRight.set(-_airFwd.z, 0, _airFwd.x).normalize();
    sfx.aircraft(paused || !aircraft.enabled ? null : aircraft.live, camera.position, _airRight);
  }
  if (!paused) ambienceTick(dt);
  renderer.render(scene, camera);
  perfTick(dt);
  tuneEase(dt); tuneFrame(now); // v2.5.24 auto-tune (measures real rAF intervals; GP fit only when a trial ends)
  fpsMeter.tick(now, document.hidden ? 'HIDDEN' : settingsOpen ? 'SET OPEN' : paused ? 'PAUSED' : '', fpsInfo); // v2.5.22 (paused time never counted)
  const running = sim.state === 'run';
  if (running !== lastRunning) { lastRunning = running; document.body.classList.toggle('running', running); }
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
    `LOD x${lodScale.toFixed(2)}  crowd n/m/f ${actors.crowdSet.stats.join('/')}  dogs ${actors.dogSet.stats.join('/')}  birds ${birds.onScreen || 0}/${birds.visible || 0}  air ${aircraft.onScreen}/${aircraft.visible}\n` +
    `weather ${sim.ws.name} (${sim.ws.timeLeft.toFixed(0)} s)  line ${sim.line > 0 ? '+1' : sim.line}  q ${sim.quality.toFixed(2)}\n` +
    (() => { const T = econTotals(); return `economy spent ${T.spent}  buys ${T.buys} (ice ${T.ice}, pops ${T.pops}, shop ${T.shop}, cafe ${T.cafe}, resto ${T.resto})  tips ${T.tips}  broke ${T.broke}  ATM ${T.atm} (+${T.withdrawn})\n`; })() +
    `tick ${sim.tick}  seed ${sim.seed}  gpu ${gpu.name.slice(0, 48)}${padId ? '\npad ' + padId.slice(0, 40) : ''}`;
}
// v2.5.28 one economy view: sim crowd wallets + café / shop visitors (same wallets, same payment rule)
function econTotals() { const A = sim.ai.econ, D = decor.econ || {}, B = bikes.econ, n = (x) => x || 0;
  return { rent: n(B.rent), spent: n(A.spent) + n(D.spent) + n(B.spent), buys: n(A.buys) + n(D.buys) + n(B.buys), ice: n(A.ice), pops: n(A.pops), shop: n(D.shop), cafe: n(D.cafe), resto: n(D.resto), tips: n(A.tips) + n(D.tips), broke: n(A.broke) + n(D.broke) + n(B.broke), atm: n(A.atm), withdrawn: n(A.withdrawn), skipped: n(D.skipped) }; }
window.__bbr = { econTotals,
  sim, setPreset, get preset() { return presetName; }, setMuscle: (on) => toggleMuscle(false, on), get camOverride() { return camOverride; }, set camOverride(v) { camOverride = v; }, get muscle() { return muscleState(); }, renderer: () => renderer, perf, gpu, isMobile, weakGpu, detectedReason,
  sfx, opts, haptics, evCount, fpsMeter, get paused() { return paused; }, togglePause, setCam, get camFP() { return camFP; }, stats: loadStats, best: loadBest, get lastResult() { return lastResult; }, camera, version: VERSION, setCharacter, actors, decor, U, world, birds, aircraft, skyline, kites, performers, balloons, icecream, vendors, gym, bikes,
  scene, get lodScale() { return lodScale; }, setLodScale, tuner, get tuneU() { return tuneU; }, startTune, applyTune, tuneCfg, toggleSettings,
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
