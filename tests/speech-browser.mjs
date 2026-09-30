// SenseAssist regression: a longer listening window must never transcribe Asha's own voice.
// Uses simulated Web Speech APIs only; no microphone, patient data, or external AI calls.
import assert from "node:assert/strict";
import { createRequire } from "node:module";

const require = createRequire(import.meta.url);
const {
  chromium,
} = require("C:/Users/user/.cache/codex-runtimes/codex-primary-runtime/dependencies/node/node_modules/playwright");
const base = process.env.ASHA_TEST_BASE || "http://127.0.0.1:4180/";
const patientId = "speech-browser-patient";
const profile = {
  patientId,
  label: "Speech test patient",
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
  recommendation: { primary: "senseassist", suggested: ["senseassist"] },
  voice: { name: "", rate: 0.9 },
};

const browser = await chromium.launch({
  headless: true,
  executablePath: "C:/Program Files/Google/Chrome/Application/chrome.exe",
});
const page = await browser.newPage({ viewport: { width: 390, height: 844 } });
const errors = [];
page.on("pageerror", (error) => errors.push(error.message));

try {
  await page.route("**/api/session**", (route) => {
    const body = route.request().postDataJSON();
    if (body?.action === "create") {
      return route.fulfill({
        json: {
          ...profile,
          patientToken: "speech-test-patient-token",
          caregiverToken: "speech-test-caregiver-token",
        },
      });
    }
    return route.fulfill({
      json: { profile, role: "patient", events: [], status: null },
    });
  });
  await page.route("**/api/health", (route) =>
    route.fulfill({ json: { cloudConfigured: true } }),
  );
  await page.addInitScript(() => {
    localStorage.setItem(
      "asha_live_settings",
      JSON.stringify({
        theme: "dark",
        cloud: false,
        proactive: false,
        scan: false,
        voice: "",
        rate: 0.9,
        language: "auto",
        speechLanguage: "en-US",
      }),
    );
    const mock = {
      instances: [],
      starts: 0,
      stops: 0,
      aborts: 0,
      utterances: [],
      result(transcript, instance = this.instances.at(-1)) {
        instance?.onresult?.({
          resultIndex: 0,
          results: [{ isFinal: true, 0: { transcript } }],
        });
      },
      end(instance = this.instances.at(-1)) {
        if (!instance) return;
        instance.active = false;
        instance.onend?.();
      },
      finishVoice() {
        const utterance = this.utterances.at(-1);
        window.speechSynthesis.speaking = false;
        utterance?.onend?.();
      },
    };
    class FakeSpeechRecognition {
      constructor() {
        this.active = false;
        mock.instances.push(this);
      }
      start() {
        if (this.active)
          throw new DOMException("already started", "InvalidStateError");
        this.active = true;
        mock.starts++;
        this.onstart?.();
      }
      stop() {
        mock.stops++;
        this.active = false;
        queueMicrotask(() => this.onend?.());
      }
      abort() {
        mock.aborts++;
        this.active = false;
        queueMicrotask(() => this.onend?.());
      }
    }
    Object.defineProperty(window, "SpeechRecognition", {
      configurable: true,
      value: FakeSpeechRecognition,
    });
    Object.defineProperty(window, "webkitSpeechRecognition", {
      configurable: true,
      value: FakeSpeechRecognition,
    });
    Object.defineProperty(window, "speechSynthesis", {
      configurable: true,
      value: {
        speaking: false,
        getVoices: () => [],
        cancel() {
          this.speaking = false;
        },
        speak(utterance) {
          this.speaking = true;
          mock.utterances.push(utterance);
        },
      },
    });
    window.__speechMock = mock;
  });

  await page.goto(base + "?module=senseassist");
  await page.locator("#details:not([hidden])").waitFor();
  await page
    .getByRole("heading", { name: "SenseAssist", exact: true })
    .waitFor();
  await page.locator("#listenSpeech").click();
  await page.waitForFunction(() => window.__speechMock.starts >= 1);
  assert.match(await page.locator("#speechStatus").textContent(), /90 seconds/);
  assert.equal(await page.locator("#stopSpeech").isEnabled(), true);
  assert.deepEqual(
    await page.evaluate(() => {
      const recognition = window.__speechMock.instances[0];
      return [
        recognition.continuous,
        recognition.interimResults,
        recognition.lang,
      ];
    }),
    [true, true, "en-US"],
  );

  // Browsers can end a recognition segment well before the patient is finished.
  await page.evaluate(() => window.__speechMock.end());
  await page.waitForFunction(() => window.__speechMock.starts >= 2);
  assert.equal(await page.locator("#stopSpeech").isEnabled(), true);

  await page.locator("#speechTarget").fill("red rabbit green");
  await page.locator("#hearTarget").click();
  await page.waitForFunction(() => window.__speechMock.utterances.length === 1);
  const paused = await page.evaluate(() => ({
    starts: window.__speechMock.starts,
    active: window.__speechMock.instances.some((instance) => instance.active),
  }));
  assert.equal(
    paused.active,
    false,
    "Asha's spoken phrase should pause recognition",
  );
  await page.evaluate(() => window.__speechMock.result("red rabbit green"));
  assert.equal(
    await page.locator("#heardSpeech").inputValue(),
    "",
    "a late result recorded during Asha's speech must be discarded",
  );
  await page.evaluate(() => window.__speechMock.finishVoice());
  await page.waitForFunction(
    (starts) => window.__speechMock.starts > starts,
    paused.starts,
  );
  await page.evaluate(() => window.__speechMock.result("wed wabbit wghreen"));
  assert.equal(
    await page.locator("#heardSpeech").inputValue(),
    "wed wabbit wghreen",
    "patient speech should be accepted after Asha finishes",
  );

  await page.locator("#stopSpeech").click();
  await page.waitForFunction(
    () => document.getElementById("stopSpeech")?.disabled === true,
  );
  const stoppedStarts = await page.evaluate(() => window.__speechMock.starts);
  await page.evaluate(() => window.__speechMock.end());
  await page.waitForTimeout(800);
  assert.equal(
    await page.evaluate(() => window.__speechMock.starts),
    stoppedStarts,
    "manual Stop must cancel pending recognition restarts",
  );

  await page.locator("#listenSpeech").click();
  await page.waitForFunction(
    (starts) => window.__speechMock.starts > starts,
    stoppedStarts,
  );
  await page.locator("#details [data-view=patient]").click();
  await page.locator("#patient:not([hidden])").waitFor();
  const exitedStarts = await page.evaluate(() => window.__speechMock.starts);
  await page.evaluate(() => window.__speechMock.end());
  await page.waitForTimeout(800);
  assert.equal(
    await page.evaluate(() => window.__speechMock.starts),
    exitedStarts,
    "leaving SenseAssist must cancel pending recognition restarts",
  );
  assert.deepEqual(errors, []);
  console.log(
    JSON.stringify({
      base,
      segmentRestart: true,
      voiceEchoDiscarded: true,
      patientSpeechAccepted: true,
      stopAndExitCancelRestart: true,
      errors,
    }),
  );
} finally {
  await browser.close();
}
