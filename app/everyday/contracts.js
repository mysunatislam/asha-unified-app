/** @typedef {'user'|'camera_estimate'|'device'|'clinician'} EvidenceSource */
/** @typedef {{id:string,module:string,value:unknown,units:string,timestamp:string,source:EvidenceSource,model_id:string,model_version:string,correction_status:string,consent_scope:string,confidence?:number,interval?:unknown}} Evidence */
export const MODULES = ["nutrition", "move", "eyespeak", "care"];
export const FEATURES = Object.freeze({
  nutrition: true,
  move: true,
  eyespeak: true,
  care: true,
  clinic: true,
  foodVision: false,
  offlineAsr: false,
  clinicalRelease: false,
  signedReleasePacks: false,
});

export function evidenceRecord(input, now = new Date()) {
  if (!MODULES.includes(input?.module)) throw Error("Choose a known module.");
  if (
    !["user", "camera_estimate", "device", "clinician"].includes(input.source)
  )
    throw Error("A source is required.");
  if (input.consent_scope !== input.module)
    throw Error("The consent scope must match the module.");
  const serialized = JSON.stringify(input.value);
  if (typeof serialized !== "string" || serialized.length > 50000)
    throw Error("Record is missing or too large.");
  const timestamp = input.timestamp ? new Date(input.timestamp) : now;
  if (!Number.isFinite(timestamp.getTime()))
    throw Error("Invalid record date.");
  const record = {
    id: crypto.randomUUID(),
    module: input.module,
    value: JSON.parse(serialized),
    units: String(input.units || "entry").slice(0, 40),
    timestamp: timestamp.toISOString(),
    source: input.source,
    model_id: String(input.model_id || "manual-entry").slice(0, 100),
    model_version: String(input.model_version || "1").slice(0, 80),
    correction_status: String(input.correction_status || "uncorrected").slice(
      0,
      40,
    ),
    consent_scope: input.consent_scope,
    confidence: null,
  };
  if (Number.isFinite(input.confidence))
    record.confidence = Math.max(0, Math.min(1, input.confidence));
  if (input.interval) record.interval = structuredClone(input.interval);
  return record;
}
