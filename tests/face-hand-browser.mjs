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
const page = await browser.newPage();
await page.goto("http://127.0.0.1:4180/");
const result = await page.evaluate(async () => {
  const { Perception } = await import("/app/perception.js");
  const src = Object.assign(document.createElement("canvas"), {
      width: 640,
      height: 480,
    }),
    ctx = src.getContext("2d");
  let img = new Image();
  img.src = "/artifacts/portrait-test.jpg";
  await img.decode();
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
  await p.start();
  const waitFor = (predicate) =>
    new Promise((resolve, reject) => {
      const end = setTimeout(
        () =>
          reject(
            Error(
              "Expected perception missing: " +
                JSON.stringify({
                  face: p.snapshot.raw?.facePresent,
                  hands: p.snapshot.hands?.length,
                  reason: p.snapshot.face?.reason,
                }),
            ),
          ),
        15000,
      );
      const listen = (e) => {
        if (predicate(e.detail)) {
          clearTimeout(end);
          p.removeEventListener("frame", listen);
          resolve(e.detail);
        }
      };
      p.addEventListener("frame", listen);
    });
  const face = await waitFor((s) => s.raw.facePresent && s.raw.fps > 8);
  img = new Image();
  img.src = "/artifacts/hands-test.jpg";
  await img.decode();
  const hands = await waitFor((s) => s.hands.length === 2);
  const data = {
    worker: !!p.worker,
    face: {
      landmarks: 478,
      present: face.raw.facePresent,
      accepted: face.face.accepted,
      reason: face.face.reason,
      ear: face.raw.earMean,
      fps: face.raw.fps,
      latencyMs: face.latency,
    },
    hands: hands.hands,
    handFrameMs: hands.latency,
  };
  p.stop();
  clearInterval(timer);
  return data;
});
console.log(JSON.stringify(result, null, 2));
await fs.writeFile(
  "artifacts/face-hand-results.json",
  JSON.stringify(result, null, 2),
);
await browser.close();
if (!result.face.present || result.hands.length !== 2) process.exitCode = 1;
