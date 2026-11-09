import { evaluateSafety, safetyMessage } from "./safety.js";

/** Shared preflight for the existing companion as well as the new Care UI. */
export function urgentCompanionResponse(
  text,
  { language = "en", mode = "chat", region = "BD", redFlags } = {},
) {
  const safety = evaluateSafety(text, { region, redFlags });
  if (safety.level !== "emergency") return null;
  const outputLanguage =
    language === "bn" || /[\u0980-\u09ff]/u.test(String(text)) ? "bn" : "en";
  const message = safetyMessage(safety, outputLanguage);
  return {
    ...(mode === "interpret"
      ? {
          candidate: String(text).slice(0, 250),
          alternatives: [],
          question: message,
        }
      : { reply: message }),
    language: outputLanguage,
    safety,
    sources: [],
    orchestration: {
      task: "local-safety",
      model: safety.protocolId + "@" + safety.policyVersion,
      verified: false,
      steps: [
        {
          tool: "precautionary-safety-rule",
          status: "urgent-template; clinical-review-pending",
        },
      ],
    },
  };
}
