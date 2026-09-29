// A demo tab that outlives its server session reconnects without a private link.
import assert from "node:assert/strict";
import { createRequire } from "node:module";

const require = createRequire(import.meta.url);
const {
  chromium,
} = require("C:/Users/user/.cache/codex-runtimes/codex-primary-runtime/dependencies/node/node_modules/playwright");
const base = process.env.ASHA_TEST_BASE || "http://127.0.0.1:4180/";
const ids = ["0123456789abcdef01234567", "fedcba987654321001234567"];
const tokens = ["old-demo-token", "new-demo-token"];
const profile = (index) => ({
  patientId: ids[index],
  label: "Demo patient",
  assessment: { eyes: "reliable", speech: "limited" },
  supportContext: { categories: [], goals: [], note: "" },
  recommendation: { primary: "facespeak", suggested: ["facespeak"] },
  voice: { name: "", rate: 0.9 },
});
const browser = await chromium.launch({
  headless: true,
  executablePath: "C:/Program Files/Google/Chrome/Application/chrome.exe",
});
const page = await browser.newPage({ viewport: { width: 390, height: 844 } });
const errors = [];
const aiTokens = [];
let creates = 0;
let invalidateFirst = false;
page.on("pageerror", (error) => errors.push(error.message));
try {
  await page.route("**/api/session**", (route) => {
    const request = route.request();
    const body = request.method() === "POST" ? request.postDataJSON() : null;
    if (body?.action === "create") {
      const index = creates++;
      assert.ok(index < 2, "only one replacement demo may be created");
      return route.fulfill({
        json: {
          ...profile(index),
          patientToken: tokens[index],
          caregiverToken: `caregiver-${index}`,
        },
      });
    }
    const oldToken = request.headers().authorization === `Bearer ${tokens[0]}`;
    if (oldToken && invalidateFirst)
      return route.fulfill({
        status: 401,
        json: { error: "Open your private patient or caregiver link again." },
      });
    const index = oldToken ? 0 : 1;
    return route.fulfill({
      json: {
        profile: profile(index),
        role: "patient",
        events: [],
        status: null,
      },
    });
  });
  await page.route("**/api/asha", (route) => {
    const token = route.request().headers().authorization;
    aiTokens.push(token);
    if (token === `Bearer ${tokens[0]}` && invalidateFirst)
      return route.fulfill({
        status: 401,
        json: { error: "Open your private patient or caregiver link again." },
      });
    return route.fulfill({ json: { reply: "Asha is here again." } });
  });
  await page.route("**/api/health", (route) =>
    route.fulfill({ json: { cloudConfigured: true } }),
  );
  await page.addInitScript(() => {
    window.confirm = () => true;
  });
  await page.goto(base + "?module=facespeak");
  await page.locator("#details:not([hidden])").waitFor();
  assert.equal(creates, 1);
  await page.locator("#moduleAdvice").click();
  await page.locator("#chatInput").fill("hi");
  invalidateFirst = true;
  await page.locator("#chatForm button").click();
  await page.waitForFunction(() =>
    document
      .getElementById("chatMessages")
      .textContent.includes("Asha is here again."),
  );
  assert.equal(creates, 2);
  assert.deepEqual(aiTokens, [`Bearer ${tokens[0]}`, `Bearer ${tokens[1]}`]);
  assert.equal(
    await page.locator("#cloudBadge").textContent(),
    "Asha connected",
  );
  assert.match(await page.locator("#demoNotice").textContent(), /Demo session/);
  assert.match(
    await page.locator("#demoNotice").textContent(),
    /copy the new link/,
  );
  const saved = await page.evaluate(() => ({
    patient: JSON.parse(localStorage.getItem("asha_live_patient")),
    care: JSON.parse(localStorage.getItem("asha_live_care")),
  }));
  assert.equal(saved.patient.patientId, ids[1]);
  assert.equal(
    saved.care.some((item) => item.patientId === ids[0]),
    false,
  );
  assert.equal(
    saved.care.some((item) => item.patientId === ids[1]),
    true,
  );
  // A private patient link is never silently replaced with a demo identity.
  const privatePage = await browser.newPage({
    viewport: { width: 390, height: 844 },
  });
  privatePage.on("pageerror", (error) => errors.push(error.message));
  let privateCreates = 0;
  let privateExpired = false;
  const privateToken = "a".repeat(43);
  await privatePage.route("**/api/session**", (route) => {
    const request = route.request();
    if (
      request.method() === "POST" &&
      request.postDataJSON()?.action === "create"
    )
      privateCreates++;
    if (privateExpired)
      return route.fulfill({
        status: 401,
        json: { error: "Open your private patient or caregiver link again." },
      });
    return route.fulfill({
      json: { profile: profile(0), role: "patient", events: [], status: null },
    });
  });
  await privatePage.route("**/api/asha", (route) =>
    route.fulfill({
      status: 401,
      json: { error: "Open your private patient or caregiver link again." },
    }),
  );
  await privatePage.route("**/api/health", (route) =>
    route.fulfill({ json: { cloudConfigured: true } }),
  );
  await privatePage.addInitScript(() => {
    window.confirm = () => true;
  });
  await privatePage.goto(
    base + `?role=patient#patientId=${ids[0]}&token=${privateToken}`,
  );
  await privatePage.locator("#patient:not([hidden])").waitFor();
  await privatePage.locator("#bubbleHandle").click();
  await privatePage.locator("#chatInput").fill("hi");
  privateExpired = true;
  await privatePage.locator("#chatForm button").click();
  await privatePage.waitForFunction(() =>
    document
      .getElementById("chatMessages")
      .textContent.includes(
        "Open your private patient or caregiver link again.",
      ),
  );
  assert.equal(privateCreates, 0);
  assert.equal(
    await privatePage.locator("#cloudBadge").textContent(),
    "Session expired",
  );
  assert.deepEqual(errors, []);
  console.log(
    JSON.stringify({
      reconnects: creates - 1,
      aiCalls: aiTokens.length,
      privateSessionsReplaced: privateCreates,
      errors,
    }),
  );
} finally {
  await browser.close();
}
