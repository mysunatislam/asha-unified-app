import assert from "node:assert/strict";
import fs from "node:fs/promises";
const root = "https://neurobridge-asha-live.vercel.app/api/";
const req = async (body, token, endpoint = "session", method = "POST") => {
  const r = await fetch(root + endpoint, {
    method,
    headers: {
      "content-type": "application/json",
      origin: "https://neurobridge-asha-live.vercel.app",
      ...(token ? { authorization: "Bearer " + token } : {}),
    },
    body: method === "POST" ? JSON.stringify(body) : undefined,
  });
  return { status: r.status, data: await r.json() };
};
const created = await req({
  action: "create",
  label: "API verification",
  assessment: { eyes: "reliable", lips: "reliable", speech: "limited" },
});
assert.equal(created.status, 200);
const p = created.data,
  id = p.patientId;
const report = {};
try {
  report.unauthorized =
    (await req({ patientId: id, action: "heartbeat" })).status === 401;
  report.patientCannotEdit =
    (
      await req(
        { patientId: id, action: "update", label: "Unauthorized" },
        p.patientToken,
      )
    ).status === 403;
  report.caregiverCannotSendPatientEvent =
    (
      await req(
        {
          patientId: id,
          action: "event",
          id: crypto.randomUUID(),
          kind: "water",
          confirmed: true,
        },
        p.caregiverToken,
      )
    ).status === 403;
  const event = {
    patientId: id,
    action: "event",
    id: crypto.randomUUID(),
    kind: "water",
    confirmed: true,
    source: "touch",
    text: "I need water",
  };
  const a = await req(event, p.patientToken),
    b = await req(event, p.patientToken);
  report.idempotency = a.status === 200 && b.data.duplicate === true;
  report.unconfirmedRejected =
    (
      await req(
        { ...event, id: crypto.randomUUID(), confirmed: false },
        p.patientToken,
      )
    ).status === 400;
  const cross = await fetch(root + "session", {
    method: "POST",
    headers: {
      origin: "https://untrusted.example",
      "content-type": "application/json",
    },
    body: JSON.stringify({ action: "create" }),
  });
  report.crossOriginBlocked = cross.status === 403;
  report.cloudConsentRequired =
    (
      await req(
        { patientId: id, text: "Hello", consent: false },
        p.patientToken,
        "asha",
      )
    ).status === 400;
  const ans = await req(
    {
      patientId: id,
      text: "Tell me a gentle joke in one sentence.",
      consent: true,
      module: "companion",
    },
    p.patientToken,
    "asha",
  );
  report.ashaConnected =
    ans.status === 200 && typeof ans.data.reply === "string";
  for (const [key, value] of Object.entries(report))
    assert.equal(value, true, key);
  console.log(JSON.stringify(report, null, 2));
  await fs.writeFile(
    "artifacts/api-verification.json",
    JSON.stringify(report, null, 2),
  );
} finally {
  const deleted = await req(
    { action: "delete", patientId: id, confirm: "DELETE" },
    p.caregiverToken,
  );
  console.log(
    "Removed temporary verification session:",
    deleted.status === 200,
  );
}
