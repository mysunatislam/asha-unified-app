import test from "node:test";
import assert from "node:assert/strict";
import { VitalSense, resampleVitals, vitalROIs } from "../app/vitalsense.js";

function sample(t, bpm = 78, overrides = {}) {
  const wave = Math.sin(2 * Math.PI * bpm / 60 * t / 1000);
  const breathing = Math.sin(2 * Math.PI * 15 / 60 * t / 1000);
  return { t, rgb: [.56 + .0006 * wave, .43 + .003 * wave, .32 + .0003 * wave], headY: .5 + .001 * breathing, motion: .002, roiCount: 3, ...overrides };
}
function feed(engine, seconds, bpm = 78, start = 0, fps = 30) {
  let result;
  for (let i = 0; i <= seconds * fps; i++) result = engine.add(sample(start + i * 1000 / fps, bpm));
  return result;
}

test("VitalSense recovers a known POS pulse with uneven camera timestamps", () => {
  const engine = new VitalSense();
  let value;
  for (let i = 0; i < 550; i++) value = engine.add(sample(i * 1000 / 30 + (i % 3) * 2));
  assert.ok(Math.abs(value.bpm - 78) <= 2, JSON.stringify(value));
  assert.equal(value.status, "good");
  assert.equal(value.roiCount, 3);
  assert.ok(value.confidence >= 70);
  assert.ok(value.signal.length >= 350);
});

test("HR and breathing require full observed windows; no extrapolated warmup", () => {
  const engine = new VitalSense();
  let value = feed(engine, 8);
  assert.equal(value.bpm, null);
  assert.equal(value.breathingBpm, null);
  value = feed(engine, 16, 78, 8001);
  assert.equal(value.breathingBpm, null);
  value = feed(engine, 12, 78, 24002);
  assert.ok(Math.abs(value.bpm - 78) <= 2);
  assert.ok(Math.abs(value.breathingBpm - 15) <= 2);
});

test("missing camera frames invalidate old readings and restart coverage", () => {
  const engine = new VitalSense();
  assert.ok(feed(engine, 16).bpm);
  let value = engine.add(sample(18000));
  assert.equal(value.bpm, null);
  assert.equal(value.breathingBpm, null);
  assert.equal(value.windowSeconds, 0);
  value = feed(engine, 8, 78, 18001);
  assert.equal(value.bpm, null);
});

test("motion, lighting, and flat RGB cannot publish numeric vitals", () => {
  const engine = new VitalSense();
  assert.ok(feed(engine, 16).bpm);
  assert.equal(engine.add(sample(16034, 78, { motion: .12 })).bpm, null);
  assert.equal(engine.add(sample(16068, 78, { rgb: [.01, .02, .01] })).bpm, null);
  let value;
  for (let i = 0; i < 500; i++) value = engine.add(sample(17000 + i * 1000 / 30, 78, { rgb: [.56, .43, .32] }));
  assert.equal(value.bpm, null);
  assert.equal(value.confidence, 0);
});

test("baseline takes 30 seconds of stable accepted readings and resets explicitly", () => {
  const engine = new VitalSense();
  let value = feed(engine, 25);
  assert.equal(value.baseline.bpm, null);
  assert.ok(value.baseline.progress > 0);
  value = feed(engine, 25, 78, 25001);
  assert.ok(Math.abs(value.baseline.bpm - 78) <= 2);
  assert.equal(value.baseline.calibrating, false);
  assert.ok(value.readings.length > 0);
  const count = value.trend.length;
  value = engine.invalidate("Page hidden");
  assert.equal(value.bpm, null);
  assert.equal(value.hrv.rmssd, null);
  assert.equal(value.baseline.calibrating, false);
  assert.equal(value.trend.length, count);
  value = engine.resetBaseline();
  assert.equal(value.baseline.bpm, null);
  assert.equal(value.baseline.progress, 0);
});

test("mobile low FPS does not fabricate high-rate beat timing", () => {
  const engine = new VitalSense();
  const value = feed(engine, 45, 78, 0, 10);
  assert.ok(Math.abs(value.bpm - 78) <= 2);
  assert.equal(value.hrv.rmssd, null);
  assert.match(value.hrv.reason, /20 observed frames/);
  assert.equal(value.hrv.provisional, true);
});

test("resampling rejects discontinuities, duplicate times, and too little coverage", () => {
  const rows = Array.from({ length: 361 }, (_, i) => sample(i * 1000 / 30));
  assert.ok(resampleVitals(rows, 12));
  assert.equal(resampleVitals(rows.slice(1), 12), null);
  assert.equal(resampleVitals(rows.filter((_, i) => i < 100 || i > 120), 12), null);
  assert.equal(resampleVitals(rows.map((row, i) => i === 10 ? { ...row, t: rows[9].t } : row), 12), null);
});

test("HRV intervals are timestamped once across overlapping FFT windows", () => {
  const engine = new VitalSense();
  const value = feed(engine, 45);
  assert.equal(value.hrv.provisional, true);
  assert.ok(value.hrv.beats > 20 && value.hrv.beats < 65, value.hrv.beats);
  assert.ok(Math.abs(value.hrv.meanIbi - 60000 / 78) < 40, value.hrv.meanIbi);
  assert.ok(value.hrv.rmssd < 65, value.hrv.rmssd);
});

test("forehead and cheek boxes are bounded to the video frame", () => {
  const landmarks = Array.from({ length: 478 }, (_, i) => ({ x: .2 + (i % 20) / 40, y: .1 + Math.floor(i / 20) / 40 }));
  const rois = vitalROIs(landmarks, 640, 480);
  assert.equal(rois.length, 3);
  for (const r of rois) {
    assert.ok(r.x >= 0 && r.y >= 0);
    assert.ok(r.x + r.w <= 640 && r.y + r.h <= 480);
  }
  assert.deepEqual(vitalROIs(landmarks.slice(0, 40), 640, 480), []);
});
