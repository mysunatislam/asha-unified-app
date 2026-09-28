// App-level regression: replay measured eye cycles through the real request UI.
// No camera, patient data, real caregiver notifications or AI calls are used.
import { createRequire } from "node:module";
import assert from "node:assert/strict";
const require = createRequire(import.meta.url);
const { chromium } = require("C:/Users/user/.cache/codex-runtimes/codex-primary-runtime/dependencies/node/node_modules/playwright");
const browser = await chromium.launch({ headless: true, executablePath: "C:/Program Files/Google/Chrome/Application/chrome.exe" });
const page = await browser.newPage({ viewport: { width: 390, height: 844 } });
const base = process.env.ASHA_TEST_BASE || "http://127.0.0.1:4180/";
const errors = [], sent = [];
page.on("pageerror", (e) => errors.push(e.message));
const profile = { patientId: "blink-test", label: "Eye-only test", assessment: { eyes: "reliable", lips: "none", head: "none", canHear: true }, recommendation: { primary: "facespeak" } };
try {
  await page.route("**/api/session**", async (route) => {
    const body = route.request().postDataJSON();
    if (body?.action === "event") sent.push(body);
    await route.fulfill({ json: { profile, events: [], role: "patient", status: null } });
  });
  await page.route("**/api/health", (route) => route.fulfill({ json: { cloudConfigured: true } }));
  await page.route("**/app/main.js", async (route) => {
    const response = await route.fetch();
    await route.fulfill({ response, body: (await response.text()) + "\nwindow.__blinkTest = { perception, gate };" });
  });
  await page.addInitScript(() => {
    localStorage.setItem("asha_live_patient", JSON.stringify({ patientId: "blink-test", token: "mock-only" }));
    localStorage.setItem("asha_live_calibration_blink-test", JSON.stringify({ savedAt: new Date().toISOString(), enabled: ["RAPID_BLINK_REQUEST", "BLINK_CONFIRM"], baseline: { blinkIntent: { version: 1, rapidMin: 80, rapidMax: 320, minAmplitude: 0.1, confirmMin: 330, confirmMax: 900 } } }));
    Object.defineProperty(window, "speechSynthesis", { value: {
      speaking: false, getVoices: () => [], cancel() { this.speaking = false; },
      speak(u) { this.speaking = true; window.lastUtterance = u; },
    } });
  });
  await page.goto(base + "?module=facespeak");
  await page.locator("#details:not([hidden])").waitFor();
  await page.waitForFunction(() => !!window.__blinkTest);
  await page.evaluate(() => {
    const p = window.__blinkTest.perception;
    window.replayTime = performance.now() + 1000;
    window.lastEye = null;
    window.frame = (state, last = window.lastEye) => {
      if (last) window.lastEye = last;
      p.emit("frame", { t: window.replayTime, raw: {}, face: {}, analysis: { valid: true, eye: { state, last, total: 0 }, au: {}, head: {}, lip: {} } });
    };
    window.rest = (ms = 700) => { window.frame("OPEN"); window.replayTime += ms; window.frame("OPEN"); };
    window.blink = (duration = 160) => {
      const start = window.replayTime;
      window.frame("CLOSED / DIP"); window.replayTime += duration + 40;
      window.frame("OPEN", { start, timestamp: window.replayTime, duration, amplitude: 0.3 });
    };
    window.rest();
    // Ordinary spaced blinks must not open a request.
    for (let i = 0; i < 3; i++) { window.blink(); window.rest(3000); }
  });
  assert.equal(await page.locator("#confirmDialog").evaluate((e) => e.open), false);
  await page.evaluate(() => {
    for (let i = 0; i < 3; i++) { window.blink(); window.rest(200); }
  });
  assert.equal(await page.locator("#confirmDialog").evaluate((e) => e.open), true);
  assert.match(await page.locator("#ashaMessage").textContent(), /Do you want water.*finish speaking.*deliberate blink/);
  assert.equal(sent.length, 0);
  await page.screenshot({ path: "artifacts/blink-confirmation-mobile.png", fullPage: true });
  // A cancelled question's delayed onend must not arm a replacement question.
  await page.evaluate(() => { window.oldQuestion = window.lastUtterance; });
  await page.locator("#confirmRepeat").click();
  await page.evaluate(() => { window.oldQuestion.onend(); });
  assert.match(await page.locator("#confirmStatus").textContent(), /Wait for Asha/);
  // Extra blinks while the question is still being spoken cannot confirm.
  await page.evaluate(() => { window.rest(); window.blink(480); });
  assert.equal(sent.length, 0);
  await page.evaluate(() => {
    window.speechSynthesis.speaking = false;
    window.lastUtterance.onend();
    window.rest(); window.blink();
  });
  assert.equal(sent.length, 0);
  // RequestGate uses wall time as an independent protection against same-event confirmation.
  await page.waitForTimeout(750);
  await page.evaluate(() => { window.rest(); window.blink(480); });
  await page.waitForFunction(() => !document.getElementById("confirmDialog").open);
  await page.waitForTimeout(200);
  assert.equal(sent.length, 1);
  assert.equal(sent[0].kind, "water");
  assert.equal(sent[0].confirmed, true);
  assert.equal(sent[0].source, "deliberate blink");
  assert.deepEqual(errors, []);
  console.log(JSON.stringify({ base, eyeOnlyRequest: true, questionBeforeSend: true, ordinaryBlinksRejected: true, caregiverEvents: sent.length, errors }));
} finally { await browser.close(); }
