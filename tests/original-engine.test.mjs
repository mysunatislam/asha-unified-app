import { createRequire } from "node:module";
const require = createRequire(import.meta.url);
// Original NeuroFace regression cases, run against this app's preserved engine.
const test = require("node:test"),
  assert = require("node:assert/strict");
const fs = require("node:fs"),
  vm = require("node:vm");
function originalModule(name) {
  const source = fs.readFileSync(
    new URL("../neuroface/src/" + name + ".js", import.meta.url),
    "utf8",
  );
  return vm.runInThisContext(
    "(function(module,require){" + source + ";return module.exports;})",
  )({ exports: {} }, (path) =>
    originalModule(path.replace("./", "").replace(".js", "")),
  );
}
const E = originalModule("engine"),
  C = originalModule("calibration");
const BASE = {
  facePresent: true,
  poseValid: true,
  blendshapesValid: true,
  faceQuality: 1,
  earLeft: 0.27,
  earRight: 0.27,
  earMean: 0.27,
  eyeBlinkLeft: 0,
  eyeBlinkRight: 0,
  mouthSmileLeft: 0.02,
  mouthSmileRight: 0.02,
  cheekSquintLeft: 0,
  cheekSquintRight: 0,
  mouthClose: 1,
  jawOpen: 0,
  mouthPucker: 0,
  mouthCornerLeftX: 0.2,
  mouthCornerLeftY: 0,
  mouthCornerRightX: -0.2,
  mouthCornerRightY: 0,
  yaw: 0,
  pitch: 0,
  roll: 0,
  faceSize: 0.4,
  centerX: 0.5,
  centerY: 0.5,
  inFrame: true,
  brightness: 120,
  fps: 30,
  poseSpeed: 0,
  mouthWidth: 0.15,
  browGap: 0.05,
  lipDeviation: 0,
};
function runner(options = {}, fps = 30) {
  const engine = new E.Engine(options),
    events = [],
    commands = [],
    results = [];
  let t = 0;
  return {
    engine,
    events,
    commands,
    results,
    get time() {
      return t;
    },
    hold(ms, patch = {}) {
      const end = t + ms;
      while (t < end) {
        const f = { ...BASE, ...patch, timestamp: t };
        f.earMean = (f.earLeft + f.earRight) / 2;
        const r = engine.process(f);
        events.push(...r.events);
        commands.push(...r.commands);
        results.push(r);
        t += 1000 / fps;
      }
      return this;
    },
    blink(ms = 350) {
      return this.hold(ms, {
        earLeft: 0.07,
        earRight: 0.07,
        eyeBlinkLeft: 0.95,
        eyeBlinkRight: 0.95,
      }).hold(350);
    },
    turn(side = -1) {
      return this.hold(400, { yaw: side * 24 }).hold(500);
    },
    count(type) {
      return events.filter((e) => e.type === type).length;
    },
  };
}
test("A: completed blink exactly once", () => {
  const r = runner().hold(500).blink(150);
  assert.equal(r.count("BLINK_COMPLETED"), 1);
  assert.equal(r.events[0].deliberate, false);
});
test("screenshot shallow bilateral EAR drops count after full reopening without blendshape activation", () => {
  const open = {
    earLeft: 0.45,
    earRight: 0.45,
    eyeBlinkLeft: 0,
    eyeBlinkRight: 0,
  };
  const dip = { ...open, earLeft: 0.39, earRight: 0.39 };
  const r = runner().hold(500, open).hold(160, dip);
  assert.equal(r.count("BLINK_COMPLETED"), 0);
  r.hold(260, open);
  assert.equal(r.count("BLINK_COMPLETED"), 1);
  assert.equal(r.events[0].deliberate, false);
});
test("neutral tracked face has full signal consistency, not a 25 percent movement score", () => {
  const r = runner().hold(500);
  assert.ok(r.results.at(-1).scores.motor >= 95);
  assert.ok(r.results.at(-1).scores.smile >= 95);
});
test("B: holding eyes closed emits nothing until reopening and never repeats", () => {
  const r = runner().hold(500).hold(700, {
    earLeft: 0.07,
    earRight: 0.07,
    eyeBlinkLeft: 0.95,
    eyeBlinkRight: 0.95,
  });
  assert.equal(r.count("BLINK_COMPLETED"), 0);
  r.hold(500);
  assert.equal(r.count("BLINK_COMPLETED"), 1);
  r.hold(1500);
  assert.equal(r.count("BLINK_COMPLETED"), 1);
});
test("extremely long closure rejected", () => {
  const r = runner().hold(500).blink(2400);
  assert.equal(r.count("BLINK_COMPLETED"), 0);
});
test("single-frame closure rejected", () => {
  const r = runner()
    .hold(500)
    .hold(30, {
      earLeft: 0.07,
      earRight: 0.07,
      eyeBlinkLeft: 0.95,
      eyeBlinkRight: 0.95,
    })
    .hold(500);
  assert.equal(r.count("BLINK_COMPLETED"), 0);
});
test("C: threshold jitter never completes repeated blinks", () => {
  const r = runner().hold(500);
  for (let i = 0; i < 30; i++)
    r.hold(34, {
      earLeft: 0.16 + (i % 2 ? 0.01 : -0.01),
      earRight: 0.16 + (i % 2 ? 0.01 : -0.01),
      eyeBlinkLeft: 0.2,
      eyeBlinkRight: 0.2,
    });
  r.hold(500);
  assert.equal(r.count("BLINK_COMPLETED"), 0);
});
test("D: triple deliberate blink progress and one water command", () => {
  const r = runner().hold(500).blink();
  assert.equal(r.engine.commands.progress(r.time).water.count, 1);
  r.blink();
  assert.equal(r.engine.commands.progress(r.time).water.count, 2);
  r.blink();
  assert.equal(r.count("BLINK_COMPLETED"), 3);
  assert.equal(r.commands.filter((e) => e.command === "water").length, 1);
  assert.equal(r.engine.commands.progress(r.time).water.count, 0);
  r.hold(2000);
  assert.equal(r.commands.length, 1);
});
test("ordinary blinks and turned-away blinks never command water", () => {
  const r = runner().hold(500).blink(120).blink(120).blink(120);
  assert.equal(r.commands.length, 0);
  const s = runner().hold(500, { yaw: 25 });
  for (let i = 0; i < 3; i++)
    s.hold(400, {
      yaw: 25,
      earLeft: 0.07,
      earRight: 0.07,
      eyeBlinkLeft: 0.95,
      eyeBlinkRight: 0.95,
    }).hold(350, { yaw: 25 });
  assert.equal(s.commands.length, 0);
});
test("E: expired blink sequence resets", () => {
  const r = runner().hold(500).blink().hold(5200).blink().blink();
  assert.equal(r.commands.length, 0);
  assert.equal(r.engine.commands.progress(r.time).water.count, 2);
});
test("F: closed-mouth smile independent of jaw opening", () => {
  const r = runner().hold(500).hold(900, {
    mouthSmileLeft: 0.8,
    mouthSmileRight: 0.8,
    cheekSquintLeft: 0.5,
    cheekSquintRight: 0.5,
    jawOpen: 0,
  });
  assert.equal(r.count("SMILE_HELD"), 1);
  assert.equal(r.results.at(-1).smile.closedMouthSmile, true);
  assert.equal(r.results.at(-1).smile.smileDetected, true);
});
test("G: asymmetric smile recognized and measured", () => {
  const r = runner().hold(500).hold(900, {
    mouthSmileLeft: 0.85,
    mouthSmileRight: 0.05,
    cheekSquintLeft: 0.5,
  });
  assert.equal(r.count("SMILE_HELD"), 1);
  assert.ok(r.results.at(-1).smile.symmetryScore < 40);
});
test("H/I: hold left counts zero; return exactly one", () => {
  const r = runner().hold(500).hold(1200, { yaw: -24 });
  assert.equal(r.count("LEFT_TURN_COMPLETED"), 0);
  r.hold(500);
  assert.equal(r.count("LEFT_TURN_COMPLETED"), 1);
  r.hold(1000);
  assert.equal(r.count("LEFT_TURN_COMPLETED"), 1);
});
test("J: three left returns yield food; right symmetric yields toilet", () => {
  for (const side of [-1, 1]) {
    const r = runner().hold(500).turn(side).turn(side).turn(side);
    assert.equal(
      r.count(side < 0 ? "LEFT_TURN_COMPLETED" : "RIGHT_TURN_COMPLETED"),
      3,
    );
    assert.equal(r.commands.length, 1);
    assert.equal(r.commands[0].command, side < 0 ? "food" : "toilet");
  }
});
test("K: center jitter and brief excursions rejected", () => {
  const r = runner().hold(500);
  for (let i = 0; i < 30; i++) r.hold(34, { yaw: i % 2 ? 4 : -4 });
  r.hold(40, { yaw: -24 }).hold(500);
  assert.equal(r.count("LEFT_TURN_COMPLETED"), 0);
  assert.equal(r.count("RIGHT_TURN_COMPLETED"), 0);
});
test("L: tracking loss cannot finish blink or turn", () => {
  const r = runner()
    .hold(500)
    .hold(300, {
      earLeft: 0.07,
      earRight: 0.07,
      eyeBlinkLeft: 0.95,
      eyeBlinkRight: 0.95,
    })
    .hold(100, { facePresent: false, faceQuality: 0 })
    .hold(500)
    .hold(400, { yaw: -24 })
    .hold(100, { facePresent: false, faceQuality: 0 })
    .hold(500);
  assert.equal(r.events.length, 0);
});
test("tracking loss preserves completed command progress until timeout", () => {
  const r = runner()
    .hold(500)
    .turn(-1)
    .hold(300, { facePresent: false, faceQuality: 0 });
  assert.equal(r.engine.commands.progress(r.time).food.count, 1);
  r.hold(9000, { facePresent: false, faceQuality: 0 });
  assert.equal(r.engine.commands.progress(r.time).food.count, 0);
});
test("M: poor quality calibration pauses, no elapsed-time credit", () => {
  const m = new C.Manager();
  m.start();
  for (let t = 0; t < 6000; t += 100)
    m.update({ ...BASE, timestamp: t, faceQuality: 0.2 }, []);
  assert.equal(m.step, 0);
  assert.equal(m.frames.length, 0);
  assert.equal(m.validMs, 0);
  for (let t = 6000; t <= 8200; t += 100)
    m.update({ ...BASE, timestamp: t }, []);
  assert.equal(m.step, 1);
});
test("calibration requires three completed repetitions", () => {
  const m = new C.Manager();
  m.step = 7;
  m.start();
  for (let t = 0; t < 5000; t += 100) m.update({ ...BASE, timestamp: t }, []);
  assert.equal(m.step, 7);
  assert.equal(m.events.length, 0);
});
test("validation must recognize all five actions", () => {
  const m = new C.Manager();
  m.step = 12;
  m.candidate = E.baseline();
  m.start();
  let r = m.update({ ...BASE, timestamp: 100 }, [
    { type: "BLINK_COMPLETED", confidence: 0.9 },
  ]);
  assert.equal(r.validated, undefined);
  r = m.update(
    { ...BASE, timestamp: 200 },
    C.REQUIRED.map((type) => ({
      type,
      confidence: 0.9,
      closedMouthSmile: true,
    })),
  );
  assert.equal(r.validated, true);
});
test("robust calibration statistics ignore isolated outlier in median", () => {
  const s = E.stats([1, 1, 1, 2, 100]);
  assert.equal(s.median, 1);
  assert.equal(s.mad, 0);
  assert.equal(s.min, 1);
  assert.equal(s.max, 100);
});
test("nod plus held smile combines once; plain nod does not", () => {
  const smile = { mouthSmileLeft: 0.8, mouthSmileRight: 0.8 };
  const r = runner()
    .hold(700, smile)
    .hold(350, { ...smile, pitch: 20 })
    .hold(500, smile)
    .hold(1000, smile);
  assert.equal(r.count("NOD_COMPLETED"), 1);
  assert.equal(r.commands.filter((e) => e.command === "okay").length, 1);
  const plain = runner().hold(500).hold(350, { pitch: 20 }).hold(500);
  assert.equal(plain.commands.length, 0);
});
test("nod then smile within tolerance also combines", () => {
  const r = runner()
    .hold(500)
    .hold(350, { pitch: 20 })
    .hold(350)
    .hold(750, { mouthSmileLeft: 0.8, mouthSmileRight: 0.8 });
  assert.equal(r.commands.filter((e) => e.command === "okay").length, 1);
});
test("frame-rate independence at 15/24/30/60 FPS", () => {
  for (const fps of [15, 24, 30, 60]) {
    const r = runner({}, fps).hold(500).blink();
    for (let yaw = -4; yaw >= -24; yaw -= 4) r.hold(35, { yaw });
    r.hold(300, { yaw: -24 });
    for (let yaw = -20; yaw <= 0; yaw += 4) r.hold(35, { yaw });
    r.hold(500);
    assert.equal(r.count("BLINK_COMPLETED"), 1, "blink " + fps);
    assert.equal(r.count("LEFT_TURN_COMPLETED"), 1, "left " + fps);
  }
});
test("neutral-relative pose compensates offset", () => {
  const r = runner({ baseline: { neutralYaw: 17 } })
    .hold(500, { yaw: 17 })
    .hold(400, { yaw: -7 })
    .hold(500, { yaw: 17 });
  assert.equal(r.count("LEFT_TURN_COMPLETED"), 1);
});
test("outlier and nonmonotonic timestamps rejected", () => {
  const r = runner().hold(500).hold(34, { yaw: 170 });
  assert.equal(r.results.at(-1).accepted, false);
  assert.equal(r.engine.process({ ...BASE, timestamp: 1 }).accepted, false);
});
test("uninterrupted open eyes are needed after camera starts closed", () => {
  const r = runner()
    .hold(500, {
      earLeft: 0.07,
      earRight: 0.07,
      eyeBlinkLeft: 0.95,
      eyeBlinkRight: 0.95,
    })
    .hold(500);
  assert.equal(r.count("BLINK_COMPLETED"), 0);
});
test("disabled command engine clears pending sequences", () => {
  const c = new E.CommandEngine(E.DEFAULTS.commands);
  c.update(
    [{ type: "LEFT_TURN_COMPLETED", timestamp: 100, confidence: 1 }],
    100,
  );
  c.enabled = false;
  c.update([], 200);
  c.enabled = true;
  assert.equal(c.progress(300).food.count, 0);
});
test("replay produces identical events from full-rate features", () => {
  const r = runner().hold(500).blink().turn(-1);
  const frames = r.results.map((x) => x.raw);
  const replay = E.replay(frames);
  assert.deepEqual(replay.events, r.events);
  assert.deepEqual(replay.commands, r.commands);
});
test("pucker emits one event after release", () => {
  const r = runner().hold(500).hold(500, { mouthPucker: 0.9 }).hold(500);
  assert.equal(r.count("PUCKER_COMPLETED"), 1);
});
test("adaptive baseline never drifts during sustained head turn", () => {
  const r = runner({ baseline: { calibrated: true } })
    .hold(600)
    .hold(10000, { yaw: 20 });
  assert.equal(r.engine.baseline.neutralYaw, 0);
  assert.equal(r.engine.original.neutralYaw, 0);
});
test("personalized weak asymmetric smile remains detectable", () => {
  const r = runner({
    baseline: {
      neutralSmileLeft: 0.02,
      maxSmileLeft: 0.13,
      closedSmileThresholdLeft: 0.05,
      maxSmileRight: 0.055,
      closedSmileThresholdRight: 0.05,
    },
  })
    .hold(500)
    .hold(900, { mouthSmileLeft: 0.12, mouthSmileRight: 0.025 });
  assert.equal(r.count("SMILE_HELD"), 1);
});
test("enrollment learns weak closed-lip smiles without default amplitude gate", () => {
  const m = new C.Manager();
  m.step = 4;
  m.stages.neutral = {
    stats: C.summarize(
      Array.from({ length: 40 }, (_, i) => ({ ...BASE, timestamp: i * 33 })),
    ),
  };
  m.start();
  let t = 0;
  function h(ms, patch = {}) {
    for (let end = t + ms; t < end; t += 33)
      m.update({ ...BASE, ...patch, timestamp: t }, []);
  }
  h(600);
  for (let i = 0; i < 3; i++) {
    h(700, { mouthSmileLeft: 0.13, mouthSmileRight: 0.06 });
    h(500);
  }
  assert.equal(m.step, 5);
  assert.equal(m.stages.closedSmile.events.length, 3);
  assert.ok(m.candidate.closedSmileThresholdLeft < 0.1);
});
test("enrollment learns comfortable small left turns", () => {
  const m = new C.Manager();
  m.step = 7;
  m.stages.neutral = {
    stats: C.summarize(
      Array.from({ length: 40 }, (_, i) => ({ ...BASE, timestamp: i * 33 })),
    ),
  };
  m.start();
  let t = 0;
  function h(ms, patch = {}) {
    for (let end = t + ms; t < end; t += 33)
      m.update({ ...BASE, ...patch, timestamp: t }, []);
  }
  h(600);
  for (let i = 0; i < 3; i++) {
    h(450, { yaw: -6 });
    h(600);
  }
  assert.equal(m.step, 8);
  assert.equal(m.stages.left.events.length, 3);
  assert.ok(m.candidate.leftTurnEnterThreshold < 4);
});
test("partial recalibration cannot bypass initial workflow", () => {
  assert.throws(() => new C.Manager().retry("left"), /initial capture/);
});
test("camera pitch offset does not block neutral enrollment", () => {
  assert.equal(
    C.quality({ ...BASE, pitch: 23, relativePitch: 23 }, C.STEPS[1]).ok,
    true,
  );
});
test("weak head range thresholds are personalized from robust samples", () => {
  const stage = (patch) => ({
    stats: C.summarize(
      Array.from({ length: 40 }, (_, i) => ({
        ...BASE,
        ...patch,
        timestamp: i * 33,
      })),
    ),
    events: [],
  });
  const b = C.build({
    neutral: stage({ yaw: 10 }),
    left: stage({ yaw: 4 }),
    right: stage({ yaw: 17 }),
  });
  assert.equal(b.neutralYaw, 10);
  assert.ok(b.leftTurnEnterThreshold < 4);
  assert.ok(b.rightTurnEnterThreshold < 4);
});
export { BASE, runner };
test("baseline rejects nonfinite values and inverted hysteresis", () => {
  assert.throws(
    () => new E.Engine({ baseline: { neutralEARLeft: NaN } }),
    /baseline/,
  );
  assert.throws(
    () => new E.Engine({ baseline: { centerYawTolerance: 20 } }),
    /head thresholds/,
  );
});
test("classifier vector has fixed order and refuses missing features", () => {
  const f = { ...BASE, relativeYaw: 1, relativePitch: 2, relativeRoll: 3 };
  assert.equal(E.featureVector(f).length, E.FEATURE_VECTOR.length);
  assert.equal(E.featureVector(f)[11], 1);
  assert.throws(() => E.featureVector(BASE), /relativeYaw/);
});
