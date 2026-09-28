export const clamp = (v, a = 0, b = 1) => Math.min(b, Math.max(a, v));
export const median = (a) => {
  const s = a.filter(Number.isFinite).sort((x, y) => x - y);
  return s.length ? s[Math.floor(s.length / 2)] : 0;
};
export function recommendations(a = {}) {
  const list = [];
  if (a.fingers !== "none" && (a.leftHand !== "none" || a.rightHand !== "none"))
    list.push("fingerspeak");
  if (["eyes", "lips", "head"].some((k) => a[k] && a[k] !== "none"))
    list.push("facespeak");
  if (a.speech && a.speech !== "none") list.push("senseassist");
  return list;
}
// Continuous valid observations only. An unseen/occluded face is never sleep evidence.
export class RestTracker {
  constructor() {
    this.reset();
    this.lastPrompt = -Infinity;
  }
  reset() {
    this.closedSince = null;
    this.openSince = null;
    this.resting = false;
    this.last = null;
    this.motionSeen = false;
  }
  update({ t, valid, closed, motion }) {
    if (!valid || (this.last !== null && t - this.last > 1500)) {
      this.reset();
      return null;
    }
    this.last = t;
    if (closed) {
      this.openSince = null;
      if (motion > 0.04) {
        this.closedSince = null;
        return null;
      }
      this.closedSince ??= t;
      if (t - this.closedSince >= 60000) this.resting = true;
      return null;
    }
    this.closedSince = null;
    if (!this.resting) return null;
    this.openSince ??= t;
    if (motion > 0.012) this.motionSeen = true;
    if (t - this.openSince >= 2500 && this.motionSeen) {
      this.resting = false;
      this.openSince = null;
      this.motionSeen = false;
      if (t - this.lastPrompt > 300000) {
        this.lastPrompt = t;
        return "possible_wake";
      }
    }
    return null;
  }
}
export class SustainedCue {
  constructor(ms = 60000) {
    this.ms = ms;
    this.since = null;
    this.last = null;
    this.fired = false;
  }
  update(active, valid, t) {
    if (!valid || (this.last !== null && t - this.last > 1500) || !active) {
      this.since = null;
      this.fired = false;
    }
    this.last = t;
    if (!valid || !active) return false;
    this.since ??= t;
    if (!this.fired && t - this.since >= this.ms) {
      this.fired = true;
      return true;
    }
    return false;
  }
}
export class RequestGate {
  constructor() {
    this.pending = null;
    this.last = -Infinity;
  }
  propose(kind, text, source, t) {
    if (this.pending || t - this.last < 2500) return null;
    this.pending = { kind, text, source, at: t };
    return this.pending;
  }
  confirm(t) {
    if (
      !this.pending ||
      t - this.pending.at < 650 ||
      t - this.pending.at > 30000
    ) {
      if (this.pending && t - this.pending.at > 30000) this.pending = null;
      return null;
    }
    const p = this.pending;
    this.pending = null;
    this.last = t;
    return p;
  }
  cancel() {
    this.pending = null;
  }
}
export function poseFeatures(lm, previous) {
  const visible = (i) =>
    lm?.[i] &&
    Number.isFinite(lm[i].x) &&
    (lm[i].visibility ?? lm[i].score ?? 0) > 0.55;
  if (![11, 12].every(visible))
    return { valid: false, label: "Upper body not visible", motion: 0 };
  const l = lm[11],
    r = lm[12],
    width = Math.hypot(r.x - l.x, r.y - l.y);
  if (width < 0.055)
    return { valid: false, label: "Move camera closer", motion: 0 };
  const shoulderTilt =
    (Math.atan2(r.y - l.y, Math.abs(r.x - l.x)) * 180) / Math.PI;
  const center = { x: (l.x + r.x) / 2, y: (l.y + r.y) / 2 };
  let lean = null;
  if ([23, 24].every(visible)) {
    const hip = { x: (lm[23].x + lm[24].x) / 2, y: (lm[23].y + lm[24].y) / 2 };
    lean =
      (Math.atan2(center.x - hip.x, Math.abs(center.y - hip.y)) * 180) /
      Math.PI;
  }
  const motion = previous?.valid
    ? Math.hypot(center.x - previous.center.x, center.y - previous.center.y)
    : 0;
  const sideways = Math.abs(lean ?? shoulderTilt) > 25;
  return {
    valid: true,
    label:
      lean === null
        ? sideways
          ? "Shoulders tilted"
          : "Upper body centered"
        : Math.abs(lean) > 55
          ? "Reclined / sideways"
          : sideways
            ? "Leaning"
            : "Upright",
    shoulderTilt,
    lean,
    motion,
    center,
    sideways,
  };
}
// Camera-derived pulse trend, not blood pressure / oxygen saturation. Reject motion and weak spectra.
export function pulseEstimate(samples) {
  if (samples.length < 180)
    return {
      bpm: null,
      quality: 0,
      reason: "Collecting a stable 20-second signal",
    };
  const end = samples.at(-1).t,
    window = samples.filter((x) => x.t >= end - 20000),
    duration = (window.at(-1).t - window[0].t) / 1000;
  if (duration < 18 || window.some((x, i) => i && x.t - window[i - 1].t > 500))
    return { bpm: null, quality: 0, reason: "Keep still in steady light" };
  if (window.filter((x) => x.motion > 0.018).length / window.length > 0.12)
    return {
      bpm: null,
      quality: 0,
      reason: "Motion too high for a pulse estimate",
    };
  const means = [0, 1, 2].map(
    (k) => window.reduce((s, x) => s + x.rgb[k], 0) / window.length,
  );
  if (means.some((x) => x < 20 || x > 245))
    return { bpm: null, quality: 0, reason: "Adjust lighting" };
  const chrom = window.map((x) => {
    const [r, g, b] = x.rgb.map((v, k) => v / means[k] - 1);
    return { x: 3 * r - 2 * g, y: 1.5 * r + g - 1.5 * b };
  });
  const sd = (k) =>
    Math.sqrt(chrom.reduce((s, x) => s + x[k] ** 2, 0) / chrom.length);
  const alpha = sd("x") / Math.max(1e-9, sd("y"));
  const signal = chrom.map((x) => x.x - alpha * x.y);
  const power = [];
  for (let bpm = 45; bpm <= 150; bpm++) {
    let re = 0,
      im = 0;
    for (let i = 0; i < window.length; i++) {
      const w = 0.5 - 0.5 * Math.cos((2 * Math.PI * i) / (window.length - 1)),
        a = (((2 * Math.PI * bpm) / 60) * (window[i].t - window[0].t)) / 1000;
      re += signal[i] * w * Math.cos(a);
      im += signal[i] * w * Math.sin(a);
    }
    power.push({ bpm, p: re * re + im * im });
  }
  const peak = power.reduce((a, b) => (a.p > b.p ? a : b)),
    noise = median(
      power.filter((x) => Math.abs(x.bpm - peak.bpm) > 8).map((x) => x.p),
    );
  const ratio = peak.p / Math.max(1e-12, noise),
    quality = clamp((ratio - 3) / 17);
  return {
    bpm: ratio > 7 ? peak.bpm : null,
    quality,
    reason:
      ratio > 7
        ? "Camera pulse estimate · trend only"
        : "Signal not reliable enough",
    signal,
  };
}
