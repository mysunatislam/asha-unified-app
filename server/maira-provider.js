const BASE = "https://api.recommender.gigalogy.com";
const PROFILE_TTL_MS = 15 * 60 * 1000;
const DISCOVERY_TIMEOUT_MS = 5000;
const ASK_TIMEOUT_MS = 45000;
const ROUTES = Object.freeze({
  conversation: {
    name: "ashagemini",
    model: "gemini-flash-latest",
    envKey: "MAIRA_CHAT_PROFILE_ID",
  },
  speech: {
    name: "Asgagpt",
    model: "gpt-5.6-sol",
    envKey: "MAIRA_SPEECH_PROFILE_ID",
  },
  bilingual: {
    name: "Asgaclaude",
    model: "claude-opus-4-8",
    envKey: "MAIRA_BILINGUAL_PROFILE_ID",
  },
});

// Only fixed, public messages cross the API boundary. Never attach upstream
// bodies, request headers, profile IDs, or raw network errors to this error.
export class MairaProviderError extends Error {
  constructor(code, message, status = 502) {
    super(message);
    this.name = "MairaProviderError";
    this.code = code;
    this.status = status;
  }
}

const cancelled = () =>
  new MairaProviderError("cancelled", "The Asha request was cancelled.", 499);
const timeout = () =>
  new MairaProviderError(
    "timeout",
    "Asha is taking longer than expected. Please try again.",
    504,
  );

// Race as well as abort so cancellation is bounded even for a stalled adapter.
async function bounded(operation, timeoutMs, signal) {
  if (signal?.aborted) throw cancelled();
  const controller = new AbortController();
  let timer;
  let stop;
  const deadline = new Promise((_, reject) => {
    stop = () => {
      reject(cancelled());
      controller.abort();
    };
    signal?.addEventListener("abort", stop, { once: true });
    timer = setTimeout(() => {
      reject(timeout());
      controller.abort();
    }, timeoutMs);
  });
  try {
    return await Promise.race([
      Promise.resolve().then(() => operation(controller.signal)),
      deadline,
    ]);
  } finally {
    clearTimeout(timer);
    signal?.removeEventListener("abort", stop);
  }
}

function checkStatus(response) {
  if (response.ok) return;
  if (response.status === 401 || response.status === 403)
    throw new MairaProviderError(
      "credentials_rejected",
      "Asha's AI connection needs its server credentials checked.",
      503,
    );
  if (response.status === 429)
    throw new MairaProviderError(
      "provider_busy",
      "Asha's AI service is busy. Please try again shortly.",
      429,
    );
  throw new MairaProviderError(
    "provider_unavailable",
    "Asha's selected AI service is temporarily unavailable.",
  );
}

export function createMairaProvider({
  env = process.env,
  fetchImpl = fetch,
  now = Date.now,
} = {}) {
  let cachedProfiles = null;
  let cacheUntil = 0;
  let lookup = null;

  const headers = () => ({
    "content-type": "application/json",
    "api-key": env.MAIRA_API_KEY,
    "project-key": env.MAIRA_PROJECT_KEY,
  });

  async function requestJson(url, options, timeoutMs, signal) {
    try {
      return await bounded(
        async (requestSignal) => {
          const response = await fetchImpl(url, {
            ...options,
            signal: requestSignal,
          });
          checkStatus(response);
          try {
            return await response.json();
          } catch {
            throw new MairaProviderError(
              "invalid_response",
              "Asha's AI service returned an unreadable reply.",
            );
          }
        },
        timeoutMs,
        signal,
      );
    } catch (error) {
      if (error instanceof MairaProviderError) throw error;
      throw new MairaProviderError(
        "connection_failed",
        "Asha's AI service could not be reached. Please try again.",
      );
    }
  }

  function profiles() {
    if (cachedProfiles && now() < cacheUntil)
      return Promise.resolve(cachedProfiles);
    if (lookup) return lookup;
    lookup = (async () => {
      try {
        const data = await requestJson(
          `${BASE}/v1/gpt/profiles?start=0&size=100`,
          { method: "GET", headers: headers() },
          DISCOVERY_TIMEOUT_MS,
        );
        const available = data?.detail?.response?.profiles;
        if (!Array.isArray(available))
          throw new MairaProviderError(
            "profiles_unavailable",
            "Asha could not load its configured AI models. Please try again.",
            503,
          );
        cachedProfiles = available.filter(
          (profile) =>
            profile &&
            typeof profile.id === "string" &&
            profile.id.trim() &&
            typeof profile.name === "string" &&
            typeof profile.model === "string" &&
            profile.model.trim(),
        );
        cacheUntil = now() + PROFILE_TTL_MS;
        return cachedProfiles;
      } finally {
        lookup = null;
      }
    })();
    return lookup;
  }

  async function ask({
    task = "conversation",
    query,
    patientId,
    language = "auto",
    module = "companion",
    signal,
  } = {}) {
    const started = now();
    if (signal?.aborted) throw cancelled();
    if (
      !Object.hasOwn(ROUTES, task) ||
      typeof query !== "string" ||
      !query.trim() ||
      query.length > 20000 ||
      typeof patientId !== "string" ||
      !patientId.trim() ||
      patientId.length > 128 ||
      !["en", "bn", "mixed", "auto"].includes(language)
    )
      throw new MairaProviderError(
        "invalid_request",
        "Asha needs a valid task, message, and session.",
        400,
      );
    if (!env.MAIRA_API_KEY || !env.MAIRA_PROJECT_KEY)
      throw new MairaProviderError(
        "not_configured",
        "Asha cloud connection is not configured.",
        503,
      );

    const route = ROUTES[task];
    const override =
      env[route.envKey] ||
      (task === "conversation" ? env.MAIRA_GPT_PROFILE_ID : undefined);
    // A caller may stop waiting, but cannot cancel another caller's discovery.
    const available = await bounded(
      () => profiles(),
      DISCOVERY_TIMEOUT_MS,
      signal,
    );
    const profile = available.find((item) =>
      override
        ? item.id === override
        : item.name === route.name && item.model === route.model,
    );
    if (!profile)
      throw new MairaProviderError(
        "model_unavailable",
        "The AI model configured for this task is unavailable. Please try another module or ask the app administrator to check its configuration.",
        503,
      );

    const data = await requestJson(
      `${BASE}/v1/maira/ask`,
      {
        method: "POST",
        headers: headers(),
        body: JSON.stringify({
          user_id: "asha-live-" + patientId,
          query,
          conversation_type: "chat",
          gpt_profile_id: profile.id,
          top_k: 1,
          is_keyword_enabled: false,
          // Omit for mixed/auto: these are app options, not language codes.
          ...(["en", "bn"].includes(language) ? { language } : {}),
          conversation_metadata: {
            source: "asha-live",
            module: String(module).slice(0, 40),
            task,
            language,
          },
        }),
      },
      ASK_TIMEOUT_MS,
      signal,
    );
    const text = data?.detail?.response ?? data?.response ?? data?.answer;
    if (typeof text !== "string" || !text.trim())
      throw new MairaProviderError(
        "invalid_response",
        "Asha returned no usable reply. Please try again.",
      );
    return {
      text: text.trim(),
      model: profile.model,
      profileName: profile.name,
      task,
      elapsedMs: Math.max(0, now() - started),
      fallback: false,
    };
  }

  return { ask };
}
