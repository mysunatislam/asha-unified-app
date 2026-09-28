import test from "node:test";
import assert from "node:assert/strict";
import { decodePose, yoloPosture } from "../app/yolo-codec.js";
test("pinned YOLO exporter keypoint scaling is correctly decoded", () => {
  const a = new Float32Array(57);
  a[4] = 0.9;
  for (let i = 0; i < 17; i++) {
    a[6 + i * 3] = 0.4;
    a[7 + i * 3] = i >= 11 ? 0.7 : 0.3;
    a[8 + i * 3] = 0.95 / 640;
  }
  const p = decodePose(a, [1, 1, 57]);
  assert.ok(p.points[5].x > 0.39);
  assert.ok(p.points[5].score > 0.94);
  assert.equal(yoloPosture(p).label, "Upright");
});
test("no fake pose when visibility is missing", () => {
  const a = new Float32Array(57);
  a[4] = 0.9;
  assert.equal(yoloPosture(decodePose(a, [1, 1, 57])), null);
  assert.throws(() => decodePose(a, [1, 57, 1]));
});
