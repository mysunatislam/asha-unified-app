import test from "node:test";
import assert from "node:assert/strict";
import {
  evaluateSafety,
  safetyMessage,
  SAFETY_POLICY,
  emergencyContact,
} from "../app/everyday/safety.js";
import { createCareService, careContext } from "../server/care-service.js";
import { cleanupEveryday } from "../server/everyday-retention.js";
import { urgentCompanionResponse } from "../app/everyday/companion-safety.js";

test("Precautionary urgent reports include English, Bangla, code switching and common ASR errors", () => {
  for (const text of [
    "I have chest pain",
    "chset pian",
    "my chest feels tight; chest tightness",
    "আমার বুকে ব্যাথা",
    "আমার বুক ব্যথা",
    "amar buke betha",
    "শ্বাস নিতে পারছি না",
    "I can't breathe",
    "I feel faint",
    "she is unconscious",
    "cold sweating",
    "pain spreading to my arm",
  ]) {
    const r = evaluateSafety(text, { region: "BD" });
    assert.equal(r.level, "emergency", text);
    assert.equal(r.allowLLM, false);
    assert.equal(r.contact, "999");
    assert.equal(r.automaticContact, false);
  }
  assert.equal(SAFETY_POLICY.clinicalReview, "pending");
  assert.equal(SAFETY_POLICY.clinicalRelease, false);
});
test("Negation never hides a contradiction, uncertainty or structured warning flag", () => {
  for (const text of [
    "no chest pain",
    "বুকে ব্যথা নেই",
    "buke betha nai",
    "what is a heart attack?",
  ])
    assert.equal(evaluateSafety(text).allowLLM, true, text);
  for (const text of [
    "no chest pain but now chest pressure",
    "not sure if I have chest pain",
    "বুকে ব্যথা নেই কিন্তু শ্বাসকষ্ট হচ্ছে",
    "no chest pain; I feel faint",
  ])
    assert.equal(evaluateSafety(text).allowLLM, false, text);
  for (const redFlag of ["breathlessness", "fainting", "sweating", "radiating"])
    assert.equal(
      evaluateSafety("I feel okay", { redFlags: [redFlag] }).level,
      "emergency",
    );
  assert.equal(evaluateSafety("").level, "unknown");
  assert.equal(evaluateSafety("x".repeat(5000)).allowLLM, false);
  assert.equal(
    evaluateSafety("x".repeat(3000) + " chest pain").level,
    "emergency",
  );
});
test("Region-aware offline urgent templates never recommend an exercise or pretend to call", () => {
  assert.equal(emergencyContact("US"), "911");
  assert.equal(emergencyContact("IN"), "112");
  assert.equal(emergencyContact("OTHER"), null);
  const en = safetyMessage(evaluateSafety("chest pain", { region: "OTHER" }));
  assert.match(en, /local emergency number/);
  assert.match(en, /Do not wait/);
  assert.doesNotMatch(en, /I have called|raise your arm/i);
  assert.match(safetyMessage(evaluateSafety("বুকে ব্যথা"), "bn"), /999/);
});
test("Urgent Care requests and consent denial cannot reach a model", async () => {
  let calls = 0;
  const care = createCareService({
    ask: async () => {
      calls++;
      throw Error("must not call");
    },
  });
  const response = await care.explain({ text: "chest pain", consent: true });
  assert.equal(calls, 0);
  assert.equal(response.generated, false);
  assert.equal(response.safety.level, "emergency");
  await assert.rejects(
    care.explain({ text: "Help prepare for a routine visit", consent: false }),
    /consent/,
  );
  assert.equal(calls, 0);
});
test("Existing chat and speech clarification also stop at the same urgent preflight without creating a tool request", () => {
  const chat = urgentCompanionResponse("I have chest pain");
  assert.match(chat.reply, /urgent medical help/);
  assert.equal(chat.proposal, undefined);
  assert.equal(chat.orchestration.verified, false);
  const speech = urgentCompanionResponse("আমার বুকে ব্যথা", {
    mode: "interpret",
  });
  assert.equal(speech.candidate, "আমার বুকে ব্যথা");
  assert.match(speech.question, /999/);
  assert.equal(speech.language, "bn");
  assert.equal(urgentCompanionResponse("I need water"), null);
});
test("Care keeps selected provenance bounded and never treats another module as selected context", async () => {
  const row = {
    module: "care",
    consent_scope: "care",
    timestamp: "2026-11-10T00:00:00Z",
    value: {
      text: "a".repeat(2000),
      medications: "b".repeat(2000),
      secret: "never-share",
    },
    units: "entry",
    source: "user",
    model_id: "manual",
    model_version: "1",
    correction_status: "confirmed",
  };
  const context = careContext([
    row,
    { ...row, module: "nutrition" },
    ...Array(9).fill(row),
  ]);
  assert.equal(context.length, 5);
  assert.equal(context[0].value.text.length, 400);
  assert.equal(JSON.stringify(context).includes("never-share"), false);
  assert.equal(Date.parse(context[0].timestamp), Date.parse(row.timestamp));
  assert.equal(context[0].source, "user");
  let request;
  const care = createCareService({
    ask: async (input) => {
      request = input;
      return {
        text: JSON.stringify({
          reply:
            "Write down when this started. What would you like to discuss at your visit?",
        }),
        model: "configured-profile",
      };
    },
  });
  const response = await care.explain({
    text: "Help me prepare for my routine visit",
    context: [row],
    consent: true,
    language: "bn",
  });
  assert.equal(request.task, "bilingual");
  assert.match(request.query, /client-supplied/);
  assert.equal(response.generated, true);
});
test("Care model/network failures fall back and unsafe text cannot become verified guidance", async () => {
  for (const text of [
    "not JSON",
    JSON.stringify({ reply: "You are safe. I have called your doctor." }),
    JSON.stringify({ reply: "Take aspirin" }),
    JSON.stringify({ reply: "Raise your arms" }),
  ]) {
    const care = createCareService({
      ask: async () => ({ text, model: "test" }),
    });
    const result = await care.explain({
      text: "Routine visit preparation",
      consent: true,
    });
    assert.equal(result.generated, false);
    assert.equal(result.source, "local-safety-template");
  }
  const care = createCareService({
    ask: async () => {
      throw Error("secret upstream response");
    },
  });
  const result = await care.explain({
    text: "Routine visit preparation",
    consent: true,
  });
  assert.equal(result.cloudStatus, "unavailable");
  assert.equal(JSON.stringify(result).includes("secret"), false);
});
test("Everyday cleanup deletes expired clinic groups, shared copies and quota entries without touching active records", async () => {
  const now = Date.parse("2026-11-10T00:00:00Z"),
    data = new Map([
      [
        "asha-everyday/v1/clinics/old/profile.json",
        { expiresAt: "2026-10-01" },
      ],
      ["asha-everyday/v1/clinics/old/patients/1.json", { label: "old" }],
      [
        "asha-everyday/v1/clinics/live/profile.json",
        { expiresAt: "2026-12-01" },
      ],
      [
        "asha-everyday/v1/clinics/live/records/1/old.json",
        { sharedAt: "2026-09-01" },
      ],
      [
        "asha-everyday/v1/clinics/live/records/1/new.json",
        { sharedAt: "2026-11-09" },
      ],
      ["asha-everyday/limits/2026-11-09/test/id.json", {}],
    ]);
  const result = await cleanupEveryday(
    {
      list: async (p) => [...data.keys()].filter((k) => k.startsWith(p)),
      read: async (k) => data.get(k),
      remove: async (keys) => keys.forEach((k) => data.delete(k)),
    },
    now,
  );
  assert.equal(result.expiredClinicsRemoved, 1);
  assert.equal(result.everydayObjectsRemoved, 4);
  assert.equal(data.size, 2);
});
