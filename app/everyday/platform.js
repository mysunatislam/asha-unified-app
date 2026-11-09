import { MODEL_REGISTRY, verifyModel } from "./model-registry.js";

export function deviceCapabilities() {
  return {
    secure: !!globalThis.isSecureContext,
    camera: !!globalThis.navigator?.mediaDevices?.getUserMedia,
    webgpu: !!globalThis.navigator?.gpu,
    wasm: typeof WebAssembly !== "undefined",
    crypto: !!globalThis.crypto?.subtle,
    storage: !!globalThis.indexedDB,
    memoryGB: globalThis.navigator?.deviceMemory || null,
    cores: globalThis.navigator?.hardwareConcurrency || null,
    speech: "speechSynthesis" in globalThis,
    asr: !!(globalThis.SpeechRecognition || globalThis.webkitSpeechRecognition),
  };
}

export class TelemetryService {
  constructor() {
    this.enabled = false;
    this.timings = [];
  }
  record(task, ms) {
    if (this.enabled && Number.isFinite(ms)) {
      this.timings.push({ task, ms });
      this.timings = this.timings.slice(-500);
    }
  }
  report() {
    const tasks = [...new Set(this.timings.map((x) => x.task))];
    return tasks.map((task) => {
      const values = this.timings
        .filter((x) => x.task === task)
        .map((x) => x.ms)
        .sort((a, b) => a - b);
      return {
        task,
        samples: values.length,
        p50: values[Math.floor((values.length - 1) * 0.5)],
        p95: values[Math.floor((values.length - 1) * 0.95)],
      };
    });
  }
}

export class ModelManager {
  constructor({
    delegates = ["GPU", "CPU"],
    fetcher = (...args) => fetch(...args),
    runtime = () => import("../../neuroface/vendor/vision_bundle.mjs"),
  } = {}) {
    this.model = null;
    this.task = null;
    this.sequence = 0;
    this.delegates = delegates;
    this.fetcher = fetcher;
    this.runtime = runtime;
  }
  async load(task) {
    if (!MODEL_REGISTRY[task]) throw Error("This task has no approved model.");
    const sequence = ++this.sequence;
    this.model?.close();
    this.model = null;
    this.task = null;
    const item = MODEL_REGISTRY[task];
    const response = await this.fetcher(item.url);
    if (!response.ok)
      throw Error("Download the vision model while connected to the internet.");
    const bytes = await response.arrayBuffer();
    await verifyModel(bytes, item);
    const runtime = await this.runtime();
    const files = await runtime.FilesetResolver.forVisionTasks(
      "/neuroface/vendor/wasm",
    );
    let model, delegate;
    for (const candidate of this.delegates) {
      try {
        model = await runtime[item.className].createFromOptions(files, {
          baseOptions: {
            modelAssetBuffer: new Uint8Array(bytes),
            delegate: candidate,
          },
          runningMode: "VIDEO",
          ...(task === "pose"
            ? { numPoses: 1 }
            : {
                numFaces: 1,
                outputFaceBlendshapes: true,
                outputFacialTransformationMatrixes: true,
              }),
        });
        delegate = candidate;
        break;
      } catch (error) {
        if (candidate === this.delegates.at(-1)) throw error;
      }
    }
    if (!model) throw Error("No supported vision delegate is available.");
    if (sequence !== this.sequence) {
      model.close();
      throw Error("Model start was cancelled.");
    }
    this.model = model;
    this.task = task;
    return { model, delegate, item };
  }
  unload() {
    this.sequence++;
    this.model?.close();
    this.model = null;
    this.task = null;
  }
}

export class CameraManager extends EventTarget {
  constructor(
    video,
    canvas,
    telemetry = new TelemetryService(),
    { models = new ModelManager() } = {},
  ) {
    super();
    this.video = video;
    this.canvas = canvas;
    this.telemetry = telemetry;
    this.models = models;
    this.generation = 0;
    this.stream = null;
    this.frame = null;
    this.onHidden = () => {
      if (document.hidden) this.stop();
    };
    document.addEventListener("visibilitychange", this.onHidden);
    this.onUnload = () => this.stop();
    window.addEventListener("pagehide", this.onUnload);
  }
  async start(task, callback) {
    this.stop();
    const generation = ++this.generation;
    if (!navigator.mediaDevices?.getUserMedia)
      throw Error(
        "Camera needs HTTPS and a supported browser. Touch controls remain available.",
      );
    const stream = await navigator.mediaDevices.getUserMedia({
      video: {
        facingMode: "user",
        width: { ideal: 640 },
        height: { ideal: 480 },
        frameRate: { ideal: 24, max: 30 },
      },
      audio: false,
    });
    if (generation !== this.generation || document.hidden) {
      stream.getTracks().forEach((t) => t.stop());
      throw Error("Camera start was cancelled.");
    }
    this.stream = stream;
    this.video.srcObject = stream;
    try {
      await this.video.play();
      const modelStart = performance.now();
      const { model, delegate } = await this.models.load(task);
      this.telemetry.record(task + ":load", performance.now() - modelStart);
      if (generation !== this.generation || document.hidden)
        throw Error("Camera start was cancelled.");
      let last = -Infinity,
        previousVideoTime = -1,
        interval = 100;
      const loop = (t) => {
        if (generation !== this.generation) return;
        if (
          t - last >= interval &&
          this.video.readyState >= 2 &&
          this.video.currentTime !== previousVideoTime
        ) {
          last = t;
          previousVideoTime = this.video.currentTime;
          try {
            const begin = performance.now();
            const result = model.detectForVideo(this.video, t);
            const inferenceMs = performance.now() - begin;
            this.telemetry.record(task + ":inference", inferenceMs);
            interval =
              0.7 * interval +
              0.3 * Math.max(100, Math.min(500, inferenceMs * 2));
            const landmarks =
              task === "face"
                ? result.faceLandmarks?.[0]
                : result.landmarks?.[0];
            const frame = {
              landmarks: landmarks || [],
              worldLandmarks: result.worldLandmarks?.[0],
              timestamp: t,
              width: this.video.videoWidth,
              height: this.video.videoHeight,
              blendshapes: result.faceBlendshapes?.[0]?.categories,
              matrix: result.facialTransformationMatrixes?.[0],
            };
            this.draw(frame);
            callback(frame);
          } catch (error) {
            this.stop();
            this.dispatchEvent(
              new CustomEvent("error", { detail: error.message }),
            );
            return;
          }
        }
        this.frame = requestAnimationFrame(loop);
      };
      this.frame = requestAnimationFrame(loop);
      this.dispatchEvent(
        new CustomEvent("status", {
          detail: `Camera active · ${task} · ${delegate}`,
        }),
      );
      return { running: true, delegate };
    } catch (error) {
      if (generation === this.generation) this.stop();
      else stream.getTracks().forEach((t) => t.stop());
      throw error;
    }
  }
  draw(frame) {
    const c = this.canvas;
    if (c.width !== frame.width) c.width = frame.width;
    if (c.height !== frame.height) c.height = frame.height;
    const ctx = c.getContext("2d");
    ctx.clearRect(0, 0, c.width, c.height);
    ctx.fillStyle = "#35e6c2";
    for (const point of frame.landmarks) {
      if (
        (point.visibility ?? 1) < 0.6 ||
        !Number.isFinite(point.x) ||
        !Number.isFinite(point.y)
      )
        continue;
      ctx.beginPath();
      ctx.arc(point.x * c.width, point.y * c.height, 2, 0, Math.PI * 2);
      ctx.fill();
    }
  }
  stop() {
    this.generation++;
    if (this.frame !== null) cancelAnimationFrame(this.frame);
    this.frame = null;
    this.stream?.getTracks().forEach((t) => t.stop());
    this.stream = null;
    this.video.srcObject = null;
    this.models.unload();
    this.dispatchEvent(new CustomEvent("status", { detail: "Camera paused" }));
  }
  dispose() {
    this.stop();
    document.removeEventListener("visibilitychange", this.onHidden);
    window.removeEventListener("pagehide", this.onUnload);
  }
}

export function qualityGate(frame, required = []) {
  return required.every((i) => {
    const p = frame?.landmarks?.[i];
    return (
      p &&
      Number.isFinite(p.x) &&
      Number.isFinite(p.y) &&
      p.x > 0 &&
      p.x < 1 &&
      p.y > 0 &&
      p.y < 1 &&
      (p.visibility ?? 1) >= 0.65
    );
  });
}
export function confidenceGate(value, minimum = 0.65) {
  return Number.isFinite(value) && value >= minimum;
}
export class InferenceRouter {
  constructor(camera) {
    this.camera = camera;
  }
  async activate(task, callback) {
    return this.camera.start(task, callback);
  }
  deactivate() {
    this.camera.stop();
  }
}
