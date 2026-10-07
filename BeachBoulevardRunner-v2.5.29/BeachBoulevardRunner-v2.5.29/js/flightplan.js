// v2.5.26 aircraft flight plans (pure, no three.js): small plane every 13 s along the shore, a helicopter on the
// same route 2.4 s behind it, a big airliner every 15 s coming in from the sea across the boulevard.
// Cosmetic only. Every pass draws its own parameters from a per-pass seeded RNG (makeRng(hash of kind + pass
// index)), so nothing ever touches the sim's RNG stream (the determinism hash is unchanged) and pass k always
// gets the same route / colours. Timing runs on the sim clock (sim.t): it pauses with the game.
import { makeRng } from './rng.js';

export const PLANE_EVERY = 13, HELI_LAG = 2.4, JET_EVERY = 15;
export const PLANE_FIRST = 3, JET_FIRST = 6;     // s after the run starts
export const PLANE_DUR = 15, JET_DUR = 19;       // s a pass stays alive (then it is far off / out of sight)

// livery palettes: [body, accent] pairs, varied per pass (body + accent + trim drawn independently)
export const BODY = [0xf4f4f0, 0xd8202a, 0x1f5fbf, 0xf2c018, 0x2a9d6a, 0xff7a1a, 0x7a3fb0, 0x13a3b8, 0x2b2f38, 0xe85d9a, 0xc9ced6, 0x0f3d75];
export const ACCENT = [0xd8202a, 0x1f5fbf, 0xf2c018, 0x111418, 0xffffff, 0x2a9d6a, 0xff7a1a, 0x13a3b8, 0x7a3fb0, 0xe85d9a];
export const JET_BODY = [0xf7f7f5, 0xeef1f6, 0x1d3f8f, 0xc8102e, 0x2b2f38, 0xf4f4f0, 0x006b5a, 0xfafafa, 0x5b2a86, 0xd9a400];
const seedOf = (kind, k) => (Math.imul(k + 1, 0x9E3779B1) ^ Math.imul(kind + 7, 0x85EBCA6B) ^ 0x2526) >>> 0;
function livery(R, bodies) {
  const b = R.int(0, bodies.length - 1); let a = R.int(0, ACCENT.length - 1);
  if (ACCENT[a] === bodies[b]) a = (a + 3) % ACCENT.length;
  return { body: bodies[b], accent: ACCENT[a], trim: ACCENT[R.int(0, ACCENT.length - 1)] };
}

// small plane pass k (the heli of pass k reuses the same route with its own colours, 2.4 s later)
// rz0 / vr: runner z and speed when the pass starts (the runner runs toward -z; the sea is at -x)
export function planePlan(k, rz0, vr) {
  const R = makeRng(seedOf(1, k));
  const dir = R.chance(0.72) ? 1 : -1;             // +1 comes toward the runner from far ahead, -1 overtakes from behind
  const shoreX = R.range(-75, -14);                // over the waterline (-45) .. the dry sand by the sea wall
  const alt = R.range(40, 70), v = R.range(36, 52);
  const drift = R.range(-0.09, 0.09), wob = R.range(0, 14), wf = R.range(0.004, 0.012), wph = R.range(0, 6.28);
  const z0 = dir > 0 ? rz0 - R.range(430, 560) : rz0 + R.range(150, 200);
  const heliAlt = Math.max(28, alt - R.range(8, 16));
  const L = livery(R, BODY), H = livery(makeRng(seedOf(2, k)), BODY);
  return { k, t0: PLANE_FIRST + k * PLANE_EVERY, dir, shoreX, alt, v, drift, wob, wf, wph, z0, heliAlt, plane: L, heli: H };
}
// position along the route s seconds after its own start (same route for the plane and its heli)
export function routeAt(p, s, out, heli) {
  const d = p.v * s, z = p.z0 + p.dir * d;
  out.x = p.shoreX + p.drift * d + p.wob * Math.sin(d * p.wf + p.wph);
  out.y = (heli ? p.heliAlt : p.alt) + 2.5 * Math.sin(d * 0.006 + p.wph * 2);
  out.z = z;
  const dx = p.drift + p.wob * p.wf * Math.cos(d * p.wf + p.wph);
  out.vx = dx * p.v; out.vz = p.dir * p.v; out.vy = 0;
  out.bank = -p.dir * p.wob * p.wf * p.wf * Math.sin(d * p.wf + p.wph) * p.v * p.v * 0.02;
  return out;
}

// airliner pass j: from the sea (-x), across the boulevard at a varied heading; closest approach to where the
// runner will be after tIn s, at a varied lateral offset (right overhead / off to one side / far away), altitude, speed
export function jetPlan(j, rx0, rz0, vr) {
  const R = makeRng(seedOf(3, j));
  const th = R.range(0.5, 1.15) * (R.chance(0.8) ? 1 : -1); // heading off the +x axis: + comes from ahead, - from behind
  const v = R.range(60, 85), alt = R.range(75, 130), tIn = R.range(7, 9.5);
  const u = R.next();
  const band = u < 0.35 ? 'overhead' : u < 0.75 ? 'side' : 'far';
  const off = (band === 'overhead' ? R.range(-12, 12) : band === 'side' ? R.range(30, 90) : R.range(110, 220)) * (R.chance(0.5) ? 1 : -1);
  const dx = Math.cos(th), dz = Math.sin(th);
  const cx = rx0 * 0.4 - dz * off, cz = rz0 - vr * tIn + dx * off; // closest approach point (perpendicular offset)
  return { j, t0: JET_FIRST + j * JET_EVERY, th, v, alt, tIn, band, off, dx, dz, cx, cz, liv: livery(R, JET_BODY) };
}
export function jetAt(p, s, out) {
  const d = (s - p.tIn) * p.v;
  out.x = p.cx + p.dx * d; out.z = p.cz + p.dz * d; out.y = p.alt + Math.max(0, -d) * 0.02; // slight descent toward land
  out.vx = p.dx * p.v; out.vz = p.dz * p.v; out.vy = -0.02 * p.v * (d < 0 ? 1 : 0); out.bank = 0;
  return out;
}
// pass indices alive at sim time t
export function alive(t, first, every, dur) {
  const out = []; if (t < first) return out;
  const last = Math.floor((t - first) / every);
  for (let k = Math.max(0, last - Math.ceil(dur / every)); k <= last; k++) { const s = t - (first + k * every); if (s >= 0 && s < dur) out.push(k); }
  return out;
}
