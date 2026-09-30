import assert from "node:assert/strict";
import test from "node:test";
import { SpeechCapture } from "../app/speech-capture.js";

function fakeClock() {
  let time = 0;
  let nextId = 1;
  const timers = new Map();
  return {
    now: () => time,
    setTimer(callback, delay) {
      const id = nextId++;
      timers.set(id, { callback, due: time + delay });
      return id;
    },
    clearTimer(id) {
      timers.delete(id);
    },
    advance(milliseconds) {
      const target = time + milliseconds;
      while (true) {
        const next = [...timers.entries()]
          .filter(([, timer]) => timer.due <= target)
          .sort((a, b) => a[1].due - b[1].due)[0];
        if (!next) break;
        const [id, timer] = next;
        timers.delete(id);
        time = timer.due;
        timer.callback();
      }
      time = target;
    },
  };
}

class FakeRecognition {
  static instances = [];

  constructor() {
    this.started = 0;
    this.aborted = 0;
    FakeRecognition.instances.push(this);
  }

  start() {
    this.started++;
  }

  abort() {
    this.aborted++;
  }

  result(...results) {
    this.onresult?.({
      resultIndex: 0,
      results: results.map(([transcript, isFinal]) =>
        Object.assign([{ transcript }], { isFinal }),
      ),
    });
  }

  end() {
    this.onend?.();
  }

  error(error) {
    this.onerror?.({ error });
  }
}

function fixture(options = {}) {
  FakeRecognition.instances = [];
  const clock = fakeClock();
  const texts = [];
  const states = [];
  const capture = new SpeechCapture({
    Recognition: FakeRecognition,
    now: clock.now,
    setTimer: clock.setTimer,
    clearTimer: clock.clearTimer,
    durationMs: 90_000,
    cooldownMs: 600,
    onText: (display, details) => texts.push({ display, ...details }),
    onState: (state) => states.push(state),
    ...options,
  });
  return { clock, texts, states, capture };
}

test("a continuous 90-second session re-arms after a browser silence end", () => {
  const { capture, clock, states } = fixture();
  assert.equal(capture.start({ language: "bn-BD" }), true);
  const first = FakeRecognition.instances[0];
  assert.equal(first.lang, "bn-BD");
  assert.equal(first.continuous, true);
  assert.equal(first.interimResults, true);
  clock.advance(10_000);
  first.end();
  clock.advance(249);
  assert.equal(FakeRecognition.instances.length, 1);
  clock.advance(1);
  assert.equal(FakeRecognition.instances.length, 2);
  assert.equal(capture.active, true);
  clock.advance(79_750);
  assert.equal(capture.active, false);
  assert.equal(states.at(-1).state, "complete");
  assert.equal(states.at(-1).reason, "time-limit");
  assert.equal(FakeRecognition.instances.length, 2);
});

test("cumulative result events do not duplicate finals, including after a restart", () => {
  const { capture, clock, texts } = fixture();
  capture.start({ initialText: "Patient said" });
  const first = FakeRecognition.instances[0];
  first.result(["red", true], ["rabb", false]);
  first.result(["red", true], ["rabbit", true], ["gre", false]);
  assert.deepEqual(texts.at(-1), {
    display: "Patient said red rabbit gre",
    finalText: "Patient said red rabbit",
    interimText: "gre",
  });
  first.end();
  clock.advance(250);
  FakeRecognition.instances[1].result(["green", true]);
  assert.deepEqual(texts.at(-1), {
    display: "Patient said red rabbit green",
    finalText: "Patient said red rabbit green",
    interimText: "",
  });
});

test("stop prevents re-arming and ignores stale events", () => {
  const { capture, clock, texts, states } = fixture();
  capture.start();
  const first = FakeRecognition.instances[0];
  first.result(["hello", true]);
  capture.stop("user-stop");
  const textCount = texts.length;
  first.result(["obsolete", true]);
  first.end();
  clock.advance(1_000);
  assert.equal(first.aborted, 1);
  assert.equal(FakeRecognition.instances.length, 1);
  assert.equal(texts.length, textCount);
  assert.equal(states.at(-1).reason, "user-stop");
});

test("output pause blocks Asha's voice, freezes budget, and resumes after cooldown", () => {
  const { capture, clock, texts, states } = fixture();
  capture.start();
  const first = FakeRecognition.instances[0];
  clock.advance(20_000);
  first.result(["please", true]);
  capture.pauseForOutput();
  assert.equal(first.aborted, 1);
  assert.equal(capture.paused, true);
  assert.equal(capture.remainingMs, 70_000);
  clock.advance(30_000);
  first.result(["Asha says something", true]);
  assert.equal(texts.at(-1).display, "please");
  assert.equal(capture.remainingMs, 70_000);
  capture.resumeAfterOutput();
  clock.advance(599);
  assert.equal(FakeRecognition.instances.length, 1);
  clock.advance(1);
  assert.equal(FakeRecognition.instances.length, 2);
  assert.equal(capture.paused, false);
  clock.advance(69_999);
  assert.equal(capture.active, true);
  clock.advance(1);
  assert.equal(capture.active, false);
  assert.equal(states.at(-1).reason, "time-limit");
});

test("fatal mic permission errors stop; no-speech errors are recoverable", () => {
  const { capture, clock, states } = fixture();
  capture.start();
  const first = FakeRecognition.instances[0];
  first.error("no-speech");
  first.end();
  clock.advance(250);
  const second = FakeRecognition.instances[1];
  second.error("not-allowed");
  second.end();
  clock.advance(1_000);
  assert.equal(capture.active, false);
  assert.equal(FakeRecognition.instances.length, 2);
  assert.equal(states.at(-1).state, "error");
  assert.equal(states.at(-1).reason, "not-allowed");
});

test("a second output pause cancels a pending microphone resume", () => {
  const { capture, clock } = fixture();
  capture.start();
  capture.pauseForOutput();
  capture.resumeAfterOutput();
  clock.advance(400);
  capture.pauseForOutput();
  clock.advance(600);
  assert.equal(capture.paused, true);
  assert.equal(FakeRecognition.instances.length, 1);
  capture.resumeAfterOutput();
  clock.advance(600);
  assert.equal(FakeRecognition.instances.length, 2);
});

test("rapid browser silence loops back off without ending the session", () => {
  const { capture, clock } = fixture();
  capture.start();
  FakeRecognition.instances[0].end();
  clock.advance(250);
  assert.equal(FakeRecognition.instances.length, 2);
  FakeRecognition.instances[1].end();
  clock.advance(499);
  assert.equal(FakeRecognition.instances.length, 2);
  clock.advance(1);
  assert.equal(FakeRecognition.instances.length, 3);
  assert.equal(capture.active, true);
});

test("unsupported browsers report an error without starting a session", () => {
  const { states, capture } = fixture({ Recognition: null });
  assert.equal(capture.start(), false);
  assert.equal(capture.active, false);
  assert.equal(states.at(-1).state, "error");
  assert.equal(states.at(-1).reason, "unsupported");
});

test("stopping during output cooldown never resurrects recognition", () => {
  const { capture, clock } = fixture();
  capture.start();
  capture.pauseForOutput();
  capture.resumeAfterOutput();
  capture.stop();
  clock.advance(90_000);
  assert.equal(FakeRecognition.instances.length, 1);
  assert.equal(capture.active, false);
});
