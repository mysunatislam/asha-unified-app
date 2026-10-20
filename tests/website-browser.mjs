import { createRequire } from "node:module";
import fs from "node:fs/promises";
import assert from "node:assert/strict";
const require = createRequire(import.meta.url);
const {
  chromium,
} = require("C:/Users/user/.cache/codex-runtimes/codex-primary-runtime/dependencies/node/node_modules/playwright");
const websiteBase = new URL(
    process.env.ASHA_WEBSITE_BASE || "http://127.0.0.1:4180/website/",
  ),
  appBase = new URL(process.env.ASHA_TEST_BASE || "http://127.0.0.1:4180/"),
  productionApp = new URL("https://neurobridge-asha-live.vercel.app/");

function assertAppLink(href, module) {
  const target = new URL(href, websiteBase);
  assert.equal(
    target.origin,
    productionApp.origin,
    "website links must open the production app",
  );
  assert.equal(
    target.pathname,
    "/",
    "website links must use the app's root entry",
  );
  if (module) assert.equal(target.searchParams.get("module"), module);
  return target;
}
const browser = await chromium.launch({
  headless: true,
  executablePath: "C:/Program Files/Google/Chrome/Application/chrome.exe",
});
const page = await browser.newPage({ viewport: { width: 1440, height: 1000 } }),
  errors = [],
  requests = [];
page.on("pageerror", (e) => errors.push(e.message));
page.on("request", (r) => requests.push(r.url()));
await fs.mkdir("artifacts/summit", { recursive: true });
try {
  await page.goto(websiteBase.href, { waitUntil: "networkidle" });
  await page
    .getByRole("heading", { level: 1, name: /A little support/ })
    .waitFor();
  const resources = await page.evaluate(() =>
    performance.getEntriesByType("resource").map((r) => ({
      url: r.name,
      bytes: r.transferSize,
      duration: Math.round(r.duration),
    })),
  );
  assert.equal(
    requests.some((url) =>
      /\/api\/|vision_bundle|\.task|\.wasm|app\/main/.test(url),
    ),
    false,
    "public website must not start the app or camera models",
  );
  const appLinks = await page
    .locator('a[href^="https://neurobridge-asha-live.vercel.app/"]')
    .evaluateAll((links) => links.map((link) => link.getAttribute("href")));
  assert.ok(
    appLinks.length >= 7,
    "website entry and capability links must point to the production app",
  );
  appLinks.forEach((href) => assertAppLink(href));
  const localAppLinks = await page.locator("a[href]").evaluateAll((links) =>
    links
      .map((link) => new URL(link.href))
      .filter(
        (target) =>
          target.origin === location.origin &&
          /^\/app(?:\/|\.html|$)/.test(target.pathname),
      )
      .map((target) => target.href),
  );
  assert.deepEqual(
    localAppLinks,
    [],
    "the separate website must not send visitors to its own /app",
  );
  await page.screenshot({
    path: "artifacts/summit/desktop-light.png",
    fullPage: true,
  });
  await page.screenshot({ path: "artifacts/summit/hero-desktop.png" });
  for (const id of ["face", "hand", "speech", "vitals", "posture"]) {
    await page.locator(`#tab-${id}`).click();
    assert.equal(
      await page.locator("#capability-panel").getAttribute("aria-labelledby"),
      `tab-${id}`,
    );
    assertAppLink(
      await page.locator("#capability-link").getAttribute("href"),
      {
        face: "facespeak",
        hand: "fingerspeak",
        speech: "senseassist",
        vitals: "vitalsense",
        posture: "posture",
      }[id],
    );
  }
  await page.locator("#tab-face").focus();
  await page.keyboard.press("ArrowRight");
  assert.equal(
    await page.locator("#tab-hand").getAttribute("aria-selected"),
    "true",
  );
  await page.locator("#siteTheme").click();
  assert.equal(await page.locator("html").getAttribute("data-theme"), "dark");
  await page.screenshot({
    path: "artifacts/summit/desktop-dark.png",
    fullPage: true,
  });
  const layouts = [];
  for (const width of [360, 390, 768, 1024, 1440]) {
    await page.setViewportSize({ width, height: 844 });
    if (
      await page.evaluate(
        () => document.documentElement.scrollWidth > innerWidth,
      )
    )
      console.log(
        await page.evaluate(() =>
          [...document.querySelectorAll("body *")]
            .map((e) => ({
              tag: e.tagName,
              cls: e.className,
              left: e.getBoundingClientRect().left,
              right: e.getBoundingClientRect().right,
            }))
            .filter((e) => e.right > innerWidth + 1 || e.left < -1),
        ),
      );
    assert.equal(
      await page.evaluate(
        () => document.documentElement.scrollWidth > innerWidth,
      ),
      false,
      `overflow at ${width}`,
    );
    layouts.push(width);
  }
  await page.setViewportSize({ width: 390, height: 844 });
  await page.locator("#siteMenu").click();
  assert.equal(
    await page.locator("#siteMenu").getAttribute("aria-expanded"),
    "true",
  );
  await page.keyboard.press("Escape");
  assert.equal(
    await page.locator("#siteMenu").getAttribute("aria-expanded"),
    "false",
  );
  await page.locator("#siteTheme").click();
  await page.locator("#tab-face").click();
  await page.evaluate(() => scrollTo(0, 0));
  await page.screenshot({
    path: "artifacts/summit/mobile-light.png",
    fullPage: true,
  });
  await page.screenshot({ path: "artifacts/summit/hero-mobile.png" });
  await page.locator("#siteTheme").click();
  await page.screenshot({
    path: "artifacts/summit/mobile-dark.png",
    fullPage: true,
  });
  await page.route("**/api/health", (r) =>
    r.fulfill({ json: { cloudConfigured: false } }),
  );
  await page.route("**/api/session**", (r) =>
    r.fulfill({ status: 503, json: { error: "Local UI fixture" } }),
  );
  const appEntry = assertAppLink(
    await page.getByRole("link", { name: "Try Asha" }).getAttribute("href"),
  );
  // Assert the public destination above, then use the configured app origin so
  // local QA never sends a browser to production or modifies production data.
  await page.goto(
    new URL(appEntry.pathname + appEntry.search + appEntry.hash, appBase).href,
  );
  await page.locator("#exploreDemo").waitFor();
  await page.locator("#exploreDemo").click();
  try {
    await page.locator("#details:not([hidden])").waitFor();
  } catch (e) {
    console.log(
      await page.evaluate(() => ({
        url: location.href,
        ready: document.readyState,
        handler: !!document.getElementById("exploreDemo")?.onclick,
        button: document.getElementById("exploreDemo")?.textContent,
        toast: document.getElementById("toast")?.textContent,
        views: [...document.querySelectorAll(".view")]
          .filter((e) => !e.hidden)
          .map((e) => e.id),
      })),
    );
    throw e;
  }
  for (const module of [
    "facespeak",
    "fingerspeak",
    "vitalsense",
    "senseassist",
    "posture",
  ]) {
    await page.locator(`#moduleTabs [data-module="${module}"]`).click();
    assert.equal(
      await page.evaluate(
        () => document.documentElement.scrollWidth > innerWidth,
      ),
      false,
      `module overflow ${module}`,
    );
  }
  await page.goto(new URL("?module=facespeak", appBase).href);
  await page.locator("#details:not([hidden])").waitFor();
  await page
    .getByRole("heading", { name: "NeuroFace Sense", exact: true })
    .waitFor();
  assert.deepEqual(errors, []);
  const report = {
    layouts,
    publicPageLoadsNoApp: true,
    separateWebsiteLinksToProductionApp: true,
    keyboardTabs: true,
    allModules: true,
    legacyModuleLink: true,
    errors,
    resources,
  };
  await fs.writeFile(
    "artifacts/summit/website-qa.json",
    JSON.stringify(report, null, 2),
  );
  console.log(JSON.stringify(report));
} finally {
  await browser.close();
}
