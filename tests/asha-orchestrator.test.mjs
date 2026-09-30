import assert from "node:assert/strict";
import test from "node:test";
import {
  createAshaOrchestrator,
  resolveLanguage,
  selectAshaTask,
} from "../server/asha-orchestrator.js";

const profile = {
  assessment: { eyes: "reliable", head: "limited", speech: "limited" },
  supportContext: { categories: [], goals: [], note: "" },
};

function fakeProvider(answer) {
  const calls = [];
  return {
    calls,
    ask: async (input) => {
      calls.push(input);
      return {
        text: typeof answer === "function" ? answer(input) : answer,
        model:
          input.task === "speech"
            ? "gpt-5.6-sol"
            : input.task === "bilingual"
              ? "claude-opus-4-8"
              : "gemini-flash-latest",
        task: input.task,
        profileName: "test",
        elapsedMs: 5,
        fallback: false,
      };
    },
  };
}

test("language and task routing distinguish conversation, bilingual and speech", () => {
  assert.equal(resolveLanguage("Hello", "auto"), "en");
  assert.equal(resolveLanguage("আমার পানি চাই", "auto"), "bn");
  assert.equal(resolveLanguage("Asha পানি please", "auto"), "mixed");
  assert.equal(resolveLanguage("Hello", "bn"), "bn");
  assert.equal(
    selectAshaTask({ mode: "chat", language: "en" }),
    "conversation",
  );
  assert.equal(
    selectAshaTask({ mode: "chat", language: "mixed" }),
    "bilingual",
  );
  assert.equal(
    selectAshaTask({ mode: "interpret", language: "mixed" }),
    "speech",
  );
});

test("conversation uses RAG evidence and exposes a verified orchestration trace", async () => {
  const provider = fakeProvider(
    JSON.stringify({
      reply:
        "Three practiced blinks only propose a request; you confirm separately.",
      source_ids: ["guide:facespeak:2"],
      tool_calls: [],
    }),
  );
  const result = await createAshaOrchestrator({ provider }).run({
    patientId: "patient-a",
    profile,
    text: "Can three blinks send water without confirmation?",
    module: "facespeak",
  });
  assert.equal(provider.calls[0].task, "conversation");
  assert.match(provider.calls[0].query, /Retrieved evidence/);
  assert.match(provider.calls[0].query, /never sends by itself|confirmation/i);
  assert.ok(result.sources.some((source) => source.source === "app-guide"));
  assert.equal(result.orchestration.verified, true);
  assert.equal(result.orchestration.model, "gemini-flash-latest");
  assert.deepEqual(
    result.orchestration.steps.map((step) => step.tool),
    [
      "select_model",
      "retrieve_knowledge",
      "maira_generate",
      "verify_tool_calls",
    ],
  );
});

test("Bangla and mixed conversation select the bilingual model route", async () => {
  const provider = fakeProvider(
    '{"reply":"আমি সাহায্য করতে এখানে আছি।","source_ids":[],"tool_calls":[]}',
  );
  const orchestrator = createAshaOrchestrator({ provider });
  const bangla = await orchestrator.run({
    patientId: "patient-a",
    profile,
    text: "আপনি কীভাবে সাহায্য করেন?",
    language: "auto",
  });
  assert.equal(provider.calls[0].task, "bilingual");
  assert.equal(bangla.language, "bn");
  assert.equal(bangla.orchestration.model, "claude-opus-4-8");
});

test("speech clarification uses the speech model and only confirmed memory", async () => {
  const provider = fakeProvider(
    '{"candidate":"red rabbit green","alternatives":["red rabbit screen"],"question":"Did you mean red rabbit green?"}',
  );
  const result = await createAshaOrchestrator({ provider }).run({
    patientId: "patient-a",
    profile,
    text: "wed wabbit wghreen",
    module: "senseassist",
    mode: "interpret",
    confirmedMemories: [
      {
        heard: "wed wabbit",
        confirmedText: "red rabbit",
        confirmed: true,
      },
      {
        heard: "wghreen",
        confirmedText: "private unconfirmed phrase",
        confirmed: false,
      },
    ],
  });
  assert.equal(provider.calls[0].task, "speech");
  assert.match(provider.calls[0].query, /Work sound-first, word by word/);
  assert.match(
    provider.calls[0].query,
    /do not complete a list or sentence from its theme/,
  );
  assert.match(
    provider.calls[0].query,
    /previously confirmed patient speech pair as stronger evidence/,
  );
  assert.match(provider.calls[0].query, /red rabbit/);
  assert.doesNotMatch(provider.calls[0].query, /private unconfirmed phrase/);
  assert.equal(result.candidate, "red rabbit green");
  assert.equal(result.orchestration.model, "gpt-5.6-sol");
});

test("request tools require an explicit matching patient need", async () => {
  const provider = fakeProvider(({ query }) =>
    JSON.stringify({
      reply: "I can prepare that for confirmation.",
      source_ids: [],
      tool_calls: [
        {
          name: "propose_caregiver_request",
          arguments: {
            kind: query.includes("Patient message (untrusted): I need water")
              ? "water"
              : "help",
          },
        },
      ],
    }),
  );
  const orchestrator = createAshaOrchestrator({ provider });
  const explicit = await orchestrator.run({
    patientId: "patient-a",
    profile,
    text: "I need water please",
  });
  assert.deepEqual(explicit.proposal, {
    kind: "water",
    text: "I need water",
  });
  const rejected = await orchestrator.run({
    patientId: "patient-a",
    profile,
    text: "Tell me how caregiver help works",
  });
  assert.equal(rejected.proposal, undefined);
  assert.equal(rejected.orchestration.steps.at(-1).rejected, 1);
});

test("a verified tool can suggest a module but never performs navigation", async () => {
  const provider = fakeProvider(
    '{"reply":"SenseAssist can clarify that speech.","source_ids":[],"tool_calls":[{"name":"suggest_module","arguments":{"module":"senseassist"}},{"name":"suggest_module","arguments":{"module":"admin"}}]}',
  );
  const result = await createAshaOrchestrator({ provider }).run({
    patientId: "patient-a",
    profile,
    text: "My speech sounds unclear",
  });
  assert.equal(result.suggestedModule, "senseassist");
  assert.equal(result.orchestration.steps.at(-1).accepted, 1);
  assert.equal(result.orchestration.steps.at(-1).rejected, 1);
});

test("malformed model output is usable text but cannot invoke tools", async () => {
  const provider = fakeProvider("A plain safe reply");
  const result = await createAshaOrchestrator({ provider }).run({
    patientId: "patient-a",
    profile,
    text: "Hello",
  });
  assert.equal(result.reply, "A plain safe reply");
  assert.equal(result.proposal, undefined);
  assert.equal(result.suggestedModule, undefined);
  assert.equal(result.orchestration.verified, false);
});

test("negation, general questions and ambiguous yes never prepare requests", async () => {
  const provider = fakeProvider(
    '{"reply":"I am here.","tool_calls":[{"name":"propose_caregiver_request","arguments":{"kind":"water"}}]}',
  );
  const orchestrator = createAshaOrchestrator({ provider });
  for (const text of [
    "no water",
    "I don't need water",
    "what is water",
    "I want to know how water requests work",
    "if I need water",
    "আমার পানি চাই না",
    "I need water and food",
  ]) {
    const result = await orchestrator.run({
      patientId: "patient-a",
      profile,
      text,
    });
    assert.equal(result.proposal, undefined, text);
  }
  const ambiguous = await orchestrator.run({
    patientId: "patient-a",
    profile,
    text: "yes",
    history: [{ role: "assistant", text: "Do you need water or food?" }],
  });
  assert.equal(ambiguous.proposal, undefined);
  const confirmedNeed = await orchestrator.run({
    patientId: "patient-a",
    profile,
    text: "yes",
    history: [{ role: "assistant", text: "Do you need water?" }],
  });
  assert.equal(confirmedNeed.proposal.kind, "water");
});

test("invalid structured answers cannot invoke actions or become spoken JSON", async () => {
  const provider = fakeProvider(
    '{"tool_calls":[{"name":"suggest_module","arguments":{"module":"facespeak"}}]}',
  );
  const orchestrator = createAshaOrchestrator({ provider });
  const chat = await orchestrator.run({
    patientId: "patient-a",
    profile,
    text: "Hello",
  });
  assert.equal(chat.orchestration.verified, false);
  assert.equal(chat.suggestedModule, undefined);
  assert.doesNotMatch(chat.reply, /tool_calls/);
  const speech = await orchestrator.run({
    patientId: "patient-a",
    profile,
    text: "wed wabbit",
    mode: "interpret",
  });
  assert.equal(speech.orchestration.verified, false);
  assert.equal(speech.candidate, "wed wabbit");
});

test("chat cites only retrieved IDs and rejects invented citations", async () => {
  const provider = fakeProvider(
    JSON.stringify({
      reply: "Please confirm the water request.",
      source_ids: ["invented:guide"],
      tool_calls: [
        { name: "propose_caregiver_request", arguments: { kind: "water" } },
      ],
    }),
  );
  const result = await createAshaOrchestrator({ provider }).run({
    patientId: "patient-a",
    profile,
    text: "I need water",
    module: "companion",
  });
  assert.equal(result.orchestration.verified, false);
  assert.deepEqual(result.sources, []);
  assert.equal(result.proposal, undefined);
});
