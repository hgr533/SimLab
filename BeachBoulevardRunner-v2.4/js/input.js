// Input: keyboard, mouse, Gamepad API, touch swipes. Edge-triggered actions are buffered and
// consumed by exactly one fixed sim step, so input is deterministic per step.
export class Input {
  constructor(canvas, hooks) {
    this.hooks = hooks; // { onKey(code) -> bool handled }
    this.q = { left: 0, right: 0, jump: false, slide: false, dash: false, nextWeather: 0, start: false };
    this.sprintKey = false; this.sprintPad = false;
    this.pad = { prev: [], stickArmed: true, lastIndex: -1 };
    this.usedTouch = false;
    window.addEventListener('keydown', (e) => this.key(e, true));
    window.addEventListener('keyup', (e) => this.key(e, false));
    canvas.addEventListener('mousedown', (e) => { if (e.target && e.target.closest && e.target.closest('button, input, label, #settings .card')) return; if (e.button === 0) { this.q.dash = true; this.q.start = true; } });
    canvas.addEventListener('contextmenu', (e) => e.preventDefault());
    // touch: swipe left/right lane, up jump, down slide, tap dash
    let sx = 0, sy = 0, st = 0, active = false;
    const isUi = (e) => e.target && e.target.closest && e.target.closest('button, input, label, #settings .card');
    canvas.addEventListener('touchstart', (e) => {
      if (isUi(e)) return;
      const t = e.changedTouches[0]; sx = t.clientX; sy = t.clientY; st = performance.now(); active = true; this.usedTouch = true;
      e.preventDefault();
    }, { passive: false });
    canvas.addEventListener('touchmove', (e) => {
      if (!active) return;
      const t = e.changedTouches[0]; const dx = t.clientX - sx, dy = t.clientY - sy;
      if (Math.hypot(dx, dy) > 42) { this.swipe(dx, dy); active = false; }
      e.preventDefault();
    }, { passive: false });
    canvas.addEventListener('touchend', (e) => {
      if (!active) return; active = false;
      const t = e.changedTouches[0]; const dx = t.clientX - sx, dy = t.clientY - sy;
      if (Math.hypot(dx, dy) < 20 && performance.now() - st < 300) { this.q.dash = true; this.q.start = true; }
      else if (Math.hypot(dx, dy) >= 20) this.swipe(dx, dy);
      e.preventDefault();
    }, { passive: false });
  }
  swipe(dx, dy) {
    if (Math.abs(dx) > Math.abs(dy)) { if (dx < 0) this.q.left++; else this.q.right++; }
    else if (dy < 0) this.q.jump = true; else this.q.slide = true;
    this.q.start = true;
  }
  key(e, down) {
    const c = e.code;
    const game = ['ArrowLeft', 'ArrowRight', 'ArrowUp', 'ArrowDown', 'Space', 'F3', 'ShiftLeft', 'ShiftRight'];
    if (game.includes(c)) e.preventDefault();
    if (c === 'ArrowUp' || c === 'KeyW') this.sprintKey = down;
    if (!down || e.repeat) return;
    if (this.hooks.onKey && this.hooks.onKey(c)) return;
    switch (c) {
      case 'ArrowLeft': case 'KeyA': this.q.left++; break;
      case 'ArrowRight': case 'KeyD': this.q.right++; break;
      case 'Space': this.q.jump = true; this.q.start = true; break;
      case 'ShiftLeft': case 'ShiftRight': case 'ArrowDown': case 'KeyS': this.q.slide = true; break;
      case 'KeyN': this.q.nextWeather++; break;
      case 'Enter': this.q.start = true; break;
      default: break;
    }
  }
  pollGamepad() {
    const pads = navigator.getGamepads ? navigator.getGamepads() : [];
    let gp = null;
    for (const p of pads) if (p && p.connected) { gp = p; break; }
    if (!gp) { this.sprintPad = false; return null; }
    const b = gp.buttons.map((x) => x.pressed || x.value > 0.5);
    const prev = this.pad.prev;
    const edge = (i) => b[i] && !prev[i];
    if (edge(0)) { this.q.jump = true; this.q.start = true; }   // A / Cross
    if (edge(1)) this.q.slide = true;                            // B / Circle
    if (edge(2) || edge(7)) this.q.dash = true;                  // X / RT
    if (edge(14)) this.q.left++;                                 // dpad left
    if (edge(15)) this.q.right++;                                // dpad right
    if (edge(13)) this.q.slide = true;                           // dpad down
    if (edge(9)) { this.q.start = true; if (this.hooks.onPause) this.hooks.onPause(); }
    const ax = gp.axes[0] || 0, ay = gp.axes[1] || 0;
    if (this.pad.stickArmed && Math.abs(ax) > 0.6) { if (ax < 0) this.q.left++; else this.q.right++; this.pad.stickArmed = false; }
    if (Math.abs(ax) < 0.3) this.pad.stickArmed = true;
    this.sprintPad = b[5] || b[12] || ay < -0.6;                 // RB / dpad up / stick up
    this.pad.prev = b;
    return gp.id;
  }
  // Called once per fixed sim step.
  consume() {
    const q = this.q;
    const out = { left: q.left, right: q.right, jump: q.jump, slide: q.slide, dash: q.dash, nextWeather: q.nextWeather, sprint: this.sprintKey || this.sprintPad, start: q.start };
    q.left = 0; q.right = 0; q.jump = false; q.slide = false; q.dash = false; q.nextWeather = 0; q.start = false;
    return out;
  }
}
