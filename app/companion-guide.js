import { RAPID_BLINK, CONFIRM_BLINK } from "./blink-intent.js";
const NEED_LABELS = {
  water: "water",
  food: "food",
  toilet: "help going to the toilet",
  comfort: "help getting comfortable",
  help: "your caregiver to check in",
};

export function responsePlan(assessment = {}, enabled = []) {
  const active = new Set(enabled);
  const head = assessment.head && assessment.head !== "none";
  const lips = assessment.lips && assessment.lips !== "none";
  const nod = head && active.has("NOD_COMPLETED");
  const left = head && active.has("LEFT_TURN_COMPLETED");
  const right = head && active.has("RIGHT_TURN_COMPLETED");
  if (nod && left && right)
    return {
      mode: "menu",
      choices: {
        NOD_COMPLETED: "water",
        LEFT_TURN_COMPLETED: "food",
        RIGHT_TURN_COMPLETED: "toilet",
      },
    };
  if (nod) return { mode: "yes", event: "NOD_COMPLETED", verb: "nod and return to center" };
  if (left) return { mode: "yes", event: "LEFT_TURN_COMPLETED", verb: "turn your head left and return to center" };
  if (right) return { mode: "yes", event: "RIGHT_TURN_COMPLETED", verb: "turn your head right and return to center" };
  if (lips && active.has("SMILE_COMPLETED"))
    return { mode: "yes", event: "SMILE_COMPLETED", verb: "smile and relax" };
  if (assessment.eyes && assessment.eyes !== "none" && active.has(RAPID_BLINK) && active.has(CONFIRM_BLINK))
    return { mode: "blink", event: RAPID_BLINK, verb: "blink three times quickly, fully reopening each time" };
  return { mode: "none" };
}

export function confirmationMatches(type, assessment, enabled) {
  const plan = responsePlan(assessment, enabled);
  return plan.mode === "menu"
    ? type === "NOD_COMPLETED"
    : plan.mode === "blink" ? type === CONFIRM_BLINK : plan.mode === "yes" && type === plan.event;
}

export class CompanionGuide {
  constructor({ intervalMs = 120000, answerMs = 35000 } = {}) {
    this.intervalMs = intervalMs;
    this.answerMs = answerMs;
    this.lastPrompt = -Infinity;
    this.pending = null;
    this.nextNeed = 0;
  }
  clear() {
    this.pending = null;
  }
  due(t) {
    if (this.pending && t > this.pending.until) this.pending = null;
    return !this.pending && t - this.lastPrompt >= this.intervalMs;
  }
  ask({ assessment, enabled, handMapped = false, reason = "routine" }, t) {
    const plan = responsePlan(assessment, enabled);
    const prefix = {
      start: "I'm Asha. Your support is ready. I'll explain the choices and give you time to respond. ",
      wake: "I notice your eyes are open and you're moving again. ",
      change: "I noticed a lasting movement change. I can't tell how you feel from the camera. ",
      smile: "I see you smiled. I'm here with you. ",
      routine: "I'm here with you. ",
    }[reason] || "I'm here with you. ";
    this.lastPrompt = t;
    this.pending = null;
    if (plan.mode === "menu" && !["wake", "change"].includes(reason)) {
      this.pending = { choices: plan.choices, until: t + this.answerMs };
      return prefix + "Nod for water, turn your head left and back for food, or right and back for toilet help. I'll repeat your choice before sending a caregiver request. Ordinary blinks do nothing.";
    }
    if (plan.mode !== "none") {
      const cycle = ["water", "toilet", "food", "help"];
      const kind = reason === "wake" ? "water" : reason === "change" ? "comfort" : cycle[this.nextNeed++ % cycle.length];
      const event = plan.mode === "menu" ? "NOD_COMPLETED" : plan.event;
      const verb = plan.mode === "menu" ? "nod and return to center" : plan.verb;
      this.pending = { choices: { [event]: kind }, until: t + this.answerMs };
      return prefix + `Do you need ${NEED_LABELS[kind]}? Please ${verb} to say yes. Otherwise relax; I'll check in again. I'll ask you to confirm before sending a request.`;
    }
    if (handMapped)
      return prefix + "Your personalized hand gestures can tell me what you need. Show one when you're ready; I'll repeat the request before sending it.";
    return prefix + "I can describe this page, but I don't have a reliable hands-free answer from your assessment yet. A caregiver can set up a comfortable head, smile or deliberate blink response in Details.";
  }
  accept(event, t) {
    if (!this.pending) return null;
    if (t > this.pending.until) {
      this.pending = null;
      return null;
    }
    const kind = this.pending.choices[event] || null;
    if (kind) this.pending = null;
    return kind;
  }
}
