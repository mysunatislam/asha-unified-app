// Read-only local UI check: mocked profile and APIs, no camera permission or inference.
import { createRequire } from "node:module";
import assert from "node:assert/strict";
import fs from "node:fs/promises";
const require = createRequire(import.meta.url);
const {
  chromium,
} = require("C:/Users/user/.cache/codex-runtimes/codex-primary-runtime/dependencies/node/node_modules/playwright");
await fs.mkdir("artifacts", { recursive: true });
const browser = await chromium.launch({
  headless: true,
  executablePath: "C:/Program Files/Google/Chrome/Application/chrome.exe",
});
const profile = {
  patientId: "studio-ui-test",
  label: "Studio UI verification",
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
const errors = [],
  checked = [];
try {
  for (const width of [390, 1440]) {
    const page = await browser.newPage({ viewport: { width, height: 960 } });
    page.on("pageerror", (error) => errors.push(error.message));
    await page.route("**/api/**", (route) =>
      route.fulfill({
        json: route.request().url().includes("/api/health")
          ? { cloudConfigured: true }
          : { profile, role: "patient", events: [], status: null },
      }),
    );
    await page.addInitScript(() => {
      localStorage.setItem(
        "asha_live_patient",
        JSON.stringify({
          patientId: "studio-ui-test",
          token: "only-a-local-ui-test",
        }),
      );
      window.cameraOpenCount = 0;
      Object.defineProperty(navigator.mediaDevices, "getUserMedia", {
        value: async () => {
          window.cameraOpenCount++;
          throw Error("Camera must remain off in the UI-only test");
        },
      });
    });
    await page.goto("http://127.0.0.1:4180/");
    await page.locator("#patient:not([hidden])").waitFor();
    await page.locator("#detailsButton").click();
    for (const theme of ["light", "dark"]) {
      if ((await page.locator("html").getAttribute("data-theme")) !== theme)
        await page.locator("#themeButton").click();
      assert.equal(
        await page.locator("html").getAttribute("data-theme"),
        theme,
      );
      await page.locator("[data-module=facespeak]").click();
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
          heading,
        );
      assert.equal(
        await page.evaluate(
          () => document.documentElement.scrollWidth > innerWidth,
        ),
        false,
        `Face overflow ${width} ${theme}`,
      );
      assert.equal(
        await page.locator("#nf-value-AU4").textContent(),
        "—",
        "Untracked muscle value must not pretend to be a measurement",
      );
      await page.screenshot({
        path: `artifacts/studio-face-${width}-${theme}.png`,
        fullPage: true,
      });
      await page.locator("[data-module=fingerspeak]").click();
      const frame = page.frameLocator("#fingerStudio");
      await frame
        .getByRole("heading", { name: "Gesture vocabulary", exact: true })
        .waitFor();
      await page.waitForFunction(
        (desired) =>
          document.getElementById("fingerStudio")?.contentDocument
            ?.documentElement.dataset.theme === desired,
        theme,
      );
      for (const [tab, heading] of [
        ["calibrate", "Gesture vocabulary"],
        ["speak", "Speak mode"],
        ["evaluate", "Model evaluation"],
        ["log", "Spoken log"],
      ]) {
        await frame.locator(`[data-tab="${tab}"]`).click();
        assert.equal(
          await frame
            .getByRole("heading", { name: heading, exact: true })
            .isVisible(),
          true,
          heading,
        );
        assert.equal(
          await frame
            .locator("body")
            .evaluate(() => document.documentElement.scrollWidth > innerWidth),
          false,
          `Finger inner overflow ${width} ${theme} ${tab}`,
        );
        assert.equal(
          await page.evaluate(
            () => document.documentElement.scrollWidth > innerWidth,
          ),
          false,
          `Finger outer overflow ${width} ${theme} ${tab}`,
        );
      }
      await frame.locator('[data-tab="calibrate"]').click();
      await page.screenshot({
        path: `artifacts/studio-finger-${width}-${theme}.png`,
        fullPage: true,
      });
      // Module navigation must hide the original studio, not reload its model/session.
      const marker = `retained-${width}-${theme}`;
      await page.evaluate((value) => {
        const iframe = document.getElementById("fingerStudio");
        window.studioUiReference = {
          iframe,
          document: iframe.contentDocument,
          window: iframe.contentWindow,
        };
        iframe.contentDocument.body.dataset.persistenceProbe = value;
      }, marker);
      await frame.locator("#backToFace").click();
      await page.getByRole("heading", { name: /Head Movement/ }).waitFor();
      assert.equal(await page.locator("#fingerStudioHost").isVisible(), false);
      await page.locator("[data-module=fingerspeak]").click();
      await frame
        .getByRole("heading", { name: "Gesture vocabulary", exact: true })
        .waitFor();
      assert.equal(
        await page.evaluate((value) => {
          const iframe = document.getElementById("fingerStudio");
          return (
            iframe === window.studioUiReference.iframe &&
            iframe.contentDocument === window.studioUiReference.document &&
            iframe.contentWindow === window.studioUiReference.window &&
            iframe.contentDocument.body.dataset.persistenceProbe === value
          );
        }, marker),
        true,
        "FingerSpeak model/session context must survive switching modules",
      );
      checked.push({
        width,
        theme,
        faceModules: 7,
        fingerTabs: 4,
        fingerBackNavigatesParent: true,
        fingerFramePreservedOnReturn: true,
        noOverflow: true,
      });
    }
    assert.equal(await page.evaluate(() => window.cameraOpenCount), 0);
    await page.close();
  }
  assert.deepEqual(errors, []);
  console.log(
    JSON.stringify({
      uiOnly: true,
      noCameraOpened: true,
      checked,
      applicationErrors: errors,
    }),
  );
} finally {
  await browser.close();
}
