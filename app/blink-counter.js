// Observations from the same raw EAR values plotted on the screen.
// This counter NEVER emits communication commands or changes gesture calibration.
const median = (values) => {
  const sorted = [...values].sort((a, b) => a - b);
  const mid = Math.floor(sorted.length / 2);
  return sorted.length % 2 ? sorted[mid] : (sorted[mid - 1] + sorted[mid]) / 2;
};
export class BlinkCounter {
  constructor() {
    this.total = 0;
    this.times = [];
    this.last = null;
    this.lastTime = null;
    this.cooldown = -Infinity;
    this.resetCycle();
  }
  resetCycle() {
    this.state = "LEARNING OPEN";
    this.samples = [];
    this.reference = null;
    this.cycle = null;
  }
  sample(f, t) {
    this.samples.push({ t, left: f.earLeft, right: f.earRight });
    this.samples = this.samples.filter((s) => t - s.t <= 1200);
    this.reference = {
      left: median(this.samples.map((s) => s.left)),
      right: median(this.samples.map((s) => s.right)),
    };
  }
  snapshot(t, reason = "") {
    this.times = this.times.filter((x) => t - x < 60000);
    const r = this.reference;
    return {
      state: this.state,
      total: this.total,
      count: this.times.length,
      last: this.last,
      reference: r,
      // These are the actual per-eye dip thresholds, not an unrelated saved
      // command baseline. A completed reopening, not the dip alone, counts.
      close: r
        ? (r.left -
            Math.max(0.018, r.left * 0.08) +
            (r.right - Math.max(0.018, r.right * 0.08))) /
          2
        : null,
      reason,
    };
  }
  update(f, t) {
    const gap = this.lastTime === null ? 0 : t - this.lastTime;
    if (!Number.isFinite(t) || (this.lastTime !== null && gap <= 0)) {
      this.resetCycle();
      return this.snapshot(this.lastTime || 0, "Non-monotonic observation");
    }
    this.lastTime = t;
    const valid =
      f.facePresent &&
      f.faceQuality >= 0.65 &&
      [f.earLeft, f.earRight].every(
        (n) => Number.isFinite(n) && n > 0.015 && n < 1.5,
      );
    if (!valid || gap > 220 || Math.abs(f.poseSpeed || 0) > 100) {
      this.resetCycle();
      this.state = valid ? "LEARNING OPEN" : "UNAVAILABLE";
      return this.snapshot(t, "Waiting for continuous, steady eye tracking");
    }
    if (
      !this.reference ||
      this.state === "LEARNING OPEN" ||
      this.state === "UNAVAILABLE"
    ) {
      // Starting with closed eyes must not count an opening as a blink.
      if (
        Math.min(f.earLeft, f.earRight) < 0.12 ||
        (f.eyeBlinkLeft > 0.7 && f.eyeBlinkRight > 0.7)
      ) {
        this.resetCycle();
        return this.snapshot(
          t,
          "Open both eyes briefly to learn their resting level",
        );
      }
      this.state = "LEARNING OPEN";
      this.sample(f, t);
      if (this.samples.length >= 4 && t - this.samples[0].t >= 300)
        this.state = "OPEN";
      return this.snapshot(
        t,
        this.state === "OPEN" ? "" : "Learning your current open-eye level",
      );
    }
    const r = this.reference;
    const leftDip = r.left - f.earLeft >= Math.max(0.018, r.left * 0.08);
    const rightDip = r.right - f.earRight >= Math.max(0.018, r.right * 0.08);
    const dipped = leftDip && rightDip;
    if (this.state === "OPEN") {
      if (dipped && t >= this.cooldown) {
        this.cycle = {
          start: t,
          left: r.left,
          right: r.right,
          minLeft: f.earLeft,
          minRight: f.earRight,
          lows: 1,
          opening: null,
          returns: 0,
        };
        this.state = "CLOSING";
      } else if (!leftDip && !rightDip) this.sample(f, t);
      return this.snapshot(t);
    }
    const c = this.cycle;
    c.minLeft = Math.min(c.minLeft, f.earLeft);
    c.minRight = Math.min(c.minRight, f.earRight);
    if (t - c.start > 1400) {
      // Do not repeatedly count a sustained closure or silently retain a stale
      // peak forever. Re-arm only after another observed open-eye plateau.
      this.resetCycle();
      return this.snapshot(t, "Sustained closure is not a completed blink");
    }
    const recovered =
      f.earLeft >= c.left - (c.left - c.minLeft) * 0.2 &&
      f.earRight >= c.right - (c.right - c.minRight) * 0.2;
    if (recovered) {
      c.opening ??= t;
      c.returns++;
      this.state = "OPENING";
      if (c.returns >= 2 && t - c.opening >= 25) {
        const duration = c.opening - c.start;
        if (c.lows >= 2 && duration >= 65) {
          this.total++;
          this.times.push(t);
          this.last = {
            timestamp: t,
            duration,
            source: "bilateral EAR dip",
            deliberate: false,
          };
        }
        this.state = "OPEN";
        this.cycle = null;
        this.cooldown = t + 100;
        this.sample(f, t);
      }
    } else {
      if (dipped) c.lows++;
      c.opening = null;
      c.returns = 0;
      this.state = c.lows >= 2 ? "CLOSED / DIP" : "CLOSING";
    }
    return this.snapshot(t);
  }
}
