import test from "node:test";
import assert from "node:assert/strict";
import {
  normalizeSupport,
  supportSummary,
  supportOptions,
} from "../app/support-profile.js";
import { assessment, recommend } from "../server/logic.js";

test("optional support context is empty for old profiles, null or skipped answers", () => {
  for (const v of [undefined, null, 42, {}])
    assert.deepEqual(normalizeSupport(v), {
      categories: [],
      goals: [],
      note: "",
    });
  assert.equal(supportSummary(null), "Not shared (optional)");
});
test("support context uses known unique IDs and a bounded note", () => {
  const value = normalizeSupport({
    categories: ["als", "als", "stroke", "made-up"],
    goals: ["speech", "speech", "other"],
    note: "A\n" + "b".repeat(300),
  });
  assert.deepEqual(value.categories, ["als", "stroke"]);
  assert.deepEqual(value.goals, ["speech"]);
  assert.equal(value.note.length, 160);
  assert.equal(value.note.includes("\n"), false);
});
test("conditions never supply or remove movement capabilities", () => {
  const a = assessment({
    fingers: "reliable",
    leftHand: "reliable",
    eyes: "reliable",
    speech: "limited",
  });
  for (const [id] of supportOptions) {
    const context = normalizeSupport({ categories: [id] });
    assert.deepEqual(
      recommend(assessment({ ...a, supportContext: context })),
      recommend(a),
    );
  }
  assert.deepEqual(recommend(a).suggested, [
    "fingerspeak",
    "facespeak",
    "senseassist",
  ]);
});
