import assert from "node:assert/strict";
import { test } from "node:test";
import {
  createMairaProvider,
  MairaProviderError,
} from "../server/maira-provider.js";

const env = {
  MAIRA_API_KEY: "private-api-key",
  MAIRA_PROJECT_KEY: "private-project-key",
};
const configuredProfiles = [
  { id: "private-chat-id", name: "ashagemini", model: "gemini-flash-latest" },
  { id: "private-speech-id", name: "Asgagpt", model: "gpt-5.6-sol" },
  { id: "private-bilingual-id", name: "Asgaclaude", model: "claude-opus-4-8" },
];
const profileResponse = (profiles = configuredProfiles) =>
  Response.json({ detail: { response: { profiles } } });
const input = {
  query: "A nonidentifying test message.",
  patientId: "demo-test",
};

test("Maira selects three distinct task profiles and does not expose IDs or keys", async () => {
  const calls = [];
  const provider = createMairaProvider({
    env,
    fetchImpl: async (url, options) => {
      calls.push({ url, options });
      if (options.method === "GET") return profileResponse();
      return Response.json({ detail: { response: "A reply" } });
    },
  });
  const results = [];
  for (const [task, language] of [
    ["conversation", "en"],
    ["speech", "bn"],
    ["bilingual", "mixed"],
  ])
    results.push(await provider.ask({ ...input, task, language }));
  assert.equal(calls.filter((call) => call.options.method === "GET").length, 1);
  const bodies = calls
    .filter((call) => call.options.method === "POST")
    .map((call) => JSON.parse(call.options.body));
  assert.deepEqual(
    bodies.map((body) => body.gpt_profile_id),
    configuredProfiles.map((profile) => profile.id),
  );
  assert.deepEqual(
    bodies.map((body) => body.language),
    ["en", "bn", undefined],
  );
  assert.deepEqual(
    results.map((result) => result.model),
    configuredProfiles.map((profile) => profile.model),
  );
  assert.ok(results.every((result) => result.fallback === false));
  assert.doesNotMatch(JSON.stringify(results), /private-/);
});

test("concurrent profile discovery coalesces and expires after fifteen minutes", async () => {
  let clock = 100;
  let discoveries = 0;
  let release;
  const wait = new Promise((resolve) => {
    release = resolve;
  });
  const provider = createMairaProvider({
    env,
    now: () => clock,
    fetchImpl: async (_url, options) => {
      if (options.method === "GET") {
        discoveries++;
        await wait;
        return profileResponse();
      }
      return Response.json({ answer: "Ready" });
    },
  });
  const first = provider.ask({ ...input, task: "speech" });
  const second = provider.ask({ ...input, task: "bilingual" });
  release();
  await Promise.all([first, second]);
  assert.equal(discoveries, 1);
  clock += 15 * 60 * 1000 + 1;
  await provider.ask(input);
  assert.equal(discoveries, 2);
});

test("server overrides select verified profiles and legacy chat override still works", async () => {
  const selected = [];
  const provider = createMairaProvider({
    env: {
      ...env,
      MAIRA_GPT_PROFILE_ID: "private-speech-id",
      MAIRA_BILINGUAL_PROFILE_ID: "private-chat-id",
    },
    fetchImpl: async (_url, options) => {
      if (options.method === "GET") return profileResponse();
      selected.push(JSON.parse(options.body).gpt_profile_id);
      return Response.json({ response: "Ready" });
    },
  });
  assert.equal((await provider.ask(input)).model, "gpt-5.6-sol");
  assert.equal(
    (await provider.ask({ ...input, task: "bilingual" })).model,
    "gemini-flash-latest",
  );
  assert.deepEqual(selected, ["private-speech-id", "private-chat-id"]);
});

test("missing task model is an explicit error without a fallback ask", async () => {
  let asks = 0;
  const provider = createMairaProvider({
    env,
    fetchImpl: async (_url, options) => {
      if (options.method === "GET")
        return profileResponse(configuredProfiles.slice(0, 1));
      asks++;
      return Response.json({ answer: "Wrong model" });
    },
  });
  await assert.rejects(
    provider.ask({ ...input, task: "speech" }),
    (error) =>
      error instanceof MairaProviderError &&
      error.code === "model_unavailable" &&
      error.status === 503,
  );
  assert.equal(asks, 0);
});

test("malformed discovery and provider answers are rejected", async () => {
  for (const payload of [
    null,
    {},
    { detail: { response: [] } },
    { answer: "  " },
  ]) {
    const provider = createMairaProvider({
      env,
      fetchImpl: async (_url, options) =>
        options.method === "GET" ? profileResponse() : Response.json(payload),
    });
    await assert.rejects(
      provider.ask(input),
      (error) => error.code === "invalid_response",
    );
  }
  const provider = createMairaProvider({
    env,
    fetchImpl: async () =>
      Response.json({ detail: { response: "private-secret" } }),
  });
  await assert.rejects(
    provider.ask(input),
    (error) => error.code === "profiles_unavailable",
  );
});

test("upstream errors never reflect response bodies, credentials, or IDs", async () => {
  for (const status of [401, 403, 429, 500]) {
    const provider = createMairaProvider({
      env,
      fetchImpl: async () =>
        new Response("private-api-key private-project-key private-chat-id", {
          status,
        }),
    });
    await assert.rejects(provider.ask(input), (error) => {
      assert.ok(error instanceof MairaProviderError);
      assert.doesNotMatch(error.message + JSON.stringify(error), /private-/);
      assert.equal(
        error.status,
        status === 429 ? 429 : status === 500 ? 502 : 503,
      );
      return true;
    });
  }
  const provider = createMairaProvider({
    env,
    fetchImpl: async () => {
      throw Error("private-api-key");
    },
  });
  await assert.rejects(
    provider.ask(input),
    (error) =>
      error.code === "connection_failed" && !error.message.includes("private-"),
  );
});

test("cancellation aborts an in-flight ask without surfacing an arbitrary abort reason", async () => {
  const controller = new AbortController();
  let notify;
  const started = new Promise((resolve) => {
    notify = resolve;
  });
  let providerSignal;
  const provider = createMairaProvider({
    env,
    fetchImpl: async (_url, options) => {
      if (options.method === "GET") return profileResponse();
      providerSignal = options.signal;
      notify();
      return new Promise(() => {});
    },
  });
  const request = provider.ask({ ...input, signal: controller.signal });
  await started;
  controller.abort("private-api-key");
  await assert.rejects(
    request,
    (error) =>
      error.code === "cancelled" &&
      error.status === 499 &&
      !error.message.includes("private-"),
  );
  assert.equal(providerSignal.aborted, true);
});

test("cancelling one discovery waiter preserves another concurrent request", async () => {
  const controller = new AbortController();
  let release;
  let notify;
  const started = new Promise((resolve) => {
    notify = resolve;
  });
  const pending = new Promise((resolve) => {
    release = resolve;
  });
  const provider = createMairaProvider({
    env,
    fetchImpl: async (_url, options) => {
      if (options.method === "GET") {
        notify();
        await pending;
        return profileResponse();
      }
      return Response.json({ answer: "Ready" });
    },
  });
  const request = provider.ask({ ...input, signal: controller.signal });
  const other = provider.ask({ ...input, task: "bilingual" });
  await started;
  controller.abort();
  await assert.rejects(request, (error) => error.code === "cancelled");
  release();
  assert.equal((await other).text, "Ready");
});

test("a stalled provider is aborted at the deadline without retrying", async (t) => {
  t.mock.timers.enable({ apis: ["setTimeout"] });
  let notify;
  const started = new Promise((resolve) => {
    notify = resolve;
  });
  let asks = 0;
  let providerSignal;
  const provider = createMairaProvider({
    env,
    fetchImpl: async (_url, options) => {
      if (options.method === "GET") return profileResponse();
      asks++;
      providerSignal = options.signal;
      notify();
      return new Promise(() => {});
    },
  });
  const request = provider.ask(input);
  const rejection = assert.rejects(
    request,
    (error) => error.code === "timeout" && error.status === 504,
  );
  await started;
  t.mock.timers.tick(45000);
  await rejection;
  assert.equal(providerSignal.aborted, true);
  assert.equal(asks, 1);
});

test("a failed profile lookup can recover on the next request", async () => {
  let discoveries = 0;
  const provider = createMairaProvider({
    env,
    fetchImpl: async (_url, options) => {
      if (options.method === "GET") {
        discoveries++;
        return discoveries === 1
          ? new Response(null, { status: 503 })
          : profileResponse();
      }
      return Response.json({ answer: "Ready" });
    },
  });
  await assert.rejects(
    provider.ask(input),
    (error) => error.code === "provider_unavailable",
  );
  assert.equal((await provider.ask(input)).text, "Ready");
  assert.equal(discoveries, 2);
});
