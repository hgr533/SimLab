// Sound for Beach Boulevard Runner.
// v2.4: the procedural game music was removed; the song (supplied by Haran) is the only music.
// The ambience loops (waves, rain, wind with gust swells) and the short gameplay effects
// (near-miss whoosh, combo chimes, pickups, contact, HEAT, footsteps, bike bell, results) stay,
// synthesised in code as in v2.3. The song is a looping AudioBuffer: fetched as bytes at boot (PC: assets/audio/
// boulevard-theme.mp3 over http; phone single file: base64 embedded in the page), decoded on the
// first user gesture, faded in, ducked under results / pause and briefly under near-miss and
// contact sounds. If it cannot be loaded or decoded, music simply stays silent.
// Buses: song -> fade -> songGain (Music volume) -> songDuck -> songBus (results / pause duck)
//        -> master (Master volume, M mute) -> limiter;  effects -> sfx (Effects volume) -> master;
//        waves / rain / wind beds -> amb (Ambience volume) -> master.
// Volumes are 0..100 (100 = the v2.3 mix), applied with a square curve and smoothed.
// Audio never touches the sim or its RNG.
const PENTA = [0, 2, 4, 7, 9];
import { windGust } from './config.js';
const mtof = (m) => 440 * Math.pow(2, (m - 69) / 12);
const BASE = { master: 0.9, music: 0.3, amb: 0.5, sfx: 0.55 }; // gains at volume 100 (the v2.3 mix)
const curve = (v) => { const x = Math.max(0, Math.min(100, Number(v) || 0)) / 100; return x * x; };

export class Sfx {
  constructor() {
    this.ctx = null; this._muted = false; this.musicOn = true; this.sfxOn = true;
    this.stepCount = 0; this.played = 0; this.state = 'off';
    this.vol = { master: 100, music: 100, amb: 100, sfx: 100 };
    // song state
    this.songBytes = null; this.songBuffer = null; this.songSrc = null;
    this.songState = 'idle'; // idle | loading | ready | decoding | decoded | failed
    this.songFailed = false; this.songPlaying = false; this.songOffset = 0; this.songStartedAt = 0;
    this.duckState = 1; this.songError = '';
  }
  // ---------- v2.3 background song
  // Start fetching the bytes right away (no AudioContext needed); decode happens in unlock().
  loadSong(url) {
    this.songState = 'loading';
    let p;
    try {
      const b64 = typeof window !== 'undefined' && window.__BBR_SONG_B64;
      if (b64) {
        p = Promise.resolve().then(() => {
          const bin = atob(b64), n = bin.length, u8 = new Uint8Array(n);
          for (let i = 0; i < n; i++) u8[i] = bin.charCodeAt(i);
          return u8.buffer;
        });
      } else if (typeof fetch === 'function' && location.protocol !== 'file:') {
        p = fetch(url).then((r) => { if (!r.ok) throw new Error('HTTP ' + r.status); return r.arrayBuffer(); });
      } else p = Promise.reject(new Error('no song source'));
    } catch (e) { p = Promise.reject(e); }
    this.songLoad = p.then((buf) => { this.songBytes = buf; this.songState = 'ready'; this.applyMusic(); })
      .catch((e) => this.songFail(e));
    return this.songLoad;
  }
  songFail(e) {
    this.songFailed = true; this.songState = 'failed'; this.songError = String((e && e.message) || e);
    this.songBytes = null; this.applyMusic(); // v2.4: no fallback music, just silence
  }
  decodeSong() {
    if (!this.ctx || !this.songBytes || this.songState !== 'ready') return;
    this.songState = 'decoding';
    const bytes = this.songBytes; this.songBytes = null;
    let done = false;
    const ok = (buf) => {
      if (done) return; done = true;
      if (!buf || !buf.duration) { this.songFail(new Error('empty audio')); return; }
      this.songBuffer = buf; this.songState = 'decoded';
      // trim the silent tail (and encoder padding) so the loop restarts without a long gap
      const d = buf.getChannelData(0), sr = buf.sampleRate; let end = d.length - 1;
      while (end > 0 && Math.abs(d[end]) < 0.003) end--;
      this.songLoopEnd = Math.min(buf.duration, (end + 1) / sr + 0.12);
      this.applyMusic();
    };
    const bad = (e) => { if (done) return; done = true; this.songFail(e || new Error('decode failed')); };
    try {
      const r = this.ctx.decodeAudioData(bytes, ok, bad);
      if (r && r.then) r.then(ok, bad);
    } catch (e) { bad(e); }
  }
  // v2.4: music is the song or nothing
  get musicEffective() { return this.musicOn && !this.songFailed ? 'song' : 'off'; }
  applyMusic() {
    if (!this.ctx) return;
    const eff = this.musicEffective;
    if (eff === 'song' && this.songState === 'ready') this.decodeSong(); // decode only when wanted
    if (eff === 'song' && this.songBuffer) this.startSong();
    else this.stopSong();
  }
  // ---------- v2.4 volumes (0..100), smooth, M mute stays on the master
  setVolume(kind, v) {
    if (!(kind in this.vol)) return;
    this.vol[kind] = Math.max(0, Math.min(100, Math.round(Number(v) || 0)));
    this.applyVolumes();
  }
  gainFor(kind) { return kind === 'master' ? (this._muted ? 0 : BASE.master * curve(this.vol.master)) : BASE[kind] * curve(this.vol[kind]); }
  applyVolumes(tc = 0.06) {
    if (!this.ctx) return;
    const t = this.ctx.currentTime;
    this.master.gain.setTargetAtTime(this.gainFor('master'), t, tc);
    this.songGain.gain.setTargetAtTime(this.gainFor('music'), t, tc);
    this.sfx.gain.setTargetAtTime(this.gainFor('sfx'), t, tc);
    this.amb.gain.setTargetAtTime(this.gainFor('amb'), t, tc);
  }
  startSong() {
    if (this.songPlaying || !this.songBuffer) return;
    const c = this.ctx, t = c.currentTime;
    const src = c.createBufferSource(); src.buffer = this.songBuffer; src.loop = true;
    src.loopStart = 0; src.loopEnd = this.songLoopEnd || this.songBuffer.duration;
    const fg = c.createGain(); // per-source fade, so a quick stop / start never overlaps loudly
    fg.gain.setValueAtTime(0.0001, t); fg.gain.linearRampToValueAtTime(1, t + 1.5); // 1.5 s fade in
    src.connect(fg); fg.connect(this.songGain);
    const off = this.songOffset % src.loopEnd;
    src.start(t, off);
    src.onended = () => { try { fg.disconnect(); } catch (e) { /* ignore */ } };
    this.songSrc = src; this.songFade = fg; this.songPlaying = true; this.songStartedAt = t - off;
  }
  stopSong() {
    if (!this.songPlaying) return;
    const c = this.ctx, t = c.currentTime, src = this.songSrc, fg = this.songFade, len = src.loopEnd || this.songBuffer.duration;
    this.songOffset = (t - this.songStartedAt) % len; // resume from here next time
    fg.gain.cancelScheduledValues(t); fg.gain.setValueAtTime(fg.gain.value, t); fg.gain.linearRampToValueAtTime(0.0001, t + 0.4);
    try { src.stop(t + 0.45); } catch (e) { /* already stopped */ }
    this.songPlaying = false; this.songSrc = null; this.songFade = null;
  }
  get songPosition() { return this.songPlaying ? (this.ctx.currentTime - this.songStartedAt) % (this.songSrc.loopEnd || this.songBuffer.duration) : this.songOffset; }
  // short duck (about -2.5 dB) so near-miss and contact sounds cut through the song
  duckHit() {
    if (!this.songPlaying) return;
    const t = this.ctx.currentTime, g = this.songDuck.gain;
    g.cancelScheduledValues(t); g.setValueAtTime(g.value, t);
    g.linearRampToValueAtTime(0.75, t + 0.03); g.setTargetAtTime(1, t + 0.3, 0.15);
  }
  get muted() { return this._muted; }
  set muted(v) { this._muted = !!v; this.applyVolumes(0.05); }
  setMusic(on) { this.musicOn = !!on; this.applyMusic(); }
  unlock() {
    if (this.ctx) { if (this.ctx.state === 'suspended') this.ctx.resume(); return; }
    try { this.ctx = new (window.AudioContext || window.webkitAudioContext)({ latencyHint: 'interactive' }); } catch (e) { this.ctx = null; return; }
    const c = this.ctx;
    this.master = c.createGain(); this.master.gain.value = this.gainFor('master');
    // gentle limiter so stacked one-shots never clip on phone speakers
    const comp = c.createDynamicsCompressor(); comp.threshold.value = -14; comp.ratio.value = 6; comp.attack.value = 0.003; comp.release.value = 0.2;
    this.master.connect(comp); comp.connect(c.destination);
    this.sfx = c.createGain(); this.sfx.gain.value = this.gainFor('sfx'); this.sfx.connect(this.master);
    this.amb = c.createGain(); this.amb.gain.value = this.gainFor('amb'); this.amb.connect(this.master);
    // song chain: source -> fade -> songGain (Music volume) -> songDuck (hit ducks) -> songBus
    // (results / pause duck) -> master -> limiter
    this.songBus = c.createGain(); this.songBus.gain.value = 1; this.songBus.connect(this.master);
    this.songDuck = c.createGain(); this.songDuck.gain.value = 1; this.songDuck.connect(this.songBus);
    this.songGain = c.createGain(); this.songGain.gain.value = this.gainFor('music'); this.songGain.connect(this.songDuck);
    // shared noise buffers (generated once)
    const sr = c.sampleRate;
    this.white = c.createBuffer(1, sr * 2, sr);
    const w = this.white.getChannelData(0); let seed = 12345;
    for (let i = 0; i < w.length; i++) { seed = (seed * 1103515245 + 12345) >>> 0; w[i] = (seed / 4294967296) * 2 - 1; }
    this.brown = c.createBuffer(1, sr * 4, sr);
    const b = this.brown.getChannelData(0); let last = 0;
    for (let i = 0; i < b.length; i++) { last = (last + 0.02 * w[i % w.length]) / 1.02; b[i] = last * 3.5; }
    // ambience beds (as in v2.3): waves (brown noise, lowpass, slow swell), rain (white,
    // band-limited), wind (white, bandpass, swells with the travelling gusts)
    this.waves = this.bed(this.brown, 'lowpass', 520, 0.7);
    this.rain = this.bed(this.white, 'highpass', 1400, 0.5, 'lowpass', 7500);
    this.wind = this.bed(this.white, 'bandpass', 420, 0.6);
    this.state = c.state;
    this.applyMusic();
  }
  bed(buf, type, f, q, type2, f2) {
    const c = this.ctx, src = c.createBufferSource(); src.buffer = buf; src.loop = true;
    src.loopStart = 0; src.playbackRate.value = 1;
    const fl = c.createBiquadFilter(); fl.type = type; fl.frequency.value = f; fl.Q.value = q;
    const g = c.createGain(); g.gain.value = 0;
    let head = fl;
    src.connect(fl);
    if (type2) { const f2n = c.createBiquadFilter(); f2n.type = type2; f2n.frequency.value = f2; fl.connect(f2n); head = f2n; }
    head.connect(g); g.connect(this.amb); src.start(c.currentTime + Math.random() * 0.01);
    return { src, fl, g };
  }
  // ---------- one-shot building blocks
  env(g, t, a, peak, dur) { g.gain.setValueAtTime(0.0001, t); g.gain.exponentialRampToValueAtTime(peak, t + a); g.gain.exponentialRampToValueAtTime(0.0001, t + dur); }
  tone(f0, f1, dur, type = 'sine', vol = 0.08, when = 0, bus = this.sfx, pan = 0, attack = 0.005) {
    if (!this.ctx || (bus === this.sfx && !this.sfxOn)) return;
    const c = this.ctx, t = c.currentTime + when, o = c.createOscillator(), g = c.createGain();
    o.type = type; o.frequency.setValueAtTime(f0, t); if (f1 !== f0) o.frequency.exponentialRampToValueAtTime(Math.max(20, f1), t + dur);
    this.env(g, t, attack, vol, dur);
    let out = g;
    if (pan && c.createStereoPanner) { const p = c.createStereoPanner(); p.pan.value = pan; g.connect(p); out = p; }
    o.connect(g); out.connect(bus); o.start(t); o.stop(t + dur + 0.05);
    this.played++;
  }
  noise(dur, type, f0, f1, vol, q = 1, when = 0, pan = 0, bus = this.sfx) {
    if (!this.ctx || (bus === this.sfx && !this.sfxOn)) return;
    const c = this.ctx, t = c.currentTime + when, s = c.createBufferSource(), fl = c.createBiquadFilter(), g = c.createGain();
    s.buffer = this.white; fl.type = type; fl.Q.value = q;
    fl.frequency.setValueAtTime(f0, t); if (f1 !== f0) fl.frequency.exponentialRampToValueAtTime(f1, t + dur);
    this.env(g, t, Math.min(0.02, dur * 0.3), vol, dur);
    let out = g;
    if (pan && c.createStereoPanner) { const p = c.createStereoPanner(); p.pan.value = pan; g.connect(p); out = p; }
    s.connect(fl); fl.connect(g); out.connect(bus);
    s.start(t, Math.random() * 1.5); s.stop(t + dur + 0.05);
    this.played++;
  }
  chime(combo, when = 0) {
    const k = Math.max(0, Math.min(14, combo - 2));
    const m = 72 + PENTA[k % 5] + 12 * Math.floor(k / 5);
    this.tone(mtof(m), mtof(m), 0.32, 'sine', 0.055, when, this.sfx, 0, 0.004);
    this.tone(mtof(m + 12), mtof(m + 12), 0.18, 'triangle', 0.02, when + 0.01);
  }
  footstep(wet, sprint) {
    this.stepCount++;
    const pan = (this.stepCount & 1) ? -0.15 : 0.15;
    this.noise(wet ? 0.11 : 0.06, 'bandpass', wet ? 1800 : 900, wet ? 1200 : 600, wet ? 0.09 : (sprint ? 0.11 : 0.08), 1.3, 0, pan);
    this.tone(sprint ? 120 : 100, 60, 0.07, 'sine', 0.06, 0, this.sfx, pan);
  }
  // ---------- game events
  play(type, e = {}, sim = null) {
    if (!this.ctx) return;
    const combo = sim ? sim.combo : 1;
    const pan = Math.max(-0.8, Math.min(0.8, (e.x || 0) * 0.5));
    if (type === 'near' || type === 'contact') this.duckHit();
    switch (type) {
      case 'near':
        this.noise(0.24, 'bandpass', 500, 2600, 0.2, 1.6, 0, pan);
        this.tone(700, 1250, 0.16, 'triangle', 0.045, 0.02, this.sfx, pan);
        this.chime(combo, 0.06); break;
      case 'hurdle': case 'slide':
        this.noise(0.12, 'highpass', 2500, 4000, 0.06, 0.7);
        this.chime(combo); break;
      case 'leash':
        this.tone(520, 1040, 0.12, 'square', 0.025); this.chime(combo, 0.04); this.chime(combo + 2, 0.12); break;
      case 'trail':
        [0, 4, 7, 12].forEach((s, i) => this.tone(mtof(76 + s), mtof(76 + s), 0.25, 'triangle', 0.04, i * 0.05)); break;
      case 'orb': {
        const k = Math.max(0, Math.min(9, e.value | 0));
        const m = 79 + PENTA[k % 5] + 12 * Math.floor(k / 5);
        this.tone(mtof(m), mtof(m) * 1.01, 0.14, 'sine', 0.045, 0, this.sfx, 0, 0.002); break;
      }
      case 'drink':
        this.noise(0.25, 'bandpass', 600, 3000, 0.07, 3);
        this.tone(392, 784, 0.22, 'sine', 0.06); this.tone(587, 1175, 0.2, 'sine', 0.04, 0.08); break;
      case 'contact':
        this.noise(0.3, 'lowpass', 900, 180, 0.3, 0.8, 0, pan);
        this.tone(140, 55, 0.3, 'sawtooth', 0.07); this.tone(90, 40, 0.35, 'sine', 0.12); break;
      case 'jump': this.tone(260, 520, 0.12, 'sine', 0.04); this.noise(0.08, 'bandpass', 700, 1400, 0.04); break;
      case 'slide2': break;
      case 'bell': // v2.2 bike bell from a passing cyclist on the bike path (decor)
        this.tone(2100, 2100, 0.16, 'sine', 0.03, 0, this.sfx, 0.6, 0.002); this.tone(2650, 2650, 0.22, 'sine', 0.025, 0.09, this.sfx, 0.6, 0.002); break;
      case 'dash': this.noise(0.3, 'bandpass', 300, 3500, 0.16, 1.2); this.tone(400, 1400, 0.2, 'sine', 0.04); break;
      case 'heat':
        [0, 7, 12, 16].forEach((s, i) => this.tone(mtof(64 + s), mtof(64 + s), 0.3, 'square', 0.022, i * 0.09));
        this.tone(mtof(40), mtof(40), 0.6, 'sawtooth', 0.04, 0, this.sfx, 0, 0.01); break;
      case 'over':
        [12, 7, 3, 0].forEach((s, i) => this.tone(mtof(60 + s), mtof(60 + s) * 0.98, 0.42, 'triangle', 0.06, i * 0.16));
        this.noise(1.2, 'lowpass', 1200, 200, 0.08, 0.5); break;
      case 'best':
        [0, 4, 7, 12, 16].forEach((s, i) => this.tone(mtof(72 + s), mtof(72 + s), 0.4, 'triangle', 0.05, 0.7 + i * 0.1)); break;
      default: break;
    }
  }
  // Called every frame: ambience follows the weather, results / pause duck for the song,
  // footsteps follow the runner cadence.
  update(sim, dt, running, paused = false) {
    if (!this.ctx) return;
    const c = this.ctx, t = c.currentTime, p = sim.ws.p;
    this.state = c.state;
    // song sits about 4 dB lower under the results screen and while paused (smooth)
    const duck = sim.state === 'over' || paused ? 0.63 : 1;
    if (duck !== this.duckState) { this.duckState = duck; this.songBus.gain.setTargetAtTime(duck, t, 0.35); }
    // ambience (unchanged from v2.3)
    const swell = 0.5 + 0.3 * Math.sin(t * 0.9) + 0.15 * Math.sin(t * 2.3 + 1.0);
    this.waves.g.gain.setTargetAtTime(0.22 * swell * (1 + p.chop * 0.6), t, 0.2);
    this.waves.fl.frequency.setTargetAtTime(380 + 300 * swell, t, 0.3);
    this.rain.g.gain.setTargetAtTime(0.26 * p.rain, t, 0.4);
    const spd = running ? Math.min(1, sim.r.speed / 15) : 0;
    const g = windGust(sim.r.z, sim.t), wnd = p.wind === undefined ? p.spray : p.wind;
    this.wind.g.gain.setTargetAtTime(0.04 + 0.22 * wnd * (0.35 + 0.65 * g) + 0.06 * spd, t, 0.25);
    this.wind.fl.frequency.setTargetAtTime(300 + 500 * spd + 350 * g * wnd + 120 * Math.sin(t * 0.37), t, 0.4);
    // footsteps: one per half gait cycle (phase advances 2*pi per stride)
    const r = sim.r;
    if (running && r.ground && r.slideT <= 0) {
      const k = Math.floor(r.phase / Math.PI);
      if (this.lastK !== undefined && k !== this.lastK) this.footstep(p.wet > 0.4, r.sprint);
      this.lastK = k;
    } else this.lastK = Math.floor(r.phase / Math.PI);
  }
}
