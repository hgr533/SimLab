// DOM HUD: score, FLOW %, COMBO xN, STAMINA %, ternary line badge + history strip, weather chip, toasts.
// v2.1: HEAT chip, combo pulse, screen-edge flash (CSS only, no render target), results screen.
const $ = (id) => document.getElementById(id);
export class Hud {
  constructor() {
    this.el = {
      score: $('score'), dist: $('dist'), flowBar: $('flowBar'), flowTxt: $('flowTxt'), combo: $('combo'),
      stamBar: $('stamBar'), stamTxt: $('stamTxt'), trit: $('trit'), tritTxt: $('tritTxt'), weather: $('weather'),
      wsub: $('wsub'), pops: $('pops'), toast: $('toast'), debug: $('debug'), hist: $('hist'),
      heat: $('heat'), flash: $('flash'), comboBox: $('comboBox'),
    };
    this.hctx = this.el.hist.getContext('2d');
    this.acc = 0; this.toastT = 0; this.lastLine = 9; this.lastCombo = 1; this.lastHeat = 0;
  }
  pop(text, kind) {
    if (!text) return;
    const d = document.createElement('div');
    d.className = 'pop ' + kind; d.textContent = text;
    this.el.pops.appendChild(d);
    setTimeout(() => d.remove(), 1100);
    while (this.el.pops.children.length > 5) this.el.pops.firstChild.remove();
  }
  flash(kind) {
    const f = this.el.flash; if (!f) return;
    f.className = ''; void f.offsetWidth; f.className = 'f-' + kind;
  }
  results(r) {
    $('grade').textContent = r.grade; $('grade').className = 'grade g' + r.grade;
    $('gradeLabel').textContent = r.label;
    $('newBest').style.display = r.newBest ? 'block' : 'none';
    const rows = [
      ['Score', r.score + (r.newBest ? '  NEW' : '')], ['Distance', r.dist + ' m'], ['Time', r.time],
      ['Near misses', r.near], ['Leash hops', r.leash], ['Hurdles', r.hurdles],
      ['Flow orbs', r.orbs + ' (' + r.trails + ' trails)'], ['Drinks', r.drinks], ['Best combo', 'x' + r.bestCombo],
      ['Peak HEAT', r.heat], ['Contacts', r.hits], ['Best score', r.best],
    ];
    $('statGrid').innerHTML = rows.map(([k, v]) => '<div class="sk">' + k + '</div><div class="sv">' + v + '</div>').join('');
    $('career').textContent = 'Runs ' + r.runs + '   Total ' + (r.total / 1000).toFixed(1) + ' km   Longest ' + r.longest + ' m   Most near misses ' + r.mostNear;
  }
  toast(text, sec = 2.5) { this.el.toast.textContent = text; this.el.toast.classList.add('show'); this.toastT = sec; }
  update(sim, dt) {
    if (this.toastT > 0) { this.toastT -= dt; if (this.toastT <= 0) this.el.toast.classList.remove('show'); }
    this.acc += dt;
    if (this.acc < 1 / 20) return; // HUD refresh at 20 Hz keeps DOM work tiny
    this.acc = 0;
    const e = this.el;
    e.score.textContent = Math.floor(sim.score).toString();
    e.dist.textContent = Math.floor(sim.distance) + ' m';
    e.flowBar.style.width = sim.flow.toFixed(1) + '%'; e.flowTxt.textContent = Math.round(sim.flow) + '%';
    e.combo.textContent = 'x' + sim.combo;
    if (sim.combo > this.lastCombo && e.comboBox) { e.comboBox.classList.remove('bump'); void e.comboBox.offsetWidth; e.comboBox.classList.add('bump'); }
    this.lastCombo = sim.combo;
    if (e.heat && sim.heat !== this.lastHeat) { this.lastHeat = sim.heat; e.heat.textContent = 'HEAT ' + sim.heat + '  x' + sim.H.mul.toFixed(1); e.heat.className = 'heat h' + sim.heat; }
    e.stamBar.style.width = sim.stamina.toFixed(1) + '%'; e.stamTxt.textContent = Math.round(sim.stamina) + '%';
    e.stamBar.classList.toggle('low', sim.stamina < 25);
    if (sim.line !== this.lastLine) {
      this.lastLine = sim.line;
      e.trit.className = 'trit ' + (sim.line > 0 ? 'lock' : sim.line < 0 ? 'contact' : 'coast');
      e.tritTxt.textContent = sim.line > 0 ? '+1 LOCK' : sim.line < 0 ? '-1 CONTACT' : '0 COAST';
    }
    e.weather.textContent = sim.ws.name + '  /  ' + sim.ws.verb;
    e.wsub.textContent = sim.ws.sub;
    const g = this.hctx, H = sim.lineHist, n = H.length, w = e.hist.width / n;
    g.clearRect(0, 0, e.hist.width, e.hist.height);
    for (let i = 0; i < n; i++) {
      const v = H[(sim.lineHistI + i) % n];
      g.fillStyle = v > 0 ? '#5dff8a' : v < 0 ? '#ff4b3e' : '#5a8cff';
      const h = v > 0 ? 14 : v < 0 ? 14 : 6;
      g.fillRect(i * w, v < 0 ? 16 : 16 - h, Math.max(1, w - 0.5), h);
    }
  }
}
