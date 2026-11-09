// Personalized screen mapping. Coordinates and validation errors are fractions of
// the viewport, rather than degrees of visual angle or medical measurements.
export const GAZE_MODEL_VERSION = "asha-gaze-ridge-v1";
const FEATURE_COUNT = 7;
const distance = (a, b) => Math.hypot(a.x - b.x, a.y - b.y);
const average = (values) =>
  values.reduce((sum, value) => sum + value, 0) / values.length;

export function calibrationTargets(count = 9) {
  if (count === 5)
    return [
      [0.12, 0.12],
      [0.88, 0.12],
      [0.5, 0.5],
      [0.12, 0.88],
      [0.88, 0.88],
    ];
  if (count !== 9 && count !== 16)
    throw new Error("Choose 5, 9 or 16 calibration points.");
  const positions =
    count === 9 ? [0.12, 0.5, 0.88] : [0.12, 0.373, 0.627, 0.88];
  return positions.flatMap((y, row) =>
    (row % 2 ? [...positions].reverse() : positions).map((x) => [x, y]),
  );
}

export const CHECK_TARGETS = [
  [0.33, 0.28],
  [0.69, 0.56],
  [0.38, 0.73],
];

/** Iris positions within each rotated eye, plus head offsets and roll. */
export function extractGazeFeatures(landmarks, width = 640, height = 480) {
  const invalid = (reason) => ({ valid: false, reason });
  if (!Array.isArray(landmarks) || landmarks.length < 478)
    return invalid(
      "Iris landmarks are unavailable. Touch and switch input are available.",
    );
  if (!(width > 0 && height > 0))
    return invalid("Camera dimensions are unavailable.");
  const indices = [33, 133, 362, 263, 159, 145, 386, 374, 468, 473, 1];
  const points = {};
  for (const index of indices) {
    const point = landmarks[index];
    if (
      !point ||
      !Number.isFinite(point.x) ||
      !Number.isFinite(point.y) ||
      point.x < 0.01 ||
      point.x > 0.99 ||
      point.y < 0.01 ||
      point.y > 0.99
    )
      return invalid("Keep your whole face in view.");
    points[index] = { x: point.x * width, y: point.y * height };
  }
  function eye(first, last, iris, upper, lower) {
    const a = points[first],
      b = points[last];
    const size = distance(a, b);
    if (size < width * 0.018) return null;
    const u = { x: (b.x - a.x) / size, y: (b.y - a.y) / size };
    const middle = { x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 };
    const dx = points[iris].x - middle.x,
      dy = points[iris].y - middle.y;
    return {
      middle,
      x: (dx * u.x + dy * u.y) / size,
      y: (-dx * u.y + dy * u.x) / size,
      openness: distance(points[upper], points[lower]) / size,
    };
  }
  const right = eye(33, 133, 468, 159, 145);
  const left = eye(362, 263, 473, 386, 374);
  if (!right || !left) return invalid("Move a little closer to the camera.");
  if (Math.min(right.openness, left.openness) < 0.07)
    return invalid("Gaze selection pauses while either eye is closed.");
  if (
    [right, left].some(
      (value) => Math.abs(value.x) > 0.65 || Math.abs(value.y) > 0.5,
    )
  )
    return invalid(
      "Eye tracking is unstable. Face the screen in steady light.",
    );
  const eyeDistance = distance(right.middle, left.middle);
  if (eyeDistance < width * 0.07 || eyeDistance > width * 0.6)
    return invalid(
      "Adjust the camera distance so both eyes are clearly visible.",
    );
  const roll = Math.atan2(
    left.middle.y - right.middle.y,
    left.middle.x - right.middle.x,
  );
  if (Math.abs(roll) > 0.6)
    return invalid("Return to a comfortable upright head position.");
  const middle = {
    x: (right.middle.x + left.middle.x) / 2,
    y: (right.middle.y + left.middle.y) / 2,
  };
  const nx = (points[1].x - middle.x) / eyeDistance;
  const ny = (points[1].y - middle.y) / eyeDistance;
  return {
    valid: true,
    values: [right.x, right.y, left.x, left.y, nx, ny, roll],
    openness: Math.min(right.openness, left.openness),
  };
}

function checkedSamples(samples) {
  if (!Array.isArray(samples))
    throw new Error("Calibration samples are missing.");
  for (const sample of samples) {
    if (
      !Array.isArray(sample.features) ||
      sample.features.length !== FEATURE_COUNT ||
      sample.features.some(
        (value) => !Number.isFinite(value) || Math.abs(value) > 20,
      ) ||
      !Number.isFinite(sample.x) ||
      !Number.isFinite(sample.y) ||
      sample.x < 0 ||
      sample.x > 1 ||
      sample.y < 0 ||
      sample.y > 1
    )
      throw new Error("Calibration contains an invalid observation.");
  }
  return samples;
}

function solve(matrix, rhs) {
  const rows = matrix.map((row, index) => [...row, rhs[index]]);
  const size = rhs.length;
  for (let column = 0; column < size; column++) {
    let pivot = column;
    for (let row = column + 1; row < size; row++) {
      if (Math.abs(rows[row][column]) > Math.abs(rows[pivot][column]))
        pivot = row;
    }
    if (Math.abs(rows[pivot][column]) < 1e-10)
      throw new Error("Calibration could not be fitted. Capture it again.");
    [rows[column], rows[pivot]] = [rows[pivot], rows[column]];
    const divisor = rows[column][column];
    for (let k = column; k <= size; k++) rows[column][k] /= divisor;
    for (let row = 0; row < size; row++) {
      if (row === column) continue;
      const factor = rows[row][column];
      for (let k = column; k <= size; k++)
        rows[row][k] -= factor * rows[column][k];
    }
  }
  return rows.map((row) => row[size]);
}

function fittedPoint(model, features) {
  const vector = [
    1,
    ...features.map(
      (value, index) => (value - model.mean[index]) / model.scale[index],
    ),
  ];
  const dot = (weights) =>
    weights.reduce((sum, value, index) => sum + value * vector[index], 0);
  return { x: dot(model.weights.x), y: dot(model.weights.y) };
}

export function fitGazeModel(observations, { ridge = 0.05 } = {}) {
  const samples = checkedSamples(observations);
  const targets = new Set(samples.map((sample) => `${sample.x},${sample.y}`));
  if (samples.length < 30 || targets.size < 5)
    throw new Error(
      "Capture at least five targets with six usable frames each.",
    );
  if (
    Math.max(...samples.map((sample) => sample.x)) -
      Math.min(...samples.map((sample) => sample.x)) <
      0.5 ||
    Math.max(...samples.map((sample) => sample.y)) -
      Math.min(...samples.map((sample) => sample.y)) <
      0.5
  )
    throw new Error("Calibration must cover the screen.");
  const mean = Array.from({ length: FEATURE_COUNT }, (_, index) =>
    average(samples.map((sample) => sample.features[index])),
  );
  const variance = mean.map((value, index) =>
    average(samples.map((sample) => (sample.features[index] - value) ** 2)),
  );
  if (
    Math.max(variance[0], variance[2]) < 1e-5 ||
    Math.max(variance[1], variance[3]) < 1e-5
  )
    throw new Error(
      "Eye movement did not vary enough. Look at each target before capture.",
    );
  const scale = variance.map((value) => Math.max(0.001, Math.sqrt(value)));
  const vectors = samples.map((sample) => [
    1,
    ...sample.features.map(
      (value, index) => (value - mean[index]) / scale[index],
    ),
  ]);
  const size = FEATURE_COUNT + 1;
  const normal = Array.from({ length: size }, () => Array(size).fill(0));
  const rhsX = Array(size).fill(0),
    rhsY = Array(size).fill(0);
  vectors.forEach((vector, index) => {
    for (let row = 0; row < size; row++) {
      rhsX[row] += vector[row] * samples[index].x;
      rhsY[row] += vector[row] * samples[index].y;
      for (let column = 0; column < size; column++)
        normal[row][column] += vector[row] * vector[column];
    }
  });
  for (let index = 0; index < size; index++)
    normal[index][index] += index === 0 ? 1e-8 : ridge;
  const model = {
    version: GAZE_MODEL_VERSION,
    mean,
    scale,
    domain: mean.map((_, index) => ({
      min: Math.min(...samples.map((sample) => sample.features[index])),
      max: Math.max(...samples.map((sample) => sample.features[index])),
    })),
    weights: { x: solve(normal, rhsX), y: solve(normal, rhsY) },
    samples: samples.length,
    targets: targets.size,
    createdAt: new Date().toISOString(),
    validation: null,
  };
  const squared = samples.map((sample) => {
    const point = fittedPoint(model, sample.features);
    return (point.x - sample.x) ** 2 + (point.y - sample.y) ** 2;
  });
  model.fitError = Math.sqrt(average(squared));
  return model;
}

export function predictGaze(
  model,
  features,
  { requireValidation = true } = {},
) {
  const modelShapeValid =
    model?.version === GAZE_MODEL_VERSION &&
    [model.mean, model.scale].every(
      (row) =>
        Array.isArray(row) &&
        row.length === FEATURE_COUNT &&
        row.every(Number.isFinite),
    ) &&
    model.scale.every((value) => value > 0) &&
    Array.isArray(model.domain) &&
    model.domain.length === FEATURE_COUNT &&
    model.domain.every(
      (domain) => Number.isFinite(domain?.min) && Number.isFinite(domain?.max),
    ) &&
    [model.weights?.x, model.weights?.y].every(
      (row) =>
        Array.isArray(row) &&
        row.length === FEATURE_COUNT + 1 &&
        row.every(Number.isFinite),
    );
  if (
    !modelShapeValid ||
    !Array.isArray(features) ||
    features.length !== FEATURE_COUNT ||
    features.some((value) => !Number.isFinite(value))
  )
    return { valid: false, reason: "Calibrate gaze first." };
  if (requireValidation && !model.validation?.passed)
    return {
      valid: false,
      reason: "Complete the target check before enabling gaze selection.",
    };
  for (let index = 0; index < FEATURE_COUNT; index++) {
    const domain = model.domain[index];
    const margin = Math.max(
      index < 4 ? 0.09 : 0.12,
      (domain.max - domain.min) * 0.35,
    );
    if (
      features[index] < domain.min - margin ||
      features[index] > domain.max + margin
    )
      return {
        valid: false,
        reason:
          "Your head or eyes moved outside calibration. Recalibrate if needed.",
      };
  }
  const point = fittedPoint(model, features);
  if (
    !Number.isFinite(point.x) ||
    !Number.isFinite(point.y) ||
    point.x < 0 ||
    point.x > 1 ||
    point.y < 0 ||
    point.y > 1
  )
    return { valid: false, reason: "Look toward the center of a large tile." };
  return { valid: true, ...point, error: model.validation?.p90Error ?? null };
}

export function validateGazeModel(model, observations) {
  const samples = checkedSamples(observations);
  const groups = new Map();
  for (const sample of samples) {
    const key = `${sample.x},${sample.y}`;
    if (!groups.has(key)) groups.set(key, []);
    groups.get(key).push(sample);
  }
  if (groups.size < 3 || [...groups.values()].some((group) => group.length < 6))
    throw new Error(
      "The target check needs three targets with six usable observations each.",
    );
  const errors = samples
    .map((sample) => {
      const point = predictGaze(model, sample.features, {
        requireValidation: false,
      });
      return point.valid
        ? Math.hypot(point.x - sample.x, point.y - sample.y)
        : 1;
    })
    .sort((a, b) => a - b);
  const meanError = average(errors),
    p90Error = errors[Math.ceil(errors.length * 0.9) - 1];
  return {
    passed: meanError <= 0.06 && p90Error <= 0.09,
    meanError,
    p90Error,
    targets: groups.size,
    samples: samples.length,
    checkedAt: new Date().toISOString(),
  };
}

/** A target must remain visible continuously. Repeated selection needs release. */
export class DwellSelector {
  constructor({ dwellMs = 1100, releaseMs = 400, maxGapMs = 350 } = {}) {
    this.dwellMs = Number.isFinite(dwellMs)
      ? Math.max(800, Math.min(1500, dwellMs))
      : 1100;
    this.releaseMs = Number.isFinite(releaseMs)
      ? Math.max(200, Math.min(1000, releaseMs))
      : 400;
    this.maxGapMs = Number.isFinite(maxGapMs)
      ? Math.max(100, Math.min(1000, maxGapMs))
      : 350;
    this.reset();
  }
  reset() {
    this.target = null;
    this.startedAt = null;
    this.lastTime = null;
    this.locked = null;
    this.releaseAt = null;
    this.progress = 0;
  }
  update(target, timestamp, valid = true) {
    if (!Number.isFinite(timestamp)) return null;
    const gap = this.lastTime === null ? 0 : timestamp - this.lastTime;
    this.lastTime = timestamp;
    if (!valid || gap < 0 || gap > this.maxGapMs) {
      this.target = null;
      this.startedAt = null;
      this.releaseAt = null;
      this.progress = 0;
      return null;
    }
    if (this.locked !== null) {
      if (target === this.locked) {
        this.releaseAt = null;
        this.progress = 0;
        return null;
      }
      this.releaseAt ??= timestamp;
      if (timestamp - this.releaseAt < this.releaseMs) return null;
      this.locked = null;
      this.releaseAt = null;
    }
    if (!target) {
      this.target = null;
      this.startedAt = null;
      this.progress = 0;
      return null;
    }
    if (target !== this.target) {
      this.target = target;
      this.startedAt = timestamp;
    }
    this.progress = Math.min(1, (timestamp - this.startedAt) / this.dwellMs);
    if (this.progress < 1) return null;
    this.locked = target;
    this.target = null;
    this.startedAt = null;
    this.progress = 0;
    return target;
  }
}
