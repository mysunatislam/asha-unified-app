import { createRequire } from "node:module";
import fs from "node:fs/promises";
const require = createRequire(import.meta.url);
const {
  chromium,
} = require("C:/Users/user/.cache/codex-runtimes/codex-primary-runtime/dependencies/node/node_modules/playwright");
await fs.mkdir("artifacts", { recursive: true });
const browser = await chromium.launch({
  executablePath: "C:/Program Files/Google/Chrome/Application/chrome.exe",
  headless: true,
  args: [
    "--use-fake-ui-for-media-stream",
    "--use-fake-device-for-media-stream",
    "--no-sandbox",
  ],
});
const p = await browser.newPage({
  viewport: { width: 1440, height: 960 },
  deviceScaleFactor: 1,
});
const errors = [];
p.on("pageerror", (e) => errors.push(e.message));
await p.goto("http://127.0.0.1:4180/");
await p.screenshot({ path: "artifacts/welcome-desktop.png", fullPage: true });
await p.getByRole("button", { name: "Set up with a caregiver" }).click();
await p.locator("#supportSkip").click();
await p.locator("[name=label]").fill("QA care circle");
await p.locator("[name=eyes]").selectOption("reliable");
await p.locator("[name=lips]").selectOption("reliable");
await p.locator("[name=head]").selectOption("limited");
await p.locator("[name=speech]").selectOption("limited");
await p.getByRole("button", { name: "Next: recommended support" }).click();
await p.screenshot({ path: "artifacts/setup-desktop.png", fullPage: true });
await p.setViewportSize({ width: 390, height: 844 });
await p.screenshot({ path: "artifacts/setup-mobile.png", fullPage: true });
await p.locator("[name=consent]").check();
const response = p.waitForResponse(
  (r) => r.url().endsWith("/api/session") && r.request().method() === "POST",
);
await p.getByRole("button", { name: "Create private care circle" }).click();
const r = await response,
  d = await r.json();
if (!r.ok()) throw Error("Setup failed: " + JSON.stringify(d));
await p.getByRole("button", { name: "Open patient screen" }).click();
await p.waitForSelector("#patient:not([hidden])");
await p.screenshot({ path: "artifacts/patient-mobile.png", fullPage: true });
const ctx = await browser.newContext({ viewport: { width: 412, height: 915 } }),
  care = await ctx.newPage();
care.on("pageerror", (e) => errors.push(e.message));
await care.goto(
  `http://127.0.0.1:4180/?role=caregiver#patientId=${d.patientId}&token=${d.caregiverToken}`,
);
await care.waitForSelector("#caregiver:not([hidden])");
await p.locator("[data-need=water]").click();
await p.waitForTimeout(800);
await p.getByRole("button", { name: "Yes, send request" }).click();
await care
  .getByRole("button", { name: "Acknowledge" })
  .first()
  .waitFor({ timeout: 45000 });
await care.screenshot({
  path: "artifacts/caregiver-mobile.png",
  fullPage: true,
});
await care.getByRole("button", { name: "Acknowledge" }).first().click();
await p.waitForFunction(
  () =>
    document
      .getElementById("latestRequest")
      .textContent.includes("Acknowledged"),
  {},
  { timeout: 45000 },
);
await p.locator("#detailsButton").click();
await p.waitForSelector("#details:not([hidden])");
await p.locator("[data-module=fingerspeak]").click();
const finger = p.frameLocator("#fingerStudio");
await finger
  .getByRole("heading", { name: "Gesture vocabulary", exact: true })
  .waitFor();
await finger.locator('[data-tab="evaluate"]').click();
await finger
  .getByRole("heading", { name: "Model evaluation", exact: true })
  .waitFor();
await finger.locator('[data-tab="calibrate"]').click();
await p.screenshot({
  path: "artifacts/fingerspeak-mobile.png",
  fullPage: true,
});
await p.locator("[data-module=senseassist]").click();
await p.locator("#heardSpeech").fill("wed wabbit wghreen");
await p.locator("#speechTarget").fill("Colors and animals");
await p.locator("#interpretSpeech").click();
await p.waitForFunction(
  () =>
    document.getElementById("speechResult").textContent.includes("Is this") ||
    document.getElementById("speakCandidate") ||
    document.getElementById("speechResult").textContent.includes("unavailable"),
  {},
  { timeout: 40000 },
);
console.log("Speech API:", await p.locator("#speechResult").innerText());
await p.screenshot({ path: "artifacts/speech-mobile.png", fullPage: true });
await p.locator("#themeButton").click();
await p.screenshot({
  path: "artifacts/details-dark-mobile.png",
  fullPage: true,
});
await p.locator("#studioStart").click();
await p.waitForFunction(
  () =>
    !document.getElementById("pauseMonitoring").hidden ||
    document.getElementById("toast").textContent.includes("model"),
  {},
  { timeout: 65000 },
);
await p.waitForTimeout(2500);
console.log("Camera status:", await p.locator("#cameraStatus").innerText());
await p.locator("[data-module=posture]").click();
await p.locator("#enableYolo").click();
await p.waitForTimeout(12000);
console.log("YOLO status:", await p.locator("#yoloStatus").innerText());
const overflow = await p.evaluate(
  () => document.documentElement.scrollWidth > innerWidth,
);
console.log(
  JSON.stringify({
    uiErrors: errors,
    mobileOverflow: overflow,
    twoContextRequestAck: true,
  }),
);
const del = await p.request.post("http://127.0.0.1:4180/api/session", {
  headers: { authorization: "Bearer " + d.caregiverToken },
  data: { action: "delete", patientId: d.patientId, confirm: "DELETE" },
});
console.log("Test session removed:", del.ok());
await browser.close();
if (errors.length || overflow) process.exitCode = 1;
