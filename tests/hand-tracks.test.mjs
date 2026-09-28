import test from "node:test";
import assert from "node:assert/strict";
import { HandTracks } from "../app/hand-tracks.js";
const h = (x) => ({ label: "right", lm: [{ x, y: 0.5 }] });
test("two same-handedness labels have independent stable identities", () => {
  const t = new HandTracks(),
    first = t.update([h(0.2), h(0.8)], 0);
  assert.notEqual(first[0].id, first[1].id);
  const second = t.update([h(0.78), h(0.21)], 100);
  assert.equal(second[0].id, first[1].id);
  assert.equal(second[1].id, first[0].id);
});
test("occlusion resets a hand identity rather than joining unrelated gestures", () => {
  const t = new HandTracks(),
    a = t.update([h(0.2)], 0)[0];
  t.update([], 100);
  assert.notEqual(t.update([h(0.2)], 2000)[0].id, a.id);
});
