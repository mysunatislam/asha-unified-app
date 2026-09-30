import { createHash, timingSafeEqual } from "node:crypto";
export const hash = (x) => createHash("sha256").update(String(x)).digest("hex");
export const equal = (a, b) =>
  typeof a === "string" &&
  typeof b === "string" &&
  a.length === b.length &&
  timingSafeEqual(Buffer.from(a), Buffer.from(b));
export const clean = (v, n = 300) =>
  typeof v === "string"
    ? v
        .replace(/[\u0000-\u001f]/g, " ")
        .trim()
        .slice(0, n)
    : "";
export function assessment(x = {}) {
  const out = {};
  for (const k of [
    "leftHand",
    "rightHand",
    "wrist",
    "fingers",
    "eyes",
    "lips",
    "head",
    "speech",
  ])
    out[k] = ["none", "limited", "reliable"].includes(x[k]) ? x[k] : "none";
  out.canSee = x.canSee !== false;
  out.canHear = x.canHear !== false;
  return out;
}
export function recommend(a) {
  const all = [];
  if (a.fingers !== "none" && (a.leftHand !== "none" || a.rightHand !== "none"))
    all.push("fingerspeak");
  if (["eyes", "lips", "head"].some((k) => a[k] !== "none"))
    all.push("facespeak");
  if (a.speech !== "none") all.push("senseassist");
  return {
    primary: all[0] || "companion",
    suggested: all,
    reason:
      all[0] === "fingerspeak"
        ? "Your assessment includes hand and finger movement."
        : all[0] === "facespeak"
          ? "Your assessment includes usable facial movement."
          : all[0] === "senseassist"
            ? "Speech practice and clearer phrasing match your assessment."
            : "Asha and caregiver-assisted communication are available. Every module remains open.",
  };
}
export function voice(v = {}) {
  return {
    name: clean(v.name, 100),
    rate: Math.min(1.3, Math.max(0.65, Number(v.rate) || 0.9)),
    pitch: Math.min(1.4, Math.max(0.6, Number(v.pitch) || 1)),
  };
}
export const requestKinds = [
  "water",
  "food",
  "toilet",
  "comfort",
  "help",
  "message",
  "test",
  "posture",
  "face_change",
];
export function eventValue(x) {
  if (!requestKinds.includes(x.kind)) throw Error("Unsupported request");
  return {
    kind: x.kind,
    text: clean(x.text, 250),
    source: ["touch", "face", "hand", "speech", "monitor", "asha"].includes(x.source)
      ? x.source
      : "touch",
    confirmed: x.confirmed === true,
  };
}
export function safeStatus(x = {}) {
  return {
    module: [
      "companion",
      "facespeak",
      "fingerspeak",
      "senseassist",
      "vitalsense",
      "posture",
    ].includes(x.module)
      ? x.module
      : "companion",
    camera: x.camera === true,
    face: x.face === true,
    hands: Math.min(2, Math.max(0, Number(x.hands) || 0)),
    posture: clean(x.posture, 45),
    activity: clean(x.activity, 45),
    bpm:
      Number.isFinite(x.bpm) && x.bpm >= 40 && x.bpm <= 180
        ? Math.round(x.bpm)
        : null,
    calibrated: x.calibrated === true,
  };
}
export function pushEndpoint(value) {
  try {
    const u = new URL(value);
    return (
      u.protocol === "https:" &&
      (/^(fcm\.googleapis\.com|updates\.push\.services\.mozilla\.com|web\.push\.apple\.com)$/.test(
        u.hostname,
      ) ||
        u.hostname.endsWith(".push.apple.com"))
    );
  } catch {
    return false;
  }
}
