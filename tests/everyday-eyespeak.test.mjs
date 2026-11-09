import test from "node:test";
import assert from "node:assert/strict";
import {
  CHECK_TARGETS,
  DwellSelector,
  calibrationTargets,
  extractGazeFeatures,
  fitGazeModel,
  predictGaze,
  validateGazeModel,
} from "../app/everyday/gaze-engine.js";

function features(x, y) {
  return [
    (x - 0.5) * 0.4,
    (y - 0.5) * 0.3,
    (x - 0.5) * 0.38,
    (y - 0.5) * 0.32,
    0,
    0.3,
    0,
  ];
}
function samples(targets) {
  return targets.flatMap(([x, y]) =>
    Array.from({ length: 10 }, (_, index) => ({
      x,
      y,
      features: features(x + (index % 2 ? 0.001 : -0.001), y),
    })),
  );
}

test("EyeSpeak fits personalized screen coordinates and requires a separate target check", () => {
  const model = fitGazeModel(samples(calibrationTargets(9)));
  assert.equal(predictGaze(model, features(0.4, 0.6)).valid, false);
  model.validation = validateGazeModel(model, samples(CHECK_TARGETS));
  assert.equal(model.validation.passed, true);
  const prediction = predictGaze(model, features(0.4, 0.6));
  assert.equal(prediction.valid, true);
  assert.ok(Math.abs(prediction.x - 0.4) < 0.01);
  assert.ok(Math.abs(prediction.y - 0.6) < 0.01);
});

test("EyeSpeak refuses stationary, incomplete, nonfinite and poorly validated calibration", () => {
  const training = samples(calibrationTargets(5));
  assert.throws(
    () =>
      fitGazeModel(
        training.map((sample) => ({ ...sample, features: features(0.5, 0.5) })),
      ),
    /did not vary/,
  );
  assert.throws(() => fitGazeModel(training.slice(0, 20)), /five targets/);
  assert.throws(() =>
    fitGazeModel([{ ...training[0], features: [NaN, 0, 0, 0, 0, 0, 0] }]),
  );
  const model = fitGazeModel(training);
  const wrong = samples(CHECK_TARGETS).map((sample) => ({
    ...sample,
    features: features(1 - sample.x, 1 - sample.y),
  }));
  model.validation = validateGazeModel(model, wrong);
  assert.equal(model.validation.passed, false);
  assert.equal(predictGaze(model, features(0.5, 0.5)).valid, false);
  assert.equal(
    predictGaze(model, [0, 0, 0, 0, 2, 0.3, 0], { requireValidation: false })
      .valid,
    false,
  );
  assert.equal(
    predictGaze({ version: model.version }, features(0.5, 0.5)).valid,
    false,
  );
});

test("EyeSpeak rejects missing irises and closed or geometrically invalid eyes", () => {
  assert.equal(
    extractGazeFeatures(new Array(468).fill({ x: 0.5, y: 0.5 })).valid,
    false,
  );
  const landmarks = new Array(478).fill(null).map(() => ({ x: 0.5, y: 0.5 }));
  Object.assign(landmarks, {
    33: { x: 0.3, y: 0.4 },
    133: { x: 0.4, y: 0.4 },
    468: { x: 0.35, y: 0.4 },
    362: { x: 0.6, y: 0.4 },
    263: { x: 0.7, y: 0.4 },
    473: { x: 0.65, y: 0.4 },
    159: { x: 0.35, y: 0.38 },
    145: { x: 0.35, y: 0.42 },
    386: { x: 0.65, y: 0.38 },
    374: { x: 0.65, y: 0.42 },
    1: { x: 0.5, y: 0.5 },
  });
  assert.equal(extractGazeFeatures(landmarks).valid, true);
  landmarks[145] = landmarks[159];
  assert.equal(extractGazeFeatures(landmarks).valid, false);
  landmarks[33] = { x: NaN, y: 0.4 };
  assert.equal(extractGazeFeatures(landmarks).valid, false);
});

test("EyeSpeak supports five, nine and sixteen targets with full screen coverage", () => {
  for (const count of [5, 9, 16]) {
    const points = calibrationTargets(count);
    assert.equal(points.length, count);
    assert.equal(new Set(points.map(String)).size, count);
  }
  assert.throws(() => calibrationTargets(7));
});

test("Dwell selects once, requires a real release, and cannot count across tracking gaps", () => {
  const dwell = new DwellSelector({ dwellMs: 800 });
  const results = [];
  for (let t = 0; t <= 2000; t += 100) results.push(dwell.update("water", t));
  assert.deepEqual(results.filter(Boolean), ["water"]);
  // Unseen movement during a tracking loss cannot release the selected target.
  dwell.update(null, 2100, false);
  for (let t = 2200; t <= 3200; t += 100)
    assert.equal(dwell.update("water", t), null);
  for (let t = 3300; t <= 3800; t += 100) dwell.update(null, t);
  for (let t = 3900; t <= 4600; t += 100)
    assert.equal(dwell.update("water", t), null);
  assert.equal(dwell.update("water", 4700), "water");
  dwell.reset();
  dwell.update("yes", 0);
  dwell.update("yes", 100);
  dwell.update("yes", 1200); // gap resets progress
  assert.equal(dwell.update("yes", 1300), null);
  assert.equal(dwell.progress, 0);
  assert.equal(dwell.update("yes", 1250), null); // out-of-order time
});
