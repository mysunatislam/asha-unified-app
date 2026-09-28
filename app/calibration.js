import { BlinkCounter } from "./blink-counter.js";
import { rapidTriple, blinkProfile, RAPID_BLINK, CONFIRM_BLINK } from "./blink-intent.js";
export class GuidedCalibration {
  constructor(a = {}) {
    this.steps = [
      {
        id: "neutral",
        label: "Relax your face. Look comfortably toward the camera.",
        ms: 3000,
        still: true,
      },
    ];
    if (a.eyes && a.eyes !== "none") this.steps.push(
      { id: "rapidBlink", label: "Keep your eyes open briefly. Blink three times quickly in a row, fully reopening each time. This will ask Asha for attention.", event: RAPID_BLINK },
      { id: "confirmBlink", label: "Practice the separate yes response: close both eyes deliberately, a little longer than your quick blinks (about half to one second), then reopen. Relax between attempts. Repeat three times.", event: CONFIRM_BLINK },
    );
    if (a.lips !== "none")
      this.steps.push({
        id: "smile",
        label: "Smile comfortably, then relax. Repeat three times.",
        event: "SMILE_COMPLETED",
      });
    if (a.lips !== "none")
      this.steps.push({
        id: "pucker",
        label: "Pucker your lips gently, then relax. Repeat three times.",
        event: "PUCKER_COMPLETED",
      });
    if (a.head !== "none")
      this.steps.push(
        {
          id: "nod",
          label: "Gently nod and return to rest. Repeat three times.",
          event: "NOD_COMPLETED",
        },
        {
          id: "left",
          label:
            "Turn gently to your left, return to center. Repeat three times.",
          event: "LEFT_TURN_COMPLETED",
        },
        {
          id: "right",
          label:
            "Turn gently to your right, return to center. Repeat three times.",
          event: "RIGHT_TURN_COMPLETED",
        },
      );
    this.index = 0;
    this.stages = {};
    this.frames = [];
    this.events = [];
    this.last = null;
    this.validMs = 0;
    this.enabled = [];
    this.baseline = null;
    this.lastReplay = 0;
    this.blinkCounter = new BlinkCounter();
  }
  get step() {
    return this.steps[this.index];
  }
  skip() {
    if (this.index === 0) return;
    if (this.step.id === "rapidBlink") this.next();
    this.next();
  }
  next() {
    this.index++;
    this.frames = [];
    this.events = [];
    this.validMs = 0;
    this.last = null;
    this.lastReplay = 0;
    this.blinkCounter = new BlinkCounter();
    this.lastBlinkAt = null;
  }
  update(f) {
    if (!this.step) return { done: true };
    const C = globalThis.NF_calibration,
      E = globalThis.NF_engine;
    const q = C.quality(f, this.step);
    if (
      this.step.id === "neutral" &&
      f.facePresent &&
      (Math.max(f.mouthSmileLeft, f.mouthSmileRight) > 0.18 ||
        Math.max(f.eyeBlinkLeft, f.eyeBlinkRight) > 0.25 ||
        f.jawOpen > 0.2)
    ) {
      q.ok = false;
      q.reasons = ["Relax your face with eyes open"];
    }
    if (!q.ok) {
      this.last = null;
      if (["rapidBlink", "confirmBlink"].includes(this.step.id)) {
        this.events = [];
        this.blinkCounter = new BlinkCounter();
      }
      return { message: q.reasons[0], progress: 0 };
    }
    if (this.last !== null && f.timestamp - this.last < 250)
      this.validMs += f.timestamp - this.last;
    this.last = f.timestamp;
    this.frames.push({ ...f });
    if (this.frames.length > 6000) {
      this.frames.shift();
    }
    if (["rapidBlink", "confirmBlink"].includes(this.step.id)) {
      const eye = this.blinkCounter.update(f, f.timestamp), e = eye.last;
      if (e && e.timestamp !== this.lastBlinkAt) {
        this.lastBlinkAt = e.timestamp;
        const rapid = this.stages.rapidBlink?.events;
        const minConfirm = Math.max(240, (rapid ? rapid.reduce((sum, x) => sum + x.duration, 0) / 3 : 160) * 1.5);
        if (this.step.id === "rapidBlink") {
          if (e.duration > 500 || e.amplitude < 0.08) this.events = [];
          else {
            if (this.events.length && e.start - this.events.at(-1).timestamp > 650) this.events = [];
            this.events.push(e);
            this.events = this.events.slice(-3);
          }
        } else if (rapid && e.duration >= minConfirm && e.duration <= 1200 && e.amplitude >= 0.08) this.events.push(e);
      }
      const done = this.step.id === "rapidBlink" ? rapidTriple(this.events) : this.events.length >= 3;
      if (!done) return { progress: Math.min(1, this.events.length / 3), message: `${this.events.length}/3 ${this.step.id === "rapidBlink" ? "quick consecutive blinks" : "separate deliberate confirmation blinks"}` };
      this.stages[this.step.id] = { events: [...this.events] };
      if (this.step.id === "confirmBlink") {
        this.baseline.blinkIntent = blinkProfile(this.stages.rapidBlink.events, this.events);
        this.enabled.push(RAPID_BLINK, CONFIRM_BLINK);
      }
      this.next();
      return { advanced: true, done: !this.step, baseline: this.baseline, enabled: this.enabled };
    }
    if (
      this.step.event &&
      this.validMs > 1500 &&
      f.timestamp - this.lastReplay > 500
    ) {
      this.lastReplay = f.timestamp;
      const stats = C.summarize(this.frames),
        draft = { ...this.stages, [this.step.id]: { stats, events: [] } };
      const range =
        this.step.id === "smile"
            ? Math.max(
                stats.mouthSmileLeft.p95 - stats.mouthSmileLeft.p5,
                stats.mouthSmileRight.p95 - stats.mouthSmileRight.p5,
              )
            : this.step.id === "pucker"
              ? stats.mouthPucker.p95 - stats.mouthPucker.p5
              : ["left", "right"].includes(this.step.id)
                ? stats.yaw.p95 - stats.yaw.p5
                : stats.pitch.p95 - stats.pitch.p5;
      if (
        range > (["nod", "left", "right"].includes(this.step.id) ? 2 : 0.025)
      ) {
        try {
          const b = C.build(draft, this.baseline);
          this.events = E.replay(this.frames, {
            baseline: b,
            config: { smoothing: { blink: 0, smile: 0, pose: 0, geometry: 0 } },
          }).events.filter((x) => x.type === this.step.event);
        } catch {
          this.events = [];
        }
      }
    }
    const done = this.step.event
      ? this.events.length >= 3
      : this.validMs >= this.step.ms;
    if (done) {
      const id = this.step.id;
      this.stages[id] = {
        stats: C.summarize(this.frames),
        events: this.events,
        validMs: this.validMs,
      };
      this.baseline = C.build(this.stages, this.baseline);
      if (this.step.event) this.enabled.push(this.step.event);
      this.next();
      return {
        advanced: true,
        done: !this.step,
        baseline: this.baseline,
        enabled: this.enabled,
      };
    }
    return {
      message: this.step.event
        ? `${Math.min(3, this.events.length)} of 3 completed movements`
        : "Keep your face relaxed",
      progress: this.step.event
        ? Math.min(1, this.events.length / 3)
        : this.validMs / this.step.ms,
    };
  }
}
