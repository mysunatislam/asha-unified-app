import test from "node:test";
import assert from "node:assert/strict";
import { BlinkCounter } from "../app/blink-counter.js";

// These are observation traces, not intentional FaceSpeak command gestures.
// In particular, MediaPipe blink blendshapes can stay near zero with glasses.
function runner(step = 40) {
  const counter = new BlinkCounter();
  let t = 0;
  let result;
  const snapshots = [];
  const api = {
    counter,
    get result() {
      return result;
    },
    snapshots,
    frame(left = 0.49, right = 0.51, extra = {}, elapsed = step) {
      t += elapsed;
      result = counter.update(
        {
          facePresent: true,
          faceQuality: 1,
          earLeft: left,
          earRight: right,
          eyeBlinkLeft: 0,
          eyeBlinkRight: 0,
          poseSpeed: 0,
          ...extra,
        },
        t,
      );
      snapshots.push(result);
      return api;
    },
    hold(ms, left = 0.49, right = 0.51, extra = {}) {
      for (let elapsed = 0; elapsed < ms; elapsed += step)
        api.frame(left, right, extra);
      return api;
    },
    blink(left = 0.36, right = 0.38, ms = 120) {
      return api.hold(ms, left, right).hold(400);
    },
  };
  return api;
}

test("screenshot: eight bilateral raw-EAR dips produce eight observed blinks", () => {
  const r = runner().hold(600);
  for (let i = 1; i <= 8; i++) {
    r.blink();
    assert.equal(r.result.total, i);
    assert.equal(r.result.count, i);
  }
  assert.notEqual(r.result.state, "CLOSED");
});

test("middle-depth dips have no old .60-.72 normalized-ratio detection hole", () => {
  const r = runner().hold(600);
  r.blink(0.49 * 0.68, 0.51 * 0.68);
  assert.equal(r.result.total, 1);
});

test("shallow bilateral dips count without blink blendshape activation", () => {
  const r = runner().hold(600);
  r.blink(0.49 * 0.88, 0.51 * 0.88);
  assert.equal(r.result.total, 1);
});

test("small bilateral jitter and below-threshold seven-percent dips do not count", () => {
  const r = runner().hold(600);
  for (let i = 0; i < 8; i++) {
    r.hold(120, 0.49 * 0.93, 0.51 * 0.93).hold(240);
    r.frame(0.5, 0.52).frame(0.48, 0.5).hold(240);
  }
  assert.equal(r.result.total, 0);
});

test("a brief high-EAR spike cannot permanently raise the open-eye reference", () => {
  const r = runner().hold(600).hold(80, 0.6, 0.62).hold(600);
  assert.equal(r.result.total, 0);
  r.blink();
  assert.equal(r.result.total, 1);
  assert.notEqual(r.result.state, "CLOSED");
  assert.ok(r.result.reference.left < 0.55);
  assert.ok(r.result.reference.right < 0.57);
});

test("return near the pre-dip plateau completes without requiring its exact maximum", () => {
  const r = runner().hold(600, 0.5, 0.52);
  r.hold(120, 0.36, 0.38).hold(400, 0.49, 0.51);
  assert.equal(r.result.total, 1);
  assert.notEqual(r.result.state, "CLOSED");
});

test("partial recovery stays within the same dip until both eyes reopen", () => {
  const r = runner().hold(600).hold(160, 0.35, 0.37);
  r.hold(160, 0.43, 0.45);
  assert.equal(r.result.total, 0);
  r.hold(400);
  assert.equal(r.result.total, 1);
});

test("one-sided wink is not counted as a bilateral blink", () => {
  const r = runner().hold(600);
  r.hold(160, 0.3, 0.51).hold(400);
  r.hold(160, 0.49, 0.3).hold(400);
  assert.equal(r.result.total, 0);
});

test("a single low observation cannot count an isolated tracking spike", () => {
  const r = runner().hold(600).frame(0.33, 0.35).hold(600);
  assert.equal(r.result.total, 0);
});

test("sustained closure is not many blinks; normal detection resumes after reopening", () => {
  const r = runner().hold(600).hold(2000, 0.16, 0.17).hold(800);
  assert.equal(r.result.total, 0);
  r.blink();
  assert.equal(r.result.total, 1);
});

test("closed-eye startup waits for a real open plateau before counting", () => {
  const r = runner().hold(800, 0.1, 0.11, {
    eyeBlinkLeft: 0.95,
    eyeBlinkRight: 0.95,
  });
  assert.equal(r.result.total, 0);
  r.hold(800);
  assert.equal(r.result.total, 0);
  r.blink();
  assert.equal(r.result.total, 1);
});

test("face loss midway through closure cannot finish an unseen blink", () => {
  const r = runner().hold(600).hold(160, 0.35, 0.37);
  r.frame(0.35, 0.37, { facePresent: false }).hold(800);
  assert.equal(r.result.total, 0);
  r.blink();
  assert.equal(r.result.total, 1);
});

test("poor quality and non-finite eye features reset incomplete observations", () => {
  for (const extra of [
    { faceQuality: 0.1 },
    { earLeft: NaN },
    { earRight: Infinity },
  ]) {
    const r = runner().hold(600).hold(160, 0.35, 0.37);
    r.frame(0.35, 0.37, extra).hold(800);
    assert.equal(r.result.total, 0);
    r.blink();
    assert.equal(r.result.total, 1);
  }
});

test("a camera-frame gap resets an incomplete blink", () => {
  const r = runner().hold(600).hold(160, 0.35, 0.37);
  r.frame(0.49, 0.51, {}, 1000).hold(800);
  assert.equal(r.result.total, 0);
  r.blink();
  assert.equal(r.result.total, 1);
});

test("rolling sixty-second count expires without erasing session total", () => {
  const r = runner().hold(600).blink().hold(61_000);
  assert.equal(r.result.total, 1);
  assert.equal(r.result.count, 0);
});

test("mobile 15-fps sampling still counts sufficiently observed dips", () => {
  const r = runner(1000 / 15).hold(600);
  for (let i = 0; i < 5; i++) r.blink(0.36, 0.38, 180);
  assert.equal(r.result.total, 5);
});

test("observation snapshots never emit communication commands", () => {
  const r = runner().hold(600);
  for (let i = 0; i < 8; i++) r.blink(0.3, 0.32, 360);
  assert.equal(r.result.total, 8);
  for (const snapshot of r.snapshots) {
    assert.ok(!snapshot.commands || snapshot.commands.length === 0);
    assert.ok(!snapshot.events || snapshot.events.length === 0);
  }
});
