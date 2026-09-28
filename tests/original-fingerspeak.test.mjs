import { createRequire } from "node:module";
import fs from "node:fs";
import vm from "node:vm";
const require = createRequire(import.meta.url);
const test = require("node:test");
const assert = require("node:assert/strict");
const {
  resampleSequence,
  inDistribution,
  orderedHands,
  packHands,
  buildModelInput,
  upgradeLegacyFrame,
  classifyPose,
  PoseTracker,
} = vm.runInThisContext(
  "(function(module){" +
    fs.readFileSync(
      new URL("../neuroface/src/fingerspeak-signal.js", import.meta.url),
      "utf8",
    ) +
    ";return module.exports;})",
)({ exports: {} });

const frame = (t, value) => ({ t, feat: Array(63).fill(value) });

test("FingerSpeak samples a continuous gesture without extrapolating the edges", () => {
  const frames = Array.from({ length: 29 }, (_, i) => frame(i * 32, i / 28));
  const sampled = resampleSequence(frames, 20, 900);
  assert.equal(sampled.length, 20);
  assert.equal(sampled[0][0], 0);
  assert.equal(sampled.at(-1)[0], 1);
  assert.ok(sampled.every((row) => row.every(Number.isFinite)));
});

test("FingerSpeak rejects too-short, gapped, duplicate, and invalid captures", () => {
  assert.equal(resampleSequence([frame(0, 0), frame(900, 1)], 20, 900), null);
  const gapped = [
    ...Array.from({ length: 8 }, (_, i) => frame(i * 35, 0)),
    ...Array.from({ length: 8 }, (_, i) => frame(600 + i * 35, 1)),
  ];
  assert.equal(resampleSequence(gapped, 20, 900), null);
  const duplicate = Array.from({ length: 30 }, (_, i) =>
    frame(Math.floor(i / 2) * 60, i),
  );
  assert.equal(resampleSequence(duplicate, 20, 900), null);
  const invalid = Array.from({ length: 30 }, (_, i) => frame(i * 31, i));
  invalid[10].feat[5] = NaN;
  assert.equal(resampleSequence(invalid, 20, 900), null);
});

test("unknown-gesture gate only accepts the class actually predicted", () => {
  const prototypes = [
    { centroid: [0, 0], spread: 0.1 },
    { centroid: [3, 3], spread: 0.1 },
  ];
  assert.equal(inDistribution([0.04, 0.02], prototypes, 0, 2.2), true);
  assert.equal(inDistribution([0.04, 0.02], prototypes, 1, 2.2), false);
  assert.equal(inDistribution([0.04, 0.02], null, 0, 2.2), false);
  assert.equal(inDistribution([NaN, 0], prototypes, 0, 2.2), false);
});

function hand(offset = 0, extended = [1, 1, 1, 1]) {
  const lm = Array.from({ length: 21 }, () => ({
    x: 0.5 + offset,
    y: 0.65,
    z: 0,
  }));
  lm[0] = { x: 0.45 + offset, y: 0.85, z: 0 };
  [
    [5, 6, 7, 8],
    [9, 10, 11, 12],
    [13, 14, 15, 16],
    [17, 18, 19, 20],
  ].forEach((chain, i) => {
    const x = 0.32 + i * 0.09 + offset;
    const ys = extended[i]
      ? [0.55, 0.45, 0.35, 0.25]
      : [0.55, 0.45, 0.53, 0.61];
    chain.forEach((index, j) => {
      lm[index] = { x, y: ys[j], z: 0 };
    });
  });
  [
    [1, 0.39, 0.69],
    [2, 0.34, 0.62],
    [3, 0.29, 0.55],
    [4, 0.24, 0.48],
  ].forEach(([index, x, y]) => {
    lm[index] = { x: x + offset, y, z: 0 };
  });
  return lm;
}

test("two detected hands retain separate stable slots and produce 201 model features", () => {
  const left = hand(-0.12),
    right = hand(0.12, [0, 0, 0, 0]);
  const ordered = orderedHands({
    landmarks: [right, left],
    handednesses: [[{ categoryName: "Right" }], [{ categoryName: "Left" }]],
  });
  assert.deepEqual(
    ordered.map((h) => h.label),
    ["left", "right"],
  );
  const raw = packHands(ordered);
  assert.equal(raw.length, 128);
  assert.deepEqual(raw.slice(-2), [1, 1]);
  const features = buildModelInput(Array.from({ length: 20 }, () => raw));
  assert.equal(features.length, 20);
  assert.equal(features[0].length, 201);
  assert.ok(features.every((row) => row.every(Number.isFinite)));
  const single = packHands(ordered.slice(0, 1));
  assert.deepEqual(single.slice(-2), [1, 0]);
  assert.equal(buildModelInput([single])[0].length, 201);
  const rightOnly = packHands([{ lm: hand(0.12), label: "right" }]);
  assert.deepEqual(rightOnly.slice(-2), [1, 0]); // either hand uses the primary slot
});

test("single-hand profiles migrate and a mid-gesture hand-count change is rejected", () => {
  const legacy = Array(63).fill(0.2),
    upgraded = upgradeLegacyFrame(legacy);
  assert.equal(upgraded.length, 128);
  assert.deepEqual(upgraded.slice(-2), [1, 0]);
  const one = packHands([{ lm: hand(), label: "left" }]);
  const two = packHands([
    { lm: hand(), label: "left" },
    { lm: hand(0.12), label: "right" },
  ]);
  const frames = Array.from({ length: 29 }, (_, i) => ({
    t: i * 32,
    feat: i < 15 ? one : two,
  }));
  assert.equal(resampleSequence(frames, 20, 900), null);
});

test("built-in pose preview recognizes simple shapes after a short stable hold", () => {
  assert.equal(classifyPose(hand(0, [1, 1, 1, 1])).name, "Open palm");
  assert.equal(classifyPose(hand(0, [0, 0, 0, 0])).name, "Closed fingers");
  assert.equal(classifyPose(hand(0, [1, 0, 0, 0])).name, "Index extended");
  assert.equal(
    classifyPose(hand(0, [1, 1, 0, 0])).name,
    "Two fingers extended",
  );
  const tracker = new PoseTracker(180),
    hands = [{ lm: hand(), label: "left" }];
  assert.equal(tracker.update(hands, 0)[0].pose, "Observing…");
  assert.equal(tracker.update(hands, 200)[0].pose, "Open palm");
  assert.equal(tracker.update([], 250).length, 0);
});
