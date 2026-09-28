// Deterministic signal-replay UI regression, not a patient/camera accuracy test.
import { createRequire } from "node:module";
import assert from "node:assert/strict";
const require = createRequire(import.meta.url);
const {
  chromium,
} = require("C:/Users/user/.cache/codex-runtimes/codex-primary-runtime/dependencies/node/node_modules/playwright");
const browser = await chromium.launch({
  headless: true,
  executablePath: "C:/Program Files/Google/Chrome/Application/chrome.exe",
});
const base = process.env.ASHA_TEST_BASE || "http://127.0.0.1:4180/";
const page = await browser.newPage({ viewport: { width: 390, height: 844 } });
const errors = [];
page.on("pageerror", (error) => errors.push(error.message));
try {
  await page.goto(base);
  const result = await page.evaluate(async () => {
    const { BlinkCounter } = await import("./app/blink-counter.js");
    const { faceStudio, paintFaceStudio } = await import(
      "./app/face-studio.js"
    );
    document.getElementById("moduleContent").innerHTML = faceStudio();
    for (const view of document.querySelectorAll(".view"))
      view.hidden = view.id !== "details";
    const counter = new BlinkCounter();
    let t = 0,
      eye,
      raw;
    const hold = (ms, left = 0.49, right = 0.51) => {
      for (let i = 0; i < ms; i += 40) {
        raw = {
          facePresent: true,
          faceQuality: 1,
          earLeft: left,
          earRight: right,
          earMean: (left + right) / 2,
          eyeBlinkLeft: 0,
          eyeBlinkRight: 0,
          fps: 25,
          poseSpeed: 0,
        };
        eye = counter.update(raw, t);
        t += 40;
      }
    };
    hold(600);
    for (let i = 0; i < 8; i++) {
      hold(160, 0.36, 0.38);
      hold(360);
    }
    paintFaceStudio(
      {
        raw,
        blinks: eye.total,
        latency: 40,
        blendshapes: { browInnerUp: 0.99, browDownLeft: 0.9, browDownRight: 0.9 },
        analysis: { valid: true, eye, au: {}, lip: {}, head: {}, log: [] },
      },
      null,
      { blink: 0, left: 0, right: 0 },
    );
    return {
      total: eye.total,
      state: eye.state,
      shown: document.getElementById("nf-blinkRate").textContent,
      debug: document.getElementById("nf-eyeDebug").textContent,
      duration: document.getElementById("nf-blinkDuration").textContent,
      requestDialogOpen: document.getElementById("confirmDialog").open,
      uncalibratedBrow: document.getElementById("nf-value-AU1").textContent,
    };
  });
  assert.equal(result.total, 8);
  assert.equal(result.state, "OPEN");
  assert.equal(result.shown, "8 / 60s");
  assert.ok(result.debug.startsWith("8 observed blinks total"));
  assert.equal(result.duration, "0.16s");
  assert.equal(result.requestDialogOpen, false);
  assert.equal(result.uncalibratedBrow, "—", "raw model scores must not masquerade as neutral-relative activity");
  assert.deepEqual(errors, []);
  console.log(JSON.stringify({ base, replayUI: true, ...result, errors }));
} finally {
  await browser.close();
}
