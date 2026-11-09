/** @typedef {{x:number,y:number,z?:number,visibility?:number,presence?:number}} Landmark */

export const MOVE_MODEL = Object.freeze({
  id: "mediapipe-pose-lite",
  version: "float16/1",
});

export const EXERCISES = Object.freeze({
  knee_extension: {
    label: "Seated knee extension",
    labelBn: "বসে হাঁটু সোজা করা",
    direction: "increase",
    start: 110,
    target: 155,
    return: 115,
    joints: ["hip", "knee", "ankle"],
    guide:
      "Sit on a stable chair. Place the camera side-on at knee height. Keep your hip, knee and ankle visible. Use only a comfortable movement you have chosen or your clinician has approved.",
    guideBn:
      "স্থির চেয়ারে বসুন। পাশ থেকে হাঁটুর উচ্চতায় ক্যামেরা রাখুন। নিতম্ব, হাঁটু ও গোড়ালি দৃশ্যমান রাখুন। নিজের স্বচ্ছন্দ বা চিকিৎসকের অনুমোদিত নড়াচড়া করুন।",
  },
  elbow_flexion: {
    label: "Elbow flexion",
    labelBn: "কনুই ভাঁজ করা",
    direction: "decrease",
    start: 150,
    target: 75,
    return: 145,
    joints: ["shoulder", "elbow", "wrist"],
    guide:
      "Sit or stand comfortably. Place the camera side-on to your working arm. Keep your shoulder, elbow and wrist visible, and keep the upper arm still.",
    guideBn:
      "স্বচ্ছন্দে বসুন বা দাঁড়ান। যে হাত নাড়াবেন তার পাশে ক্যামেরা রাখুন। কাঁধ, কনুই ও কবজি দৃশ্যমান রাখুন এবং বাহু স্থির রাখুন।",
  },
  shoulder_flexion: {
    label: "Shoulder flexion",
    labelBn: "সামনে হাত তোলা",
    direction: "increase",
    start: 30,
    target: 85,
    return: 35,
    joints: ["hip", "shoulder", "elbow"],
    guide:
      "Sit or stand comfortably with the camera side-on. Keep your hip, shoulder and elbow visible. The displayed angle follows the upper arm, so keep your elbow comfortably straight.",
    guideBn:
      "স্বচ্ছন্দে বসুন বা দাঁড়ান এবং পাশে ক্যামেরা রাখুন। নিতম্ব, কাঁধ ও কনুই দৃশ্যমান রাখুন। কোণটি বাহুর অবস্থান থেকে আসে, তাই কনুই স্বচ্ছন্দে সোজা রাখুন।",
  },
  sit_to_stand: {
    label: "Sit to stand",
    labelBn: "বসা থেকে দাঁড়ানো",
    direction: "increase",
    start: 110,
    target: 155,
    return: 115,
    joints: ["hip", "knee", "ankle"],
    fullBody: true,
    guide:
      "Use a stable chair and assistance if needed. Place the camera side-on with your full body in view. A repetition needs a seated start, a clear rise of the hips with knee extension, and a return to sitting.",
    guideBn:
      "স্থির চেয়ার ব্যবহার করুন এবং প্রয়োজনে সহায়তা নিন। পাশ থেকে পুরো শরীর ক্যামেরায় রাখুন। বসা অবস্থা থেকে নিতম্ব ওঠা ও হাঁটু সোজা হওয়া, তারপর আবার বসা হলে একটি পুনরাবৃত্তি হবে।",
  },
});

const INDEX = {
  left: { shoulder: 11, elbow: 13, wrist: 15, hip: 23, knee: 25, ankle: 27 },
  right: { shoulder: 12, elbow: 14, wrist: 16, hip: 24, knee: 26, ankle: 28 },
};
const clamp = (value, low, high) => Math.min(high, Math.max(low, value));

/** Angle in the camera image plane, with image aspect ratio restored. */
export function jointAngle(a, b, c, width = 1, height = 1) {
  if (
    ![a, b, c].every((p) => p && Number.isFinite(p.x) && Number.isFinite(p.y))
  )
    return null;
  if (
    !Number.isFinite(width) ||
    !Number.isFinite(height) ||
    !(width > 0) ||
    !(height > 0)
  )
    return null;
  const ux = (a.x - b.x) * width;
  const uy = (a.y - b.y) * height;
  const vx = (c.x - b.x) * width;
  const vy = (c.y - b.y) * height;
  const magnitude = Math.hypot(ux, uy) * Math.hypot(vx, vy);
  if (magnitude < 1e-8) return null;
  return (
    (Math.acos(clamp((ux * vx + uy * vy) / magnitude, -1, 1)) * 180) / Math.PI
  );
}

function landmarkConfidence(point) {
  if (!point || !Number.isFinite(point.x) || !Number.isFinite(point.y))
    return 0;
  return Math.min(point.visibility ?? 0, point.presence ?? 1);
}

/** Refuse unseen joints instead of extrapolating an angle through occlusion. */
export function analyzePose(frame, exerciseId, side = "left") {
  const exercise = EXERCISES[exerciseId];
  if (!exercise || !INDEX[side])
    return { valid: false, reason: "Choose an exercise and side." };
  if (!frame || !Number.isFinite(frame.timestamp))
    return { valid: false, reason: "Waiting for a camera frame." };
  if (frame.personCount > 1)
    return { valid: false, reason: "Keep only one person in the camera view." };
  const landmarks = frame.landmarks;
  const names = exercise.fullBody
    ? ["shoulder", "hip", "knee", "ankle"]
    : exercise.joints;
  for (const name of names) {
    const point = landmarks?.[INDEX[side][name]];
    if (landmarkConfidence(point) < 0.65)
      return {
        valid: false,
        reason: `Keep your ${side} ${name} clearly visible.`,
      };
    if (
      point.x < 0.015 ||
      point.x > 0.985 ||
      point.y < 0.015 ||
      point.y > 0.985
    )
      return {
        valid: false,
        reason: `Move the camera so your ${side} ${name} stays inside the frame.`,
      };
  }
  const points = exercise.joints.map((name) => landmarks[INDEX[side][name]]);
  const angle = jointAngle(...points, frame.width ?? 1, frame.height ?? 1);
  if (angle === null)
    return {
      valid: false,
      reason: "Separate the visible joints and reposition the camera side-on.",
    };
  const confidence = Math.min(
    ...names.map((name) => landmarkConfidence(landmarks[INDEX[side][name]])),
  );
  const hip = landmarks[INDEX[side].hip];
  const ankle = landmarks[INDEX[side].ankle];
  return {
    valid: true,
    angle,
    confidence,
    timestamp: frame.timestamp,
    hipY: hip?.y,
    bodyHeight: hip && ankle ? Math.max(0.08, Math.abs(hip.y - ankle.y)) : null,
    reason: "Tracking your visible movement",
  };
}

/** A confidence-aware One Euro filter. A tracking break discards its state. */
export class OneEuroFilter {
  constructor({ minCutoff = 1.2, beta = 0.025, derivativeCutoff = 1 } = {}) {
    this.minCutoff = minCutoff;
    this.beta = beta;
    this.derivativeCutoff = derivativeCutoff;
    this.reset();
  }
  reset() {
    this.last = null;
    this.raw = null;
    this.value = null;
    this.derivative = 0;
  }
  update(value, timestamp, confidence = 1) {
    if (
      !Number.isFinite(value) ||
      !Number.isFinite(timestamp) ||
      confidence < 0.65
    ) {
      this.reset();
      return null;
    }
    if (
      this.last === null ||
      timestamp - this.last > 400 ||
      timestamp <= this.last
    ) {
      this.last = timestamp;
      this.raw = this.value = value;
      this.derivative = 0;
      return value;
    }
    const seconds = (timestamp - this.last) / 1000;
    const alpha = (cutoff) => 1 / (1 + 1 / (2 * Math.PI * cutoff * seconds));
    const velocity = (value - this.raw) / seconds;
    this.derivative +=
      alpha(this.derivativeCutoff) * (velocity - this.derivative);
    const cutoff =
      this.minCutoff * clamp(confidence, 0.65, 1) +
      this.beta * Math.abs(this.derivative);
    this.value += alpha(cutoff) * (value - this.value);
    this.raw = value;
    this.last = timestamp;
    return this.value;
  }
}

export function movementConfig(exerciseId, overrides = {}) {
  const exercise = EXERCISES[exerciseId];
  if (!exercise) throw new Error("Unknown movement.");
  const config = {
    exerciseId,
    direction: exercise.direction,
    start: exercise.start,
    target: exercise.target,
    return: exercise.return,
    holdMs: 250,
    startMs: 250,
    returnMs: 250,
    maxRepMs: 20000,
    ...overrides,
    exerciseId,
  };
  for (const name of ["start", "target", "return"]) {
    if (
      !Number.isFinite(config[name]) ||
      config[name] < 0 ||
      config[name] > 180
    )
      throw new Error("Movement angles must be between 0 and 180 degrees.");
  }
  if (config.direction !== exercise.direction)
    throw new Error("The movement direction cannot be changed.");
  const separated =
    config.direction === "increase"
      ? config.start <= config.return && config.return < config.target - 10
      : config.start >= config.return && config.return > config.target + 10;
  if (!separated)
    throw new Error(
      "Start, target and return angles need separated movement ranges.",
    );
  if (
    !Number.isFinite(config.holdMs) ||
    config.holdMs < 0 ||
    config.holdMs > 10000
  )
    throw new Error("Choose a hold time from 0 to 10 seconds.");
  for (const name of ["startMs", "returnMs"]) {
    if (
      !Number.isFinite(config[name]) ||
      config[name] < 100 ||
      config[name] > 5000
    )
      throw new Error("Start and return observations must last 0.1–5 seconds.");
  }
  if (
    !Number.isFinite(config.maxRepMs) ||
    config.maxRepMs < 1000 ||
    config.maxRepMs > 120000
  )
    throw new Error("Choose a bounded movement observation window.");
  return config;
}

/** Counts a complete observed start -> target -> return cycle, once. */
export class RepCounter {
  constructor(config) {
    this.config = movementConfig(config.exerciseId, config);
    this.reps = 0;
    this.completedRanges = [];
    this.resetIncomplete();
  }
  resetIncomplete() {
    this.phase = "find_start";
    this.since = null;
    this.startedAt = null;
    this.minimum = Infinity;
    this.maximum = -Infinity;
    this.startHipY = null;
    this.startBodyHeight = null;
    this.last = null;
  }
  update(sample) {
    const { config } = this;
    if (
      !sample?.valid ||
      !Number.isFinite(sample.angle) ||
      !Number.isFinite(sample.timestamp)
    ) {
      this.resetIncomplete();
      return this.result(false, sample?.reason || "Tracking interrupted");
    }
    const t = sample.timestamp;
    if (this.last !== null && (t <= this.last || t - this.last > 400))
      this.resetIncomplete();
    this.last = t;
    if (this.startedAt !== null && t - this.startedAt > config.maxRepMs)
      this.resetIncomplete();
    const start =
      config.direction === "increase"
        ? sample.angle <= config.start
        : sample.angle >= config.start;
    const returned =
      config.direction === "increase"
        ? sample.angle <= config.return
        : sample.angle >= config.return;
    let target =
      config.direction === "increase"
        ? sample.angle >= config.target
        : sample.angle <= config.target;
    if (config.exerciseId === "sit_to_stand") {
      const requiredRise = (this.startBodyHeight ?? 0.2) * 0.14;
      target =
        target &&
        this.startHipY !== null &&
        this.startHipY - sample.hipY >= requiredRise;
    }
    if (this.phase === "find_start") {
      if (!start) this.since = null;
      else {
        this.since ??= t;
        if (t - this.since >= config.startMs) {
          this.phase = "reach_target";
          this.startedAt = t;
          this.since = null;
          this.startHipY = sample.hipY ?? null;
          this.startBodyHeight = sample.bodyHeight ?? null;
          this.minimum = this.maximum = sample.angle;
        }
      }
    } else {
      this.minimum = Math.min(this.minimum, sample.angle);
      this.maximum = Math.max(this.maximum, sample.angle);
      if (this.phase === "reach_target") {
        if (!target) this.since = null;
        else {
          this.since ??= t;
          if (t - this.since >= config.holdMs) {
            this.phase = "return_start";
            this.since = null;
          }
        }
      } else if (this.phase === "return_start") {
        if (!returned) this.since = null;
        else {
          this.since ??= t;
          if (t - this.since >= config.returnMs) {
            this.reps++;
            this.completedRanges.push(this.maximum - this.minimum);
            this.resetIncomplete();
            this.last = t;
            return this.result(true, "Complete repetition observed");
          }
        }
      }
    }
    return this.result(false, "Movement in progress");
  }
  result(counted, reason) {
    return { reps: this.reps, phase: this.phase, counted, reason };
  }
}

/** Clinician configuration is consumed only when its origin and limits are explicit. */
export function resolvePlan(plan, exerciseId, side) {
  if (!plan) return null;
  const value = plan.value ?? plan;
  const origin = plan.source ?? value.source;
  const exercise = Array.isArray(value.exercises)
    ? value.exercises.find(
        (item) =>
          item?.exerciseId === exerciseId && (!item.side || item.side === side),
      )
    : null;
  const selected = exercise ?? (value.exerciseId === exerciseId ? value : null);
  if (
    !selected ||
    origin !== "clinician" ||
    typeof value.clinicianName !== "string" ||
    !value.clinicianName.trim() ||
    !Number.isFinite(Date.parse(value.approvedAt))
  )
    return null;
  return {
    ...selected,
    planId: plan.id ?? value.id ?? null,
    clinicianName: value.clinicianName,
    approvedAt: value.approvedAt,
  };
}

export class MoveSession {
  constructor({
    exerciseId,
    side = "left",
    repsPerSet = 5,
    config = {},
    plan = null,
    now = () => new Date().toISOString(),
  }) {
    if (!INDEX[side]) throw new Error("Choose a side.");
    if (!Number.isInteger(repsPerSet) || repsPerSet < 1 || repsPerSet > 100)
      throw new Error("Choose 1–100 repetitions per set.");
    this.exerciseId = exerciseId;
    this.side = side;
    this.repsPerSet = repsPerSet;
    this.counter = new RepCounter(movementConfig(exerciseId, config));
    this.filter = new OneEuroFilter();
    this.plan = plan;
    this.startedAt = now();
    this.durationMs = 0;
    this.lastFrame = null;
    this.last = null;
    this.observedMs = 0;
    this.validFrames = 0;
    this.invalidFrames = 0;
    this.confidenceSum = 0;
    this.minimum = Infinity;
    this.maximum = -Infinity;
  }
  pause({ resetClock = true } = {}) {
    this.last = null;
    if (resetClock) this.lastFrame = null;
    this.counter.resetIncomplete();
    this.filter.reset();
  }
  update(frame) {
    if (Number.isFinite(frame?.timestamp)) {
      if (
        this.lastFrame !== null &&
        frame.timestamp > this.lastFrame &&
        frame.timestamp - this.lastFrame <= 400
      )
        this.durationMs += frame.timestamp - this.lastFrame;
      this.lastFrame = frame.timestamp;
    }
    const sample = analyzePose(frame, this.exerciseId, this.side);
    if (!sample.valid) {
      this.invalidFrames++;
      this.pause({ resetClock: false });
      return {
        ...this.counter.result(false, sample.reason),
        valid: false,
        angle: null,
        confidence: 0,
      };
    }
    const t = sample.timestamp;
    if (this.last !== null && t > this.last && t - this.last <= 400)
      this.observedMs += t - this.last;
    this.last = t;
    this.validFrames++;
    this.confidenceSum += sample.confidence;
    const angle = this.filter.update(sample.angle, t, sample.confidence);
    this.minimum = Math.min(this.minimum, angle);
    this.maximum = Math.max(this.maximum, angle);
    const result = this.counter.update({ ...sample, angle });
    return {
      ...result,
      valid: true,
      angle,
      rawAngle: sample.angle,
      confidence: sample.confidence,
      sets: Math.floor(result.reps / this.repsPerSet),
      repsInSet: result.reps % this.repsPerSet,
      observedMs: this.observedMs,
    };
  }
  record() {
    return {
      module: "move",
      value: {
        exerciseId: this.exerciseId,
        side: this.side,
        reps: this.counter.reps,
        sets: Math.floor(this.counter.reps / this.repsPerSet),
        repsPerSet: this.repsPerSet,
        romDegrees: this.validFrames
          ? Math.round((this.maximum - this.minimum) * 10) / 10
          : null,
        completedRepRanges: this.counter.completedRanges.map(
          (range) => Math.round(range * 10) / 10,
        ),
        observedMs: Math.round(this.observedMs),
        durationMs: Math.round(this.durationMs),
        validFrames: this.validFrames,
        invalidFrames: this.invalidFrames,
        angleMethod: "aspect-correct camera-plane geometry",
        startedAt: this.startedAt,
        planId: this.plan?.planId ?? null,
        limits: { ...this.counter.config },
      },
      units: "session",
      source: "camera_estimate",
      confidence: this.validFrames ? this.confidenceSum / this.validFrames : 0,
      model_id: MOVE_MODEL.id,
      model_version: MOVE_MODEL.version,
      correction_status: "unconfirmed",
      consent_scope: "move",
    };
  }
}
