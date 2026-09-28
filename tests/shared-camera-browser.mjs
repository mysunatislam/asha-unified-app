// Real camera models with an official face fixture. API is stubbed here;
// production-browser.mjs separately verifies real two-device transport.
import { createRequire } from "node:module";
import assert from "node:assert/strict";
import fs from "node:fs/promises";
import { fileURLToPath } from "node:url";
const require = createRequire(import.meta.url);
const {
  chromium,
} = require("C:/Users/user/.cache/codex-runtimes/codex-primary-runtime/dependencies/node/node_modules/playwright");
const browser = await chromium.launch({
  headless: true,
  executablePath: "C:/Program Files/Google/Chrome/Application/chrome.exe",
});
const page = await browser.newPage({ viewport: { width: 390, height: 844 } });
const errors = [];
const base = process.env.ASHA_TEST_BASE || "http://127.0.0.1:4180/";
page.on("pageerror", (e) => errors.push(e.message));
const profile = {
  patientId: "camera-test",
  label: "Camera verification",
  assessment: {
    leftHand: "none",
    rightHand: "none",
    wrist: "none",
    fingers: "none",
    eyes: "reliable",
    lips: "reliable",
    head: "none",
    speech: "limited",
    canSee: true,
    canHear: true,
  },
  supportContext: { categories: ["locked-in"], goals: ["needs"], note: "" },
  recommendation: {
    primary: "facespeak",
    suggested: ["facespeak", "senseassist"],
  },
  voice: { name: "", rate: 0.9 },
};
try {
  for (const fixture of ["portrait-test.jpg", "hands-test.jpg"])
    await page.route(`**/artifacts/${fixture}`, (route) =>
      route.fulfill({
        contentType: "image/jpeg",
        path: fileURLToPath(
          new URL(`../artifacts/${fixture}`, import.meta.url),
        ),
      }),
    );
  await page.route("**/api/session**", (route) =>
    route.fulfill({
      json: { profile, role: "patient", events: [], status: null },
    }),
  );
  await page.route("**/api/health", (route) =>
    route.fulfill({ json: { cloudConfigured: true } }),
  );
  await page.addInitScript(() => {
    localStorage.setItem(
      "asha_live_patient",
      JSON.stringify({ patientId: "camera-test", token: "only-a-local-test" }),
    );
    window.cameraOpenCount = 0;
    Object.defineProperty(navigator.mediaDevices, "getUserMedia", {
      value: async () => {
        window.cameraOpenCount++;
        const image = new Image();
        image.src = "/artifacts/portrait-test.jpg";
        await image.decode();
        const canvas = Object.assign(document.createElement("canvas"), {
          width: 640,
          height: 480,
        });
        const ctx = canvas.getContext("2d");
        window.fixtureImage = image;
        const draw = () => {
          if (window.fixtureFit) {
            // A full-resolution hand close-up is outside the original capture
            // distance gate. Present the unchanged fixture at normal arm length.
            ctx.fillStyle = "#fff";
            ctx.fillRect(0, 0, 640, 480);
            const height =
              (520 * window.fixtureImage.height) / window.fixtureImage.width;
            ctx.drawImage(
              window.fixtureImage,
              60,
              (480 - height) / 2,
              520,
              height,
            );
          } else ctx.drawImage(window.fixtureImage, 0, 0, 640, 480);
        };
        draw();
        window.fixtureTimer = setInterval(draw, 40);
        window.fixtureStream = canvas.captureStream(25);
        return window.fixtureStream;
      },
    });
  });
  await page.goto(base);
  await page.locator("#patient:not([hidden])").waitFor();
  await page.locator("#startMonitoring").click();
  await page.waitForFunction(
    () =>
      JSON.parse(document.getElementById("liveSummary").dataset.cycles || "{}")
        .pose >= 2,
    null,
    { timeout: 60000 },
  );
  assert.match(await page.locator("#ashaMessage").textContent(), /I'm Asha.*Nod for water|I'm Asha.*reliable hands-free answer/s);
  assert.equal(await page.locator("#ashaBubble").isVisible(), true);
  await page.locator("#quietAsha").click();
  assert.equal(await page.locator("#quietAsha").textContent(), "Resume Asha check-ins");
  await page.locator("#quietAsha").click();
  await page.screenshot({ path: "artifacts/patient-guidance-mobile.png", fullPage: true });
  await page.locator("#bubbleHandle").click();
  assert.equal(await page.locator("#chatPanel").isVisible(), true);
  await page.locator("#closeChat").click();
  await page.locator("#detailsButton").click();
  const checked = [];
  for (const module of [
    "facespeak",
    "fingerspeak",
    "vitalsense",
    "senseassist",
    "posture",
  ]) {
    const before = await page
      .locator("#liveSummary")
      .evaluate((el) => JSON.parse(el.dataset.cycles));
    await page.locator(`[data-module=${module}]`).click();
    await page.waitForFunction(
      (prior) => {
        const now = JSON.parse(
          document.getElementById("liveSummary").dataset.cycles || "{}",
        );
        return ["face", "hand", "pose", "pulse"].every(
          (key) => now[key] > prior[key],
        );
      },
      before,
      { timeout: 15000 },
    );
    assert.equal(await page.evaluate(() => window.cameraOpenCount), 1);
    assert.equal(
      await page.evaluate(
        () => document.documentElement.scrollWidth > innerWidth,
      ),
      false,
    );
    checked.push(module);
    if (module === "facespeak") {
      for (const heading of [
        "Eye Analysis",
        "Muscle Activity",
        "Smile Analysis",
        "Lip Control",
        "Facial Motion",
        "Head Movement",
        "Activity Log",
      ])
        assert.equal(
          await page
            .getByRole("heading", { name: new RegExp(heading) })
            .count(),
          1,
        );
      assert.notEqual(await page.locator("#nf-value-AU4").textContent(), "—");
      await page.screenshot({
        path: "artifacts/neuroface-light-mobile.png",
        fullPage: true,
      });
      await page.locator("#themeButton").click();
      await page.screenshot({
        path: "artifacts/neuroface-dark-mobile.png",
        fullPage: true,
      });
    }
    if (module === "fingerspeak") {
      const frame = page.frameLocator("#fingerStudio");
      await frame.locator("#gestureList .gesture-row").first().waitFor();
      await page.evaluate(async () => {
        const im = new Image();
        im.src = "/artifacts/hands-test.jpg";
        await im.decode();
        window.fixtureFit = true;
        window.fixtureImage = im;
      });
      await page.waitForFunction(
        () =>
          document
            .getElementById("fingerStudio")
            .contentDocument.getElementById("handCount")
            .textContent.includes("2/2"),
        null,
        { timeout: 25000 },
      );
      await frame.locator("#currentGesture").filter({ hasText: /tracked.*preview only/i }).waitFor();
      assert.match(await frame.locator("#gestureSignalNote").textContent(), /Hand detected.*Train personal gestures/i);
      assert.doesNotMatch(await frame.locator("#currentGesture").textContent(), /no hand detected/i);
      assert.equal(
        await frame
          .locator("body")
          .evaluate(() => document.documentElement.scrollWidth > innerWidth),
        false,
      );
      const record = frame
        .locator("#gestureList .gesture-row")
        .first()
        .getByRole("button", { name: "Record", exact: true });
      await record.click();
      await frame.locator("#captureQuality.ok").waitFor({ timeout: 15000 });
      assert.ok(
        (await frame.locator("#sessionNote").textContent()).includes(
          "1 total samples",
        ),
      );
      await frame.locator('[data-tab="evaluate"]').click();
      assert.equal(
        await frame
          .getByRole("heading", { name: "Model evaluation", exact: true })
          .isVisible(),
        true,
      );
      await frame.locator('[data-tab="calibrate"]').click();
      await page.screenshot({
        path: "artifacts/fingerspeak-full-mobile.png",
        fullPage: true,
      });
      await page.evaluate(async () => {
        const im = new Image();
        im.src = "/artifacts/portrait-test.jpg";
        await im.decode();
        window.fixtureFit = false;
        window.fixtureImage = im;
      });
    }
  }
  await page.locator('#details [data-view="patient"]').click();
  const before = await page
    .locator("#liveSummary")
    .evaluate((el) => JSON.parse(el.dataset.cycles));
  await page.waitForFunction(
    (n) =>
      JSON.parse(document.getElementById("liveSummary").dataset.cycles).pose >
      n,
    before.pose,
  );
  await page.locator("#pauseMonitoring").click();
  assert.equal(
    await page.evaluate(() =>
      window.fixtureStream.getTracks().every((t) => t.readyState === "ended"),
    ),
    true,
  );
  assert.equal(errors.length, 0);
  const report = {
    base,
    oneCameraAcrossModules: true,
    bothHandsDetected: true,
    realCalibrationSampleAccepted: true,
    activeModules: checked,
    continuesOnPatientPage: true,
    stopsOnPause: true,
    applicationErrors: errors,
  };
  console.log(JSON.stringify(report));
  await fs.writeFile(
    "artifacts/shared-camera-verification.json",
    JSON.stringify(report, null, 2),
  );
} catch (error) {
  console.log(
    "Browser check context:",
    await page.evaluate(() => ({
      errors: document.getElementById("toast")?.textContent,
      handQuality: document
        .getElementById("fingerStudio")
        ?.contentDocument?.getElementById("captureQuality")?.textContent,
      handFps: document
        .getElementById("fingerStudio")
        ?.contentDocument?.getElementById("fpsReadout")?.textContent,
    })),
    errors,
  );
  await page.screenshot({
    path: "artifacts/shared-camera-failure.png",
    fullPage: true,
  });
  throw error;
} finally {
  await browser.close();
}
