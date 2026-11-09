import { randomBytes, createHash } from "node:crypto";

const id = () => randomBytes(12).toString("hex");
const token = () => randomBytes(32).toString("base64url");
const digest = (value) =>
  createHash("sha256").update(String(value)).digest("hex");
const validId = (value) => /^[a-f0-9]{24}$/.test(value || "");
const clean = (value, size = 80) =>
  String(value || "")
    .replace(/[\u0000-\u001f]/g, " ")
    .trim()
    .slice(0, size);
const SCOPES = ["nutrition", "move", "eyespeak", "care"];
export class ClinicError extends Error {
  constructor(status, message) {
    super(message);
    this.status = status;
  }
}

export function createClinicService(store, now = () => Date.now()) {
  const root = (tenant) => `asha-everyday/v1/clinics/${tenant}`;
  const key = (tenant, part) => `${root(tenant)}/${part}.json`;
  async function audit(tenant, actor, action, patientId = null) {
    await store.write(key(tenant, `audit/${id()}`), {
      action,
      role: actor.role,
      actor: actor.id,
      patientId,
      at: new Date(now()).toISOString(),
    });
  }
  async function access(tenant, bearer) {
    if (!validId(tenant) || !/^[a-zA-Z0-9_-]{40,60}$/.test(bearer || ""))
      throw new ClinicError(401, "Open your private clinic invitation.");
    const member = await store.read(key(tenant, `members/${digest(bearer)}`));
    if (!member || member.revoked || Date.parse(member.expiresAt) <= now())
      throw new ClinicError(
        401,
        "This clinic invitation is expired or revoked.",
      );
    const profile = await store.read(key(tenant, "profile"));
    if (
      !profile ||
      !Number.isFinite(Date.parse(profile.expiresAt)) ||
      Date.parse(profile.expiresAt) <= now()
    )
      throw new ClinicError(401, "This clinic workspace has expired.");
    return member;
  }
  async function patient(tenant, patientId, member) {
    if (
      !validId(patientId) ||
      (member.role === "patient" && member.patientId !== patientId)
    )
      throw new ClinicError(403, "This patient is outside your access.");
    const value = await store.read(key(tenant, `patients/${patientId}`));
    if (!value) throw new ClinicError(404, "Patient invitation not found.");
    return value;
  }
  async function grant(tenant, patientId, module, member) {
    const p = await patient(tenant, patientId, member);
    if (
      !p.grant?.modules.includes(module) ||
      Date.parse(p.grant.expiresAt) <= now()
    )
      throw new ClinicError(
        403,
        "The patient has not granted this sharing scope.",
      );
    return p;
  }
  function requireRole(member, roles) {
    if (!roles.includes(member.role))
      throw new ClinicError(
        403,
        "Your clinic role cannot perform this action.",
      );
  }
  return {
    async create(name) {
      if (!clean(name)) throw new ClinicError(400, "Enter your clinic name.");
      const tenant = id(),
        secret = token();
      const member = {
        id: id(),
        role: "admin",
        expiresAt: new Date(now() + 30 * 86400000).toISOString(),
      };
      await store.write(key(tenant, "profile"), {
        name: clean(name),
        createdAt: new Date(now()).toISOString(),
        expiresAt: member.expiresAt,
      });
      await store.write(key(tenant, `members/${digest(secret)}`), member);
      await audit(tenant, member, "clinic.created");
      return {
        tenant,
        token: secret,
        role: "admin",
        expiresAt: member.expiresAt,
      };
    },
    async run(tenant, bearer, input = {}) {
      const member = await access(tenant, bearer);
      const action = input.action || "read";
      if (action === "delete") {
        requireRole(member, ["admin"]);
        if (input.confirm !== "DELETE")
          throw new ClinicError(400, "Confirm workspace deletion.");
        await store.remove(await store.list(root(tenant) + "/", 5000));
        return { deleted: true };
      }
      if (action === "invite") {
        requireRole(member, ["admin"]);
        if (!["clinician", "patient"].includes(input.role))
          throw new ClinicError(400, "Select clinician or patient.");
        const secret = token(),
          patientId = input.role === "patient" ? id() : null;
        const invited = {
          id: id(),
          role: input.role,
          patientId,
          expiresAt: new Date(now() + 30 * 86400000).toISOString(),
        };
        await store.write(key(tenant, `members/${digest(secret)}`), invited);
        if (patientId)
          await store.write(key(tenant, `patients/${patientId}`), {
            patientId,
            label: clean(input.label) || "Patient",
            grant: null,
          });
        await audit(tenant, member, "member.invited", patientId);
        return {
          tenant,
          token: secret,
          role: invited.role,
          patientId,
          expiresAt: invited.expiresAt,
        };
      }
      if (action === "grant" || action === "revoke") {
        requireRole(member, ["patient"]);
        const p = await patient(tenant, member.patientId, member);
        if (action === "revoke") {
          // Revoke access first, before deleting private copies. A failed deletion cannot restore access.
          p.grant = null;
          await store.write(
            key(tenant, `patients/${member.patientId}`),
            p,
            true,
          );
          const keys = await store.list(
            `${root(tenant)}/records/${member.patientId}/`,
            5000,
          );
          await store.remove(keys);
        } else {
          if (input.confirmed !== true)
            throw new ClinicError(400, "Explicit patient consent is required.");
          if (!Array.isArray(input.modules))
            throw new ClinicError(400, "Select sharing modules.");
          const modules = [...new Set(input.modules)].filter((m) =>
            SCOPES.includes(m),
          );
          p.grant = {
            id: id(),
            modules,
            at: new Date(now()).toISOString(),
            expiresAt: new Date(now() + 30 * 86400000).toISOString(),
          };
        }
        await store.write(key(tenant, `patients/${member.patientId}`), p, true);
        await audit(tenant, member, `sharing.${action}`, member.patientId);
        return { grant: p.grant };
      }
      if (action === "share") {
        requireRole(member, ["patient"]);
        const rows =
          Array.isArray(input.records) && input.records.length <= 50
            ? input.records
            : [];
        if (input.confirmed !== true || !rows.length)
          throw new ClinicError(400, "Choose records and confirm sharing.");
        for (const row of rows) {
          if (
            !row ||
            row.value === undefined ||
            !SCOPES.includes(row.module) ||
            row.consent_scope !== row.module ||
            !["user", "camera_estimate", "device", "clinician"].includes(
              row.source,
            ) ||
            !Number.isFinite(Date.parse(row.timestamp)) ||
            ![
              row.units,
              row.model_id,
              row.model_version,
              row.correction_status,
            ].every(
              (v) =>
                typeof v === "string" && v.trim().length > 0 && v.length <= 120,
            ) ||
            JSON.stringify(row).length > 12000
          )
            throw new ClinicError(400, "Record provenance is incomplete.");
          await grant(tenant, member.patientId, row.module, member);
        }
        const consent = (await patient(tenant, member.patientId, member)).grant;
        const written = [];
        try {
          for (const row of rows) {
            const recordKey = key(
              tenant,
              `records/${member.patientId}/${id()}`,
            );
            await store.write(recordKey, {
              ...row,
              patientId: member.patientId,
              grantId: consent.id,
              sharedAt: new Date(now()).toISOString(),
            });
            written.push(recordKey);
          }
          const latest = (await patient(tenant, member.patientId, member))
            .grant;
          if (!latest || latest.id !== consent.id)
            throw new ClinicError(
              409,
              "Sharing permission changed. Choose your records again.",
            );
        } catch (error) {
          await store.remove(written);
          throw error;
        }
        await audit(tenant, member, "records.shared", member.patientId);
        return { shared: rows.length };
      }
      if (action === "plan") {
        requireRole(member, ["clinician"]);
        await grant(tenant, input.patientId, "move", member);
        if (input.attested !== true)
          throw new ClinicError(
            400,
            "Confirm you are qualified to set this rehabilitation plan.",
          );
        if (
          ![
            "knee-extension",
            "elbow-flexion",
            "shoulder-flexion",
            "sit-to-stand",
          ].includes(input.exerciseId)
        )
          throw new ClinicError(400, "Choose a supported exercise.");
        const start = Number(input.startAngle),
          target = Number(input.targetAngle),
          reps = Number(input.reps),
          returnAngle =
            input.returnAngle == null ? start : Number(input.returnAngle);
        const direction = input.exerciseId === "elbow-flexion" ? -1 : 1;
        const holdMs = input.holdMs == null ? 250 : Number(input.holdMs);
        if (
          ![start, target, returnAngle, reps, holdMs].every(Number.isFinite) ||
          start < 0 ||
          start > 180 ||
          target < 0 ||
          target > 180 ||
          returnAngle < 0 ||
          returnAngle > 180 ||
          (target - start) * direction <= 10 ||
          (target - returnAngle) * direction <= 10 ||
          (returnAngle - start) * direction < 0 ||
          !Number.isInteger(reps) ||
          reps < 1 ||
          reps > 50 ||
          holdMs < 0 ||
          holdMs > 10000
        )
          throw new ClinicError(
            400,
            "Check the movement direction, range and repetitions.",
          );
        const value = {
          id: id(),
          patientId: input.patientId,
          exerciseId: input.exerciseId,
          startAngle: start,
          targetAngle: target,
          returnAngle,
          holdMs,
          reps: Math.round(reps),
          side: input.side === "right" ? "right" : "left",
          notes: clean(input.notes, 500),
          source: "clinician",
          clinicianId: member.id,
          clinicianName:
            clean(input.clinicianName) || "Clinician " + member.id.slice(0, 6),
          professionalIdentityVerified: false,
          at: new Date(now()).toISOString(),
        };
        await store.write(
          key(tenant, `plans/${input.patientId}/${value.id}`),
          value,
        );
        await audit(tenant, member, "plan.created", input.patientId);
        return { plan: value };
      }
      if (action === "read") {
        const profile = await store.read(key(tenant, "profile"));
        if (Date.parse(profile?.expiresAt) <= now())
          throw new ClinicError(401, "Clinic demo expired.");
        const patients =
          member.role === "patient"
            ? [await patient(tenant, member.patientId, member)]
            : (
                await Promise.all(
                  (await store.list(root(tenant) + "/patients/", 300)).map(
                    (p) => store.read(p),
                  ),
                )
              ).filter(Boolean);
        const visible = [];
        for (const p of patients) {
          const allowed = p.grant && Date.parse(p.grant.expiresAt) > now();
          const records = allowed
            ? (
                await Promise.all(
                  (
                    await store.list(
                      `${root(tenant)}/records/${p.patientId}/`,
                      500,
                    )
                  ).map((k) => store.read(k)),
                )
              ).filter(
                (r) =>
                  r &&
                  r.grantId === p.grant.id &&
                  p.grant.modules.includes(r.module) &&
                  Date.parse(r.sharedAt) > now() - 30 * 86400000,
              )
            : [];
          const plans =
            allowed && p.grant.modules.includes("move")
              ? (
                  await Promise.all(
                    (
                      await store.list(
                        `${root(tenant)}/plans/${p.patientId}/`,
                        100,
                      )
                    ).map((k) => store.read(k)),
                  )
                ).filter(Boolean)
              : [];
          visible.push({ ...p, records, plans });
        }
        const auditRows =
          member.role === "admin"
            ? (
                await Promise.all(
                  (await store.list(root(tenant) + "/audit/", 100)).map((p) =>
                    store.read(p),
                  ),
                )
              ).filter(Boolean)
            : [];
        return {
          name: profile?.name,
          role: member.role,
          patientId: member.patientId,
          patients: visible,
          audit: auditRows,
          professionalIdentityVerification: "not-configured",
        };
      }
      throw new ClinicError(400, "Unknown clinic action.");
    },
  };
}
