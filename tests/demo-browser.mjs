// A new visitor can explore the real modules and cloud route without pasting a link.
import { createRequire } from "node:module";
import assert from "node:assert/strict";
import { fileURLToPath } from "node:url";
const require = createRequire(import.meta.url);
const { chromium } = require("C:/Users/user/.cache/codex-runtimes/codex-primary-runtime/dependencies/node/node_modules/playwright");
const base = process.env.ASHA_TEST_BASE || "http://127.0.0.1:4180/";
const browser = await chromium.launch({ headless: true, executablePath: "C:/Program Files/Google/Chrome/Application/chrome.exe" });
const page = await browser.newPage({ viewport: { width: 390, height: 844 } });
const errors = [], createRequests = [], aiRequests = [], caregiverEvents = [];
page.on("pageerror", (e) => errors.push(e.message));
const profile = {
  patientId: "0123456789abcdef01234567", label: "Demo patient",
  assessment: { leftHand: "reliable", rightHand: "reliable", wrist: "reliable", fingers: "reliable", eyes: "reliable", lips: "reliable", head: "reliable", speech: "limited", canSee: true, canHear: true },
  supportContext: { categories: [], goals: [], note: "" },
  recommendation: { primary: "fingerspeak", suggested: ["fingerspeak", "facespeak", "senseassist"] },
  voice: { name: "", rate: 0.9 },
};
try {
  await page.route("**/api/session**", (route) => {
    const b = route.request().postDataJSON();
    if (b?.action === "create") {
      createRequests.push(b);
      return route.fulfill({ json: { ...profile, patientToken: "demo-patient-token", caregiverToken: "demo-caregiver-token" } });
    }
    if (b?.action === "event") caregiverEvents.push({ auth: route.request().headers().authorization, body: b });
    return route.fulfill({ json: { profile, role: "patient", events: [], status: null } });
  });
  await page.route("**/api/asha", (route) => {
    aiRequests.push({ auth: route.request().headers().authorization, body: route.request().postDataJSON() });
    return route.fulfill({ json: { reply: "I can guide you through this module." } });
  });
  await page.route("**/api/health", (route) => route.fulfill({ json: { cloudConfigured: true } }));
  await page.route("**/artifacts/portrait-test.jpg", (route) => route.fulfill({ contentType: "image/jpeg", path: fileURLToPath(new URL("../artifacts/portrait-test.jpg", import.meta.url)) }));
  await page.addInitScript(() => {
    window.confirm = () => true;
    window.cameraOpenCount = 0;
    Object.defineProperty(navigator.mediaDevices, "getUserMedia", { value: async () => {
      window.cameraOpenCount++;
      const image = new Image(); image.src = "/artifacts/portrait-test.jpg"; await image.decode();
      const canvas = document.createElement("canvas"); canvas.width = 640; canvas.height = 480;
      const ctx = canvas.getContext("2d"); ctx.drawImage(image, 0, 0, 640, 480);
      const timer = setInterval(() => ctx.drawImage(image, 0, 0, 640, 480), 40);
      const stream = canvas.captureStream(25);
      stream.getTracks()[0].addEventListener("ended", () => clearInterval(timer));
      return stream;
    } });
  });
  await page.goto(base + "?module=facespeak");
  await page.locator("#details:not([hidden])").waitFor();
  assert.equal(await page.locator("#linkDialog").evaluate((d) => d.open), false);
  assert.equal(createRequests.length, 1);
  assert.equal(createRequests[0].label, "Demo patient");
  assert.equal(await page.locator("#demoNotice").isVisible(), true);
  assert.equal(await page.locator("#details [data-demo-care-link]").isVisible(), true);
  await page.screenshot({ path: "artifacts/demo-entry-mobile.png" });
  await page.locator("#studioStart").click();
  await page.waitForFunction(() => JSON.parse(document.getElementById("liveSummary").dataset.cycles || "{}").face > 1, null, { timeout: 60000 });
  for (const [name, heading] of [
    ["facespeak", "NeuroFace Sense"], ["fingerspeak", "FingerSpeak"],
    ["vitalsense", "VitalSense"], ["senseassist", "SenseAssist"], ["posture", "Body posture"],
  ]) {
    await page.locator(`[data-module="${name}"]`).click();
    if (name === "fingerspeak")
      await page.frameLocator("#fingerStudio").getByRole("heading", { name: "Gesture vocabulary", exact: true }).waitFor();
    else await page.getByRole("heading", { name: heading, exact: true }).first().waitFor();
  }
  assert.equal(await page.evaluate(() => window.cameraOpenCount), 1);
  await page.locator("#moduleAdvice").click();
  await page.locator("#chatInput").fill("hi");
  await page.locator("#chatForm button").click();
  await page.waitForFunction(() => document.getElementById("chatMessages").textContent.includes("I can guide you through this module."));
  assert.equal(aiRequests.length, 1);
  assert.equal(aiRequests[0].auth, "Bearer demo-patient-token");
  await page.locator("#details [data-view=patient]").click();
  assert.equal(await page.locator("#chatPanel").isVisible(), false);
  await page.locator("[data-need=water]").click();
  await page.waitForTimeout(700);
  await page.locator("#confirmYes").click();
  await page.waitForFunction(() => document.getElementById("latestRequest").textContent.includes("Sent"));
  assert.equal(caregiverEvents.length, 1);
  assert.equal(caregiverEvents[0].auth, "Bearer demo-patient-token");
  assert.equal(caregiverEvents[0].body.kind, "water");
  const entry = await browser.newPage({ viewport: { width: 390, height: 844 } });
  entry.on("pageerror", (e) => errors.push(e.message));
  await entry.route("**/api/session**", (route) => route.fulfill({ json: { ...profile, patientToken: "demo-patient-token", caregiverToken: "demo-caregiver-token" } }));
  await entry.route("**/api/health", (route) => route.fulfill({ json: { cloudConfigured: true } }));
  await entry.goto(base);
  await entry.locator("#welcome:not([hidden])").waitFor();
  assert.equal(await entry.locator("#linkDialog").evaluate((d) => d.open), false);
  await entry.locator("#exploreDemo").click();
  await entry.locator("#details:not([hidden])").waitFor();
  assert.equal(await entry.locator("#linkDialog").evaluate((d) => d.open), false);
  const offline = await browser.newPage({ viewport: { width: 390, height: 844 } });
  offline.on("pageerror", (e) => errors.push(e.message));
  await offline.route("**/api/session**", (route) => route.fulfill({ status: 503, json: { error: "Temporarily unavailable" } }));
  await offline.route("**/api/health", (route) => route.fulfill({ json: { cloudConfigured: false } }));
  await offline.goto(base + "?module=vitalsense");
  await offline.locator("#details:not([hidden])").waitFor();
  assert.match(await offline.locator("#demoNotice").textContent(), /Local demo/);
  assert.equal(await offline.locator("#linkDialog").evaluate((d) => d.open), false);
  await offline.locator('[data-module="facespeak"]').click();
  await offline.getByRole("heading", { name: "NeuroFace Sense", exact: true }).waitFor();
  assert.equal(await offline.locator("#details [data-demo-care-link]").isVisible(), false);
  assert.deepEqual(errors, []);
  console.log(JSON.stringify({ base, noLinkRequired: true, directModuleAndButton: true, offlineModulesAvailable: true, demoSessions: createRequests.length, modules: 5, cameraStreams: 1, aiCalls: aiRequests.length, caregiverEvents: caregiverEvents.length, errors }));
} finally { await browser.close(); }
