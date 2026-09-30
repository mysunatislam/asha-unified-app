// Browser regression for Asha's model routing context and patient-approved actions.
import assert from "node:assert/strict";
import { createRequire } from "node:module";

const require = createRequire(import.meta.url);
const {
  chromium,
} = require("C:/Users/user/.cache/codex-runtimes/codex-primary-runtime/dependencies/node/node_modules/playwright");
const base = process.env.ASHA_TEST_BASE || "http://127.0.0.1:4180/";
const patientId = "0123456789abcdef01234567";
const profile = {
  patientId,
  label: "Demo patient",
  assessment: {
    leftHand: "reliable",
    rightHand: "reliable",
    wrist: "reliable",
    fingers: "reliable",
    eyes: "reliable",
    lips: "reliable",
    head: "reliable",
    speech: "limited",
    canSee: true,
    canHear: true,
  },
  supportContext: { categories: [], goals: [], note: "" },
  recommendation: {
    primary: "senseassist",
    suggested: ["senseassist", "facespeak", "fingerspeak"],
  },
  voice: { name: "", rate: 0.9 },
};
const poison = '<img src=x onerror="window.__sourceExecuted=true">';
const browser = await chromium.launch({
  headless: true,
  executablePath: "C:/Program Files/Google/Chrome/Application/chrome.exe",
});
const page = await browser.newPage({ viewport: { width: 390, height: 844 } });
const errors = [],
  aiRequests = [],
  events = [];
page.on("pageerror", (error) => errors.push(error.message));

try {
  await page.route("**/api/session**", (route) => {
    const body = route.request().postDataJSON();
    if (body?.action === "create") {
      return route.fulfill({
        json: {
          ...profile,
          patientToken: "demo-patient-token",
          caregiverToken: "demo-caregiver-token",
        },
      });
    }
    if (body?.action === "event") events.push(body);
    return route.fulfill({
      json: { profile, role: "patient", events: [], status: null },
    });
  });
  await page.route("**/api/health", (route) =>
    route.fulfill({ json: { cloudConfigured: true } }),
  );
  await page.route("**/api/asha", (route) => {
    const body = route.request().postDataJSON();
    aiRequests.push(body);
    if (body.mode === "interpret") {
      return route.fulfill({
        json: {
          candidate: "red rabbit green",
          alternatives: ["red rabbit green"],
          question: "Is that what you meant?",
          language: "en",
          sources: [{ title: "Confirmed speech", text: poison }],
          orchestration: {
            task: "speech",
            model: "gpt-5.6-sol",
            verified: true,
            steps: [{ tool: "retrieve_knowledge", status: "completed" }],
          },
        },
      });
    }
    if (body.text === "I need water") {
      return route.fulfill({
        json: {
          reply: "I heard that you need water. Shall I ask your caregiver?",
          proposal: { kind: "water", text: "I need water" },
          sources: [{ title: poison, text: poison, source: poison }],
          orchestration: {
            task: "bilingual",
            model: "claude-opus-4-8",
            verified: true,
            steps: [{ tool: "verify_tool_calls", status: "completed" }],
          },
        },
      });
    }
    return route.fulfill({
      json: {
        reply: "All set.",
        proposal: { kind: "help", text: "Please come here" },
        orchestration: {
          task: "bilingual",
          model: "claude-opus-4-8",
          verified: false,
          steps: [],
        },
      },
    });
  });
  await page.goto(base + "?module=senseassist");
  await page.locator("#details:not([hidden])").waitFor();
  assert.match(await page.locator("body").innerText(), /SenseAssist/);
  assert.equal(
    await page.locator("[data-nextjs-dialog], .vite-error-overlay").count(),
    0,
  );

  await page.locator("#settingsButton").click();
  await page.locator("#ashaLanguage").selectOption("mixed");
  await page.locator("#cloudConsent").check();
  await page.locator("#settingsBack").click();
  await page.locator("#bubbleHandle").click();
  await page.locator("#chatInput").fill("Hi!");
  await page.locator("#chatForm button").click();
  await page.waitForFunction(() =>
    document.getElementById("chatMessages").textContent.includes("Hi, I'm Asha."),
  );
  assert.equal(aiRequests.length, 0, "simple greeting must not wait for the AI API");
  assert.equal(events.length, 0, "greeting must never create a caregiver event");
  await page.locator("#chatInput").fill("I need water");
  await page.locator("#chatForm button").click();
  await page.waitForFunction(
    () => document.getElementById("confirmDialog").open,
  );
  assert.equal(
    events.length,
    0,
    "AI proposal must not send a caregiver event before confirmation",
  );
  assert.equal(aiRequests[0].language, "mixed");
  assert.equal(aiRequests[0].mode, "chat");
  assert.deepEqual(aiRequests[0].confirmedMemories, []);
  assert.equal(
    await page.locator("#chatMessages img").count(),
    0,
    "retrieval text must render as text, not HTML",
  );
  assert.equal(await page.evaluate(() => window.__sourceExecuted), undefined);
  assert.match(
    await page.locator("#chatMessages details").first().textContent(),
    /claude-opus-4-8/,
  );
  await page.waitForTimeout(700); // RequestGate requires a deliberate confirmation interval.
  await page.locator("#confirmYes").click();
  await page.waitForFunction(() =>
    document.getElementById("latestRequest").textContent.includes("Sent"),
  );
  assert.equal(events.length, 1);
  assert.equal(events[0].kind, "water");
  assert.equal(events[0].source, "asha");
  assert.equal(events[0].confirmed, true);

  await page.locator("#chatInput").fill("Check my status");
  await page.locator("#chatForm button").click();
  await page.waitForFunction(() =>
    document.getElementById("chatMessages").textContent.includes("All set."),
  );
  assert.equal(
    await page.locator("#confirmDialog").evaluate((dialog) => dialog.open),
    false,
  );
  assert.equal(
    await page
      .locator("#chatMessages button")
      .filter({ hasText: "Review caregiver request" })
      .count(),
    1,
    "only the earlier verified response should have a review button",
  );
  assert.equal(
    events.length,
    1,
    "unverified tool output must not send an event",
  );

  await page.evaluate(
    (id) =>
      localStorage.setItem(
        "asha_live_speech_" + id,
        JSON.stringify([
          { heard: "wed wabbit", confirmedText: "red rabbit", confirmed: true },
          {
            heard: "unreviewed phrase",
            confirmedText: "invented meaning",
            confirmed: false,
          },
          { heard: "legacy", confirmed: "reviewed legacy wording" },
        ]),
      ),
    patientId,
  );
  await page.locator("#closeChat").click();
  await page.locator("#speechLanguage").selectOption("bn-BD");
  await page.locator("#heardSpeech").fill("wed wabbit wghreen");
  await page.locator("#interpretSpeech").click();
  await page.locator("#speakCandidate").waitFor();
  const speechRequest = aiRequests.at(-1);
  assert.equal(speechRequest.mode, "interpret");
  assert.equal(speechRequest.language, "mixed");
  assert.deepEqual(
    speechRequest.confirmedMemories.map(({ heard, confirmedText }) => [
      heard,
      confirmedText,
    ]),
    [
      ["wed wabbit", "red rabbit"],
      ["legacy", "reviewed legacy wording"],
    ],
  );
  assert.equal(await page.locator("#speechResult img").count(), 0);
  assert.equal(await page.evaluate(() => window.__sourceExecuted), undefined);
  await page.locator("#speakCandidate").click();
  const memories = await page.evaluate(
    (id) => JSON.parse(localStorage.getItem("asha_live_speech_" + id)),
    patientId,
  );
  assert.deepEqual(memories.at(-1), {
    heard: "wed wabbit wghreen",
    confirmedText: "red rabbit green",
    confirmed: true,
  });
  assert.deepEqual(errors, []);
  console.log(
    JSON.stringify({
      base,
      language: aiRequests[0].language,
      calls: aiRequests.length,
      confirmedEvents: events.length,
      speechMemoriesSent: speechRequest.confirmedMemories.length,
      unsafeSourceRenderedAsText: true,
      errors,
    }),
  );
} finally {
  await browser.close();
}
