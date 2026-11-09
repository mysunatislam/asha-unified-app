import test from "node:test";
import assert from "node:assert/strict";
import {
  clinicCredentials,
  clinicInviteURL,
  consumeClinicInvitation,
  clinicMovePlan,
  shareableClinicRecord,
} from "../app/everyday/clinic.js";
import { resolvePlan } from "../app/everyday/move-engine.js";

const credentials = {
  tenant: "a".repeat(24),
  token: "b".repeat(43),
  role: "patient",
  patientId: "c".repeat(24),
};

test("Clinic invitations validate role-scoped capabilities and discard extraneous fields", () => {
  assert.deepEqual(
    clinicCredentials({ ...credentials, apiKey: "unrelated" }),
    credentials,
  );
  assert.throws(() => clinicCredentials({ ...credentials, patientId: "" }));
  assert.throws(() => clinicCredentials({ ...credentials, role: "superuser" }));
  assert.throws(() =>
    clinicCredentials({ ...credentials, tenant: "../tenant" }),
  );
  assert.throws(() => clinicCredentials({ ...credentials, token: "short" }));
  assert.equal(
    clinicCredentials({ ...credentials, role: "admin" }).patientId,
    undefined,
  );
});

test("Clinic role links use the Everyday fragment and erase it before parsing", () => {
  const value = clinicInviteURL(
    credentials,
    "https://asha.example/current?other=1",
  );
  const url = new URL(value);
  assert.equal(url.pathname, "/everyday.html");
  assert.equal(url.search, "");
  const calls = [];
  const history = {
    state: { route: "clinic" },
    replaceState: (...args) => calls.push(args),
  };
  assert.deepEqual(consumeClinicInvitation(url, history), credentials);
  assert.deepEqual(calls[0], [history.state, "", "/everyday.html#clinic"]);
  assert.throws(() =>
    consumeClinicInvitation(
      {
        hash: "#clinic=malformed%",
        pathname: "/everyday.html",
        search: "?lang=bn",
      },
      history,
    ),
  );
  assert.equal(calls[1][2], "/everyday.html?lang=bn#clinic");
  assert.equal(consumeClinicInvitation({ hash: "#move" }, history), null);
  assert.throws(() => clinicInviteURL(credentials, "javascript:alert(1)"));
});

function serverPlan(overrides = {}) {
  return {
    id: "d".repeat(24),
    patientId: credentials.patientId,
    clinicianId: "e".repeat(24),
    source: "clinician",
    at: "2026-11-10T12:00:00.000Z",
    clinicianName: "Demo clinician",
    exerciseId: "knee-extension",
    side: "right",
    startAngle: 100,
    targetAngle: 150,
    returnAngle: 110,
    holdMs: 500,
    reps: 5,
    notes: "<untrusted note>",
    ...overrides,
  };
}

test("Clinic plans preserve clinician attestation and map to Move without asserting verified identity", () => {
  const plan = clinicMovePlan(serverPlan(), credentials.tenant);
  assert.equal(plan.value.professionalIdentityVerified, false);
  assert.equal(plan.value.patientId, credentials.patientId);
  assert.equal(plan.value.notes, "<untrusted note>");
  const resolved = resolvePlan(plan, "knee_extension", "right");
  assert.equal(resolved.holdMs, 500);
  assert.equal(resolved.repsPerSet, 5);
  assert.equal(resolved.limits.return, 110);
  assert.equal(
    clinicMovePlan(
      serverPlan({ clinicianName: "" }),
      credentials.tenant,
    ).value.clinicianName.startsWith("Unverified clinician role"),
    true,
  );
});

test("Clinic plans reject wrong movement direction, incompatible limits, incomplete provenance and fractional reps", () => {
  assert.throws(() =>
    clinicMovePlan(serverPlan({ source: "user" }), credentials.tenant),
  );
  assert.throws(() =>
    clinicMovePlan(serverPlan({ at: "unknown" }), credentials.tenant),
  );
  assert.throws(() =>
    clinicMovePlan(serverPlan({ targetAngle: 90 }), credentials.tenant),
  );
  assert.throws(() =>
    clinicMovePlan(serverPlan({ returnAngle: 145 }), credentials.tenant),
  );
  assert.throws(() =>
    clinicMovePlan(serverPlan({ reps: 4.2 }), credentials.tenant),
  );
  assert.doesNotThrow(() =>
    clinicMovePlan(
      serverPlan({
        exerciseId: "elbow-flexion",
        startAngle: 155,
        targetAngle: 70,
        returnAngle: 145,
      }),
      credentials.tenant,
    ),
  );
});

test("Only selected record fields and valid source provenance can be shared", () => {
  const record = {
    id: "local-1",
    module: "move",
    value: { repetitions: 4 },
    units: "session",
    source: "camera_estimate",
    timestamp: "2026-11-10T12:00:00Z",
    consent_scope: "move",
    confidence: 0.9,
    model_id: "mediapipe-pose-lite",
    model_version: "float16/1",
    correction_status: "unconfirmed",
    unrelatedSecret: "never-share",
  };
  assert.equal(shareableClinicRecord(record).unrelatedSecret, undefined);
  assert.equal(shareableClinicRecord(record).correction_status, "unconfirmed");
  assert.throws(() =>
    shareableClinicRecord({ ...record, consent_scope: "care" }),
  );
  assert.throws(() =>
    shareableClinicRecord({ ...record, source: "AI verified" }),
  );
  assert.throws(() => shareableClinicRecord({ ...record, model_id: "" }));
  assert.throws(() =>
    shareableClinicRecord({ ...record, value: "x".repeat(13000) }),
  );
});
