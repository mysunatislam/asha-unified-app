// VitalSense's forehead/cheek POS + FFT pipeline, extracted from the requested
// neurobridge-asha-unified-web/vitalsense module for the shared camera stream.
// All timestamps are monotonic milliseconds. No camera or network is opened here.
const FPS = 30;
const HR_SECONDS = 12;
const BR_SECONDS = 30;
const MIN_HR = 42;
const MAX_HR = 200;
const mean = (a) => a.reduce((s, x) => s + x, 0) / a.length;
const clamp = (x, a = 0, b = 1) => Math.max(a, Math.min(b, x));
const median = (a) => {
  const s = [...a].sort((x, y) => x - y), m = Math.floor(s.length / 2);
  return s.length % 2 ? s[m] : (s[m - 1] + s[m]) / 2;
};
const std = (a) => {
  const m = mean(a);
  return Math.sqrt(mean(a.map((v) => (v - m) ** 2)));
};
const nextPow2 = (n) => { let p = 1; while (p < n) p *= 2; return p; };

export function posSignal(rows) {
  const means = [0, 1, 2].map((k) => mean(rows.map((r) => r.rgb[k])));
  if (means.some((x) => !Number.isFinite(x) || x <= 0)) return [];
  const s1 = [], s2 = [];
  for (const row of rows) {
    const [r, g, b] = row.rgb.map((v, k) => v / means[k]);
    s1.push(g - b);
    s2.push(g + b - 2 * r);
  }
  const denominator = std(s2), alpha = denominator > 1e-9 ? std(s1) / denominator : 0;
  return s1.map((v, i) => v + alpha * s2[i]);
}

function detrend(a) {
  const mx = (a.length - 1) / 2, my = mean(a);
  let num = 0, den = 0;
  for (let i = 0; i < a.length; i++) { num += (i - mx) * (a[i] - my); den += (i - mx) ** 2; }
  const slope = den > 1e-9 ? num / den : 0;
  return a.map((v, i) => v - my - slope * (i - mx));
}

function removeMovingAverage(a, window) {
  const sum = [0], half = Math.floor(window / 2);
  for (const v of a) sum.push(sum.at(-1) + v);
  return a.map((v, i) => {
    const lo = Math.max(0, i - half), hi = Math.min(a.length, i + half + 1);
    return v - (sum[hi] - sum[lo]) / (hi - lo);
  });
}

function fftCore(re, im) {
  const n = re.length;
  for (let i = 1, j = 0; i < n; i++) {
    let bit = n >> 1;
    for (; j & bit; bit >>= 1) j ^= bit;
    j ^= bit;
    if (i < j) { [re[i], re[j]] = [re[j], re[i]]; [im[i], im[j]] = [im[j], im[i]]; }
  }
  for (let len = 2; len <= n; len <<= 1) {
    const angle = -2 * Math.PI / len, wr = Math.cos(angle), wi = Math.sin(angle);
    for (let i = 0; i < n; i += len) {
      let cr = 1, ci = 0;
      for (let k = 0; k < len / 2; k++) {
        const u = i + k, v = u + len / 2;
        const vr = re[v] * cr - im[v] * ci, vi = re[v] * ci + im[v] * cr;
        re[v] = re[u] - vr; im[v] = im[u] - vi; re[u] += vr; im[u] += vi;
        [cr, ci] = [cr * wr - ci * wi, cr * wi + ci * wr];
      }
    }
  }
  return { re, im };
}

function spectrum(signal, padding = 1) {
  const n = nextPow2(signal.length * padding);
  return fftCore([...signal, ...new Array(n - signal.length).fill(0)], new Array(n).fill(0));
}

function bandpass(a, low, high) {
  const { re, im } = spectrum(a), n = re.length;
  for (let i = 0; i < n; i++) {
    const f = Math.min(i, n - i) * FPS / n;
    if (f < low || f > high) re[i] = im[i] = 0;
  }
  const out = fftCore(re, im.map((v) => -v));
  return out.re.slice(0, a.length).map((v) => v / n);
}

export function spectralRate(a, minBpm, maxBpm) {
  if (a.length < 8 || std(a) < 1e-7) return null;
  const windowed = detrend(a).map((v, i) => v * .5 * (1 - Math.cos(2 * Math.PI * i / (a.length - 1))));
  const { re, im } = spectrum(windowed, 4), resolution = FPS / re.length;
  const min = Math.max(1, Math.ceil(minBpm / 60 / resolution));
  const max = Math.min(re.length / 2 - 1, Math.floor(maxBpm / 60 / resolution));
  let best = min, peak = 0;
  const magnitudes = [];
  for (let i = min; i <= max; i++) {
    const p = Math.hypot(re[i], im[i]);
    magnitudes.push(p);
    if (p > peak) { peak = p; best = i; }
  }
  if (!(peak > 1e-8)) return null;
  let bin = best;
  if (best > min && best < max) {
    const a0 = Math.hypot(re[best - 1], im[best - 1]), a2 = Math.hypot(re[best + 1], im[best + 1]);
    const den = a0 - 2 * peak + a2;
    if (Math.abs(den) > 1e-12) bin += clamp(.5 * (a0 - a2) / den, -1, 1);
  }
  // Preserve the reference's in-band power quality gate, excluding only its peak.
  const others = magnitudes.filter((_, i) => i + min !== best);
  const snr = peak ** 2 / Math.max(1e-12, mean(others.map((v) => v ** 2)));
  return { bpm: bin * resolution * 60, snr, atEdge: best <= min + 1 || best >= max - 1 };
}

// Require observed coverage and reject gaps: never extrapolate invented samples.
export function resampleVitals(rows, seconds, keys = ["rgb", "headY"]) {
  if (rows.length < 2) return null;
  const end = rows.at(-1).t, start = end - seconds * 1000;
  if (rows[0].t > start + 1) return null;
  const before = rows.findLastIndex((x) => x.t <= start);
  const source = rows.slice(Math.max(0, before));
  if (source.some((x, i) => i && (x.t <= source[i - 1].t || x.t - source[i - 1].t > 250))) return null;
  const fps = (source.length - 1) * 1000 / (end - source[0].t);
  if (fps < 8) return null;
  const n = Math.round(seconds * FPS), result = [];
  let j = 0;
  for (let i = 0; i < n; i++) {
    const t = start + i * 1000 / FPS;
    while (j + 1 < source.length - 1 && source[j + 1].t < t) j++;
    const lo = source[j], hi = source[j + 1], fraction = (t - lo.t) / (hi.t - lo.t);
    if (fraction < -.001 || fraction > 1.001) return null;
    const row = { t };
    for (const key of keys) row[key] = Array.isArray(lo[key])
      ? lo[key].map((v, k) => v + (hi[key][k] - v) * fraction)
      : lo[key] + (hi[key] - lo[key]) * fraction;
    result.push(row);
  }
  return { rows: result, fps, start, end };
}

// The same three forehead/cheek rectangles as the requested VitalSense module.
export function vitalROIs(landmarks, width, height) {
  if (!landmarks || landmarks.length < 468 || !width || !height) return [];
  const xs = landmarks.map((p) => p.x), ys = landmarks.map((p) => p.y);
  const left = Math.min(...xs), top = Math.min(...ys), bw = Math.max(...xs) - left, bh = Math.max(...ys) - top;
  if (bw < .08 || bh < .1) return [];
  return [[.32, .06, .36, .14], [.16, .46, .20, .16], [.64, .46, .20, .16]].map(([x, y, w, h]) => {
    const px = Math.max(0, Math.floor((left + x * bw) * width)), py = Math.max(0, Math.floor((top + y * bh) * height));
    return { x: px, y: py, w: Math.min(width - px, Math.max(4, Math.round(w * bw * width))), h: Math.min(height - py, Math.max(4, Math.round(h * bh * height))) };
  }).filter((r) => r.w >= 4 && r.h >= 4);
}

function initial() {
  return { bpm: null, quality: 0, confidence: 0, status: "collecting", reason: "Start camera; hold still in steady light for 12 seconds", signal: [], windowSeconds: 0, requiredSeconds: HR_SECONDS,
    breathingBpm: null, breathingReason: "Needs 30 seconds of continuous observations", sampleFps: 0, roiCount: 0,
    hrv: { rmssd: null, meanIbi: null, beats: 0, provisional: true, reason: "Needs a stable high-frame-rate signal and at least 20 intervals" },
    baseline: { bpm: null, low: null, high: null, progress: 0, calibrating: true }, trend: [], readings: [], at: null };
}

export class VitalSense {
  constructor() { this.reset(); }
  reset() {
    this.rows = []; this.rawRates = []; this.beats = []; this.intervals = [];
    this.value = initial(); this.lastProcess = -Infinity; this.smoothed = null;
    this.calStart = null; this.calRates = []; this.baseline = { ...this.value.baseline };
  }
  resetBaseline() {
    this.calStart = null; this.calRates = [];
    this.baseline = { bpm: null, low: null, high: null, progress: 0, calibrating: true };
    this.value = { ...this.value, baseline: { ...this.baseline } };
    return this.value;
  }
  invalidate(reason = "Camera paused", t = null) {
    this.rows = []; this.rawRates = []; this.smoothed = null; this.beats = []; this.intervals = [];
    this.calStart = null; this.calRates = []; this.lastProcess = -Infinity;
    if (this.baseline.calibrating) this.baseline.progress = 0;
    this.value = { ...initial(), status: "poor", reason, at: t, baseline: { ...this.baseline }, trend: this.value.trend, readings: this.value.readings };
    return this.value;
  }
  add({ t, rgb, headY = 0, motion = 0, roiCount = 0 }) {
    if (!Number.isFinite(t) || !rgb?.every(Number.isFinite)) return this.invalidate("Camera signal unavailable", t);
    const last = this.rows.at(-1);
    if (last && t <= last.t) return this.value;
    if (last && t - last.t > 250) this.invalidate("Tracking interrupted; gathering a fresh signal", t);
    if (motion > .075) return this.invalidate("Hold still — movement is corrupting the signal", t);
    const brightness = mean(rgb);
    if (brightness < .12 || brightness > .92) return this.invalidate(brightness < .12 ? "Face a steady light source" : "Reduce glare on your face", t);
    this.rows.push({ t, rgb, headY });
    while (this.rows.length && this.rows[0].t < t - 35000) this.rows.shift();
    const span = (t - this.rows[0].t) / 1000;
    const fps = span > 0 ? (this.rows.length - 1) / span : 0;
    this.value = { ...this.value, windowSeconds: Math.min(HR_SECONDS, span), sampleFps: fps, roiCount, at: t };
    if (t - this.lastProcess < 500) return this.value;
    this.lastProcess = t;
    const data = resampleVitals(this.rows, HR_SECONDS);
    if (!data) return this.unreliable(span < HR_SECONDS ? `Hold still — gathering signal (${Math.floor(span)} / 12 seconds)` : "Camera frame rate too low or tracking interrupted", "collecting");
    const signal = bandpass(removeMovingAverage(detrend(posSignal(data.rows)), FPS), MIN_HR / 60, MAX_HR / 60);
    const result = spectralRate(signal, MIN_HR, MAX_HR);
    if (!result || result.snr < 1.8 || result.atEdge) return this.unreliable("Signal too weak — check lighting and hold still", "poor", signal);
    const status = result.snr >= 4 ? "good" : "fair";
    this.rawRates.push(result.bpm); if (this.rawRates.length > 3) this.rawRates.shift();
    const rate = median(this.rawRates);
    if (this.smoothed != null && Math.abs(rate - this.smoothed) > 18 && result.snr < 10) return this.unreliable("Signal changed abruptly; waiting for a stable reading", "poor", signal);
    this.smoothed = this.smoothed == null ? rate : .65 * this.smoothed + .35 * rate;
    const quality = clamp((Math.log10(1 + result.snr) / Math.log10(13)) * .75 + .25 * clamp(1 - motion / .075));
    const confidence = Math.round(quality * 100);
    let breathingBpm = null, breathingReason = "Needs 30 seconds of continuous observations";
    const breathData = resampleVitals(this.rows, BR_SECONDS);
    if (breathData) {
      const y = breathData.rows.map((r) => r.headY), br = spectralRate(y, 6, 36);
      if (std(y) >= .0001 && br && br.snr > 1.8 && !br.atEdge) { breathingBpm = Math.round(br.bpm); breathingReason = "Experimental head-motion breathing estimate"; }
      else breathingReason = "No clear breathing rhythm in head movement";
    }
    const bpm = Math.round(this.smoothed);
    const trend = [...this.value.trend, { t, bpm, quality: status }].filter((p) => p.t >= t - 300000);
    const readings = [...this.value.readings];
    if (status === "good" && (!readings.length || t - readings.at(-1).t >= 4000)) readings.push({ t, bpm, quality, confidence });
    if (readings.length > 100) readings.shift();
    this.updateBaseline(t, bpm, status, confidence);
    const hrv = this.updateHRV(signal, data, bpm, status);
    this.value = { ...this.value, bpm, quality, confidence, status, reason: status === "good" ? "Reading stable · camera estimate" : "Fair signal — hold steadier", signal, breathingBpm, breathingReason, hrv, baseline: { ...this.baseline }, trend, readings };
    return this.value;
  }
  unreliable(reason, status, signal = []) {
    this.calStart = null; this.calRates = [];
    if (this.baseline.calibrating) this.baseline.progress = 0;
    this.beats = []; this.intervals = [];
    this.value = { ...this.value, bpm: null, quality: 0, confidence: 0, status, reason, signal, breathingBpm: null, baseline: { ...this.baseline }, hrv: initial().hrv };
    return this.value;
  }
  updateBaseline(t, bpm, status, confidence) {
    if (!this.baseline.calibrating) return;
    if (status !== "good" || confidence < 70) { this.calStart = null; this.calRates = []; this.baseline.progress = 0; return; }
    if (this.calStart == null) this.calStart = t;
    this.calRates.push(bpm); this.baseline.progress = clamp((t - this.calStart) / 30000);
    if (this.baseline.progress >= 1) {
      const center = mean(this.calRates), spread = clamp(std(this.calRates) || 4, 3, 10);
      this.baseline = { bpm: Math.round(center), low: Math.max(40, Math.round(center - 2 * spread)), high: Math.min(200, Math.round(center + 2 * spread)), progress: 1, calibrating: false };
    }
  }
  updateHRV(signal, data, bpm, status) {
    const waiting = { ...initial().hrv };
    if (status !== "good" || data.fps < 20) { this.beats = []; this.intervals = []; return { ...waiting, reason: data.fps < 20 ? "HRV withheld: camera needs at least 20 observed frames/sec" : "HRV withheld while signal is weak" }; }
    const expected = 60000 / bpm, minimum = expected * .55, amp = std(signal);
    for (let i = 2; i < signal.length - FPS * 2; i++) {
      const t = data.start + i * 1000 / FPS;
      if (signal[i] < amp * .12 || !(signal[i] > signal[i - 1] && signal[i] > signal[i + 1] && signal[i] > signal[i - 2] && signal[i] > signal[i + 2])) continue;
      const previous = this.beats.at(-1);
      if (previous != null && t - previous < minimum) continue;
      if (previous != null) {
        const interval = t - previous;
        if (interval >= 60000 / MAX_HR && interval <= 60000 / MIN_HR && interval >= expected * .65 && interval <= expected * 1.45) this.intervals.push(interval);
        else this.intervals = [];
      }
      this.beats.push(t);
    }
    this.beats = this.beats.slice(-201); this.intervals = this.intervals.slice(-60);
    if (this.intervals.length < 20) return { ...waiting, beats: this.beats.length, reason: `Collecting beat intervals (${this.intervals.length} / 20); provisional camera HRV` };
    const differences = this.intervals.slice(1).map((v, i) => (v - this.intervals[i]) ** 2);
    return { rmssd: Math.round(Math.sqrt(mean(differences))), meanIbi: Math.round(mean(this.intervals)), beats: this.beats.length, provisional: true, reason: "Provisional optical HRV; camera timing limits precision" };
  }
}
