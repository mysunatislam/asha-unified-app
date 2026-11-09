import test from "node:test";
import assert from "node:assert/strict";
import {
  CameraManager,
  ModelManager,
  TelemetryService,
  qualityGate,
  deviceCapabilities,
} from "../app/everyday/platform.js";
import { MODEL_REGISTRY } from "../app/everyday/model-registry.js";
import fs from "node:fs/promises";

const documentTarget = new EventTarget(),
  windowTarget = new EventTarget();
documentTarget.hidden = false;
globalThis.document = documentTarget;
globalThis.window = windowTarget;
let pendingFrames = new Map(),
  nextFrame = 0;
globalThis.requestAnimationFrame = (f) => {
  pendingFrames.set(++nextFrame, f);
  return nextFrame;
};
globalThis.cancelAnimationFrame = (id) => pendingFrames.delete(id);
function fakeVideo() {
  return {
    srcObject: null,
    play: async () => {},
    readyState: 2,
    currentTime: 1,
    videoWidth: 640,
    videoHeight: 480,
  };
}
const canvas = {
  width: 0,
  height: 0,
  getContext: () => ({ clearRect() {}, beginPath() {}, arc() {}, fill() {} }),
};
function stream() {
  const track = {
    stops: 0,
    stop() {
      this.stops++;
    },
  };
  return { track, getTracks: () => [track] };
}
function setCamera(getUserMedia) {
  Object.defineProperty(globalThis.navigator, "mediaDevices", {
    configurable: true,
    value: { getUserMedia },
  });
}
function fakeModels() {
  return {
    closes: 0,
    loads: [],
    unload() {
      this.closes++;
    },
    async load(task) {
      this.loads.push(task);
      return {
        delegate: "CPU",
        model: { detectForVideo: () => ({ landmarks: [[]] }) },
      };
    },
  };
}

test("A pending camera permission result cannot resurrect a stopped session", async () => {
  let complete;
  const acquired = stream();
  setCamera(
    () =>
      new Promise((resolve) => {
        complete = resolve;
      }),
  );
  const video = fakeVideo(),
    models = fakeModels(),
    camera = new CameraManager(video, canvas, undefined, { models });
  const starting = camera.start("pose", () => {});
  camera.stop();
  complete(acquired);
  await assert.rejects(starting, /cancelled/);
  assert.equal(video.srcObject, null);
  assert.equal(acquired.track.stops, 1);
  assert.equal(models.loads.length, 0);
  camera.dispose();
});
test("Module switch, backgrounding and disposal stop all owned tracks and inference loops", async () => {
  const streams = [stream(), stream()];
  let count = 0;
  setCamera(async () => streams[count++]);
  const video = fakeVideo(),
    models = fakeModels(),
    camera = new CameraManager(video, canvas, undefined, { models });
  await camera.start("pose", () => {});
  assert.equal(pendingFrames.size, 1);
  await camera.start("face", () => {});
  assert.equal(streams[0].track.stops, 1);
  assert.equal(pendingFrames.size, 1);
  documentTarget.hidden = true;
  documentTarget.dispatchEvent(new Event("visibilitychange"));
  assert.equal(streams[1].track.stops, 1);
  assert.equal(pendingFrames.size, 0);
  assert.equal(video.srcObject, null);
  documentTarget.hidden = false;
  camera.dispose();
});
test("Late model startup and model exceptions release camera ownership", async () => {
  const acquired = stream();
  let complete;
  setCamera(async () => acquired);
  const models = fakeModels();
  models.load = () =>
    new Promise((resolve) => {
      complete = resolve;
    });
  const camera = new CameraManager(fakeVideo(), canvas, undefined, { models });
  const starting = camera.start("pose", () => {});
  await new Promise((r) => setImmediate(r));
  camera.stop();
  complete({ delegate: "CPU", model: {} });
  await assert.rejects(starting, /cancelled/);
  assert.ok(acquired.track.stops >= 1);
  assert.equal(pendingFrames.size, 0);
  camera.dispose();
  const brokenStream = stream();
  setCamera(async () => brokenStream);
  const failing = fakeModels();
  failing.load = async () => {
    throw Error("bad model");
  };
  const second = new CameraManager(fakeVideo(), canvas, undefined, {
    models: failing,
  });
  await assert.rejects(
    second.start("pose", () => {}),
    /bad model/,
  );
  assert.equal(brokenStream.track.stops, 1);
  second.dispose();
});
test("Pinned model bytes are verified before GPU failure falls back to CPU", async () => {
  const bytes = await fs.readFile(
    new URL("../models/pose_landmarker_lite.task", import.meta.url),
  );
  const attempts = [],
    model = { close() {} };
  const manager = new ModelManager({
    fetcher: async () => new Response(bytes),
    runtime: async () => ({
      FilesetResolver: { forVisionTasks: async () => ({}) },
      PoseLandmarker: {
        createFromOptions: async (_, opts) => {
          attempts.push(opts.baseOptions.delegate);
          if (opts.baseOptions.delegate === "GPU") throw Error("unsupported");
          assert.equal(
            opts.baseOptions.modelAssetBuffer.byteLength,
            MODEL_REGISTRY.pose.bytes,
          );
          return model;
        },
      },
    }),
  });
  assert.equal((await manager.load("pose")).delegate, "CPU");
  assert.deepEqual(attempts, ["GPU", "CPU"]);
  manager.unload();
  const bad = new ModelManager({
    fetcher: async () => new Response(new Uint8Array(20)),
    runtime: async () => {
      throw Error("runtime should not load");
    },
  });
  await assert.rejects(bad.load("pose"), /size mismatch/);
});
test("Quality gates reject occlusion and local telemetry is opt-in and bounded", () => {
  assert.equal(
    qualityGate({ landmarks: [{ x: 0.5, y: 0.5, visibility: 0.2 }] }, [0]),
    false,
  );
  assert.equal(
    qualityGate({ landmarks: [{ x: 0.5, y: 0.5, visibility: 0.9 }] }, [0]),
    true,
  );
  const t = new TelemetryService();
  t.record("pose", 10);
  assert.deepEqual(t.report(), []);
  t.enabled = true;
  for (let i = 0; i < 700; i++) t.record("pose", i);
  assert.equal(t.report()[0].samples, 500);
  assert.equal(t.report()[0].p95, 674);
  assert.equal(typeof deviceCapabilities().wasm, "boolean");
});
