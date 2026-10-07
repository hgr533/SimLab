// Beach Boulevard Runner v2.5.24 - graphics auto-tuner. Bayesian optimisation: a tiny Gaussian process (RBF kernel on
// inputs normalised to 0..1, standardised outputs, hyper-parameters picked by marginal likelihood on a small grid)
// plus Expected Improvement. Each trial runs one quality configuration for a few seconds of real play and measures
// the real requestAnimationFrame frame times. Score: visual quality (a fixed, known function of the settings) minus
// a penalty when the average FPS falls below 95 % of the target or the 1% low under 85 % of it. Because quality is
// known exactly, the GP models the measured FPS headroom ("slack") and the next trial maximises constrained EI:
// (quality gain over the best config that held the target) x P(headroom >= 0). Matrices are at most 20 x 20; the
// fit runs once per trial, between frames.
// Pure logic (no DOM / three.js), so tools/v2524-gp-test.mjs can unit-test it in node.
import { makeRng } from './rng.js';

export const DIMS = ['res', 'lod', 'crowd', 'traffic'];
export const TUNE = { trials: 16, starts: 5, settle: 0.6, measure: 3.5, maxStep: 0.6, lowFrac: 0.85, avgFrac: 0.95 };

// ---------- quality model (what "better looking" means, 0..1) and the measured objective
export function quality(u) { return 0.42 * Math.pow(u[0], 0.8) + 0.25 * Math.pow(u[1], 0.9) + 0.2 * u[2] + 0.13 * u[3]; }
export function penalty(avg, low, target) {
  return 4 * Math.max(0, TUNE.avgFrac - avg / target) + 3 * Math.max(0, TUNE.lowFrac - low / target);
}
export function objective(u, avg, low, target) { return quality(u) - penalty(avg, low, target); }

// ---------- frame statistics from rAF intervals (ms): average FPS and 1% low (mean rate of the slowest 1 %, >= 2 frames)
export function frameStats(dts) {
  const n = dts.length; if (!n) return { avg: 0, low: 0, n: 0 };
  let sum = 0; for (const d of dts) sum += d;
  const a = Float64Array.from(dts).sort(), k = Math.max(2, Math.round(n * 0.01));
  let s = 0; for (let j = n - Math.min(k, n); j < n; j++) s += a[j];
  return { avg: 1000 * n / sum, low: 1000 * Math.min(k, n) / s, n, p2: a[Math.floor(n * 0.02)] };
}

// ---------- Gaussian process (RBF) + Expected Improvement
function kern(a, b, ls) { let d = 0; for (let i = 0; i < a.length; i++) { const t = (a[i] - b[i]) / ls; d += t * t; } return Math.exp(-0.5 * d); }
function cholesky(A, n) { // in place lower triangle; returns false if not positive definite
  const L = new Float64Array(n * n);
  for (let i = 0; i < n; i++) for (let j = 0; j <= i; j++) {
    let s = A[i * n + j]; for (let k = 0; k < j; k++) s -= L[i * n + k] * L[j * n + k];
    if (i === j) { if (s <= 1e-12) return null; L[i * n + i] = Math.sqrt(s); } else L[i * n + j] = s / L[j * n + j];
  }
  return L;
}
function solveL(L, n, b) { const x = new Float64Array(n); for (let i = 0; i < n; i++) { let s = b[i]; for (let k = 0; k < i; k++) s -= L[i * n + k] * x[k]; x[i] = s / L[i * n + i]; } return x; }
function solveLT(L, n, b) { const x = new Float64Array(n); for (let i = n - 1; i >= 0; i--) { let s = b[i]; for (let k = i + 1; k < n; k++) s -= L[k * n + i] * x[k]; x[i] = s / L[i * n + i]; } return x; }
export function gpFit(X, y, grid = { ls: [0.15, 0.25, 0.4, 0.6, 0.9], sn2: [1e-4, 0.003, 0.02, 0.08] }) {
  const n = X.length; let m = 0; for (const v of y) m += v; m /= n;
  let sd = 0; for (const v of y) sd += (v - m) * (v - m); sd = Math.sqrt(sd / Math.max(1, n - 1)) || 1;
  const ys = y.map((v) => (v - m) / sd);
  let best = null;
  for (const ls of grid.ls) for (const sn2 of grid.sn2) {
    const K = new Float64Array(n * n);
    for (let i = 0; i < n; i++) for (let j = 0; j < n; j++) K[i * n + j] = kern(X[i], X[j], ls) + (i === j ? sn2 : 0);
    const L = cholesky(K, n); if (!L) continue;
    const alpha = solveLT(L, n, solveL(L, n, ys));
    let lml = 0; for (let i = 0; i < n; i++) lml += -0.5 * ys[i] * alpha[i] - Math.log(L[i * n + i]);
    if (!best || lml > best.lml) best = { lml, ls, sn2, L, alpha };
  }
  return { X, n, m, sd, ...best };
}
export function gpPredict(g, x) {
  const n = g.n, k = new Float64Array(n);
  for (let i = 0; i < n; i++) k[i] = kern(x, g.X[i], g.ls);
  let mu = 0; for (let i = 0; i < n; i++) mu += k[i] * g.alpha[i];
  const v = solveL(g.L, n, k); let vv = 0; for (let i = 0; i < n; i++) vv += v[i] * v[i];
  const s2 = Math.max(1e-12, 1 - vv);
  return { mu: g.m + g.sd * mu, sigma: g.sd * Math.sqrt(s2) };
}
function erf(x) { // Abramowitz-Stegun 7.1.26
  const s = x < 0 ? -1 : 1; x = Math.abs(x);
  const t = 1 / (1 + 0.3275911 * x);
  return s * (1 - (((((1.061405429 * t - 1.453152027) * t) + 1.421413741) * t - 0.284496736) * t + 0.254829592) * t * Math.exp(-x * x));
}
export const normCdf = (z) => 0.5 * (1 + erf(z / Math.SQRT2));
export const normPdf = (z) => Math.exp(-0.5 * z * z) / Math.sqrt(2 * Math.PI);
export function expectedImprovement(mu, sigma, best, xi = 0.01) {
  if (sigma < 1e-9) return Math.max(0, mu - best - xi);
  const z = (mu - best - xi) / sigma;
  return (mu - best - xi) * normCdf(z) + sigma * normPdf(z);
}
const clamp01 = (v) => (v < 0 ? 0 : v > 1 ? 1 : v);
// FPS headroom of a measured trial: >= 0 when it holds the target (avg >= 95 %, 1% low >= 85 %)
export function slack(avg, low, target) { return Math.min(avg / target - TUNE.avgFrac, low / target - TUNE.lowFrac); }
// next point: constrained EI over random candidates (near the incumbent, and anywhere), each within maxStep of the
// config on screen now (gradual changes)
export function proposeEI(trials, from, rng, opt = {}) {
  const X = trials.map((t) => t.u), g = gpFit(X, trials.map((t) => t.slack)), step = opt.maxStep ?? TUNE.maxStep;
  let inc = null; for (const t of trials) if (t.slack >= 0 && (!inc || t.q > inc.q)) inc = t;      // best config that held the target
  let anchor = inc; if (!anchor) { anchor = trials[0]; for (const t of trials) if (t.slack > anchor.slack) anchor = t; }
  const qBest = inc ? inc.q : null;
  let top = null, topS = -1, topEi = 0, topPf = 0;
  const near = (c) => c.every((v, j) => Math.abs(v - from[j]) <= step + 1e-9);
  const tryX = (c) => {
    if (!near(c)) return;
    const p = gpPredict(g, c), pf = normCdf(p.mu / Math.max(p.sigma, 1e-6)), q = quality(c);
    // no feasible config yet: look for one (probability first, quality as a tie-break)
    const ei = qBest === null ? 0 : Math.max(0, q - qBest - (opt.xi ?? 0.002)) * pf;
    const sc = qBest === null ? pf + 0.05 * q : ei;
    if (sc > topS) { topS = sc; top = c; topEi = ei; topPf = pf; }
  };
  const box = (c0, r, n) => { for (let i = 0; i < n; i++) tryX(c0.map((v) => clamp01(v + (rng.next() * 2 - 1) * r))); };
  box(anchor.u, 0.3, opt.cands ?? 400);  // around the incumbent
  box(anchor.u, 0.08, 150);              // fine moves around it
  box(from, step, 250);                  // anywhere reachable from the config on screen
  if (!top) top = anchor.u.map((v, j) => clamp01(Math.max(from[j] - step, Math.min(from[j] + step, v))));
  return { x: top, ei: topEi, pFeasible: topPf, gp: { ls: g.ls, sn2: g.sn2 } };
}
// random starts: a Latin hypercube, visited nearest-first and clipped to the step box (no wild jumps)
export function startPoints(from, n, rng, step = TUNE.maxStep) {
  const d = from.length, cols = Array.from({ length: d }, () => { const a = Array.from({ length: n }, (_, i) => (i + rng.next()) / n); for (let i = n - 1; i > 0; i--) { const j = Math.floor(rng.next() * (i + 1)); [a[i], a[j]] = [a[j], a[i]]; } return a; });
  const pts = Array.from({ length: n }, (_, i) => cols.map((c) => c[i]));
  const out = []; let cur = from;
  while (pts.length) {
    let bi = 0, bd = 1e9; pts.forEach((p, i) => { const dd = p.reduce((s, v, j) => s + (v - cur[j]) ** 2, 0); if (dd < bd) { bd = dd; bi = i; } });
    const p = pts.splice(bi, 1)[0].map((v, j) => clamp01(Math.max(cur[j] - step, Math.min(cur[j] + step, v))));
    out.push(p); cur = p;
  }
  return out;
}

// ---------- the tuner state machine (driven once per rendered frame by main.js)
export class AutoTuner {
  constructor(seed = 0x7a11) { this.rng = makeRng(seed); this.state = 'idle'; this.trials = []; this.plan = []; this.dts = []; this.allDts = []; }
  get active() { return this.state === 'trial'; }
  get index() { return this.trials.length + (this.active ? 1 : 0); }
  // from: current normalised config (usually all 1 = the preset itself); target: FPS (null = auto from the display)
  start(from, target) {
    this.state = 'trial'; this.trials = []; this.targetSel = target; this.allDts = []; this.confirming = false; this.best = null;
    this.target = target || 60;
    this.plan = [from.slice(), ...startPoints(from, TUNE.starts - 1, this.rng)];
    this.begin(this.plan.shift());
  }
  begin(u) { this.u = u.map((v) => Math.round(v * 1000) / 1000); this.settle = TUNE.settle; this.measured = 0; this.dts = []; this.last = -1; this.changed = true; }
  stop() { this.state = 'idle'; this.plan = []; }
  // display-rate guess for "Auto": the fastest frames (2nd percentile interval) tell the refresh; capped at 60
  autoTarget() {
    const st = frameStats(this.allDts); if (st.n < 60) return 60;
    const hz = 1000 / st.p2; return hz >= 56 ? 60 : hz >= 46 ? 50 : 60;
  }
  // now: rAF time (ms); ok: the frame counts (running, not paused, SET closed, tab visible). Returns 'next' when a
  // trial ended and a new config must be applied, 'done' when finished, else null.
  frame(now, ok) {
    if (this.state !== 'trial') return null;
    if (!ok) { this.last = -1; this.settle = Math.max(this.settle, 0.3); return null; }
    if (this.last < 0) { this.last = now; return null; }
    const dt = now - this.last; this.last = now;
    if (!(dt > 0 && dt < 500)) return null;
    if (this.settle > 0) { this.settle -= dt / 1000; return null; } // discard frames right after a change
    this.dts.push(dt); this.allDts.push(dt); this.measured += dt / 1000;
    if (this.measured < TUNE.measure) return null;
    if (!this.targetSel) this.target = this.autoTarget();
    const st = frameStats(this.dts);
    this.trials.push({ u: this.u, avg: st.avg, low: st.low, frames: st.n, q: quality(this.u) });
    // re-score every trial with the current target (the auto target can settle after the first trials)
    for (const t of this.trials) { t.J = objective(t.u, t.avg, t.low, this.target); t.slack = slack(t.avg, t.low, this.target); }
    if (this.confirming) return this.finish();
    if (this.trials.length >= TUNE.trials - 1) { // last trial: measure the winner again before it is kept
      this.confirming = true; this.begin(this.pickBest(this.trials).u); return 'next';
    }
    let nx = this.plan.shift();
    if (!nx) { const pr = proposeEI(this.trials, this.u, this.rng); nx = pr.x; this.lastEI = pr; }
    this.begin(nx);
    return 'next';
  }
  // best = highest score (a config that held the target always beats one that did not: its penalty is 0)
  pickBest(list) { let b = list[0]; for (const t of list) if (t.J > b.J) b = t; return b; }
  finish() {
    const conf = this.trials[this.trials.length - 1], search = this.trials.slice(0, -1);
    conf.confirm = true;
    if (conf.slack >= 0) this.best = conf; // the winner held the target twice: keep it with the confirmation numbers
    else { // it did not hold up: the best other config with some headroom (else the one with the most headroom)
      const safe = search.filter((t) => t.slack >= 0.01 && t.u.join() !== conf.u.join());
      this.best = safe.length ? this.pickBest(safe) : search.reduce((a, t) => (t.slack > a.slack ? t : a), search[0]);
    }
    this.state = 'done'; this.confirming = false;
    return 'done';
  }
}
