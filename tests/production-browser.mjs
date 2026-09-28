import { createRequire } from "node:module";
import fs from "node:fs/promises";
import assert from "node:assert/strict";
const require = createRequire(import.meta.url),
  {
    chromium,
  } = require("C:/Users/user/.cache/codex-runtimes/codex-primary-runtime/dependencies/node/node_modules/playwright");
const base = "https://neurobridge-asha-live.vercel.app/";
const browser = await chromium.launch({
  headless: true,
  executablePath: "C:/Program Files/Google/Chrome/Application/chrome.exe",
});
const p = await browser.newPage({ viewport: { width: 390, height: 844 } }),
  c = await browser.newPage({ viewport: { width: 412, height: 915 } }),
  errors = [];
for (const page of [p, c]) page.on("pageerror", (e) => errors.push(e.message));
let data;
try {
  await p.goto(base);
  await p.getByRole("button", { name: "Set up with a caregiver" }).click();
  await p.locator('[name="supportCategory"][value="stroke"]').check();
  await p.locator('[name="supportGoal"][value="speech"]').check();
  await p.screenshot({
    path: "artifacts/support-profile-mobile.png",
    fullPage: true,
  });
  assert.equal(
    await p.evaluate(() => document.documentElement.scrollWidth > innerWidth),
    false,
  );
  await p.locator("#supportNext").click();
  await p.locator("[name=label]").fill("Two-phone verification");
  await p.locator("[name=eyes]").selectOption("reliable");
  await p.locator("[name=lips]").selectOption("reliable");
  await p.locator("[name=speech]").selectOption("limited");
  await p.locator("#assessmentNext").click();
  await p.locator("[name=consent]").check();
  const response = p.waitForResponse(
    (r) => r.url().endsWith("/api/session") && r.request().method() === "POST",
  );
  await p.getByRole("button", { name: "Create private care circle" }).click();
  const r = await response;
  data = await r.json();
  assert.equal(r.status(), 200);
  assert.deepEqual(data.supportContext.categories, ["stroke"]);
  assert.deepEqual(data.supportContext.goals, ["speech"]);
  assert.ok(data.recommendation.suggested.includes("senseassist"));
  await p.locator("#continuePatient").click();
  await p.locator("#patient:not([hidden])").waitFor();
  await c.goto(
    base +
      `?role=caregiver#patientId=${data.patientId}&token=${data.caregiverToken}`,
  );
  await c.locator("#caregiver:not([hidden])").waitFor();
  await c.waitForFunction(
    () =>
      document
        .getElementById("careSupportProfile")
        ?.textContent.includes("Post-stroke recovery"),
    null,
    { timeout: 45000 },
  );
  await c.locator("#careEdit").click();
  assert.equal(
    await c.locator('[name="supportCategory"][value="stroke"]').isChecked(),
    true,
  );
  await c.locator("#supportNext").click();
  await c.locator("#assessmentNext").click();
  await c.locator('[name="consent"]').check();
  await c.getByRole("button", { name: "Save updated assessment" }).click();
  await c.locator("#caregiver:not([hidden])").waitFor();
  await p.locator("[data-need=water]").click();
  await p.waitForTimeout(750);
  await p.locator("#confirmYes").click();
  await c
    .getByRole("button", { name: "Acknowledge", exact: true })
    .first()
    .waitFor({ timeout: 45000 });
  await c
    .getByRole("button", { name: "Acknowledge", exact: true })
    .first()
    .click();
  await p.waitForFunction(
    () =>
      document
        .getElementById("latestRequest")
        .textContent.includes("Acknowledged"),
    null,
    { timeout: 45000 },
  );
  await p.screenshot({
    path: "artifacts/production-patient-mobile.png",
    fullPage: true,
  });
  await c.screenshot({
    path: "artifacts/production-caregiver-mobile.png",
    fullPage: true,
  });
  await p.locator("#detailsButton").click();
  for (const module of [
    "facespeak",
    "fingerspeak",
    "vitalsense",
    "senseassist",
    "posture",
  ]) {
    await p.locator(`[data-module=${module}]`).click();
    if (module === "fingerspeak") {
      const frame = p.frameLocator("#fingerStudio");
      await frame
        .getByRole("heading", { name: "Gesture vocabulary", exact: true })
        .waitFor();
      await frame.locator("#gestureList .gesture-row").first().waitFor();
      await frame.locator('[data-tab="evaluate"]').click();
      assert.ok(
        await frame
          .getByRole("heading", { name: "Model evaluation", exact: true })
          .isVisible(),
      );
      await frame.locator('[data-tab="calibrate"]').click();
    } else {
      assert.ok(await p.locator("#moduleContent h2").first().isVisible());
    }
  }
  await p.locator("#themeButton").click();
  await p.screenshot({
    path: "artifacts/production-details-dark.png",
    fullPage: true,
  });
  const results = {
    realPublicDeployment: true,
    patientRequestCaregiverAcknowledgment: true,
    allFiveModulesAccessible: true,
    optionalProfilePersistedAndEditable: true,
    applicationErrors: errors,
    mobileOverflow: await p.evaluate(
      () => document.documentElement.scrollWidth > innerWidth,
    ),
  };
  console.log(JSON.stringify(results));
  await fs.writeFile(
    "artifacts/production-verification.json",
    JSON.stringify(results, null, 2),
  );
  assert.equal(errors.length, 0);
  assert.equal(results.mobileOverflow, false);
} finally {
  if (data?.caregiverToken) {
    const r = await p.request.post(base + "api/session", {
      headers: {
        authorization: "Bearer " + data.caregiverToken,
        origin: new URL(base).origin,
      },
      data: { action: "delete", patientId: data.patientId, confirm: "DELETE" },
    });
    console.log("Temporary test record deleted:", r.ok());
  }
  await browser.close();
}
