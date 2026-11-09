/** Precautionary templates, not a diagnostic or clinically validated model. */
export const SAFETY_POLICY = Object.freeze({
  id: "asha-precautionary-symptoms",
  version: "0.2.0",
  clinicalReview: "pending",
  clinicalRelease: false,
  scope:
    "Precautionary chest discomfort, breathing difficulty and loss-of-consciousness guidance. Not an exhaustive symptom checker. Clinical review and multilingual user testing are pending.",
  sources: Object.freeze([
    "https://www.nhs.uk/conditions/heart-attack/",
    "https://police.portal.gov.bd/pages/static-pages/6922dcc4933eb65569e11ed9",
    "https://telecom-police.portal.gov.bd/pages/static-pages/695e3b0cc4774958d7b72321",
  ]),
});
const CONTACTS = Object.freeze({
  BD: "999",
  GB: "999",
  US: "911",
  CA: "911",
  EU: "112",
  IN: "112",
});
export const emergencyContact = (region) =>
  CONTACTS[String(region || "").toUpperCase()] || null;

// Assess every match: a denied symptom cannot suppress a later affirmative or
// uncertain report, or a structured warning flag in the same input.
const PATTERNS = Object.freeze({
  chest:
    /\b(?:chest|chset|cheast)\s*(?:pain|pan|pian|pressure|tight\w*|squeez\w*|discomfort|burn\w*|hurts?)\b|\bheart\s*attack\b|বুক(?:ে|ের)?\s*(?:ব্যথা|ব্যাথা|বেথা|চাপ|টান|জ্বালা|অস্বস্তি)|\bbuk(?:e|ey|er)?\s*(?:betha|byatha|bytha|batha|chap|jwala)\b/giu,
  breathing:
    /\b(?:can['’]?t|cannot|unable to|struggling to)\s*(?:breathe|breath)\b|\b(?:short(?:ness)?\s*of\s*breath|breathless\w*|difficulty\s*breathing|gasping|choking)\b|শ্বাস\s*(?:কষ্ট|নিতে পারছি না|নিতে কষ্ট|বন্ধ)|নিশ্বাস\s*(?:নিতে কষ্ট|বন্ধ)|দম\s*(?:বন্ধ|পাচ্ছি না)|\b(?:ni)?sha(?:s|sh)\s*(?:nite\s*(?:koshto|kosto|parchi\s*na)|koshto|kosto|bondho)\b/giu,
  fainting:
    /\b(?:unconscious|unresponsive|passed\s*out|fainted|faintness|feel(?:ing)?\s*faint|not\s*waking|not\s*responding)\b|অজ্ঞান|জ্ঞান\s*নেই|সাড়া\s*দিচ্ছে না|সাড়া\s*দিচ্ছে না|\boggan\b|\bgyan\s*(?:nei|nai)\b/giu,
  warning:
    /\b(?:unusual|cold|unexplained)\s*sweat\w*\b|\bpain\s*(?:is\s*)?(?:spreading|radiating|spreads)\s*(?:to|into|down)\s*(?:my\s*)?(?:arm|jaw|neck)\b|ঠান্ডা\s*ঘাম|ব্যথা\s*(?:হাত|চোয়াল|চোয়াল|ঘাড়|ঘাড়).*ছড়া/giu,
});
const UNCERTAIN =
  /\b(?:not\s*sure|unsure|uncertain|maybe|possibly|might|could\s*be|can['’]?t\s*(?:tell|say)|cannot\s*(?:tell|say)|jani\s*na|bujhte\s*parchi\s*na)\b|হয়তো|হয়তো|জানি\s*না|বুঝতে\s*পারছি\s*না/iu;
const PREFIX_DENIAL =
  /(?:\b(?:no|without|deny|denies|denied)\b(?:\s+(?:any|a|current|currently|severe|signs?|of|symptoms?)){0,4}|\bnot\s+(?:(?:have|having|experiencing|feeling)\s*)?(?:any\s*)?)\s*$/iu;
const SUFFIX_DENIAL =
  /^\s*(?:(?:is|are)\s*(?:absent|not\s*present)|(?:নেই|নাই|নয়|নয়|হয়\s*না|হয়\s*না|হচ্ছে\s*না|না)(?=\s|$)|(?:nai|nei|nahi|na)\b)/iu;

function reported(text, expression) {
  let affirmative = false,
    uncertain = false;
  const clauses = text.split(
    /[.!?;,\n]|\b(?:but|however|yet)\b|কিন্তু|তবে|\b(?:kintu|tobe)\b/iu,
  );
  for (const clause of clauses)
    for (const match of clause.matchAll(expression)) {
      const before = clause.slice(Math.max(0, match.index - 70), match.index);
      const after = clause.slice(
        match.index + match[0].length,
        match.index + match[0].length + 45,
      );
      const ambiguous = UNCERTAIN.test(clause);
      if (
        !ambiguous &&
        (PREFIX_DENIAL.test(before) || SUFFIX_DENIAL.test(after))
      )
        continue;
      affirmative = true;
      uncertain ||= ambiguous;
    }
  return { affirmative, uncertain };
}

function educationalOnly(text) {
  const lead =
    /^(?:what\s+(?:is|are|causes)|why\s+(?:does|do)|explain|define|how\s+(?:can\s+i\s+prevent|to\s+prevent)|হার্ট\s*অ্যাটাক\s*(?:কী|কি)|বুকে?\s*ব্যথা\s*(?:কী|কি)|কাকে\s*বলে)/iu.test(
      text.trim(),
    );
  const report =
    /\b(?:my|our|now|currently|having|experiencing)\b|\bi\s+(?:have|feel|am\s*(?:having|feeling))\b|\b(?:he|she|someone)\s*(?:has|is)\b|আমার|আমাদের|এখন|হচ্ছে|amar\b/iu.test(
      text,
    );
  return lead && !report;
}

/** Runs locally before a generative model. Rules require clinical review. */
export function evaluateSafety(input, fields = {}) {
  fields = fields && typeof fields === "object" ? fields : {};
  const raw =
    typeof input === "string"
      ? input
          .normalize("NFKC")
          .toLowerCase()
          .replace(/[\u200b-\u200d\ufeff]/g, "")
      : "";
  const tooLong = raw.length > 4000;
  // Scan an extended input before rejecting it; never send truncated symptoms to AI.
  const text = raw.slice(0, 16000),
    educational = educationalOnly(text);
  const chest = reported(text, PATTERNS.chest),
    breathing = reported(text, PATTERNS.breathing);
  const fainting = reported(text, PATTERNS.fainting),
    warning = reported(text, PATTERNS.warning);
  const flags = Array.isArray(fields.redFlags)
    ? fields.redFlags.filter((f) =>
        ["breathlessness", "fainting", "sweating", "radiating"].includes(f),
      )
    : [];
  const reasons = [];
  if (!educational && chest.affirmative)
    reasons.push(
      "Reported or uncertain chest discomfort needs prompt medical assessment.",
    );
  if (
    (!educational && breathing.affirmative) ||
    flags.includes("breathlessness")
  )
    reasons.push("Reported breathing difficulty.");
  if ((!educational && fainting.affirmative) || flags.includes("fainting"))
    reasons.push("Reported loss of consciousness or faintness.");
  if (
    (!educational && warning.affirmative) ||
    flags.some((f) => ["sweating", "radiating"].includes(f))
  )
    reasons.push("Reported associated warning symptoms.");
  const level = reasons.length
    ? "emergency"
    : tooLong || !text.trim()
      ? "unknown"
      : "routine";
  return {
    level,
    protocolId: SAFETY_POLICY.id,
    policyVersion: SAFETY_POLICY.version,
    clinicalReview: SAFETY_POLICY.clinicalReview,
    clinicalRelease: false,
    reasons,
    uncertain: [chest, breathing, fainting, warning].some((r) => r.uncertain),
    allowLLM: level === "routine",
    contact: emergencyContact(fields.region || "BD"),
    automaticContact: false,
    trustedContactAuthorizationRequired: true,
  };
}

export function safetyMessage(decision, language = "en") {
  const contact = decision?.contact;
  if (decision?.level === "emergency")
    return language === "bn"
      ? "এখনই জরুরি চিকিৎসা সহায়তা নিন। " +
          (contact
            ? contact + " নম্বরে কল করুন।"
            : "স্থানীয় জরুরি নম্বরে কল করুন।") +
          " নিজে গাড়ি চালাবেন না। আরামদায়ক অবস্থায় বিশ্রাম নিন। অ্যাপের উত্তর বা ব্যায়ামের জন্য অপেক্ষা করবেন না।"
      : "Get urgent medical help now. " +
          (contact
            ? "Call " + contact + "."
            : "Call your local emergency number.") +
          " Avoid driving yourself. Rest in a comfortable position. Do not wait for an app answer or try an exercise to check these symptoms.";
  if (decision?.level === "unknown")
    return language === "bn"
      ? "লক্ষণটি স্পষ্ট করে আবার লিখুন। বুকে ব্যথা, শ্বাসকষ্ট বা অজ্ঞান লাগলে এখনই জরুরি চিকিৎসা সহায়তা নিন। " +
          (contact
            ? contact + " নম্বরে কল করুন।"
            : "স্থানীয় জরুরি নম্বরে কল করুন।")
      : "Please describe the symptoms clearly again. For chest discomfort, breathing difficulty or faintness, seek urgent help now. " +
          (contact
            ? "Call " + contact + "."
            : "Call your local emergency number.");
  return language === "bn"
    ? "লক্ষণ, কখন শুরু হয়েছে ও কী পরিবর্তন হচ্ছে লিখে রাখুন। নতুন বা উদ্বেগজনক লক্ষণ হলে চিকিৎসকের পরামর্শ নিন। এই পরীক্ষা গুরুতর অসুস্থতা বাদ দিতে পারে না।"
    : "Record what you noticed, when it began, and what is changing. Seek medical advice for new or concerning symptoms. This check cannot rule out serious illness.";
}
