import test from "node:test";
import assert from "node:assert/strict";
import {
  EXERCISES,
  MoveSession,
  OneEuroFilter,
  RepCounter,
  analyzePose,
  jointAngle,
  movementConfig,
  resolvePlan,
} from "../app/everyday/move-engine.js";

function runner(exerciseId, options = {}) {
  const counter = new RepCounter(movementConfig(exerciseId, options));
  let timestamp = 0;
  const results = [];
  return {
    counter,
    results,
    hold(angle, duration = 500, extra = {}) {
      const end = timestamp + duration;
      while (timestamp < end) {
        results.push(
          counter.update({
            valid: true,
            angle,
            confidence: 0.95,
            timestamp,
            hipY: 0.65,
            bodyHeight: 0.3,
            ...extra,
          }),
        );
        timestamp += 50;
      }
      return this;
    },
    gap(milliseconds) {
      timestamp += milliseconds;
      return this;
    },
    invalid() {
      counter.update({ valid: false, reason: "Occluded" });
      return this;
    },
  };
}

function frameAtAngle(angle, timestamp, exerciseId = "elbow_flexion") {
  const landmarks = Array.from({ length: 33 }, () => ({
    x: 0.5,
    y: 0.5,
    visibility: 0.95,
    presence: 0.95,
  }));
  const radians = (angle * Math.PI) / 180;
  const a = { x: 0.4, y: 0.3, visibility: 0.95, presence: 0.95 };
  const b = { x: 0.4, y: 0.55, visibility: 0.95, presence: 0.95 };
  const c = {
    x: 0.4 + 0.25 * Math.sin(radians),
    y: 0.55 - 0.25 * Math.cos(radians),
    visibility: 0.95,
    presence: 0.95,
  };
  const joints = exerciseId === "knee_extension" ? [23, 25, 27] : [11, 13, 15];
  [landmarks[joints[0]], landmarks[joints[1]], landmarks[joints[2]]] = [
    a,
    b,
    c,
  ];
  return { landmarks, timestamp, width: 1000, height: 1000 };
}

test("Move angle restores image aspect and rejects degenerate points", () => {
  assert.equal(
    jointAngle(
      { x: 0.5, y: 0.2 },
      { x: 0.5, y: 0.5 },
      { x: 0.8, y: 0.5 },
      640,
      480,
    ),
    90,
  );
  const angle = jointAngle(
    { x: 0.5, y: 0.2 },
    { x: 0.5, y: 0.5 },
    { x: 0.8, y: 0.8 },
    640,
    480,
  );
  assert.ok(Math.abs(angle - 126.86989764584402) < 1e-6);
  assert.equal(
    jointAngle({ x: 0.5, y: 0.5 }, { x: 0.5, y: 0.5 }, { x: 0.8, y: 0.8 }),
    null,
  );
  assert.equal(jointAngle(null, {}, {}), null);
  assert.equal(
    jointAngle({ x: 0, y: 0 }, { x: 1, y: 0 }, { x: 1, y: 1 }, Infinity, 480),
    null,
  );
});

test("Move requires visible, in-frame task joints and refuses multiple people", () => {
  const good = frameAtAngle(160, 0);
  assert.equal(analyzePose(good, "elbow_flexion").valid, true);
  good.landmarks[15].visibility = 0.4;
  assert.match(analyzePose(good, "elbow_flexion").reason, /wrist/);
  good.landmarks[15].visibility = 0.95;
  good.landmarks[15].x = 1.1;
  assert.match(analyzePose(good, "elbow_flexion").reason, /inside the frame/);
  assert.match(
    analyzePose({ ...good, personCount: 2 }, "elbow_flexion").reason,
    /one person/,
  );
  assert.equal(analyzePose(good, "made_up").valid, false);
});

test("Each Move exercise requires an observed start, target and return", () => {
  for (const [id, spec] of Object.entries(EXERCISES)) {
    const start =
      spec.direction === "increase" ? spec.start - 5 : spec.start + 5;
    const target =
      spec.direction === "increase" ? spec.target + 5 : spec.target - 5;
    const r = runner(id)
      .hold(start)
      .hold(target, 600, { hipY: 0.4 })
      .hold(start);
    assert.equal(r.counter.reps, 1, id);
    assert.equal(r.results.filter((result) => result.counted).length, 1, id);
  }
});

test("Move rejects target-first startup and incomplete movements", () => {
  const r = runner("knee_extension").hold(165, 1500).hold(100, 600);
  assert.equal(r.counter.reps, 0);
  r.hold(145, 700).hold(100, 700);
  assert.equal(r.counter.reps, 0);
  r.hold(165, 600).hold(100, 600);
  assert.equal(r.counter.reps, 1);
});

test("Holding a target never creates repeated Move repetitions", () => {
  const r = runner("elbow_flexion").hold(165).hold(60, 5000);
  assert.equal(r.counter.reps, 0);
  r.hold(165, 600);
  assert.equal(r.counter.reps, 1);
  r.hold(165, 2000);
  assert.equal(r.counter.reps, 1);
});

test("Move target jitter and a brief target crossing do not complete the hold", () => {
  const r = runner("shoulder_flexion", { holdMs: 400 }).hold(20);
  for (let i = 0; i < 10; i++) r.hold(87, 100).hold(82, 100);
  r.hold(20);
  assert.equal(r.counter.reps, 0);
});

test("Occlusion and frame gaps discard incomplete Move cycles", () => {
  const hidden = runner("knee_extension")
    .hold(100)
    .hold(165)
    .invalid()
    .hold(100);
  assert.equal(hidden.counter.reps, 0);
  hidden.hold(165).hold(100);
  assert.equal(hidden.counter.reps, 1);
  const gap = runner("elbow_flexion").hold(165).hold(60).gap(800).hold(165);
  assert.equal(gap.counter.reps, 0);
});

test("Sit-to-stand needs hip rise as well as knee extension", () => {
  const r = runner("sit_to_stand")
    .hold(100)
    .hold(165, 700, { hipY: 0.65 })
    .hold(100);
  assert.equal(r.counter.reps, 0);
  r.hold(165, 700, { hipY: 0.4 }).hold(100);
  assert.equal(r.counter.reps, 1);
});

test("One Euro smoothing resets after a tracking break", () => {
  const filter = new OneEuroFilter();
  assert.equal(filter.update(90, 0), 90);
  const smoothed = filter.update(100, 33);
  assert.ok(smoothed > 90 && smoothed < 100);
  assert.equal(filter.update(20, 1000), 20);
  assert.equal(filter.update(30, 1033, 0.1), null);
  assert.equal(filter.update(40, 1066), 40);
});

test("Move configuration validates clinician and practice thresholds", () => {
  assert.throws(
    () => movementConfig("knee_extension", { start: 170, target: 130 }),
    /separated/,
  );
  assert.throws(
    () => movementConfig("elbow_flexion", { holdMs: -1 }),
    /hold time/,
  );
  assert.throws(
    () => movementConfig("elbow_flexion", { direction: "increase" }),
    /direction/,
  );
  assert.throws(
    () => movementConfig("elbow_flexion", { returnMs: NaN }),
    /observations/,
  );
  assert.equal(
    movementConfig("knee_extension", { exerciseId: "elbow_flexion" })
      .exerciseId,
    "knee_extension",
  );
});

test("Rehabilitation plans require explicit clinician origin and a matching movement", () => {
  const plan = {
    id: "plan-1",
    source: "clinician",
    value: {
      clinicianName: "Clinician",
      approvedAt: "2026-11-10T00:00:00.000Z",
      exercises: [
        {
          exerciseId: "elbow_flexion",
          side: "left",
          reps: 4,
          limits: { target: 85 },
        },
      ],
    },
  };
  assert.equal(resolvePlan(plan, "elbow_flexion", "left").planId, "plan-1");
  assert.equal(resolvePlan(plan, "elbow_flexion", "right"), null);
  assert.equal(
    resolvePlan({ ...plan, source: "user" }, "elbow_flexion", "left"),
    null,
  );
  assert.equal(
    resolvePlan(
      { ...plan, value: { ...plan.value, approvedAt: null } },
      "elbow_flexion",
      "left",
    ),
    null,
  );
  assert.equal(
    resolvePlan(
      { ...plan, value: { ...plan.value, clinicianName: 123 } },
      "elbow_flexion",
      "left",
    ),
    null,
  );
  assert.equal(
    resolvePlan(
      { ...plan, value: { ...plan.value, exercises: {} } },
      "elbow_flexion",
      "left",
    ),
    null,
  );
});

test("A real landmark sequence creates a sourced Move session without filling missing data", () => {
  const session = new MoveSession({
    exerciseId: "elbow_flexion",
    repsPerSet: 1,
  });
  let t = 0;
  const hold = (angle, duration) => {
    const end = t + duration;
    while (t < end) {
      session.update(frameAtAngle(angle, t));
      t += 33;
    }
  };
  hold(165, 900);
  hold(60, 1000);
  hold(165, 1000);
  assert.equal(session.counter.reps, 1);
  const before = session.observedMs;
  session.pause();
  t += 15000;
  session.update(frameAtAngle(165, t));
  assert.equal(session.observedMs, before);
  const record = session.record();
  assert.equal(record.source, "camera_estimate");
  assert.equal(record.model_id, "mediapipe-pose-lite");
  assert.equal(record.value.sets, 1);
  assert.ok(record.value.romDegrees > 80);
  assert.ok(record.confidence > 0.9);
  const empty = new MoveSession({ exerciseId: "knee_extension" }).record();
  assert.equal(empty.value.romDegrees, null);
  assert.equal(empty.confidence, 0);
  assert.equal(empty.value.reps, 0);
});

test("Move duration includes observed invalid frames while valid observation time excludes them", () => {
  const session = new MoveSession({ exerciseId: "elbow_flexion" });
  session.update(frameAtAngle(165, 0));
  session.update(frameAtAngle(165, 100));
  const occluded = frameAtAngle(165, 200);
  occluded.landmarks[15].visibility = 0;
  session.update(occluded);
  session.update(frameAtAngle(165, 300));
  assert.equal(session.durationMs, 300);
  assert.equal(session.observedMs, 100);
  session.pause();
  session.update(frameAtAngle(165, 500));
  assert.equal(session.durationMs, 300);
});
