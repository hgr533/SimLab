// Beach Boulevard Runner v2.4 - shared constants, quality presets and the HEAT difficulty ramp.
export const SIM_HZ = 60;
export const DT = 1 / SIM_HZ;
export const MAX_STEPS = 5;

export const LANES = 5;
export const LANE_W = 1.6;
export const laneX = (i) => (i - (LANES - 1) / 2) * LANE_W;
export const DECK_HALF = 4.4;

export const CHUNK_LEN = 40;
export const SEED = 20261002;

export const RUNNER_R = 0.28;
export const PERSON_R = 0.28;
export const DOG_R = 0.3;

// Sun direction (towards the sun): low in the west over the sea, slightly ahead.
export const SUN_DIR = [-0.62, 0.2, -0.76];

export const PRESET_NAMES = ['LOW', 'MEDIUM', 'HIGH', 'ULTRA'];

// All presets keep: instancing, chunk culling, no shadow map, no post pass, no extra targets.
export const PRESETS = {
  LOW: {
    name: 'LOW', pixelRatio: (dpr) => Math.min(dpr, 1) * 0.65, antialias: false,
    people: 22, dogs: 6, lod0: 45, chunksAhead: 5, fogScale: 0.72, far: 220,
    rain: 220, spray: 120, echoes: 6, echoEvery: 0.1, rich: false, tex: 256,
    glare: false, reflect: false, clouds: false, seaSeg: 24, rings: true, leash: true,
  },
  MEDIUM: {
    name: 'MEDIUM', pixelRatio: (dpr) => Math.min(dpr, 1), antialias: false,
    people: 38, dogs: 11, lod0: 70, chunksAhead: 7, fogScale: 0.86, far: 290,
    rain: 420, spray: 220, echoes: 8, echoEvery: 0.08, rich: false, tex: 512,
    glare: false, reflect: true, clouds: true, seaSeg: 40, rings: true, leash: true,
  },
  HIGH: {
    name: 'HIGH', pixelRatio: (dpr) => Math.min(dpr, 2), antialias: true,
    people: 60, dogs: 18, lod0: 100, chunksAhead: 9, fogScale: 1.0, far: 380,
    rain: 750, spray: 360, echoes: 12, echoEvery: 0.06, rich: true, tex: 1024,
    glare: true, reflect: true, clouds: true, seaSeg: 64, rings: true, leash: true,
  },
  ULTRA: {
    name: 'ULTRA', pixelRatio: (dpr) => Math.min(dpr, 3), antialias: true,
    people: 80, dogs: 26, lod0: 140, chunksAhead: 11, fogScale: 1.22, far: 470,
    rain: 1100, spray: 520, echoes: 16, echoEvery: 0.045, rich: true, tex: 1024,
    glare: true, reflect: true, clouds: true, seaSeg: 96, rings: true, leash: true,
  },
};
export const MAX_PEOPLE = 80;
export const MAX_DOGS = 26;
export const MAX_ECHOES = 16;

export const PRESET_KEY = 'bbr2-preset';
export const BEST_KEY = 'bbr2-best';
export const STATS_KEY = 'bbr21-stats';
export const OPT_KEY = 'bbr21-opts';
export const VERSION = 'v2.4';

// HEAT: the boulevard gets busier every HEAT_LEN metres. Everything that scales with HEAT
// reads from heatInfo() so the sim, the AI core and the HUD always agree.
export const HEAT_LEN = 450;
export const HEAT_MAX = 7;
export function heatAt(distance) { return Math.min(HEAT_MAX, 1 + Math.floor(Math.max(0, distance) / HEAT_LEN)); }
export function heatInfo(h) {
  const k = h - 1;
  return {
    mul: 1 + 0.2 * k,                 // score multiplier
    speed: 0.3 * k,                   // added base speed (m/s)
    density: Math.min(1, 0.5 + 0.1 * k), // share of the preset crowd limit
    jogger: 0.16 + 0.03 * k,          // joggers run against you, harder to read
    freeDog: 0.05 + 0.02 * k,
    obsGap: 1 / (1 + 0.12 * k),       // obstacle spacing factor
    combo: k >= 2 ? Math.min(0.45, 0.15 + 0.06 * (k - 2)) : 0, // chance of a slide+hurdle pair
    regen: Math.max(0.55, 1 - 0.07 * k), // stamina regen factor
    hit: 22 + 3 * k,                  // stamina lost per contact
  };
}
export const HEAT_TEXT = ['', 'warm-up', 'evening walkers', 'joggers out', 'rush hour', 'packed promenade', 'festival crowd', 'boulevard chaos'];

export function clamp(v, a, b) { return v < a ? a : v > b ? b : v; }
export function lerp(a, b, t) { return a + (b - a) * t; }
export function damp(cur, target, rate, dt) { return target + (cur - target) * Math.exp(-rate * dt); }
export function smooth01(t) { t = clamp(t, 0, 1); return t * t * (3 - 2 * t); }
// v2.2 wind gusts: a gust wave travelling down the boulevard (towards -z) at GUST_SPEED m/s.
// The same function drives the palm sway shader (GLSL copy in materials.js), the SEA SPRAY
// crosswind push in the sim and the wind sound, so what you see, feel and hear lines up.
export const GUST_SPEED = 18;
export function windGust(z, t) {
  const u = z + t * GUST_SPEED;
  const a = 0.5 + 0.5 * Math.sin(u * 0.0898);
  return a * a * a * a * a * a * (0.55 + 0.45 * Math.sin(u * 0.031 + 1.7));
}
// Ternary helper used by the line core and the AI core.
export function trit(x, lo = -0.5, hi = 0.5) { return x >= hi ? 1 : x <= lo ? -1 : 0; }
