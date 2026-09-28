// Decoder for the pinned onnx-community YOLO26n pose export (see models/manifest.json).
// This export normalizes boxes AND all three keypoint components by 640.
// x/y are already normalized; visibility must be restored, not divided again.
export function decodePose(a, dims) {
  if (dims.length !== 3 || dims[0] !== 1 || dims[2] !== 57)
    throw Error("Unsupported YOLO output shape " + dims.join("x"));
  let best = null;
  for (let row = 0; row < dims[1]; row++) {
    const o = row * 57;
    if (a[o + 4] > 0.5 && (!best || a[o + 4] > best.score))
      best = {
        score: a[o + 4],
        points: Array.from({ length: 17 }, (_, i) => ({
          x: a[o + 6 + i * 3],
          y: a[o + 7 + i * 3],
          score: Math.min(1, Math.max(0, a[o + 8 + i * 3] * 640)),
        })),
      };
  }
  return best;
}
export function yoloPosture(person) {
  if (!person) return null;
  const p = person.points;
  if (p[5].score < 0.55 || p[6].score < 0.55) return null;
  const shoulders = { x: (p[5].x + p[6].x) / 2, y: (p[5].y + p[6].y) / 2 };
  if (p[11].score < 0.55 || p[12].score < 0.55)
    return { label: "Upper body visible", lean: null };
  const hip = { x: (p[11].x + p[12].x) / 2, y: (p[11].y + p[12].y) / 2 };
  const lean =
    (Math.atan2(shoulders.x - hip.x, Math.abs(shoulders.y - hip.y)) * 180) /
    Math.PI;
  return {
    lean,
    label:
      Math.abs(lean) > 55
        ? "Reclined / sideways"
        : Math.abs(lean) > 25
          ? "Leaning"
          : "Upright",
  };
}
