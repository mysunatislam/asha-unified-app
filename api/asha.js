import {
  begin,
  body,
  authenticate,
  store,
  path,
  authFail,
} from "../server/common.js";
import { clean } from "../server/logic.js";
import {
  createMairaProvider,
  MairaProviderError,
} from "../server/maira-provider.js";
import { createAshaOrchestrator } from "../server/asha-orchestrator.js";

const orchestrator = createAshaOrchestrator({
  provider: createMairaProvider(),
});

export default async function handler(req, res) {
  if (!begin(req, res)) return;
  if (req.method !== "POST")
    return res.status(405).json({ error: "Method not allowed" });
  const started = Date.now();
  try {
    const b = body(req);
    const auth = await authenticate(req, b.patientId);
    if (!auth) return authFail(res);
    if (b.consent !== true)
      return res
        .status(400)
        .json({ error: "Cloud assistance needs your consent." });
    if (!process.env.MAIRA_API_KEY || !process.env.MAIRA_PROJECT_KEY)
      return res
        .status(503)
        .json({ error: "Asha cloud connection is not configured." });
    const text = clean(b.text, 600);
    if (!text)
      return res.status(400).json({ error: "Say or type something first." });
    const daily = path(
      b.patientId,
      "usage/" + new Date().toISOString().slice(0, 10),
    );
    const usage = (await store.read(daily)) || { count: 0, last: 0 };
    if (usage.count >= 160 || Date.now() - usage.last < 1500)
      return res
        .status(429)
        .json({ error: "Please wait a moment before asking again." });
    await store.write(
      daily,
      { count: usage.count + 1, last: Date.now() },
      true,
    );
    const providerStarted = Date.now();
    const result = await orchestrator.run({
      patientId: b.patientId,
      profile: auth.profile,
      text,
      module: clean(b.module, 30),
      mode: b.mode === "interpret" ? "interpret" : "chat",
      language: ["auto", "en", "bn", "mixed"].includes(b.language)
        ? b.language
        : "auto",
      context: clean(b.context, 180),
      history: Array.isArray(b.history) ? b.history.slice(-6) : [],
      confirmedMemories: Array.isArray(b.confirmedMemories)
        ? b.confirmedMemories.slice(-20)
        : [],
    });
    res.setHeader(
      "Server-Timing",
      `setup;dur=${providerStarted - started}, maira;dur=${Date.now() - providerStarted}, total;dur=${Date.now() - started}`,
    );
    console.info("asha orchestration", {
      task: result.orchestration.task,
      model: result.orchestration.model,
      verified: result.orchestration.verified,
      durationMs: Date.now() - started,
    });
    return res.json(result);
  } catch (error) {
    console.error("asha request failure", error?.name);
    if (error instanceof MairaProviderError)
      return res.status(error.status).json({ error: error.message });
    return res.status(503).json({
      error:
        "Asha could not connect. Your local communication controls remain available.",
    });
  }
}
