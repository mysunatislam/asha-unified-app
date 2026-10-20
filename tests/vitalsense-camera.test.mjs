import test from "node:test";
import assert from "node:assert/strict";
import { Perception } from "../app/perception.js";
import { VitalSense } from "../app/vitalsense.js";

test("shared video samples VitalSense at 30fps with 3fps landmarks and no second camera", async (t) => {
  // Exercise the real Perception loop and ROI sampler without loading vision
  // models. A deterministic camera RGB fixture contains a known 78-bpm pulse.
  let clock = 1000, cameraRequests = 1;
  const saved = new Map(["performance", "document", "navigator", "requestAnimationFrame"].map((key) => [key, Object.getOwnPropertyDescriptor(globalThis, key)]));
  t.after(() => { for (const [key, descriptor] of saved) { if (descriptor) Object.defineProperty(globalThis, key, descriptor); else delete globalThis[key]; } });
  Object.defineProperty(globalThis, "performance", { configurable: true, value: { now: () => clock } });
  Object.defineProperty(globalThis, "requestAnimationFrame", { configurable: true, value: () => 1 });
  Object.defineProperty(globalThis, "navigator", { configurable: true, value: { mediaDevices: { getUserMedia: () => { cameraRequests++; throw Error("a second camera must not open"); } } } });
  const context = {
    drawImage() {},
    getImageData() {
      const wave = Math.sin(2 * Math.PI * 78 / 60 * clock / 1000), pixels = new Float64Array(16 * 16 * 4);
      for (let i = 0; i < pixels.length; i += 4) { pixels[i] = (.56 + .0006 * wave) * 255; pixels[i + 1] = (.43 + .003 * wave) * 255; pixels[i + 2] = (.32 + .0003 * wave) * 255; pixels[i + 3] = 255; }
      return { data: pixels };
    },
  };
  Object.defineProperty(globalThis, "document", { configurable: true, value: { hidden: false, createElement: () => ({ getContext: () => context }) } });
  const perception = Object.assign(Object.create(Perception.prototype), {
    running: true, busy: true, cycles: { pulse: 0 }, vitals: new VitalSense(), snapshot: {},
    video: { readyState: 2, currentTime: 0, videoWidth: 640, videoHeight: 480 }, emit() {},
    vitalsFaceFeatures: { facePresent: true, faceQuality: 1 },
    faceResult: { faceLandmarks: [Array.from({ length: 478 }, (_, i) => ({ x: .2 + (i % 20) / 40, y: .1 + Math.floor(i / 20) / 40 }))] },
  });
  perception.pulse = perception.vitals.value;
  for (let i = 0; i < 600; i++) {
    clock = 1000 + i * 1000 / 30;
    perception.video.currentTime = clock / 1000;
    // Only update ROI localization at three inferences per second.
    if (i % 10 === 0) perception.faceResultAt = clock;
    await perception.loop();
  }
  assert.ok(perception.pulse.sampleFps >= 29, perception.pulse.sampleFps);
  assert.ok(Math.abs(perception.pulse.bpm - 78) <= 2, perception.pulse.bpm);
  assert.equal(perception.pulse.roiCount, 3);
  assert.equal(perception.pulse.rois.length, 3);
  assert.equal(cameraRequests, 1);
  const frames = perception.cycles.pulse;
  await perception.loop();
  assert.equal(perception.cycles.pulse, frames, "the same video frame must never be sampled twice");
  clock += 650;
  await perception.loop();
  assert.equal(perception.pulse.bpm, null, "a frozen camera must clear the displayed pulse");
  assert.match(perception.pulse.reason, /frames stopped/);
  assert.equal(cameraRequests, 1);
});
