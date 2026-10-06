// Dynamic world state: GOLDEN -> SEA SPRAY -> RAIN -> CLEAR HAZE -> CLOUDY (v2.5.8) -> ... driven by sim time (deterministic).
import { clamp, smooth01 } from './config.js';

export const STATES = [
  { name: 'GOLDEN', verb: 'DUST', sub: 'late afternoon, long shadows',
    amb: [0.50, 0.40, 0.46], sun: [0.95, 0.64, 0.34], fog: [0.96, 0.63, 0.43], fogNear: 55, fogFar: 300,
    top: [0.26, 0.22, 0.46], hor: [1.0, 0.58, 0.30], sunCol: [1.0, 0.78, 0.46], sunSize: 1.0, cloud: 0.45,
    deep: [0.13, 0.22, 0.36], shallow: [0.36, 0.52, 0.55], glitter: 1.1, chop: 0.35, wet: 0.0, rain: 0, spray: 0.05, wind: 0.22, overcast: 0,
    window: [1.0, 0.72, 0.42], skyRefl: [0.98, 0.66, 0.45], sunRefl: [1.0, 0.75, 0.42], city: [0.55, 0.42, 0.45], echo: [0.48, 0.34, 1.0], lights: 0.5 },
  { name: 'SEA SPRAY', verb: 'WIND', sub: 'bright mist, wet surfaces',
    amb: [0.66, 0.70, 0.76], sun: [0.62, 0.60, 0.52], fog: [0.80, 0.87, 0.90], fogNear: 40, fogFar: 250,
    top: [0.33, 0.55, 0.80], hor: [0.86, 0.91, 0.93], sunCol: [1.0, 0.96, 0.86], sunSize: 0.7, cloud: 0.6,
    deep: [0.06, 0.30, 0.42], shallow: [0.30, 0.66, 0.68], glitter: 0.7, chop: 1.0, wet: 0.4, rain: 0, spray: 1, wind: 1.0, overcast: 0,
    window: [0.75, 0.85, 0.92], skyRefl: [0.86, 0.92, 0.95], sunRefl: [1.0, 0.97, 0.9], city: [0.62, 0.68, 0.74], echo: [0.30, 0.55, 1.0], lights: 0.0 },
  { name: 'RAIN', verb: 'SLICK', sub: 'reflections, puddles, moody lights',
    amb: [0.38, 0.42, 0.50], sun: [0.07, 0.07, 0.09], fog: [0.38, 0.42, 0.49], fogNear: 16, fogFar: 175,
    top: [0.15, 0.17, 0.23], hor: [0.42, 0.46, 0.52], sunCol: [0.5, 0.48, 0.45], sunSize: 0.1, cloud: 1.0,
    deep: [0.10, 0.16, 0.22], shallow: [0.24, 0.32, 0.36], glitter: 0.12, chop: 0.75, wet: 1.0, rain: 1, spray: 0.3, wind: 0.6, overcast: 0.35,
    window: [1.0, 0.86, 0.52], skyRefl: [0.55, 0.60, 0.68], sunRefl: [1.0, 0.82, 0.5], city: [0.28, 0.31, 0.37], echo: [0.40, 0.70, 1.0], lights: 1.0 },
  { name: 'CLEAR HAZE', verb: 'RECOVER', sub: 'soft light, distant city',
    amb: [0.68, 0.65, 0.62], sun: [0.42, 0.38, 0.32], fog: [0.86, 0.82, 0.76], fogNear: 28, fogFar: 215,
    top: [0.46, 0.56, 0.68], hor: [0.90, 0.86, 0.79], sunCol: [1.0, 0.92, 0.78], sunSize: 0.5, cloud: 0.25,
    deep: [0.16, 0.30, 0.40], shallow: [0.42, 0.58, 0.60], glitter: 0.45, chop: 0.3, wet: 0.15, rain: 0, spray: 0.1, wind: 0.18, overcast: 0,
    window: [0.9, 0.85, 0.75], skyRefl: [0.88, 0.85, 0.8], sunRefl: [1.0, 0.92, 0.8], city: [0.66, 0.66, 0.66], echo: [0.55, 0.40, 1.0], lights: 0.15 },
  // v2.5.8 CLOUDY: overcast grey sky (soft even light, sun hidden behind a moving cloud deck)
  { name: 'CLOUDY', verb: 'OVERCAST', sub: 'grey sky, soft even light',
    amb: [0.64, 0.65, 0.68], sun: [0.17, 0.17, 0.18], fog: [0.68, 0.70, 0.73], fogNear: 34, fogFar: 240,
    top: [0.47, 0.50, 0.55], hor: [0.76, 0.77, 0.79], sunCol: [0.92, 0.9, 0.86], sunSize: 0.12, cloud: 1.0,
    deep: [0.13, 0.21, 0.27], shallow: [0.33, 0.43, 0.46], glitter: 0.14, chop: 0.5, wet: 0.05, rain: 0, spray: 0.12, wind: 0.42, overcast: 1,
    window: [0.82, 0.84, 0.86], skyRefl: [0.70, 0.72, 0.76], sunRefl: [0.86, 0.86, 0.86], city: [0.50, 0.52, 0.56], echo: [0.45, 0.55, 1.0], lights: 0.7 },
];
const HOLD = 32, BLEND = 6;

export class WorldState {
  constructor() { this.reset(); this.p = {}; this.mix(); }
  // v2.5.24: each weather holds for `hold` s (32 by default; the chaos drift picks the next state's hold, 23..41 s,
  // when a change starts, so a weather never sticks and never flips back early)
  reset() { this.t = 0; this.idx = 0; this.prev = 0; this.k = 1; this.hold = HOLD; this.nextHold = HOLD; }
  next() { this.prev = this.idx; this.idx = (this.idx + 1) % STATES.length; this.t = 0; this.k = 0; this.hold = Math.min(45, Math.max(20, this.nextHold || HOLD)); }
  set(i) { this.prev = i; this.idx = i; this.t = 0; this.k = 1; this.mix(); }
  update(dt) {
    this.t += dt;
    if (this.k < 1) this.k = clamp(this.t / BLEND, 0, 1);
    if (this.t > this.hold + BLEND) this.next();
    this.mix();
  }
  mix() {
    const a = STATES[this.prev], b = STATES[this.idx], k = smooth01(this.k);
    for (const key of Object.keys(b)) {
      const va = a[key], vb = b[key];
      if (Array.isArray(vb)) this.p[key] = vb.map((v, i) => va[i] + (v - va[i]) * k);
      else if (typeof vb === 'number') this.p[key] = va + (vb - va) * k;
    }
    const cur = k > 0.5 ? b : a;
    this.name = cur.name; this.verb = cur.verb; this.sub = cur.sub;
  }
  get timeLeft() { return Math.max(0, this.hold + BLEND - this.t); }
}
