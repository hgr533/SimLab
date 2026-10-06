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
import { plazaSink, restoSink, plazaCafeNear, restoNear, beachSiteHit, beachBusy, groundY, crossingsNear, binsNear, BIN_X, BIN_STAND_X } from './places.js';

export const KIND = { WALKER: 0, JOGGER: 1, DOG_LEASH: 2, DOG_FREE: 3 };
// v2.5.18 cafe SINK now follows the real eateries (plaza glass cafes on the bike side, beach restaurants
// on the sea side; both from places.js, shared with the renderer). 0..1 Gaussian, sigma 9 m along z.
export function cafeSink(z) { return Math.max(plazaSink(z), restoSink(z)); }
// v2.5.5 SEA SINK strength at x: Gaussian of the distance to the sea wall (x = -4.4), sigma 1.6 m.
// Only walkers already on the sea side feel it (about 0 by mid deck), so the crowd is not emptied.
// v2.5.7: bathers route through sea-wall crossing gaps (see nearestCrossing / gapOpen in world.js).
export function seaSink(x) { return gauss(x + DECK_HALF, 1.6); }
const SEA_LEAVE_GAP = 5; // seconds between walkers stepping down to the beach
const VISIT_GAP = 3.5, VISIT_LIFE = 45; // v2.5.18: seconds between eatery hand-overs / assumed visit length
// v2.5.20 DOG WALKERS ON THE SAND: an owner with a leashed dog may choose (free will, persona + mood, less in
// bad weather) to go down through a sea-wall crossing, stroll the dry sand by the palms or the shoreline,
// and come back up through another crossing. Routes keep clear of restaurants (incl. their terrace paths),
// volleyball / football courts and matkot pitches (places.js), and prefer gaps without umbrellas.
// Owner + dog stay sim agents the whole time (same leash, same leash-hop rules), so it is all deterministic.
const DOG_BEACH = [1.6, 0.12, 1.2, 0.8, 2.6, 0.9];        // decision weight per persona (chill .. sporty)
const DOG_SEED = [0.3, 0.02, 0.2, 0.12, 0.45, 0.15];      // share already on a beach walk when they appear
const LANE_SHORE = -43.9, LANE_DRY = -8.15, WALL_OUT = -5.3, DECK_IN = -3.7;
// v2.5.21 picking up after the dog: a leashed dog squats now and then (60-120 s), the owner bags it and
// bins it (bins by every crossing, 'reasonable distance' = BIN_REACH), droppings are a small sim pool
const POOP_EVERY = [60, 120], MAX_DROPS = 24, BIN_REACH = 26;

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
    bch: 0, wp: null, wi: 0, y: 0, hd: undefined, // v2.5.20 beach walk state (0 none, 1 heading for a gap, 2 on the sand)
    chore: 0, choreT: 0, bag: 0, crouch: 0, drop: -1, binZ: 0, binCd: 0, bagCol: 0, squat: 0, poopT: 1e9, // v2.5.21 pickup
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
    // v2.5.18: eatery visits (toVisit queue -> decor visitors); visitMax = renderer pool share (preset constant)
    this.toVisit = []; this.visitCd = 0; this.visitMax = 3; this.visitLive = [];
    // v2.5.6 free will: own deterministic stream (the spawn / layout sequence of the game RNG is unchanged)
    this.fr = makeRng((rng.next() * 4294967296) >>> 0);
    this.socialOn = 1; this.t = 0;
    this.will = { pause: 0, chat: 0, sea: 0, wander: 0, pace: 0, mood: 0, cross: 0, visit: 0, visitIn: 0 }; // decision counters (debug / tests)
    this.dogWalk = { decide: 0, noRoute: 0, down: 0, up: 0, seeded: 0, gone: 0, stuck: 0, gaveUp: 0 }; // v2.5.20 beach dog walks
    // v2.5.21: droppings pool (rendered instanced) + pickup counters (tests / debug)
    this.drops = Array.from({ length: MAX_DROPS }, () => ({ on: false, x: 0, y: 0, z: 0, owner: -1, rot: 0, s: 1 }));
    this.poop = { squat: 0, deck: 0, sand: 0, dropped: 0, picked: 0, toBin: 0, binned: 0, binGiveUp: 0, carriedOff: 0, leftBehind: 0, stuck: 0, lost: 0, poolFull: 0, citizen: 0 };
  }
  setLimits(p, d) { this.peopleLimit = p; this.dogLimit = d; this.socialOn = p <= 22 ? 0.5 : 1; } // v2.5.6: LOW chats less
  reset(runnerZ) {
    for (const a of this.people) { a.active = false; a.bch = 0; a.wp = null; a.hd = undefined; a.y = 0; a.chore = 0; a.bag = 0; a.crouch = 0; a.drop = -1; }
    for (const a of this.dogs) { a.active = false; a.hd = undefined; a.y = 0; a.squat = 0; }
    for (const q of this.drops) q.on = false;
    this.cursor = runnerZ - 22;
    // pre-populate the first stretch so the boulevard is alive at start
    for (let i = 0; i < 400 && this.cursor > runnerZ - SPAWN_AHEAD; i++) this.spawnOne(runnerZ, [], 0);
  }
  countActive(arr) { let n = 0; for (const a of arr) if (a.active) n++; return n; }
  // v2.5.20: deck density / dog limits ignore owners + dogs out on the sand (the deck crowd is unchanged)
  countDeck(arr) { let n = 0; for (const a of arr) if (a.active && !(a.dog ? this.onSand(a) : a.bch === 2)) n++; return n; }
  onSand(d) { const o = d.owner >= 0 ? this.people[d.owner] : null; return !!(o && o.active && o.bch === 2); }

  laneBusy(z, obstacles) {
    const busy = new Array(LANES).fill(false);
    for (const a of this.people) if (a.active && a.bch !== 2 && Math.abs(a.z - z) < 3.2) busy[clamp(Math.round(a.x / 1.6 + 2), 0, LANES - 1)] = true;
    for (const o of obstacles) if (o.active && Math.abs(o.z - z) < 8) for (let l = o.l0; l <= o.l1; l++) busy[l] = true;
    return busy;
  }

  spawnOne(runnerZ, obstacles, distance) {
    const r = this.rng;
    const H = heatInfo(heatSoft(distance)); // v2.1: density, joggers and free dogs follow HEAT (v2.5.4: soft)
    // v2.5.24 chaos drift: crowdMul (0.84..1.16) varies the HEAT crowd target along the run; never above the preset cap
    const limit = Math.min(this.peopleLimit, Math.round(this.peopleLimit * H.density * (this.crowdMul || 1)));
    const active = this.countDeck(this.people);
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
    a.alert = r.next(); a.color = r.int(0, 11); a.scale = r.range(0.92, 1.08); a.pet = -1; a.bch = 0; a.wp = null; a.hd = undefined; a.y = 0;
    if (roll < H.jogger) { a.kind = KIND.JOGGER; a.dir = -1; a.vz = -r.range(2.4, 3.2); a.rate = 11; a.amp = 0.75; }
    else { a.kind = KIND.WALKER; a.dir = r.chance(0.62) ? 1 : -1; a.vz = a.dir * r.range(1.0, 1.6); a.rate = 6.5; a.amp = 0.42; }
    this.initWill(a);
    // leashed dog
    if (a.kind === KIND.WALKER && r.chance(0.34) && this.countDeck(this.dogs) < this.dogLimit) {
      const d = this.dogs.find((q) => !q.active);
      if (d) { this.initDog(d, a, KIND.DOG_LEASH); this.seedBeach(a, d); }
    } else if (r.chance(H.freeDog) && this.countDeck(this.dogs) < this.dogLimit) {
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
    a.will = f.range(0.8, 5); a.pause = 0; a.chat = -1; a.seaGoal = 0; a.crossZ = 0; a.look = 0; a.lookAmp = 0; a.lookPh = f.range(0, 6.28); a.seaCd = 0; a.visitGoal = 0; a.visitZ = 0; a.visitSide = 0; a.visitCd = f.range(0, 8);
    a.chore = 0; a.choreT = 0; a.bag = 0; a.crouch = 0; a.drop = -1; a.binCd = 0; a.bagCol = f.int(0, 4); // v2.5.21
  }
  // v2.5.6: one decision (every 2.5 - 5.5 s per person, staggered)
  decide(a, i) {
    const f = this.fr, pp = PP[a.persona], W = this.will;
    a.will = f.range(2.5, 5.5) * (a.kind === KIND.JOGGER ? 1.5 : 1);
    a.mood = clamp(a.mood + f.range(-0.15, 0.15), 0, 1);
    if (f.chance(0.04)) { a.persona = a.kind === KIND.JOGGER ? (a.persona === 5 ? 1 : 5) : PERSONA_DRIFT[a.persona]; W.mood++; }
    const vmul = PP[a.persona].v * (0.9 + 0.2 * a.mood);
    if (a.kind === KIND.JOGGER) { a.vzT = a.dir * clamp(a.vbase * vmul * f.range(0.92, 1.08), JOG_V[0], JOG_V[1]); W.pace++; return; }
    if (a.pause > 0 || a.seaGoal > 0 || a.visitGoal > 0) return;
    // v2.5.20: owners with a leashed dog weigh a beach walk instead (persona + mood, follows the weather)
    const dogOwner = a.pet >= 0 && this.dogs[a.pet].active && this.dogs[a.pet].kind === KIND.DOG_LEASH;
    const wSea = a.seaCd > 0 ? 0 : dogOwner ? this.seaPull * DOG_BEACH[a.persona] * (0.55 + 0.9 * a.mood) * (0.35 + seaSink(a.x)) * 0.6 : this.seaPull * pp.sea * seaSink(a.x) * 0.6;
    const wPause = pp.pause * (1.2 - 0.4 * a.mood), wSocial = pp.social * 0.35 * this.socialOn, wWander = pp.wander * 0.6, wPace = 0.5;
    // v2.5.18: an eatery door 3..26 m ahead (beach restaurant on the sea side, plaza glass cafe on the bike side)
    let vz = null, vs = 0;
    if (a.kind === KIND.WALKER && a.pet < 0 && !(a.visitCd > 0) && this.visitMax > 0) {
      const rz = restoNear(a.z + a.dir * 9, 9), pz = plazaCafeNear(a.z + a.dir * 9, 9); // door 0..18 m ahead
      const ok = (z) => z !== null && (z - a.z) * a.dir > 1.5;
      const dr = ok(rz) ? Math.abs(rz - a.z) + Math.max(0, a.x + 1) : 1e9, dp = ok(pz) ? Math.abs(pz - a.z) + Math.max(0, 1 - a.x) : 1e9;
      if (dr < 1e8 || dp < 1e8) { if (dr <= dp) { vz = rz; vs = -1; } else { vz = pz; vs = 1; } }
    }
    const wVisit = vz === null ? 0 : 1.6 * (0.25 + 0.45 * pp.social + 0.3 * pp.pause) * (vs < 0 ? 0.6 + 0.2 * pp.sea : 1);
    let u = f.next() * (wSea + wPause + wSocial + wWander + wPace + wVisit);
    if ((u -= wVisit) < 0) { // go into the restaurant / cafe: walk to its door, step through it (decor takes over)
      a.visitGoal = f.range(16, 24); a.visitZ = vz; a.visitSide = vs; a.targetX = vs * (DECK_HALF - 1.2); W.visit++;
    } else if ((u -= wSea) < 0 && dogOwner) { // v2.5.20: a walk on the sand with the dog (route planned now)
      this.dogWalk.decide++;
      const plan = this.planBeach(a.z, a.dir, a.persona, true);
      if (!plan) { a.seaCd = 10; this.dogWalk.noRoute++; return; }
      a.bch = 1; a.wp = plan.wp; a.wi = 0; a.seaGoal = f.range(14, 22); a.crossZ = plan.A; a.targetX = -DECK_HALF + 0.6; W.sea++;
    } else if (u < 0) { // go bathing: head for the nearest sea-wall crossing (v2.5.7), then step down
      a.seaGoal = f.range(10, 18); a.crossZ = nearestCrossing(a.z, a.dir); a.targetX = -DECK_HALF + 0.6; W.sea++;
    } else if ((u -= wPause) < 0) { // stop for a moment and look around
      a.pause = f.range(1.2, 3.2); a.lookAmp = f.range(0.4, 1.0); W.pause++;
    } else if ((u -= wSocial) < 0) { // someone similar close by: drift together for a short chat
      const P = this.people;
      for (let j = 0; j < P.length; j++) {
        const b = P[j];
        if (j === i || !b.active || b.kind !== KIND.WALKER || b.pause > 0 || b.seaGoal > 0 || b.bch || b.chore || Math.abs(b.z - a.z) > 3.5 || Math.abs(b.x - a.x) > 2.2) continue;
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
    d.squat = 0; d.poopT = owner ? this.poopResidual() : 1e9; // v2.5.21 (free-will stream)
  }

  // ---------- v2.5.20 dog walkers on the sand ----------
  // A route: down through crossing A to a stroll lane (dry sand by the palms, or the shoreline), along the lane
  // to crossing B (1-3 gaps on in the walking direction), back up through B onto the deck.
  corridorOK(lane, cz) {
    if (beachSiteHit(Math.min(lane, -5.0) - 0.4, -4.9, cz - 1.0, cz + 1.0, 0.5)) return false;
    return lane > -9 || !beachBusy(lane, -8.6, cz - 0.9, cz + 0.9); // shoreline walks avoid gaps with umbrellas
  }
  planBeach(z, dir, persona, fromDeck) {
    const f = this.fr, cs = crossingsNear(z, 2);
    const shore = f.chance(persona === 4 ? 0.5 : persona === 1 ? 0.1 : 0.3); // shoreline (long) or dry sand by the palms
    const lanes = shore ? [LANE_SHORE + f.range(-0.4, 0.4), LANE_DRY + f.range(-0.08, 0.08)] : [LANE_DRY + f.range(-0.08, 0.08)];
    const su = f.next(), skip = su < 0.6 ? 1 : su < 0.9 ? 2 : 3; // mostly the next gap on
    // crossing A: from the deck, the nearest one ahead (or right here); when seeded, any one near z
    const As = cs.slice().sort((p, q) => {
      const sp = fromDeck ? (Math.abs(p - z) + ((p - z) * dir < -1.5 ? 40 : 0)) : Math.abs(p - z);
      const sq = fromDeck ? (Math.abs(q - z) + ((q - z) * dir < -1.5 ? 40 : 0)) : Math.abs(q - z);
      return sp - sq;
    }).slice(0, 3);
    for (const lane of lanes) {
      for (const A of As) {
        if (fromDeck && Math.abs(A - z) > 30) continue;
        if (!this.corridorOK(lane, A)) continue;
        const Bs = crossingsNear(A, 3).filter((c) => (c - A) * dir > 3).sort((p, q) => Math.abs(p - A) - Math.abs(q - A));
        const order = Bs.length > skip - 1 ? [Bs[skip - 1], ...Bs.filter((_, j) => j !== skip - 1)] : Bs;
        for (const B of order.slice(0, 4)) {
          if (!this.corridorOK(lane, B)) continue;
          if (beachSiteHit(lane - 0.7, lane + 0.7, Math.min(A, B), Math.max(A, B), 0.5)) continue;
          return { A, B, lane, wp: [{ x: WALL_OUT, z: A }, { x: lane, z: A }, { x: lane, z: B }, { x: WALL_OUT, z: B }, { x: DECK_IN, z: B }] };
        }
      }
    }
    return null;
  }
  // some owners are already out on a beach walk when they appear (they chose it earlier, off-screen)
  seedBeach(a, d) {
    const f = this.fr;
    if (!f.chance(DOG_SEED[a.persona] * clamp(this.seaPull, 0, 1))) return;
    const plan = this.planBeach(a.z, a.dir, a.persona, false);
    if (!plan) return;
    const W = plan.wp; let len = 0; const segL = [];
    for (let k = 1; k < W.length - 1; k++) { const l = Math.hypot(W[k].x - W[k - 1].x, W[k].z - W[k - 1].z); segL.push(l); len += l; }
    let u = f.range(0, 0.95) * len, k = 1;
    while (k < W.length - 1 && u > segL[k - 1]) { u -= segL[k - 1]; k++; }
    const p0 = W[k - 1], p1 = W[k], t = segL[k - 1] > 0 ? u / segL[k - 1] : 0;
    a.x = p0.x + (p1.x - p0.x) * t; a.z = p0.z + (p1.z - p0.z) * t; a.px = a.x; a.pz = a.z;
    a.bch = 2; a.wp = W; a.wi = k; a.bT = 0; a.bStuck = 0; a.bPause = 0; a.bPauseCd = f.range(1, 6); a.seaGoal = 0;
    a.bsp = clamp(a.vbase * PP[a.persona].v, 0.85, 1.35);
    const ux = p1.x - p0.x, uz = p1.z - p0.z, ul = Math.hypot(ux, uz) || 1;
    a.vx = ux / ul * a.bsp; a.vz = uz / ul * a.bsp; a.hd = Math.atan2(-a.vx, -a.vz); a.y = groundY(a.x, a.z);
    d.x = a.x + ux / ul * 1.2; d.z = a.z + uz / ul * 1.2; d.px = d.x; d.pz = d.z; d.hd = a.hd; d.y = groundY(d.x, d.z);
    this.dogWalk.seeded++;
  }
  // cut the stroll short: go up at the next clear crossing ahead (3..25 m on along the lane)
  headBack(a) {
    const W = a.wp, lane = W[2].x, dir = Math.sign(W[2].z - a.z) || 1;
    const cs = crossingsNear(a.z, 1).filter((c) => (c - a.z) * dir > 3 && (c - a.z) * dir < 25 && (c - W[2].z) * dir < -1).sort((p, q) => Math.abs(p - a.z) - Math.abs(q - a.z));
    for (const C of cs) {
      if (!this.corridorOK(lane, C)) continue;
      W[2].z = C; W[3].z = C; W[4].z = C; this.dogWalk.early = (this.dogWalk.early || 0) + 1; return true;
    }
    return false;
  }
  beachStep(a, dt, runner) {
    const f = this.fr, P = this.people;
    a.bT += dt;
    if (a.z > runner.z + 14) { this.ownerGone(a, P.indexOf(a)); a.active = false; a.bch = 0; a.wp = null; if (a.pet >= 0) this.dogs[a.pet].active = false; a.pet = -1; this.dogWalk.gone++; return; }
    if (a.bPause > 0) {
      a.bPause -= dt;
      a.vx = damp(a.vx, 0, 4, dt); a.vz = damp(a.vz, 0, 4, dt);
    } else {
      const w = a.wp[a.wi], dx = w.x - a.x, dz = w.z - a.z, dd = Math.hypot(dx, dz);
      if (dd < 0.22) {
        a.wi++;
        if (a.wi >= a.wp.length) { // back on the boulevard: walk on as before (same dog, same leash)
          a.bch = 0; a.wp = null; a.hd = undefined; a.y = 0; a.seaCd = 60; a.targetX = -DECK_HALF + 0.9;
          a.vzT = a.dir * clamp(a.vbase * PP[a.persona].v * (0.9 + 0.2 * a.mood), WALK_V[0], WALK_V[1]);
          a.will = f.range(2.5, 5.5); this.dogWalk.up++;
          return;
        }
      } else {
        // slower on the stroll lane; stop now and then to let the dog sniff / play
        const lane = a.wi === 2, sp = a.bsp * (lane ? 0.85 : 1) * Math.min(1, 0.35 + dd);
        a.vx = damp(a.vx, dx / dd * sp, 5, dt); a.vz = damp(a.vz, dz / dd * sp, 5, dt);
        if (lane && (a.bPauseCd -= dt) <= 0) {
          a.bPauseCd = f.range(5, 11);
          if (f.chance(a.persona === 0 || a.persona === 4 ? 0.55 : 0.35)) a.bPause = f.range(1.8, 4.2);
          else if (f.chance(a.persona === 1 || a.persona === 5 ? 0.35 : 0.15)) this.headBack(a); // free will: enough for today
        }
      }
    }
    a.x += a.vx * dt; a.z += a.vz * dt;
    const spd = Math.hypot(a.vx, a.vz);
    if (spd > 0.12) a.hd = a.hd === undefined ? Math.atan2(-a.vx, -a.vz) : a.hd + wrapA(Math.atan2(-a.vx, -a.vz) - a.hd) * Math.min(1, 6 * dt);
    a.y = groundY(a.x, a.z);
    a.rate = 6.5 * clamp(spd / 1.3, 0.35, 1.4); a.amp = damp(a.amp, a.bPause > 0 ? 0.03 : 0.42 * clamp(spd / 1.2, 0.2, 1.15), 5, dt);
    a.look = damp(a.look || 0, a.bPause > 0 ? Math.sin(this.t * 0.9 + a.lookPh) * 0.6 : 0, 4, dt);
    a.phase += a.rate * dt;
    // safety net (not expected): no progress for 6 s while walking -> skip to the next waypoint
    if (!(a.bPause > 0) && spd < 0.05) { if ((a.bStuck += dt) > 6) { a.bStuck = 0; a.wi = Math.min(a.wi + 1, a.wp.length - 1); this.dogWalk.stuck++; } } else a.bStuck = 0;
    if (a.chat >= 0) { if (P[a.chat]) P[a.chat].chat = -1; a.chat = -1; }
  }
  // the leashed dog on the sand: trots ahead, sniffs beside the owner, plays at the waterline (shore lane);
  // always within the 1.7 m leash, and only through the wall where there is a crossing gap
  beachDog(d, o, dt) {
    const r = this.rng;
    if (d.think <= 0) {
      d.think = r.range(0.7, 2.2); d.side = r.chance(0.3) ? -d.side : d.side;
      const atShore = o.bch === 2 && o.wi === 2 && o.x < -40;
      const u = r.next();
      d.mode = atShore && (o.bPause > 0 ? u < 0.75 : u < 0.4) ? 2 : u < 0.22 ? 1 : 0; // 2 play, 1 sniff, 0 trot ahead
    }
    const hd = o.hd !== undefined ? o.hd : (o.dir > 0 ? Math.PI : 0);
    const fx = -Math.sin(hd), fz = -Math.cos(hd), inGap = o.x > -7.2; // owner's facing; narrow in the crossing path
    const lat = inGap || o.x > -10 ? 0.3 : 0.55; // tight on the dry-sand lane (benches / towels either side)
    let tx, tz;
    if (d.mode === 2) { tx = Math.max(-45.5, o.x - 1.45); tz = o.z + Math.sin(this.t * 2.4 + d.phase * 0.1) * 0.9; }
    else if (d.mode === 1) { tx = o.x + fz * d.side * lat * -1; tz = o.z + fx * d.side * lat; }
    else { tx = o.x + fx * 1.25 - fz * d.side * lat * 0.6; tz = o.z + fz * 1.25 + fx * d.side * lat * 0.6; }
    const nx = damp(d.x, tx, d.mode === 2 ? 4.5 : 3.5, dt), nz = damp(d.z, tz, d.mode === 2 ? 4.5 : 3.5, dt);
    d.x = nx; d.z = nz;
    const lx = d.x - o.x, lz = d.z - o.z, L = Math.hypot(lx, lz);
    if (L > 1.7) { d.x = o.x + lx / L * 1.7; d.z = o.z + lz / L * 1.7; }
    // the sea wall: cross only inside a crossing gap
    if (gapOpen(d.z) < 0.45) {
      if (d.px >= -4.5) d.x = Math.max(d.x, -4.25); else if (d.px <= -4.95) d.x = Math.min(d.x, -5.15);
      else d.x = d.px > -4.72 ? -4.25 : -5.15;
    }
    const vx = (d.x - d.px) / Math.max(dt, 1e-4), vz = (d.z - d.pz) / Math.max(dt, 1e-4), sp = Math.hypot(vx, vz);
    d.vx = vx; d.vz = vz;
    if (sp > 0.15) d.hd = d.hd === undefined ? Math.atan2(-vx, -vz) : d.hd + wrapA(Math.atan2(-vx, -vz) - d.hd) * Math.min(1, 8 * dt);
    d.y = groundY(d.x, d.z);
    d.rate = 8 + sp * 4.5; d.amp = 0.6;
    d.phase += d.rate * dt;
    if (d.z > this._rz + 14) d.active = false;
  }

  // ---------- v2.5.21 picking up after the dog ----------
  // dog timer (free-will stream) -> squat 2-3 s -> dropping (pool) -> owner: bag out, step up, crouch + pick up,
  // stand, walk to the nearest bin within reach, drop the bag in, walk on. Every state has a timeout.
  dogPoop(d, o, dt, runner) {
    if (d.squat > 0) {
      d.squat -= dt; d.vx = 0; d.vz = 0; d.amp = damp(d.amp, 0.02, 8, dt); d.rate = 5; d.phase += d.rate * dt;
      const lx = o.x - d.x, lz = o.z - d.z, L = Math.hypot(lx, lz); // the leash holds the owner, not the squatting dog
      if (L > 1.7) { o.x = d.x + lx / L * 1.7; o.z = d.z + lz / L * 1.7; }
      if (d.squat <= 0) this.placeDrop(d, o);
      if (d.z > runner.z + 14) d.active = false;
      return true;
    }
    if (o.chore === 0 && (d.poopT -= dt) <= 0) this.tryPoop(d, o, runner);
    return false;
  }
  tryPoop(d, o, runner) {
    const f = this.fr, P = this.people;
    // only while the runner is far enough back that the whole pickup is done before they pass (never left behind)
    const rdz = runner.z - o.z, need = 15 + Math.max(6, runner.speed || 0) * 6.5;
    const deckOK = o.bch === 0 && !(o.seaGoal > 0) && !(o.visitGoal > 0) && d.x > -DECK_HALF + 0.3 && Math.abs(d.x) < DECK_HALF - 0.25;
    const sandOK = o.bch === 2 && o.wi >= 1 && o.wi <= 3 && o.x < -9.5 && d.x < -9.5;
    if (!(deckOK || sandOK) || rdz < need) { d.poopT = f.range(2, 5); return; }
    d.squat = f.range(2, 3);
    o.chore = 1; o.choreT = 0; o.pause = 0;
    if (o.hd === undefined) o.hd = (o.dir > 0 ? Math.PI : 0) + (o.look || 0);
    o.look = 0;
    if (o.chat >= 0) { const b = P[o.chat]; if (b) { b.chat = -1; b.pause = Math.min(b.pause, 0.5); } o.chat = -1; }
    this.poop.squat++; if (o.bch === 2) this.poop.sand++; else this.poop.deck++;
  }
  placeDrop(d, o) {
    const f = this.fr, S = this.poop;
    const hd = d.hd !== undefined ? d.hd : (d.dir > 0 ? Math.PI : 0);
    const x = d.x + Math.sin(hd) * 0.3 * d.scale, z = d.z + Math.cos(hd) * 0.3 * d.scale;
    d.amp = 0.6; d.poopT = f.range(POOP_EVERY[0], POOP_EVERY[1]) * (1.1 - 0.2 * (o.mood || 0.5));
    let k = -1; for (let j = 0; j < this.drops.length; j++) if (!this.drops[j].on) { k = j; break; }
    if (k < 0 || o.chore !== 1) { if (o.chore === 1) this.choreEnd(o); S.poolFull++; return; }
    const q = this.drops[k];
    q.on = true; q.x = x; q.z = z; q.y = groundY(x, z); q.owner = d.owner; q.rot = f.range(0, 6.28); q.s = 0.85 + 0.25 * (d.scale - 0.8) / 0.45;
    o.drop = k; S.dropped++;
    this.choreNext(o, 2);
  }
  // time to the next squat for a dog met mid-walk: residual life of the 60-120 s cycle (uniform 0-60 s 2/3 of the time,
  // then a tapering 60-120 s tail), so the long-run rate is the same once every 60-120 s per dog
  poopResidual() {
    const u = this.fr.next(), a = POOP_EVERY[0], b = POOP_EVERY[1], p = a / ((a + b) / 2);
    return u < p ? 2 + (a - 2) * (u / p) : b - (b - a) * Math.sqrt(Math.max(0, 1 - (u - p) / (1 - p)));
  }
  choreNext(a, k) { a.chore = k; a.choreT = 0; }
  choreEnd(a, why) {
    a.chore = 0; a.choreT = 0; a.crouch = 0;
    if (why === 'stuck') this.poop.stuck++; else if (why === 'lost') this.poop.lost++;
    if (a.drop >= 0 && !this.drops[a.drop].on) a.drop = -1;
    if (a.bch !== 2) { // back to the boulevard walk (turn back to the walking direction smoothly via look)
      const base = a.dir > 0 ? Math.PI : 0;
      if (a.hd !== undefined) a.look = wrapA(a.hd - base);
      a.hd = undefined; a.targetX = a.x; a.pause = 0; a.vx = 0;
      a.vzT = a.dir * clamp(a.vbase * PP[a.persona].v * (0.9 + 0.2 * a.mood), WALK_V[0], WALK_V[1]);
      a.will = this.fr.range(1.5, 4);
    } else { a.bStuck = 0; a.bPause = 0; }
  }
  // nearest bin within reach (ahead preferred); false = keep carrying the bag
  goBin(a) {
    let best = null, bc = 1e9;
    for (const bz of binsNear(a.z, 1)) {
      const dz = bz - a.z; if (Math.abs(dz) > BIN_REACH) continue;
      const c = Math.abs(dz) + (dz * a.dir < -1 ? 8 : 0);
      if (c < bc) { bc = c; best = bz; }
    }
    if (best === null) return false;
    a.binZ = best;
    if (a.hd === undefined) a.hd = (a.dir > 0 ? Math.PI : 0) + (a.look || 0);
    a.look = 0; a.pause = 0;
    if (a.chat >= 0) { const b = this.people[a.chat]; if (b) b.chat = -1; a.chat = -1; }
    this.choreNext(a, 5); this.poop.toBin++;
    return true;
  }
  ownerGone(a, i) {
    const q = a.drop >= 0 ? this.drops[a.drop] : null;
    if (q && q.on && q.owner === i) { q.on = false; this.poop.leftBehind++; }
    if (a.bag === 2) this.poop.carriedOff++;
    a.drop = -1; a.bag = 0; a.chore = 0; a.crouch = 0;
  }
  choreStep(a, i, dt, runner) {
    const P = this.people, S = this.poop;
    a.choreT += dt;
    if (a.z > runner.z + 14) { this.ownerGone(a, i); a.active = false; a.bch = 0; a.wp = null; if (a.pet >= 0) this.dogs[a.pet].active = false; a.pet = -1; return; }
    const dg = a.pet >= 0 ? this.dogs[a.pet] : null, d = dg && dg.active && dg.owner === i ? dg : null;
    const q = a.drop >= 0 && this.drops[a.drop].on ? this.drops[a.drop] : null;
    let tx = null, tz = null, sp = 0, cr = 0, face = null;
    if (a.chore === 1) { // the dog squats: stop and wait beside it
      if (d && d.squat > 0) face = d;
      else this.choreEnd(a, 'lost');
      if (a.chore && a.choreT > 5) this.choreEnd(a, 'stuck');
    } else if (a.chore === 2) { // a bag out of the pocket / dispenser roll
      if (a.choreT > 0.3) a.bag = Math.max(a.bag, 1);
      face = q;
      if (a.choreT > 0.75) this.choreNext(a, 3);
    } else if (a.chore === 3) { // step up to it
      if (!q) this.choreNext(a, 4);
      else {
        const ox = a.x - q.x, oz = a.z - q.z, ol = Math.hypot(ox, oz) || 1;
        tx = q.x + ox / ol * 0.42; tz = q.z + oz / ol * 0.42; sp = 0.9; face = q;
        if (Math.hypot(tx - a.x, tz - a.z) < 0.1 || a.choreT > 4) this.choreNext(a, 4);
      }
    } else if (a.chore === 4) { // crouch, pick it up with the bag, tie it, stand up
      cr = a.choreT < 1.45 ? 1 : 0; face = q;
      if (a.choreT > 0.85 && q) { q.on = false; a.drop = -1; a.bag = 2; S.picked++; }
      if (a.choreT > 2.0) { if (!(a.bch === 0 && this.goBin(a))) this.choreEnd(a); }
    } else if (a.chore === 5) { // to the bin (holds its line while the runner is about to pass)
      tx = BIN_STAND_X; tz = a.binZ; sp = 1.15;
      const rdz = runner.z - a.z;
      if (rdz > 0 && rdz < 10 && Math.abs(a.x - runner.x) < 1.6) tx = a.x;
      if (Math.hypot(BIN_STAND_X - a.x, a.binZ - a.z) < 0.15) this.choreNext(a, 6);
      else if (a.choreT > 18) { S.binGiveUp++; a.binCd = 4; this.choreEnd(a); }
    } else if (a.chore === 6) { // drop the bag in
      face = { x: BIN_X, z: a.binZ };
      if (a.choreT > 0.45 && a.bag) { a.bag = 0; S.binned++; }
      if (a.choreT > 1.0) this.choreEnd(a);
    } else this.choreEnd(a, 'stuck');
    if (a.chore === 0) return; // walks on from the next step
    if (tx !== null) {
      const dx = tx - a.x, dz = tz - a.z, dd = Math.max(Math.hypot(dx, dz), 1e-4), v = sp * Math.min(1, 0.3 + dd * 1.5);
      a.vx = damp(a.vx, dx / dd * v, 6, dt); a.vz = damp(a.vz, dz / dd * v, 6, dt);
    } else { a.vx = damp(a.vx, 0, 6, dt); a.vz = damp(a.vz, 0, 5, dt); }
    a.x += a.vx * dt; a.z += a.vz * dt;
    if (a.bch !== 2) a.x = clamp(a.x, -DECK_HALF + 0.2, DECK_HALF - 0.2);
    const spd = Math.hypot(a.vx, a.vz);
    let want;
    if (spd > 0.15) want = Math.atan2(-a.vx, -a.vz);
    else if (face && Math.hypot(face.x - a.x, face.z - a.z) > 0.05) want = Math.atan2(-(face.x - a.x), -(face.z - a.z));
    if (want !== undefined) a.hd = a.hd === undefined ? want : a.hd + wrapA(want - a.hd) * Math.min(1, (a.chore === 6 ? 12 : 5) * dt);
    a.crouch = damp(a.crouch || 0, cr, 7, dt);
    a.y = a.bch === 2 ? groundY(a.x, a.z) : 0;
    a.rate = 6.5 * clamp(spd / 1.3, 0.35, 1.4); a.amp = damp(a.amp, spd < 0.1 ? 0.03 : 0.42 * clamp(spd / 1.2, 0.2, 1.15), 6, dt);
    a.look = damp(a.look || 0, 0, 4, dt); a.phase += a.rate * dt;
    if (a.knock > 0) a.knock -= dt;
    if (a.chat >= 0) { if (P[a.chat]) P[a.chat].chat = -1; a.chat = -1; }
  }

  // ---------- sense / decide / act ----------
  step(dt, runner, obstacles, distance) {
    const r = this.rng;
    this._rz = runner.z;
    const P = this.people;
    for (let i = 0; i < P.length; i++) {
      const a = P[i];
      if (!a.active) continue;
      a.px = a.x; a.pz = a.z;
      if (a.chore > 0) { this.choreStep(a, i, dt, runner); continue; } // v2.5.21 picking up after the dog / to the bin
      if (a.bch === 2) { this.beachStep(a, dt, runner); continue; } // v2.5.20 on the sand with the dog
      // v2.5.21: carrying a full bag on the deck -> the nearest bin within reach (else keep carrying it)
      if (a.bag === 2 && !(a.seaGoal > 0) && !(a.visitGoal > 0) && (a.binCd -= dt) <= 0) { a.binCd = 0.6; if (this.goBin(a)) continue; }
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
          if (a.bch === 1) a.vzT = clamp(dCross * 0.8, -0.4, 0.4); // v2.5.20: dog walkers line up and go straight through
        }
        if (a.seaGoal <= 0) { a.seaCd = 12; if (a.bch === 1) { a.bch = 0; a.wp = null; this.dogWalk.gaveUp++; } } // changed their mind
      } else if (a.seaCd > 0) a.seaCd -= dt;
      // v2.5.18: heading for an eatery door; line up with the door, then step through (never along the glass)
      let doorOpen = 0;
      if (a.visitGoal > 0) {
        a.visitGoal -= dt;
        const dDoor = a.visitZ - a.z;
        if (Math.abs(dDoor) > 0.9) {
          a.vzT = Math.sign(dDoor || a.dir) * Math.max(0.9, Math.min(1.5, Math.abs(a.vzT) * 0.9 + 0.15));
          a.targetX = a.visitSide < 0 ? clamp(Math.min(a.x, -DECK_HALF + 1.4), -DECK_HALF + 0.7, DECK_HALF - 0.5) : clamp(Math.max(a.x, DECK_HALF - 1.4), -DECK_HALF + 0.5, DECK_HALF - 0.7);
        } else {
          a.targetX = a.visitSide * (DECK_HALF - 0.25); a.vzT = clamp(dDoor * 0.8, -0.4, 0.4);
          doorOpen = 1;
        }
        if (a.visitGoal <= 0) { a.visitCd = 20; doorOpen = 0; } // changed their mind
      } else if (a.visitCd > 0) a.visitCd -= dt;
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
      const tBound = gauss(a.x + DECK_HALF, 0.45) * (1 - open) * (a.visitSide < 0 ? 1 - doorOpen : 1) - gauss(DECK_HALF - a.x, 0.45) * (a.visitSide > 0 ? 1 - doorOpen : 1);
      // DECIDE (weighted ternary vote)
      const s = 3 * tBound + 2 * tObs + 1.2 * tSep + 1.0 * tAvoid + 0.6 * tWander;
      a.intent = trit(s);
      // ACT
      const lat = a.kind === KIND.JOGGER ? 1.4 : 0.9;
      // v2.5.4 cafe SINK: walkers near a cafe drift toward the cafe side of the deck (x about 3.4)
      // v2.5.18: plaza cafes pull toward the bike side, beach restaurants toward the sea wall (both mild)
      const sink = a.kind !== KIND.WALKER ? 0 : a.x > -2 ? 0.28 * plazaSink(a.z) * clamp((3.4 - a.x) / 1.5, -1, 1) : a.x < 2 ? 0.2 * restoSink(a.z) * clamp((-3.4 - a.x) / 1.5, -1, 1) : 0;
      // v2.5.6: the v2.5.5 sea sink is now a CHOICE (its Gaussian weights the decision to go bathing)
      a.vx = damp(a.vx, a.intent * lat + sink, 5, dt);
      // v2.5.7: once lined up with a crossing, commit through the gap toward the beach
      if (a.seaGoal > 0 && Math.abs(a.z - a.crossZ) <= CROSS_HALF * 1.05) a.vx = damp(a.vx, -1.4, 6, dt);
      if (doorOpen) a.vx = damp(a.vx, a.visitSide * 1.3, 6, dt); // v2.5.18: commit through the door gap
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
      const xMin = -DECK_HALF + 0.2 - 0.55 * open - (a.visitSide < 0 ? 0.35 * doorOpen : 0);
      a.x = clamp(a.x + a.vx * dt, xMin, DECK_HALF - 0.2 + (a.visitSide > 0 ? 0.35 * doorOpen : 0));
      a.z += a.vz * dt;
      a.phase += a.rate * dt;
      if (a.z > runner.z + 14) { this.ownerGone(a, i); a.active = false; a.bch = 0; if (a.pet >= 0) this.dogs[a.pet].active = false; a.pet = -1; if (a.chat >= 0) { P[a.chat].chat = -1; a.chat = -1; } }
      // v2.5.20: a dog walker lined up in a crossing steps down onto the sand path (the sim keeps both agents)
      else if (a.bch === 1 && a.seaGoal > 0 && a.x < -4.0 && open > 0.6 && Math.abs(a.z - a.crossZ) < CROSS_HALF * 0.6) {
        a.bch = 2; a.wi = 0; a.seaGoal = 0; a.bT = 0; a.bStuck = 0; a.bPause = 0; a.bPauseCd = 3; a.hd = Math.atan2(-a.vx, -a.vz);
        a.bsp = clamp(a.vbase * PP[a.persona].v, 0.85, 1.35); this.dogWalk.down++;
        if (a.chat >= 0) { P[a.chat].chat = -1; a.chat = -1; }
      }
      // v2.5.5 / v2.5.7: walkers step down to the beach only through a crossing gap, well ahead of the runner
      else if (a.kind === KIND.WALKER && a.seaGoal > 0 && a.pet < 0 && a.x < -3.6 && open > 0.45 && Math.abs(a.z - a.crossZ) < CROSS_HALF * 1.1 && rdz > 40 && this.bathCd <= 0 && this.seaPull > 0.3) {
        a.active = false; a.seaGoal = 0; this.bathCd = SEA_LEAVE_GAP; this.bathers = (this.bathers || 0) + 1;
        if (a.chat >= 0) { P[a.chat].chat = -1; P[a.chat].pause = Math.min(P[a.chat].pause, 0.5); }
        this.toBeach.push({ x: a.x, z: a.crossZ || a.z, color: a.color, scale: a.scale, persona: a.persona });
        if (this.toBeach.length > 12) this.toBeach.shift();
      }
      // v2.5.18: through the eatery door -> the renderer's visitor takes the same person inside
      else if (a.kind === KIND.WALKER && a.visitGoal > 0 && a.pet < 0 && Math.abs(a.z - a.visitZ) < 1.2 && (a.visitSide < 0 ? a.x < -3.85 : a.x > 3.85)) {
        if (this.visitCd <= 0 && this.visitLive.length < this.visitMax) {
          a.active = false; a.visitGoal = 0; this.visitCd = VISIT_GAP; this.visitLive.push(this.t + VISIT_LIFE); this.will.visitIn++;
          if (a.chat >= 0) { P[a.chat].chat = -1; P[a.chat].pause = Math.min(P[a.chat].pause, 0.5); a.chat = -1; }
          this.toVisit.push({ x: a.x, z: a.z, door: a.visitZ, kind: a.visitSide < 0 ? 'resto' : 'pcafe', color: a.color, scale: a.scale, persona: a.persona });
          if (this.toVisit.length > 8) this.toVisit.shift();
        } else if (a.visitGoal < 14) { a.visitGoal = 0; a.visitCd = 15; } // too busy inside: walk on
      }
    }
    if (this.bathCd > 0) this.bathCd -= dt;
    if (this.visitCd > 0) this.visitCd -= dt;
    while (this.visitLive.length && this.visitLive[0] < this.t) this.visitLive.shift();
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
        if (this.dogPoop(d, o, dt, runner)) continue; // v2.5.21 squatting (stays put)
        if (o.bch === 2 || d.x < -DECK_HALF + 0.19) { this.beachDog(d, o, dt); continue; } // v2.5.20 sand / crossing
        if (d.hd !== undefined) { d.hd = undefined; d.y = 0; }
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
