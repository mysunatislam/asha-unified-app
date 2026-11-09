import { EXERCISES, movementConfig } from "./move-engine.js";

const SESSION_KEY = "asha.everyday.clinic.session.v1";
const MODULES = ["nutrition", "move", "eyespeak", "care"];
const ROLES = ["admin", "clinician", "patient"];
const EXERCISE_IDS = {
  "knee-extension": "knee_extension",
  "elbow-flexion": "elbow_flexion",
  "shoulder-flexion": "shoulder_flexion",
  "sit-to-stand": "sit_to_stand",
};

/** Invitations are capability credentials, not an identity or professional licence. */
export function clinicCredentials(value) {
  if (
    !value ||
    typeof value !== "object" ||
    Array.isArray(value) ||
    !/^[a-f0-9]{24}$/.test(value.tenant || "") ||
    !/^[a-zA-Z0-9_-]{40,60}$/.test(value.token || "") ||
    !ROLES.includes(value.role)
  )
    throw Error("This clinic invitation is invalid.");
  const result = { tenant: value.tenant, token: value.token, role: value.role };
  if (value.role === "patient") {
    if (!/^[a-f0-9]{24}$/.test(value.patientId || ""))
      throw Error("This patient invitation is invalid.");
    result.patientId = value.patientId;
  }
  return result;
}

export function clinicInviteURL(value, origin) {
  const url = new URL("/everyday.html", origin);
  if (!["https:", "http:"].includes(url.protocol))
    throw Error("Use an HTTPS application address.");
  url.hash = `clinic=${encodeURIComponent(JSON.stringify(clinicCredentials(value)))}`;
  return url.href;
}

/** Remove the fragment before parsing, rendering, or sending any network request. */
export function consumeClinicInvitation(location, history) {
  if (!location.hash.startsWith("#clinic=")) return null;
  const encoded = location.hash.slice("#clinic=".length);
  history.replaceState(
    history.state,
    "",
    location.pathname + location.search + "#clinic",
  );
  try {
    return clinicCredentials(JSON.parse(decodeURIComponent(encoded)));
  } catch {
    throw Error(
      "This clinic invitation is invalid. Ask for a fresh invitation.",
    );
  }
}

export function clinicMovePlan(plan, tenant) {
  const exerciseId = EXERCISE_IDS[plan?.exerciseId];
  if (
    !exerciseId ||
    plan.source !== "clinician" ||
    !Number.isFinite(Date.parse(plan.at)) ||
    !/^[a-f0-9]{24}$/.test(plan.patientId || "") ||
    !/^[a-f0-9]{24}$/.test(plan.id || "")
  )
    throw Error("This movement plan is incomplete.");
  const side = plan.side === "right" ? "right" : "left";
  const limits = {
    start: Number(plan.startAngle),
    target: Number(plan.targetAngle),
    return: Number(plan.returnAngle ?? plan.startAngle),
  };
  const holdMs = Number(plan.holdMs ?? 250);
  const repsPerSet = Number(plan.reps);
  movementConfig(exerciseId, { ...limits, holdMs });
  if (!Number.isInteger(repsPerSet) || repsPerSet < 1 || repsPerSet > 50)
    throw Error("This movement plan has invalid repetitions.");
  return {
    id: plan.id,
    source: "clinician",
    value: {
      clinicianName:
        typeof plan.clinicianName === "string" && plan.clinicianName.trim()
          ? plan.clinicianName.trim()
          : `Unverified clinician role ${String(plan.clinicianId || "").slice(0, 8)}`,
      approvedAt: plan.at,
      clinicTenant: tenant,
      patientId: plan.patientId,
      professionalIdentityVerified: false,
      notes: typeof plan.notes === "string" ? plan.notes : "",
      exercises: [{ exerciseId, side, limits, holdMs, repsPerSet }],
    },
  };
}

/** Only the selected record and its existing provenance leave this device. */
export function shareableClinicRecord(record) {
  if (
    !record ||
    !MODULES.includes(record.module) ||
    record.consent_scope !== record.module ||
    !["user", "camera_estimate", "device", "clinician"].includes(
      record.source,
    ) ||
    !Number.isFinite(Date.parse(record.timestamp)) ||
    record.value === undefined
  )
    throw Error("This record does not have complete provenance.");
  if (
    !["units", "model_id", "model_version", "correction_status"].every(
      (name) => typeof record[name] === "string" && record[name].trim(),
    )
  )
    throw Error("This record does not have complete provenance.");
  const row = {};
  for (const field of [
    "id",
    "module",
    "value",
    "units",
    "timestamp",
    "source",
    "confidence",
    "interval",
    "model_id",
    "model_version",
    "correction_status",
    "consent_scope",
  ])
    if (record[field] !== undefined) row[field] = record[field];
  if (JSON.stringify(row).length > 12000)
    throw Error(
      "This record is too large to share in this demo. Export it locally instead.",
    );
  return row;
}

function el(tag, text = "", className = "") {
  const node = document.createElement(tag);
  node.textContent = text;
  node.className = className;
  return node;
}
function button(label, action, className = "secondary") {
  const node = el("button", label, className);
  node.type = "button";
  node.addEventListener("click", action);
  return node;
}
function field(label, control) {
  const wrapper = el("label", "", "field");
  control.setAttribute("aria-label", label);
  wrapper.append(el("span", label), control);
  return wrapper;
}
function input(type = "text", value = "", attributes = {}) {
  const node = document.createElement("input");
  node.type = type;
  node.value = value;
  for (const [key, val] of Object.entries(attributes))
    node.setAttribute(key, String(val));
  return node;
}
function select(options) {
  const node = document.createElement("select");
  for (const [value, label] of options) {
    const option = el("option", label);
    option.value = value;
    node.append(option);
  }
  return node;
}
function checked(label) {
  const node = input("checkbox");
  const wrapper = el("label", "", "field");
  wrapper.append(node, el("span", label));
  return { node, wrapper };
}
function preview(value, length = 160) {
  const text = typeof value === "string" ? value : JSON.stringify(value);
  return String(text ?? "").slice(0, length);
}

export function mount(host, ctx) {
  const language =
    typeof ctx.language === "function" ? ctx.language() : ctx.language;
  const bn = language === "bn" || language === "bn-BD";
  const t = (en, bangla) => (bn ? bangla : en);
  const moduleName = (key) =>
    ({
      nutrition: t("Nutrition", "পুষ্টি"),
      move: t("Move", "মুভ"),
      eyespeak: t("EyeSpeak", "আইস্পিক"),
      care: t("Care", "কেয়ার"),
    })[key] || key;
  const roleName = (key) =>
    ({
      admin: t("Workspace admin", "ওয়ার্কস্পেস প্রশাসক"),
      clinician: t("Clinician role", "চিকিৎসকের ভূমিকা"),
      patient: t("Patient", "রোগী"),
    })[key] || key;
  let alive = true,
    busy = false,
    credentials = null,
    view = null,
    localRecords = [],
    invitation = null;
  const controllers = new Set();
  let storageAvailable = true;
  try {
    credentials = consumeClinicInvitation(window.location, window.history);
  } catch (error) {
    invitation = { error: error.message };
    try {
      sessionStorage.removeItem(SESSION_KEY);
    } catch {
      storageAvailable = false;
    }
  }
  try {
    if (credentials)
      sessionStorage.setItem(SESSION_KEY, JSON.stringify(credentials));
    else if (!invitation?.error) {
      const saved = sessionStorage.getItem(SESSION_KEY);
      if (saved) credentials = clinicCredentials(JSON.parse(saved));
    }
  } catch {
    storageAvailable = false;
    try {
      sessionStorage.removeItem(SESSION_KEY);
    } catch {
      /* Use in-memory access for this view. */
    }
  }

  const root = el("section", "", "clinic-workspace");
  const header = el("section", "", "card");
  header.append(
    el("h2", t("Clinic workspace", "ক্লিনিক ওয়ার্কস্পেস")),
    el(
      "p",
      t(
        "Share selected records, review progress, and exchange an attested movement plan.",
        "নির্বাচিত তথ্য ভাগ করুন, অগ্রগতি দেখুন এবং সম্মত নড়াচড়ার পরিকল্পনা আদান-প্রদান করুন।",
      ),
      "muted",
    ),
    el(
      "p",
      t(
        "Capability-access demo. A private link grants a role; it does not verify identity or professional qualifications. This workspace is not a continuously staffed monitoring service.",
        "এটি ব্যক্তিগত লিংকভিত্তিক প্রবেশের ডেমো। লিংক পরিচয় বা পেশাগত যোগ্যতা যাচাই করে না। এই ওয়ার্কস্পেসে সার্বক্ষণিক পর্যবেক্ষক নেই।",
      ),
      "notice",
    ),
  );
  const status = el("p", "", "notice");
  status.setAttribute("role", "status");
  status.setAttribute("aria-live", "polite");
  const toolbar = el("div", "", "actions");
  const body = el("div");
  root.append(header, status, toolbar, body);
  host.replaceChildren(root);

  function notify(message) {
    if (!alive) return;
    status.textContent = message;
    ctx.notify?.(message);
  }
  function remember(value) {
    credentials = clinicCredentials(value);
    try {
      sessionStorage.setItem(SESSION_KEY, JSON.stringify(credentials));
    } catch {
      storageAvailable = false;
      notify(
        t(
          "This browser cannot retain the private invitation for this tab. Keep your invitation securely.",
          "এই ব্রাউজার ট্যাবে ব্যক্তিগত আমন্ত্রণ সংরক্ষণ করতে পারছে না। আমন্ত্রণটি নিরাপদে রাখুন।",
        ),
      );
    }
  }
  async function request(input, access = credentials) {
    const controller = new AbortController();
    controllers.add(controller);
    const timeout = setTimeout(() => controller.abort(), 20000);
    try {
      const response = await fetch("/api/clinic", {
        method: "POST",
        cache: "no-store",
        credentials: "same-origin",
        redirect: "error",
        signal: controller.signal,
        headers: {
          "Content-Type": "application/json",
          ...(access ? { Authorization: `Bearer ${access.token}` } : {}),
        },
        body: JSON.stringify({
          ...input,
          ...(access ? { tenant: access.tenant } : {}),
        }),
      });
      const result = await response.json().catch(() => ({}));
      if (!response.ok)
        throw Error(
          result.error ||
            t(
              "Clinic request failed. Try again.",
              "ক্লিনিক অনুরোধ ব্যর্থ হয়েছে। আবার চেষ্টা করুন।",
            ),
        );
      return result;
    } catch (error) {
      if (error.name === "AbortError")
        throw Error(
          t(
            "The clinic request timed out. Your local records are unchanged. Try again.",
            "ক্লিনিক অনুরোধের সময় শেষ। স্থানীয় তথ্য অপরিবর্তিত আছে। আবার চেষ্টা করুন।",
          ),
        );
      throw error;
    } finally {
      clearTimeout(timeout);
      controllers.delete(controller);
    }
  }
  async function act(work) {
    if (busy || !alive) return;
    busy = true;
    root.setAttribute("aria-busy", "true");
    const buttons = [...root.querySelectorAll("button")];
    buttons.forEach((node) => {
      node.dataset.wasDisabled = node.disabled ? "1" : "0";
      node.disabled = true;
    });
    status.textContent = t("Connecting…", "সংযোগ হচ্ছে…");
    try {
      await work();
    } catch (error) {
      notify(
        error.message ||
          t("The request could not be completed.", "অনুরোধটি সম্পন্ন হয়নি।"),
      );
    } finally {
      busy = false;
      root.removeAttribute("aria-busy");
      if (alive)
        for (const node of buttons)
          if (node.isConnected) {
            node.disabled = node.dataset.wasDisabled === "1";
            delete node.dataset.wasDisabled;
          }
    }
  }
  async function refresh(message) {
    const result = await request({ action: "read" });
    if (!alive) return;
    // The server, not the invitation's label, determines the actual role.
    if (!ROLES.includes(result.role))
      throw Error(
        t(
          "The clinic role could not be confirmed.",
          "ক্লিনিকের ভূমিকা নিশ্চিত হয়নি।",
        ),
      );
    credentials.role = result.role;
    if (result.role === "patient") credentials.patientId = result.patientId;
    remember(credentials);
    view = result;
    render();
    status.textContent =
      message ||
      t(
        "Workspace connected. Only consented records are shown.",
        "ওয়ার্কস্পেস সংযুক্ত। শুধু সম্মত তথ্য দেখানো হচ্ছে।",
      );
  }
  async function copy(value) {
    try {
      await navigator.clipboard.writeText(value);
      notify(
        t(
          "Private link copied. Share it only with the intended person.",
          "ব্যক্তিগত লিংক কপি হয়েছে। শুধু নির্ধারিত ব্যক্তিকে দিন।",
        ),
      );
    } catch {
      notify(
        t(
          "Copy the private link from the field.",
          "ঘর থেকে ব্যক্তিগত লিংক কপি করুন।",
        ),
      );
    }
  }
  function invitationCard(value, label) {
    const card = el("section", "", "card");
    card.append(
      el("h3", label),
      el(
        "p",
        t(
          "Anyone with this link can use this role until it expires. Do not publish it.",
          "মেয়াদ শেষ হওয়ার আগে এই লিংকধারী ভূমিকা ব্যবহার করতে পারবেন। প্রকাশ করবেন না।",
        ),
        "notice",
      ),
    );
    const link = input("text", clinicInviteURL(value, window.location.origin), {
      readonly: true,
      autocomplete: "off",
    });
    link.style.width = "100%";
    link.style.minWidth = "0";
    link.addEventListener("focus", () => link.select());
    card.append(
      field(t("Private invitation", "ব্যক্তিগত আমন্ত্রণ"), link),
      button(t("Copy link", "লিংক কপি"), () => copy(link.value)),
    );
    if (value.expiresAt)
      card.append(
        el(
          "p",
          `${t("Expires", "মেয়াদ")}: ${new Date(value.expiresAt).toLocaleString(bn ? "bn-BD" : undefined)}`,
          "muted",
        ),
      );
    return card;
  }
  function renderToolbar() {
    toolbar.replaceChildren();
    if (!credentials) return;
    toolbar.append(
      button(t("Refresh workspace", "ওয়ার্কস্পেস রিফ্রেশ"), () =>
        act(() => refresh()),
      ),
      button(t("Copy my private link", "আমার ব্যক্তিগত লিংক কপি"), () =>
        copy(clinicInviteURL(credentials, window.location.origin)),
      ),
      button(t("Leave this workspace", "এই ওয়ার্কস্পেস থেকে বের হোন"), () => {
        credentials = null;
        view = null;
        invitation = null;
        localRecords = [];
        try {
          sessionStorage.removeItem(SESSION_KEY);
        } catch {
          storageAvailable = false;
        }
        render();
        status.textContent = t(
          "Private credentials removed from this tab. Open an invitation to reconnect.",
          "এই ট্যাবের ব্যক্তিগত প্রবেশতথ্য মুছে গেছে। আবার যুক্ত হতে আমন্ত্রণ খুলুন।",
        );
      }),
    );
  }
  function renderConnect() {
    const card = el("section", "", "card");
    card.append(
      el("h3", t("Create a demo workspace", "ডেমো ওয়ার্কস্পেস তৈরি")),
    );
    const form = el("form", "", "module-form-grid");
    const name = input("text", "", {
      required: true,
      maxlength: 80,
      placeholder: t(
        "Clinic or organisation name",
        "ক্লিনিক বা প্রতিষ্ঠানের নাম",
      ),
      autocomplete: "organization",
    });
    const consent = checked(
      t(
        "I want to create a capability-access clinic demo and keep its admin link private.",
        "আমি লিংকভিত্তিক ক্লিনিক ডেমো তৈরি করতে এবং প্রশাসকের লিংক ব্যক্তিগত রাখতে চাই।",
      ),
    );
    consent.node.required = true;
    const submit = el(
      "button",
      t("Create workspace", "ওয়ার্কস্পেস তৈরি"),
      "primary",
    );
    submit.type = "submit";
    form.append(
      field(t("Workspace name", "ওয়ার্কস্পেসের নাম"), name),
      consent.wrapper,
      submit,
    );
    form.addEventListener("submit", (event) => {
      event.preventDefault();
      if (!form.reportValidity()) return;
      act(async () => {
        remember(
          await request(
            {
              action: "create",
              name: name.value.trim(),
              confirmed: consent.node.checked,
            },
            null,
          ),
        );
        await refresh(
          t(
            "Workspace created. Save your private admin link before inviting anyone.",
            "ওয়ার্কস্পেস তৈরি হয়েছে। কাউকে আমন্ত্রণের আগে ব্যক্তিগত প্রশাসক লিংক সংরক্ষণ করুন।",
          ),
        );
      });
    });
    card.append(
      form,
      el(
        "p",
        t(
          "Have an invitation? Open that private link in this browser. This tab stores credentials only for its current browser session.",
          "আমন্ত্রণ আছে? এই ব্রাউজারে ব্যক্তিগত লিংক খুলুন। প্রবেশতথ্য শুধু বর্তমান ট্যাবের সেশনে থাকে।",
        ),
        "muted",
      ),
    );
    body.append(card);
  }
  function renderAdmin() {
    const card = el("section", "", "card");
    card.append(el("h3", t("Invite a person", "একজনকে আমন্ত্রণ")));
    const form = el("form", "", "module-form-grid");
    const role = select([
      ["patient", t("Patient", "রোগী")],
      [
        "clinician",
        t(
          "Clinician role · identity unverified",
          "চিকিৎসকের ভূমিকা · পরিচয় যাচাই হয়নি",
        ),
      ],
    ]);
    const label = input("text", "", {
      maxlength: 80,
      placeholder: t("Use an alias if possible", "সম্ভব হলে ছদ্মনাম দিন"),
    });
    const submit = el(
      "button",
      t("Create private invitation", "ব্যক্তিগত আমন্ত্রণ তৈরি"),
      "primary",
    );
    submit.type = "submit";
    form.append(
      field(t("Role", "ভূমিকা"), role),
      field(t("Patient label", "রোগীর পরিচিতি"), label),
      submit,
    );
    form.addEventListener("submit", (event) => {
      event.preventDefault();
      act(async () => {
        invitation = await request({
          action: "invite",
          role: role.value,
          label: label.value,
        });
        await refresh(
          t(
            "Invitation created. Copy and privately share it; no message was sent automatically.",
            "আমন্ত্রণ তৈরি হয়েছে। কপি করে ব্যক্তিগতভাবে দিন; স্বয়ংক্রিয় বার্তা পাঠানো হয়নি।",
          ),
        );
      });
    });
    card.append(form);
    body.append(card);
    if (invitation && !invitation.error)
      body.append(
        invitationCard(
          invitation,
          t("New private invitation", "নতুন ব্যক্তিগত আমন্ত্রণ"),
        ),
      );
    const audit = el("details", "", "card");
    audit.append(
      el("summary", t("Workspace activity log", "ওয়ার্কস্পেসের কার্যক্রম")),
    );
    for (const row of (view.audit || [])
      .slice()
      .sort((a, b) => String(b.at).localeCompare(String(a.at))))
      audit.append(
        el(
          "p",
          `${row.at} · ${row.action} · ${roleName(row.role)}${row.patientId ? ` · ${row.patientId}` : ""}`,
          "muted",
        ),
      );
    if (!view.audit?.length)
      audit.append(
        el(
          "p",
          t("No activity is available yet.", "এখনও কার্যক্রম নেই।"),
          "muted",
        ),
      );
    body.append(audit);
    const deletion = el("details", "", "card");
    deletion.append(
      el("summary", t("Delete this workspace", "এই ওয়ার্কস্পেস মুছে দিন")),
    );
    deletion.append(
      el(
        "p",
        t(
          "This permanently removes this workspace’s invitations, shared record copies, movement plans, and activity log. Records on patient devices remain on those devices.",
          "এতে এই ওয়ার্কস্পেসের আমন্ত্রণ, ভাগ করা তথ্যের কপি, পরিকল্পনা ও কার্যক্রম স্থায়ীভাবে মুছবে। রোগীর যন্ত্রের স্থানীয় তথ্য সেখানেই থাকবে।",
        ),
        "notice",
      ),
    );
    const confirmation = input("text", "", {
      autocomplete: "off",
      placeholder: "DELETE",
    });
    deletion.append(
      field(
        t(
          "Type DELETE to confirm permanent deletion",
          "স্থায়ীভাবে মুছতে DELETE লিখুন",
        ),
        confirmation,
      ),
      button(
        t("Permanently delete workspace", "ওয়ার্কস্পেস স্থায়ীভাবে মুছুন"),
        () =>
          act(async () => {
            if (confirmation.value !== "DELETE")
              throw Error(
                t(
                  "Type DELETE exactly before deleting this workspace.",
                  "ওয়ার্কস্পেস মুছতে ঠিক DELETE লিখুন।",
                ),
              );
            await request({ action: "delete", confirm: "DELETE" });
            credentials = null;
            view = null;
            invitation = null;
            localRecords = [];
            try {
              sessionStorage.removeItem(SESSION_KEY);
            } catch {
              storageAvailable = false;
            }
            render();
            notify(
              t(
                "Workspace deleted. Its private invitations no longer work.",
                "ওয়ার্কস্পেস মুছে গেছে। এর ব্যক্তিগত আমন্ত্রণ আর চলবে না।",
              ),
            );
          }),
        "secondary danger",
      ),
    );
    body.append(deletion);
  }
  function renderPatient(patient) {
    const card = el("section", "", "card");
    card.append(
      el(
        "h3",
        t("Choose what this clinic may receive", "এই ক্লিনিক কী পাবে বেছে নিন"),
      ),
    );
    card.append(
      el(
        "p",
        t(
          "A scope permits sharing; it does not upload your history. Select individual records below and confirm before they are sent. Scope changes apply to future access; records may already have been viewed.",
          "অনুমতি দিলেই ইতিহাস আপলোড হয় না। নিচে নির্দিষ্ট তথ্য নির্বাচন করে পাঠানোর আগে নিশ্চিত করুন। অনুমতি বদল ভবিষ্যৎ প্রবেশে প্রযোজ্য; আগের তথ্য ইতিমধ্যে দেখা হয়ে থাকতে পারে।",
        ),
        "muted",
      ),
    );
    const scopes = el("fieldset");
    scopes.append(
      el(
        "legend",
        t("Explicit module scopes", "প্রতিটি মডিউলের স্পষ্ট অনুমতি"),
      ),
    );
    const active =
      patient.grant && Date.parse(patient.grant.expiresAt) > Date.now()
        ? patient.grant.modules
        : [];
    const boxes = MODULES.map((key) => {
      const check = checked(moduleName(key));
      check.node.checked = active.includes(key);
      check.node.value = key;
      scopes.append(check.wrapper);
      return check.node;
    });
    const confirmed = checked(
      t(
        "I confirm these sharing scopes for this clinic for up to 30 days.",
        "সর্বোচ্চ ৩০ দিনের জন্য এই ক্লিনিকের তথ্য ভাগের অনুমতি নিশ্চিত করছি।",
      ),
    );
    const apply = button(
      t("Confirm sharing scopes", "অনুমতি নিশ্চিত"),
      () =>
        act(async () => {
          if (!confirmed.node.checked)
            throw Error(
              t(
                "Confirm your consent before applying scopes.",
                "অনুমতি প্রয়োগের আগে সম্মতি নিশ্চিত করুন।",
              ),
            );
          await request({
            action: "grant",
            modules: boxes
              .filter((node) => node.checked)
              .map((node) => node.value),
            confirmed: true,
          });
          await refresh(
            t(
              "Sharing scopes updated. Choose records to upload below.",
              "তথ্য ভাগের অনুমতি বদলেছে। নিচে আপলোডের তথ্য বেছে নিন।",
            ),
          );
        }),
      "primary",
    );
    const revoke = checked(
      t(
        "I want to revoke all scopes and remove the clinic’s shared record copies.",
        "সব অনুমতি বাতিল এবং ক্লিনিকের ভাগ করা তথ্যের কপি সরাতে চাই।",
      ),
    );
    const remove = button(
      t("Revoke sharing and remove copies", "অনুমতি বাতিল ও কপি সরান"),
      () =>
        act(async () => {
          if (!revoke.node.checked)
            throw Error(
              t(
                "Confirm revocation first.",
                "আগে বাতিলের সিদ্ধান্ত নিশ্চিত করুন।",
              ),
            );
          await request({ action: "revoke" });
          await refresh(
            t(
              "Sharing revoked and server copies removed. Your local records remain.",
              "অনুমতি বাতিল ও সার্ভারের কপি সরানো হয়েছে। স্থানীয় তথ্য রয়েছে।",
            ),
          );
        }),
    );
    card.append(scopes, confirmed.wrapper, apply, revoke.wrapper, remove);
    body.append(card);
    renderLocalRecords(active);
  }
  function renderLocalRecords(active) {
    const card = el("section", "", "card");
    card.append(
      el(
        "h3",
        t("Choose local records to share", "ভাগ করার স্থানীয় তথ্য বেছে নিন"),
      ),
    );
    const list = el("div");
    card.append(list);
    const selected = new Map();
    const confirmation = checked(
      t(
        "I reviewed these selected records and want to send copies to this clinic.",
        "নির্বাচিত তথ্য পর্যালোচনা করেছি এবং এই ক্লিনিকে কপি পাঠাতে চাই।",
      ),
    );
    const submit = button(
      t("Share selected records", "নির্বাচিত তথ্য ভাগ করুন"),
      () =>
        act(async () => {
          if (!confirmation.node.checked || !selected.size)
            throw Error(
              t(
                "Choose at least one record and confirm sharing.",
                "অন্তত একটি তথ্য নির্বাচন করে ভাগ করা নিশ্চিত করুন।",
              ),
            );
          if (selected.size > 50)
            throw Error(
              t(
                "Choose at most 50 records at a time.",
                "একবারে সর্বোচ্চ ৫০টি তথ্য বেছে নিন।",
              ),
            );
          const records = [...selected.values()].map(shareableClinicRecord);
          if (
            JSON.stringify({
              action: "share",
              records,
              confirmed: true,
              tenant: credentials.tenant,
            }).length > 19000
          )
            throw Error(
              t(
                "This batch is too large. Select fewer records and share in smaller batches.",
                "এই দফার তথ্য বড়। কম তথ্য নির্বাচন করে ছোট দফায় ভাগ করুন।",
              ),
            );
          const result = await request({
            action: "share",
            records,
            confirmed: true,
          });
          await refresh(
            t(
              `${result.shared} selected records shared.`,
              `${result.shared}টি নির্বাচিত তথ্য ভাগ হয়েছে।`,
            ),
          );
        }),
      "primary",
    );
    submit.disabled = !active.length;
    card.append(
      confirmation.wrapper,
      submit,
      button(t("Reload local history", "স্থানীয় ইতিহাস আবার আনুন"), () =>
        act(async () => {
          await loadLocal();
          render();
          status.textContent = t(
            "Local history refreshed.",
            "স্থানীয় ইতিহাস রিফ্রেশ হয়েছে।",
          );
        }),
      ),
    );
    if (!active.length)
      list.append(
        el(
          "p",
          t(
            "Confirm at least one module scope above first.",
            "প্রথমে উপরে অন্তত একটি মডিউলের অনুমতি নিশ্চিত করুন।",
          ),
          "notice",
        ),
      );
    let eligible = 0;
    for (const record of localRecords) {
      if (!active.includes(record.module)) continue;
      let shareable = true;
      try {
        shareableClinicRecord(record);
      } catch {
        shareable = false;
      }
      const row = el("section", "", "card");
      const checkbox = checked(
        `${moduleName(record.module)} · ${new Date(record.timestamp).toLocaleString(bn ? "bn-BD" : undefined)} · ${record.source} · ${record.correction_status || "unconfirmed"}`,
      );
      checkbox.node.disabled = !shareable;
      checkbox.node.addEventListener("change", () => {
        if (checkbox.node.checked) selected.set(record.id, record);
        else selected.delete(record.id);
      });
      row.append(checkbox.wrapper, el("p", preview(record.value), "muted"));
      const detail = el("details");
      detail.append(
        el("summary", t("Review record and source", "তথ্য ও উৎস দেখুন")),
      );
      const pre = el("pre", JSON.stringify(record, null, 2));
      pre.style.whiteSpace = "pre-wrap";
      pre.style.overflowWrap = "anywhere";
      detail.append(pre);
      row.append(detail);
      if (!shareable)
        row.append(
          el(
            "p",
            t(
              "This record is incomplete or exceeds the sharing limit. Export it locally instead.",
              "তথ্যটি অসম্পূর্ণ বা ভাগ করার সীমার বড়। স্থানীয়ভাবে এক্সপোর্ট করুন।",
            ),
            "notice",
          ),
        );
      else eligible++;
      list.append(row);
    }
    if (active.length && !eligible)
      list.append(
        el(
          "p",
          t(
            "No eligible local history yet. Save a record in Nutrition, Move, EyeSpeak, or Care, then reload here.",
            "এখনও উপযুক্ত স্থানীয় ইতিহাস নেই। পুষ্টি, মুভ, আইস্পিক বা কেয়ারে তথ্য সংরক্ষণ করে এখানে আবার আনুন।",
          ),
          "muted",
        ),
      );
    body.append(card);
  }
  function renderRecords(patient, card) {
    const details = el("details");
    details.append(
      el(
        "summary",
        `${t("Shared records", "ভাগ করা তথ্য")} · ${patient.records?.length || 0}`,
      ),
    );
    const records = [...(patient.records || [])].sort((a, b) =>
      String(b.timestamp).localeCompare(String(a.timestamp)),
    );
    for (const row of records) {
      const item = el("details", "", "card");
      item.append(
        el(
          "summary",
          `${moduleName(row.module)} · ${new Date(row.timestamp).toLocaleString(bn ? "bn-BD" : undefined)} · ${row.source}`,
        ),
      );
      item.append(
        el(
          "p",
          `${t("Status", "অবস্থা")}: ${row.correction_status || "unconfirmed"} · ${t("Model", "মডেল")}: ${row.model_id || "unspecified"} ${row.model_version || ""}`,
          "muted",
        ),
      );
      const pre = el("pre", JSON.stringify(row, null, 2));
      pre.style.whiteSpace = "pre-wrap";
      pre.style.overflowWrap = "anywhere";
      item.append(pre);
      details.append(item);
    }
    if (!records.length)
      details.append(
        el(
          "p",
          t(
            "No records are currently shared with this workspace.",
            "এই ওয়ার্কস্পেসে এখন কোনো তথ্য ভাগ করা নেই।",
          ),
          "muted",
        ),
      );
    const sessions = records.filter(
      (row) => row.module === "move" && Number.isFinite(row.value?.reps),
    );
    if (sessions.length > 1)
      details.append(
        el(
          "p",
          t(
            `Recent shared Move sessions: ${sessions[0].value.reps} and ${sessions[1].value.reps} repetitions. Sessions may use different limits or camera placement; these are not recovery scores.`,
            `সাম্প্রতিক ভাগ করা মুভ সেশন: ${sessions[0].value.reps} এবং ${sessions[1].value.reps} বার। সীমা বা ক্যামেরা আলাদা হতে পারে; এটি সুস্থতার স্কোর নয়।`,
          ),
          "notice",
        ),
      );
    card.append(details);
  }
  function renderPlans(patient, card) {
    const list = el("section");
    list.append(el("h4", t("Movement plans", "নড়াচড়ার পরিকল্পনা")));
    for (const plan of [...(patient.plans || [])].sort((a, b) =>
      String(b.at).localeCompare(String(a.at)),
    )) {
      const item = el("section", "", "card");
      const exercise = EXERCISES[EXERCISE_IDS[plan.exerciseId]];
      item.append(
        el(
          "h4",
          exercise
            ? bn
              ? exercise.labelBn
              : exercise.label
            : String(plan.exerciseId),
        ),
        el(
          "p",
          `${plan.side} · ${plan.startAngle}° → ${plan.targetAngle}° → ${plan.returnAngle ?? plan.startAngle}° · ${plan.reps} ${t("repetitions per set", "বার প্রতি সেটে")}`,
        ),
        el(
          "p",
          `${t("Attested by role", "ভূমিকার ঘোষণা")}: ${plan.clinicianName || plan.clinicianId} · ${new Date(plan.at).toLocaleString(bn ? "bn-BD" : undefined)} · ${t("Professional identity is not verified by this demo.", "এই ডেমো পেশাগত পরিচয় যাচাই করেনি।")}`,
          "muted",
        ),
      );
      if (plan.notes) item.append(el("p", plan.notes));
      let converted;
      try {
        converted = clinicMovePlan(plan, credentials.tenant);
      } catch {
        item.append(
          el(
            "p",
            t(
              "This plan needs its author to correct incomplete movement limits.",
              "পরিকল্পনাকারীকে অসম্পূর্ণ নড়াচড়ার সীমা সংশোধন করতে হবে।",
            ),
            "notice",
          ),
        );
      }
      if (
        converted &&
        credentials.role === "patient" &&
        credentials.patientId === patient.patientId
      ) {
        item.append(
          button(
            t("Use this plan in Move", "মুভে এই পরিকল্পনা ব্যবহার"),
            () =>
              act(async () => {
                if (!ctx.setPlan)
                  throw Error(
                    t(
                      "Plan loading is unavailable. Export this plan for review.",
                      "পরিকল্পনা লোড হচ্ছে না। পর্যালোচনার জন্য এক্সপোর্ট করুন।",
                    ),
                  );
                await ctx.setPlan(converted);
                notify(
                  t(
                    "Plan selected. Open Move, choose its exercise and side, then select Clinician plan.",
                    "পরিকল্পনা নির্বাচিত। মুভ খুলে নড়াচড়া ও পাশ বেছে চিকিৎসকের পরিকল্পনা নির্বাচন করুন।",
                  ),
                );
              }),
            "primary",
          ),
        );
      }
      item.append(
        button(t("Export plan", "পরিকল্পনা এক্সপোর্ট"), () => {
          const content = JSON.stringify(
            {
              plan,
              movePlan: converted || null,
              professionalIdentityVerified: false,
            },
            null,
            2,
          );
          if (ctx.download)
            ctx.download(
              `asha-plan-${plan.id}.json`,
              content,
              "application/json",
            );
          else
            notify(
              t(
                "Downloads are unavailable in this browser.",
                "এই ব্রাউজারে ডাউনলোড পাওয়া যাচ্ছে না।",
              ),
            );
        }),
      );
      list.append(item);
    }
    if (!patient.plans?.length)
      list.append(
        el(
          "p",
          t(
            "No active shared movement plan.",
            "সক্রিয় ভাগ করা পরিকল্পনা নেই।",
          ),
          "muted",
        ),
      );
    card.append(list);
  }
  function renderPlanForm() {
    const eligible = (view.patients || []).filter(
      (p) =>
        p.grant?.modules?.includes("move") &&
        Date.parse(p.grant.expiresAt) > Date.now(),
    );
    const card = el("section", "", "card");
    card.append(
      el(
        "h3",
        t(
          "Create an attested movement plan",
          "ঘোষণাসহ নড়াচড়ার পরিকল্পনা তৈরি",
        ),
      ),
    );
    if (!eligible.length) {
      card.append(
        el(
          "p",
          t(
            "A patient must grant Move sharing before a plan can be created.",
            "পরিকল্পনার আগে রোগীকে মুভ ভাগের অনুমতি দিতে হবে।",
          ),
          "notice",
        ),
      );
      body.append(card);
      return;
    }
    const form = el("form", "", "module-form-grid");
    const patient = select(
      eligible.map((p) => [
        p.patientId,
        `${p.label} · ${p.patientId.slice(0, 8)}`,
      ]),
    );
    const clinician = input("text", "", {
      required: true,
      maxlength: 80,
      autocomplete: "name",
    });
    const exercise = select(
      Object.entries(EXERCISE_IDS).map(([key, value]) => [
        key,
        bn ? EXERCISES[value].labelBn : EXERCISES[value].label,
      ]),
    );
    const side = select([
      ["left", t("Left", "বাম")],
      ["right", t("Right", "ডান")],
    ]);
    const angleAttrs = { required: true, min: 0, max: 180, step: 1 };
    const start = input("number", "", angleAttrs),
      target = input("number", "", angleAttrs),
      returned = input("number", "", angleAttrs);
    const reps = input("number", "", {
      required: true,
      min: 1,
      max: 50,
      step: 1,
    });
    const hold = input("number", "", {
      required: true,
      min: 0,
      max: 10,
      step: 0.1,
    });
    const notes = el("textarea");
    notes.maxLength = 500;
    notes.rows = 3;
    const attested = checked(
      t(
        "I attest that I am qualified to set these rehabilitation limits, have reviewed this patient, and chose this plan. My identity is not verified by this demo.",
        "আমি ঘোষণা করছি যে পুনর্বাসনের এই সীমা নির্ধারণের যোগ্য, রোগীকে পর্যালোচনা করে পরিকল্পনা বেছেছি। এই ডেমো আমার পরিচয় যাচাই করেনি।",
      ),
    );
    attested.node.required = true;
    const guide = el("p", "", "notice");
    const updateGuide = () => {
      guide.textContent =
        EXERCISES[EXERCISE_IDS[exercise.value]].direction === "decrease"
          ? t(
              "Elbow flexion: the target angle must be lower than the starting angle, with more than 10° separation.",
              "কনুই ভাঁজ: লক্ষ্য কোণ শুরুর চেয়ে কম এবং ব্যবধান ১০°-এর বেশি হতে হবে।",
            )
          : t(
              "This movement: the target angle must be higher than the starting angle, with more than 10° separation.",
              "এই নড়াচড়ায় লক্ষ্য কোণ শুরুর চেয়ে বেশি এবং ব্যবধান ১০°-এর বেশি হতে হবে।",
            );
    };
    exercise.addEventListener("change", updateGuide);
    updateGuide();
    const submit = el(
      "button",
      t("Save attested plan", "ঘোষিত পরিকল্পনা সংরক্ষণ"),
      "primary",
    );
    submit.type = "submit";
    form.append(
      field(t("Patient", "রোগী"), patient),
      field(t("Your name · self-declared", "আপনার নাম · স্বঘোষিত"), clinician),
      field(t("Movement", "নড়াচড়া"), exercise),
      field(t("Side", "পাশ"), side),
      guide,
      field(t("Starting angle · degrees", "শুরুর কোণ · ডিগ্রি"), start),
      field(t("Target angle · degrees", "লক্ষ্য কোণ · ডিগ্রি"), target),
      field(t("Return angle · degrees", "ফিরে আসার কোণ · ডিগ্রি"), returned),
      field(t("Repetitions per set", "প্রতি সেটে পুনরাবৃত্তি"), reps),
      field(t("Target hold · seconds", "লক্ষ্যে ধরে রাখা · সেকেন্ড"), hold),
      field(t("Instructions", "নির্দেশনা"), notes),
      attested.wrapper,
      submit,
    );
    form.addEventListener("submit", (event) => {
      event.preventDefault();
      if (!form.reportValidity()) return;
      act(async () => {
        const limits = {
          start: Number(start.value),
          target: Number(target.value),
          return: Number(returned.value),
          holdMs: Number(hold.value) * 1000,
        };
        movementConfig(EXERCISE_IDS[exercise.value], limits);
        await request({
          action: "plan",
          patientId: patient.value,
          exerciseId: exercise.value,
          side: side.value,
          startAngle: limits.start,
          targetAngle: limits.target,
          returnAngle: limits.return,
          holdMs: limits.holdMs,
          reps: Number(reps.value),
          notes: notes.value,
          clinicianName: clinician.value.trim(),
          attested: attested.node.checked,
        });
        await refresh(
          t(
            "Plan saved. The patient can review and select it in their private workspace.",
            "পরিকল্পনা সংরক্ষিত। রোগী নিজের ব্যক্তিগত ওয়ার্কস্পেসে দেখে নির্বাচন করতে পারবেন।",
          ),
        );
      });
    });
    card.append(form);
    body.append(card);
  }
  function render() {
    if (!alive) return;
    renderToolbar();
    body.replaceChildren();
    if (!credentials) {
      renderConnect();
      return;
    }
    if (!view) {
      const card = el("section", "", "card");
      card.append(
        el(
          "p",
          t(
            "Your invitation is stored in this tab. Connect to load permitted data.",
            "আমন্ত্রণটি এই ট্যাবে রয়েছে। অনুমোদিত তথ্য আনতে সংযোগ করুন।",
          ),
        ),
        button(
          t("Connect workspace", "ওয়ার্কস্পেস সংযুক্ত করুন"),
          () => act(() => refresh()),
          "primary",
        ),
      );
      body.append(card);
      return;
    }
    const info = el("section", "", "card");
    info.append(
      el("h3", String(view.name || t("Clinic", "ক্লিনিক"))),
      el(
        "p",
        `${roleName(view.role)} · ${t("Workspace", "ওয়ার্কস্পেস")} ${credentials.tenant.slice(0, 8)}`,
        "muted",
      ),
    );
    if (view.storageMode === "local-memory")
      info.append(
        el(
          "p",
          t(
            "Local preview: this clinic workspace is held in server memory and resets when the preview server restarts. This is not durable clinical storage.",
            "স্থানীয় প্রিভিউ: ক্লিনিক সার্ভারের মেমোরিতে আছে, সার্ভার পুনরায় চালালে মুছে যাবে। এটি স্থায়ী চিকিৎসাতথ্য সংরক্ষণ নয়।",
          ),
          "notice",
        ),
      );
    if (!storageAvailable)
      info.append(
        el(
          "p",
          t(
            "Tab credential storage is unavailable; keep your private link.",
            "ট্যাবের প্রবেশতথ্য সংরক্ষণ হচ্ছে না; ব্যক্তিগত লিংক রাখুন।",
          ),
          "notice",
        ),
      );
    body.append(info);
    if (view.role === "admin") renderAdmin();
    if (view.role === "patient") {
      const patient = view.patients?.find(
        (p) => p.patientId === credentials.patientId,
      );
      if (patient) renderPatient(patient);
    }
    if (view.role === "clinician") renderPlanForm();
    for (const patient of view.patients || []) {
      const card = el("section", "", "card");
      card.append(
        el("h3", patient.label || t("Patient", "রোগী")),
        el(
          "p",
          `${t("Patient ID", "রোগীর আইডি")}: ${patient.patientId}`,
          "muted",
        ),
      );
      const active =
        patient.grant && Date.parse(patient.grant.expiresAt) > Date.now();
      card.append(
        el(
          "p",
          active
            ? `${t("Shared scopes", "ভাগের অনুমতি")}: ${patient.grant.modules.map(moduleName).join(", ") || t("none", "নেই")} · ${t("until", "পর্যন্ত")} ${new Date(patient.grant.expiresAt).toLocaleDateString(bn ? "bn-BD" : undefined)}`
            : t("No active sharing consent.", "সক্রিয় তথ্য ভাগের সম্মতি নেই।"),
          "notice",
        ),
      );
      renderRecords(patient, card);
      renderPlans(patient, card);
      body.append(card);
    }
    if (!view.patients?.length)
      body.append(
        el(
          "p",
          t(
            "No patients have been invited yet.",
            "এখনও রোগী আমন্ত্রণ করা হয়নি।",
          ),
          "notice",
        ),
      );
  }
  async function loadLocal() {
    if (!ctx.store?.list) return;
    const rows = await Promise.all(
      MODULES.map((module) => ctx.store.list(module)),
    );
    if (alive)
      localRecords = rows
        .flat()
        .sort((a, b) => String(b.timestamp).localeCompare(String(a.timestamp)));
  }
  render();
  if (invitation?.error) status.textContent = invitation.error;
  void act(async () => {
    await loadLocal();
    if (credentials) await refresh();
    else {
      render();
      if (invitation?.error) status.textContent = invitation.error;
      else
        status.textContent = t(
          "Open a private invitation or create a workspace.",
          "ব্যক্তিগত আমন্ত্রণ খুলুন অথবা ওয়ার্কস্পেস তৈরি করুন।",
        );
    }
  });
  return () => {
    alive = false;
    for (const controller of controllers) controller.abort();
    controllers.clear();
    host.replaceChildren();
  };
}
