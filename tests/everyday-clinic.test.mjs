import test from "node:test";
import assert from "node:assert/strict";
import { createClinicService, ClinicError } from "../server/clinic.js";
import { clinicMovePlan } from "../app/everyday/clinic.js";
import { resolvePlan } from "../app/everyday/move-engine.js";

function memory() {
  const rows = new Map();
  return {
    rows,
    async read(key) {
      return rows.has(key) ? structuredClone(rows.get(key)) : null;
    },
    async write(key, value) {
      rows.set(key, structuredClone(value));
    },
    async list(prefix, limit = 5000) {
      return [...rows.keys()]
        .filter((key) => key.startsWith(prefix))
        .sort()
        .slice(0, limit);
    },
    async remove(keys) {
      for (const key of keys) rows.delete(key);
    },
  };
}
async function fixture() {
  const store = memory();
  let now = Date.parse("2026-11-10T12:00:00Z");
  const service = createClinicService(store, () => now);
  const admin = await service.create("Example clinic");
  const run = (access, input = {}) =>
    service.run(access.tenant, access.token, input);
  const patient = await run(admin, {
    action: "invite",
    role: "patient",
    label: "Patient A",
  });
  const clinician = await run(admin, { action: "invite", role: "clinician" });
  return {
    store,
    service,
    admin,
    patient,
    clinician,
    run,
    time: (value) => {
      now = value;
    },
    advance: (ms) => {
      now += ms;
    },
  };
}
const forbidden = (status) => (error) =>
  error instanceof ClinicError && error.status === status;
const consent = (f, modules = ["move"]) =>
  f.run(f.patient, { action: "grant", modules, confirmed: true });
const record = (overrides = {}) => ({
  id: "local-record-1",
  module: "move",
  value: { reps: 4, observedMs: 20000 },
  units: "session",
  source: "camera_estimate",
  timestamp: "2026-11-10T12:00:00Z",
  confidence: 0.88,
  model_id: "mediapipe-pose-lite",
  model_version: "float16/1",
  correction_status: "unconfirmed",
  consent_scope: "move",
  ...overrides,
});
const planInput = (patient, overrides = {}) => ({
  action: "plan",
  patientId: patient.patientId,
  exerciseId: "knee-extension",
  side: "left",
  startAngle: 100,
  targetAngle: 150,
  returnAngle: 110,
  holdMs: 500,
  reps: 5,
  clinicianName: "Demo therapist",
  notes: "Patient-specific limits reviewed by author.",
  attested: true,
  ...overrides,
});

test("Clinic capabilities cannot cross tenant boundaries and raw secrets are not persisted", async () => {
  const f = await fixture(),
    second = await f.service.create("Other clinic");
  await assert.rejects(
    () => f.service.run(second.tenant, f.admin.token, { action: "read" }),
    forbidden(401),
  );
  await assert.rejects(
    () => f.service.run(f.admin.tenant, second.token, { action: "read" }),
    forbidden(401),
  );
  await assert.rejects(
    () => f.service.run("../escape", f.admin.token),
    forbidden(401),
  );
  const first = await f.run(f.admin);
  assert.equal(first.patients.length, 1);
  assert.equal((await f.run(second)).patients.length, 0);
  const persisted = JSON.stringify([...f.store.rows]);
  assert.equal(persisted.includes(f.admin.token), false);
  assert.equal(persisted.includes(f.patient.token), false);
});

test("Clinic actions enforce role permissions server-side", async () => {
  const f = await fixture();
  await consent(f);
  for (const access of [f.patient, f.clinician])
    await assert.rejects(
      () => f.run(access, { action: "invite", role: "patient" }),
      forbidden(403),
    );
  for (const access of [f.admin, f.clinician]) {
    await assert.rejects(
      () =>
        f.run(access, { action: "grant", modules: ["move"], confirmed: true }),
      forbidden(403),
    );
    await assert.rejects(
      () => f.run(access, { action: "revoke" }),
      forbidden(403),
    );
    await assert.rejects(
      () =>
        f.run(access, {
          action: "share",
          records: [record()],
          confirmed: true,
        }),
      forbidden(403),
    );
  }
  for (const access of [f.admin, f.patient])
    await assert.rejects(
      () => f.run(access, planInput(f.patient)),
      forbidden(403),
    );
  assert.equal((await f.run(f.clinician)).audit.length, 0);
  assert.equal((await f.run(f.patient)).audit.length, 0);
  assert.ok((await f.run(f.admin)).audit.length >= 4);
});

test("Patients see only their own records even when another patientId is supplied", async () => {
  const f = await fixture();
  const other = await f.run(f.admin, {
    action: "invite",
    role: "patient",
    label: "Patient B",
  });
  await consent(f);
  await f.run(other, { action: "grant", modules: ["move"], confirmed: true });
  await f.run(f.patient, {
    action: "share",
    patientId: other.patientId,
    records: [record()],
    confirmed: true,
  });
  const own = await f.run(f.patient, {
    action: "read",
    patientId: other.patientId,
  });
  assert.deepEqual(
    own.patients.map((p) => p.patientId),
    [f.patient.patientId],
  );
  assert.equal(own.patients[0].records[0].patientId, f.patient.patientId);
  assert.equal((await f.run(other)).patients[0].records.length, 0);
  await assert.rejects(
    () => f.run(f.clinician, planInput({ patientId: "f".repeat(24) })),
    forbidden(404),
  );
});

test("Grant and individual sharing both require explicit confirmation and matching scopes", async () => {
  const f = await fixture();
  await assert.rejects(
    () =>
      f.run(f.patient, {
        action: "share",
        records: [record()],
        confirmed: true,
      }),
    forbidden(403),
  );
  await assert.rejects(
    () => f.run(f.clinician, planInput(f.patient)),
    forbidden(403),
  );
  await assert.rejects(
    () => f.run(f.patient, { action: "grant", modules: ["move"] }),
    forbidden(400),
  );
  await assert.rejects(
    () =>
      f.run(f.patient, { action: "grant", modules: "move", confirmed: true }),
    forbidden(400),
  );
  await consent(f, ["care"]);
  await assert.rejects(
    () =>
      f.run(f.patient, {
        action: "share",
        records: [record()],
        confirmed: true,
      }),
    forbidden(403),
  );
  await consent(f);
  await assert.rejects(
    () => f.run(f.patient, { action: "share", records: [record()] }),
    forbidden(400),
  );
  assert.equal((await f.run(f.clinician)).patients[0].records.length, 0);
  await f.run(f.patient, {
    action: "share",
    records: [record()],
    confirmed: true,
  });
  const row = (await f.run(f.clinician)).patients[0].records[0];
  assert.equal(row.source, "camera_estimate");
  assert.equal(row.correction_status, "unconfirmed");
  assert.equal(row.confidence, 0.88);
});

test("Clinic refuses records with incomplete provenance and batches larger than 50", async () => {
  const f = await fixture();
  await consent(f);
  for (const invalid of [
    record({ source: "verified AI" }),
    record({ consent_scope: "care" }),
    record({ timestamp: "yesterday" }),
    record({ units: "" }),
    record({ model_id: "" }),
    record({ model_version: "" }),
    record({ correction_status: "" }),
    record({ value: undefined }),
  ]) {
    await assert.rejects(
      () =>
        f.run(f.patient, {
          action: "share",
          records: [invalid],
          confirmed: true,
        }),
      forbidden(400),
    );
  }
  await assert.rejects(
    () =>
      f.run(f.patient, {
        action: "share",
        records: Array.from({ length: 51 }, () => record()),
        confirmed: true,
      }),
    forbidden(400),
  );
  assert.equal((await f.run(f.clinician)).patients[0].records.length, 0);
});

test("Revocation immediately hides records and plans and removes existing shared copies", async () => {
  const f = await fixture();
  await consent(f);
  await f.run(f.patient, {
    action: "share",
    records: [record()],
    confirmed: true,
  });
  await f.run(f.clinician, planInput(f.patient));
  assert.equal((await f.run(f.clinician)).patients[0].plans.length, 1);
  await f.run(f.patient, { action: "revoke" });
  const reviewed = (await f.run(f.clinician)).patients[0];
  assert.equal(reviewed.grant, null);
  assert.equal(reviewed.records.length, 0);
  assert.equal(reviewed.plans.length, 0);
  assert.equal(
    (await f.store.list(`asha-everyday/v1/clinics/${f.admin.tenant}/records/`))
      .length,
    0,
  );
  await assert.rejects(
    () =>
      f.run(f.patient, {
        action: "share",
        records: [record()],
        confirmed: true,
      }),
    forbidden(403),
  );
});

test("Revocation fails closed if deleting stored copies fails, and renewed consent does not resurrect old copies", async () => {
  const f = await fixture();
  await consent(f);
  await f.run(f.patient, {
    action: "share",
    records: [record()],
    confirmed: true,
  });
  const remove = f.store.remove;
  f.store.remove = async () => {
    throw Error("Storage deletion failed");
  };
  await assert.rejects(
    () => f.run(f.patient, { action: "revoke" }),
    /deletion failed/,
  );
  assert.equal((await f.run(f.clinician)).patients[0].records.length, 0);
  f.store.remove = remove;
  await consent(f);
  assert.equal((await f.run(f.clinician)).patients[0].records.length, 0);
});

test("Consent changed during a record write causes rollback instead of granting access under stale consent", async () => {
  const f = await fixture();
  await consent(f);
  const write = f.store.write;
  let intercepted = false;
  f.store.write = async (key, value) => {
    await write(key, value);
    if (!intercepted && key.includes("/records/")) {
      intercepted = true;
      await f.run(f.patient, { action: "revoke" });
    }
  };
  await assert.rejects(
    () =>
      f.run(f.patient, {
        action: "share",
        records: [record()],
        confirmed: true,
      }),
    forbidden(409),
  );
  assert.equal((await f.run(f.clinician)).patients[0].records.length, 0);
  assert.equal(
    (await f.store.list(`asha-everyday/v1/clinics/${f.admin.tenant}/records/`))
      .length,
    0,
  );
});

test("Expired roles, workspace and grants deny access without showing private copies", async () => {
  const f = await fixture();
  await consent(f);
  await f.run(f.patient, {
    action: "share",
    records: [record()],
    confirmed: true,
  });
  const patientKey = `asha-everyday/v1/clinics/${f.admin.tenant}/patients/${f.patient.patientId}.json`;
  const p = await f.store.read(patientKey);
  p.grant.expiresAt = "2026-11-10T11:59:59Z";
  await f.store.write(patientKey, p);
  assert.equal((await f.run(f.clinician)).patients[0].records.length, 0);
  await assert.rejects(
    () =>
      f.run(f.patient, {
        action: "share",
        records: [record()],
        confirmed: true,
      }),
    forbidden(403),
  );
  f.advance(31 * 86400000);
  await assert.rejects(() => f.run(f.admin), forbidden(401));
  await assert.rejects(() => f.run(f.patient), forbidden(401));
  await assert.rejects(
    () => f.run(f.clinician, planInput(f.patient)),
    forbidden(401),
  );
});

test("Clinic rejects incorrect movement direction, unseparated limits and invalid rehabilitation parameters", async () => {
  const f = await fixture();
  await consent(f);
  for (const input of [
    planInput(f.patient, { attested: false }),
    planInput(f.patient, { targetAngle: 90 }),
    planInput(f.patient, { targetAngle: 110 }),
    planInput(f.patient, { returnAngle: 145 }),
    planInput(f.patient, { returnAngle: 80 }),
    planInput(f.patient, { startAngle: -1 }),
    planInput(f.patient, { holdMs: 10001 }),
    planInput(f.patient, { reps: 0 }),
    planInput(f.patient, { reps: 2.5 }),
    planInput(f.patient, { exerciseId: "elbow-flexion" }),
  ]) {
    await assert.rejects(() => f.run(f.clinician, input), forbidden(400));
  }
});

test("Clinician-attested server plans convert to the actual Move contract and remain visibly unverified", async () => {
  const f = await fixture();
  await consent(f);
  const result = await f.run(f.clinician, planInput(f.patient));
  const read = await f.run(f.patient);
  assert.equal(read.patients[0].plans.length, 1);
  const converted = clinicMovePlan(read.patients[0].plans[0], f.admin.tenant);
  const movement = resolvePlan(converted, "knee_extension", "left");
  assert.equal(result.plan.professionalIdentityVerified, false);
  assert.equal(converted.value.professionalIdentityVerified, false);
  assert.equal(movement.clinicianName, "Demo therapist");
  assert.equal(movement.limits.start, 100);
  assert.equal(movement.limits.return, 110);
  assert.equal(movement.holdMs, 500);
  assert.equal(movement.repsPerSet, 5);
  assert.equal(resolvePlan(converted, "knee_extension", "right"), null);
  const elbow = await f.run(
    f.clinician,
    planInput(f.patient, {
      exerciseId: "elbow-flexion",
      startAngle: 150,
      targetAngle: 75,
      returnAngle: 140,
    }),
  );
  assert.equal(
    clinicMovePlan(elbow.plan, f.admin.tenant).value.exercises[0].exerciseId,
    "elbow_flexion",
  );
});

test("Only an administrator with exact deletion confirmation can erase a workspace and revoke every invitation", async () => {
  const f = await fixture();
  await consent(f);
  await f.run(f.patient, {
    action: "share",
    records: [record()],
    confirmed: true,
  });
  await f.run(f.clinician, planInput(f.patient));
  const other = await f.service.create("Other workspace");
  for (const role of [f.patient, f.clinician])
    await assert.rejects(
      () => f.run(role, { action: "delete", confirm: "DELETE" }),
      forbidden(403),
    );
  await assert.rejects(
    () => f.run(f.admin, { action: "delete", confirm: "delete" }),
    forbidden(400),
  );
  assert.equal((await f.run(f.admin)).patients.length, 1);
  await f.run(f.admin, { action: "delete", confirm: "DELETE" });
  assert.equal(
    (await f.store.list(`asha-everyday/v1/clinics/${f.admin.tenant}/`)).length,
    0,
  );
  for (const role of [f.admin, f.patient, f.clinician])
    await assert.rejects(() => f.run(role), forbidden(401));
  assert.equal((await f.run(other)).name, "Other workspace");
});
