// Communication is distinct from the eye chart's natural-blink counter.
// Timing is evidence of a practiced pattern, not proof of human intention.
export const RAPID_BLINK = "RAPID_BLINK_REQUEST";
export const CONFIRM_BLINK = "BLINK_CONFIRM";
const median = (a) => [...a].sort((x, y) => x - y)[Math.floor(a.length / 2)];

export function rapidTriple(events) {
  const a = events.slice(-3);
  return a.length === 3 && a.every((e) => e.duration >= 65 && e.duration <= 500 && e.amplitude >= 0.08) &&
    a[2].timestamp - a[0].start <= 2400 &&
    a.slice(1).every((e, i) => e.start - a[i].timestamp >= 60 && e.start - a[i].timestamp <= 650);
}

export function blinkProfile(rapid, confirm) {
  const duration = median(rapid.map((e) => e.duration));
  return {
    version: 1,
    rapidMin: Math.max(65, duration * 0.55),
    rapidMax: Math.min(500, duration * 1.7 + 40),
    minAmplitude: Math.max(0.08, median(rapid.map((e) => e.amplitude)) * 0.65),
    confirmMin: Math.max(240, duration * 1.5, median(confirm.map((e) => e.duration)) * 0.7),
    confirmMax: Math.min(1400, median(confirm.map((e) => e.duration)) * 1.5 + 80),
  };
}

export class BlinkIntent {
  constructor(profile) {
    this.profile = profile?.version === 1 ? profile : null;
    this.seen = null;
    this.reset();
  }
  reset() {
    this.mode = "request";
    this.events = [];
    this.openSince = null;
    this.armed = false;
    this.readyAt = Infinity;
  }
  waitForQuestion() {
    this.reset();
    this.mode = "question";
  }
  questionFinished(t) {
    if (this.mode !== "question") return;
    this.mode = "confirm";
    this.readyAt = t;
    this.openSince = null;
    this.armed = false;
  }
  update(eye, t, valid = true) {
    if (!this.profile) return null;
    const e = eye?.last;
    const fresh = e && e.timestamp !== this.seen;
    if (fresh) this.seen = e.timestamp;
    if (!valid || !eye || ["UNAVAILABLE", "LEARNING OPEN"].includes(eye.state)) {
      this.events = [];
      this.openSince = null;
      this.armed = false;
      return null;
    }
    if (this.mode === "question") return null;
    if (eye.state === "OPEN") {
      this.openSince ??= t;
      if (t - this.openSince >= 600 && (this.mode !== "confirm" || this.openSince >= this.readyAt)) this.armed = true;
    } else this.openSince = null;
    if (!fresh) return null;
    const p = this.profile;
    if (this.mode === "confirm") {
      const accepted = this.armed && e.start >= this.readyAt && e.duration >= p.confirmMin &&
        e.duration <= p.confirmMax && e.amplitude >= p.minAmplitude;
      this.armed = false;
      this.openSince = null;
      if (accepted) { this.reset(); return CONFIRM_BLINK; }
      return null;
    }
    if ((!this.armed && !this.events.length) || e.duration < p.rapidMin || e.duration > p.rapidMax || e.amplitude < p.minAmplitude) {
      this.events = [];
      this.armed = false;
      return null;
    }
    if (this.events.length && (e.start - this.events.at(-1).timestamp > 650 || e.start - this.events.at(-1).timestamp < 60)) this.events = [];
    this.events.push(e);
    this.armed = false;
    if (rapidTriple(this.events)) { this.waitForQuestion(); return RAPID_BLINK; }
    this.events = this.events.slice(-2);
    return null;
  }
}
