import test from "node:test";
import assert from "node:assert/strict";
import vm from "node:vm";
import fs from "node:fs";
import { GuidedCalibration } from "../app/calibration.js";
for (const name of ["engine", "calibration"])
  vm.runInThisContext(
    fs.readFileSync(
      new URL("../neuroface/src/" + name + ".js", import.meta.url),
      "utf8",
    ),
  );
function frame(t) {
  return {
    timestamp: t,
    facePresent: true,
    faceQuality: 1,
    poseValid: true,
    blendshapesValid: true,
    faceSize: 0.4,
    inFrame: true,
    centerX: 0.5,
    centerY: 0.5,
    brightness: 130,
    fps: 25,
    poseSpeed: 0,
    earLeft: 0.3,
    earRight: 0.3,
    earMean: 0.3,
    eyeBlinkLeft: 0,
    eyeBlinkRight: 0,
    mouthSmileLeft: 0.02,
    mouthSmileRight: 0.02,
    cheekSquintLeft: 0,
    cheekSquintRight: 0,
    mouthPucker: 0,
    jawOpen: 0,
    mouthClose: 1,
    yaw: 0,
    pitch: 0,
    roll: 0,
    mouthCornerLeftX: 0.2,
    mouthCornerRightX: -0.2,
    mouthCornerLeftY: 0,
    mouthCornerRightY: 0,
  };
}
test("neutral only captures live valid frames, no timer-only fake calibration", () => {
  const c = new GuidedCalibration({
    eyes: "reliable",
    lips: "none",
    head: "none",
  });
  for (let t = 0; t < 10000; t += 40)
    c.update({ ...frame(t), facePresent: false });
  assert.equal(c.index, 0);
  for (let t = 10000; t < 13500; t += 40) c.update(frame(t));
  assert.equal(c.index, 1);
  assert.equal(c.step, undefined);
  assert.equal(c.baseline.neutralEARLeft, 0.3);
});
test("stationary face cannot complete gesture enrollment", () => {
  const c = new GuidedCalibration({
    eyes: "reliable",
    lips: "none",
    head: "none",
  });
  for (let t = 0; t < 16000; t += 40) c.update(frame(t));
  assert.equal(c.index, 1);
  assert.equal(c.step, undefined);
  assert.equal(c.enabled.length, 0);
});
test("unavailable capabilities are not required and skip does not enable them", () => {
  const c = new GuidedCalibration({ eyes: "none", lips: "none", head: "none" });
  assert.equal(c.steps.length, 1);
  const d = new GuidedCalibration({
    eyes: "reliable",
    lips: "none",
    head: "none",
  });
  for (let t = 0; t < 3400; t += 40) d.update(frame(t));
  d.skip();
  assert.equal(d.step, undefined);
  assert.deepEqual(d.enabled, []);
});
