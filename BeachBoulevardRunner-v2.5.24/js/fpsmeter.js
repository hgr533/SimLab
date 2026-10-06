// Beach Boulevard Runner v2.5.22 - FPS overlay (SET > Show FPS). Measures the real display rate from
// requestAnimationFrame timestamps; paused / hidden time is never counted (the first frame after a pause starts a
// new interval). The DOM text is refreshed ~4x per second; nothing is drawn in WebGL (no extra render passes).
const WIN = 2048; // frame-interval ring buffer (enough for 10 s at 144 Hz+)

export class FpsMeter {
  constructor(root) {
    this.root = root;
    this.el = { fps: root.querySelector('#fpsNow'), ms: root.querySelector('#fpsMs'), avg: root.querySelector('#fpsAvg'), low: root.querySelector('#fpsLow'), min: root.querySelector('#fpsMin'), info: root.querySelector('#fpsInfo') };
    this.dts = new Float32Array(WIN); this.ts = new Float64Array(WIN); this.head = 0; this.count = 0;
    this.scratch = new Float32Array(WIN);
    this.on = false; this.last = -1; this.nextText = 0;
    this.reset();
  }
  reset() { this.frames = 0; this.time = 0; this.count = 0; this.head = 0; this.last = -1; this.nextText = 0; }
  setOn(on) { this.on = !!on; this.root.style.display = this.on ? 'block' : 'none'; this.reset(); }
  // now: rAF timestamp (ms). skip: '' (count) or a label ('PAUSED', 'SET OPEN', 'HIDDEN') -> not counted, interval restarts
  tick(now, skip, info) {
    if (!this.on) return;
    if (skip) { this.last = -1; if (now >= this.nextText) this.text(now, info, skip === true ? 'PAUSED' : skip); return; }
    if (this.last >= 0) {
      const dt = now - this.last;
      if (dt > 0 && dt < 500) { // longer gaps = the tab was suspended, not a frame
        this.dts[this.head] = dt; this.ts[this.head] = now; this.head = (this.head + 1) % WIN; if (this.count < WIN) this.count++;
        this.frames++; this.time += dt;
      }
    }
    this.last = now;
    if (now >= this.nextText) this.text(now, info, false);
  }
  text(now, info, paused) {
    this.nextText = now + 250;
    const E = this.el;
    // current: frames in the last ~0.5 s; 1% low / min: last 10 s
    let n = 0, sum = 0, m = 0;
    for (let k = 1; k <= this.count; k++) {
      const i = (this.head - k + WIN) % WIN;
      const age = now - this.ts[i];
      if (age > 10000) break;
      if (sum < 500) { n++; sum += this.dts[i]; } // ~0.5 s of the newest frames
      this.scratch[m++] = this.dts[i];
    }
    if (paused) { E.fps.textContent = paused; E.fps.className = 'fpsv'; E.ms.textContent = ''; }
    else if (n > 0) {
      const fps = n * 1000 / sum;
      E.fps.textContent = fps.toFixed(0) + ' FPS'; E.ms.textContent = (sum / n).toFixed(1) + ' ms';
      E.fps.className = 'fpsv ' + (fps >= 55 ? 'good' : fps >= 30 ? 'mid' : 'bad');
    } else { E.fps.textContent = '-- FPS'; E.fps.className = 'fpsv'; E.ms.textContent = ''; }
    E.avg.textContent = this.time > 0 ? (this.frames * 1000 / this.time).toFixed(1) : '--';
    if (m > 0) {
      // 1% low = average rate of the slowest 1% of frames in the last 10 s (at least one frame); min = slowest frame
      const a = this.scratch.subarray(0, m); a.sort();
      const k = Math.max(1, Math.round(m * 0.01)); let s = 0; for (let j = m - k; j < m; j++) s += a[j];
      E.low.textContent = (1000 * k / s).toFixed(0); E.min.textContent = (1000 / a[m - 1]).toFixed(0);
    } else { E.low.textContent = '--'; E.min.textContent = '--'; }
    if (info) E.info.textContent = info();
  }
}
