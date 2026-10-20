import test from "node:test";
import assert from "node:assert/strict";
import { usableVitalSignal } from "../app/vitals-studio.js";

test("heart animation requires a fresh, accepted, visible camera observation", (t) => {
  const saved = Object.getOwnPropertyDescriptor(globalThis, "document");
  t.after(() => {
    if (saved) Object.defineProperty(globalThis, "document", saved);
    else delete globalThis.document;
  });
  Object.defineProperty(globalThis, "document", {
    configurable: true,
    value: { hidden: false },
  });
  const p = { bpm: 78, confidence: 90, status: "good", at: 1000 };
  assert.equal(usableVitalSignal(p, true, 1500), true);
  for (const patch of [
    { bpm: null },
    { bpm: 300 },
    { confidence: 0 },
    { status: "poor" },
    { status: "collecting" },
    { at: null },
    { at: 2000 },
  ])
    assert.equal(usableVitalSignal({ ...p, ...patch }, true, 1500), false);
  assert.equal(usableVitalSignal(p, true, 2001), false);
  assert.equal(usableVitalSignal(p, false, 1500), false);
  document.hidden = true;
  assert.equal(usableVitalSignal(p, true, 1500), false);
});
