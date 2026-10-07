// Sound for Beach Boulevard Runner.
// v2.4: the procedural game music was removed; the song (supplied by Haran) is the only music.
// The ambience loops (rain, wind with gust swells) and the short gameplay effects
// (near-miss whoosh, combo chimes, pickups, contact, HEAT, footsteps, bike bell, results) stay.
// (v2.3-v2.5.2) The song is a looping AudioBuffer: fetched as bytes at boot (PC: assets/audio/
// boulevard-theme.mp3 over http; phone single file: base64 embedded in the page), decoded on the
// first user gesture, faded in, ducked under results / pause and briefly under near-miss and
// contact sounds. If it cannot be loaded or decoded, music simply stays silent.
// Buses: song -> fade -> songGain (Music volume) -> songDuck -> songBus (results / pause duck)
//        -> master (Master volume, M mute) -> limiter;  effects -> sfx (Effects volume) -> master;
//        channel gain -> amb (Ambience volume) -> master.
// Volumes are 0..100 (100 = the v2.3 mix), applied with a square curve and smoothed.
// v2.5: the Ambience bus is split into channels, each with its own on/off and volume (SET):
//   crowd chatter (follows nearby crowd and cafes), rain (weather), wind (weather and gusts,
//   strongest in SEA SPRAY), seagull calls (with the flocks), bike bells, cafe clinks, dog barks,
//   runner footsteps.
// v2.5.1: the distant-waves bed was removed (Haran's choice). Louder and phone-speaker friendly;
//   the context is created / resumed from real touch and key gestures and after the page comes
//   back or toggles fullscreen; test() plays each ambience sound once (SET).
// v2.5.2: ambience channels use the Grok sound pack (WAV in the folder build, short
//   MP3 embedded as base64 for the phone file). Loops get a seam crossfade at decode time; one-shots
//   get a short fade in/out. Synthesised beds stay as a silent fallback if samples fail to load.
// v2.5.3: the music is a playlist of three songs (Boulevard theme, Track 2, Track 3) that plays
//   in order and wraps after the last, with a 0.8 s crossfade. A single song no longer loops.
//   Only the playing song and the next one are decoded; the others stay as MP3 bytes.
// v2.5.19 car sounds (two new ambience channels, own on/off + volume in SET, saved like the others):
//   Horns   - synthesised two-tone car horns (4 pitch pairs, tap / double / long), panned toward the car
//             and attenuated + dulled with distance; the triggers (hard brake behind a car, a slow
//             starter at a green light, a pedestrian on a zebra) and the global cooldown live in decor.
//   Traffic - ONE shared engine-hum voice (2 detuned saws + road-noise band on non-LOW) whose level /
//             pitch / pan follow the nearby cars, plus a soft noise whoosh when a car passes the runner.
//   Voice pool capped (CAR_VOICES); nodes are disconnected when they end. Unlocks with the first tap.
// Audio never touches the sim or its RNG.
const PENTA = [0, 2, 4, 7, 9];
import { windGust } from './config.js';
const mtof = (m) => 440 * Math.pow(2, (m - 69) / 12);
const BASE = { master: 0.9, music: 0.3, amb: 0.5, sfx: 0.55 }; // gains at volume 100 (the v2.3 mix)
const curve = (v) => { const x = Math.max(0, Math.min(100, Number(v) || 0)) / 100; return x * x; };
export const AMB_CHANNELS = [
  ['crowd', 'Crowd chatter'], ['rain', 'Rain'], ['wind', 'Wind'], ['gulls', 'Seagulls'],
  ['bells', 'Bells & wheels'], ['cafe', 'Cafe clinks'], ['dogs', 'Dog barks'], ['steps', 'Footsteps'],
  ['horns', 'Horns'], ['traffic', 'Traffic (engine hum & pass whoosh)'], // v2.5.19 car sounds
  ['aircraft', 'Aircraft (planes & helicopter)'], // v2.5.26
  ['kites', 'Kites (flap, line whir, kids)'], ['gather', 'Gatherings (murmur, laughs, applause)'],
  ['performers', 'Performers (music, coins, juggling)'], ['citywin', 'City windows (faint TV / music at night)'], // v2.5.26
  ['balloons', 'Balloons (squeak, pop)'], ['icecream', 'Ice cream truck (jingle)'], ['vendors', 'Vendors (calls, cooler lids)'], ['gym', 'Gym (clanks, grunts)'], // v2.5.27
  ['bikes', 'Bikes & scooters (bells, e-scooter whir, docks)'], // v2.5.29
];
// sound-pack file stems (folder: assets/sound/<name>.wav; phone: window.__BBR_SFX_B64[name])
// v2.5.3 music playlist, in play order (folder: assets/audio/<file>; phone: window.__BBR_SONGS_B64[i])
export const SONG_FILES = ['boulevard-theme.mp3', 'track-2.mp3', 'track-3.mp3'];
const SONG_NAMES = ['Boulevard theme', 'Track 2', 'Track 3'];
const XFADE = 0.8; // s crossfade between songs
const CAR_VOICES = 4; // v2.5.19 max simultaneous horn + whoosh voices (the hum is one more)
const HORNS = [[415, 520], [350, 440], [480, 600], [310, 392]]; // two-tone horn pitch pairs (Hz)
const PREFETCH = 40; // s before the end of a song: decode the next one
const SFX_FILES = [
  'crowd-chatter-loop', 'rain-loop', 'wind-loop', 'seagulls-loop',
  'bike-bell', 'cafe-clink', 'dog-bark-1', 'dog-bark-2',
  'footstep-dry', 'footstep-wet', 'seagull-1', 'seagull-2', 'seagull-3',
];

export class Sfx {
  constructor() {
    this.ctx = null; this._muted = false; this.musicOn = true; this.sfxOn = true;
    this.stepCount = 0; this.played = 0; this.state = 'off';
    this.vol = { master: 100, music: 100, amb: 100, sfx: 100 };
    // song state
    // v2.5.3 playlist: songs[i] = { name, bytes (MP3), buf (decoded or null), state, head, end }
    this.songs = []; this.songIdx = 0; this.cur = null; this.queued = null; this.trackLog = []; this.onTrack = null;
    this.songState = 'idle'; // idle | loading | ready | decoding | decoded | failed (all songs failed)
    this.songFailed = false; this.songPlaying = false; this.songOffset = 0; this.songStartedAt = 0;
    this.duckState = 1; this.songError = '';
    this.ambCh = {}; for (const [k] of AMB_CHANNELS) this.ambCh[k] = { on: true, v: 100 };
    this.crowdLevel = 0; this.cafeLevel = 0; this.calls = { gull: 0, bark: 0, clink: 0, bell: 0 };
    // v2.5.2 sound pack
    this.smpBytes = {}; this.smp = {}; this.smpState = 'idle'; // idle | loading | ready | decoding | decoded | failed
    this.smpError = ''; this.useSamples = false; this.gullBedLevel = 0;
    this.loops = {}; // name -> { src, g }
    this.testUntil = { rain: 0, wind: 0, aircraft: 0 }; this.air = null; // v2.5.26 aircraft voices // sound test swells for the sample beds
    // v2.5.19 car sounds
    this.lowAudio = false; this.hum = null; this.carVoices = 0;
    this.carStats = { honk: 0, whoosh: 0, dropped: 0, maxVoices: 0, honkT: [] };
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
  // ---------- v2.3 background song, v2.5.3 playlist of songs
  // Start fetching the bytes right away (no AudioContext needed); decoding happens after the
  // first gesture, one track at a time: the playing track plus the next one shortly before it
  // is needed (a decoded 3-minute song is about 60-70 MB, so all three are never held at once).
  // PC folder: assets/audio/<file> over http. Phone single file: window.__BBR_SONGS_B64 (array,
  // in playlist order); an older page with only window.__BBR_SONG_B64 plays that one song.
  loadSongs(urls) {
    if (typeof urls === 'string') urls = [urls];
    let list = null;
    try {
      const w = typeof window !== 'undefined' ? window : {};
      if (Array.isArray(w.__BBR_SONGS_B64) && w.__BBR_SONGS_B64.length) list = w.__BBR_SONGS_B64.map((b, i) => ({ b64: b, i }));
      else if (w.__BBR_SONG_B64) list = [{ b64: w.__BBR_SONG_B64, i: 0 }];
    } catch (e) { list = null; }
    const n = list ? list.length : urls.length;
    this.songs = [];
    for (let i = 0; i < n; i++) this.songs.push({ name: SONG_NAMES[i] || 'Song ' + (i + 1), bytes: null, buf: null, state: 'loading', head: 0, end: 0, err: '' });
    this.songState = 'loading'; this.songIdx = 0; this.songOffset = 0;
    const b64ToBuf = (b64) => { const bin = atob(b64), len = bin.length, u8 = new Uint8Array(len); for (let i = 0; i < len; i++) u8[i] = bin.charCodeAt(i); return u8.buffer; };
    const jobs = this.songs.map((tr, i) => {
      let p;
      try {
        if (list) {
          p = new Promise((res) => setTimeout(res, i * 30)).then(() => {
            const b = list[i].b64; if (!b) throw new Error('empty embedded song ' + (i + 1));
            const buf = b64ToBuf(b);
            try { if (window.__BBR_SONGS_B64) window.__BBR_SONGS_B64[i] = null; if (i === 0) window.__BBR_SONG_B64 = null; } catch (e) { /* ignore */ }
            return buf;
          });
        } else if (typeof fetch === 'function' && location.protocol !== 'file:') {
          p = fetch(urls[i]).then((r) => { if (!r.ok) throw new Error('HTTP ' + r.status + ' ' + urls[i]); return r.arrayBuffer(); });
        } else p = Promise.reject(new Error('no song source'));
      } catch (e) { p = Promise.reject(e); }
      return p.then((buf) => { tr.bytes = buf; tr.state = 'ready'; if (this.songState === 'loading') this.songState = 'ready'; this.applyMusic(); },
        (e) => { this.trackFail(i, e); });
    });
    this.songLoad = Promise.all(jobs);
    return this.songLoad;
  }
  loadSong(url) { return this.loadSongs(url); } // v2.4 name
  get songCount() { return this.songs.length; }
  get songName() { const t = this.songs[this.songIdx]; return t ? t.name : ''; }
  trackFail(i, e) {
    const tr = this.songs[i]; if (!tr) return;
    tr.state = 'failed'; tr.bytes = null; tr.buf = null; tr.err = String((e && e.message) || e);
    if (this.songs.every((t) => t.state === 'failed')) { this.songFail(new Error(this.songs.map((t) => t.err).join('; '))); return; }
    if (i === this.songIdx && !this.songPlaying) { this.songIdx = this.nextIdx(i); this.songOffset = 0; this.trackChanged(); }
    this.applyMusic();
  }
  songFail(e) {
    this.songFailed = true; this.songState = 'failed'; this.songError = String((e && e.message) || e);
    this.applyMusic(); // v2.4: no fallback music, just silence
  }
  // next playable track after i (wraps after the last); i itself when it is the only one
  nextIdx(i) {
    const n = this.songs.length;
    for (let k = 1; k <= n; k++) { const j = (i + k) % n; if (this.songs[j].state !== 'failed') return j; }
    return -1;
  }
  ensureDecoded(i) {
    const tr = this.songs[i];
    if (!this.ctx || !tr || tr.buf || tr.state !== 'ready' || !tr.bytes) return;
    tr.state = 'decoding'; if (this.songState === 'ready') this.songState = 'decoding';
    let done = false;
    const ok = (buf) => {
      if (done) return; done = true;
      if (!buf || !buf.duration) { this.trackFail(i, new Error('empty audio')); return; }
      // trim leading silence and the silent tail (and encoder padding) so songs follow on tightly
      const sr = buf.sampleRate, nCh = buf.numberOfChannels, len = buf.length;
      let head = len, end = 0;
      for (let ch = 0; ch < nCh; ch++) {
        const d = buf.getChannelData(ch);
        let a = 0; while (a < head && Math.abs(d[a]) < 0.003) a++;
        let b = len - 1; while (b > end && Math.abs(d[b]) < 0.003) b--;
        head = Math.min(head, a); end = Math.max(end, b);
      }
      if (end <= head) { head = 0; end = len - 1; }
      tr.head = Math.max(0, head / sr - 0.02); tr.end = Math.min(buf.duration, (end + 1) / sr + 0.05);
      tr.buf = buf; tr.state = 'decoded'; tr.decodes = (tr.decodes || 0) + 1; this.songState = 'decoded';
      this.applyMusic();
    };
    const bad = (e) => { if (done) return; done = true; this.trackFail(i, e || new Error('decode failed')); };
    try {
      const r = this.ctx.decodeAudioData(tr.bytes.slice(0), ok, bad); // keep the MP3 bytes for a later re-decode
      if (r && r.then) r.then(ok, bad);
    } catch (e) { bad(e); }
  }
  // drop decoded audio that is neither playing nor next (it is decoded again when its turn comes)
  releaseBuffers() {
    const keep = new Set([this.songIdx]);
    if (this.cur) { keep.add(this.cur.idx); keep.add(this.nextIdx(this.cur.idx)); }
    if (this.queued) keep.add(this.queued.idx);
    this.songs.forEach((t, i) => { if (!keep.has(i) && t.buf) { t.buf = null; t.state = t.bytes ? 'ready' : 'failed'; } });
  }
  trackChanged() {
    this.trackLog.push(this.songIdx);
    if (this.trackLog.length > 50) this.trackLog.shift();
    if (this.onTrack) { try { this.onTrack(this.songIdx, this.songs.length, this.songName); } catch (e) { /* UI only */ } }
  }
  // v2.4: music is the song or nothing (v2.5.3: the songs)
  get musicEffective() { return this.musicOn && !this.songFailed ? 'song' : 'off'; }
  applyMusic() {
    if (!this.ctx) return;
    if (this.musicEffective === 'song') {
      const tr = this.songs[this.songIdx];
      if (tr && tr.buf) this.startSong(); else this.ensureDecoded(this.songIdx); // decode only when wanted
      this.songTick();
    } else this.stopSong();
  }
  // ---------- v2.5.2 sound pack (WAV over http / embedded MP3 in the phone file)
  loadSfx(baseUrl) {
    this.smpState = 'loading';
    const b64map = typeof window !== 'undefined' && window.__BBR_SFX_B64;
    const jobs = SFX_FILES.map((name) => {
      let p;
      try {
        if (b64map && b64map[name]) {
          p = Promise.resolve().then(() => {
            const bin = atob(b64map[name]), n = bin.length, u8 = new Uint8Array(n);
            for (let i = 0; i < n; i++) u8[i] = bin.charCodeAt(i);
            return u8.buffer;
          });
        } else if (typeof fetch === 'function' && location.protocol !== 'file:') {
          p = fetch(baseUrl + name + '.wav').then((r) => { if (!r.ok) throw new Error('HTTP ' + r.status + ' ' + name); return r.arrayBuffer(); });
        } else p = Promise.reject(new Error('no sfx source'));
      } catch (e) { p = Promise.reject(e); }
      return p.then((buf) => { this.smpBytes[name] = buf; });
    });
    this.smpLoad = Promise.all(jobs).then(() => { this.smpState = 'ready'; this.decodeSfx(); })
      .catch((e) => { this.smpState = 'failed'; this.smpError = String((e && e.message) || e); this.useSamples = false; });
    return this.smpLoad;
  }
  decodeSfx() {
    if (!this.ctx || this.smpState !== 'ready') return;
    this.smpState = 'decoding';
    const names = Object.keys(this.smpBytes);
    if (!names.length) { this.smpState = 'failed'; this.smpError = 'empty'; return; }
    let left = names.length, failed = 0;
    const finish = () => {
      if (--left > 0) return;
      this.smpState = failed ? 'failed' : 'decoded';
      this.smpBytes = {};
      if (!failed && this.smp['crowd-chatter-loop'] && this.smp['rain-loop'] && this.smp['wind-loop']) {
        this.useSamples = true; this.startSampleLoops();
      }
    };
    for (const name of names) {
      const bytes = this.smpBytes[name];
      let done = false;
      const ok = (buf) => {
        if (done) return; done = true;
        if (!buf || !buf.duration) { failed++; finish(); return; }
        let out = buf;
        if (name.indexOf('-loop') >= 0 && name !== 'seagulls-loop') out = this.makeSeamless(buf, 0.28, 0.14);
        else if (name.indexOf('-loop') < 0) out = this.soften(buf, 0.002, 0.005);
        this.smp[name] = out; finish();
      };
      const bad = () => { if (done) return; done = true; failed++; finish(); };
      try {
        const r = this.ctx.decodeAudioData(bytes.slice(0), ok, bad);
        if (r && r.then) r.then(ok, bad);
      } catch (e) { bad(); }
    }
  }
  // equal-power crossfade of the end into the head; also trims a short fade-out on the pack WAVs
  makeSeamless(buf, fadeSec = 0.28, trimSec = 0.14) {
    const c = this.ctx, sr = buf.sampleRate, nCh = buf.numberOfChannels;
    const trim = Math.min(Math.floor(trimSec * sr), Math.floor(buf.length * 0.2));
    const fade = Math.min(Math.floor(fadeSec * sr), Math.floor((buf.length - trim) * 0.4));
    const len = buf.length - trim;
    if (fade < 64 || len <= fade) return buf;
    const out = c.createBuffer(nCh, len, sr);
    for (let ch = 0; ch < nCh; ch++) {
      const src = buf.getChannelData(ch), dst = out.getChannelData(ch);
      for (let i = 0; i < len; i++) dst[i] = src[i];
      for (let i = 0; i < fade; i++) {
        const t = i / fade, a = Math.sin(t * Math.PI * 0.5), b = Math.cos(t * Math.PI * 0.5);
        dst[i] = src[i] * a + src[len - fade + i] * b;
      }
    }
    return out;
  }
  soften(buf, fadeIn = 0.002, fadeOut = 0.005) {
    const c = this.ctx, sr = buf.sampleRate, nCh = buf.numberOfChannels;
    const out = c.createBuffer(nCh, buf.length, sr);
    const fi = Math.min(Math.floor(fadeIn * sr), Math.floor(buf.length / 4));
    const fo = Math.min(Math.floor(fadeOut * sr), Math.floor(buf.length / 4));
    for (let ch = 0; ch < nCh; ch++) {
      const src = buf.getChannelData(ch), dst = out.getChannelData(ch);
      for (let i = 0; i < buf.length; i++) {
        let g = 1;
        if (i < fi) g = i / fi;
        if (i >= buf.length - fo) g = Math.min(g, (buf.length - 1 - i) / fo);
        dst[i] = src[i] * g;
      }
    }
    return out;
  }
  startSampleLoops() {
    if (!this.ctx || !this.useSamples) return;
    // the synthesised fallback beds are not needed any more: stop them (saves phone CPU)
    const stop = (n) => { try { n.stop(); } catch (e) { /* not started */ } };
    if (this.rain) { this.rain.g.gain.value = 0; stop(this.rain.src); }
    if (this.wind) { this.wind.g.gain.value = 0; stop(this.wind.src); }
    if (this.crowd) {
      this.crowd.g.gain.value = 0;
      for (const v of this.crowd.voices) stop(v.src);
      for (const o of this.crowd.lfos) stop(o);
      if (this.crowd.mur) stop(this.crowd.mur.src);
    }
    if (this.talk) for (const v of this.talk) { v.env.gain.value = 0; stop(v.o); }
    const start = (name, dest, rate = 1) => {
      if (this.loops[name]) return;
      const buf = this.smp[name]; if (!buf) return;
      const c = this.ctx, src = c.createBufferSource(), g = c.createGain();
      src.buffer = buf; src.loop = true; src.loopStart = 0; src.loopEnd = buf.duration;
      src.playbackRate.value = rate; g.gain.value = 0;
      src.connect(g); g.connect(dest); src.start(c.currentTime + Math.random() * 0.05);
      this.loops[name] = { src, g };
    };
    start('crowd-chatter-loop', this.ch.crowd);
    start('rain-loop', this.ch.rain);
    start('wind-loop', this.ch.wind);
    // soft seagull bed while flocks are nearby
    const gullG = this.ctx.createGain(); gullG.gain.value = 0; gullG.connect(this.ch.gulls);
    const buf = this.smp['seagulls-loop'];
    if (buf) {
      const src = this.ctx.createBufferSource(); src.buffer = buf; src.loop = true;
      src.connect(gullG); src.start(this.ctx.currentTime);
      this.loops['seagulls-loop'] = { src, g: gullG };
    }
  }
  // play a decoded one-shot into an ambience channel
  oneshot(name, bus, vol = 0.5, pan = 0, rate = 1, when = 0) {
    if (!this.ctx || !this.smp[name]) return false;
    const c = this.ctx, t = c.currentTime + when, buf = this.smp[name];
    const src = c.createBufferSource(), g = c.createGain();
    src.buffer = buf; src.playbackRate.value = rate;
    g.gain.setValueAtTime(0.0001, t); g.gain.exponentialRampToValueAtTime(Math.max(0.0001, vol), t + 0.008);
    g.gain.exponentialRampToValueAtTime(0.0001, t + buf.duration / rate + 0.02);
    let out = g;
    if (pan && c.createStereoPanner) { const p = c.createStereoPanner(); p.pan.value = pan; g.connect(p); out = p; }
    src.connect(g); out.connect(bus); src.start(t); src.stop(t + buf.duration / rate + 0.05);
    this.played++; return true;
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
  // v2.5.3: one source per song, no loop; the next song is scheduled on the audio clock to
  // start XFADE s before the current one ends (equal-length linear crossfade), then wraps.
  makeSrc(idx, when, off, fadeIn) {
    const c = this.ctx, tr = this.songs[idx];
    const src = c.createBufferSource(); src.buffer = tr.buf;
    const fg = c.createGain(); // per-source fade, so a quick stop / start never overlaps loudly
    fg.gain.setValueAtTime(0.0001, when); fg.gain.linearRampToValueAtTime(1, when + fadeIn);
    src.connect(fg); fg.connect(this.songGain);
    src.start(when, off);
    src.onended = () => { try { fg.disconnect(); } catch (e) { /* ignore */ } };
    return { idx, src, fg, t0: when - off, startAt: when, endAt: when + (tr.end - off) };
  }
  startSong() {
    if (this.songPlaying || !this.ctx) return;
    let tr = this.songs[this.songIdx];
    if (!tr || !tr.buf) { this.ensureDecoded(this.songIdx); return; }
    let off = this.songOffset || 0;
    if (off > tr.end - XFADE - 1) { // resumed right at the end: go on with the next song
      const ni = this.nextIdx(this.songIdx);
      if (ni !== this.songIdx && ni >= 0) { this.songIdx = ni; this.songOffset = 0; this.trackChanged(); tr = this.songs[ni]; if (!tr.buf) { this.ensureDecoded(ni); return; } }
      off = 0;
    }
    off = Math.max(tr.head, off);
    const t = this.ctx.currentTime;
    this.cur = this.makeSrc(this.songIdx, t, off, 1.5); // 1.5 s fade in
    this.songPlaying = true; this.songStartedAt = this.cur.t0;
    this.songTick();
  }
  // called every frame, from a 0.5 s timer and after each decode: prefetch / queue / advance
  songTick() {
    if (!this.ctx || !this.songPlaying || !this.cur) return;
    const t = this.ctx.currentTime;
    if (this.queued && t >= this.queued.startAt) { // the next song has started (crossfade running)
      this.cur = this.queued; this.queued = null; this.songIdx = this.cur.idx; this.songStartedAt = this.cur.t0;
      this.trackChanged(); this.releaseBuffers();
    }
    const p = this.cur;
    if (!this.queued) {
      const ni = this.nextIdx(p.idx);
      if (ni < 0) return;
      const nt = this.songs[ni];
      if (p.endAt - t < PREFETCH) {
        if (nt.buf) {
          const startAt = Math.max(t + 0.05, p.endAt - XFADE), xf = Math.max(0.05, p.endAt - startAt);
          this.queued = this.makeSrc(ni, startAt, nt.head, xf);
          p.fg.gain.setValueAtTime(1, startAt); p.fg.gain.linearRampToValueAtTime(0.0001, startAt + xf);
          try { p.src.stop(startAt + xf + 0.05); } catch (e) { /* ignore */ }
        } else this.ensureDecoded(ni);
      }
      // the song ended before the next one was decoded (or it failed): continue as soon as possible
      if (!this.queued && t >= p.endAt) {
        try { p.src.stop(); } catch (e) { /* ended */ }
        this.songPlaying = false; this.cur = null; this.songIdx = ni; this.songOffset = 0; this.trackChanged();
        this.releaseBuffers(); this.applyMusic();
      }
    }
  }
  stopSong() {
    if (!this.songPlaying || !this.ctx) return;
    const c = this.ctx, t = c.currentTime;
    if (this.queued && t >= this.queued.startAt) { // mid-crossfade: keep the new song as the resume point
      this.cur = this.queued; this.queued = null; this.songIdx = this.cur.idx; this.trackChanged();
    }
    const p = this.cur;
    this.songIdx = p.idx; this.songOffset = Math.max(0, t - p.t0); // resume from here next time
    p.fg.gain.cancelScheduledValues(t); p.fg.gain.setValueAtTime(p.fg.gain.value, t); p.fg.gain.linearRampToValueAtTime(0.0001, t + 0.4);
    try { p.src.stop(t + 0.45); } catch (e) { /* already stopped */ }
    if (this.queued) { const q = this.queued; try { q.src.stop(); } catch (e) { /* not started */ } try { q.fg.disconnect(); } catch (e) { /* ignore */ } }
    this.songPlaying = false; this.cur = null; this.queued = null;
  }
  // v2.5.3: skip to the next song (SET > Next song); fades out, the next fades in
  nextTrack() {
    if (!this.songs.length) return;
    const from = this.cur ? this.cur.idx : this.songIdx;
    const ni = this.nextIdx(from); if (ni < 0) return;
    if (this.songPlaying) this.stopSong();
    this.songIdx = ni; this.songOffset = 0; this.trackChanged();
    this.releaseBuffers(); this.applyMusic();
  }
  get songPosition() { return this.songPlaying && this.cur ? this.ctx.currentTime - this.cur.t0 : this.songOffset; }
  get songBuffer() { const t = this.songs[this.songIdx]; return t ? t.buf : null; } // v2.4 test hooks
  get songSrc() { return this.cur ? this.cur.src : null; }
  get songLoopEnd() { const t = this.songs[this.songIdx]; return t ? t.end : 0; }
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
    if (this.ctx) { this.resume(); if (this.smpState === 'ready') this.decodeSfx(); return; }
    try { this.ctx = new (window.AudioContext || window.webkitAudioContext)({ latencyHint: 'interactive' }); } catch (e) { this.ctx = null; return; }
    const c = this.ctx;
    this.master = c.createGain(); this.master.gain.value = this.gainFor('master');
    // gentle limiter so stacked one-shots never clip on phone speakers
    const comp = c.createDynamicsCompressor(); comp.threshold.value = -14; comp.ratio.value = 6; comp.attack.value = 0.003; comp.release.value = 0.2;
    this.master.connect(comp); comp.connect(c.destination);
    this.sfx = c.createGain(); this.sfx.gain.value = this.gainFor('sfx'); this.sfx.connect(this.master);
    this.amb = c.createGain(); this.amb.gain.value = this.gainFor('amb');
    this.ambDuck = c.createGain(); this.ambDuck.gain.value = 1; this.ambDuck.connect(this.master); this.amb.connect(this.ambDuck); // v2.5.22 pause duck
    this.ch = {};
    for (const [k] of AMB_CHANNELS) { const g = c.createGain(); g.gain.value = this.chGain(k); g.connect(this.amb); this.ch[k] = g; }
    // song chain: source -> fade -> songGain (Music volume) -> songDuck (hit ducks) -> songBus
    // (results / pause duck) -> master -> limiter
    this.songBus = c.createGain(); this.songBus.gain.value = 1; this.songBus.connect(this.master);
    this.songDuck = c.createGain(); this.songDuck.gain.value = 1; this.songDuck.connect(this.songBus);
    this.songGain = c.createGain(); this.songGain.gain.value = this.gainFor('music'); this.songGain.connect(this.songDuck);
    // shared noise buffers (generated once) -- still used by action SFX and synth fallback
    const sr = c.sampleRate;
    this.white = c.createBuffer(1, sr * 2, sr);
    const w = this.white.getChannelData(0); let seed = 12345;
    for (let i = 0; i < w.length; i++) { seed = (seed * 1103515245 + 12345) >>> 0; w[i] = (seed / 4294967296) * 2 - 1; }
    this.brown = c.createBuffer(1, sr * 4, sr);
    const b = this.brown.getChannelData(0); let last = 0;
    for (let i = 0; i < b.length; i++) { last = (last + 0.02 * w[i % w.length]) / 1.02; b[i] = last * 3.5; }
    // synthesised beds (fallback if the sound pack fails to load / decode)
    this.rain = this.bed(this.white, 'highpass', 1400, 0.5, 'lowpass', 7500, this.ch.rain);
    this.wind = this.bed(this.white, 'bandpass', 420, 0.6, null, 0, this.ch.wind);
    this.crowd = { g: c.createGain(), voices: [], lfos: [] };
    this.crowd.g.gain.value = 0; this.crowd.g.connect(this.ch.crowd);
    for (const [f, q, l1, l2, vol] of [[620, 1.4, 4.1, 1.3, 0.55], [1350, 1.8, 5.3, 2.1, 0.32], [2400, 2.2, 6.7, 1.7, 0.14]]) {
      const v = this.bed(this.white, 'bandpass', f, q, null, 0, this.crowd.g);
      v.g.gain.value = vol * 0.5;
      for (const [rate, depth] of [[l1, 0.28], [l2, 0.18]]) { const o = c.createOscillator(), og = c.createGain(); o.frequency.value = rate * (0.9 + Math.random() * 0.2); og.gain.value = vol * depth; o.connect(og); og.connect(v.g.gain); o.start(); this.crowd.lfos.push(o); }
      this.crowd.voices.push(v);
    }
    const mur = this.bed(this.brown, 'lowpass', 380, 0.6, null, 0, this.crowd.g); mur.g.gain.value = 0.35; this.crowd.mur = mur;
    for (const v of this.crowd.voices) v.g.gain.value *= 0.55;
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
    c.onstatechange = () => { this.state = c.state; };
    this.state = c.state;
    this._songIv = setInterval(() => this.songTick(), 500); // advances the playlist even without frames
    this.applyMusic();
    if (this.smpState === 'ready') this.decodeSfx();
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

  // ---------- v2.5.19 car sounds (Horns / Traffic channels) ----------
  carVoice(dur) {
    if (this.carVoices >= CAR_VOICES) { this.carStats.dropped++; return false; }
    this.carVoices++; this.carStats.maxVoices = Math.max(this.carStats.maxVoices, this.carVoices + (this.hum ? 1 : 0));
    setTimeout(() => { this.carVoices = Math.max(0, this.carVoices - 1); }, (dur + 0.12) * 1000);
    return true;
  }
  // kind: 'tap' | 'double' | 'long'; dx / dz car position relative to the runner (m); seed picks the horn
  honk(kind, dx, dz, seed = 0) {
    this.carStats.honk++; this.carStats.honkT.push(this.ctx ? this.ctx.currentTime : performance.now() / 1000);
    if (this.carStats.honkT.length > 64) this.carStats.honkT.shift();
    if (!this.ctx || this.chGain('horns') <= 0 || this.ctx.state === 'suspended') return;
    const d = Math.hypot(dx, dz), att = 1 / Math.sqrt(1 + (d / 14) * (d / 14));
    const pattern = kind === 'double' ? [[0, 0.11], [0.19, 0.13]] : kind === 'long' ? [[0, 0.55]] : [[0, 0.15]];
    const dur = pattern[pattern.length - 1][0] + pattern[pattern.length - 1][1];
    if (!this.carVoice(dur)) return;
    const c = this.ctx, t0 = c.currentTime + 0.01;
    const pair = HORNS[((seed | 0) % HORNS.length + HORNS.length) % HORNS.length];
    const lp = c.createBiquadFilter(); lp.type = 'lowpass'; lp.frequency.value = Math.max(900, 3000 - d * 28); lp.Q.value = 0.9;
    const g = c.createGain(); g.gain.value = 0.0001;
    let out = g;
    if (c.createStereoPanner) { const pn = c.createStereoPanner(); pn.pan.value = Math.max(-0.85, Math.min(0.85, dx / 24)); g.connect(pn); out = pn; }
    lp.connect(g); out.connect(this.ch.horns);
    const peak = 0.2 * att;
    for (const [s, len] of pattern) {
      const a = t0 + s;
      g.gain.setValueAtTime(0.0001, a); g.gain.exponentialRampToValueAtTime(Math.max(0.0002, peak || 0), a + 0.012);
      g.gain.setValueAtTime(peak, a + len - 0.03); g.gain.exponentialRampToValueAtTime(0.0001, a + len);
    }
    const os = pair.map((f, k) => { const o = c.createOscillator(); o.type = k ? 'sawtooth' : 'square'; o.frequency.value = f * (1 + ((seed * 13) % 7 - 3) * 0.004); o.connect(lp); o.start(t0); o.stop(t0 + dur + 0.05); return o; });
    os[0].onended = () => { try { lp.disconnect(); g.disconnect(); out.disconnect(); } catch (e) { /* gone */ } };
    this.played++;
  }
  // soft pass-by whoosh (noise band sweeping up then down), relV = closing speed (m/s)
  whoosh(dx, relV = 10) {
    this.carStats.whoosh++;
    if (!this.ctx || this.chGain('traffic') <= 0 || !this.white || this.ctx.state === 'suspended') return;
    const dur = Math.max(0.5, Math.min(1.1, 9 / Math.max(4, relV)));
    if (!this.carVoice(dur)) return;
    const c = this.ctx, t = c.currentTime + 0.01, d = Math.abs(dx);
    const vol = 0.09 * Math.min(1.2, relV / 14) / (1 + Math.max(0, d - 12) / 8);
    const s = c.createBufferSource(), fl = c.createBiquadFilter(), g = c.createGain();
    s.buffer = this.white; fl.type = 'bandpass'; fl.Q.value = 0.8;
    fl.frequency.setValueAtTime(350, t); fl.frequency.exponentialRampToValueAtTime(1300, t + dur * 0.45); fl.frequency.exponentialRampToValueAtTime(420, t + dur);
    g.gain.setValueAtTime(0.0001, t); g.gain.exponentialRampToValueAtTime(Math.max(0.0002, vol), t + dur * 0.45); g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
    let out = g;
    if (c.createStereoPanner) { const pn = c.createStereoPanner(); pn.pan.setValueAtTime(Math.max(-0.85, Math.min(0.85, dx / 22)), t); g.connect(pn); out = pn; }
    s.connect(fl); fl.connect(g); out.connect(this.ch.traffic);
    s.onended = () => { try { s.disconnect(); fl.disconnect(); g.disconnect(); out.disconnect(); } catch (e) { /* gone */ } };
    s.start(t, Math.random() * 1.5); s.stop(t + dur + 0.05);
    this.played++;
  }
  // shared engine hum: created lazily, level 0..1, v = mean speed (m/s), pan -1..1
  traffic(h) {
    if (!this.ctx || !this.ch || !this.ch.traffic) return;
    if ((this.testUntil.traffic || 0) > this.ctx.currentTime) h = { level: 1, v: 9, pan: 0.6 }; // SET sound test
    const level = h ? h.level : 0;
    if (!this.hum) {
      if (level <= 0.01) return;
      const c = this.ctx, g = c.createGain(); g.gain.value = 0;
      const lp = c.createBiquadFilter(); lp.type = 'lowpass'; lp.frequency.value = 260; lp.Q.value = 0.7;
      const o1 = c.createOscillator(), o2 = c.createOscillator(); o1.type = 'sawtooth'; o2.type = 'sawtooth';
      o1.frequency.value = 46; o2.frequency.value = 59;
      const og = c.createGain(); og.gain.value = 0.55; o1.connect(og); o2.connect(og); og.connect(lp); lp.connect(g);
      let road = null;
      if (!this.lowAudio && (this.brown || this.white)) { // tyre / road noise layer (skipped on LOW)
        road = c.createBufferSource(); road.buffer = this.brown || this.white; road.loop = true;
        const nf = c.createBiquadFilter(); nf.type = 'bandpass'; nf.frequency.value = 520; nf.Q.value = 0.5;
        const ng = c.createGain(); ng.gain.value = 0.7; road.connect(nf); nf.connect(ng); ng.connect(g); road.start();
      }
      let out = g, pn = null;
      if (c.createStereoPanner) { pn = c.createStereoPanner(); g.connect(pn); out = pn; }
      out.connect(this.ch.traffic); o1.start(); o2.start();
      this.hum = { g, lp, o1, o2, pn, road };
    }
    const c = this.ctx, tt = c.currentTime, H = this.hum;
    H.g.gain.setTargetAtTime(0.06 * Math.min(1, level), tt, 0.25);
    const v = h ? h.v : 0;
    H.o1.frequency.setTargetAtTime(40 + v * 2.4, tt, 0.4); H.o2.frequency.setTargetAtTime(52 + v * 3.1, tt, 0.4);
    H.lp.frequency.setTargetAtTime(200 + v * 22, tt, 0.4);
    if (H.pn) H.pn.pan.setTargetAtTime(h ? Math.max(-0.8, Math.min(0.8, h.pan)) : 0, tt, 0.3);
  }
  honksPerMin(windowS = 60) { const T = this.carStats.honkT; if (!T.length) return 0; const now = T[T.length - 1]; return T.filter((x) => now - x <= windowS).length * 60 / windowS; }
  // ---------- one-shot building blocks
  env(g, t, a, peak, dur) { g.gain.setValueAtTime(0.0001, t); g.gain.exponentialRampToValueAtTime(Math.max(0.0002, peak || 0), t + a); g.gain.exponentialRampToValueAtTime(0.0001, t + dur); }
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
    const bus = this.ch.steps;
    const name = wet ? 'footstep-wet' : 'footstep-dry';
    const vol = (wet ? 0.55 : 0.48) * (sprint ? 1.15 : 1);
    if (this.oneshot(name, bus, vol, pan, 0.94 + Math.random() * 0.12)) return;
    // synth fallback
    this.noise(wet ? 0.11 : 0.06, 'bandpass', wet ? 1800 : 900, wet ? 1200 : 600, wet ? 0.3 : (sprint ? 0.38 : 0.31), 1.3, 0, pan, bus);
    this.tone(sprint ? 120 : 100, 60, 0.07, 'sine', 0.08, 0, bus, pan);
    if (!wet) this.noise(0.03, 'highpass', 2600, 4200, 0.13, 0.8, 0.01, pan, bus);
  }
  // ---------- v2.5 / v2.5.2 ambience voices
  gull(pan = 0, dist = 40) {
    if (!this.ctx) return;
    const vol = 0.7 * Math.max(0.4, Math.min(1, 40 / Math.max(1, dist)));
    const name = 'seagull-' + (1 + Math.floor(Math.random() * 3));
    if (this.oneshot(name, this.ch.gulls, vol, pan, 0.9 + Math.random() * 0.2)) { this.calls.gull++; return; }
    const c = this.ctx, t = c.currentTime, v0 = 0.2 * Math.max(0.4, Math.min(1, 40 / Math.max(1, dist)));
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
    note(t, 1050 * k, 1550 * k, 780 * k, 0.42, v0);
    const n = 1 + Math.floor(Math.random() * 3);
    for (let i = 0; i < n; i++) note(t + 0.5 + i * 0.16, 1250 * k, 1400 * k, 1000 * k, 0.11, v0 * 0.7);
    this.calls.gull++; this.played++;
  }
  bark(pan = 0, dist = 10) {
    if (!this.ctx) return;
    const vol = 0.65 * Math.max(0.4, Math.min(1, 12 / Math.max(1, dist)));
    const name = Math.random() < 0.5 ? 'dog-bark-1' : 'dog-bark-2';
    const rate = 0.92 + Math.random() * 0.16;
    if (this.oneshot(name, this.ch.dogs, vol, pan, rate)) {
      this.calls.bark++;
      if (Math.random() < 0.45) this.oneshot(name, this.ch.dogs, vol * 0.85, pan, rate * (0.96 + Math.random() * 0.08), 0.22 + Math.random() * 0.1);
      return;
    }
    const c = this.ctx, v0 = 0.2 * Math.max(0.4, Math.min(1, 12 / Math.max(1, dist))), bus = this.ch.dogs;
    const woof = (when) => {
      const t = c.currentTime + when, o = c.createOscillator(), lp = c.createBiquadFilter(), g = c.createGain();
      o.type = 'sawtooth'; o.frequency.setValueAtTime(420 + Math.random() * 80, t); o.frequency.exponentialRampToValueAtTime(170, t + 0.13);
      lp.type = 'lowpass'; lp.frequency.setValueAtTime(1800, t); lp.frequency.exponentialRampToValueAtTime(500, t + 0.13); lp.Q.value = 3;
      this.env(g, t, 0.008, v0, 0.15);
      let out = g; if (c.createStereoPanner) { const p = c.createStereoPanner(); p.pan.value = pan; g.connect(p); out = p; }
      o.connect(lp); lp.connect(g); out.connect(bus); o.start(t); o.stop(t + 0.2);
      this.noise(0.06, 'bandpass', 900, 500, v0 * 0.5, 1.5, when, pan, bus);
    };
    woof(0); if (Math.random() < 0.55) woof(0.2 + Math.random() * 0.08);
    this.calls.bark++; this.played++;
  }
  clink() {
    if (!this.ctx) return;
    const pan = 0.35 + Math.random() * 0.4, vol = 0.38 + Math.random() * 0.18;
    if (this.oneshot('cafe-clink', this.ch.cafe, vol, pan, 0.92 + Math.random() * 0.16)) { this.calls.clink++; return; }
    const f = 2400 + Math.random() * 1900, v = 0.065 + Math.random() * 0.04, bus = this.ch.cafe;
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
      case 'bell': // v2.5.2: bike-bell sample when available
        this.calls.bell++;
        { const bp = Math.max(-0.8, Math.min(0.8, (e.x || 2) * 0.2));
          if (!this.oneshot('bike-bell', this.ch.bells, 0.55, bp, 0.96 + Math.random() * 0.08)) {
            this.tone(2100, 2100, 0.16, 'sine', 0.1, 0, this.ch.bells, bp, 0.002);
            this.tone(2650, 2650, 0.22, 'sine', 0.08, 0.09, this.ch.bells, bp, 0.002);
            this.tone(2100, 2100, 0.14, 'sine', 0.065, 0.2, this.ch.bells, bp, 0.002);
          }
        } break;
      case 'wheels': // v2.5.5: soft polyurethane roll + a couple of joint clacks as a blader / skater passes
        this.calls.wheels = (this.calls.wheels || 0) + 1;
        { const bp = Math.max(-0.8, Math.min(0.8, (e.x || 2) * 0.2));
          this.noise(0.55, 'bandpass', 420, 760, 0.05, 0.9, 0, bp, this.ch.bells);
          this.noise(0.45, 'bandpass', 760, 520, 0.045, 0.9, 0.3, bp, this.ch.bells);
          this.noise(0.03, 'bandpass', 2400, 2200, 0.03, 2, 0.22, bp, this.ch.bells);
          this.noise(0.03, 'bandpass', 2400, 2200, 0.025, 2, 0.52, bp, this.ch.bells);
        } break;
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
    if (this.useSamples) return; // real crowd loop replaces the formant talkers
    const VOW = [[800, 1250], [520, 1850], [330, 2250], [520, 950], [380, 850], [650, 1650]];
    const active = 1 + Math.round(cl * (this.talk.length - 1));
    for (let i = 0; i < this.talk.length; i++) {
      const v = this.talk[i];
      if (i >= active) { if (v.next < t) v.next = t + 0.4; continue; }
      let guard = 0;
      while (v.next < t + 0.3 && guard++ < 8) {
        const s = Math.max(v.next, t + 0.02);
        if (Math.random() < 0.13) { v.next = s + 0.35 + Math.random() * 1.0; continue; }
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
  // ---------- v2.5.26 aircraft (Aircraft channel): one persistent voice per type, level / pitch / pan follow the
  // nearest craft of that type. Doppler-ish: pitch x c / (c - closing speed) (c 340 m/s, softened), volume
  // 1 / (1 + (d / ref)^2). Plane: two detuned saws (prop buzz); heli: saw + noise amplitude-modulated at the
  // blade rate (thwop); jet: low-passed noise roar + a soft whine. LOW: no noise layers (oscillators only).
  aircraft(list, cam, right) {
    if (!this.ctx || !this.ch || !this.ch.aircraft) return;
    const c = this.ctx, t = c.currentTime, test = (this.testUntil.aircraft || 0) > t;
    if (!this.air) {
      if (!test && (!list || !list.length)) return;
      const mk = (kind) => {
        const g = c.createGain(); g.gain.value = 0;
        const lp = c.createBiquadFilter(); lp.type = 'lowpass'; lp.Q.value = 0.6;
        let pn = null, out = g; if (c.createStereoPanner) { pn = c.createStereoPanner(); g.connect(pn); out = pn; }
        out.connect(this.ch.aircraft); lp.connect(g);
        const v = { g, lp, pn, os: [], base: [] };
        const osc = (type, f, gain, dest) => { const o = c.createOscillator(); o.type = type; o.frequency.value = f; const og = c.createGain(); og.gain.value = gain; o.connect(og); og.connect(dest || lp); o.start(); v.os.push(o); v.base.push(f); return og; };
        if (kind === 'plane') { lp.frequency.value = 900; osc('sawtooth', 92, 0.5); osc('sawtooth', 93.5, 0.4); osc('square', 184, 0.12); }
        else if (kind === 'heli') {
          lp.frequency.value = 700; const am = c.createGain(); am.gain.value = 0.5; am.connect(lp);
          osc('sawtooth', 58, 0.55, am); if (!this.lowAudio && (this.brown || this.white)) { const s = c.createBufferSource(); s.buffer = this.brown || this.white; s.loop = true; const sg = c.createGain(); sg.gain.value = 0.9; s.connect(sg); sg.connect(am); s.start(); v.noise = s; }
          const lfo = c.createOscillator(); lfo.frequency.value = 17; const lg = c.createGain(); lg.gain.value = 0.48; lfo.connect(lg); lg.connect(am.gain); lfo.start(); v.os.push(lfo); v.base.push(17);
        } else {
          lp.frequency.value = 520; osc('sine', 1650, 0.03); osc('sawtooth', 70, 0.18);
          if (!this.lowAudio && (this.brown || this.white)) { const s = c.createBufferSource(); s.buffer = this.brown || this.white; s.loop = true; const sg = c.createGain(); sg.gain.value = 1.4; s.connect(sg); sg.connect(lp); s.start(); v.noise = s; }
        }
        return v;
      };
      this.air = { plane: mk('plane'), heli: mk('heli'), jet: mk('jet') };
    }
    const REF = { plane: 70, heli: 60, jet: 150 }, PEAK = { plane: 0.16, heli: 0.2, jet: 0.24 };
    for (const kind of ['plane', 'heli', 'jet']) {
      const V = this.air[kind]; let best = null;
      if (list) for (const a of list) if (a.kind === kind && (!best || a.d < best.d)) best = a;
      let level = 0, dop = 1, pan = 0;
      if (test) { level = kind === 'jet' ? 0.7 : 0.6; pan = kind === 'plane' ? -0.5 : kind === 'heli' ? -0.2 : 0.3; }
      else if (best) {
        const dx = best.x - cam.x, dy = best.y - cam.y, dz = best.z - cam.z, d = Math.max(1, Math.hypot(dx, dy, dz));
        level = 1 / (1 + (d / REF[kind]) * (d / REF[kind]));
        const closing = -(best.vx * dx + best.vz * dz) / d; // m/s toward the listener
        dop = Math.max(0.8, Math.min(1.25, 1 / (1 - 0.6 * closing / 340)));
        pan = Math.max(-0.85, Math.min(0.85, (dx * right.x + dz * right.z) / (d * 0.8)));
      }
      V.g.gain.setTargetAtTime(PEAK[kind] * level, t, 0.15);
      for (let i = 0; i < V.os.length; i++) V.os[i].frequency.setTargetAtTime(V.base[i] * dop, t, 0.2);
      V.lp.frequency.setTargetAtTime((kind === 'jet' ? 380 : kind === 'heli' ? 600 : 750) + 900 * level, t, 0.2);
      if (V.pn) V.pn.pan.setTargetAtTime(pan, t, 0.2);
    }
  }
  // ---------- v2.5.26 sound for the new life (all synthesised: no added asset bytes) ----------
  // Distance falloff 1 / (1 + (d / ref)^2), pan from the camera's right vector, rain muffles (quieter, darker).
  att(d, ref) { return 1 / (1 + (d / ref) * (d / ref)); }
  kiteFlap(pan, d, wind = 0.5, when = 0) {
    if (!this.ctx || this.chGain('kites') <= 0) return;
    const v = 0.05 * this.att(d, 18) * (0.5 + wind);
    this.noise(0.07 + Math.random() * 0.05, 'bandpass', 900 + Math.random() * 500, 500, v, 1.4, when, pan, this.ch.kites);
  }
  lineWhir(pan, d, wind) { if (this.ctx && this.chGain('kites') > 0) this.tone(300 + wind * 260, 340 + wind * 300, 0.5, 'sine', 0.012 * this.att(d, 14), 0, this.ch.kites, pan, 0.15); }
  kidLaugh(pan, d, k = 1) {
    if (!this.ctx) return; const bus = this.ch.kites, f = 520 + Math.random() * 160, v = 0.05 * this.att(d, 20) * k;
    for (let i = 0; i < 4; i++) this.tone(f * (1.08 - i * 0.04), f * 0.9, 0.09, 'triangle', v, i * 0.13, bus, pan, 0.01);
  }
  laugh(pan, d, bus) {
    if (!this.ctx) return; bus = bus || this.ch.gather; const f = 180 + Math.random() * 140, v = 0.05 * this.att(d, 14);
    for (let i = 0; i < 3 + (Math.random() * 3 | 0); i++) this.tone(f * 1.2, f, 0.1, 'sawtooth', v * 0.5, i * 0.15, bus, pan, 0.01);
  }
  murmur(pan, d) { // short chatter swell (the crowd sample when loaded, else formant-ish noise)
    if (!this.ctx) return; const v = 0.35 * this.att(d, 12);
    if (this.smp['crowd-chatter-loop'] && this.oneshotSlice('crowd-chatter-loop', this.ch.gather, v, pan, 1.6)) return;
    this.noise(1.4, 'bandpass', 600, 900, v * 0.25, 2.5, 0, pan, this.ch.gather);
  }
  oneshotSlice(name, bus, vol, pan, dur) { // a random slice of a loaded loop, faded in / out
    const c = this.ctx, buf = this.smp[name]; if (!buf || buf.duration < dur + 0.5) return false;
    const t = c.currentTime, src = c.createBufferSource(), g = c.createGain(); src.buffer = buf;
    g.gain.setValueAtTime(0.0001, t); g.gain.linearRampToValueAtTime(vol, t + dur * 0.3); g.gain.linearRampToValueAtTime(0.0001, t + dur);
    let out = g; if (c.createStereoPanner) { const p = c.createStereoPanner(); p.pan.value = pan; g.connect(p); out = p; }
    src.connect(g); out.connect(bus); src.start(t, Math.random() * (buf.duration - dur - 0.2)); src.stop(t + dur + 0.05); this.played++; return true;
  }
  applause(pan, d, len = 1.5, bus) { // many short claps (noise grains)
    if (!this.ctx) return; bus = bus || this.ch.gather; const v = 0.05 * this.att(d, 14), n = Math.round(len * 22);
    for (let i = 0; i < n; i++) this.noise(0.025, 'bandpass', 1500 + Math.random() * 1500, 1200, v * (0.5 + Math.random() * 0.5) * Math.sin(Math.PI * i / n), 1.2, Math.random() * len, pan + (Math.random() - 0.5) * 0.3, bus);
  }
  // v2.5.27 balloons: a sharp pop (filtered noise burst + thump) and a soft rubbery squeak
  balloonPop(pan, d) { if (!this.ctx || this.chGain('balloons') <= 0) return; const bus = this.ch.balloons, v = 0.22 * this.att(d, 6);
    this.noise(0.025, 'highpass', 2600, 600, v * 1.2, 0.7, 0, pan, bus); this.noise(0.09, 'bandpass', 900, 900, v * 0.6, 1.0, 0.005, pan, bus); this.noise(0.35, 'lowpass', 1400, 300, v * 0.12, 0.6, 0.02, pan, bus); this.tone(160, 55, 0.08, 'sine', v * 0.8, 0, bus, pan, 0.001); }
  // v2.5.27 ice cream truck jingle: a music-box loop ("Turkey in the Straw"-style), positional, pitch bent by the
  // closing speed (Doppler-ish), silent when far, in the rain or when the channel is off. L = { x, z, v, jingle }
  iceTruck(L, cam, right) {
    if (!this.ctx || this.ctx.state === 'suspended') return;
    if (!L || !L.jingle || this.chGain('icecream') <= 0) { this._ice = null; return; }
    const dx = L.x - cam.x, dz = L.z - cam.z, d = Math.hypot(dx, dz); if (d > 120) { this._ice = null; return; }
    const I = this._ice || (this._ice = { i: 0, next: this.ctx.currentTime + 0.05 }), now = this.ctx.currentTime;
    if (I.next > now + 0.25) return;
    const MEL = [[67,1],[69,1],[71,2],[71,1],[71,1],[71,1],[69,1],[67,1],[69,1],[71,1],[69,1],[67,1],[64,2],[62,2],[67,1],[69,1],[71,2],[71,1],[71,1],[74,1],[71,1],[69,1],[67,1],[69,1],[71,1],[69,1],[67,4],[0,4]];
    const [m, len] = MEL[I.i % MEL.length]; I.i++;
    const pan = Math.max(-0.9, Math.min(0.9, (dx * (right ? right.x : 1) + dz * (right ? right.z : 0)) / Math.max(8, d)));
    const rv = -(L.v * dz) / Math.max(1, d), dop = 343 / (343 - rv * 0.9), v = 0.05 * this.att(d, 18), bus = this.ch.icecream, dur = len * 0.17;
    if (m) { const f = mtof(m + 12) * dop; this.tone(f, f, dur * 0.95, 'triangle', v, I.next - now, bus, pan, 0.004); this.tone(f * 2, f * 2, dur * 0.5, 'sine', v * 0.35, I.next - now, bus, pan, 0.002); }
    I.next = Math.max(I.next, now) + dur;
  }
  // v2.5.27 vendor call: a hummed sing-song with a vowel-ish formant; cooler lid thunk
  vendorCall(pan, d, beach) { if (!this.ctx || this.chGain('vendors') <= 0 || d > 60) return; const bus = this.ch.vendors, v = 0.06 * this.att(d, 14), b0 = beach ? 220 : 196;
    const notes = beach ? [[1, 0.28], [1.335, 0.22], [1.12, 0.45]] : [[1.335, 0.25], [1, 0.5]]; let w = 0;
    for (const [r, len] of notes) { const f = b0 * r; this.tone(f, f * 0.97, len, 'sawtooth', v * 0.35, w, bus, pan, 0.04); this.tone(f * 3, f * 2.9, len * 0.8, 'sine', v * 0.25, w, bus, pan, 0.04); w += len * 0.95; } }
  coolerLid(pan, d) { if (!this.ctx || this.chGain('vendors') <= 0 || d > 40) return; const bus = this.ch.vendors, v = 0.08 * this.att(d, 8);
    this.noise(0.05, 'lowpass', 600, 200, v, 1, 0, pan, bus); this.tone(110, 80, 0.07, 'sine', v * 0.8, 0, bus, pan, 0.002); this.noise(0.04, 'bandpass', 1500, 800, v * 0.5, 2, 0.35, pan, bus); }
  // v2.5.27 register 'cha-ching': drawer thunk + two bright bell partials (Vendors or Cafe clinks channel)
  chaChing(pan, d, ch = 'vendors') { if (!this.ctx || this.chGain(ch) <= 0 || d > 35) return; const bus = this.ch[ch], v = 0.07 * this.att(d, 8);
    this.noise(0.06, 'lowpass', 500, 200, v * 0.8, 1, 0, pan, bus); for (const [f, w] of [[2093, 0.08], [2637, 0.16]]) { this.tone(f, f, 0.5, 'sine', v, w, bus, pan, 0.002); this.tone(f * 2.4, f * 2.4, 0.25, 'sine', v * 0.3, w, bus, pan, 0.002); } }
  // v2.5.29 bikes & scooters: bell ring, e-scooter whir, kick-scooter roll, dock clunk / lock click (Bikes & scooters channel)
  bikeSound(kind, pan, d) { if (!this.ctx || this.chGain('bikes') <= 0 || d > 40) return; const bus = this.ch.bikes, v = 0.07 * this.att(d, 8);
    if (kind === 'bell') { if (!this.oneshot('bike-bell', bus, 0.5 * this.att(d, 8), pan, 0.94 + Math.random() * 0.12)) { this.tone(2100, 2100, 0.16, 'sine', v, 0, bus, pan, 0.002); this.tone(2650, 2650, 0.22, 'sine', v * 0.8, 0.09, bus, pan, 0.002); } }
    else if (kind === 'esc') { this.tone(620, 520, 0.9, 'sawtooth', v * 0.18, 0, bus, pan, 0.15); this.tone(1240, 1040, 0.9, 'sine', v * 0.25, 0, bus, pan, 0.15); this.noise(0.8, 'bandpass', 900, 600, v * 0.25, 1, 0, pan, bus); }
    else if (kind === 'kick') { this.noise(0.7, 'lowpass', 500, 300, v * 0.5, 1, 0, pan, bus); this.noise(0.03, 'bandpass', 2500, 1500, v * 0.4, 2, 0.4, pan, bus); }
    else if (kind === 'dock' || kind === 'unlock') { this.noise(0.05, 'lowpass', 700, 200, v, 1, 0, pan, bus); this.tone(1800, 1800, 0.08, 'square', v * 0.15, 0.12, bus, pan, 0.002); this.tone(2400, 2400, 0.1, 'square', v * 0.12, 0.22, bus, pan, 0.002); }
    else if (kind === 'lock') { this.noise(0.04, 'bandpass', 3000, 1500, v * 0.6, 2, 0, pan, bus); this.noise(0.04, 'bandpass', 2600, 1500, v * 0.5, 2, 0.15, pan, bus); } }
  gymClank(pan, d) { if (!this.ctx || this.chGain('gym') <= 0 || d > 40) return; const bus = this.ch.gym, v = 0.06 * this.att(d, 8);
    for (const f of [880, 1310, 2150]) this.tone(f, f * 0.995, 0.35, 'sine', v * (f > 1000 ? 0.5 : 1), 0, bus, pan, 0.001); this.noise(0.03, 'bandpass', 3000, 2000, v * 0.5, 2, 0, pan, bus); }
  gymGrunt(pan, d) { if (!this.ctx || this.chGain('gym') <= 0 || d > 30) return; const bus = this.ch.gym, v = 0.05 * this.att(d, 8), f = 110 + Math.random() * 40;
    this.tone(f, f * 0.8, 0.22, 'sawtooth', v * 0.4, 0, bus, pan, 0.02); this.noise(0.2, 'bandpass', 700, 900, v * 0.4, 1.5, 0, pan, bus); }
  balloonKid(pan, d, mood) { if (!this.ctx || this.chGain('balloons') <= 0) return; const bus = this.ch.balloons, v = 0.05 * this.att(d, 12);
    if (mood === 'laugh') { for (let i = 0; i < 4; i++) this.tone(620 + i * 25, 560, 0.1, 'triangle', v, i * 0.13, bus, pan, 0.01); }
    else { this.tone(520, 380, 0.7, 'sawtooth', v * 0.35, 0, bus, pan, 0.08); this.tone(480, 340, 0.6, 'sawtooth', v * 0.3, 0.8, bus, pan, 0.08); } }
  balloonSqueak(pan, d) { if (!this.ctx || this.chGain('balloons') <= 0) return; const bus = this.ch.balloons, v = 0.05 * this.att(d, 10), f = 700 + Math.random() * 500;
    this.tone(f, f * 1.6, 0.16, 'triangle', v, 0, bus, pan, 0.02); this.tone(f * 1.5, f * 0.9, 0.12, 'sine', v * 0.6, 0.14, bus, pan, 0.02); }
  coins(pan, d) { if (!this.ctx || !this.ch.performers) return; const bus = this.ch.performers, v = 0.06 * this.att(d, 10); for (let i = 0; i < 3; i++) { const f = 3200 + Math.random() * 1600; this.tone(f, f * 0.99, 0.12, 'sine', v, i * 0.07 + Math.random() * 0.03, bus, pan, 0.002); this.tone(f * 2.7, f * 2.7, 0.06, 'sine', v * 0.4, i * 0.07, bus, pan, 0.002); } }
  juggle(pan, d) { if (!this.ctx || !this.ch.performers) return; const bus = this.ch.performers, v = 0.04 * this.att(d, 10); this.noise(0.03, 'bandpass', 2200, 1800, v, 2, 0, pan, bus); this.noise(0.18, 'bandpass', 500, 1300, v * 0.4, 0.8, 0.02, pan, bus); }
  surprise(pan, d) { if (!this.ctx || !this.ch.performers) return; const bus = this.ch.performers, v = 0.05 * this.att(d, 12); for (let i = 0; i < 4; i++) { const f = 200 + Math.random() * 120; this.tone(f, f * 1.35, 0.5, 'triangle', v * 0.5, i * 0.04, bus, pan, 0.08); } this.applause(pan, d, 1.2, bus); }
  // street music: one note of a pentatonic phrase per instrument (0 guitar, 1 violin, 2 accordion, 3 darbuka, 4 sax, 5 keyboard)
  note(inst, pan, d, when = 0) {
    if (!this.ctx || this.chGain('performers') <= 0) return;
    const bus = this.ch.performers, v = 0.07 * this.att(d, 12), deg = PENTA[Math.floor(Math.random() * 5)] + 12 * Math.floor(Math.random() * 2);
    const f = mtof(57 + deg + (inst === 1 ? 12 : inst === 4 ? -2 : 0));
    if (inst === 0) { this.tone(f, f, 0.45, 'triangle', v, when, bus, pan, 0.003); this.tone(f * 2, f * 2, 0.2, 'sine', v * 0.3, when, bus, pan, 0.003); }
    else if (inst === 1) this.tone(f, f * 1.003, 0.5, 'sawtooth', v * 0.35, when, bus, pan, 0.08);
    else if (inst === 2) { this.tone(f, f, 0.4, 'square', v * 0.25, when, bus, pan, 0.03); this.tone(f * 1.5, f * 1.5, 0.4, 'square', v * 0.15, when, bus, pan, 0.03); }
    else if (inst === 3) { this.tone(160, 70, 0.18, 'sine', v * 1.2, when, bus, pan, 0.002); if (Math.random() < 0.5) this.noise(0.05, 'highpass', 2500, 2500, v * 0.5, 1, when + 0.14, pan, bus); }
    else if (inst === 4) this.tone(f, f * 0.995, 0.42, 'sawtooth', v * 0.3, when, bus, pan, 0.04);
    else { this.tone(f, f, 0.6, 'sine', v * 0.8, when, bus, pan, 0.005); this.tone(f * 3, f * 3, 0.3, 'sine', v * 0.15, when, bus, pan, 0.005); }
  }
  // faint window life at night / in the rain: a TV murmur, a bar of distant music, a far laugh
  windowLife(pan, k, force) {
    if (!this.ctx || this.chGain('citywin') <= 0) return; const bus = this.ch.citywin, v = 0.03 * k, u = Math.random();
    if (u < 0.4 || force) this.noise(1.2, 'bandpass', 700, 1100, v * 0.5, 3, 0, pan, bus);
    else if (u < 0.75) { const r = 50 + PENTA[Math.floor(Math.random() * 5)]; for (let i = 0; i < 3; i++) this.tone(mtof(r + [0, 4, 7][i]), mtof(r + [0, 4, 7][i]), 1.0, 'sine', v * 0.4, 0, bus, pan, 0.2); }
    else this.laugh(pan, 40, bus);
  }
  // per-frame driver (render side, Math.random only). L = { cam, right, kites, gats, perf, lights, rain, wind, dt }
  life(L) {
    if (!this.ctx || this.ctx.state === 'suspended' || !L || !(L.dt > 0)) return;
    const dt = L.dt, mf = 1 - 0.55 * Math.min(1, L.rain || 0), cam = L.cam, R = L.right;
    const rel = (x, z) => { const dx = x - cam.x, dz = z - cam.z, d = Math.max(1, Math.hypot(dx, dz)); return { d, pan: Math.max(-0.85, Math.min(0.85, (dx * R.x + dz * R.z) / (d * 0.9))) }; };
    for (const k of ['kites', 'gather', 'performers', 'citywin', 'balloons', 'icecream', 'vendors', 'gym', 'bikes']) if (this.ch[k]) { const want = this.chGain(k) * mf; if (Math.abs((this._lifeG && this._lifeG[k] || 0) - want) > 0.01) { (this._lifeG = this._lifeG || {})[k] = want; this.smooth(this.ch[k].gain, want, 0.4); } }
    // kites: nearest flyer
    let nk = null; for (const f of L.kites || []) { const r = rel(f.kx, f.kz); if (!nk || r.d < nk.d) nk = Object.assign(r, f); }
    if (nk && nk.d < 70) { if (Math.random() < dt * (2 + 4 * L.wind)) this.kiteFlap(nk.pan, nk.d, L.wind); if (Math.random() < dt * 0.4) this.lineWhir(nk.pan, nk.d, L.wind); if (nk.kid && Math.random() < dt * 0.12) this.kidLaugh(nk.pan, nk.d); }
    // gatherings: murmur + laughs; applause at performer circles
    for (const g of L.gats || []) { const r = rel(g.x, g.z); if (r.d > 45) continue;
      if (Math.random() < dt * 0.35) this.murmur(r.pan, r.d);
      if (Math.random() < dt * 0.08 * g.n) this.laugh(r.pan, r.d);
      if (g.perf && Math.random() < dt * 0.05) this.applause(r.pan, r.d, 1 + Math.random()); }
    // v2.5.27 balloons: a rubbery squeak now and then near a carrier
    for (const b of L.balloons || []) { const r = rel(b.x, b.z); if (r.d < 14 && Math.random() < dt * 0.12 * Math.min(3, b.n)) this.balloonSqueak(r.pan, r.d); }
    // performers
    for (const q of L.perf || []) { const r = rel(q.x, q.z); if (r.d > 50) continue;
      if (typeof q.inst === 'number') { const T = this._perfT || (this._perfT = {}); if ((T[q.id] = (T[q.id] ?? Math.random() * 0.3) - dt) <= 0) { this.note(q.inst, r.pan, r.d); T[q.id] = 0.24 + Math.random() * 0.22; } }
      else if (q.inst === 'juggle' && Math.random() < dt * 2.2) this.juggle(r.pan, r.d);
      if (q.watchers > 0 && Math.random() < dt * 0.06 * q.watchers) this.coins(r.pan, r.d); }
    if (L.lights > 0.35 && Math.random() < dt * 0.12 * L.lights) this.windowLife(0.55 + Math.random() * 0.3, L.lights);
  }
  // v2.5.1 / v2.5.2 sound test (SET > Ambience sounds)
  test(onStep) {
    if (!this.ctx) return;
    clearTimeout(this._testT);
    const c = this.ctx, steps = [
      ['crowd', () => { this.crowdBoostUntil = c.currentTime + 1.8; }],
      ['rain', () => { if (this.useSamples) this.testUntil.rain = c.currentTime + 1.5; else this.sweep(1.4, 'highpass', 1600, 2200, 0.07, this.ch.rain); }],
      ['wind', () => { if (this.useSamples) this.testUntil.wind = c.currentTime + 1.6; else this.sweep(1.5, 'bandpass', 300, 950, 0.16, this.ch.wind); }],
      ['gulls', () => { this.gull(-0.2, 20); }],
      ['bells', () => { this.play('bell'); setTimeout(() => this.play('wheels', { x: 2 }), 850); }], // v2.5.5 + blade / skate wheels
      ['cafe', () => { this.clink(); setTimeout(() => this.clink(), 260); setTimeout(() => this.clink(), 600); }],
      ['dogs', () => { this.bark(0.3, 6); }],
      ['steps', () => { for (let i = 0; i < 4; i++) setTimeout(() => this.footstep(false, false), i * 300); }],
      ['horns', () => { this.honk('tap', 14, -10, 0); setTimeout(() => this.honk('double', 18, -16, 1), 550); setTimeout(() => this.honk('long', 20, -24, 2), 1150); }],
      ['aircraft', () => { this.testUntil.aircraft = c.currentTime + 1.8; }],
      ['kites', () => { for (let i = 0; i < 5; i++) this.kiteFlap(-0.4, 8, 0.8, i * 0.12); this.kidLaugh(-0.4, 8, 0.7); }],
      ['gather', () => { this.murmur(0.3, 6); this.laugh(0.3, 6); setTimeout(() => this.applause(0.3, 6, 1.2), 600); }],
      ['bikes', () => { this.bikeSound('bell', 0.2, 3); setTimeout(() => this.bikeSound('esc', -0.2, 4), 600); setTimeout(() => this.bikeSound('dock', 0.1, 3), 1700); }],
      ['gym', () => { this.gymClank(0.2, 3); setTimeout(() => this.gymGrunt(-0.2, 3), 500); setTimeout(() => this.gymClank(0.1, 4), 1300); }],
      ['vendors', () => { this.vendorCall(0.2, 4, true); setTimeout(() => this.coolerLid(0.2, 3), 1200); }],
      ['icecream', () => { this._ice = null; for (let i = 0; i < 12; i++) setTimeout(() => this.iceTruck({ x: 0, z: -8, v: 0, jingle: true }, { x: 0, z: 0 }, { x: 1, z: 0 }), i * 160); }],
      ['balloons', () => { this.balloonSqueak(0.2, 3); setTimeout(() => this.balloonPop(-0.2, 3), 600); }],
      ['performers', () => { for (let i = 0; i < 6; i++) this.note(i % 6, 0.2, 5, i * 0.28); setTimeout(() => this.coins(0.2, 4), 1300); }],
      ['citywin', () => { this.windowLife(0.6, 1, true); this.windowLife(0.6, 1, true); }],
      ['traffic', () => { this.testUntil.traffic = c.currentTime + 1.7; this.traffic(null); this.whoosh(15, 16); setTimeout(() => this.whoosh(17, 12), 700); }],
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
    // v2.5.22: paused = music and ambience ducked well down (results screen keeps the old -4 dB)
    const duck = paused ? 0.4 : sim.state === 'over' ? 0.63 : 1;
    if (duck !== this.duckState) { this.duckState = duck; this.songBus.gain.setTargetAtTime(duck, t, 0.35); }
    const ad = paused ? 0.3 : 1;
    if (this.ambDuck && ad !== this.ambDuckState) { this.ambDuckState = ad; this.ambDuck.gain.setTargetAtTime(ad, t, 0.25); }
    this.songTick();
    const spd = running ? Math.min(1, sim.r.speed / 15) : 0;
    const g = Math.min(1.3, windGust(sim.r.z, sim.t) * (sim.chaos ? sim.chaos.gust : 1)), wnd = p.wind === undefined ? p.spray : p.wind; // v2.5.24 chaos gust
    const cl = t < this.crowdBoostUntil ? 1 : Math.max(0, Math.min(1, this.crowdLevel));
    if (this.useSamples) {
      const rainL = this.loops['rain-loop'], windL = this.loops['wind-loop'], crowdL = this.loops['crowd-chatter-loop'], gullL = this.loops['seagulls-loop'];
      const tr = t < this.testUntil.rain, tw = t < this.testUntil.wind;
      if (rainL) rainL.g.gain.setTargetAtTime(tr ? 0.7 : 0.62 * p.rain, t, tr ? 0.12 : 0.4);
      if (windL) {
        windL.g.gain.setTargetAtTime(tw ? 0.85 : 0.12 + 0.55 * wnd * (0.35 + 0.65 * g) + 0.1 * spd, t, tw ? 0.12 : 0.25);
        try { windL.src.playbackRate.setTargetAtTime(0.92 + 0.16 * g * wnd + 0.05 * spd, t, 0.4); } catch (e) { /* ignore */ }
      }
      if (crowdL) crowdL.g.gain.setTargetAtTime((0.18 + 0.55 * cl) * (1 - 0.45 * p.rain), t, 0.5);
      if (gullL) gullL.g.gain.setTargetAtTime(0.22 * Math.max(0, Math.min(1, this.gullBedLevel)), t, 0.6);
    } else {
      this.rain.g.gain.setTargetAtTime(0.26 * p.rain, t, 0.4);
      this.wind.g.gain.setTargetAtTime(0.04 + 0.22 * wnd * (0.35 + 0.65 * g) + 0.06 * spd, t, 0.25);
      this.wind.fl.frequency.setTargetAtTime(300 + 500 * spd + 350 * g * wnd + 120 * Math.sin(t * 0.37), t, 0.4);
      this.crowd.g.gain.setTargetAtTime((0.07 + 0.43 * cl) * (1 - 0.5 * p.rain), t, 0.5);
      this.talkers(t, cl);
    }
    if (!paused && this.cafeLevel > 0.05 && Math.random() < dt * 0.55 * this.cafeLevel) this.clink();
    // footsteps: wet for SEA SPRAY (0.4) and RAIN (1.0)
    const r = sim.r;
    if (running && r.ground && r.slideT <= 0) {
      const k = Math.floor(r.phase / Math.PI);
      if (this.lastK !== undefined && k !== this.lastK) this.footstep(p.wet >= 0.35, r.sprint);
      this.lastK = k;
    } else this.lastK = Math.floor(r.phase / Math.PI);
  }
}
