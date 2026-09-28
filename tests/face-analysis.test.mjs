import test from "node:test";
import assert from "node:assert/strict";
import vm from "node:vm";
import fs from "node:fs";
import { FaceAnalysis } from "../app/face-analysis.js";
globalThis.window = globalThis;
for (const file of [
  "utils/landmarks",
  "utils/metrics",
  "src/activity",
  "src/lip-watch",
  "src/engine",
])
  vm.runInThisContext(
    fs.readFileSync(
      new URL("../neuroface/" + file + ".js", import.meta.url),
      "utf8",
    ),
  );
function mesh() {
  const lm = Array.from({ length: 478 }, () => ({ x: 0.5, y: 0.5, z: 0 }));
  for (const [id, x, y] of [
    [234, 0.3, 0.5],
    [454, 0.7, 0.5],
    [10, 0.5, 0.2],
    [152, 0.5, 0.8],
    [33, 0.37, 0.4],
    [263, 0.63, 0.4],
    [133, 0.43, 0.4],
    [362, 0.57, 0.4],
    [105, 0.43, 0.33],
    [334, 0.57, 0.33],
    [116, 0.4, 0.48],
    [345, 0.6, 0.48],
    [61, 0.42, 0.62],
    [291, 0.58, 0.62],
    [13, 0.5, 0.615],
    [14, 0.5, 0.625],
    [1, 0.5, 0.5],
  ])
    lm[id] = { x, y, z: 0 };
  return lm;
}
const raw = (extra = {}) => ({
  facePresent: true,
  faceQuality: 1,
  mouthSmileLeft: 0,
  mouthSmileRight: 0,
  eyeBlinkLeft: 0,
  eyeBlinkRight: 0,
  jawOpen: 0,
  yaw: 0,
  pitch: 0,
  roll: 0,
  mar: 0.06,
  earMean: 0.3,
  earLeft: 0.3,
  earRight: 0.3,
  ...extra,
});
const result = (extra = {}) => ({
  accepted: true,
  events: [],
  states: { head: "CENTER", nod: "CENTER", blink: "OPEN" },
  smile: { smileIntensity: 0, symmetryScore: 100 },
  ...extra,
});
const baseline = NF_engine.baseline();
function calibrated() {
  const a = new FaceAnalysis();
  for (let i = 0; i < 45; i++)
    a.update(mesh(), raw(), result(), baseline, i * 40);
  assert.ok(a.neutral);
  return a;
}
test("original AU geometry responds to eyebrow rise and lowering; rest is zero", () => {
  const a = calibrated();
  let s;
  const raised = mesh();
  raised[105].y -= 0.02;
  raised[334].y -= 0.02;
  for (let i = 0; i < 12; i++)
    s = a.update(raised, raw(), result(), baseline, 2000 + i * 40);
  assert.ok(s.au.values.AU1 > 90);
  assert.equal(s.au.values.AU4, 0);
  const lowered = mesh();
  lowered[105].y += 0.02;
  lowered[334].y += 0.02;
  for (let i = 0; i < 12; i++)
    s = a.update(lowered, raw(), result(), baseline, 2500 + i * 40);
  assert.ok(s.au.values.AU4 > 90);
  assert.ok(s.au.values.AU1 < 5);
});
test("head movement and nod stay visible; observed blink counts are not duplicated from commands", () => {
  const a = calibrated();
  const s = a.update(
    mesh(),
    raw({ yaw: 24, pitch: 15, roll: 5 }),
    result({
      events: [
        { type: "NOD_COMPLETED", timestamp: 2000 },
        { type: "BLINK_COMPLETED", duration: 320, deliberate: true },
      ],
    }),
    baseline,
    2000,
  );
  assert.equal(s.head.yaw, 24);
  assert.equal(s.head.pitch, 15);
  assert.equal(s.head.label, "Head right");
  assert.equal(s.head.nodRecent, true);
  assert.equal(
    s.eye.count,
    0,
    "A command event without a measured dip must not increment observations",
  );
  for (let t = 2040; t <= 2440; t += 40)
    a.update(mesh(), raw(), result(), baseline, t);
  for (let t = 2480; t <= 2600; t += 40)
    a.update(
      mesh(),
      raw({ earLeft: 0.21, earRight: 0.21 }),
      result(),
      baseline,
      t,
    );
  let reopened;
  for (let t = 2640; t <= 2800; t += 40)
    reopened = a.update(mesh(), raw(), result(), baseline, t);
  assert.equal(reopened.eye.count, 1);
  assert.equal(reopened.eye.total, 1);
  assert.equal(reopened.eye.last.duration, 160);
});
test("corner held for 59 seconds does not flag; 60 seconds flags once", () => {
  const a = calibrated(),
    corner = mesh();
  corner[61].y += 0.025;
  let s,
    count = 0;
  for (let t = 2000; t <= 63000; t += 100) {
    s = a.update(corner, raw(), result(), baseline, t);
    if (t < 61900) assert.equal(s.lip.fired, false);
    if (s.lip.fired) count++;
  }
  assert.equal(s.lip.kind, "Corner asymmetry");
  assert.equal(s.lip.latched, true);
  assert.equal(count, 1);
});
test("lateral lip shift uses original 3.5% threshold; smile/pose/gaps do not trigger a seizure label", () => {
  const a = calibrated(),
    lateral = mesh();
  lateral[61].x += 0.02;
  lateral[291].x += 0.02;
  let s = a.update(lateral, raw(), result(), baseline, 2000);
  assert.equal(s.lip.kind, "Lateral shift");
  assert.equal(s.lip.active, true);
  s = a.update(
    lateral,
    raw(),
    result({ smile: { smileIntensity: 0.9, symmetryScore: 98 } }),
    baseline,
    2100,
  );
  assert.equal(s.lip.active, false);
  s = a.update(lateral, raw({ yaw: 40 }), result(), baseline, 2200);
  assert.equal(s.lip.active, false);
  s = a.update(lateral, raw(), result(), baseline, 30000);
  assert.equal(s.lip.duration, 0);
  s = a.update(null, raw({ facePresent: false }), result(), baseline, 30100);
  assert.equal(s.lip.latched, false);
});
test("changing lip sides resets the 60-second timer", () => {
  const a = calibrated(),
    left = mesh(),
    right = mesh();
  left[61].y += 0.025;
  right[291].y += 0.025;
  let s;
  for (let t = 2000; t <= 40000; t += 100)
    s = a.update(left, raw(), result(), baseline, t);
  assert.ok(s.lip.duration > 30);
  s = a.update(right, raw(), result(), baseline, 40100);
  assert.equal(s.lip.duration, 0);
  assert.equal(s.lip.latched, false);
});
test("a lateral lip shift present at startup cannot become the neutral reference", () => {
  const a = new FaceAnalysis(),
    shifted = mesh();
  shifted[61].x += 0.02;
  shifted[291].x += 0.02;
  let s,
    flags = 0;
  for (let t = 0; t <= 61000; t += 100) {
    s = a.update(shifted, raw(), result(), baseline, t);
    if (t < 60000) assert.equal(s.lip.fired, false);
    if (s.lip.fired) flags++;
  }
  assert.equal(a.neutral, null);
  assert.equal(a.activity.baseline, null);
  assert.equal(s.lip.kind, "Lateral shift");
  assert.equal(s.lip.active, true);
  assert.equal(s.lip.latched, true);
  assert.equal(flags, 1);
  for (let i = 0; i < 45; i++)
    s = a.update(mesh(), raw(), result(), baseline, 61100 + i * 100);
  assert.ok(a.neutral, "A relaxed centered face can still establish neutral");
  assert.equal(s.lip.latched, false);
});
test("blink, smile and head temporal defaults are preserved", () => {
  assert.equal(NF_engine.DEFAULTS.commands.blinkWindowMs, 5000);
  assert.equal(NF_engine.DEFAULTS.commands.turnWindowMs, 8000);
  assert.equal(NF_engine.DEFAULTS.smile.enter, 0.34);
  assert.equal(NF_engine.DEFAULTS.smile.exit, 0.2);
  assert.equal(NF_engine.DEFAULTS.blink.deliberateMinMs, 260);
  assert.equal(NF_engine.baseline().leftTurnEnterThreshold, 13);
});
