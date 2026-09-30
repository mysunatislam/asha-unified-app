import { Perception } from "./perception.js";
import { GuidedCalibration } from "./calibration.js";
import { faceStudio, paintFaceStudio } from "./face-studio.js";
import { RequestGate, recommendations, clamp } from "./signals.js";
import { CompanionGuide, responsePlan, confirmationMatches } from "./companion-guide.js";
import { BlinkIntent, RAPID_BLINK, CONFIRM_BLINK } from "./blink-intent.js";
import { instantGreeting } from "./fast-reply.js";
import {
  supportOptions,
  supportGoals,
  normalizeSupport,
  supportSummary,
} from "./support-profile.js";
const $ = (id) => document.getElementById(id),
  esc = (x) =>
    String(x ?? "").replace(
      /[&<>"']/g,
      (c) =>
        ({
          "&": "&amp;",
          "<": "&lt;",
          ">": "&gt;",
          '"': "&quot;",
          "'": "&#39;",
        })[c],
    );
const site = new URL("../", import.meta.url),
  api =
    location.hostname === "mysunatislam.github.io"
      ? "https://neurobridge-asha-live.vercel.app/api/"
      : new URL("api/", site).href;
const read = (k, f) => {
    try {
      return JSON.parse(localStorage.getItem("asha_live_" + k)) ?? f;
    } catch {
      return f;
    }
  },
  save = (k, v) => localStorage.setItem("asha_live_" + k, JSON.stringify(v));
const names = {
  companion: "Asha companion",
  facespeak: "FaceSpeak · NeuroFace Sense",
  fingerspeak: "FingerSpeak",
  vitalsense: "VitalSense",
  senseassist: "SenseAssist",
  posture: "Body posture",
};
const moduleGuidance = {
  facespeak: "FaceSpeak shows your live eyes, eyebrows, smile, lips and head movement. A caregiver can calibrate a head, smile or deliberate blink response here. A practiced triple blink asks for help; a separate deliberate blink confirms after my question.",
  fingerspeak: "FingerSpeak can preview one or two hands. To speak personalized phrases, record and test your own gestures in the FingerSpeak studio.",
  vitalsense: "VitalSense shows an experimental camera pulse trend. It is not a medical vital reading and never sends an emergency request.",
  senseassist: "SenseAssist can help clarify speech that was hard to understand. Review what was heard before Asha suggests a possible meaning.",
  posture: "Body posture shows camera-based position and movement. A sustained change can lead to a gentle question, not an automatic diagnosis or caregiver request.",
};
const needs = {
  water: "I need water",
  food: "I need food",
  toilet: "I need to go to the toilet",
  comfort: "I need help getting comfortable",
  help: "Please come here",
  test: "Connection test",
  posture: "Sustained posture change · please check in",
  face_change: "Sustained facial movement change · please check in",
};
let view = "welcome",
  previousView = "welcome",
  module = "facespeak",
  patient = read("patient", null),
  carePatients = read("care", []),
  profile = null,
  careId = carePatients[0]?.patientId,
  careData = null,
  calibration = null,
  editing = false,
  lastPoll = 0,
  pollBusy = false,
  history = [],
  lastPaint = 0,
  recognition = null,
  speechCandidate = "",
  speechHeard = "",
  speechSession = 0;
let fingerNeuralLive = false,
  personalProfileId = null,
  demoSession = read("demoPatientId", "") === patient?.patientId && !!patient;
const demoAssessment = {
  leftHand: "reliable", rightHand: "reliable", wrist: "reliable",
  fingers: "reliable", eyes: "reliable", lips: "reliable",
  head: "reliable", speech: "limited", canSee: true, canHear: true,
};
const demoProfile = {
  patientId: "local-demo", label: "Demo patient", assessment: demoAssessment,
  supportContext: { categories: [], goals: [], note: "" },
  recommendation: { primary: "facespeak", suggested: ["facespeak", "fingerspeak", "senseassist"] },
  voice: { name: "", rate: 0.9 },
};
const personalId = () => patient?.patientId || profile?.patientId || "local-demo";
function ensureFingerStudio() {
  if ($("fingerStudio")) return;
  const frame = document.createElement("iframe");
  frame.id = "fingerStudio";
  frame.className = "finger-frame";
  frame.title = "FingerSpeak full calibration, speak and evaluation studio";
  frame.style.visibility = "hidden";
  $("fingerStudioHost").setAttribute("aria-busy", "true");
  const loading = document.createElement("p");
  loading.id = "fingerLoading";
  loading.className = "card muted";
  loading.setAttribute("role", "status");
  loading.textContent = "Loading the full FingerSpeak studio…";
  frame.allow = "camera 'none'; microphone 'none'";
  frame.src = new URL(
    "neuroface/fingerspeak.html?embedded=1&profile=" +
      encodeURIComponent(patient?.patientId || "local"),
    site,
  ).href;
  $("fingerStudioHost").append(loading, frame);
  setTimeout(() => {
    if (loading.isConnected)
      loading.textContent =
        "FingerSpeak is still loading. Check your connection and reload if this continues.";
  }, 30000);
}
window.addEventListener("message", (e) => {
  if (
    e.origin !== location.origin ||
    e.source !== $("fingerStudio")?.contentWindow
  )
    return;
  const d = e.data || {};
  if (d.type === "asha-hand-ready") {
    e.source.ashaSetTheme?.(settings.theme);
    $("fingerStudio").dataset.ready = "true";
    $("fingerStudio").style.visibility = "visible";
    $("fingerLoading")?.remove();
    $("fingerStudioHost").setAttribute("aria-busy", "false");
  }
  if (d.type === "asha-hand-open-face") {
    module = "facespeak";
    $("modeBadge").textContent = names[module];
    show("details");
  }
  if (d.type === "asha-hand-height" && Number.isFinite(d.height))
    $("fingerStudio").style.height =
      Math.min(12000, Math.max(700, d.height)) + "px";
  if (d.type === "asha-hand-start" && !perception.running) startMonitor();
  if (d.type === "asha-hand-speak") say(String(d.text || "").slice(0, 250));
  if (d.type === "asha-hand-live") {
    fingerNeuralLive = !!d.enabled;
    perception.neuralHandActive = fingerNeuralLive;
    perception.setActiveModule(module);
  }
  if (d.type === "asha-hand-phrase" && ["patient", "details"].includes(view)) {
    const phrase = String(d.text || "")
      .trim()
      .slice(0, 250);
    if (!phrase) return;
    if (gate.pending && /^(yes|okay|ok)[.!\s]*$/i.test(phrase))
      confirmRequest();
    else if (gate.pending && /^no[.!\s]*$/i.test(phrase))
      $("confirmNo").click();
    else propose("message", "hand", phrase);
  }
});
let settings = read("settings", {
    theme: matchMedia("(prefers-color-scheme: dark)").matches
      ? "dark"
      : "light",
    cloud: false,
    proactive: true,
    scan: false,
    voice: "",
    rate: 0.9,
    language: "auto",
    speechLanguage: "en-US",
  }),
  trained = read("calibration_" + patient?.patientId, null),
  handMaps = read("handmap_" + patient?.patientId, {}),
  pendingHandTraining = null;
const conversation = [];
const ashaResponseSessions = new WeakMap();
const gate = new RequestGate(),
  guide = new CompanionGuide(),
  perception = new Perception($("camera"), $("overlay"));
let blinkIntent = new BlinkIntent(trained?.baseline?.blinkIntent),
  speechVersion = 0,
  wakeTimer,
  scanIndex = -1,
  scanKind = null,
  lastProactive = -Infinity;
const captureDock = document.createElement("div");
captureDock.className = "capture-dock";
captureDock.setAttribute("aria-hidden", "true");
document.body.append(captureDock);
const viewport = document.querySelector(".camera-viewport"),
  cameraPanel = viewport.parentElement;
function toast(t) {
  $("toast").textContent = t;
  $("toast").hidden = false;
  clearTimeout(toast.timer);
  toast.timer = setTimeout(() => ($("toast").hidden = true), 5500);
}
function theme() {
  document.documentElement.dataset.theme = settings.theme;
  $("themeButton").textContent = settings.theme === "dark" ? "☀" : "☾";
  save("settings", settings);
  $("fingerStudio")?.contentWindow?.ashaSetTheme?.(settings.theme);
}
theme();
function show(id) {
  if (!$(id)) return;
  if (["patient", "details"].includes(id) && !profile) {
    startDemo(id === "details" ? module : null);
    return;
  }
  if (id === "caregiver" && perception.running) {
    perception.stop();
    monitorUI(false);
  }
  previousView = view;
  view = id;
  if (id === "details") cameraPanel.insertBefore(viewport, $("cameraStatus"));
  else captureDock.append(viewport);
  for (const v of document.querySelectorAll(".view")) v.hidden = v.id !== id;
  $("bottomNav").hidden = ["welcome", "setup"].includes(id);
  document
    .querySelectorAll("[data-view]")
    .forEach((b) => b.classList.toggle("active", b.dataset.view === id));
  window.scrollTo(0, 0);
  if (id === "details") renderModule();
  if (id === "caregiver") {
    renderCareList();
    pollCare();
  }
  if (id === "settings") renderSettings();
  if (id === "patient") {
    pollPatient();
    heartbeat();
  }
  if (previousView !== id) {
    guide.clear();
    cancelRequest();
    $("chatPanel").hidden = true;
  }
  if (profile && settings.proactive && previousView !== id && ["patient", "details", "settings"].includes(id)) {
    const description = id === "patient"
      ? "This is your patient page. I will explain your choices aloud after support starts. You can repeat my last message at any time."
      : id === "details"
        ? "These are your live details. " + (moduleGuidance[module] || "You can explore every module here. The camera stays shared across them.")
        : "This is Settings. A caregiver can choose my voice or pause my check-ins here.";
    say(description);
    guide.lastPrompt = performance.now();
  }
  $("main").focus({ preventScroll: true });
}
document
  .querySelectorAll("[data-view]")
  .forEach((b) => (b.onclick = () => show(b.dataset.view)));
$("themeButton").onclick = () => {
  settings.theme = settings.theme === "dark" ? "light" : "dark";
  theme();
};
$("settingsButton").onclick = () => show("settings");
$("settingsBack").onclick = () =>
  show(previousView === "settings" ? "patient" : previousView);
$("beginSetup").onclick = $("addPatient").onclick = () => startSetup();
$("exploreDemo").onclick = () => startDemo("facespeak");
$("openPatient").onclick = () =>
  patient ? openPatient() : openLink("patient");
$("openCare").onclick = () => show("caregiver");
$("detailsButton").onclick = $("changeMode").onclick = () => show("details");
function credential() {
  return view === "caregiver"
    ? carePatients.find((x) => x.patientId === careId)
    : patient;
}
async function call(
  endpoint,
  { cred = credential(), body, method = body ? "POST" : "GET" } = {},
) {
  const u = new URL(endpoint, api);
  if (!body && cred) u.searchParams.set("patientId", cred.patientId);
  const r = await fetch(u, {
    method,
    cache: "no-store",
    headers: {
      ...(body ? { "content-type": "application/json" } : {}),
      ...(cred ? { authorization: "Bearer " + cred.token } : {}),
    },
    body: body
      ? JSON.stringify({
          ...body,
          ...(cred ? { patientId: cred.patientId } : {}),
        })
      : undefined,
    signal: AbortSignal.timeout(endpoint === "asha" ? 55000 : 28000),
  });
  const d = await r.json().catch(() => ({}));
  if (!r.ok) {
    const error = Error(d.error || `Connection failed (${r.status})`);
    error.status = r.status;
    throw error;
  }
  return d;
}
function privateLink(role, id, token) {
  const u = new URL("./", site);
  u.searchParams.set("role", role);
  u.hash = new URLSearchParams({ patientId: id, token });
  return u.href;
}
function parseLink(value, expected) {
  const u = new URL(value);
  const approvedSites = [
    site,
    new URL("https://neurobridge-asha-live.vercel.app/"),
    new URL("https://mysunatislam.github.io/neurobridge-asha-unified-app/"),
  ];
  if (
    !approvedSites.some(
      (root) =>
        u.origin === root.origin && u.pathname.startsWith(root.pathname),
    )
  )
    throw Error("Use a private link from this Asha app.");
  const q = new URLSearchParams(u.hash.slice(1)),
    id = q.get("patientId"),
    token = q.get("token"),
    role = u.searchParams.get("role");
  if (
    !/^[a-f0-9]{24}$/.test(id || "") ||
    !/^[A-Za-z0-9_-]{40,60}$/.test(token || "") ||
    !["patient", "caregiver"].includes(role) ||
    (expected && role !== expected)
  )
    throw Error(
      "Paste the complete " +
        (expected || "private") +
        " link, including its access code.",
    );
  return { patientId: id, token, role };
}
async function acceptLink(c) {
  const d = await call("session", { cred: c });
  if (d.role !== c.role)
    throw Error("This private link is for a different role.");
  if (c.role === "patient") {
    patient = { patientId: c.patientId, token: c.token };
    save("patient", patient);
    demoSession = read("demoPatientId", "") === c.patientId;
    profile = d.profile;
    loadPersonal();
    renderPatient();
    show("patient");
  } else {
    const prior = carePatients.find((x) => x.patientId === c.patientId);
    carePatients = carePatients.filter((x) => x.patientId !== c.patientId);
    carePatients.push({ ...prior, ...c, label: d.profile.label });
    save("care", carePatients);
    careId = c.patientId;
    show("caregiver");
  }
}
let linkRole = "patient";
function openLink(role) {
  linkRole = role;
  $("linkInput").value = "";
  $("linkError").textContent = "";
  $("linkDialog").showModal();
}
$("loadLink").onclick = async () => {
  try {
    await acceptLink(parseLink($("linkInput").value, linkRole));
    $("linkDialog").close();
  } catch (e) {
    $("linkError").textContent = e.message;
  }
};
$("cancelLink").onclick = () => $("linkDialog").close();
$("importCareLink").onclick = () => openLink("caregiver");
async function copy(text) {
  try {
    await navigator.clipboard.writeText(text);
    toast("Private link copied.");
  } catch {
    const area = document.createElement("textarea");
    area.value = text;
    document.body.append(area);
    area.select();
    document.execCommand("copy");
    area.remove();
    toast("Private link copied.");
  }
}
function loadPersonal() {
  if (personalProfileId !== personalId()) {
    // Never reuse another patient's trained model or pending request.
    if (personalProfileId && perception.running) {
      perception.stop();
      monitorUI(false);
    }
    $("fingerStudio")?.remove();
    $("fingerLoading")?.remove();
    fingerNeuralLive = false;
    perception.neuralHandActive = false;
    perception.setActiveModule(module);
    perception.resetFaceReference();
    pendingHandTraining = null;
    calibration = null;
    $("calibrationDialog").close();
    gate.cancel();
    $("confirmDialog").close();
    guide.clear();
    guide.lastPrompt = -Infinity;
    personalProfileId = personalId();
  }
  trained = read("calibration_" + personalId(), null);
  handMaps = read("handmap_" + personalId(), {});
  perception.setCalibration(trained?.baseline, trained?.enabled || []);
  blinkIntent = new BlinkIntent(trained?.baseline?.blinkIntent);
}
async function openPatient() {
  try {
    const d = await call("session", { cred: patient });
    profile = d.profile;
    loadPersonal();
    renderPatient();
    show("patient");
  } catch (e) {
    if (demoSession || new URL(location.href).searchParams.has("module")) {
      patient = null;
      profile = null;
      $("linkDialog").close();
      await startDemo(new URL(location.href).searchParams.get("module") || "facespeak");
    } else {
      toast(e.message);
      openLink("patient");
    }
  }
}
let startingDemo = null;
async function createDemoSession(
  assessment = demoAssessment,
  supportContext = demoProfile.supportContext,
  voice = demoProfile.voice,
) {
  const oldDemoId = demoSession ? read("demoPatientId", "") : "";
  const d = await call("session", {
    cred: null,
    body: {
      action: "create",
      label: "Demo patient",
      assessment,
      supportContext,
      voice,
    },
  });
  // A renewed demo is still the same person on this device. Keep local training.
  if (oldDemoId && oldDemoId !== d.patientId) {
    for (const key of ["calibration_", "handmap_", "speech_", "preferences_"]) {
      const value = read(key + oldDemoId, null);
      if (value !== null) save(key + d.patientId, value);
    }
  }
  patient = { patientId: d.patientId, token: d.patientToken };
  save("patient", patient);
  save("demoPatientId", d.patientId);
  profile = d;
  demoSession = true;
  careId = d.patientId;
  carePatients = carePatients.filter(
    (x) => x.patientId !== oldDemoId && x.patientId !== d.patientId,
  );
  carePatients.push({
    patientId: d.patientId,
    token: d.caregiverToken,
    patientToken: d.patientToken,
    label: d.label,
  });
  save("care", carePatients);
  return d;
}

let demoRecovery = null;
let demoRecoveryAfter = 0;
async function renewDemoSession(staleCredential) {
  if (!demoSession || !staleCredential || view === "caregiver") return false;
  if (demoRecovery) return demoRecovery;
  if (
    patient?.patientId !== staleCredential.patientId ||
    patient?.token !== staleCredential.token
  )
    return !!patient;
  if (Date.now() < demoRecoveryAfter) return false;
  demoRecovery = (async () => {
    try {
      // Do not consume a new demo session for a transient Asha-only failure.
      await call("session", { cred: staleCredential });
      return false;
    } catch (error) {
      if (error.status !== 401) throw error;
    }
    const cameraWasRunning = perception.running;
    await createDemoSession(
      profile?.assessment || demoAssessment,
      profile?.supportContext || demoProfile.supportContext,
      profile?.voice || demoProfile.voice,
    );
    loadPersonal();
    renderPatient();
    if (view === "details") renderModule();
    $("connectionBadge").textContent = "Demo care circle ready";
    $("cloudBadge").textContent = "Asha cloud configured";
    $("demoNotice").textContent +=
      " Your demo was reconnected. The previous caregiver link expired; copy the new link." +
      (cameraWasRunning ? " Restart the camera to resume sensing." : "");
    toast(
      "Demo reconnected. Copy the new caregiver link" +
        (cameraWasRunning ? " and restart the camera." : "."),
    );
    return true;
  })();
  try {
    return await demoRecovery;
  } catch (error) {
    demoRecoveryAfter = Date.now() + 30000;
    throw error;
  } finally {
    demoRecovery = null;
  }
}

async function startDemo(requestedModule = "facespeak") {
  if (startingDemo) return startingDemo;
  if (patient && profile) {
    if (requestedModule) module = requestedModule;
    show(requestedModule ? "details" : "patient");
    return;
  }
  startingDemo = (async () => {
    $("exploreDemo").disabled = true;
    $("exploreDemo").textContent = "Opening demo…";
    try {
      await createDemoSession();
    } catch (e) {
      // Local sensing remains available if the session service is unreachable.
      patient = null;
      profile = demoProfile;
      demoSession = true;
      toast(
        `Local demo opened. ${e.message || "Cloud chat and caregiver delivery need a connection."}`,
      );
    } finally {
      $("exploreDemo").disabled = false;
      $("exploreDemo").textContent = "Explore live demo ↗";
    }
    loadPersonal();
    renderPatient();
    if (requestedModule) module = requestedModule;
    $("modeBadge").textContent = names[module];
    show(requestedModule ? "details" : "patient");
  })();
  try { await startingDemo; } finally { startingDemo = null; }
}
const fields = {
  leftHand: "Left hand",
  rightHand: "Right hand",
  wrist: "Wrist movement",
  fingers: "Finger movement",
  eyes: "Eye movement / blink",
  lips: "Lips / smile",
  head: "Head / nod",
  speech: "Speech",
};
$("assessmentFields").innerHTML = Object.entries(fields)
  .map(
    ([k, n]) =>
      `<label class="field">${n}<select name="${k}"><option value="none">Not available</option><option value="limited">Some movement / speech</option><option value="reliable">Comfortable & reliable</option></select></label>`,
  )
  .join("");
for (const [id, choices, name] of [
  ["supportOptions", supportOptions, "supportCategory"],
  ["supportGoals", supportGoals, "supportGoal"],
]) {
  $(id).innerHTML = choices
    .map(
      ([value, label]) =>
        `<label class="check support-choice"><input type="checkbox" name="${name}" value="${value}"><span>${esc(label)}</span></label>`,
    )
    .join("");
}
function supportData() {
  return normalizeSupport({
    categories: [
      ...$("assessmentForm").querySelectorAll(
        '[name="supportCategory"]:checked',
      ),
    ].map((x) => x.value),
    goals: [
      ...$("assessmentForm").querySelectorAll('[name="supportGoal"]:checked'),
    ].map((x) => x.value),
    note: $("assessmentForm").elements.supportNote.value,
  });
}
$("supportNext").onclick = () => step(1);
$("supportSkip").onclick = () => {
  $("setupStep0")
    .querySelectorAll('input[type="checkbox"]')
    .forEach((x) => {
      x.checked = false;
    });
  $("assessmentForm").elements.supportNote.value = "";
  step(1);
};
$("supportBack").onclick = () => step(0);
function startSetup(edit = false) {
  editing = edit;
  $("assessmentForm").reset();
  $("assessmentForm").querySelector('[type="submit"]').textContent = edit
    ? "Save updated assessment →"
    : "Create private care circle →";
  if (edit && careData) {
    const f = $("assessmentForm");
    f.elements.label.value = careData.profile.label;
    for (const k of Object.keys(fields))
      f.elements[k].value = careData.profile.assessment[k];
    f.elements.canSee.checked = careData.profile.assessment.canSee;
    f.elements.canHear.checked = careData.profile.assessment.canHear;
    const context = normalizeSupport(careData.profile.supportContext);
    f.querySelectorAll('[name="supportCategory"]').forEach((x) => {
      x.checked = context.categories.includes(x.value);
    });
    f.querySelectorAll('[name="supportGoal"]').forEach((x) => {
      x.checked = context.goals.includes(x.value);
    });
    f.elements.supportNote.value = context.note;
    f.elements.voice.value = careData.profile.voice?.name || "";
    f.elements.rate.value = careData.profile.voice?.rate || 0.9;
  }
  step(0);
  show("setup");
}
function step(n) {
  [0, 1, 2, 3].forEach((i) => ($("setupStep" + i).hidden = i !== n));
  $("stepNumber").textContent = `0${n + 1} / 04`;
  $("setupTitle").textContent =
    n === 0
      ? "Tell Asha about you."
      : n === 1
        ? "Let’s find their way to communicate."
        : n === 2
          ? "Support that fits the person."
          : "Ready for both phones.";
  $("setupError").textContent = "";
  $("setupTitle").setAttribute("tabindex", "-1");
  $("setupTitle").focus({ preventScroll: true });
  window.scrollTo({ top: 0, behavior: "instant" });
}
function assessmentData() {
  const f = $("assessmentForm"),
    a = {};
  for (const k of Object.keys(fields)) a[k] = f.elements[k].value;
  a.canSee = f.elements.canSee.checked;
  a.canHear = f.elements.canHear.checked;
  return a;
}
$("assessmentNext").onclick = () => {
  if (!$("assessmentForm").elements.label.reportValidity()) return;
  const a = assessmentData(),
    r = recommendations(a);
  $("recommendTitle").textContent = names[r[0] || "companion"];
  $("recommendReason").textContent = r.length
    ? "We’ll start here based on the capabilities you selected. Every module remains available in Details."
    : "Asha can speak, scan needs and support caregiver-assisted communication. Every module remains available.";
  $("recommendTags").innerHTML = [...r, "posture", "vitalsense"]
    .map((n) => `<span class="tag">${names[n]}</span>`)
    .join("");
  $("supportReview").textContent =
    "Your optional support profile: " + supportSummary(supportData());
  step(2);
};
$("assessmentBack").onclick = () => step(1);
$("assessmentForm").onsubmit = async (e) => {
  e.preventDefault();
  const submit = e.submitter;
  submit.disabled = true;
  try {
    const f = $("assessmentForm"),
      a = assessmentData(),
      data = {
        action: editing ? "update" : "create",
        label: f.elements.label.value,
        assessment: a,
        supportContext: supportData(),
        voice: {
          name: $("setupVoice").value,
          rate: Number(f.elements.rate.value),
        },
      };
    const d = await call("session", {
      cred: editing ? carePatients.find((x) => x.patientId === careId) : null,
      body: data,
    });
    settings.cloud = true;
    settings.voice = data.voice.name;
    settings.rate = data.voice.rate;
    save("settings", settings);
    if (editing) {
      toast(
        "Assessment updated. The patient device will receive the recommendation.",
      );
      show("caregiver");
      return;
    }
    patient = { patientId: d.patientId, token: d.patientToken };
    save("patient", patient);
    demoSession = false;
    profile = d;
    careId = d.patientId;
    const c = {
      patientId: d.patientId,
      token: d.caregiverToken,
      patientToken: d.patientToken,
      label: d.label,
    };
    carePatients.push(c);
    save("care", carePatients);
    renderPair(d);
    step(3);
    loadPersonal();
    renderPatient();
  } catch (err) {
    $("setupError").textContent = err.message;
  } finally {
    submit.disabled = false;
  }
};
function renderPair(d) {
  $("pairLinks").innerHTML = ["patient", "caregiver"]
    .map((role) => {
      const link = privateLink(
        role,
        d.patientId,
        role === "patient" ? d.patientToken : d.caregiverToken,
      );
      return `<div class="card"><h3>${role === "patient" ? "Patient’s phone" : "Caregiver’s phone"}</h3><span class="small muted">Patient ID: ${esc(d.patientId)}</span><a class="pair-link" href="${esc(link)}">${esc(link)}</a><button class="secondary" data-copy="${esc(link)}">Copy ${role} link</button></div>`;
    })
    .join("");
  $("pairLinks")
    .querySelectorAll("[data-copy]")
    .forEach((b) => (b.onclick = () => copy(b.dataset.copy)));
}
$("continuePatient").onclick = () => openPatient();
$("continueCare").onclick = () => show("caregiver");
function voiceList() {
  const v = speechSynthesis.getVoices();
  for (const id of ["setupVoice", "voiceSelect"]) {
    const selected = $(id).value || settings.voice;
    $(id).innerHTML =
      '<option value="">Device default</option>' +
      v
        .map(
          (x) =>
            `<option value="${esc(x.name)}">${esc(x.name)} · ${esc(x.lang)}</option>`,
        )
        .join("");
    $(id).value = selected;
  }
}
if ("speechSynthesis" in window) {
  voiceList();
  speechSynthesis.onvoiceschanged = voiceList;
}
function replyLanguage(text, requested = settings.language || "auto") {
  if (requested === "bn" || requested === "en") return requested;
  return /[\u0980-\u09ff]/u.test(text) ? "bn" : "en";
}
function say(text, { recording, force = false, language, onDone, onError } = {}) {
  const version = ++speechVersion;
  $("ashaMessage").textContent = text;
  $("detailAshaMessage").textContent = "Asha: " + text;
  if (!force && profile?.assessment?.canHear === false) { onDone?.(); return; }
  const saved = recording && read("voice_" + recording, null);
  if (saved) {
    if ("speechSynthesis" in window) speechSynthesis.cancel();
    new Audio(saved).play().catch(() => {});
    return;
  }
  if (!("speechSynthesis" in window)) { onDone?.(); return; }
  speechSynthesis.cancel();
  const u = new SpeechSynthesisUtterance(text),
    chosen = settings.voice || profile?.voice?.name;
  const spokenLanguage = replyLanguage(text, language),
    voices = speechSynthesis.getVoices();
  u.lang = spokenLanguage === "bn" ? "bn-BD" : "en-US";
  u.voice = voices.find((x) => x.name === chosen && x.lang.toLowerCase().startsWith(spokenLanguage)) ||
    voices.find((x) => x.lang.toLowerCase().startsWith(spokenLanguage)) || null;
  u.rate = settings.rate || profile?.voice?.rate || 0.9;
  u.pitch = profile?.voice?.pitch || 1;
  u.onend = () => { if (version === speechVersion) onDone?.(); };
  u.onerror = () => { if (version === speechVersion) onError?.(); };
  speechSynthesis.speak(u);
}
function voiceBusy() {
  return "speechSynthesis" in window && speechSynthesis.speaking;
}
$("previewVoice").onclick = () => {
  const old = settings.voice;
  settings.voice = $("setupVoice").value;
  say("I'm Asha. I'll guide the patient aloud, describe each page, and give time to respond. We can calibrate deliberate blink communication when head or smile movement isn't available. I'll ask for confirmation before sending a request.", {
    force: true,
  });
  settings.voice = old;
};
$("setupVoice").onchange = () => $("previewVoice").click();
$("repeatMessage").onclick = () => gate.pending ? speakConfirmation(gate.pending) : say($("ashaMessage").textContent);
function renderPatient() {
  if (!profile) return;
  $("patientGreeting").textContent =
    profile.label.toUpperCase() + " · YOUR SPACE";
  module =
    profile.recommendation?.primary === "companion"
      ? "facespeak"
      : profile.recommendation?.primary || "facespeak";
  $("modeBadge").textContent = names[module];
  $("gestureHint").textContent = confirmationHint();
  $("connectionBadge").textContent = demoSession
    ? patient ? "Demo care circle ready" : "Local demo"
    : "Care circle connected";
  $("demoNotice").hidden = !demoSession;
  $("demoNotice").textContent = patient
    ? "Demo session. Explore every module; camera models run locally. Copy the caregiver link if you want to test delivery on another device."
    : "Local demo. Live sensing and calibration work here; AI chat and caregiver delivery need a connection.";
  for (const b of document.querySelectorAll("[data-demo-care-link]"))
    b.hidden = !demoSession || !patient || !carePatients.some((x) => x.patientId === patient.patientId && x.token);
  updateQuietAsha();
  if (patient && read("unsent_" + patient.patientId, null)) renderRetry();
  else $("retryRequest")?.remove();
}
document.querySelectorAll("[data-demo-care-link]").forEach((b) => b.onclick = () => {
  const c = carePatients.find((x) => x.patientId === patient?.patientId);
  if (c?.token) copy(privateLink("caregiver", c.patientId, c.token));
});
function updateQuietAsha() {
  $("quietAsha").textContent = settings.proactive ? "Pause Asha check-ins" : "Resume Asha check-ins";
  $("quietAsha").setAttribute("aria-pressed", String(!settings.proactive));
}
$("quietAsha").onclick = () => {
  settings.proactive = !settings.proactive;
  save("settings", settings);
  guide.clear();
  updateQuietAsha();
  if (settings.proactive) {
    if (perception.running) guideCheckIn("routine");
    else say("I'm ready to guide you again. Start support when you are comfortable.");
  } else {
    speechVersion++;
    if ("speechSynthesis" in window) speechSynthesis.cancel();
    $("ashaMessage").textContent = "Asha's check-ins are paused. Requests and caregiver messages still work.";
    $("detailAshaMessage").textContent = "Asha: " + $("ashaMessage").textContent;
  }
};
function confirmationHint() {
  const plan = responsePlan(profile?.assessment, trained?.enabled);
  if (gate.pending?.source === "deliberate blink" || plan.mode === "blink") return "Wait until I finish speaking, keep your eyes open briefly, then make one deliberate blink: close a little longer than your quick blinks and reopen, as practiced. Do nothing to cancel.";
  if (plan.mode === "menu") return "Nod and return to center once more to confirm.";
  if (plan.mode === "yes") return "Please " + plan.verb + " once more to confirm.";
  if (Object.values(handMaps).some((x) => x?.trained))
    return "Repeat your personalized hand gesture to confirm.";
  return "A caregiver can calibrate a comfortable head, smile or deliberate blink response in Details. Touch confirmation is also available.";
}
function guideCheckIn(reason = "routine") {
  guide.due(performance.now());
  if (!profile || !settings.proactive || !perception.running || document.hidden ||
      calibration || gate.pending || (guide.pending && reason !== "start") ||
      !["patient", "details"].includes(view)) return;
  if (settings.scan) {
    if (reason === "start") {
      guide.lastPrompt = performance.now();
      say("I'm Asha. Hands-free need scanning is on. I'll read each choice aloud. Use your calibrated response to choose one, then confirm it separately.");
    }
    return;
  }
  const message = guide.ask({
    assessment: profile.assessment,
    enabled: trained?.enabled || [],
    handMapped: Object.values(handMaps).some((x) => x?.trained),
    reason,
  }, performance.now());
  say(message);
}
let screenLock;
function monitorUI(on) {
  $("startMonitoring").hidden = on;
  $("pauseMonitoring").hidden = !on;
  $("studioStart").textContent = on ? "Pause camera" : "Start camera";
  $("cameraPlaceholder").hidden = on;
  $("activeModules").textContent = on
    ? "Monitoring together: NeuroFace Sense · FingerSpeak · VitalSense · Posture. See Details for signal status."
    : "NeuroFace Sense · FingerSpeak · VitalSense · Posture — paused. Start support to resume.";
  if (!on) {
    guide.clear();
    cancelRequest();
    $("fingerStudio")?.contentWindow?.ashaSharedPause?.();
    screenLock?.release().catch(() => {});
    screenLock = null;
    $("fpsBadge").textContent = "Paused";
    $("cameraPlaceholder").textContent = "Monitoring paused";
    $("liveSummary").textContent =
      "All camera sensing paused. SenseAssist and Asha remain available.";
  }
}
async function startMonitor() {
  if (perception.running) {
    perception.stop();
    monitorUI(false);
    return;
  }
  if (!profile) {
    toast("Open the live demo or set up a care circle first.");
    return;
  }
  // Speak inside the caregiver's Start tap, before permission/model awaits.
  // Mobile browsers may block audio first started after an async operation.
  if (settings.proactive) say("I'm Asha. I'm starting your support. I will guide you when the camera is ready.");
  $("startMonitoring").disabled = $("studioStart").disabled = true;
  try {
    await perception.start();
    monitorUI(true);
    try {
      screenLock = await navigator.wakeLock?.request("screen");
    } catch {}
    if (settings.proactive) guideCheckIn("start");
    if (!trained)
      toast("Open Details → Calibrate patient to train your own movements.");
    heartbeat();
  } catch (e) {
    perception.stop();
    monitorUI(false);
    toast(
      e.name === "NotAllowedError"
        ? "Camera permission was declined. Allow the camera in your browser settings."
        : e.message,
    );
  } finally {
    $("startMonitoring").disabled = $("studioStart").disabled = false;
  }
}
$("startMonitoring").onclick = $("studioStart").onclick = startMonitor;
$("pauseMonitoring").onclick = () => {
  perception.stop();
  monitorUI(false);
  heartbeat();
};
perception.addEventListener("status", (e) => {
  $("monitorStatus").textContent = e.detail;
  $("cameraStatus").textContent = e.detail;
});
function propose(kind, source = "touch", text = needs[kind]) {
  if (!profile) {
    toast("Open the live demo first.");
    return;
  }
  const p = gate.propose(kind, text, source, performance.now());
  if (!p) return;
  guide.clear();
  $("confirmText").textContent = text;
  $("confirmHint").textContent =
    "Send this request to your caregiver? " + confirmationHint();
  $("confirmDialog").showModal();
  speakConfirmation(p);
  clearTimeout(wakeTimer);
  wakeTimer = setTimeout(() => cancelRequest(), 30000);
}
function speakConfirmation(p) {
  const useBlink = p.source === "deliberate blink" || responsePlan(profile?.assessment, trained?.enabled).mode === "blink";
  if (useBlink) blinkIntent.waitForQuestion();
  $("confirmStatus").textContent = useBlink ? "Wait for Asha's question to finish." : "Waiting for your separate confirmation.";
  const question = p.kind === "water" ? "Do you want water? Shall I ask your caregiver? " : p.text + ". Shall I ask your caregiver? ";
  say(question + confirmationHint(), { onDone: () => {
    if (gate.pending === p && useBlink) {
      blinkIntent.questionFinished(performance.now());
      $("confirmStatus").textContent = "Ready: keep eyes open briefly, then make your practiced yes blink.";
    }
  }, onError: () => {
    if (gate.pending === p) $("confirmStatus").textContent = "Question audio was interrupted. Repeat the question before confirming by blink, or ask a caregiver for help.";
  } });
}
function cancelRequest() {
  gate.cancel();
  blinkIntent.reset();
  $("confirmDialog").close();
  clearTimeout(wakeTimer);
}
document
  .querySelectorAll("[data-need]")
  .forEach((b) => (b.onclick = () => propose(b.dataset.need)));
$("confirmNo").onclick = cancelRequest;
$("confirmRepeat").onclick = () => { if (gate.pending) speakConfirmation(gate.pending); };
$("confirmDialog").addEventListener("cancel", cancelRequest);
async function confirmRequest() {
  const p = gate.confirm(performance.now());
  if (!p) return;
  blinkIntent.reset();
  $("confirmDialog").close();
  clearTimeout(wakeTimer);
  await sendEvent(p.kind, p.source, p.text, true);
}
$("confirmYes").onclick = confirmRequest;
async function sendEvent(kind, source, text, confirmed) {
  if (!patient) {
    $("latestRequest").textContent = `${text} · recognized in this local demo. Caregiver delivery needs a connection.`;
    say("I recognized your request on this device. A caregiver connection is needed to deliver it.");
    return;
  }
  const event = {
    id: crypto.randomUUID(),
    action: "event",
    kind,
    source,
    text,
    confirmed,
  };
  $("latestRequest").textContent = "Sending…";
  try {
    const d = await call("session", { cred: patient, body: event });
    $("latestRequest").textContent =
      "Sent · waiting for your caregiver to receive it";
    const memory = read("preferences_" + patient.patientId, {});
    memory[kind] = (memory[kind] || 0) + 1;
    save("preferences_" + patient.patientId, memory);
    say(
      kind === "test"
        ? "Your connection test was sent."
        : "Your request was sent. I’ll let you know when your caregiver acknowledges it.",
    );
    pollPatient();
    return d;
  } catch (e) {
    save("unsent_" + patient.patientId, event);
    $("latestRequest").textContent =
      "Not delivered. Please retry or contact your caregiver another way.";
    toast(e.message);
    renderRetry();
  }
}
function renderRetry() {
  if ($("retryRequest")) return;
  const b = document.createElement("button");
  b.id = "retryRequest";
  b.className = "secondary";
  b.textContent = "Retry unsent request";
  b.onclick = async () => {
    const ev = read("unsent_" + patient.patientId, null);
    if (!ev) return;
    try {
      await call("session", { cred: patient, body: ev });
      localStorage.removeItem("asha_live_unsent_" + patient.patientId);
      b.remove();
      pollPatient();
      toast("Request sent.");
    } catch (e) {
      toast(e.message);
    }
  };
  $("latestRequest").after(b);
}
$("testRequest").onclick = () => sendEvent("test", "touch", needs.test, true);
function confirmationEvent(e) {
  if (gate.pending?.source === "deliberate blink") return e.type === CONFIRM_BLINK;
  return confirmationMatches(e.type, profile?.assessment, trained?.enabled);
}
perception.addEventListener("gesture", ({ detail: e }) => {
  if (calibration || !trained || !["patient", "details"].includes(view)) return;
  if (gate.pending) {
    if (confirmationEvent(e)) confirmRequest();
    return;
  }
  // Plain BLINK_COMPLETED observations cannot enter this request path.
  const guidedKind = guide.accept(e.type, performance.now());
  if (guidedKind) {
    propose(guidedKind, "guided face");
    return;
  }
  if (scanKind && settings.scan && confirmationEvent(e)) {
    propose(scanKind, "face");
    return;
  }
  // Observed movements outside a spoken question are not caregiver requests.
  // In particular, three ordinary blinks can never propose or confirm one.
  const now = performance.now();
  guide.due(now);
  if (e.type === "SMILE_COMPLETED" && settings.proactive && !guide.pending &&
      now - lastProactive > 120000 && !voiceBusy()) {
    lastProactive = now;
    guideCheckIn("smile");
  }
});
perception.addEventListener("facecommand", ({ detail: c }) => {
  if (
    c.command !== "okay" ||
    calibration ||
    gate.pending ||
    !["patient", "details"].includes(view)
  )
    return;
  if (
    !trained?.enabled?.includes("NOD_COMPLETED") ||
    !trained.enabled.includes("SMILE_COMPLETED")
  )
    return;
  say("I am okay, thank you.");
  perception.analysis.addLog(
    c.timestamp,
    "Nod + smile → I am okay, thank you",
    "communication",
  );
});
perception.addEventListener("hand", ({ detail: h }) => {
  if (calibration) return;
  if (pendingHandTraining && h.pose === pendingHandTraining.pose) {
    pendingHandTraining.count++;
    if ($("handTrainStatus"))
      $("handTrainStatus").textContent =
        `${pendingHandTraining.count}/3 distinct holds captured. Relax between holds.`;
    if (pendingHandTraining.count >= 3) {
      handMaps[pendingHandTraining.pose] = {
        kind: pendingHandTraining.kind,
        trained: true,
      };
      save("handmap_" + personalId(), handMaps);
      pendingHandTraining = null;
      if ($("handTrainStatus"))
        $("handTrainStatus").textContent =
          "Gesture saved. It can propose a request; confirmation is still required.";
    }
    return;
  }
  if (!["patient", "details"].includes(view) || fingerNeuralLive) return;
  if (h.pose === "Open palm" && settings.proactive && !guide.pending &&
      !gate.pending && guide.due(performance.now()) && !voiceBusy()) {
    guideCheckIn("routine");
  }
  if (gate.pending && handMaps[h.pose]?.trained) {
    confirmRequest();
    return;
  }
  const m = handMaps[h.pose];
  if (m?.trained) propose(m.kind, "hand");
});
perception.addEventListener("handframe", ({ detail: d }) => {
  $("fingerStudio")?.contentWindow?.ashaSharedFrame?.(
    d.result,
    perception.stream,
    d.t,
  );
});
perception.addEventListener("cue", async ({ detail: cue }) => {
  guide.due(performance.now());
  if (
    !settings.proactive ||
    calibration ||
    gate.pending ||
    guide.pending ||
    !["patient", "details"].includes(view) ||
    voiceBusy() ||
    performance.now() - lastProactive < 120000
  )
    return;
  lastProactive = performance.now();
  guideCheckIn(cue === "possible_wake" ? "wake" : "change");
});
perception.addEventListener("frame", ({ detail: s }) => {
  const blinkEnabled = profile?.assessment?.eyes && profile.assessment.eyes !== "none" &&
    trained?.enabled?.includes(RAPID_BLINK) && trained.enabled.includes(CONFIRM_BLINK);
  if (!calibration && blinkEnabled && !document.hidden && ["patient", "details"].includes(view)) {
    const signal = blinkIntent.update(s.analysis?.eye, s.t, s.analysis?.valid);
    if (signal === RAPID_BLINK && !gate.pending) {
      const selected = guide.accept(RAPID_BLINK, performance.now()) || (settings.scan && scanKind) || "water";
      propose(selected, "deliberate blink");
      if (!gate.pending) blinkIntent.reset();
    } else if (signal === CONFIRM_BLINK && gate.pending && confirmationEvent({ type: signal })) confirmRequest();
  } else blinkIntent.reset();
  if (calibration) {
    const old = calibration.index,
      r = calibration.update(s.raw);
    $("calibrationStatus").textContent = r.message || "Movement captured";
    $("calibrationProgress").value = r.progress || 0;
    if (r.done) {
      trained = {
        baseline: calibration.baseline,
        enabled: calibration.enabled,
        savedAt: new Date().toISOString(),
      };
      save("calibration_" + personalId(), trained);
      perception.setCalibration(trained.baseline, trained.enabled);
      blinkIntent = new BlinkIntent(trained.baseline?.blinkIntent);
      calibration = null;
      $("calibrationDialog").close();
      $("gestureHint").textContent = confirmationHint();
      say("Calibration saved. " + confirmationHint());
      guide.clear();
      guide.lastPrompt = -Infinity;
      toast("Calibration saved from your actual movement samples.");
    } else if (calibration.index !== old) calibrationStep();
  }
  history.push({
    ear: s.raw.earMean || 0,
    smile: s.face?.smile?.smileIntensity || 0,
    yaw: s.analysis?.head?.yaw || 0,
    pitch: s.analysis?.head?.pitch || 0,
    motion: s.analysis?.motion?.displacement || 0,
    lip: s.raw.mar || 0,
    pose: s.posture?.lean ?? s.posture?.shoulderTilt ?? 0,
    pulse: s.pulse?.signal?.at(-1) || 0,
  });
  if (history.length > 240) history.shift();
  if (performance.now() - lastPaint > 140) {
    lastPaint = performance.now();
    paint(s);
  }
});
$("calibrateButton").onclick = async () => {
  if (!perception.running) await startMonitor();
  if (!perception.running) return;
  module = "facespeak";
  show("details");
  perception.resetFaceReference();
  gate.cancel();
  guide.clear();
  calibration = new GuidedCalibration(profile.assessment);
  $("calibrationDialog").showModal();
  calibrationStep();
};
function calibrationStep() {
  if (!calibration?.step) return;
  $("calibrationTitle").textContent =
    `Step ${calibration.index + 1} of ${calibration.steps.length}`;
  $("calibrationInstruction").textContent = calibration.step.label;
  $("calibrationProgress").value = 0;
  $("skipCalibration").hidden = calibration.index === 0;
  say(calibration.step.label);
}
$("skipCalibration").onclick = () => {
  calibration?.skip();
  if (!calibration?.step) {
    trained = {
      baseline: calibration.baseline,
      enabled: calibration.enabled,
      savedAt: new Date().toISOString(),
    };
    save("calibration_" + personalId(), trained);
    perception.setCalibration(trained.baseline, trained.enabled);
    blinkIntent = new BlinkIntent(trained.baseline?.blinkIntent);
    calibration = null;
    $("calibrationDialog").close();
    toast("Only captured movements were enabled.");
  } else calibrationStep();
};
$("endCalibration").onclick = () => {
  calibration = null;
  $("calibrationDialog").close();
};
$("calibrationDialog").addEventListener("cancel", () => (calibration = null));
async function heartbeat() {
  if (!patient || !profile) return;
  const s = perception.snapshot;
  try {
    await call("session", {
      cred: patient,
      body: {
        action: "heartbeat",
        status: {
          module,
          camera: perception.running,
          face: perception.running && s.raw?.facePresent,
          hands: perception.running ? s.hands?.length || 0 : 0,
          posture: perception.running ? s.posture?.label : "Paused",
          activity: document.hidden
            ? "Page backgrounded"
            : perception.running
              ? s.activity
              : "Paused",
          bpm: perception.running ? s.pulse?.bpm : null,
          calibrated: !!trained,
        },
      },
    });
  } catch {}
}
let lastAck = null;
async function pollPatient() {
  if (!patient || pollBusy) return;
  pollBusy = true;
  const pollCredential = patient;
  try {
    const d = await call("session", { cred: pollCredential });
    if (patient?.patientId !== pollCredential.patientId) return;
    const changed =
      profile &&
      JSON.stringify(profile.assessment) !==
        JSON.stringify(d.profile.assessment);
    profile = d.profile;
    if (changed) {
      module =
        profile.recommendation?.primary === "companion"
          ? "facespeak"
          : profile.recommendation?.primary || "facespeak";
      $("modeBadge").textContent = names[module];
      if (view === "details") renderModule();
      say(
        "Your caregiver updated your assessment. I suggest " +
          names[module] +
          ". You can still choose any interface.",
      );
    }
    $("connectionBadge").textContent = demoSession ? "Demo care circle ready" : "Connected";
    if (d.events[0]) {
      const e = d.events[0],
        state = e.receipt?.acknowledgedAt
          ? "Acknowledged by your caregiver"
          : e.receipt?.receivedAt
            ? "Received on caregiver dashboard"
            : "Sent · waiting for caregiver";
      if (!read("unsent_" + patient.patientId, null))
        $("latestRequest").textContent =
          `${e.text || needs[e.kind]} · ${state}`;
      if (e.receipt?.acknowledgedAt && lastAck !== e.id) {
        lastAck = e.id;
        say("Your caregiver has acknowledged your request.");
      }
    }
  } catch (e) {
    if (e.status === 401 && demoSession) {
      try {
        if (await renewDemoSession(pollCredential)) return;
      } catch (recoveryError) {
        $("connectionBadge").textContent = recoveryError.message;
        return;
      }
    }
    $("connectionBadge").textContent =
      e.status === 401 ? "Session expired · reopen your private link" : "Connection interrupted";
  } finally {
    pollBusy = false;
  }
}
function renderCareList() {
  $("patientCount").textContent = carePatients.length;
  $("patientList").innerHTML = carePatients.length
    ? carePatients
        .map(
          (c) =>
            `<button class="patient-entry ${c.patientId === careId ? "active" : ""}" data-patient="${c.patientId}"><strong>${esc(c.label || "Patient")}</strong><small>ID ${esc(c.patientId.slice(-8))}</small></button>`,
        )
        .join("")
    : '<p class="muted small">Add a patient or paste a private caregiver link.</p>';
  $("patientList")
    .querySelectorAll("[data-patient]")
    .forEach(
      (b) =>
        (b.onclick = () => {
          careId = b.dataset.patient;
          renderCareList();
          pollCare();
        }),
    );
}
let careBusy = false;
const received = new Set();
async function pollCare() {
  if (careBusy || !careId) return;
  careBusy = true;
  const c = carePatients.find((x) => x.patientId === careId);
  if (!c) {
    careBusy = false;
    return;
  }
  try {
    const d = await call("session", { cred: c });
    careData = d;
    const s = d.status,
      age = s ? Date.now() - Date.parse(s.at) : Infinity;
    $("careConnection").textContent = "Live connection";
    $("careStatus").innerHTML =
      `<div class="section-heading"><div><span class="eyebrow">ASSIGNED PATIENT</span><h2>${esc(d.profile.label)}</h2></div><span class="pill">${age < 35000 ? "Online" : "Not active"}</span></div><p class="muted small">Patient ID ${esc(d.profile.patientId)} · ${s ? "Last update " + new Date(s.at).toLocaleTimeString() : "Waiting for the patient device"}</p><div class="metrics"><div class="metric"><small>Interface</small><strong>${esc(names[s?.module] || "—")}</strong></div><div class="metric"><small>Posture</small><strong>${esc(s?.posture || "—")}</strong></div><div class="metric"><small>Camera pulse estimate</small><strong>${s?.bpm && age < 35000 ? s.bpm + " bpm" : "—"}</strong></div></div><div class="actions"><button id="careEdit" class="text-button">Review assessment →</button>${c.patientToken ? '<button id="sharePatient" class="text-button">Copy patient link →</button>' : ""}</div>`;
    const support = document.createElement("p");
    support.className = "small muted";
    support.id = "careSupportProfile";
    support.textContent =
      "Self-described support needs: " +
      supportSummary(d.profile.supportContext);
    $("careStatus").append(support);
    $("careEdit").onclick = () => startSetup(true);
    if ($("sharePatient"))
      $("sharePatient").onclick = () =>
        copy(privateLink("patient", c.patientId, c.patientToken));
    $("eventList").innerHTML = d.events.length
      ? d.events
          .map(
            (e) =>
              `<article class="event"><div><strong>${esc(e.text || needs[e.kind] || e.kind)}</strong><p>${new Date(e.at).toLocaleString()} · ${esc(e.source)}${e.confirmed ? " · confirmed request" : " · observation only"}</p></div>${e.receipt?.acknowledgedAt ? '<span class="pill">Acknowledged ✓</span>' : `<button class="secondary" data-ack="${e.id}">Acknowledge</button>`}</article>`,
          )
          .join("")
      : '<div class="empty">You’re connected.<br>New patient requests will appear here.</div>';
    $("eventList")
      .querySelectorAll("[data-ack]")
      .forEach(
        (b) =>
          (b.onclick = async () => {
            b.disabled = true;
            try {
              await call("session", {
                cred: c,
                body: { action: "ack", id: b.dataset.ack },
              });
              b.textContent = "Acknowledged ✓";
              b.disabled = true;
              toast("The patient can now see your acknowledgment.");
            } catch (e) {
              b.disabled = false;
              toast(e.message);
            }
          }),
      );
    for (const e of d.events.filter((e) => !e.receipt?.receivedAt)) {
      if (received.has(e.id)) continue;
      try {
        await call("session", {
          cred: c,
          body: { action: "receive", id: e.id },
        });
        received.add(e.id);
        if (Date.now() - Date.parse(e.at) < 120000) {
          toast("New patient request: " + (e.text || needs[e.kind]));
          if (navigator.vibrate) navigator.vibrate([150, 80, 150]);
        }
      } catch {}
    }
  } catch (e) {
    $("careConnection").textContent = "Disconnected · retrying";
  } finally {
    careBusy = false;
  }
}
setInterval(() => {
  if (document.hidden) return;
  if (view === "caregiver") pollCare();
  else if (patient && ["patient", "details"].includes(view)) pollPatient();
}, 4000);
setInterval(() => {
  if (patient && ["patient", "details"].includes(view)) heartbeat();
}, 15000);
setInterval(() => {
  if (settings.proactive && !settings.scan && perception.running &&
      !document.hidden && !voiceBusy() &&
      ["patient", "details"].includes(view) &&
      !calibration && !gate.pending && guide.due(performance.now()))
    guideCheckIn("routine");
}, 10000);
document.addEventListener("visibilitychange", () => {
  if (document.hidden) {
    perception.rest.reset();
    $("monitorStatus").textContent =
      "Monitoring paused while this page is backgrounded.";
  } else {
    if (perception.running)
      $("monitorStatus").textContent = "Camera monitoring resumed";
    if (view === "caregiver") pollCare();
    else pollPatient();
  }
  heartbeat();
});
window.addEventListener("pagehide", () => perception.stop());
function addChat(text, user = false) {
  const p = document.createElement("p");
  p.className = user ? "chat-user" : "chat-asha";
  p.textContent = text;
  $("chatMessages").append(p);
  p.scrollIntoView({ block: "nearest" });
  return p;
}
function ashaDetails(result) {
  const sources = Array.isArray(result.sources) ? result.sources.slice(0, 6) : [],
    orchestration = result.orchestration;
  if (!sources.length && !orchestration) return null;
  const details = document.createElement("details"),
    summary = document.createElement("summary");
  details.className = "small muted";
  summary.textContent = "Details";
  details.append(summary);
  const line = (text) => {
    const p = document.createElement("p");
    p.textContent = String(text).slice(0, 1200);
    details.append(p);
  };
  if (orchestration) {
    if (orchestration.task) line("Task: " + orchestration.task);
    if (typeof orchestration.model === "string") line("Model: " + orchestration.model);
    for (const step of (Array.isArray(orchestration.steps) ? orchestration.steps : []).slice(0, 10))
      if (step && typeof step.tool === "string") line(step.tool + " · " + String(step.status || "completed"));
    line(orchestration.verified === true
      ? "Format and action checks passed. Any caregiver request still needs your separate confirmation."
      : "No verified action is available from this response.");
  }
  for (const source of sources) {
    if (!source || typeof source !== "object") continue;
    const title = document.createElement("strong");
    title.textContent = String(source.title || "Supporting information").slice(0, 180);
    details.append(title);
    if (source.text) line(source.text);
    if (source.source) line("Source: " + source.source);
  }
  return details;
}
function presentAshaActions(result, message, context) {
  const container = document.createElement("div");
  container.className = "actions";
  const details = ashaDetails(result);
  if (details) message.after(details);
  const proposal = result.orchestration?.verified === true && result.proposal,
    allowed = ["water", "food", "toilet", "comfort", "help", "message"],
    canPropose = () => ["patient", "details"].includes(view) &&
      personalId() === context.patientId && !gate.pending && !calibration;
  let opened = false;
  if (proposal && allowed.includes(proposal.kind) && typeof proposal.text === "string" && proposal.text.trim()) {
    const review = document.createElement("button");
    review.type = "button";
    review.className = "secondary";
    review.textContent = "Review caregiver request";
    const openProposal = () => {
      if (!canPropose()) {
        toast("Return to this patient’s page and finish the current confirmation or calibration first.");
        return false;
      }
      propose(proposal.kind, "asha", proposal.text.trim().slice(0, 250));
      return !!gate.pending;
    };
    review.onclick = openProposal;
    container.append(review);
    if (view === context.view && canPropose()) opened = openProposal();
  }
  if (result.orchestration?.verified === true &&
      ["facespeak", "fingerspeak", "senseassist", "vitalsense", "posture"].includes(result.suggestedModule)) {
    const open = document.createElement("button");
    open.type = "button";
    open.className = "secondary";
    open.textContent = "Open " + names[result.suggestedModule];
    open.onclick = () => {
      if (gate.pending || calibration) {
        toast("Finish the current confirmation or calibration before opening another module.");
        return;
      }
      module = result.suggestedModule;
      $("modeBadge").textContent = names[module];
      show("details");
    };
    container.append(open);
  }
  if (container.childElementCount) (details || message).after(container);
  return opened;
}
function openChat() {
  $("chatPanel").hidden = false;
  $("chatInput").focus();
}
$("closeChat").onclick = () => ($("chatPanel").hidden = true);
function immediateAppGuide(text) {
  const greeting = instantGreeting(text, {
    language: settings.language,
    view,
    moduleName: names[module],
  });
  if (greeting) return greeting;
  // Generated replies handle the selected language; local shortcuts are English.
  if (["bn", "mixed"].includes(settings.language) || /[\u0980-\u09ff]/u.test(text)) return null;
  const q = text.toLowerCase().replace(/[?!.,]/g, "").trim();
  if (
    [
      "what is this app",
      "what does this app do",
      "what does asha do",
      "how does this app work",
    ].includes(q)
  )
    return "I'm Asha. I guide this app and help you communicate with face, hand, or speech responses that work for you. A caregiver request is sent only after you confirm it.";
  if (
    ["what is this page", "what can i do here", "how do i use this page"].includes(q) ||
    q === `guide me through ${names[module].toLowerCase()} based on my assessment`
  ) {
    if (view === "caregiver")
      return "This is the caregiver dashboard. You can see patient requests, check the latest status, and acknowledge a request so the patient knows you saw it.";
    if (view === "welcome")
      return "Welcome to Asha. You can explore the live demo now or set up a private care circle with a caregiver.";
    if (view === "setup")
      return "This setup asks which movements and senses the patient can use. A caregiver can update the assessment later, and every module stays available.";
    if (view === "settings")
      return "These are Asha's settings. You can change the voice, theme, and check-ins here.";
    if (view === "patient")
      return "This is your patient page. Asha can guide you aloud, and Details opens the face, hand, speech, pulse trend, and posture views.";
    return `You're viewing ${names[module]}. ${moduleGuidance[module] || "You can open Details to explore FaceSpeak, FingerSpeak, VitalSense, SenseAssist, and posture."}`;
  }
  return null;
}
async function askAsha(text, options = {}) {
  if (!credential())
    throw Error("The local demo cannot reach Asha cloud right now. Live camera modules still work; retry when connected.");
  if (!settings.cloud) {
    if (
      !confirm(
        "Enable cloud assistance? The words you send and your capability assessment will be shared with Asha’s AI service. Camera video stays on this device.",
      )
    )
      throw Error("Cloud assistance is off. Local controls still work.");
    settings.cloud = true;
    save("settings", settings);
  }
  const savedMemories = read("speech_" + personalId(), []),
    confirmedMemories = options.mode === "interpret" && Array.isArray(savedMemories)
      ? savedMemories
          // The older schema also wrote pairs only after "Yes, speak this".
          .map((x) => x && typeof x.confirmed === "string"
            ? { heard: x.heard, confirmedText: x.confirmed, confirmed: true }
            : x)
          .filter((x) => x && x.confirmed === true && typeof x.heard === "string" && typeof x.confirmedText === "string" &&
            x.heard.trim().length > 0 && x.heard.length <= 180 &&
            x.confirmedText.trim().length > 0 && x.confirmedText.length <= 180)
          .slice(-20)
          .map((x) => ({ heard: x.heard, confirmedText: x.confirmedText, confirmed: true }))
      : [];
  const request = {
    text,
    module: view === "caregiver" ? "caregiver" : module,
    context: options.context ||
      `Camera ${perception.running ? "on" : "off"}; posture ${perception.snapshot.posture?.label || "unavailable"}`,
    mode: options.mode || "chat",
    history: conversation.slice(-6),
    consent: true,
    language: options.language || settings.language || "auto",
    confirmedMemories,
  };
  const chatCredential = credential();
  let reply, responseCredential = chatCredential;
  try {
    reply = await call("asha", { cred: chatCredential, body: request });
  } catch (error) {
    if (error.status !== 401 || !demoSession || view === "caregiver") throw error;
    if (!(await renewDemoSession(chatCredential))) throw error;
    responseCredential = patient;
    reply = await call("asha", { cred: responseCredential, body: request });
  }
  ashaResponseSessions.set(reply, responseCredential.patientId);
  if (reply.reply) {
    conversation.push(
      { role: "user", text },
      { role: "assistant", text: reply.reply },
    );
    while (conversation.length > 6) conversation.shift();
  }
  return reply;
}
$("chatForm").onsubmit = async (e) => {
  e.preventDefault();
  const text = $("chatInput").value.trim();
  if (!text) return;
  const context = { patientId: personalId(), view, demo: demoSession };
  addChat(text, true);
  $("chatInput").value = "";
  const immediate = immediateAppGuide(text);
  if (immediate) {
    addChat(immediate);
    conversation.push(
      { role: "user", text },
      { role: "assistant", text: immediate },
    );
    while (conversation.length > 6) conversation.shift();
    say(immediate);
    return;
  }
  const p = addChat("I heard you. Finding a short answer…");
  e.submitter.disabled = true;
  const acknowledgement = setTimeout(() => {
    if (view !== "caregiver" && !gate.pending && !calibration)
      say("I heard you. I'll answer in a moment.");
  }, 1500);
  try {
    const d = await askAsha(text);
    if (context.demo && demoSession && ashaResponseSessions.get(d) === personalId())
      context.patientId = personalId();
    p.textContent = d.reply;
    if (!presentAshaActions(d, p, context) && !gate.pending && !calibration)
      say(d.reply, { language: d.language });
    $("cloudBadge").textContent = "Asha connected";
  } catch (err) {
    p.textContent = err.message;
    $("cloudBadge").textContent =
      err.status === 401
        ? "Session expired"
        : err.status === 429
          ? "Please wait"
          : "Asha cloud unavailable";
  } finally {
    clearTimeout(acknowledgement);
    e.submitter.disabled = false;
  }
};
$("moduleAdvice").onclick = () => {
  openChat();
  $("chatInput").value =
    "Given my assessment, what should I try first in " + names[module] + "?";
};
$("careAdvice").onclick = () => {
  openChat();
  $("chatInput").value =
    "Suggest a gentle check-in for this patient. Do not assume a diagnosis.";
};
const bubble = $("ashaBubble"),
  handle = $("bubbleHandle");
let drag = null;
handle.onpointerdown = (e) => {
  const r = bubble.getBoundingClientRect();
  drag = { x: e.clientX, y: e.clientY, left: r.left, top: r.top, moved: false };
  handle.setPointerCapture(e.pointerId);
};
handle.onpointermove = (e) => {
  if (!drag) return;
  const dx = e.clientX - drag.x,
    dy = e.clientY - drag.y;
  if (Math.hypot(dx, dy) > 5) drag.moved = true;
  if (drag.moved) {
    bubble.style.left = clamp(drag.left + dx, 8, innerWidth - 72) + "px";
    bubble.style.top = clamp(drag.top + dy, 8, innerHeight - 80) + "px";
    bubble.style.right = "auto";
    bubble.style.bottom = "auto";
  }
};
handle.onpointerup = () => {
  if (drag && !drag.moved)
    $("chatPanel").hidden ? openChat() : ($("chatPanel").hidden = true);
  drag = null;
};
handle.onkeydown = (e) => {
  if (["Enter", " "].includes(e.key)) {
    e.preventDefault();
    openChat();
  }
};
function renderSettings() {
  $("cloudConsent").checked = settings.cloud;
  $("proactive").checked = settings.proactive;
  $("autoScan").checked = settings.scan;
  $("voiceSelect").value = settings.voice;
  $("voiceRate").value = settings.rate;
  $("ashaLanguage").value = settings.language || "auto";
  updateQuietAsha();
}
for (const [id, k] of [
  ["cloudConsent", "cloud"],
  ["proactive", "proactive"],
  ["autoScan", "scan"],
])
  $(id).onchange = () => {
    if (k === "scan" && $(id).checked && responsePlan(profile?.assessment, trained?.enabled).mode === "none") {
      $(id).checked = false;
      toast("Calibrate a head, smile or deliberate blink response before enabling hands-free scanning.");
      return;
    }
    settings[k] = $(id).checked;
    save("settings", settings);
    if (k === "proactive") {
      guide.clear();
      updateQuietAsha();
      if (!settings.proactive && "speechSynthesis" in window) { speechVersion++; speechSynthesis.cancel(); }
    }
  };
$("ashaLanguage").onchange = () => {
  settings.language = $("ashaLanguage").value;
  if (settings.language === "bn") settings.speechLanguage = "bn-BD";
  if (settings.language === "en") settings.speechLanguage = "en-US";
  save("settings", settings);
};
$("voiceSelect").onchange = () => {
  settings.voice = $("voiceSelect").value;
  save("settings", settings);
  say("I'm Asha. I'll explain each page and check in gently while support is on. You can pause my check-ins any time.", { force: true });
};
$("voiceRate").oninput = () => {
  settings.rate = Number($("voiceRate").value);
  save("settings", settings);
};
$("testVoice").onclick = () =>
  say(settings.language === "bn" || settings.language === "mixed"
    ? "আমি আপনার পাশে আছি। আপনার কী প্রয়োজন?"
    : "I’m here with you. What would make you more comfortable?", {
    force: true,
  });
$("editAssessment").onclick = () => {
  if (!careData) {
    show("caregiver");
    toast("Choose your patient, then Review assessment.");
  } else startSetup(true);
};
$("forgetDevice").onclick = () => {
  if (!confirm("Forget private access links and calibration on this device?"))
    return;
  perception.stop();
  for (const k of Object.keys(localStorage))
    if (k.startsWith("asha_live_")) localStorage.removeItem(k);
  location.href = site.href;
};
let voiceRecorder, voiceStream;
$("recordVoice").onclick = async () => {
  try {
    voiceStream = await navigator.mediaDevices.getUserMedia({ audio: true });
    voiceRecorder = new MediaRecorder(voiceStream);
    const chunks = [];
    voiceRecorder.ondataavailable = (e) => chunks.push(e.data);
    const key = $("recordPhrase").value;
    voiceRecorder.onstop = () => {
      voiceStream.getTracks().forEach((t) => t.stop());
      const blob = new Blob(chunks, { type: voiceRecorder.mimeType });
      const reader = new FileReader();
      reader.onload = () => {
        try {
          save("voice_" + key, reader.result);
          $("voiceRecordStatus").textContent = "Saved on this device.";
        } catch {
          $("voiceRecordStatus").textContent =
            "Recording was too large. Try a shorter phrase.";
        }
      };
      reader.readAsDataURL(blob);
      $("stopVoice").hidden = true;
      $("recordVoice").disabled = false;
    };
    voiceRecorder.start();
    $("stopVoice").hidden = false;
    $("recordVoice").disabled = true;
    $("voiceRecordStatus").textContent = "Recording… read the selected phrase.";
    setTimeout(() => {
      if (voiceRecorder.state === "recording") voiceRecorder.stop();
    }, 12000);
  } catch (e) {
    toast("Microphone unavailable: " + e.message);
  }
};
$("stopVoice").onclick = () =>
  voiceRecorder?.state === "recording" && voiceRecorder.stop();
$("playVoice").onclick = () => {
  const audio = read("voice_" + $("recordPhrase").value, null);
  if (audio) new Audio(audio).play().catch(() => toast("Tap Play again."));
  else toast("Record this phrase first.");
};
setInterval(() => {
  document
    .querySelectorAll(".scan-active")
    .forEach((b) => b.classList.remove("scan-active"));
  scanKind = null;
  if (
    !settings.proactive ||
    !settings.scan ||
    !trained ||
    !perception.running ||
    view !== "patient" ||
    gate.pending ||
    calibration ||
    voiceBusy()
  )
    return;
  const memory = read("preferences_" + personalId(), {}),
    keys = ["water", "toilet", "comfort", "help"].sort(
      (a, b) => (memory[b] || 0) - (memory[a] || 0),
    );
  scanIndex = (scanIndex + 1) % keys.length;
  scanKind = keys[scanIndex];
  document
    .querySelector(`[data-need="${scanKind}"]`)
    ?.classList.add("scan-active");
  say(needs[scanKind] + "? " + confirmationHint());
}, 9000);
async function notifications() {
  try {
    if (!("serviceWorker" in navigator) || !("PushManager" in window))
      throw Error(
        "This browser needs the installed Home Screen app for push. Keep this dashboard open for live updates.",
      );
    const permission = await Notification.requestPermission();
    if (permission !== "granted")
      throw Error(
        "Notifications were not enabled. Live updates still work here.",
      );
    const d =
      careData ||
      (await call("session", {
        cred: carePatients.find((x) => x.patientId === careId),
      }));
    if (!d.vapidPublicKey) throw Error("Push service unavailable");
    const reg = await navigator.serviceWorker.ready;
    const key = Uint8Array.from(
      atob(d.vapidPublicKey.replace(/-/g, "+").replace(/_/g, "/")),
      (c) => c.charCodeAt(0),
    );
    let sub = await reg.pushManager.getSubscription();
    if (!sub)
      sub = await reg.pushManager.subscribe({
        userVisibleOnly: true,
        applicationServerKey: key,
      });
    await call("session", {
      cred: carePatients.find((x) => x.patientId === careId),
      body: { action: "subscribe", subscription: sub.toJSON() },
    });
    toast("Caregiver notifications enabled for this patient.");
  } catch (e) {
    toast(e.message);
  }
}
$("enableNotifications").onclick = notifications;
if ("serviceWorker" in navigator)
  navigator.serviceWorker.register(new URL("sw.js", site)).catch(() => {});
function metric(label, id, value = "—") {
  return `<div class="metric"><small>${label}</small><strong id="${id}">${value}</strong></div>`;
}
function chart(id, label) {
  return `<span class="eyebrow">${label}</span><canvas id="${id}" class="chart" aria-label="${label}"></canvas>`;
}
function renderModule() {
  const isFinger = module === "fingerspeak";
  $("fingerStudioHost").hidden = !isFinger;
  document
    .querySelector(".studio-layout")
    .classList.toggle("finger-full", isFinger);
  if (isFinger) captureDock.append(viewport);
  else if (view === "details")
    cameraPanel.insertBefore(viewport, $("cameraStatus"));
  perception.setActiveModule(module);
  document
    .querySelectorAll("[data-module]")
    .forEach((b) => b.classList.toggle("active", b.dataset.module === module));
  let html = "";
  if (module === "facespeak") html = faceStudio();
  if (module === "fingerspeak") {
    html = `<div class="card"><span class="eyebrow">BOTH HANDS, YOUR CHOICE</span><h2>FingerSpeak</h2><p class="muted">Both hands are tracked independently. Anyone can explore this interface, regardless of assessment. Familiar poses are detected automatically; a personal mapping needs three distinct holds.</p><div id="handReadings"><div class="empty">Bring one or both hands into view.</div></div><label class="field">Gesture<select id="handPose"><option>Open palm</option><option>Index extended</option><option>Two fingers extended</option><option>Three fingers extended</option><option>Closed fingers</option></select></label><label class="field">Meaning<select id="handMeaning"><option value="help">Caregiver</option><option value="water">Water</option><option value="toilet">Toilet</option><option value="food">Food</option><option value="comfort">Comfort</option></select></label><button id="trainHand" class="primary">Learn this gesture</button><p id="handTrainStatus" class="small muted">Hold for a moment, relax, and repeat three times. Then repeat a mapped gesture to confirm a proposed request.</p><div id="savedHands"></div></div>`;
  }
  if (module === "vitalsense") {
    html = `<div class="card"><span class="eyebrow">LOCAL CAMERA SIGNAL</span><h2>VitalSense</h2><p class="muted">Sit comfortably in steady light. A small forehead region supplies a color signal; motion and weak signals are rejected.</p><div class="metrics">${metric("Camera pulse estimate", "pulseValue")}${metric("Signal quality", "pulseQuality")}${metric("Window", "pulseWindow", "20 sec")}</div>${chart("pulseChart", "COLOR PULSE SIGNAL")}<p id="pulseReason" class="muted">Start the camera and allow 20 seconds.</p><p class="small muted">Experimental pulse trend, not a medical vital measurement. This camera cannot measure blood pressure, oxygen saturation or temperature. No emergency action uses this estimate.</p></div>`;
  }
  if (module === "posture") {
    html = `<div class="card"><span class="eyebrow">SHARED ACROSS EVERY INTERFACE</span><h2>Body posture</h2><p class="muted">Position the camera so shoulders and, if possible, hips are visible. Lightweight body tracking stays active in every module. A sustained change can prompt a gentle check-in.</p><div class="metrics">${metric("Observed position", "poseLabel")}${metric("Shoulder tilt", "poseTilt")}${metric("Body movement", "poseMotion")}</div>${chart("poseChart", "POSTURE TREND")}<button id="enableYolo" class="secondary">${perception.yoloEnabled ? "Pause" : "Enable"} YOLO cross-check</button><p id="yoloStatus" class="small muted">YOLO26 pose runs in its own worker. It is an optional, heavier second model; lightweight pose remains active.</p><p class="small muted">Rest-to-awake check-in requires one minute of valid closed-eye, still-body observations followed by eyes opening and body movement. It does not identify sleep stages or diagnose falls or pain.</p></div>`;
  }
  if (module === "senseassist") {
    html = `<div class="card"><span class="eyebrow">YOUR WORDS, MORE CLEARLY</span><h2>SenseAssist</h2><p class="muted">Practice a phrase or clarify something you want to say. Review the heard words, then Asha suggests the closest intended meaning.</p><label class="field">Practice phrase / context (optional)<input id="speechTarget" maxlength="150" placeholder="e.g. red rabbit green"></label><label class="field">Listening language<select id="speechLanguage"><option value="en-US">English</option><option value="bn-BD">বাংলা · Bangla</option></select></label><p class="small muted">Choose the language you are speaking. For mixed speech, choose the main language and edit any missed words before asking Asha.</p><div class="actions"><button id="listenSpeech" class="primary">Start listening</button><button id="stopSpeech" class="secondary" disabled>Stop</button><button id="hearTarget" class="secondary">Hear phrase</button></div><p id="speechStatus" class="small muted">Microphone speech recognition depends on your browser and may use its online service. Only the reviewed words are sent to Asha.</p><label class="field">What was heard · editable<textarea id="heardSpeech" maxlength="600" placeholder="For example: wed wabbit wghreen"></textarea></label><button id="interpretSpeech" class="primary">Make my meaning clearer →</button><div id="speechResult"></div><button id="practiceAdvice" class="text-button">Ask Asha for a practice cue →</button></div>`;
  }
  if (isFinger) {
    ensureFingerStudio();
    html =
      '<details class="card"><summary>Quick familiar-pose mappings (optional)</summary>' +
      html +
      "</details>";
  }
  $("moduleContent").innerHTML = html;
  if ($("nf-calibrate")) {
    $("nf-calibrate").onclick = $("nf-calibrateRules").onclick = () =>
      $("calibrateButton").click();
    $("nf-reference").onclick = () => {
      perception.resetFaceReference();
      toast("Relax your face with eyes open for 45 valid frames.");
    };
    $("nf-clearLog").onclick = () => {
      perception.analysis.log = [];
      paint(perception.snapshot);
    };
    $("nf-exportLog").onclick = () => {
      const url = URL.createObjectURL(
        new Blob(
          [
            JSON.stringify(
              {
                type: "NeuroFace observations, not diagnoses",
                events: perception.analysis.log,
              },
              null,
              2,
            ),
          ],
          { type: "application/json" },
        ),
      );
      const a = document.createElement("a");
      a.href = url;
      a.download = "neuroface-observations.json";
      a.click();
      setTimeout(() => URL.revokeObjectURL(url), 1000);
    };
  }
  if ($("trainHand"))
    $("trainHand").onclick = () => {
      if (!perception.running) {
        toast("Start the camera first.");
        return;
      }
      pendingHandTraining = {
        pose: $("handPose").value,
        kind: $("handMeaning").value,
        count: 0,
      };
      $("handTrainStatus").textContent =
        "Show the chosen gesture. Hold, relax, repeat — 0/3.";
    };
  if ($("savedHands"))
    $("savedHands").innerHTML = Object.entries(handMaps)
      .map(
        ([p, m]) =>
          `<div class="rule"><span>${esc(p)}</span><strong>${esc(needs[m.kind])}</strong></div>`,
      )
      .join("");
  if ($("enableYolo"))
    $("enableYolo").onclick = async () => {
      const b = $("enableYolo");
      b.disabled = true;
      try {
        if (!perception.running) await startMonitor();
        if (!perception.running) return;
        const on = await perception.enableYolo();
        b.textContent = on
          ? "Pause YOLO cross-check"
          : "Enable YOLO cross-check";
        $("yoloStatus").textContent = on
          ? "YOLO is running alongside the shared camera."
          : "YOLO paused; lightweight pose remains active.";
      } catch (e) {
        $("yoloStatus").textContent = e.message;
      } finally {
        b.disabled = false;
      }
    };
  if (module === "senseassist") wireSpeech();
  paint(perception.snapshot);
}
document.querySelectorAll("[data-module]").forEach(
  (b) =>
    (b.onclick = () => {
      module = b.dataset.module;
      settings.scan = false;
      save("settings", settings);
      $("modeBadge").textContent = names[module];
      renderModule();
      guide.clear();
      guide.lastPrompt = performance.now();
      if (settings.proactive) say(moduleGuidance[module]);
      heartbeat();
    }),
);
function paint(s) {
  if (!s.raw || !perception.running) return;
  $("fpsBadge").textContent = s.latency + " ms";
  const summary = `<div><span>NeuroFace Sense</span><strong>${s.raw.facePresent ? "Face tracked" : "Searching for face"}</strong></div><div><span>FingerSpeak</span><strong>${s.hands.length} / 2 hands tracked</strong></div><div><span>Posture</span><strong>${esc(s.posture?.label || "Searching for body")}</strong></div><div><span>VitalSense</span><strong>${s.pulse?.bpm ? s.pulse.bpm + " bpm · estimate" : esc(s.pulse?.reason || "Collecting signal")}</strong></div><div><span>FaceSpeak calibration</span><strong>${trained ? "Personal" : "Needed for commands"}</strong></div>`;
  if ($("liveSummary").dataset.content !== summary) {
    $("liveSummary").dataset.content = summary;
    $("liveSummary").innerHTML = summary;
  }
  $("liveSummary").dataset.cycles = JSON.stringify(s.cycles || {});
  if (view !== "details") return;
  paintFaceStudio(s, trained, {
    question: guide.pending ? "Awaiting an answer" : "No question open",
  });
  const text = (id, v) => {
    if ($(id)) $(id).textContent = v;
  };
  text("blinkCount", s.blinks);
  text("earValue", s.raw.earMean?.toFixed(2) || "—");
  for (const [id, key, unit] of [
    ["earLeft", "earLeft", ""],
    ["earRight", "earRight", ""],
    ["lipValue", "mar", ""],
    ["yawValue", "yaw", "°"],
    ["pitchValue", "pitch", "°"],
    ["rollValue", "roll", "°"],
  ]) {
    text(
      id,
      Number.isFinite(s.raw[key])
        ? s.raw[key].toFixed(unit ? 0 : 2) + unit
        : "—",
    );
  }
  if ($("expressionReadings")) {
    const bs = s.blendshapes || {};
    const values = [
      ["Inner brow raise", ["browInnerUp"]],
      ["Brow lowering", ["browDownLeft", "browDownRight"]],
      ["Cheek raise", ["cheekSquintLeft", "cheekSquintRight"]],
      ["Smile", ["mouthSmileLeft", "mouthSmileRight"]],
      ["Lip stretch", ["mouthStretchLeft", "mouthStretchRight"]],
      ["Jaw opening", ["jawOpen"]],
    ];
    $("expressionReadings").innerHTML = values
      .map(([label, keys]) => {
        const value = keys.every((k) => Number.isFinite(bs[k]))
          ? Math.round(
              (100 * keys.reduce((v, k) => v + bs[k], 0)) / keys.length,
            )
          : null;
        return `<div class="bar-row"><span>${label}</span><progress ${value === null ? 'value="0"' : `value="${value}"`} max="100" aria-label="${label}"></progress><span>${value === null ? "—" : value + "%"}</span></div>`;
      })
      .join("");
  }
  text(
    "smileValue",
    s.face?.smile ? Math.round(s.face.smile.smileIntensity * 100) + "%" : "—",
  );
  text("pulseValue", s.pulse?.bpm ? s.pulse.bpm + " bpm" : "—");
  text("pulseQuality", Math.round((s.pulse?.quality || 0) * 100) + "%");
  text("pulseReason", s.pulse?.reason || "Collecting signal");
  text("poseLabel", s.posture?.label || "Not visible");
  text(
    "poseTilt",
    s.posture?.valid ? Math.round(s.posture.shoulderTilt) + "°" : "—",
  );
  text(
    "poseMotion",
    s.posture?.valid ? (s.posture.motion > 0.012 ? "Moving" : "Still") : "—",
  );
  if (s.yolo)
    text(
      "yoloStatus",
      `YOLO26: ${s.yolo.person ? "person detected, " + Math.round(s.yolo.person.score * 100) + "% confidence" : "no confident person"} · ${s.yolo.ms} ms`,
    );
  if ($("handReadings"))
    $("handReadings").innerHTML = s.hands.length
      ? s.hands
          .map(
            (h) =>
              `<div class="hand-card"><strong>${esc(h.label)} · ${esc(h.pose)}</strong>${h.openness.map((n, i) => `<div class="bar-row"><span>${["Thumb", "Index", "Middle", "Ring", "Little"][i]}</span><progress value="${n}" max="100"></progress></div>`).join("")}</div>`,
          )
          .join("")
      : '<div class="empty">Bring one or both hands into view.</div>';
  drawChart("eyeChart", "ear", "#448e85");
  drawChart("smileChart", "smile", "#9a7fba");
  drawChart("lipChart", "lip", "#b27077");
  drawChart("yawChart", "yaw", "#448e85");
  drawChart("pitchChart", "pitch", "#9a7fba");
  drawChart("motionChart", "motion", "#cc9b56");
  drawChart("pulseChart", "pulse", "#448e85");
  drawChart("poseChart", "pose", "#9a7fba");
}
function drawChart(id, key, color) {
  const el = $(id);
  if (!el || !history.length) return;
  const w = (el.width = Math.max(200, el.clientWidth) * devicePixelRatio),
    h = (el.height = 130 * devicePixelRatio),
    c = el.getContext("2d");
  c.clearRect(0, 0, w, h);
  const values = history.map((x) => x[key]);
  let min = Math.min(...values),
    max = Math.max(...values);
  if (key === "ear") {
    min = 0;
    max = Math.max(0.5, max);
  } else if (key === "smile") {
    min = 0;
    max = 1;
  } else if (max - min < 0.001) {
    min -= 0.001;
    max += 0.001;
  }
  c.strokeStyle = getComputedStyle(document.documentElement).getPropertyValue(
    "--line",
  );
  c.lineWidth = devicePixelRatio;
  for (let i = 1; i < 4; i++) {
    c.beginPath();
    c.moveTo(0, (h * i) / 4);
    c.lineTo(w, (h * i) / 4);
    c.stroke();
  }
  c.strokeStyle = color;
  c.lineWidth = 2 * devicePixelRatio;
  c.beginPath();
  values.forEach((v, i) => {
    const x = (i / Math.max(1, values.length - 1)) * w,
      y = h - 12 - ((v - min) / (max - min)) * (h - 24);
    i ? c.lineTo(x, y) : c.moveTo(x, y);
  });
  c.stroke();
}
function wireSpeech() {
  const SR = window.SpeechRecognition || window.webkitSpeechRecognition;
  $("speechLanguage").value = settings.speechLanguage === "bn-BD" ? "bn-BD" : "en-US";
  $("speechLanguage").onchange = () => {
    recognition?.stop();
    settings.speechLanguage = $("speechLanguage").value;
    save("settings", settings);
    $("speechStatus").textContent = "Listening language updated. Start listening when you are ready.";
  };
  if (!SR) {
    $("listenSpeech").disabled = true;
    $("speechStatus").textContent =
      "Live transcription is not supported here. Use keyboard dictation or type the heard words, then ask Asha to clarify.";
  }
  $("listenSpeech").onclick = () => {
    recognition?.abort();
    speechSession++;
    const n = speechSession;
    recognition = new SR();
    recognition.lang = $("speechLanguage").value;
    recognition.continuous = true;
    recognition.interimResults = true;
    recognition.maxAlternatives = 3;
    let final = "";
    recognition.onresult = (e) => {
      if (n !== speechSession || !$("heardSpeech")) return;
      let interim = "";
      for (let i = e.resultIndex; i < e.results.length; i++) {
        if (e.results[i].isFinal) final += e.results[i][0].transcript + " ";
        else interim += e.results[i][0].transcript;
      }
      $("heardSpeech").value = (final + interim).trim();
    };
    recognition.onerror = (e) => {
      if ($("speechStatus"))
        $("speechStatus").textContent =
          "Speech capture: " + e.error + ". You can edit the words below.";
    };
    recognition.onend = () => {
      if ($("listenSpeech")) {
        $("listenSpeech").disabled = false;
        $("stopSpeech").disabled = true;
      }
    };
    recognition.start();
    $("listenSpeech").disabled = true;
    $("stopSpeech").disabled = false;
    $("speechStatus").textContent =
      "Listening… speak slowly and comfortably. Stop when finished.";
  };
  $("stopSpeech").onclick = () => recognition?.stop();
  $("hearTarget").onclick = () =>
    say($("speechTarget").value || "Choose a comfortable phrase to practice.", {
      force: true,
    });
  $("interpretSpeech").onclick = async () => {
    recognition?.stop();
    const heard = $("heardSpeech").value.trim();
    if (!heard) {
      toast("Say or type the heard words first.");
      return;
    }
    const button = $("interpretSpeech"),
      resultPatientId = personalId(),
      resultWasDemo = demoSession;
    let resultNode = $("speechResult");
    button.disabled = true;
    $("speechResult").innerHTML =
      '<p class="muted">Asha is listening to your meaning…</p>';
    try {
      const d = await askAsha(heard, {
        mode: "interpret",
        context: $("speechTarget").value,
      });
      // Preserve a recovered demo reply without applying it to another patient.
      if (ashaResponseSessions.get(d) !== personalId()) return;
      if (resultNode !== $("speechResult")) {
        if (!resultWasDemo || !demoSession || resultPatientId === personalId() || !$("speechResult")) return;
        resultNode = $("speechResult");
        $("heardSpeech").value = heard;
      }
      speechCandidate = d.candidate;
      speechHeard = heard;
      $("speechResult").innerHTML =
        `<div class="divider"></div><span class="eyebrow">POSSIBLE MEANING · PLEASE CONFIRM</span><p class="speech-result">${esc(d.candidate)}</p><p>${esc(d.question)}</p>${d.alternatives.map((x) => `<button class="secondary" data-alternative="${esc(x)}">${esc(x)}</button>`).join("")}<div class="actions"><button id="speakCandidate" class="primary">Yes, speak this</button><button id="sendCandidate" class="secondary">Send to caregiver</button><button id="retrySpeech" class="text-button">That’s not right</button></div>`;
      const details = ashaDetails(d);
      if (details) $("speechResult").append(details);
      $("speakCandidate").onclick = () => {
        say(speechCandidate, { force: true, language: d.language });
        const stored = read("speech_" + personalId(), []),
          memory = Array.isArray(stored) ? stored : [];
        memory.push({ heard: speechHeard, confirmedText: speechCandidate, confirmed: true });
        save("speech_" + personalId(), memory.slice(-30));
        toast("Confirmed wording saved on this device.");
      };
      $("sendCandidate").onclick = () =>
        propose("message", "speech", speechCandidate);
      $("retrySpeech").onclick = () => {
        $("speechResult").innerHTML = "";
        $("heardSpeech").focus();
      };
      document.querySelectorAll("[data-alternative]").forEach(
        (b) =>
          (b.onclick = () => {
            speechCandidate = b.dataset.alternative;
            document.querySelector(".speech-result").textContent =
              speechCandidate;
          }),
      );
    } catch (e) {
      if (resultNode === $("speechResult") && resultPatientId === personalId())
        resultNode.textContent = e.message;
    } finally {
      button.disabled = false;
    }
  };
  $("practiceAdvice").onclick = () => {
    openChat();
    $("chatInput").value =
      "Give me one gentle speech practice cue for: " +
      ($("speechTarget").value || "a short everyday phrase");
  };
}
async function initialize() {
  try {
    const u = new URL(location.href);
    if (u.hash.includes("token=")) {
      const c = parseLink(u.href);
      await acceptLink(c);
      historyReplace();
    } else if (
      u.searchParams.get("role") === "caregiver" ||
      location.pathname.endsWith("/care")
    )
      show("caregiver");
    else if (patient) await openPatient();
    const requestedModule = u.searchParams.get("module");
    if (!profile && ["facespeak", "fingerspeak", "vitalsense", "senseassist", "posture"].includes(requestedModule))
      await startDemo(requestedModule);
    if (
      profile &&
      view !== "caregiver" &&
      [
        "facespeak",
        "fingerspeak",
        "vitalsense",
        "senseassist",
        "posture",
      ].includes(requestedModule)
    ) {
      module = requestedModule;
      $("modeBadge").textContent = names[module];
      show("details");
    }
  } catch (e) {
    toast(e.message);
  }
  fetch(new URL("health", api))
    .then((r) => r.json())
    .then((d) => {
      $("cloudBadge").textContent = demoSession && !patient
        ? "Local demo"
        : d.cloudConfigured
          ? "Asha cloud configured"
          : d.caregiverConfigured
            ? "Care circle online · AI unavailable"
            : "Local support";
    })
    .catch(() => ($("cloudBadge").textContent = "Local support"));
}
function historyReplace() {
  window.history.replaceState(null, "", location.pathname + location.search);
}
initialize();
