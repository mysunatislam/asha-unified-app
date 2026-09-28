// Optional, self-described context, never a diagnosis or a capability preset.
export const supportOptions = [
  ["injury", "Voice loss after an accident or injury"],
  ["als", "ALS / motor neuron condition"],
  ["stroke", "Post-stroke recovery"],
  ["cerebral-palsy", "Cerebral palsy"],
  ["older-adult", "Older adult support"],
  ["locked-in", "Locked-in syndrome"],
  ["autism", "Autism / different communication needs"],
  ["temporary", "Temporary voice loss / surgery recovery"],
  ["other", "Another reason"],
];
export const supportGoals = [
  ["needs", "Express everyday needs"],
  ["speech", "Practice or clarify speech"],
  ["companion", "Companionship and daily support"],
  ["care", "Stay connected to a caregiver"],
];
export function normalizeSupport(value) {
  const x = value && typeof value === "object" ? value : {};
  const pick = (values, choices) =>
    choices
      .map(([id]) => id)
      .filter((id) => Array.isArray(values) && values.includes(id));
  return {
    categories: pick(x.categories, supportOptions),
    goals: pick(x.goals, supportGoals),
    note:
      typeof x.note === "string"
        ? x.note
            .replace(/[\u0000-\u001f]/g, " ")
            .trim()
            .slice(0, 160)
        : "",
  };
}
export function supportSummary(value) {
  const x = normalizeSupport(value);
  return (
    [
      ...supportOptions
        .filter(([id]) => x.categories.includes(id))
        .map(([, label]) => label),
      ...supportGoals
        .filter(([id]) => x.goals.includes(id))
        .map(([, label]) => label),
      x.note,
    ]
      .filter(Boolean)
      .join(" · ") || "Not shared (optional)"
  );
}
