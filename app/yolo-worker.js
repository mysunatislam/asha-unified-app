import * as ort from "./ort.wasm.min.mjs";
import { decodePose, yoloPosture } from "./yolo-codec.js";
let session,
  busy = false;
self.onmessage = async ({ data: d }) => {
  try {
    if (d.type === "init") {
      ort.env.wasm.numThreads = 1;
      ort.env.wasm.wasmPaths =
        "https://cdn.jsdelivr.net/npm/onnxruntime-web@1.22.0/dist/";
      session = await ort.InferenceSession.create(
        new URL("../models/yolo26n-pose.onnx", import.meta.url).href,
        { executionProviders: ["wasm"], graphOptimizationLevel: "all" },
      );
      self.postMessage({ type: "ready", inputs: session.inputNames });
    }
    if (d.type === "frame") {
      if (busy || !session) {
        d.bitmap.close();
        return;
      }
      busy = true;
      const t = performance.now(),
        canvas = new OffscreenCanvas(640, 640),
        c = canvas.getContext("2d", { willReadFrequently: true });
      c.drawImage(d.bitmap, 0, 0, 640, 640);
      d.bitmap.close();
      const pixels = c.getImageData(0, 0, 640, 640).data,
        n = 640 * 640,
        input = new Float32Array(3 * n);
      for (let i = 0; i < n; i++) {
        input[i] = pixels[i * 4] / 255;
        input[n + i] = pixels[i * 4 + 1] / 255;
        input[2 * n + i] = pixels[i * 4 + 2] / 255;
      }
      const out = await session.run({
        [session.inputNames[0]]: new ort.Tensor(
          "float32",
          input,
          [1, 3, 640, 640],
        ),
      });
      const tensor = out[session.outputNames[0]],
        best = decodePose(tensor.data, tensor.dims);
      self.postMessage({
        type: "result",
        person: best,
        posture: yoloPosture(best),
        ms: Math.round(performance.now() - t),
        at: Date.now(),
      });
      busy = false;
    }
  } catch (e) {
    busy = false;
    self.postMessage({ type: "error", message: e.message });
  }
};
