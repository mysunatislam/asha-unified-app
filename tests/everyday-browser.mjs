import { createRequire } from "node:module";
import assert from "node:assert/strict";
import fs from "node:fs/promises";

const require = createRequire(import.meta.url);
const {
  chromium,
} = require("C:/Users/user/.cache/codex-runtimes/codex-primary-runtime/dependencies/node/node_modules/playwright");
const BASE = process.env.EVERYDAY_TEST_URL || "http://127.0.0.1:4180";
const origin = new URL(BASE);
assert.ok(
  ["127.0.0.1", "localhost"].includes(origin.hostname),
  "Browser QA must use a local preview, never production.",
);
await fs.mkdir("artifacts", { recursive: true });
await fs.mkdir("artifacts/everyday-downloads", { recursive: true });
const browser = await chromium.launch({
  executablePath: "C:/Program Files/Google/Chrome/Application/chrome.exe",
  downloadsPath: new URL(
    "../artifacts/everyday-downloads",
    import.meta.url,
  ).pathname.replace(/^\/(\w:)/, "$1"),
  headless: true,
  args: ["--no-sandbox"],
});
const errors = [],
  unexpectedAPI = [],
  contexts = [];
const nonce = Date.now().toString(36),
  mealName = `QA meal ${nonce}`,
  journal = `QA journal ${nonce}: I slept well and want to record my day.`;
let activePage;

async function newPage(viewport = { width: 1440, height: 960 }) {
  const context = await browser.newContext({
    viewport,
    acceptDownloads: true,
    serviceWorkers: "block",
  });
  contexts.push(context);
  // Exercise the permission-error path only. This test does not simulate gaze or pose accuracy.
  await context.addInitScript(() => {
    if (navigator.mediaDevices)
      Object.defineProperty(navigator.mediaDevices, "getUserMedia", {
        value: () =>
          Promise.reject(
            new DOMException("QA camera permission denied", "NotAllowedError"),
          ),
      });
  });
  await context.route("**/api/**", async (route) => {
    const url = new URL(route.request().url());
    if (url.origin === origin.origin && url.pathname === "/api/clinic")
      return route.continue();
    unexpectedAPI.push({
      path: url.pathname,
      method: route.request().method(),
    });
    await route.abort("blockedbyclient");
  });
  const page = await context.newPage();
  activePage = page;
  page.on("pageerror", (error) => errors.push(error.message));
  page.setDefaultTimeout(12000);
  return page;
}
async function route(page, name, ready) {
  activePage = page;
  await page.locator(`[data-route="${name}"]`).click();
  if (ready) await page.locator(ready).first().waitFor();
}
async function contains(locator, expected) {
  const match = locator.filter({ hasText: expected }).first();
  await match.waitFor();
  assert.match(await match.textContent(), expected);
}
async function screenshot(page, name) {
  await page.screenshot({
    path: `artifacts/everyday-${name}.png`,
    fullPage: true,
    mask: [page.locator("input[readonly]")],
  });
}
async function noOverflow(page, name) {
  const value = await page.evaluate(() => ({
    width: innerWidth,
    scroll: document.documentElement.scrollWidth,
    height: innerHeight,
  }));
  assert.ok(
    value.scroll <= value.width + 2,
    `${name} overflow: ${JSON.stringify(value)}`,
  );
}
async function downloadJSON(page, button) {
  // This managed Chrome cancels filesystem downloads. Verify the actual export
  // payload through the product's copyable fallback without claiming an OS save.
  await button.click();
  await page.locator("#exportText").waitFor();
  return JSON.parse(await page.locator("#exportText").inputValue());
}
async function meal(page, name) {
  await route(page, "nutrition", '[aria-label="Nutrition"]');
  await page.getByLabel("Meal name", { exact: true }).fill(name);
  await page
    .getByLabel("Search food · English or বাংলা", { exact: true })
    .fill("rice");
  await page.getByLabel("Amount", { exact: true }).fill("150");
  await page
    .getByRole("button", { name: "Add ingredient", exact: true })
    .click();
  await page
    .getByLabel("I checked the ingredients, weights, oil and salt.", {
      exact: true,
    })
    .check();
  await page
    .getByRole("button", { name: "Confirm and save meal", exact: true })
    .click();
  await page.getByRole("heading", { name, exact: true }).waitFor();
}

try {
  const page = await newPage();
  await page.goto(BASE + "/everyday.html");
  await page.locator(".module-grid").waitFor();
  await screenshot(page, "home-desktop");
  await noOverflow(page, "desktop home");
  assert.ok(
    (await page.locator('a[href="/app"]').count()) > 0,
    "Original assistive app remains reachable.",
  );

  // Nutrition is a real deterministic journal: correction creates a version, deletion removes it.
  await meal(page, mealName);
  let article = page
    .locator("article")
    .filter({
      has: page.getByRole("heading", { name: mealName, exact: true }),
    });
  await article
    .getByRole("button", { name: "Correct meal", exact: true })
    .click();
  await page.getByLabel("Chosen grams", { exact: true }).fill("180");
  await page
    .getByLabel("I checked the ingredients, weights, oil and salt.", {
      exact: true,
    })
    .check();
  await page
    .getByRole("button", { name: "Confirm and save correction", exact: true })
    .click();
  await page.waitForFunction(
    (name) =>
      [...document.querySelectorAll("article h4")].filter(
        (node) => node.textContent === name,
      ).length === 2,
    mealName,
  );
  await contains(page.locator("article"), /Previous version/);
  await page
    .locator("article")
    .filter({ hasText: "Previous version" })
    .getByRole("button", { name: "Delete meal", exact: true })
    .click();
  await page.waitForFunction(
    () => document.querySelectorAll("article").length === 1,
  );
  await screenshot(page, "nutrition-desktop");
  console.log("PASS Nutrition manual save, versioned correction, and delete");

  // Vault persistence is checked through UI reload/unlock, export and actual IndexedDB contents.
  await route(page, "privacy", "#vaultForm");
  const passphrase = `QA-private-passphrase-${nonce}`;
  await page.locator("#passphrase").fill(passphrase);
  await page.locator("#unlockVault").click();
  await contains(page.locator("#vaultInfo"), /Encrypted vault unlocked/);
  const sealed = await page.evaluate(async () => {
    const db = await new Promise((resolve, reject) => {
      const req = indexedDB.open("asha-everyday-v1", 1);
      req.onsuccess = () => resolve(req.result);
      req.onerror = reject;
    });
    const read = (name) =>
      new Promise((resolve, reject) => {
        const req = db.transaction(name).objectStore(name).getAll();
        req.onsuccess = () => resolve(req.result);
        req.onerror = reject;
      });
    const result = {
      records: await read("records"),
      settings: await read("settings"),
    };
    db.close();
    return result;
  });
  assert.equal(sealed.records.length, 1);
  assert.ok(sealed.records[0].cipher && sealed.records[0].iv);
  assert.equal(JSON.stringify(sealed).includes(mealName), false);
  assert.equal(JSON.stringify(sealed).includes(passphrase), false);
  await page.reload();
  await page.locator("#vaultForm").waitFor();
  await contains(page.locator("#vaultInfo"), /encrypted vault exists/i);
  await page.locator("#passphrase").fill("incorrect passphrase");
  await page.locator("#unlockVault").click();
  await contains(page.locator("#vaultInfo"), /could not unlock/);
  await page.locator("#passphrase").fill(passphrase);
  await page.locator("#unlockVault").click();
  await contains(page.locator("#vaultInfo"), /Encrypted vault unlocked/);
  const exported = await downloadJSON(page, page.locator("#exportRecords"));
  assert.ok(JSON.stringify(exported).includes(mealName));
  assert.ok(JSON.stringify(exported).includes("corrected"));
  await page.locator("#lockVault").click();
  await contains(page.locator("#vaultInfo"), /Unlock to see saved records/);
  await page.locator("#passphrase").fill(passphrase);
  await page.locator("#unlockVault").click();
  await contains(page.locator("#vaultInfo"), /Encrypted vault unlocked/);
  page.once("dialog", (dialog) => dialog.accept());
  await page.locator("#deleteRecords").click();
  await contains(page.locator("#vaultInfo"), /Session only/);
  const afterDelete = await page.evaluate(async () => {
    const req = indexedDB.open("asha-everyday-v1", 1);
    const db = await new Promise((resolve) => {
      req.onsuccess = () => resolve(req.result);
    });
    const size = await Promise.all(
      ["records", "settings"].map(
        (name) =>
          new Promise((resolve) => {
            const read = db.transaction(name).objectStore(name).count();
            read.onsuccess = () => resolve(read.result);
          }),
      ),
    );
    db.close();
    return size;
  });
  assert.deepEqual(afterDelete, [0, 0]);
  console.log(
    "PASS Encrypted vault create, reload, wrong-password rejection, unlock, export, lock and delete; no plaintext in IndexedDB",
  );

  await page.setViewportSize({ width: 390, height: 844 });
  await route(page, "eyespeak", "[data-message]");
  const output = page.locator("[data-message]");
  const phrase = page.locator("[data-tiles] button").first();
  const phraseText = await phrase.textContent();
  await phrase.click();
  assert.equal(await output.inputValue(), phraseText);
  await page
    .getByRole("button", { name: "Clear / সব মুছুন", exact: true })
    .click();
  await page.getByRole("button", { name: "A–Z keyboard", exact: true }).click();
  await page.locator('[data-gaze-target="letter-A"]').click();
  await page.locator('[data-gaze-target="letter-B"]').click();
  assert.equal(await output.inputValue(), "AB");
  await page.locator('[data-gaze-target="undo"]').click();
  assert.equal(await output.inputValue(), "A");
  await page.locator('[data-gaze-target="delete"]').click();
  assert.equal(await output.inputValue(), "");
  await page.locator('[data-gaze-target="undo"]').click();
  assert.equal(await output.inputValue(), "A");
  await page
    .getByRole("button", { name: "Start switch scanning", exact: true })
    .click();
  await contains(page.locator("[data-selection]"), /Switch scan: Space/);
  await page
    .getByRole("button", {
      name: "Select highlighted tile (Space)",
      exact: true,
    })
    .click();
  await page
    .getByRole("button", { name: "Stop scanning", exact: true })
    .click();
  assert.equal(await output.inputValue(), "A ");
  await page.getByRole("button", { name: "Focus view", exact: true }).click();
  assert.equal(
    await page.locator("[data-aac]").getAttribute("aria-modal"),
    "true",
  );
  await page.keyboard.press("Escape");
  assert.equal(
    await page.locator("[data-aac]").getAttribute("aria-modal"),
    null,
  );
  await page.locator("[data-language]").selectOption("bn");
  await page.getByRole("button", { name: "A–Z keyboard", exact: true }).click();
  await page.locator('[data-gaze-target="letter-আ"]').click();
  assert.ok((await output.inputValue()).endsWith("আ"));
  await page.locator("[data-camera]").click();
  await contains(page.locator("[data-status]"), /permission denied/i);
  assert.equal(await page.locator("[data-enable]").isDisabled(), true);
  await screenshot(page, "eyespeak-mobile");
  await noOverflow(page, "EyeSpeak mobile");
  await route(page, "move", "#moveExercise");
  await page
    .getByRole("button", { name: "Start camera and practice", exact: true })
    .click();
  await contains(page.locator(".move-controls"), /permission denied/i);
  await noOverflow(page, "Move mobile");
  console.log(
    "PASS EyeSpeak touch, English/Bangla letters, undo/delete, switch selection, focus escape, and graceful camera permission denial",
  );

  // Urgent templates must run offline even with cloud consent checked. No provider call is allowed.
  await route(page, "care", "#symptomForm");
  await page.locator("#careCloud").check();
  await page.context().setOffline(true);
  await page
    .locator("[name=symptoms]")
    .fill("I have chest pain and cannot breathe");
  await page
    .getByRole("button", { name: "Check guidance", exact: true })
    .click();
  await contains(page.locator("#careGuidance"), /Get urgent medical help now/);
  await page.locator("#careQuestion").fill("I have chest pain right now");
  await page.locator("#careChat button").click();
  await contains(page.locator("#careAnswer"), /Get urgent medical help now/);
  assert.equal(
    await page.locator("#careGuidance a").getAttribute("href"),
    "tel:999",
  );
  await page.locator("#language").selectOption("bn");
  await page.locator("#careQuestion").waitFor();
  await page.locator("#careCloud").check();
  await page
    .locator("#careQuestion")
    .fill("আমার বুকে ব্যথা এবং শ্বাস নিতে পারছি না");
  await page.locator("#careChat button").click();
  await contains(page.locator("#careAnswer"), /এখনই জরুরি চিকিৎসা সহায়তা নিন/);
  await screenshot(page, "care-urgent-bangla-mobile");
  assert.equal(
    unexpectedAPI.length,
    0,
    "Urgent guidance must not request /api/care or create cloud sessions.",
  );
  await page.context().setOffline(false);
  await page.locator("#language").selectOption("en");
  await page.locator("#symptomForm").waitFor();
  await noOverflow(page, "Care mobile");
  console.log(
    "PASS English and Bangla urgent guidance with browser offline and zero cloud API requests",
  );

  for (const name of [
    "home",
    "nutrition",
    "move",
    "eyespeak",
    "care",
    "privacy",
  ]) {
    await route(page, name, "#moduleHost > *");
    await noOverflow(page, `${name} light mobile`);
    await page.locator("#theme").click();
    await noOverflow(page, `${name} dark mobile`);
    await page.locator("#theme").click();
  }
  await route(page, "home", ".module-grid");
  await screenshot(page, "home-mobile");
  await page.locator("#theme").click();
  await screenshot(page, "home-mobile-dark");
  await page.locator("#theme").click();
  console.log("PASS Mobile dark/light layout without horizontal page overflow");

  // Real local clinic endpoint, with separate browser storage for each role.
  const admin = await newPage(),
    patient = await newPage({ width: 390, height: 844 }),
    clinician = await newPage();
  await admin.goto(BASE + "/everyday.html#clinic");
  await admin
    .getByLabel("Workspace name", { exact: true })
    .fill(`QA clinic ${nonce}`);
  await admin
    .getByLabel(
      "I want to create a capability-access clinic demo and keep its admin link private.",
      { exact: true },
    )
    .check();
  await admin
    .getByRole("button", { name: "Create workspace", exact: true })
    .click();
  await admin
    .getByRole("heading", { name: "Invite a person", exact: true })
    .waitFor();
  await contains(admin.locator(".clinic-workspace"), /Local preview/);
  await admin.getByLabel("Patient label", { exact: true }).fill("QA patient");
  await admin
    .getByRole("button", { name: "Create private invitation", exact: true })
    .click();
  const patientLink = await admin
    .getByLabel("Private invitation", { exact: true })
    .inputValue();
  await patient.goto(patientLink);
  await patient
    .getByRole("heading", {
      name: "Choose what this clinic may receive",
      exact: true,
    })
    .waitFor();
  assert.equal(
    new URL(patient.url()).hash,
    "#clinic",
    "Patient bearer is removed from the address immediately.",
  );
  activePage = admin;
  await admin.getByLabel("Role", { exact: true }).selectOption("clinician");
  await admin
    .getByRole("button", { name: "Create private invitation", exact: true })
    .click();
  await admin.waitForFunction(
    (previous) => document.querySelector("input[readonly]")?.value !== previous,
    patientLink,
  );
  const clinicianLink = await admin
    .getByLabel("Private invitation", { exact: true })
    .inputValue();
  await clinician.goto(clinicianLink);
  await clinician
    .getByRole("heading", {
      name: "Create an attested movement plan",
      exact: true,
    })
    .waitFor();
  assert.equal(new URL(clinician.url()).hash, "#clinic");
  await contains(
    clinician.locator(".clinic-workspace"),
    /No active sharing consent/,
  );

  await route(patient, "care", "#symptomForm");
  await patient.locator("[name=symptoms]").fill(journal);
  await patient.locator("#saveSymptom").click();
  await contains(patient.locator("#journalRows"), new RegExp(nonce));
  await route(patient, "clinic", ".clinic-workspace");
  await patient
    .getByRole("heading", {
      name: "Choose what this clinic may receive",
      exact: true,
    })
    .waitFor();
  const scopes = patient.getByRole("group", { name: "Explicit module scopes" });
  await scopes.getByLabel("Move", { exact: true }).check();
  await scopes.getByLabel("Care", { exact: true }).check();
  await patient
    .getByLabel(
      "I confirm these sharing scopes for this clinic for up to 30 days.",
      { exact: true },
    )
    .check();
  await patient
    .getByRole("button", { name: "Confirm sharing scopes", exact: true })
    .click();
  await patient.getByRole("checkbox", { name: /^Care · / }).waitFor();
  await patient.getByRole("checkbox", { name: /^Care · / }).check();
  await patient
    .getByLabel(
      "I reviewed these selected records and want to send copies to this clinic.",
      { exact: true },
    )
    .check();
  await patient
    .getByRole("button", { name: "Share selected records", exact: true })
    .click();
  await contains(
    patient.locator(".clinic-workspace > [role=status]"),
    /1 selected records shared/,
  );
  await noOverflow(patient, "Clinic patient mobile");
  await screenshot(patient, "clinic-patient-mobile");

  await clinician
    .getByRole("button", { name: "Refresh workspace", exact: true })
    .click();
  await clinician
    .getByLabel("Your name · self-declared", { exact: true })
    .waitFor();
  assert.ok(
    (await clinician.locator(".clinic-workspace").textContent()).includes(
      journal,
    ),
  );
  await clinician
    .getByLabel("Your name · self-declared", { exact: true })
    .fill("QA clinician");
  await clinician
    .getByLabel("Movement", { exact: true })
    .selectOption("knee-extension");
  for (const [label, value] of [
    ["Starting angle · degrees", "100"],
    ["Target angle · degrees", "150"],
    ["Return angle · degrees", "110"],
    ["Repetitions per set", "5"],
    ["Target hold · seconds", "0.5"],
  ])
    await clinician.getByLabel(label, { exact: true }).fill(value);
  await clinician.getByLabel(/^I attest that I am qualified/).check();
  await clinician
    .getByRole("button", { name: "Save attested plan", exact: true })
    .click();
  await contains(
    clinician.locator(".clinic-workspace > [role=status]"),
    /Plan saved/,
  );
  await screenshot(clinician, "clinic-clinician-desktop");
  await patient
    .getByRole("button", { name: "Refresh workspace", exact: true })
    .click();
  await patient
    .getByRole("button", { name: "Use this plan in Move", exact: true })
    .click();
  await route(patient, "move", "#moveMode");
  await patient.locator("#moveMode").selectOption("rehab");
  assert.equal(await patient.locator("#moveTarget").inputValue(), "150");
  assert.equal(await patient.locator("#moveGoal").inputValue(), "5");
  assert.equal(await patient.locator("#moveTarget").isDisabled(), true);
  await contains(patient.locator(".move-controls"), /QA clinician/);
  await screenshot(patient, "move-plan-mobile");

  await route(patient, "clinic", ".clinic-workspace");
  await patient
    .getByLabel(
      "I want to revoke all scopes and remove the clinic’s shared record copies.",
      { exact: true },
    )
    .check();
  await patient
    .getByRole("button", {
      name: "Revoke sharing and remove copies",
      exact: true,
    })
    .click();
  await contains(
    patient.locator(".clinic-workspace > [role=status]"),
    /Sharing revoked/,
  );
  await clinician
    .getByRole("button", { name: "Refresh workspace", exact: true })
    .click();
  await contains(
    clinician.locator(".clinic-workspace"),
    /No active sharing consent/,
  );
  assert.equal(
    (await clinician.locator(".clinic-workspace").textContent()).includes(
      journal,
    ),
    false,
  );
  assert.equal(
    await clinician
      .getByRole("button", { name: "Export plan", exact: true })
      .count(),
    0,
  );
  await admin
    .getByRole("button", { name: "Refresh workspace", exact: true })
    .click();
  await admin.getByText("Delete this workspace", { exact: true }).click();
  await admin
    .getByLabel("Type DELETE to confirm permanent deletion", { exact: true })
    .fill("DELETE");
  await admin
    .getByRole("button", { name: "Permanently delete workspace", exact: true })
    .click();
  await admin
    .getByRole("heading", { name: "Create a demo workspace", exact: true })
    .waitFor();
  await patient
    .getByRole("button", { name: "Refresh workspace", exact: true })
    .click();
  await contains(
    patient.locator(".clinic-workspace > [role=status]"),
    /expired or revoked|invitation/i,
  );
  console.log(
    "PASS Real local clinic admin/patient/clinician journeys: scoped record sharing, plan creation/import, revocation, deletion",
  );

  assert.deepEqual(errors, [], "No browser page errors.");
  assert.deepEqual(
    unexpectedAPI,
    [],
    "No provider calls or production API writes.",
  );
  console.log(
    "Everyday browser QA passed. No gaze/pose accuracy or clinical validation is asserted.",
  );
} catch (error) {
  if (activePage && !activePage.isClosed())
    await screenshot(activePage, "failure").catch(() => {});
  console.error("Everyday browser QA failed:", error.message);
  if (errors.length) console.error("Page errors:", errors);
  throw error;
} finally {
  for (const context of contexts) await context.close().catch(() => {});
  await browser.close();
}
