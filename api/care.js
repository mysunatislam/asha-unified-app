import {
  begin,
  body,
  authenticate,
  authFail,
  store,
  path,
} from "../server/common.js";
import { clean } from "../server/logic.js";
import { evaluateSafety, safetyMessage } from "../app/everyday/safety.js";
import { createMairaProvider } from "../server/maira-provider.js";
import { createCareService } from "../server/care-service.js";

const care = createCareService(createMairaProvider());
export default async function handler(req, res) {
  res.setHeader("Cache-Control", "no-store");
  if (!begin(req, res)) return;
  if (req.method !== "POST")
    return res.status(405).json({ error: "Method not allowed" });
  try {
    const input = body(req);
    if (JSON.stringify(input).length > 20000)
      return res
        .status(413)
        .json({ error: "Send a shorter message and fewer context records." });
    const decision = evaluateSafety(String(input.text || ""), {
      region: input.region,
      redFlags: input.redFlags,
    });
    if (!decision.allowLLM)
      return res.json({
        reply: safetyMessage(decision, input.language),
        safety: decision,
      });
    const text = clean(input.text, 600);
    const auth = await authenticate(req, input.patientId);
    if (!auth) return authFail(res);
    if (input.consent !== true)
      return res
        .status(400)
        .json({ error: "Cloud assistance needs your consent." });
    const records = Array.isArray(input.context)
      ? input.context
          .slice(0, 5)
          .filter((r) => r?.consent_scope === "care" && r?.module === "care")
      : [];
    const key = path(
      input.patientId,
      "usage/" + new Date().toISOString().slice(0, 10),
    );
    const usage = (await store.read(key)) || { count: 0, last: 0 };
    if (usage.count >= 160 || Date.now() - usage.last < 1500)
      return res
        .status(429)
        .json({ error: "Please wait before asking again." });
    await store.write(key, { count: usage.count + 1, last: Date.now() }, true);
    const result = await care.explain({
      patientId: input.patientId,
      text,
      context: records,
      region: input.region,
      redFlags: input.redFlags,
      language: ["en", "bn"].includes(input.language) ? input.language : "en",
      consent: true,
    });
    return res.json(result);
  } catch {
    return res
      .status(503)
      .json({
        error:
          "Cloud assistance is unavailable. Your journal and local urgent guidance remain available.",
      });
  }
}
