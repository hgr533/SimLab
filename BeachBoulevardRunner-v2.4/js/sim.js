// Fixed-step deterministic runner simulation: input -> runner -> AI core -> proximity field
// -> ternary line core -> FLOW / COMBO / STAMINA -> score. No wall clock, seeded RNG only.
// v2.1: HEAT tiers (difficulty ramp), boulevard pickups (flow orbs, orb trails, air orbs,
// stamina drinks) on their own RNG stream, LEASH HOP bonus, run stats for the results screen.
import { DT, LANES, laneX, LANE_W, RUNNER_R, MAX_ECHOES, clamp, damp, trit, heatAt, heatInfo, HEAT_TEXT, windGust } from './config.js';
import { makeRng } from './rng.js';
import { AICore } from './aicore.js';
import { WorldState } from './weather.js';

const GRAV = 15.5, JUMP_V = 5.5;
const MAX_OBS = 12;
export const MAX_PICKS = 40;
export const PICK = { ORB: 0, DRINK: 1 };

export class Sim {
  constructor(seed) {
    this.seed = seed;
    this.ws = new WorldState();
    this.echoEvery = 0.08;
    this.reset(seed);
  }
  reset(seed = this.seed) {
    this.seed = seed;
    this.rng = makeRng(seed);
    this.ai = this.ai || null;
    const limits = this.ai ? [this.ai.peopleLimit, this.ai.dogLimit] : [40, 12];
    this.ai = new AICore(makeRng(seed ^ 0x5bd1e995));
    this.ai.setLimits(...limits);
    this.ws.reset();
    this.t = 0; this.tick = 0;
    this.state = 'title';
    this.r = { lane: 2, x: 0, y: 0, z: 0, px: 0, py: 0, pz: 0, vy: 0, speed: 0, ground: true,
      slideT: 0, slideQueued: false, dashT: 0, dashCd: 0, sprint: false, invuln: 0, stagger: 0,
      phase: 0, lastLaneDir: 0, lastLaneT: -9, slidePose: 0, airPose: 0, lean: 0 };
    this.flow = 0; this.combo = 1; this.comboT = 0; this.bestCombo = 1; this.stamina = 100; this.score = 0;
    this.quality = 0.6; this.line = 0; this.lineHold = 0; this.distance = 0;
    this.nearMisses = 0; this.cleanPasses = 0; this.hits = 0; this.hurdles = 0;
    this.lineHist = new Int8Array(90); this.lineHistI = 0;
    this.heat = 1; this.H = heatInfo(1); this.maxHeat = 1;
    this.orbs = 0; this.drinks = 0; this.trails = 0; this.leashHops = 0; this.airOrbs = 0;
    this.pickRng = makeRng((seed ^ 0x9e3779b9) >>> 0);
    this.picks = Array.from({ length: MAX_PICKS }, () => ({ active: false, type: 0, x: 0, y: 0, z: 0, trail: -1, taken: -1 }));
    this.pickCursor = -70; this.trailId = 0; this.trailLeft = new Map();
    this.events = [];
    this.obs = Array.from({ length: MAX_OBS }, () => ({ active: false }));
    this.obsCursor = -95;
    this.echoes = Array.from({ length: MAX_ECHOES }, () => ({ born: -99, x: 0, y: 0, z: 0, ph: 0, sl: 0, air: 0, s: 0 }));
    this.echoI = 0; this.echoAcc = 0; this.echoStrength = 0;
    this.shake = 0;
    this.ai.reset(0);
  }
  start() { if (this.state !== 'run') { if (this.state === 'over') this.reset(this.seed); this.state = 'run'; this.r.speed = 7; } }
  setPeople(p, d) { this.ai.setLimits(p, d); }
  emit(type, text, value = 0, x = 0) { this.events.push({ type, text, value, x }); }

  nearWindow() { const n = this.ws.name; return n === 'GOLDEN' ? 0.75 : n === 'RAIN' ? 0.6 : 0.68; }
  rewardMul() { return this.ws.name === 'RAIN' ? 1.5 : 1; }

  spawnObstacles() {
    while (this.obsCursor > this.r.z - 170) {
      const o = this.obs.find((q) => !q.active);
      if (!o) break;
      const g = this.rng;
      const type = g.chance(0.5) ? 0 : 1;
      const w = type === 0 ? g.int(2, 3) : g.int(1, 2);
      this.placeObstacle(o, type, w, this.obsCursor);
      // v2.1 HEAT 3+: some obstacles come as a pair (banner then planter, or the reverse) 10-13 m apart
      const H = heatInfo(heatAt(-this.obsCursor));
      if (H.combo > 0 && g.chance(H.combo)) {
        const o2 = this.obs.find((q) => !q.active);
        if (o2) { const t2 = 1 - type; this.placeObstacle(o2, t2, t2 === 0 ? 2 : g.int(1, 2), this.obsCursor - g.range(10, 13)); o2.pair = true; }
      }
      this.obsCursor -= g.range(42, 78) * (this.distance < 400 ? 1.3 : 1) * H.obsGap;
    }
    for (const o of this.obs) if (o.active && o.z > this.r.z + 14) o.active = false;
  }

  placeObstacle(o, type, w, z) {
    const g = this.rng;
    o.active = true; o.type = type; o.z = z; o.l0 = g.int(0, LANES - w); o.l1 = o.l0 + w - 1; o.pair = false; o.airOrb = false;
    o.x0 = laneX(o.l0) - LANE_W / 2; o.x1 = laneX(o.l1) + LANE_W / 2; o.resolved = false; o.hit = false; o.under = false;
  }
  laneBlocked(l, z0, z1) {
    for (const o of this.obs) if (o.active && o.z <= z0 + 2 && o.z >= z1 - 2 && l >= o.l0 && l <= o.l1) return o;
    return null;
  }
  // ---------- pickups: own RNG stream, so they never shift crowd or obstacle spawns
  spawnPickups() {
    const g = this.pickRng;
    while (this.pickCursor > this.r.z - 150) {
      const z = this.pickCursor;
      const roll = g.next();
      if (roll < 0.62) {
        // flow orb trail: 5 orbs down one lane; collect all five for an ORB TRAIL bonus
        const n = 5, sp = 3.0, lane = g.int(0, LANES - 1);
        if (!this.laneBlocked(lane, z, z - n * sp)) {
          const id = ++this.trailId; let placed = 0;
          for (let i = 0; i < n; i++) if (this.addPick(PICK.ORB, laneX(lane), 0.75, z - i * sp, id)) placed++;
          this.trailLeft.set(id, placed);
        }
        this.pickCursor -= g.range(34, 58);
      } else if (roll < 0.82) {
        // stamina drink: one per gap, in a free lane
        const lane = g.int(0, LANES - 1);
        if (!this.laneBlocked(lane, z, z)) this.addPick(PICK.DRINK, laneX(lane), 0.55, z, -1);
        this.pickCursor -= g.range(40, 70);
      } else {
        // air orbs above the next planter barrier ahead: only reachable with a jump
        const o = this.obs.find((q) => q.active && q.type === 1 && q.z < z + 4 && q.z > z - 40 && !q.airOrb);
        if (o) { o.airOrb = true; const l = g.int(o.l0, o.l1); for (let i = -1; i <= 1; i++) this.addPick(PICK.ORB, laneX(l), 2.15 - Math.abs(i) * 0.12, o.z + i * 1.1, -2); }
        this.pickCursor -= g.range(30, 50);
      }
    }
    for (const p of this.picks) if (p.active && p.taken < 0 && p.z > this.r.z + 6) { p.active = false; if (p.trail > 0) this.trailLeft.delete(p.trail); }
    for (const p of this.picks) if (p.active && p.taken >= 0 && this.t - p.taken > 0.35) p.active = false;
  }
  addPick(type, x, y, z, trail) {
    const p = this.picks.find((q) => !q.active);
    if (!p) return false;
    p.active = true; p.type = type; p.x = x; p.y = y; p.z = z; p.trail = trail; p.taken = -1;
    return true;
  }
  collectPickups() {
    const r = this.r;
    const top = r.y + (r.slidePose > 0.5 ? 0.9 : 1.75) + 0.2, bottom = r.y - 0.2;
    for (const p of this.picks) {
      if (!p.active || p.taken >= 0) continue;
      if (Math.abs(p.z - r.z) > 0.7 || Math.abs(p.x - r.x) > 0.62 || p.y < bottom || p.y > top) continue;
      p.taken = this.t;
      if (p.type === PICK.DRINK) {
        this.drinks++; this.stamina = Math.min(100, this.stamina + 30);
        this.emit('drink', 'STAMINA +30');
      } else {
        this.orbs++; if (p.trail === -2) this.airOrbs++;
        this.flow = Math.min(100, this.flow + 3);
        const pts = Math.round(8 * this.combo * this.H.mul); this.score += pts;
        let left = -1;
        if (p.trail > 0 && this.trailLeft.has(p.trail)) { left = this.trailLeft.get(p.trail) - 1; this.trailLeft.set(p.trail, left); }
        this.emit('orb', '', left >= 0 ? 4 - left : p.trail === -2 ? 5 : 2);
        if (left === 0) { this.trailLeft.delete(p.trail); this.trails++; this.reward('trail', 'ORB TRAIL', 30, 6); }
      }
    }
  }
  // LEASH HOP (idea merged from the old Grok workspace "Leash gap"): clear the leash between
  // an owner and a leashed dog in the air, or dash through the gap.
  leashCheck() {
    const r = this.r, P = this.ai.people;
    if (r.y < 0.4 && r.dashT <= 0) return;
    for (const d of this.ai.dogs) {
      if (!d.active || d.kind !== 2 || d.hopped || d.hit) continue;
      const o = P[d.owner];
      if (!o || !o.active || o.hit) continue;
      const ax = o.x, az = o.z, bx = d.x - ax, bz = d.z - az, L2 = bx * bx + bz * bz;
      if (L2 < 0.3) continue;
      const t = ((r.x - ax) * bx + (r.z - az) * bz) / L2;
      if (t < 0.12 || t > 0.88) continue;
      const cx = ax + bx * t - r.x, cz = az + bz * t - r.z;
      if (cx * cx + cz * cz < 0.38 * 0.38) {
        d.hopped = true; this.leashHops++;
        this.reward('leash', r.dashT > 0 ? 'LEASH GAP' : 'LEASH HOP', 55, 8);
      }
    }
  }

  contact(what, dx) {
    const r = this.r;
    this.hits++;
    r.invuln = 1.0; r.stagger = 0.28;
    r.speed *= 0.55;
    this.flow *= 0.35; this.combo = 1; this.comboT = 0;
    this.stamina -= this.H.hit; this.score = Math.max(0, this.score - 100);
    this.quality = Math.max(0, this.quality - 0.35);
    this.shake = 1;
    this.emit('contact', 'CONTACT -1  ' + what, -100, dx);
    if (this.stamina <= 0) { this.stamina = 0; this.state = 'over'; this.emit('over', 'COLLAPSED'); }
  }
  reward(kind, text, base, flowGain, x = 0) {
    const m = this.rewardMul() * this.H.mul;
    this.combo = Math.min(99, this.combo + 1); this.comboT = 4;
    this.bestCombo = Math.max(this.bestCombo, this.combo);
    const pts = Math.round(base * this.combo * m);
    this.score += pts; this.flow = Math.min(100, this.flow + flowGain);
    this.quality = Math.min(1, this.quality + 0.07);
    this.emit(kind, `${text} +${pts}`, pts, x);
  }

  step(inp) {
    this.tick++;
    const r = this.r;
    r.px = r.x; r.py = r.y; r.pz = r.z;
    for (let i = 0; i < (inp.nextWeather | 0); i++) this.ws.next();
    if (this.state !== 'run') {
      this.ws.update(DT);
      // idle: title screen agents keep walking around the runner
      r.phase += DT * 2;
      this.ai.step(DT, r, this.obs, 0);
      return;
    }
    this.t += DT;
    this.ws.update(DT);
    const W = this.ws.name;
    // ---- HEAT tier
    const h = heatAt(this.distance);
    if (h !== this.heat) {
      this.heat = h; this.H = heatInfo(h); this.maxHeat = Math.max(this.maxHeat, h);
      this.emit('heat', `HEAT ${h}  x${this.H.mul.toFixed(1)}  ${HEAT_TEXT[h] || ''}`.trim(), h);
    }
    // ---- input -> runner
    for (let i = 0; i < inp.left; i++) this.changeLane(-1);
    for (let i = 0; i < inp.right; i++) this.changeLane(1);
    if (inp.jump && r.ground && this.stamina >= 4) { r.vy = JUMP_V; r.ground = false; r.slideT = 0; this.stamina -= 4; this.emit('jump', ''); }
    if (inp.slide) {
      if (r.ground) { if (r.slideT <= 0) { r.slideT = 0.72; this.stamina = Math.max(0, this.stamina - 3); this.emit('slide', ''); } }
      else { r.vy = Math.min(r.vy, -9); r.slideQueued = true; }
    }
    r.dashCd = Math.max(0, r.dashCd - DT);
    if (inp.dash && r.dashCd <= 0 && this.stamina >= 18) {
      r.dashT = 0.32; r.dashCd = 0.9; this.stamina -= 18; this.emit('dash', 'DASH');
      for (let k = 0; k < 3; k++) this.pushEcho(1);
    }
    r.sprint = !!inp.sprint && this.stamina > 0.5 && r.stagger <= 0;
    // vertical
    if (!r.ground) {
      r.vy -= GRAV * DT; r.y += r.vy * DT;
      if (r.y <= 0) { r.y = 0; r.vy = 0; r.ground = true; if (r.slideQueued) { r.slideQueued = false; r.slideT = 0.6; } }
    }
    r.slideT = Math.max(0, r.slideT - DT);
    r.dashT = Math.max(0, r.dashT - DT);
    r.invuln = Math.max(0, r.invuln - DT);
    r.stagger = Math.max(0, r.stagger - DT);
    // speed
    const base = 9 + Math.min(6, this.distance * 0.003) + this.H.speed;
    let target = base * (1 + 0.15 * this.flow / 100) * (r.sprint ? 1.32 : 1) * (this.stamina <= 0.5 ? 0.85 : 1);
    if (r.stagger > 0) target *= 0.5;
    r.speed = damp(r.speed, target, 2.5, DT);
    const v = r.speed + (r.dashT > 0 ? 9 : 0);
    r.z -= v * DT;
    this.distance = -r.z;
    // lateral (rain is slick: slower settle), sea spray crosswind drift
    const settle = W === 'RAIN' ? 9 : 14;
    // v2.2: the SEA SPRAY crosswind now comes in the same gusts that bend the palms (inland, +x)
    const drift = W === 'SEA SPRAY' ? 0.34 * windGust(r.z, this.t) * this.ws.p.spray : 0;
    const prevX = r.x;
    r.x = damp(r.x, laneX(r.lane) + drift, settle, DT);
    r.lean = damp(r.lean, (r.x - prevX) / DT * 0.06, 10, DT);
    r.phase += DT * (r.ground ? (r.sprint ? 15.5 : 12.5) * (r.speed / 11) : 3);
    r.slidePose = damp(r.slidePose, r.slideT > 0 ? 1 : 0, 18, DT);
    r.airPose = damp(r.airPose, r.ground ? 0 : 1, 14, DT);
    // stamina
    if (r.sprint) this.stamina = Math.max(0, this.stamina - 18 * DT);
    else {
      const regen = (this.line > 0 ? 13 : 8) * (W === 'CLEAR HAZE' ? 1.3 : 1) * this.H.regen;
      this.stamina = Math.min(100, this.stamina + regen * DT);
    }
    // ---- world
    this.spawnObstacles();
    this.spawnPickups();
    this.ai.step(DT, r, this.obs, this.distance);
    // ---- proximity field
    const prox = this.proximity();
    if (this.state !== 'run') return;
    this.collectPickups();
    this.leashCheck();
    // ---- ternary line core
    this.lineCore(prox);
    // ---- meters
    this.comboT -= DT;
    if (this.comboT <= 0 && this.combo > 1) { this.combo--; this.comboT = 1; }
    this.quality = damp(this.quality, 0.6, 0.15, DT);
    this.score += v * DT * (1 + this.flow / 100) * (1 + (this.combo - 1) * 0.05) * this.H.mul;
    this.shake = Math.max(0, this.shake - DT * 2.5);
    // ---- soliton echo strength follows movement quality and flow
    const s = clamp(0.8 * this.flow / 100 + 0.9 * Math.max(0, this.quality - 0.55) + (this.line > 0 ? 0.15 : 0), 0, 1) * (this.line < 0 ? 0.25 : 1);
    this.echoStrength = s;
    this.echoAcc += DT;
    if (this.echoAcc >= this.echoEvery) { this.echoAcc = 0; if (s > 0.12 || r.dashT > 0) this.pushEcho(r.dashT > 0 ? 1 : s); }
  }
  pushEcho(s) {
    const r = this.r, e = this.echoes[this.echoI];
    this.echoI = (this.echoI + 1) % this.echoes.length;
    e.born = this.t; e.x = r.x; e.y = r.y; e.z = r.z; e.ph = r.phase; e.sl = r.slidePose; e.air = r.airPose; e.s = s;
    e.hold = 0.16 + 0.45 * this.flow / 100;
  }
  changeLane(d) {
    const r = this.r;
    const nl = clamp(r.lane + d, 0, LANES - 1);
    if (nl === r.lane) return;
    if (r.lastLaneDir === -d && this.t - r.lastLaneT < 0.35) this.quality = Math.max(0, this.quality - 0.12); // jitter
    else this.quality = Math.min(1, this.quality + 0.03);
    r.lastLaneDir = d; r.lastLaneT = this.t; r.lane = nl;
  }

  proximity() {
    const r = this.r;
    const top = r.y + (r.slidePose > 0.5 ? 0.9 : 1.75), bottom = r.y;
    const near = this.nearWindow();
    let pressure = 0; // ternary pressure input for the line core
    const check = (a, isDog) => {
      if (!a.active) return;
      const dz = a.z - r.z, dx = a.x - r.x;
      const rad = RUNNER_R + a.radius * (isDog ? 1 : 1);
      const gap = Math.abs(dx) - rad;
      if (dz < -7 || dz > 1.2) {
        if (dz > 1.2 && !a.resolved) this.resolvePass(a, isDog, near);
        return;
      }
      if (dz < 0 && dz > -6) {
        if (gap < 0 && dz > -1.2) pressure = Math.min(pressure, -1);
        else if (gap >= 0 && gap < near * 1.4 && pressure >= 0) pressure = 1;
      }
      if (Math.abs(dz) < (isDog ? 0.55 : 0.5)) {
        if (gap < 0) {
          const tall = isDog ? 0.62 * a.scale : 1.75;
          if (bottom < tall) {
            if (!a.hit && r.invuln <= 0 && r.dashT <= 0) { a.hit = true; a.knock = 0.5; a.vx = dx >= 0 ? 2 : -2; this.contact(isDog ? 'DOG' : 'PEDESTRIAN', dx); }
          } else if (isDog) a.minBottom = Math.min(a.minBottom, bottom - tall);
        } else a.minGap = Math.min(a.minGap, gap);
      }
    };
    for (const a of this.ai.people) check(a, false);
    for (const d of this.ai.dogs) check(d, true);
    for (const o of this.obs) {
      if (!o.active) continue;
      const dz = o.z - r.z;
      const inSpan = r.x + RUNNER_R > o.x0 + 0.1 && r.x - RUNNER_R < o.x1 - 0.1;
      if (Math.abs(dz) < 0.4 && inSpan && !o.hit) {
        const blocked = o.type === 0 ? top > 1.05 : bottom < 0.62;
        if (blocked && r.invuln <= 0) { o.hit = true; this.contact(o.type === 0 ? 'BANNER' : 'BARRIER', 0); }
        else if (!blocked) o.under = true;
      }
      if (dz > 0.6 && !o.resolved) {
        o.resolved = true;
        if (o.under && !o.hit) { if (o.type === 0) this.reward('slide', 'SLIDE', 40, 5); else this.reward('hurdle', 'HURDLE', 40, 5); this.hurdles++; }
      }
    }
    return pressure;
  }
  resolvePass(a, isDog, near) {
    a.resolved = true;
    if (a.hit) return;
    if (isDog && a.minBottom !== Infinity) { this.hurdles++; this.reward('hurdle', a.minBottom < 0.35 ? 'DOG HURDLE CLOSE' : 'DOG HURDLE', a.minBottom < 0.35 ? 60 : 35, 6); return; }
    if (a.minGap === Infinity) return;
    if (a.minGap < near) { this.nearMisses++; this.reward('near', 'NEAR MISS', 50, 10, a.x - this.r.x); }
    else if (a.minGap < 1.5) { this.cleanPasses++; this.flow = Math.min(100, this.flow + 0.6); this.score += 5; }
  }

  // Ternary line core: every step resolves to -1 CONTACT, 0 COAST, +1 LOCK.
  lineCore(pressure) {
    const r = this.r;
    let next;
    if (r.stagger > 0) next = -1;
    else {
      const tq = trit((this.quality - 0.55) * 7);
      const tHold = this.flow >= 50 ? 1 : this.stamina < 15 ? -1 : 0;
      next = trit((pressure + tq + tHold) / 3, -0.34, 0.34);
    }
    // transition cost (stay / neutral / flip), rain makes flips pricier
    if (next !== this.line) {
      const flip = this.line !== 0 && next !== 0;
      const cost = (flip ? 5 : 1) * (this.ws.name === 'RAIN' ? 1.5 : 1);
      if (next < this.line) this.flow = Math.max(0, this.flow - cost * 0.6);
      this.lineHold = 0;
    } else this.lineHold += DT;
    this.line = next;
    const W = this.ws.name;
    if (next > 0) this.flow = Math.min(100, this.flow + (9 + Math.min(6, this.lineHold * 2)) * DT);
    else if (next === 0) this.flow = Math.max(0, this.flow - (W === 'CLEAR HAZE' ? 1 : 2.2) * DT);
    else this.flow = Math.max(0, this.flow - 30 * DT);
    this.lineHist[this.lineHistI] = next; this.lineHistI = (this.lineHistI + 1) % this.lineHist.length;
  }
}
