import fs from "node:fs/promises";
import path from "node:path";
import { gzipSync } from "node:zlib";
import { createRequire } from "node:module";
import { MODEL_REGISTRY, verifyModel } from "../app/everyday/model-registry.js";
const base = new URL("..", import.meta.url);
const files = [
  "everyday.html",
  "app/speech-capture.js",
  "assets/assets/images/asha-avatar.png",
  "assets/brand/asha-favicon-48.png",
  ...(await fs.readdir(new URL("../app/everyday", import.meta.url)))
    .filter((n) => /\.(js|css)$/.test(n))
    .map((n) => "app/everyday/" + n),
];
const assets = [];
for (const file of files) {
  const bytes = await fs.readFile(new URL(file, base));
  assets.push({
    file,
    bytes: bytes.byteLength,
    gzipBytes: gzipSync(bytes).byteLength,
  });
}
const models = [];
for (const [task, entry] of Object.entries(MODEL_REGISTRY)) {
  const bytes = await fs.readFile(new URL(entry.url.slice(1), base));
  await verifyModel(bytes, entry);
  models.push({
    task,
    ...entry,
    integrityVerified: true,
    gzipBytes: gzipSync(bytes).byteLength,
  });
}
const wasm = [];
for (const file of [
  "neuroface/vendor/vision_bundle.mjs",
  "neuroface/vendor/wasm/vision_wasm_internal.js",
  "neuroface/vendor/wasm/vision_wasm_internal.wasm",
  "neuroface/vendor/wasm/vision_wasm_nosimd_internal.js",
  "neuroface/vendor/wasm/vision_wasm_nosimd_internal.wasm",
]) {
  const bytes = await fs.readFile(new URL(file, base));
  wasm.push({
    file,
    bytes: bytes.byteLength,
    gzipBytes: gzipSync(bytes).byteLength,
  });
}
const report = {
  at: new Date().toISOString(),
  device: "Windows desktop; not a low-end mobile result",
  assets,
  baseBytes: assets.reduce((s, r) => s + r.bytes, 0),
  baseGzipBytes: assets.reduce((s, r) => s + r.gzipBytes, 0),
  models,
  wasm,
  browser: null,
  pending: [
    "Low-end Android and iOS latency, peak process RAM, battery and thermal testing",
    "Held-out gaze, pose and food accuracy",
    "Clinical review of safety rules",
  ],
};
if (process.argv.includes("--browser")) {
  const require = createRequire(import.meta.url);
  const {
    chromium,
  } = require("C:/Users/user/.cache/codex-runtimes/codex-primary-runtime/dependencies/node/node_modules/playwright");
  const browser = await chromium.launch({
    executablePath: "C:/Program Files/Google/Chrome/Application/chrome.exe",
    headless: true,
    args: [
      "--no-sandbox",
      "--use-fake-ui-for-media-stream",
      "--use-fake-device-for-media-stream",
    ],
  });
  try {
    const p = await browser.newPage();
    await p.goto(
      (process.env.EVERYDAY_TEST_URL || "http://127.0.0.1:4180") +
        "/everyday.html",
    );
    report.browser = await p.evaluate(async () => {
      const { ModelManager } = await import("/app/everyday/platform.js");
      const stream = await navigator.mediaDevices.getUserMedia({
        video: { width: 640, height: 480 },
        audio: false,
      });
      const video = document.createElement("video");
      video.muted = true;
      video.playsInline = true;
      video.srcObject = stream;
      document.body.append(video);
      await video.play();
      const results = [];
      const percentile = (samples, p) =>
        samples.toSorted((a, b) => a - b)[Math.floor((samples.length - 1) * p)];
      try {
        for (const task of ["pose", "face"]) {
          const manager = new ModelManager({ delegates: ["CPU"] }),
            cold = performance.now();
          try {
            const { model, delegate } = await manager.load(task);
            const loadMs = performance.now() - cold;
            const samples = [];
            let last = -1;
            for (let i = 0; i < 25; i++) {
              await new Promise((r) => requestAnimationFrame(r));
              while (video.currentTime === last)
                await new Promise((r) => requestAnimationFrame(r));
              last = video.currentTime;
              const begin = performance.now();
              model.detectForVideo(video, begin);
              samples.push(performance.now() - begin);
            }
            results.push({
              task,
              delegate,
              workload:
                "Chrome synthetic camera pattern at 640x480; no human accuracy evidence",
              loadMs,
              warmSamples: samples.length - 5,
              warmP50Ms: percentile(samples.slice(5), 0.5),
              warmP95Ms: percentile(samples.slice(5), 0.95),
            });
          } finally {
            manager.unload();
          }
        }
      } finally {
        stream.getTracks().forEach((track) => track.stop());
        video.remove();
      }
      return {
        userAgent: navigator.userAgent,
        cores: navigator.hardwareConcurrency,
        memoryHintGB: navigator.deviceMemory || null,
        results,
        peakProcessRAM: "not measured",
        batteryThermal: "not measured",
      };
    });
  } finally {
    await browser.close();
  }
}
await fs.mkdir(new URL("../artifacts", import.meta.url), { recursive: true });
await fs.writeFile(
  new URL("../artifacts/everyday-benchmark.json", import.meta.url),
  JSON.stringify(report, null, 2),
);
console.log(
  JSON.stringify(
    {
      baseBytes: report.baseBytes,
      baseGzipBytes: report.baseGzipBytes,
      modelBytes: models.reduce((s, r) => s + r.bytes, 0),
      browser: report.browser,
      report: path.resolve("artifacts/everyday-benchmark.json"),
    },
    null,
    2,
  ),
);
