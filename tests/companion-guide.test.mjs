import test from "node:test";
import assert from "node:assert/strict";
import { CompanionGuide, responsePlan, confirmationMatches } from "../app/companion-guide.js";
import { RequestGate } from "../app/signals.js";
import { RAPID_BLINK, CONFIRM_BLINK } from "../app/blink-intent.js";

const head = { head: "reliable", lips: "reliable", eyes: "reliable" };
const allHead = ["NOD_COMPLETED", "LEFT_TURN_COMPLETED", "RIGHT_TURN_COMPLETED", "BLINK_COMPLETED"];

test("Asha offers calibrated head choices without making blinks actionable", () => {
  const guide = new CompanionGuide();
  const spoken = guide.ask({ assessment: head, enabled: allHead, reason: "start" }, 1000);
  assert.match(spoken, /Nod for water.*left.*food.*right.*toilet/i);
  assert.equal(guide.accept("BLINK_COMPLETED", 1800), null);
  assert.equal(guide.accept("LEFT_TURN_COMPLETED", 2200), "food");
  assert.equal(guide.accept("RIGHT_TURN_COMPLETED", 2300), null);
  assert.equal(confirmationMatches("BLINK_COMPLETED", head, allHead), false);
  assert.equal(confirmationMatches("NOD_COMPLETED", head, allHead), true);
});

test("wake and movement cues ask first; timeout never becomes a request", () => {
  const guide = new CompanionGuide({ intervalMs: 10000, answerMs: 3000 });
  const wake = guide.ask({ assessment: head, enabled: allHead, reason: "wake" }, 0);
  assert.match(wake, /eyes are open.*Do you need water.*nod/i);
  assert.equal(guide.accept("BLINK_COMPLETED", 1000), null);
  assert.equal(guide.accept("NOD_COMPLETED", 3001), null);
  assert.equal(guide.due(10001), true);
  const change = guide.ask({ assessment: head, enabled: allHead, reason: "change" }, 11000);
  assert.match(change, /can't tell how you feel.*comfortable/i);
  assert.equal(guide.accept("NOD_COMPLETED", 12000), "comfort");
});

test("Asha adapts to smile or a mapped hand and never suggests uncalibrated movement", () => {
  assert.deepEqual(responsePlan({ head: "none", lips: "reliable" }, ["BLINK_COMPLETED"]), { mode: "none" });
  const guide = new CompanionGuide();
  const smile = guide.ask({ assessment: { head: "none", lips: "limited" }, enabled: ["SMILE_COMPLETED"] }, 0);
  assert.match(smile, /smile and relax/);
  assert.equal(guide.accept("SMILE_COMPLETED", 1000), "water");
  const hand = guide.ask({ assessment: { head: "none", lips: "none" }, enabled: [], handMapped: true }, 120000);
  assert.match(hand, /personalized hand gestures/);
  assert.equal(guide.accept("BLINK_COMPLETED", 120500), null);
});

test("three observed blinks cannot create or confirm a caregiver event", () => {
  const guide = new CompanionGuide();
  const gate = new RequestGate();
  guide.ask({ assessment: head, enabled: allHead, reason: "start" }, 1000);
  for (const t of [1500, 2100, 2700]) {
    const kind = guide.accept("BLINK_COMPLETED", t);
    if (kind) gate.propose(kind, kind, "face", t);
    assert.equal(confirmationMatches("BLINK_COMPLETED", head, allHead), false);
  }
  assert.equal(gate.pending, null);
});

test("eyes-only patient can answer Asha without head, lip or hand movement", () => {
  const assessment = { head: "none", lips: "none", eyes: "limited" }, enabled = [RAPID_BLINK, CONFIRM_BLINK];
  assert.equal(responsePlan(assessment, enabled).mode, "blink");
  const guide = new CompanionGuide();
  assert.match(guide.ask({ assessment, enabled, reason: "wake" }, 0), /Do you need water.*blink three times quickly/);
  assert.equal(guide.accept("BLINK_COMPLETED", 500), null);
  assert.equal(guide.accept(RAPID_BLINK, 2000), "water");
  assert.equal(confirmationMatches(RAPID_BLINK, assessment, enabled), false);
  assert.equal(confirmationMatches(CONFIRM_BLINK, assessment, enabled), true);
  assert.equal(responsePlan({ ...assessment, eyes: "none" }, enabled).mode, "none");
});
