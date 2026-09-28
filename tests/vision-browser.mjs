import { createRequire } from "node:module";
import fs from "node:fs/promises";
const require = createRequire(import.meta.url);
const {
  chromium,
} = require("C:/Users/user/.cache/codex-runtimes/codex-primary-runtime/dependencies/node/node_modules/playwright");
const browser = await chromium.launch({
  headless: true,
  executablePath: "C:/Program Files/Google/Chrome/Application/chrome.exe",
  args: ["--no-sandbox"],
});
const page = await browser.newPage({ viewport: { width: 1380, height: 980 } });
page.on("console", (m) => {
  if (m.type() === "error")
    console.log("browser error", m.text().slice(0, 200));
});
await page.goto("http://127.0.0.1:4180/");
const result = await page.evaluate(async () => {
  const { Perception } = await import("/app/perception.js");
  const img = new Image();
  img.src = "/artifacts/pose-test.jpg";
  await img.decode();
  const src = Object.assign(document.createElement("canvas"), {
      width: 640,
      height: 480,
    }),
    ctx = src.getContext("2d");
  const draw = () => ctx.drawImage(img, 0, 0, 640, 480);
  draw();
  const timer = setInterval(draw, 40),
    stream = src.captureStream(25);
  Object.defineProperty(navigator.mediaDevices, "getUserMedia", {
    value: async () => stream,
  });
  const video = document.createElement("video");
  video.muted = true;
  video.playsInline = true;
  document.body.append(video);
  const canvas = document.createElement("canvas");
  document.body.append(canvas);
  const p = new Perception(video, canvas);
  let frame;
  await p.start();
  await new Promise((resolve, reject) => {
    const id = setTimeout(() => reject(Error("No camera result")), 20000);
    p.addEventListener("frame", (e) => {
      frame = e.detail;
      if (frame.posture?.valid) {
        clearTimeout(id);
        resolve();
      }
    });
  });
  await p.enableYolo();
  await new Promise((resolve, reject) => {
    const started = performance.now();
    const timer = setInterval(() => {
      if (p.yoloResult) {
        clearInterval(timer);
        resolve();
      } else if (performance.now() - started > 20000) {
        clearInterval(timer);
        reject(Error("No YOLO result"));
      }
    }, 200);
  });
  const result = {
    worker: !!p.worker,
    face: frame.raw.facePresent,
    faceAccepted: frame.face.accepted,
    faceReason: frame.face.reason,
    landmarkCount: p.faceResult.faceLandmarks?.[0]?.length || 0,
    hands: frame.hands,
    posture: frame.posture,
    yolo: p.yoloResult,
    latency: frame.latency,
  };
  p.stop();
  clearInterval(timer);
  return result;
});
console.log(JSON.stringify(result, null, 2));
await fs.writeFile(
  "artifacts/vision-results.json",
  JSON.stringify(result, null, 2),
);
await browser.close();
if (!result.posture.valid || !result.yolo.person) process.exitCode = 1;
