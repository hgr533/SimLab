// Universal AI Core: one sense -> decide -> act brain shared by every promenade agent
// (walkers, joggers, leashed dogs, free dogs). Decisions are ternary: each agent resolves
// its lateral intent to -1 (step left), 0 (hold), +1 (step right) every sim step.
// Fully deterministic: seeded RNG, fixed dt, no wall clock.
import { laneX, LANES, DECK_HALF, PERSON_R, DOG_R, MAX_PEOPLE, MAX_DOGS, clamp, damp, trit, heatAt, heatInfo } from './config.js';

export const KIND = { WALKER: 0, JOGGER: 1, DOG_LEASH: 2, DOG_FREE: 3 };
const SPAWN_AHEAD = 175, SPAWN_MIN = 120;

function mkAgent(isDog) {
  return {
    dog: isDog, active: false, kind: 0, x: 0, z: 0, px: 0, pz: 0, vx: 0, vz: 0, dir: 1,
    targetX: 0, think: 0, phase: 0, rate: 8, amp: 0.5, owner: -1, pet: -1, side: 1,
    radius: isDog ? DOG_R : PERSON_R, alert: 0, color: 0, scale: 1,
    resolved: false, minGap: Infinity, minBottom: Infinity, hit: false, knock: 0, intent: 0,
  };
}

export class AICore {
  constructor(rng) {
    this.rng = rng;
    this.people = Array.from({ length: MAX_PEOPLE }, () => mkAgent(false));
    this.dogs = Array.from({ length: MAX_DOGS }, () => mkAgent(true));
    this.cursor = -60;
    this.peopleLimit = 40; this.dogLimit = 12;
  }
  setLimits(p, d) { this.peopleLimit = p; this.dogLimit = d; }
  reset(runnerZ) {
    for (const a of this.people) a.active = false;
    for (const a of this.dogs) a.active = false;
    this.cursor = runnerZ - 22;
    // pre-populate the first stretch so the boulevard is alive at start
    for (let i = 0; i < 400 && this.cursor > runnerZ - SPAWN_AHEAD; i++) this.spawnOne(runnerZ, [], 0);
  }
  countActive(arr) { let n = 0; for (const a of arr) if (a.active) n++; return n; }

  laneBusy(z, obstacles) {
    const busy = new Array(LANES).fill(false);
    for (const a of this.people) if (a.active && Math.abs(a.z - z) < 3.2) busy[clamp(Math.round(a.x / 1.6 + 2), 0, LANES - 1)] = true;
    for (const o of obstacles) if (o.active && Math.abs(o.z - z) < 8) for (let l = o.l0; l <= o.l1; l++) busy[l] = true;
    return busy;
  }

  spawnOne(runnerZ, obstacles, distance) {
    const r = this.rng;
    const H = heatInfo(heatAt(distance)); // v2.1: density, joggers and free dogs follow the HEAT tier
    const limit = Math.round(this.peopleLimit * H.density);
    const active = this.countActive(this.people);
    const gap = 150 / Math.max(6, limit);
    if (active >= limit) { this.cursor -= gap * 0.5; return; }
    const z = this.cursor;
    this.cursor -= gap * r.range(0.6, 1.4);
    const busy = this.laneBusy(z, obstacles);
    const free = []; for (let l = 0; l < LANES; l++) if (!busy[l]) free.push(l);
    if (free.length < 3) return; // fairness: never close a row
    const lane = r.pick(free);
    const a = this.people.find((p) => !p.active);
    if (!a) return;
    const roll = r.next();
    a.active = true; a.resolved = false; a.hit = false; a.minGap = Infinity; a.minBottom = Infinity; a.knock = 0;
    a.x = laneX(lane) + r.range(-0.3, 0.3); a.z = z; a.px = a.x; a.pz = a.z; a.vx = 0;
    a.targetX = a.x; a.think = r.range(0.5, 3); a.phase = r.range(0, 6.28);
    a.alert = r.next(); a.color = r.int(0, 11); a.scale = r.range(0.92, 1.08); a.pet = -1;
    if (roll < H.jogger) { a.kind = KIND.JOGGER; a.dir = -1; a.vz = -r.range(2.4, 3.2); a.rate = 11; a.amp = 0.75; }
    else { a.kind = KIND.WALKER; a.dir = r.chance(0.62) ? 1 : -1; a.vz = a.dir * r.range(1.0, 1.6); a.rate = 6.5; a.amp = 0.42; }
    // leashed dog
    if (a.kind === KIND.WALKER && r.chance(0.34) && this.countActive(this.dogs) < this.dogLimit) {
      const d = this.dogs.find((q) => !q.active);
      if (d) this.initDog(d, a, KIND.DOG_LEASH);
    } else if (r.chance(H.freeDog) && this.countActive(this.dogs) < this.dogLimit) {
      const d = this.dogs.find((q) => !q.active);
      if (d) { this.initDog(d, null, KIND.DOG_FREE); d.x = laneX(r.int(0, 4)); d.z = z - 6; d.px = d.x; d.pz = d.z; }
    }
  }
  initDog(d, owner, kind) {
    const r = this.rng;
    d.active = true; d.kind = kind; d.resolved = false; d.hopped = false; d.hit = false; d.minGap = Infinity; d.minBottom = Infinity; d.knock = 0;
    d.owner = owner ? this.people.indexOf(owner) : -1;
    if (owner) { owner.pet = this.dogs.indexOf(d); d.dir = owner.dir; d.x = owner.x + 0.6; d.z = owner.z + owner.dir * 0.9; }
    else { d.dir = r.chance(0.5) ? 1 : -1; }
    d.px = d.x; d.pz = d.z; d.vx = 0; d.vz = d.dir * 1.3;
    d.side = r.chance(0.5) ? 1 : -1; d.think = r.range(0.4, 1.5); d.phase = r.range(0, 6.28);
    d.color = r.int(0, 7); d.scale = r.range(0.8, 1.25); d.rate = 12; d.amp = 0.6;
  }

  // ---------- sense / decide / act ----------
  step(dt, runner, obstacles, distance) {
    const r = this.rng;
    const P = this.people;
    for (let i = 0; i < P.length; i++) {
      const a = P[i];
      if (!a.active) continue;
      a.px = a.x; a.pz = a.z;
      // SENSE
      let tSep = 0;
      for (let j = 0; j < P.length; j++) {
        if (j === i || !P[j].active) continue;
        const b = P[j];
        const dz = (b.z - a.z) * a.dir;
        if (dz > 0 && dz < 2.4 && Math.abs(b.x - a.x) < 0.7) { tSep = trit(a.x - b.x + (i % 2 ? 0.01 : -0.01), -0.0001, 0.0001); break; }
      }
      const rdz = (runner.z - a.z); // runner ahead of agent in -z; runner approaches from +z side
      let tAvoid = 0;
      if (a.alert > 0.45 && rdz > 0 && rdz < 7 && Math.abs(runner.x - a.x) < 0.9) tAvoid = a.x >= runner.x ? 1 : -1;
      let tObs = 0;
      for (const o of obstacles) {
        if (!o.active) continue;
        const dz = (o.z - a.z) * a.dir;
        if (dz > -1 && dz < 5 && a.x > o.x0 - 0.5 && a.x < o.x1 + 0.5) { tObs = (a.x - o.x0) < (o.x1 - a.x) ? -1 : 1; break; }
      }
      a.think -= dt;
      if (a.think <= 0) { a.think = r.range(1.5, 4.5); if (r.chance(0.45)) a.targetX = clamp(a.x + r.range(-2, 2), -DECK_HALF + 0.5, DECK_HALF - 0.5); }
      const tWander = trit((a.targetX - a.x) / 0.5);
      const tBound = a.x < -DECK_HALF + 0.4 ? 1 : a.x > DECK_HALF - 0.4 ? -1 : 0;
      // DECIDE (weighted ternary vote)
      const s = 3 * tBound + 2 * tObs + 1.2 * tSep + 1.0 * tAvoid + 0.6 * tWander;
      a.intent = trit(s);
      // ACT
      const lat = a.kind === KIND.JOGGER ? 1.4 : 0.9;
      a.vx = damp(a.vx, a.intent * lat, 5, dt);
      if (a.knock > 0) { a.knock -= dt; }
      a.x = clamp(a.x + a.vx * dt, -DECK_HALF + 0.2, DECK_HALF - 0.2);
      a.z += a.vz * dt;
      a.phase += a.rate * dt;
      if (a.z > runner.z + 14) { a.active = false; if (a.pet >= 0) this.dogs[a.pet].active = false; a.pet = -1; }
    }
    const D = this.dogs;
    for (let i = 0; i < D.length; i++) {
      const d = D[i];
      if (!d.active) continue;
      d.px = d.x; d.pz = d.z;
      d.think -= dt;
      if (d.kind === KIND.DOG_LEASH) {
        const o = P[d.owner];
        if (!o || !o.active) { d.active = false; continue; }
        if (d.think <= 0) { d.think = r.range(0.6, 2.2); d.side = r.chance(0.3) ? -d.side : d.side; d.sniff = r.chance(0.25) ? 1.2 : 0.55; }
        const tx = o.x + d.side * (d.sniff || 0.55), tz = o.z + o.dir * 1.0;
        d.intent = trit((tx - d.x) / 0.25);
        d.vx = damp(d.vx, d.intent * 1.6, 6, dt);
        d.x += d.vx * dt;
        d.z = damp(d.z, tz, 4, dt);
        const lx = d.x - o.x, lz = d.z - o.z, L = Math.hypot(lx, lz);
        if (L > 1.7) { d.x = o.x + lx / L * 1.7; d.z = o.z + lz / L * 1.7; }
        d.rate = 9 + Math.abs(o.vz) * 3;
      } else {
        if (d.think <= 0) { d.think = r.range(0.5, 1.1); d.intent = d.intent === 1 ? -1 : d.intent === -1 ? 1 : (r.chance(0.5) ? 1 : -1); }
        if (d.x < -DECK_HALF + 0.5) d.intent = 1; else if (d.x > DECK_HALF - 0.5) d.intent = -1;
        d.vx = damp(d.vx, d.intent * 2.2, 5, dt);
        d.x += d.vx * dt; d.z += d.dir * 2.4 * dt; d.rate = 15;
      }
      d.x = clamp(d.x, -DECK_HALF + 0.2, DECK_HALF - 0.2);
      d.phase += d.rate * dt;
      if (d.z > runner.z + 14) d.active = false;
    }
    // stream new agents ahead
    if (this.cursor < runner.z - SPAWN_AHEAD - 40) this.cursor = runner.z - SPAWN_AHEAD;
    if (this.cursor > runner.z - SPAWN_MIN) this.cursor = runner.z - SPAWN_MIN;
    let guard = 0;
    while (this.cursor > runner.z - SPAWN_AHEAD && guard++ < 8) this.spawnOne(runner.z, obstacles, distance);
  }
}
