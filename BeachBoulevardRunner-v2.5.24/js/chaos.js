// Beach Boulevard Runner v2.5.24 - chaos drift. A slow Lorenz attractor (sigma 10, rho 28, beta 8/3) integrated with
// a fixed RK4 step on the simulation clock (one step per sim tick, plain + - * / only, so it is bit-for-bit
// deterministic for a given seed). Its normalised, smoothed x / y / z gently modulate crowd density, wind and gusts,
// weather timing, sea pull (bathers) and road traffic. Amplitudes are modest (about +-15-25 %), so the boulevard still
// feels designed, but two seeds never drift the same way. Render-only consumers (palms, rain, sound, cars) read the
// same values, so what you see, hear and play agrees.
import { DT, clamp } from './config.js';
import { makeRng } from './rng.js';

export const LORENZ = { sigma: 10, rho: 28, beta: 8 / 3 };
export const CHAOS_RATE = 0.03; // Lorenz time units per game second (one lobe loop ~ 25 s, a few lobe switches per 2 km)
const SMOOTH_TAU = 3.0;         // s, exponential smoothing of the normalised signals
// modulation amplitudes (1 +- amp); weather hold in seconds
export const CHAOS_AMP = { crowd: 0.16, wind: 0.22, gust: 0.25, sea: 0.15, traffic: 0.15, holdMid: 32, holdAmp: 9 };

function deriv(x, y, z, o) {
  o[0] = LORENZ.sigma * (y - x);
  o[1] = x * (LORENZ.rho - z) - y;
  o[2] = x * y - LORENZ.beta * z;
}

export class ChaosDrift {
  constructor(seed) { this.k1 = [0, 0, 0]; this.k2 = [0, 0, 0]; this.k3 = [0, 0, 0]; this.k4 = [0, 0, 0]; this.reset(seed); }
  reset(seed) {
    const r = makeRng(((seed | 0) ^ 0x6c8e9cf5) >>> 0);
    this.x = r.range(-12, 12); this.y = r.range(-12, 12); this.z = r.range(12, 36);
    for (let i = 0; i < 1200; i++) this.rk4(0.01); // settle onto the attractor (12 Lorenz time units)
    this.t = 0;
    this.norm();
    this.sx = this.nx; this.sy = this.ny; this.sz = this.nz;
    this.map();
  }
  rk4(h) {
    const { k1, k2, k3, k4 } = this, x = this.x, y = this.y, z = this.z;
    deriv(x, y, z, k1);
    deriv(x + 0.5 * h * k1[0], y + 0.5 * h * k1[1], z + 0.5 * h * k1[2], k2);
    deriv(x + 0.5 * h * k2[0], y + 0.5 * h * k2[1], z + 0.5 * h * k2[2], k3);
    deriv(x + h * k3[0], y + h * k3[1], z + h * k3[2], k4);
    this.x = x + h / 6 * (k1[0] + 2 * k2[0] + 2 * k3[0] + k4[0]);
    this.y = y + h / 6 * (k1[1] + 2 * k2[1] + 2 * k3[1] + k4[1]);
    this.z = z + h / 6 * (k1[2] + 2 * k2[2] + 2 * k3[2] + k4[2]);
  }
  // normalised to about -1..1 (attractor ranges: x +-20, y +-27, z 1..49)
  norm() { this.nx = clamp(this.x / 18, -1, 1); this.ny = clamp(this.y / 24, -1, 1); this.nz = clamp((this.z - 23.5) / 15, -1, 1); }
  // one simulation tick (DT); only called while a run is going, so it follows the sim clock exactly
  step() {
    this.rk4(CHAOS_RATE * DT);
    this.t += DT;
    this.norm();
    const a = DT / SMOOTH_TAU;
    this.sx += (this.nx - this.sx) * a; this.sy += (this.ny - this.sy) * a; this.sz += (this.nz - this.sz) * a;
    this.map();
  }
  map() {
    const A = CHAOS_AMP, sx = this.sx, sy = this.sy, sz = this.sz;
    this.crowd = 1 + A.crowd * sx;                                  // share of the HEAT crowd target (never above the preset cap)
    this.wind = 1 + A.wind * sy;                                    // breeze strength (palms, rain slant, wind sound)
    this.gust = 1 + A.gust * sz;                                    // gust strength (palm gust bend, sea spray push, wind swells)
    this.sea = 1 + A.sea * clamp(-0.6 * sy + 0.4 * sz, -1, 1);      // sea pull: more / fewer walkers go bathing
    this.traffic = 1 + A.traffic * clamp(0.7 * sx - 0.3 * sz, -1, 1); // road traffic density (car spacing)
    this.hold = A.holdMid + A.holdAmp * clamp(0.5 * sx + 0.5 * sz, -1, 1); // seconds the next weather holds (23..41)
  }
}
