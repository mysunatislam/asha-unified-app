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
async function assertTeamAvatars(page, viewportWidth) {
  const avatars = await page.locator(".team-avatar").evaluateAll((items) =>
    items.map((item) => {
      const box = item.getBoundingClientRect(),
        style = getComputedStyle(item);
      return {
        width: box.width,
        height: box.height,
        radii: [
          style.borderTopLeftRadius,
          style.borderTopRightRadius,
          style.borderBottomRightRadius,
          style.borderBottomLeftRadius,
        ],
        portraits: item.querySelectorAll("img.team-photo").length,
      };
    }),
  );
  assert.equal(
    avatars.length,
    3,
    `three circular portraits at ${viewportWidth}px`,
  );
  for (const avatar of avatars) {
    assert.equal(
      avatar.portraits,
      1,
      "each avatar wraps one supplied portrait",
    );
    assert.ok(
      avatar.width > 0 && avatar.width <= 120,
      `small avatar at ${viewportWidth}px`,
    );
    assert.ok(
      Math.abs(avatar.width - avatar.height) < 0.5,
      "avatar must be square",
    );
    assert.ok(
      avatar.radii.every(
        (radius) =>
          parseFloat(radius) >= (radius.includes("%") ? 50 : avatar.width / 2),
      ),
      "avatar must have a circular border radius",
    );
  }
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
  for (const id of ["hardware", "plans", "contact"]) {
    const section = page.locator(`#${id}`);
    assert.equal(await section.count(), 1, `${id} needs a unique section`);
    assert.ok(
      await section.locator("h2, h3").first().isVisible(),
      `${id} needs a visible heading`,
    );
    assert.ok(
      (await page.locator(`a[href="#${id}"]`).count()) > 0,
      `${id} needs a working navigation or call-to-action anchor`,
    );
  }
  const hardware = await page.locator("#hardware").innerText();
  for (const component of [/camera/i, /switch/i, /mount/i])
    assert.match(
      hardware,
      component,
      "the optional kit should explain its components",
    );
  assert.match(hardware, /optional/i, "the kit must remain optional");
  assert.match(hardware, /\$\s*100\b/, "show the planned one-time kit price");
  assert.match(
    hardware,
    /phone|tablet/i,
    "explain which main device is needed",
  );
  assert.match(
    hardware,
    /not included|excluded/i,
    "the main device is excluded from the kit",
  );
  assert.match(
    hardware,
    /subscription.{0,100}separate|separate.{0,100}subscription/is,
  );
  const plans = await page.locator("#plans").innerText();
  assert.match(
    plans,
    /planned|proposed/i,
    "pricing must be described as planned",
  );
  assert.match(plans, /ASHA\s+PLUS/i);
  assert.match(plans, /ASHA\s+PRO/i);
  assert.match(plans, /\$\s*5\b/);
  assert.match(plans, /\$\s*12\b/);
  assert.match(plans, /month|monthly/i);
  const portraits = page.locator("img.team-photo");
  assert.equal(
    await portraits.count(),
    3,
    "show the three supplied team portraits",
  );
  for (const portrait of await portraits.all()) {
    assert.ok(
      (await portrait.getAttribute("alt"))?.trim(),
      "team portraits need nonempty alternative text",
    );
    await portrait.scrollIntoViewIfNeeded();
    await page.waitForFunction(
      (image) => image.complete,
      await portrait.elementHandle(),
      { timeout: 15000 },
    );
    assert.ok(
      await portrait.evaluate(
        (image) => image.complete && image.naturalWidth > 0,
      ),
      "each supplied portrait must load successfully",
    );
  }
  const enquiry = page.locator("#contactForm");
  assert.equal(
    await enquiry.count(),
    1,
    "contact must provide one enquiry form",
  );
  assert.equal(await enquiry.evaluate((form) => form.checkValidity()), false);
  assert.equal(
    await page.locator("#enquiryEmail").getAttribute("type"),
    "email",
  );
  assert.equal(
    await page.locator("#enquiryConsent").getAttribute("type"),
    "checkbox",
  );
  assert.ok(
    (await page.locator("#enquiryConsent").getAttribute("required")) !== null,
  );
  assert.equal(
    await page.locator("#whatsappEnquiry").getAttribute("type"),
    "button",
  );
  assert.ok(
    (await page
      .locator('#contact a[href="mailto:mysunatislam@gmail.com"]')
      .count()) > 0,
    "show the team's confirmed public email",
  );
  assert.ok(
    (await page.locator('#contact a[href="tel:+8801641576801"]').count()) > 0,
    "show the team's confirmed public phone number",
  );
  const draftNotice = await page.locator("#contactStatus").innerText();
  assert.match(
    draftNotice,
    /draft/i,
    "the enquiry flow must say that it opens a draft",
  );
  assert.match(
    draftNotice,
    /not\s+sent|nothing.{0,40}sent|not.{0,40}confirm|confirmation.{0,60}reply/is,
    "the enquiry flow must not claim that opening a draft sends or confirms a booking",
  );
  for (const interest of ["demo", "kit", "hospital", "homecare"]) {
    const cta = page.locator(`[data-enquiry-interest="${interest}"]`).first();
    assert.ok(await cta.count(), `${interest} needs an enquiry call-to-action`);
    await cta.click();
    assert.equal(await page.locator("#enquiryInterest").inputValue(), interest);
  }
  await page.locator("#enquiryName").fill("Website QA");
  await page.locator("#enquiryEmail").fill("qa@example.invalid");
  await page.locator("#enquiryOrganisation").fill("Local browser verification");
  await page
    .locator("#enquiryMessage")
    .fill("Test enquiry draft; do not send.");
  assert.equal(
    await enquiry.evaluate((form) => form.checkValidity()),
    false,
    "enquiry consent must be required",
  );
  await page.locator("#enquiryConsent").check();
  assert.equal(await enquiry.evaluate((form) => form.checkValidity()), true);
  assert.equal(await page.locator("#contactStatus").innerText(), draftNotice);
  // Capture the browser handoff without opening WhatsApp or sending anything.
  await page.evaluate(() => {
    window.websiteDraftUrls = [];
    window.open = (url, target, features) => {
      window.websiteDraftUrls.push({ url, target, features });
      return null;
    };
  });
  await page.locator("#whatsappEnquiry").click();
  const handoff = await page.evaluate(() => window.websiteDraftUrls);
  assert.equal(handoff.length, 1);
  const whatsapp = new URL(handoff[0].url);
  assert.equal(whatsapp.origin, "https://wa.me");
  assert.equal(whatsapp.pathname, "/8801641576801");
  assert.match(whatsapp.searchParams.get("text"), /Website QA/);
  assert.match(whatsapp.searchParams.get("text"), /not a confirmed booking/);
  assert.match(
    await page.locator("#contactStatus").innerText(),
    /nothing has been sent/i,
  );
  assert.equal(handoff[0].features, "noopener,noreferrer");
  await enquiry.evaluate((form) => form.reset());
  assert.equal(await page.locator("#contactStatus").innerText(), draftNotice);
  await page.evaluate(() => scrollTo(0, 0));
  await page.screenshot({
    path: "artifacts/summit/desktop-light.png",
    fullPage: true,
  });
  await page.screenshot({ path: "artifacts/summit/hero-desktop.png" });
  for (const id of ["hardware", "plans", "team", "contact"])
    await page
      .locator(`#${id}`)
      .screenshot({ path: `artifacts/summit/${id}-desktop.png` });
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
    await assertTeamAvatars(page, width);
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
  for (const id of ["hardware", "plans", "team", "contact"])
    await page
      .locator(`#${id}`)
      .screenshot({ path: `artifacts/summit/${id}-mobile.png` });
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
    hardwarePlansAndContactSections: true,
    suppliedTeamPortraitsLoaded: true,
    smallCircularTeamPortraitsAtAllWidths: true,
    enquiryRequiresConsentAndDisclosesDraftOnly: true,
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
