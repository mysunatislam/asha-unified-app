import { createRequire } from "node:module";
import assert from "node:assert/strict";
const require = createRequire(import.meta.url);
const {
  chromium,
} = require("C:/Users/user/.cache/codex-runtimes/codex-primary-runtime/dependencies/node/node_modules/playwright");
const base = process.env.EVERYDAY_TEST_URL || "http://127.0.0.1:4180";
assert.ok(["127.0.0.1", "localhost"].includes(new URL(base).hostname));
const browser = await chromium.launch({
  executablePath: "C:/Program Files/Google/Chrome/Application/chrome.exe",
  headless: true,
  args: ["--no-sandbox"],
});
try {
  const context = await browser.newContext();
  const page = await context.newPage(),
    errors = [];
  page.on("pageerror", (e) => errors.push(e.message));
  await page.goto(base + "/everyday.html#care");
  await page.locator("#symptomForm").waitFor();
  await page.evaluate(() => navigator.serviceWorker.ready);
  await page.waitForFunction(
    async () =>
      !!(await caches.open("asha-everyday-v1")).match(
        "/app/everyday/safety.js",
      ),
  );
  await context.setOffline(true);
  await page.reload();
  await page.locator("#symptomForm").waitFor();
  await page.locator("[name=symptoms]").fill("আমার বুকে ব্যথা");
  await page.locator("#symptomForm button").first().click();
  assert.match(
    await page.locator("#careGuidance").textContent(),
    /Get urgent medical help now/,
  );
  await page.locator("[data-route=nutrition]").click();
  await page.getByRole("heading", { name: "Nutrition", exact: true }).waitFor();
  assert.deepEqual(errors, []);
  console.log(
    "PASS Service worker cached shell reloads offline, urgent rules and independent Nutrition work without a server request.",
  );
  await context.close();
} finally {
  await browser.close();
}
