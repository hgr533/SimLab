// Sound for Beach Boulevard Runner.
// v2.4: the procedural game music was removed; the song (supplied by Haran) is the only music.
// The ambience loops (rain, wind with gust swells) and the short gameplay effects
// (near-miss whoosh, combo chimes, pickups, contact, HEAT, footsteps, bike bell, results) stay,
// synthesised in code as in v2.3. The song is a looping AudioBuffer: fetched as bytes at boot (PC: assets/audio/
// boulevard-theme.mp3 over http; phone single file: base64 embedded in the page), decoded on the
// first user gesture, faded in, ducked under results / pause and briefly under near-miss and
// contact sounds. If it cannot be loaded or decoded, music simply stays silent.
// Buses: song -> fade -> songGain (Music volume) -> songDuck -> songBus (results / pause duck)
//        -> master (Master volume, M mute) -> limiter;  effects -> sfx (Effects volume) -> master;
//        rain / wind beds -> amb (Ambience volume) -> master.
// Volumes are 0..100 (100 = the v2.3 mix), applied with a square curve and smoothed.
// v2.5: the Ambience bus is split into channels, each with its own on/off and volume (SET):
//   crowd chatter (follows nearby crowd and cafes), rain (weather), wind (weather and gusts,
//   strongest in SEA SPRAY), seagull calls (with the flocks), bike bells, cafe clinks, dog barks,
//   runner footsteps.
//   channel gain -> amb (Ambience volume) -> master. All synthesised here, no samples.
// v2.5.1: the distant-waves bed was removed (Haran's choice). Louder and phone-speaker friendly (phone speakers drop most sound
//   below ~300 Hz, so the crowd is now formant "talkers" instead of low murmur noise); the context is created / resumed from real touch and key gestures and after
//   the page comes back or toggles fullscreen; test() plays each ambience sound once (SET).
// Audio never touches the sim or its RNG.
const PENTA = [0, 2, 4, 7, 9];
import { windGust } from './config.js';
const mtof = (m) => 440 * Math.pow(2, (m - 69) / 12);
const BASE = { master: 0.9, music: 0.3, amb: 0.5, sfx: 0.55 }; // gains at volume 100 (the v2.3 mix)
const curve = (v) => { const x = Math.max(0, Math.min(100, Number(v) || 0)) / 100; return x * x; };
export const AMB_CHANNELS = [
  ['crowd', 'Crowd chatter'], ['rain', 'Rain'], ['wind', 'Wind'], ['gulls', 'Seagulls'],
  ['bells', 'Bike bells'], ['cafe', 'Cafe clinks'], ['dogs', 'Dog barks'], ['steps', 'Footsteps'],
];

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
    this.ambCh = {}; for (const [k] of AMB_CHANNELS) this.ambCh[k] = { on: true, v: 100 };
    this.crowdLevel = 0; this.cafeLevel = 0; this.calls = { gull: 0, bark: 0, clink: 0, bell: 0 };
  }
  // v2.5 ambience channels
  chGain(k) { const c = this.ambCh[k]; return c && c.on ? curve(c.v) : 0; }
  setAmbChannel(k, on, v) {
    const c = this.ambCh[k]; if (!c) return;
    if (on !== undefined && on !== null) c.on = !!on;
    if (v !== undefined && v !== null) c.v = Math.max(0, Math.min(100, Math.round(Number(v) || 0)));
    if (this.ctx && this.ch[k]) this.smooth(this.ch[k].gain, this.chGain(k));
  }
  // v2.5: short linear ramp to a new gain. A ramp has explicit end times, so it also lands on
  // time on a node that is idle (silent channels are not processed and setTargetAtTime would
  // only start moving once the next sound arrives).
  smooth(param, v, dur = 0.08) {
    const t = this.ctx.currentTime;
    param.cancelScheduledValues(t); param.setValueAtTime(param.value, t); param.linearRampToValueAtTime(v, t + dur);
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
    const d = tc * 1.4;
    this.smooth(this.master.gain, this.gainFor('master'), d);
    this.smooth(this.songGain.gain, this.gainFor('music'), d);
    this.smooth(this.sfx.gain, this.gainFor('sfx'), d);
    this.smooth(this.amb.gain, this.gainFor('amb'), d);
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
  // v2.5.1: resume a suspended / interrupted context (call from gestures and page events)
  resume() {
    const c = this.ctx; if (!c || c.state === 'running' || c.state === 'closed') return;
    try { const r = c.resume(); if (r && r.catch) r.catch(() => {}); } catch (e) { /* not allowed yet */ }
  }
  unlock() {
    if (this.ctx) { this.resume(); return; }
    try { this.ctx = new (window.AudioContext || window.webkitAudioContext)({ latencyHint: 'interactive' }); } catch (e) { this.ctx = null; return; }
    const c = this.ctx;
    this.master = c.createGain(); this.master.gain.value = this.gainFor('master');
    // gentle limiter so stacked one-shots never clip on phone speakers
    const comp = c.createDynamicsCompressor(); comp.threshold.value = -14; comp.ratio.value = 6; comp.attack.value = 0.003; comp.release.value = 0.2;
    this.master.connect(comp); comp.connect(c.destination);
    this.sfx = c.createGain(); this.sfx.gain.value = this.gainFor('sfx'); this.sfx.connect(this.master);
    this.amb = c.createGain(); this.amb.gain.value = this.gainFor('amb'); this.amb.connect(this.master);
    this.ch = {};
    for (const [k] of AMB_CHANNELS) { const g = c.createGain(); g.gain.value = this.chGain(k); g.connect(this.amb); this.ch[k] = g; }
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
    // ambience beds: rain (white,
    // band-limited), wind (white, bandpass, swells with the travelling gusts)
    this.rain = this.bed(this.white, 'highpass', 1400, 0.5, 'lowpass', 7500, this.ch.rain);
    this.wind = this.bed(this.white, 'bandpass', 420, 0.6, null, 0, this.ch.wind);
    // v2.5 crowd chatter: two babble voices (band-limited noise, syllable-rate amplitude wobble
    // from slow LFO pairs) over a low murmur; its level follows the crowd near the runner
    this.crowd = { g: c.createGain(), voices: [] };
    this.crowd.g.gain.value = 0; this.crowd.g.connect(this.ch.crowd);
    for (const [f, q, l1, l2, vol] of [[620, 1.4, 4.1, 1.3, 0.55], [1350, 1.8, 5.3, 2.1, 0.32], [2400, 2.2, 6.7, 1.7, 0.14]]) {
      const v = this.bed(this.white, 'bandpass', f, q, null, 0, this.crowd.g);
      v.g.gain.value = vol * 0.5;
      for (const [rate, depth] of [[l1, 0.28], [l2, 0.18]]) { const o = c.createOscillator(), og = c.createGain(); o.frequency.value = rate * (0.9 + Math.random() * 0.2); og.gain.value = vol * depth; o.connect(og); og.connect(v.g.gain); o.start(); }
      this.crowd.voices.push(v);
    }
    const mur = this.bed(this.brown, 'lowpass', 380, 0.6, null, 0, this.crowd.g); mur.g.gain.value = 0.35;
    for (const v of this.crowd.voices) v.g.gain.value *= 0.55;
    // v2.5.1 talkers: buzzy voice source through two vowel formants, syllables scheduled in
    // update(); more talkers when the crowd is dense. Reads as people chatting, also on phones.
    this.crowd.lp = c.createBiquadFilter(); this.crowd.lp.type = 'lowpass'; this.crowd.lp.frequency.value = 3400; this.crowd.lp.connect(this.crowd.g);
    this.talk = [];
    const NV = 6;
    for (let i = 0; i < NV; i++) {
      const o = c.createOscillator(); o.type = 'sawtooth';
      const f0 = i % 2 === 0 ? 105 + Math.random() * 35 : 185 + Math.random() * 50; o.frequency.value = f0;
      const f1 = c.createBiquadFilter(); f1.type = 'bandpass'; f1.Q.value = 4; f1.frequency.value = 600;
      const f2 = c.createBiquadFilter(); f2.type = 'bandpass'; f2.Q.value = 6; f2.frequency.value = 1500;
      const g2 = c.createGain(); g2.gain.value = 0.7;
      const env = c.createGain(); env.gain.value = 0;
      o.connect(f1); o.connect(f2); f1.connect(env); f2.connect(g2); g2.connect(env);
      let out = env; if (c.createStereoPanner) { const pn = c.createStereoPanner(); pn.pan.value = -0.55 + 1.1 * i / (NV - 1); env.connect(pn); out = pn; }
      out.connect(this.crowd.lp); o.start();
      this.talk.push({ o, f1, f2, env, f0, next: c.currentTime + Math.random() * 1.2 });
    }
    this.crowdBoostUntil = 0;
    // page lifecycle: phones suspend audio when the tab is hidden or the screen turns off
    c.onstatechange = () => { this.state = c.state; };
    this.state = c.state;
    this.applyMusic();
  }
  bed(buf, type, f, q, type2, f2, dest) {
    const c = this.ctx, src = c.createBufferSource(); src.buffer = buf; src.loop = true;
    src.loopStart = 0; src.playbackRate.value = 1;
    const fl = c.createBiquadFilter(); fl.type = type; fl.frequency.value = f; fl.Q.value = q;
    const g = c.createGain(); g.gain.value = 0;
    let head = fl;
    src.connect(fl);
    if (type2) { const f2n = c.createBiquadFilter(); f2n.type = type2; f2n.frequency.value = f2; fl.connect(f2n); head = f2n; }
    head.connect(g); g.connect(dest || this.amb); src.start(c.currentTime + Math.random() * 0.01);
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
    // v2.5: runner footsteps on paving are an ambience channel (scuff + heel thump + small grit tick)
    const bus = this.ch.steps;
    this.noise(wet ? 0.11 : 0.06, 'bandpass', wet ? 1800 : 900, wet ? 1200 : 600, wet ? 0.3 : (sprint ? 0.38 : 0.31), 1.3, 0, pan, bus);
    this.tone(sprint ? 120 : 100, 60, 0.07, 'sine', 0.08, 0, bus, pan);
    if (!wet) this.noise(0.03, 'highpass', 2600, 4200, 0.13, 0.8, 0.01, pan, bus);
  }
  // ---------- v2.5 ambience voices
  // seagull "kee-aaw" plus a few short "kek" notes; quieter with distance
  gull(pan = 0, dist = 40) {
    if (!this.ctx) return;
    const c = this.ctx, t = c.currentTime, vol = 0.2 * Math.max(0.4, Math.min(1, 40 / Math.max(1, dist)));
    const note = (when, f0, f1, f2, dur, v) => {
      const o = c.createOscillator(), bp = c.createBiquadFilter(), g = c.createGain(), vib = c.createOscillator(), vg = c.createGain();
      o.type = 'sawtooth'; bp.type = 'bandpass'; bp.frequency.value = 1900; bp.Q.value = 1.6;
      o.frequency.setValueAtTime(f0, when); o.frequency.linearRampToValueAtTime(f1, when + dur * 0.2); o.frequency.exponentialRampToValueAtTime(f2, when + dur);
      vib.frequency.value = 28; vg.gain.value = f1 * 0.025; vib.connect(vg); vg.connect(o.frequency);
      this.env(g, when, 0.02, v, dur);
      let out = g; if (c.createStereoPanner) { const p = c.createStereoPanner(); p.pan.value = pan; g.connect(p); out = p; }
      o.connect(bp); bp.connect(g); out.connect(this.ch.gulls);
      o.start(when); vib.start(when); o.stop(when + dur + 0.05); vib.stop(when + dur + 0.05);
    };
    const k = 0.9 + Math.random() * 0.25;
    note(t, 1050 * k, 1550 * k, 780 * k, 0.42, vol);
    const n = 1 + Math.floor(Math.random() * 3);
    for (let i = 0; i < n; i++) note(t + 0.5 + i * 0.16, 1250 * k, 1400 * k, 1000 * k, 0.11, vol * 0.7);
    this.calls.gull++; this.played++;
  }
  // dog bark: a short throaty "woof", sometimes twice
  bark(pan = 0, dist = 10) {
    if (!this.ctx) return;
    const c = this.ctx, vol = 0.2 * Math.max(0.4, Math.min(1, 12 / Math.max(1, dist))), bus = this.ch.dogs;
    const woof = (when) => {
      const t = c.currentTime + when, o = c.createOscillator(), lp = c.createBiquadFilter(), g = c.createGain();
      o.type = 'sawtooth'; o.frequency.setValueAtTime(420 + Math.random() * 80, t); o.frequency.exponentialRampToValueAtTime(170, t + 0.13);
      lp.type = 'lowpass'; lp.frequency.setValueAtTime(1800, t); lp.frequency.exponentialRampToValueAtTime(500, t + 0.13); lp.Q.value = 3;
      this.env(g, t, 0.008, vol, 0.15);
      let out = g; if (c.createStereoPanner) { const p = c.createStereoPanner(); p.pan.value = pan; g.connect(p); out = p; }
      o.connect(lp); lp.connect(g); out.connect(bus); o.start(t); o.stop(t + 0.2);
      this.noise(0.06, 'bandpass', 900, 500, vol * 0.5, 1.5, when, pan, bus);
    };
    woof(0); if (Math.random() < 0.55) woof(0.2 + Math.random() * 0.08);
    this.calls.bark++; this.played++;
  }
  // cafe: cup on saucer / glass clink (inharmonic partials), now and then a cutlery scrape
  clink() {
    if (!this.ctx) return;
    const f = 2400 + Math.random() * 1900, v = 0.065 + Math.random() * 0.04, pan = 0.35 + Math.random() * 0.4, bus = this.ch.cafe;
    this.tone(f, f * 0.995, 0.16, 'sine', v, 0, bus, pan, 0.002);
    this.tone(f * 2.76, f * 2.75, 0.08, 'sine', v * 0.5, 0, bus, pan, 0.002);
    if (Math.random() < 0.3) this.tone(f * 1.08, f * 1.07, 0.12, 'sine', v * 0.7, 0.07, bus, pan, 0.002);
    if (Math.random() < 0.2) this.noise(0.12, 'highpass', 4500, 6000, 0.014, 0.7, 0.1, pan, bus);
    this.calls.clink++; this.played++;
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
      case 'bell': // v2.2 bike bell from a passing cyclist on the bike path (decor); v2.5: Bike bells channel
        this.calls.bell++;
        { const bp = Math.max(-0.8, Math.min(0.8, (e.x || 2) * 0.2)); this.tone(2100, 2100, 0.16, 'sine', 0.1, 0, this.ch.bells, bp, 0.002); this.tone(2650, 2650, 0.22, 'sine', 0.08, 0.09, this.ch.bells, bp, 0.002); this.tone(2100, 2100, 0.14, 'sine', 0.065, 0.2, this.ch.bells, bp, 0.002); } break;
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
  // v2.5.1: schedule the next syllables of the crowd talkers (a little ahead of time)
  talkers(t, cl) {
    const VOW = [[800, 1250], [520, 1850], [330, 2250], [520, 950], [380, 850], [650, 1650]];
    const active = 1 + Math.round(cl * (this.talk.length - 1));
    for (let i = 0; i < this.talk.length; i++) {
      const v = this.talk[i];
      if (i >= active) { if (v.next < t) v.next = t + 0.4; continue; }
      let guard = 0;
      while (v.next < t + 0.3 && guard++ < 8) {
        const s = Math.max(v.next, t + 0.02);
        if (Math.random() < 0.13) { v.next = s + 0.35 + Math.random() * 1.0; continue; } // pause between phrases
        const dur = 0.09 + Math.random() * 0.17, w = VOW[Math.floor(Math.random() * VOW.length)], k = v.f0 > 160 ? 1.15 : 1;
        v.f1.frequency.setValueAtTime(w[0] * k, s); v.f2.frequency.setValueAtTime(w[1] * k, s);
        v.o.frequency.setValueAtTime(v.f0 * (0.92 + Math.random() * 0.22), s); v.o.frequency.linearRampToValueAtTime(v.f0 * (0.86 + Math.random() * 0.18), s + dur);
        const a = 0.3 + Math.random() * 0.2;
        v.env.gain.setValueAtTime(0, s); v.env.gain.linearRampToValueAtTime(a, s + 0.025);
        v.env.gain.setValueAtTime(a * 0.85, s + dur - 0.03); v.env.gain.linearRampToValueAtTime(0, s + dur);
        v.next = s + dur + 0.02 + Math.random() * 0.08;
      }
    }
  }
  // v2.5.1 sound test (SET > Ambience sounds): each ambience sound once, in order, through its
  // own channel (so a sound that is switched off stays silent). onStep(key) marks the row.
  test(onStep) {
    if (!this.ctx) return;
    clearTimeout(this._testT);
    const c = this.ctx, steps = [
      ['crowd', () => { this.crowdBoostUntil = c.currentTime + 1.8; }],
      ['rain', () => { this.sweep(1.4, 'highpass', 1600, 2200, 0.07, this.ch.rain); }],
      ['wind', () => { this.sweep(1.5, 'bandpass', 300, 950, 0.16, this.ch.wind); }],
      ['gulls', () => { this.gull(-0.2, 20); }],
      ['bells', () => { this.play('bell'); }],
      ['cafe', () => { this.clink(); setTimeout(() => this.clink(), 260); setTimeout(() => this.clink(), 600); }],
      ['dogs', () => { this.bark(0.3, 6); }],
      ['steps', () => { for (let i = 0; i < 4; i++) setTimeout(() => this.footstep(false, false), i * 300); }],
    ];
    let i = 0;
    const next = () => {
      if (i >= steps.length) { if (onStep) onStep(null); return; }
      const [k, fn] = steps[i++]; if (onStep) onStep(k); fn(); this._testT = setTimeout(next, 1900);
    };
    this.resume(); next();
  }
  // noise swell (rise and fall) for the sound test
  sweep(dur, type, f0, f1, vol, bus, buf) {
    const c = this.ctx, t = c.currentTime, s = c.createBufferSource(), fl = c.createBiquadFilter(), g = c.createGain();
    s.buffer = buf || this.white; s.loop = true; fl.type = type; fl.Q.value = 0.8;
    fl.frequency.setValueAtTime(f0, t); fl.frequency.linearRampToValueAtTime(f1, t + dur * 0.5); fl.frequency.linearRampToValueAtTime(f0, t + dur);
    g.gain.setValueAtTime(0.0001, t); g.gain.linearRampToValueAtTime(vol, t + dur * 0.4); g.gain.linearRampToValueAtTime(0.0001, t + dur);
    s.connect(fl); fl.connect(g); g.connect(bus); s.start(t); s.stop(t + dur + 0.05);
    this.played++;
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
    // weather ambience: rain follows RAIN, wind follows the weather (SEA SPRAY strongest) and gusts
    this.rain.g.gain.setTargetAtTime(0.26 * p.rain, t, 0.4);
    const spd = running ? Math.min(1, sim.r.speed / 15) : 0;
    const g = windGust(sim.r.z, sim.t), wnd = p.wind === undefined ? p.spray : p.wind;
    this.wind.g.gain.setTargetAtTime(0.04 + 0.22 * wnd * (0.35 + 0.65 * g) + 0.06 * spd, t, 0.25);
    this.wind.fl.frequency.setTargetAtTime(300 + 500 * spd + 350 * g * wnd + 120 * Math.sin(t * 0.37), t, 0.4);
    // v2.5 crowd chatter and cafe clinks follow how busy it is around the runner
    const cl = t < this.crowdBoostUntil ? 1 : Math.max(0, Math.min(1, this.crowdLevel));
    this.crowd.g.gain.setTargetAtTime((0.07 + 0.43 * cl) * (1 - 0.5 * p.rain), t, 0.5);
    this.talkers(t, cl);
    if (this.cafeLevel > 0.05 && Math.random() < dt * 0.55 * this.cafeLevel) this.clink();
    // footsteps: one per half gait cycle (phase advances 2*pi per stride)
    const r = sim.r;
    if (running && r.ground && r.slideT <= 0) {
      const k = Math.floor(r.phase / Math.PI);
      if (this.lastK !== undefined && k !== this.lastK) this.footstep(p.wet > 0.4, r.sprint);
      this.lastK = k;
    } else this.lastK = Math.floor(r.phase / Math.PI);
  }
}
