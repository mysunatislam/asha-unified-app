import { okfDocuments } from "../okf/generated.js";

// Retrieval supplies evidence, never instructions. Only the versioned guide and
// explicitly confirmed, caller-scoped speech pairs enter this corpus.
const MAX_EXCERPT = 560;
const MAX_QUERY = 1200;
const STOP = new Set(
  "a an the and or of to in on at for from with by is are was be been it its this that these those i me my we our you your he she they their can could would should do does did how what which where when why please tell about want need asha patient patients app page pages screen module current here কী কি কিভাবে কীভাবে কেন কখন কোথায় আমি আমার আমাকে আপনি আপনার এই ওই এবং বা এর এ জন্য থেকে সঙ্গে করতে করা হয় হবে চাই আছে একটা যে পেজ পাতায় পাতা মডিউল এখানে".split(
    " ",
  ),
);
const ALIASES = [
  ["blink", "blinks", "blinking", "পলক", "পলকে", "পলকের", "পলকগুলো"],
  ["eye", "eyes", "চোখ", "চোখের", "চোখে"],
  ["head", "মাথা", "মাথার"],
  ["smile", "smiling", "হাসি", "হাসলে"],
  ["hand", "hands", "হাত", "হাতের", "হাতে"],
  ["finger", "fingers", "আঙুল", "আঙ্গুল", "আঙুলের"],
  ["gesture", "gestures", "ভঙ্গি", "ইশারা"],
  [
    "confirm",
    "confirmation",
    "confirmed",
    "confirms",
    "নিশ্চিত",
    "নিশ্চিতকরণ",
    "নিশ্চিতকরব",
    "সম্মতি",
  ],
  ["calibrate", "calibrated", "calibration", "ক্যালিব্রেশন", "ক্যালিব্রেট"],
  ["speech", "speak", "spoken", "speaking", "কথা", "কথার", "বাক", "বাক্"],
  [
    "transcript",
    "transcripts",
    "muffled",
    "slurred",
    "মাফলড",
    "জড়ানো",
    "অস্পষ্ট",
  ],
  [
    "clarification",
    "clarify",
    "interpret",
    "interpretation",
    "বোঝা",
    "ব্যাখ্যা",
  ],
  ["practice", "practicing", "প্র্যাকটিস", "অনুশীলন"],
  ["caregiver", "carer", "কেয়ারগিভার", "কেয়ারগিভার", "পরিচর্যাকারী"],
  ["request", "requests", "অনুরোধ"],
  [
    "acknowledge",
    "acknowledged",
    "acknowledgement",
    "স্বীকার",
    "প্রাপ্তিস্বীকার",
  ],
  ["received", "receive", "পেয়েছে", "পেয়েছে", "পেয়েছেন"],
  ["phone", "telephone", "call", "calls", "ফোন", "কল"],
  ["pulse", "heartrate", "হার্টরেট", "হৃদস্পন্দন", "নাড়ি", "নাড়ি"],
  ["pressure", "রক্তচাপ", "বিপি"],
  ["oxygen", "saturation", "spo2", "অক্সিজেন"],
  ["temperature", "তাপমাত্রা"],
  ["camera", "ক্যামেরা"],
  ["posture", "pose", "অঙ্গভঙ্গি", "ভঙ্গিমা"],
  ["wake", "awake", "waking", "wakeup", "জেগে", "জাগা", "ঘুম"],
  ["water", "পানি", "জল"],
  ["food", "খাবার"],
  ["toilet", "টয়লেট", "টয়লেট", "শৌচাগার"],
  ["blind", "অন্ধ", "দৃষ্টিহীন"],
  ["hearing", "deaf", "শ্রবণ", "বধির"],
  ["assessment", "assess", "মূল্যায়ন", "মূল্যায়ন"],
];
const canonical = new Map(
  ALIASES.flatMap(([term, ...synonyms]) =>
    [term, ...synonyms].map((synonym) => [synonym.normalize("NFC"), term]),
  ),
);

function terms(value) {
  return (
    value
      .normalize("NFC")
      .toLowerCase()
      .match(/[\p{L}\p{M}\p{N}]+/gu) || []
  )
    .filter((word) => !STOP.has(word))
    .map((word) => canonical.get(word) || word);
}

function guideDocuments() {
  return okfDocuments
    .filter((concept) => concept.status !== "deprecated")
    .flatMap((concept) => {
      const {
        id,
        module,
        title,
        text: guide,
        provenance,
        verification,
      } = concept;
      const sentences = guide.match(/[^.!?]+(?:[.!?]+|$)/g) || [guide];
      return sentences.map((sentence, index) => {
        const next = sentences[index + 1]?.trim();
        const text = [sentence.trim(), next].filter(Boolean).join(" ");
        // Current guides fit as whole sentences; retain a hard bound if they grow.
        const bounded = text.length <= MAX_EXCERPT ? text : sentence.trim();
        return {
          id: `${id}:${index + 1}`,
          title,
          module,
          text: bounded.slice(0, MAX_EXCERPT),
          source: "app-guide",
          provenance,
          verification,
        };
      });
    });
}
const APP_DOCUMENTS = guideDocuments();

function memoryDocuments(memories) {
  if (!Array.isArray(memories)) return [];
  const seen = new Set();
  return memories.slice(0, 100).flatMap((memory, index) => {
    if (
      !memory ||
      memory.confirmed !== true ||
      typeof memory.heard !== "string" ||
      typeof memory.confirmedText !== "string"
    )
      return [];
    const heard = memory.heard.trim();
    const confirmedText = memory.confirmedText.trim();
    // Keep complete short pairs; never truncate a long statement into a claim.
    if (
      !heard ||
      !confirmedText ||
      heard.length > 180 ||
      confirmedText.length > 180
    )
      return [];
    if (/[\u0000-\u001f\u007f]/u.test(heard + confirmedText)) return [];
    const pair = JSON.stringify({ heard, confirmedText });
    if (seen.has(pair)) return [];
    seen.add(pair);
    const text = `Previously confirmed speech pair (quoted patient data): ${pair}`;
    if (text.length > MAX_EXCERPT) return [];
    return [
      {
        id: `speech:${index + 1}`,
        title: "Previously confirmed speech",
        text,
        searchText: `${heard} ${confirmedText}`,
        source: "confirmed-speech",
      },
    ];
  });
}

function asksAboutCurrentPage(query) {
  return /\b(?:this|current)\s+(?:page|module|screen)\b|\bwhat\s+can\s+i\s+do\s+here\b|এই\s+(?:পেজ|পাতা|মডিউল)|এখানে\s+(?:কী|কি)/iu.test(
    query,
  );
}

/** Query-driven local RAG. The caller must load memories only for its authorized patient. */
export function retrieveKnowledge({
  query,
  module = "companion",
  memories = [],
  limit = 3,
} = {}) {
  if (typeof query !== "string" || !query.trim()) return [];
  const requestedLimit = Number.isFinite(limit)
    ? Math.max(0, Math.min(5, Math.floor(limit)))
    : 3;
  if (!requestedLimit) return [];
  const boundedQuery = query.slice(0, MAX_QUERY);
  const queryTerms = [...new Set(terms(boundedQuery))];
  const docs = [...APP_DOCUMENTS, ...memoryDocuments(memories)].map((doc) => ({
    ...doc,
    tokens: terms(doc.searchText || `${doc.module} ${doc.title} ${doc.text}`),
  }));
  const averageLength =
    docs.reduce((sum, doc) => sum + doc.tokens.length, 0) / docs.length || 1;
  const frequencies = new Map(
    queryTerms.map((term) => [
      term,
      docs.filter((doc) => doc.tokens.includes(term)).length,
    ]),
  );
  const ranked = docs
    .map((doc) => {
      let score = 0;
      for (const term of queryTerms) {
        const count = doc.tokens.filter((token) => token === term).length;
        if (!count) continue;
        const frequency = frequencies.get(term);
        const idf = Math.log(
          1 + (docs.length - frequency + 0.5) / (frequency + 0.5),
        );
        score +=
          idf *
          ((count * 2.2) /
            (count +
              1.2 * (0.25 + (0.75 * doc.tokens.length) / averageLength)));
      }
      return { ...doc, score };
    })
    .filter((doc) => doc.score > 0)
    .sort((a, b) => b.score - a.score || a.id.localeCompare(b.id));

  // Limit is a ceiling, not a target: omit weak keyword-only neighbors rather
  // than filling a prompt with barely related camera/communication passages.
  const candidates = ranked.length
    ? ranked.filter((doc) => doc.score >= ranked[0].score * 0.45)
    : asksAboutCurrentPage(boundedQuery)
      ? APP_DOCUMENTS.filter((doc) => doc.module === module).map((doc) => ({
          ...doc,
          score: 0,
        }))
      : [];
  const selected = [];
  for (const doc of candidates) {
    // Adjacent overlapping windows are useful individually, but redundant together.
    if (
      selected.some(
        (other) =>
          other.module === doc.module &&
          doc.module &&
          Math.abs(
            Number(other.id.split(":").at(-1)) -
              Number(doc.id.split(":").at(-1)),
          ) <= 1,
      )
    )
      continue;
    selected.push(doc);
    if (selected.length === requestedLimit) break;
  }
  return selected.map(
    ({ id, title, text, score, source, provenance, verification }) => ({
      id,
      title,
      text,
      score: Number(score.toFixed(4)),
      source,
      ...(provenance ? { provenance } : {}),
      ...(verification ? { verification } : {}),
    }),
  );
}
