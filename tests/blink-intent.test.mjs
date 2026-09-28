import test from "node:test";
import assert from "node:assert/strict";
import { BlinkIntent, blinkProfile, RAPID_BLINK, CONFIRM_BLINK } from "../app/blink-intent.js";
import { RequestGate } from "../app/signals.js";

const blink = (start, duration = 160) => ({ start, duration, timestamp: start + duration + 40, amplitude: 0.3 });
const profile = blinkProfile([blink(1000), blink(1400), blink(1800)], [blink(3000, 480), blink(4200, 480), blink(5400, 480)]);
const open = (d, start) => { d.update({ state: "OPEN" }, start); d.update({ state: "OPEN" }, start + 650); };
const feed = (d, e) => {
  d.update({ state: "CLOSED / DIP" }, e.start);
  return d.update({ state: "OPEN", last: e }, e.timestamp);
};

test("calibrated rapid triple only proposes; separate blink after spoken question confirms", () => {
  const d = new BlinkIntent(profile), gate = new RequestGate();
  open(d, 0);
  assert.equal(feed(d, blink(1000)), null);
  assert.equal(feed(d, blink(1400)), null);
  assert.equal(feed(d, blink(1800)), RAPID_BLINK);
  gate.propose("water", "Water", "deliberate blink", 2000);
  // More blinks in the same burst or while Asha speaks cannot confirm.
  assert.equal(feed(d, blink(2200, 480)), null);
  d.questionFinished(4000);
  assert.equal(feed(d, blink(4100, 480)), null, "must first reopen and rest");
  open(d, 5000);
  assert.equal(feed(d, blink(5700)), null, "ordinary short blink isn't the practiced yes");
  open(d, 6000);
  assert.equal(feed(d, blink(6700, 480)), CONFIRM_BLINK);
  assert.ok(gate.confirm(7220));
  assert.equal(gate.confirm(7300), null);
});

test("ordinary spaced blinks, double blinks, shallow noise and uncalibrated profiles do not request", () => {
  for (const p of [null, profile]) {
    const d = new BlinkIntent(p); open(d, 0);
    for (const t of [1000, 4000, 8000]) assert.equal(feed(d, blink(t)), null);
  }
  const d = new BlinkIntent(profile); open(d, 0);
  for (const t of [1000, 1400]) assert.equal(feed(d, blink(t)), null);
  assert.equal(feed(d, { ...blink(1800), amplitude: 0.04 }), null);
});

test("tracking loss resets the burst and confirmation readiness", () => {
  const d = new BlinkIntent(profile); open(d, 0);
  feed(d, blink(1000)); feed(d, blink(1400));
  d.update({ state: "UNAVAILABLE" }, 1700, false);
  assert.equal(feed(d, blink(1800)), null);
  d.waitForQuestion(); d.questionFinished(3000); open(d, 3100);
  d.update(null, 3800, false);
  assert.equal(feed(d, blink(4000, 480)), null);
});

test("replaying a displayed count or a stale event cannot add a blink", () => {
  const d = new BlinkIntent(profile); open(d, 0);
  const e = blink(1000); feed(d, e);
  for (let t = 1300; t < 3000; t += 40) assert.equal(d.update({ state: "OPEN", last: e, total: 999 }, t), null);
});
