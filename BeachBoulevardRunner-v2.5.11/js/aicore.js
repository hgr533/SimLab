// Universal AI Core: one sense -> decide -> act brain shared by every promenade agent
// (walkers, joggers, leashed dogs, free dogs). Decisions are ternary: each agent resolves
// its lateral intent to -1 (step left), 0 (hold), +1 (step right) every sim step.
// Fully deterministic: seeded RNG, fixed dt, no wall clock.
// v2.5.4 critical-point crowd flow (all soft, Gaussian falloffs, no hard cut-offs):
//   SADDLE  ahead of the runner the crowd flows in along the running axis and out sideways: alert
//           people step away from the runner's line, weighted exp(-dx^2/0.8^2) * exp(-(dz-3.5)^2/4^2)
//           (v2.5.3: a hard 7 m x 0.9 m box). The deck edges (sea wall, bike path) push back softly,
//           so people coming off the bike-path side are turned back along the deck, not across it.
//   SINK    each cafe is a mild sink: walkers within ~10 m (along z) drift toward the cafe side of the
//           deck (at most 0.28 m/s) and the crowd spawns a little denser around cafes.
import { laneX, LANES, DECK_HALF, PERSON_R, DOG_R, MAX_PEOPLE, MAX_DOGS, CHUNK_LEN, clamp, damp, trit, heatSoft, heatInfo, gauss } from './config.js';
import { hash2, makeRng } from './rng.js';
import { nearestCrossing, gapOpen, CROSS_HALF } from './world.js';

export const KIND = { WALKER: 0, JOGGER: 1, DOG_LEASH: 2, DOG_FREE: 3 };
// cafes per chunk variant, [z offset from the chunk centre, width] (same layout as world.js / decor.js)
const CAFES = [[[-8, 12], [9, 11]], [[9, 10], [-9.5, 4]]];
// v2.5.4 cafe sink strength at z: Gaussian of the distance to the nearest cafe (0..1)
export function cafeSink(z) {
  const ci = Math.floor(-z / CHUNK_LEN); let g = 0;
  for (let i = ci - 1; i <= ci + 1; i++) {
    const v = Math.floor(hash2(i, 99) * 6), cz = -(i + 0.5) * CHUNK_LEN;
    for (const [zc, w] of CAFES[v % 2]) g = Math.max(g, gauss(z - (cz + zc), w * 0.5 + 4));
  }
  return g;
}
// v2.5.5 SEA SINK strength at x: Gaussian of the distance to the sea wall (x = -4.4), sigma 1.6 m.
// Only walkers already on the sea side feel it (about 0 by mid deck), so the crowd is not emptied.
// v2.5.7: bathers route through sea-wall crossing gaps (see nearestCrossing / gapOpen in world.js).
export function seaSink(x) { return gauss(x + DECK_HALF, 1.6); }
const SEA_LEAVE_GAP = 5; // seconds between walkers stepping down to the beach

// v2.5.6 FREE WILL (within the rules): every person has a persona that colours small choices made
// every few seconds (staggered, with cooldowns): change pace, pause and look around, wander to a
// spot, chat with someone nearby, or decide to go bathing. The deck bounds, the soft walls, the
// runner avoidance and the spawn fairness rules are untouched; choices use their own RNG stream.
export const PERSONA = ['chill', 'hurried', 'curious', 'social', 'beachy', 'sporty'];
// v: pace factor, pause / wander / sea / social: weights of those choices
const PP = [
  { v: 0.72, pause: 0.26, wander: 0.35, sea: 1.0, social: 0.5 },  // chill
  { v: 1.4, pause: 0.03, wander: 0.2, sea: 0.25, social: 0.1 },  // hurried
  { v: 0.92, pause: 0.3, wander: 0.6, sea: 1.0, social: 0.4 },    // curious
  { v: 0.95, pause: 0.14, wander: 0.35, sea: 0.8, social: 1.0 },  // social
  { v: 0.9, pause: 0.14, wander: 0.4, sea: 2.4, social: 0.4 },    // beachy
  { v: 1.12, pause: 0.05, wander: 0.3, sea: 0.6, social: 0.2 },   // sporty
];
const PERSONA_W = [0.22, 0.16, 0.16, 0.18, 0.18, 0.10];
const PERSONA_DRIFT = [2, 5, 0, 4, 3, 1]; // a rare change of mood moves to a related persona
const WALK_V = [0.6, 2.0], JOG_V = [2.2, 3.6];
const wrapA = (a) => Math.atan2(Math.sin(a), Math.cos(a));
const SPAWN_AHEAD = 175, SPAWN_MIN = 120;

function mkAgent(isDog) {
  return {
    dog: isDog, active: false, kind: 0, x: 0, z: 0, px: 0, pz: 0, vx: 0, vz: 0, dir: 1,
    targetX: 0, think: 0, phase: 0, rate: 8, amp: 0.5, owner: -1, pet: -1, side: 1,
    radius: isDog ? DOG_R : PERSON_R, alert: 0, color: 0, scale: 1,
    resolved: false, minGap: Infinity, minBottom: Infinity, hit: false, knock: 0, intent: 0,
  };
}

const smoothAlert = (al) => { const t = clamp((al - 0.3) / 0.3, 0, 1); return t * t * (3 - 2 * t); }; // soft version of v2.5.3's alert > 0.45

export class AICore {
  constructor(rng) {
    this.rng = rng;
    this.people = Array.from({ length: MAX_PEOPLE }, () => mkAgent(false));
    this.dogs = Array.from({ length: MAX_DOGS }, () => mkAgent(true));
    this.cursor = -60;
    this.peopleLimit = 40; this.dogLimit = 12;
    // v2.5.5: sea attraction (set by the sim from the weather) and walkers stepping down to the beach.
    // toBeach is a small event queue the renderer drains (decor turns them into beach goers / bathers).
    this.seaPull = 1; this.bathCd = 0; this.toBeach = [];
    // v2.5.6 free will: own deterministic stream (the spawn / layout sequence of the game RNG is unchanged)
    this.fr = makeRng((rng.next() * 4294967296) >>> 0);
    this.socialOn = 1; this.t = 0;
    this.will = { pause: 0, chat: 0, sea: 0, wander: 0, pace: 0, mood: 0, cross: 0 }; // decision counters (debug / tests)
  }
  setLimits(p, d) { this.peopleLimit = p; this.dogLimit = d; this.socialOn = p <= 22 ? 0.5 : 1; } // v2.5.6: LOW chats less
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
    const H = heatInfo(heatSoft(distance)); // v2.1: density, joggers and free dogs follow HEAT (v2.5.4: soft)
    const limit = Math.round(this.peopleLimit * H.density);
    const active = this.countActive(this.people);
    const gap = 150 / Math.max(6, limit);
    if (active >= limit) { this.cursor -= gap * 0.5; return; }
    const z = this.cursor;
    this.cursor -= gap * r.range(0.6, 1.4) * (1 - 0.25 * cafeSink(z)); // v2.5.4: denser around cafes (sink)
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
    this.initWill(a);
    // leashed dog
    if (a.kind === KIND.WALKER && r.chance(0.34) && this.countActive(this.dogs) < this.dogLimit) {
      const d = this.dogs.find((q) => !q.active);
      if (d) this.initDog(d, a, KIND.DOG_LEASH);
    } else if (r.chance(H.freeDog) && this.countActive(this.dogs) < this.dogLimit) {
      const d = this.dogs.find((q) => !q.active);
      if (d) { this.initDog(d, null, KIND.DOG_FREE); d.x = laneX(r.int(0, 4)); d.z = z - 6; d.px = d.x; d.pz = d.z; }
    }
  }
  // v2.5.6: persona, mood and the first decision time (free-will stream only)
  initWill(a) {
    const f = this.fr;
    if (a.kind === KIND.JOGGER) a.persona = f.chance(0.6) ? 5 : 1;
    else { let u = f.next(), k = 0; while (k < 5 && u > PERSONA_W[k]) { u -= PERSONA_W[k]; k++; } a.persona = k; }
    a.mood = f.next(); a.vbase = Math.abs(a.vz);
    const lim = a.kind === KIND.JOGGER ? JOG_V : WALK_V;
    a.vzT = a.dir * clamp(a.vbase * PP[a.persona].v * (0.9 + 0.2 * a.mood), lim[0], lim[1]); a.vz = a.vzT;
    a.will = f.range(0.8, 5); a.pause = 0; a.chat = -1; a.seaGoal = 0; a.crossZ = 0; a.look = 0; a.lookAmp = 0; a.lookPh = f.range(0, 6.28); a.seaCd = 0;
  }
  // v2.5.6: one decision (every 2.5 - 5.5 s per person, staggered)
  decide(a, i) {
    const f = this.fr, pp = PP[a.persona], W = this.will;
    a.will = f.range(2.5, 5.5) * (a.kind === KIND.JOGGER ? 1.5 : 1);
    a.mood = clamp(a.mood + f.range(-0.15, 0.15), 0, 1);
    if (f.chance(0.04)) { a.persona = a.kind === KIND.JOGGER ? (a.persona === 5 ? 1 : 5) : PERSONA_DRIFT[a.persona]; W.mood++; }
    const vmul = PP[a.persona].v * (0.9 + 0.2 * a.mood);
    if (a.kind === KIND.JOGGER) { a.vzT = a.dir * clamp(a.vbase * vmul * f.range(0.92, 1.08), JOG_V[0], JOG_V[1]); W.pace++; return; }
    if (a.pause > 0 || a.seaGoal > 0) return;
    const wSea = a.seaCd > 0 ? 0 : this.seaPull * pp.sea * seaSink(a.x) * 0.6;
    const wPause = pp.pause * (1.2 - 0.4 * a.mood), wSocial = pp.social * 0.35 * this.socialOn, wWander = pp.wander * 0.6, wPace = 0.5;
    let u = f.next() * (wSea + wPause + wSocial + wWander + wPace);
    if ((u -= wSea) < 0) { // go bathing: head for the nearest sea-wall crossing (v2.5.7), then step down
      a.seaGoal = f.range(10, 18); a.crossZ = nearestCrossing(a.z, a.dir); a.targetX = -DECK_HALF + 0.6; W.sea++;
    } else if ((u -= wPause) < 0) { // stop for a moment and look around
      a.pause = f.range(1.2, 3.2); a.lookAmp = f.range(0.4, 1.0); W.pause++;
    } else if ((u -= wSocial) < 0) { // someone similar close by: drift together for a short chat
      const P = this.people;
      for (let j = 0; j < P.length; j++) {
        const b = P[j];
        if (j === i || !b.active || b.kind !== KIND.WALKER || b.pause > 0 || b.seaGoal > 0 || Math.abs(b.z - a.z) > 3.5 || Math.abs(b.x - a.x) > 2.2) continue;
        const t = f.range(2, 4), mid = clamp((a.x + b.x) / 2, -DECK_HALF + 0.8, DECK_HALF - 0.8), s = a.x < b.x ? -1 : 1;
        a.chat = j; b.chat = i; a.pause = t; b.pause = t; a.targetX = mid + 0.35 * s; b.targetX = mid - 0.35 * s; W.chat++;
        break;
      }
    } else if ((u -= wWander) < 0) { // a small goal of their own somewhere across the deck
      a.targetX = clamp(a.x + f.range(-1.8, 1.8), -DECK_HALF + 0.5, DECK_HALF - 0.5); W.wander++;
    } else { // a little faster or slower (kept within walking pace)
      a.vzT = a.dir * clamp(a.vbase * vmul * f.range(0.85, 1.15), WALK_V[0], WALK_V[1]); W.pace++;
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
      // v2.5.6 FREE WILL: decide now and then; a pause or chat stops walking (sideways avoidance still works)
      a.will -= dt;
      if (a.will <= 0) this.decide(a, i);
      if (a.pause > 0) {
        a.pause -= dt;
        // someone standing in the runner's line who notices the runner coming cuts the pause short
        if (rdz > 0 && rdz < 9 && Math.abs(a.x - runner.x) < 1.1 && a.alert > 0.3) { a.pause = 0; if (a.chat >= 0) P[a.chat].pause = Math.min(P[a.chat].pause, 0.4); }
        if (a.pause <= 0) { a.chat = -1; a.lookAmp = 0; }
      }
      if (a.seaGoal > 0) {
        a.seaGoal -= dt;
        // v2.5.7: walk along to the chosen crossing, then through the gap (not over the curb)
        const dCross = a.crossZ - a.z;
        if (Math.abs(dCross) > CROSS_HALF * 0.85) {
          a.vzT = Math.sign(dCross || a.dir) * Math.max(0.95, Math.abs(a.vzT) * 0.9 + 0.15);
          a.targetX = clamp(Math.min(a.x, -DECK_HALF + 1.4), -DECK_HALF + 0.7, DECK_HALF - 0.5);
        } else {
          a.targetX = -DECK_HALF + 0.35; // through the opening
        }
        if (a.seaGoal <= 0) a.seaCd = 12; // changed their mind
      } else if (a.seaCd > 0) a.seaCd -= dt;
      // v2.5.4 SADDLE around the runner's line ahead: out along x, in along z (soft, alert people only)
      let tAvoid = 0;
      if (rdz > 0 && a.alert > 0.3) {
        const dxr = a.x - runner.x, side = dxr > 0.001 ? 1 : dxr < -0.001 ? -1 : (i % 2 ? 1 : -1);
        tAvoid = side * 1.25 * smoothAlert(a.alert) * gauss(dxr, 0.8) * gauss(rdz - 3.5, 4);
      }
      let tObs = 0;
      for (const o of obstacles) {
        if (!o.active) continue;
        const dz = (o.z - a.z) * a.dir;
        if (dz > -1 && dz < 5 && a.x > o.x0 - 0.5 && a.x < o.x1 + 0.5) { tObs = (a.x - o.x0) < (o.x1 - a.x) ? -1 : 1; break; }
      }
      a.think -= dt;
      if (a.think <= 0) { a.think = r.range(1.5, 4.5); if (r.chance(0.45) && !(a.seaGoal > 0) && !(a.chat >= 0)) a.targetX = clamp(a.x + r.range(-2, 2), -DECK_HALF + 0.5, DECK_HALF - 0.5); }
      const tWander = trit((a.targetX - a.x) / 0.5);
      // v2.5.4: soft walls at the sea wall and the bike-path edge (Gaussian, was a hard 0.4 m band)
      // v2.5.7: open the sea-wall push inside crossing gaps so walkers can step through
      const open = gapOpen(a.z);
      const tBound = gauss(a.x + DECK_HALF, 0.45) * (1 - open) - gauss(DECK_HALF - a.x, 0.45);
      // DECIDE (weighted ternary vote)
      const s = 3 * tBound + 2 * tObs + 1.2 * tSep + 1.0 * tAvoid + 0.6 * tWander;
      a.intent = trit(s);
      // ACT
      const lat = a.kind === KIND.JOGGER ? 1.4 : 0.9;
      // v2.5.4 cafe SINK: walkers near a cafe drift toward the cafe side of the deck (x about 3.4)
      const sink = a.kind === KIND.WALKER && a.x > -2 ? 0.28 * cafeSink(a.z) * clamp((3.4 - a.x) / 1.5, -1, 1) : 0;
      // v2.5.6: the v2.5.5 sea sink is now a CHOICE (its Gaussian weights the decision to go bathing)
      a.vx = damp(a.vx, a.intent * lat + sink, 5, dt);
      // v2.5.7: once lined up with a crossing, commit through the gap toward the beach
      if (a.seaGoal > 0 && Math.abs(a.z - a.crossZ) <= CROSS_HALF * 1.05) a.vx = damp(a.vx, -1.4, 6, dt);
      // pace follows the person's will; a pause eases to a stop, the walk cycle and stride follow the speed
      a.vz = damp(a.vz, a.pause > 0 ? 0 : a.vzT, 3, dt);
      const sp = Math.abs(a.vz);
      if (a.kind === KIND.WALKER) { a.rate = 6.5 * clamp(sp / 1.3, 0.35, 1.4); a.amp = damp(a.amp, a.pause > 0 ? 0.03 : 0.42 * clamp(sp / 1.2, 0.2, 1.15), 5, dt); }
      // look: face the chat partner, look around while paused, otherwise straight ahead
      let lk = 0;
      if (a.chat >= 0 && P[a.chat].active) { const b = P[a.chat]; lk = wrapA(Math.atan2(-(b.x - a.x), -(b.z - a.z)) - (a.dir > 0 ? Math.PI : 0)) * 0.8; }
      else if (a.pause > 0) lk = Math.sin(this.t * 0.9 + a.lookPh) * a.lookAmp;
      a.look = damp(a.look, lk, 4, dt);
      if (a.knock > 0) { a.knock -= dt; }
      // v2.5.7: allow a half-step into the gap when it is open (still clamped on solid curb)
      const xMin = -DECK_HALF + 0.2 - 0.55 * open;
      a.x = clamp(a.x + a.vx * dt, xMin, DECK_HALF - 0.2);
      a.z += a.vz * dt;
      a.phase += a.rate * dt;
      if (a.z > runner.z + 14) { a.active = false; if (a.pet >= 0) this.dogs[a.pet].active = false; a.pet = -1; if (a.chat >= 0) { P[a.chat].chat = -1; a.chat = -1; } }
      // v2.5.5 / v2.5.7: walkers step down to the beach only through a crossing gap, well ahead of the runner
      else if (a.kind === KIND.WALKER && a.seaGoal > 0 && a.pet < 0 && a.x < -3.6 && open > 0.45 && Math.abs(a.z - a.crossZ) < CROSS_HALF * 1.1 && rdz > 40 && this.bathCd <= 0 && this.seaPull > 0.3) {
        a.active = false; a.seaGoal = 0; this.bathCd = SEA_LEAVE_GAP; this.bathers = (this.bathers || 0) + 1;
        if (a.chat >= 0) { P[a.chat].chat = -1; P[a.chat].pause = Math.min(P[a.chat].pause, 0.5); }
        this.toBeach.push({ x: a.x, z: a.crossZ || a.z, color: a.color, scale: a.scale, persona: a.persona });
        if (this.toBeach.length > 12) this.toBeach.shift();
      }
    }
    if (this.bathCd > 0) this.bathCd -= dt;
    this.t += dt;
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
