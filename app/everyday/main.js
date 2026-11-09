import { EvidenceStore } from "./evidence.js";
import {
  CameraManager,
  TelemetryService,
  deviceCapabilities,
} from "./platform.js";
import { FEATURES, MODULES } from "./contracts.js";
import { MODEL_REGISTRY } from "./model-registry.js";
import { evaluateSafety, safetyMessage, SAFETY_POLICY } from "./safety.js";

const $ = (s) => document.querySelector(s);
const store = new EvidenceStore();
const telemetry = new TelemetryService();
const camera = new CameraManager(
  $("#sharedVideo"),
  $("#sharedOverlay"),
  telemetry,
);
const names = {
  home: "Good to have you here.",
  nutrition: "Eat with a little more insight.",
  move: "A little movement, at your pace.",
  eyespeak: "Your eyes. Your words.",
  care: "A place to feel heard.",
  clinic: "Connected care, with your permission.",
  privacy: "Your information stays yours.",
};
const bnNames = {
  home: "আপনাকে পেয়ে ভালো লাগছে।",
  nutrition: "খাবার সম্পর্কে আরও জানুন।",
  move: "নিজের গতিতে একটু নড়াচড়া।",
  eyespeak: "আপনার চোখ। আপনার কথা।",
  care: "আপনার কথা শোনার জায়গা।",
  clinic: "আপনার অনুমতিতে সংযুক্ত সেবা।",
  privacy: "আপনার তথ্য আপনারই।",
};
const guides = {
  home: "Choose Nutrition to log food, Move for movement practice, EyeSpeak to communicate, or Care for a journal and visit preparation. Your assistive tools remain in the Assistive app.",
  nutrition:
    "Search for food in English or Bangla. Choose the amount, check ingredients and confirm before saving. A photo checks image quality; automatic food recognition is not installed.",
  move: "Choose a movement and read the camera placement guide. Start only when you feel comfortable. For rehabilitation, use a plan set by your clinician. Stop if you feel pain or unwell.",
  eyespeak:
    "Touch a phrase to speak. You can also use switch scanning. For gaze, capture a calibration and pass the separate target check. A caregiver can help set up the camera.",
  care: "Write what you noticed. Urgent guidance is checked on this device first. Save a journal, choose health context, or ask for a nonurgent explanation with cloud consent.",
  clinic:
    "Create a clinic workspace or open a private invitation. Patients choose which modules and records to share. A role link grants access but does not verify professional identity.",
  privacy:
    "Records are in memory until you create an encrypted vault. Use a private passphrase to save across visits. Export, delete, revoke module saving or check device details here.",
};
const bnGuides = {
  home: "খাবার লিখতে নিউট্রিশন, নড়াচড়ার অনুশীলনে মুভ, যোগাযোগে আইস্পিক, আর ডায়েরি ও চিকিৎসকের সাক্ষাতের প্রস্তুতিতে কেয়ার বেছে নিন। আগের সহায়ক ফিচারগুলো অ্যাসিস্টিভ অ্যাপে আছে।",
  nutrition:
    "বাংলা বা ইংরেজিতে খাবার খুঁজুন। পরিমাণ ও উপাদান যাচাই করে সংরক্ষণ করুন। ছবির মান পরীক্ষা হয়; স্বয়ংক্রিয় খাবার শনাক্তকরণ ইনস্টল করা নেই।",
  move: "নড়াচড়া বেছে নিয়ে ক্যামেরার নির্দেশনা পড়ুন। স্বচ্ছন্দ থাকলেই শুরু করুন। পুনর্বাসনের জন্য চিকিৎসকের পরিকল্পনা ব্যবহার করুন। ব্যথা বা অসুস্থ লাগলে থামুন।",
  eyespeak:
    "বাক্যে ছুঁয়ে কথা বলুন অথবা সুইচ স্ক্যান ব্যবহার করুন। চোখ দিয়ে বাছাই করতে ক্যালিব্রেশন ও আলাদা লক্ষ্য পরীক্ষা সম্পন্ন করুন।",
  care: "কী পরিবর্তন হয়েছে লিখুন। জরুরি নির্দেশনা আগে এই যন্ত্রেই যাচাই হয়। অনুমতি দিয়ে সাধারণ ব্যাখ্যার জন্য এআই ব্যবহার করতে পারেন।",
  clinic:
    "ক্লিনিকের কাজের জায়গা তৈরি করুন অথবা ব্যক্তিগত আমন্ত্রণ খুলুন। কোন তথ্য শেয়ার হবে তা রোগী বেছে নেবেন।",
  privacy:
    "এনক্রিপ্টেড ভল্ট তৈরি না করা পর্যন্ত তথ্য শুধু এই সেশনে থাকে। পাসফ্রেজ দিয়ে সংরক্ষণ, রপ্তানি ও মুছে ফেলার নিয়ন্ত্রণ পাবেন।",
};
let route = "home",
  cleanup = null,
  transition = Promise.resolve(),
  sequence = 0,
  plan = null,
  toastTimer;
let language = "en";
let speechCapture = null,
  speechGeneration = 0;
try {
  language =
    localStorage.getItem("asha_everyday_language") === "bn" ? "bn" : "en";
  document.documentElement.dataset.theme =
    localStorage.getItem("asha_everyday_theme") ||
    (matchMedia("(prefers-color-scheme: dark)").matches ? "dark" : "light");
} catch {}
$("#language").value = language;
function notify(text) {
  $("#toast").textContent = text;
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => {
    $("#toast").textContent = "";
  }, 5500);
}
function download(name, text, mime = "application/json") {
  const a = document.createElement("a"),
    url = URL.createObjectURL(new Blob([text], { type: mime }));
  a.href = url;
  a.download = name;
  document.body.append(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 30000);
}
function speak(text) {
  if (!("speechSynthesis" in window))
    return notify("Voice playback is unavailable. The words remain on screen.");
  const generation = ++speechGeneration;
  speechCapture?.pauseForOutput();
  speechSynthesis.cancel();
  const voice = new SpeechSynthesisUtterance(text);
  voice.lang = language === "bn" ? "bn-BD" : "en-US";
  voice.rate = 0.93;
  voice.onend = voice.onerror = () => {
    if (generation === speechGeneration) speechCapture?.resumeAfterOutput();
  };
  speechSynthesis.speak(voice);
}
async function request(url, body, token) {
  const controller = new AbortController(),
    timeout = setTimeout(() => controller.abort(), 18000);
  try {
    const r = await fetch(url, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        ...(token ? { Authorization: "Bearer " + token } : {}),
      },
      body: JSON.stringify(body),
      signal: controller.signal,
      cache: "no-store",
    });
    const d = await r.json();
    if (!r.ok) throw Error(d.error || "This connection is unavailable.");
    return d;
  } catch (e) {
    if (e.name === "AbortError")
      throw Error(
        "The connection is taking too long. Try again; your local tools are ready.",
      );
    throw e;
  } finally {
    clearTimeout(timeout);
  }
}
let credentialPromise;
async function credential() {
  let value;
  try {
    value = JSON.parse(sessionStorage.getItem("asha_everyday_cloud"));
  } catch {}
  if (
    value?.patientId &&
    value?.token &&
    Date.parse(value.expiresAt) > Date.now()
  )
    return value;
  if (!credentialPromise)
    credentialPromise = request("/api/session", {
      action: "create",
      label: "Everyday demo",
      assessment: {},
      supportContext: {},
      voice: { language },
    })
      .then((d) => {
        const c = {
          patientId: d.patientId,
          token: d.patientToken,
          expiresAt: d.expiresAt,
        };
        try {
          sessionStorage.setItem("asha_everyday_cloud", JSON.stringify(c));
        } catch {}
        return c;
      })
      .finally(() => {
        credentialPromise = null;
      });
  return credentialPromise;
}
async function askCare(input) {
  const decision = evaluateSafety(input.text, { region: input.region });
  if (!decision.allowLLM)
    return {
      reply: safetyMessage(decision, input.language),
      safety: decision,
      generated: false,
    };
  if (input.consent !== true)
    throw Error("Choose cloud consent before sending a question.");
  const c = await credential();
  return request("/api/care", { ...input, patientId: c.patientId }, c.token);
}
const ctx = {
  camera,
  telemetry,
  language: () => language,
  notify,
  speak,
  download,
  askCare,
  store: {
    add: async (r) => {
      const saved = await store.add(r);
      updateVaultStatus();
      return saved;
    },
    list: (module) =>
      module === "plans"
        ? Promise.resolve(plan ? [plan] : [])
        : store.list(module),
    remove: (id) => store.remove(id),
  },
  get plan() {
    return plan;
  },
  setPlan(value) {
    plan = value;
    notify("Clinician plan selected. Open Move to use it.");
  },
  registerSpeechCapture(value) {
    speechCapture = value;
    return () => {
      if (speechCapture === value) speechCapture = null;
    };
  },
};
function updateVaultStatus() {
  $("#vaultStatus").textContent = store.persistent
    ? "Encrypted vault open"
    : "Session only";
}
function guide() {
  return (language === "bn" ? bnGuides : guides)[route];
}
function home(host) {
  const cards = [
    [
      "nutrition",
      "◒",
      "Nutrition",
      "খাবার",
      "Log a meal. Adjust portions. Understand what went into it.",
    ],
    [
      "move",
      "↗",
      "Move",
      "নড়াচড়া",
      "Practice a movement with real camera feedback.",
    ],
    [
      "eyespeak",
      "◉",
      "EyeSpeak",
      "চোখের ভাষা",
      "Say what matters with gaze, touch or a switch.",
    ],
    [
      "care",
      "♡",
      "Care",
      "যত্ন",
      "Keep a journal. Get support. Prepare for your next visit.",
    ],
  ];
  host.innerHTML = `<section class="card hero-card"><div><span class="eyebrow">WITH YOU, IN EVERY WAY</span><h2>${language === "bn" ? "প্রতিদিন একটু সহজ হোক।" : "More ease.<br>More everyday possibility."}</h2><p>${language === "bn" ? "খাবার, নড়াচড়া, যোগাযোগ আর যত্ন। আপনার নিয়ন্ত্রণে একসাথে।" : "Food, movement, communication and care. Together in one place, with you in control."}</p><a class="primary" href="#care">${language === "bn" ? "আপনি কেমন আছেন?" : "How are you feeling today?"} →</a></div><div class="hero-art" aria-hidden="true"><div class="hero-orbit">♡</div></div></section><div class="section-heading"><h2>${language === "bn" ? "আজ কী করতে চান?" : "What would help today?"}</h2><a href="#privacy" class="small">Privacy & details →</a></div><div class="module-grid">${cards.map(([id, icon, en, bn, desc]) => `<a href="#${id}" class="card module-card"><span class="module-icon" aria-hidden="true">${icon}</span><h3>${language === "bn" ? bn : en}</h3><p>${desc}</p><span class="open">Open ${en} ↗</span></a>`).join("")}</div><section class="card"><div class="section-heading"><h3>Already using Asha for communication?</h3><a class="secondary" href="/app">Open assistive app ↗</a></div><p class="muted">FaceSpeak, FingerSpeak, VitalSense, SenseAssist, posture and your care circle are available together in the existing app.</p></section><p class="muted small">New tools are experimental. Nutrition is an ingredient estimate; Move and gaze need a supported camera setup. No account or patient link is needed to explore.</p>`;
}
async function privacy(host) {
  host.innerHTML = `<div class="privacy-grid"><section class="card"><h2>Save privately on this device</h2><p class="muted">Without a vault, records disappear when you reload. The encrypted vault uses your passphrase. We cannot recover a forgotten passphrase.</p><form id="vaultForm"><label class="field">Private passphrase<input type="password" id="passphrase" minlength="10" autocomplete="current-password" required></label><div class="actions"><button class="primary" id="unlockVault">Create or unlock vault</button><button type="button" class="secondary" id="lockVault">Lock and clear session</button></div></form><p role="status" id="vaultInfo"></p><div class="actions"><button class="secondary" id="exportRecords">Export records</button><button class="secondary danger" id="deleteRecords">Delete all local data</button></div></section><section class="card"><h2>Your saving choices</h2><p class="muted">Saving is local. Turning a module off removes its local records. Clinic copies must be revoked separately in Clinic.</p><div id="consents"></div><label class="field">Local retention<select id="retention"><option value="7">7 days</option><option value="30">30 days</option><option value="90">90 days</option></select></label><button class="secondary" id="saveRetention">Apply retention</button></section></div><section class="card"><h2>Device & model details</h2><p class="muted">One vision model runs at a time, only after you start the camera. Camera frames are not uploaded. Switching pages or hiding the app stops tracking.</p><div id="deviceDetails"></div><details><summary>Models, sources & release state</summary><div id="modelDetails"></div><p class="notice">Food recognition, offline speech recognition and signed downloadable release packs are off. No validated food weights or trusted release signing key are configured. Clinical review of symptom rules is pending.</p></details><details><summary>Local performance measurements</summary><label><input type="checkbox" id="telemetry"> Measure model inference time on this device (no uploads)</label><button class="secondary" id="refreshTimings">Show measurements</button><pre id="timings">No measurements collected.</pre></details><details><summary>Feature flags</summary><pre id="flags"></pre></details></section>`;
  const q = (s) => host.querySelector(s);
  let alive = true;
  q("#vaultInfo").textContent = (await store.vaultExists())
    ? store.persistent
      ? "Vault unlocked."
      : "An encrypted vault exists. Unlock to see saved records."
    : "Session only. Create a vault to keep records after reloading.";
  q("#vaultForm").onsubmit = async (e) => {
    e.preventDefault();
    const pass = q("#passphrase").value;
    q("#passphrase").value = "";
    const button = q("#unlockVault");
    button.disabled = true;
    try {
      if (await store.vaultExists()) await store.unlock(pass);
      else await store.create(pass);
      if (alive) {
        q("#vaultInfo").textContent = "Encrypted vault unlocked.";
        renderConsents();
      }
      updateVaultStatus();
    } catch (error) {
      if (alive) q("#vaultInfo").textContent = error.message;
    } finally {
      if (alive) button.disabled = false;
    }
  };
  q("#lockVault").onclick = () => {
    store.lock();
    plan = null;
    updateVaultStatus();
    notify("Vault locked. Session records cleared.");
    void renderRoute();
  };
  q("#exportRecords").onclick = async () => {
    try {
      const text = JSON.stringify(await store.export(), null, 2);
      let preview = q("#exportText");
      if (!preview) {
        const label = document.createElement("label");
        label.className = "field";
        label.textContent =
          "Exported records · unencrypted. Copy this text if file downloads are unavailable.";
        preview = document.createElement("textarea");
        preview.id = "exportText";
        preview.readOnly = true;
        preview.rows = 6;
        label.append(preview);
        q("#vaultForm").parentElement.append(label);
      }
      preview.value = text;
      download("asha-everyday-records.json", text);
    } catch (e) {
      notify(e.message);
    }
  };
  q("#deleteRecords").onclick = async () => {
    if (
      !confirm(
        "Delete all Everyday records and the encrypted vault on this device? This cannot be undone.",
      )
    )
      return;
    try {
      await store.deleteAll();
      plan = null;
      updateVaultStatus();
      notify("Local Everyday data deleted. Clinic data is managed separately.");
      void renderRoute();
    } catch (e) {
      notify(e.message);
    }
  };
  function renderConsents() {
    q("#consents").replaceChildren();
    for (const module of MODULES) {
      const label = document.createElement("label"),
        input = document.createElement("input");
      input.type = "checkbox";
      input.checked = store.consent[module];
      input.onchange = async () => {
        input.disabled = true;
        try {
          await store.setConsent(module, input.checked);
          notify(
            input.checked
              ? "Local saving enabled."
              : "Local records for this module removed.",
          );
        } catch (e) {
          input.checked = !input.checked;
          notify(e.message);
        } finally {
          input.disabled = false;
        }
      };
      label.append(input, module[0].toUpperCase() + module.slice(1));
      q("#consents").append(label);
    }
    q("#retention").value = String(store.retentionDays);
  }
  renderConsents();
  q("#saveRetention").onclick = async () => {
    try {
      store.retentionDays = Number(q("#retention").value);
      await store.prune();
      await store.saveSettings();
      notify("Retention applied to local records.");
    } catch (e) {
      notify(e.message);
    }
  };
  const capabilities = deviceCapabilities();
  q("#deviceDetails").textContent =
    `Camera ${capabilities.camera ? "available" : "unavailable"} · WASM ${capabilities.wasm ? "available" : "unavailable"} · WebGPU ${capabilities.webgpu ? "detected (vision uses MediaPipe delegate)" : "not detected"} · device memory hint ${capabilities.memoryGB || "unknown"} GB · logical cores ${capabilities.cores || "unknown"}`;
  const eviction = document.createElement("button");
  eviction.className = "secondary";
  eviction.textContent = "Remove cached vision downloads";
  eviction.onclick = async () => {
    try {
      camera.stop();
      for (const name of await caches.keys())
        if (name === "asha-live-v1" || name.startsWith("asha-pack-"))
          await caches.delete(name);
      notify(
        "Cached vision downloads removed. Camera models will download again when needed.",
      );
    } catch {
      notify("Model cache could not be cleared in this browser.");
    }
  };
  q("#modelDetails").append(eviction);
  const table = document.createElement("table");
  table.className = "model-table";
  table.innerHTML =
    "<thead><tr><th>Task</th><th>Model</th><th>Download</th><th>Integrity</th></tr></thead>";
  const tbody = document.createElement("tbody");
  for (const [task, item] of Object.entries(MODEL_REGISTRY)) {
    const tr = document.createElement("tr");
    for (const text of [
      task,
      item.id || item.className,
      (item.bytes / 1e6).toFixed(2) + " MB",
      item.sha256,
    ]) {
      const td = document.createElement("td");
      td.textContent = text;
      tr.append(td);
    }
    tbody.append(tr);
  }
  table.append(tbody);
  q("#modelDetails").append(table);
  q("#telemetry").checked = telemetry.enabled;
  q("#telemetry").onchange = (e) => {
    telemetry.enabled = e.target.checked;
  };
  q("#refreshTimings").onclick = () => {
    q("#timings").textContent = telemetry.report().length
      ? JSON.stringify(telemetry.report(), null, 2)
      : "No measurements collected. Enable measurements, then use a camera module.";
  };
  q("#flags").textContent = JSON.stringify(
    { ...FEATURES, safetyClinicalReview: SAFETY_POLICY.clinicalReview },
    null,
    2,
  );
  return () => {
    alive = false;
  };
}
async function renderRoute() {
  const current = ++sequence;
  transition = transition
    .catch(() => {})
    .then(async () => {
      if (current !== sequence) return;
      if (cleanup) {
        cleanup();
        cleanup = null;
      }
      camera.stop();
      globalThis.speechSynthesis?.cancel();
      const hash = location.hash.slice(1),
        requested = hash.startsWith("clinic=") ? "clinic" : hash;
      route = Object.hasOwn(names, requested) ? requested : "home";
      document.documentElement.lang = language;
      $("#pageTitle").textContent = (language === "bn" ? bnNames : names)[
        route
      ];
      $("#pageKicker").textContent =
        route === "home"
          ? "A LITTLE SUPPORT, EVERY DAY"
          : "ASHA / " + route.toUpperCase();
      $("#ashaGuide").textContent = guide();
      document.querySelectorAll("[data-route]").forEach((a) => {
        if (a.dataset.route === route) a.setAttribute("aria-current", "page");
        else a.removeAttribute("aria-current");
      });
      $("#cameraPanel").hidden = !["move", "eyespeak"].includes(route);
      const host = $("#moduleHost");
      host.replaceChildren();
      try {
        if (route === "home") home(host);
        else if (route === "privacy") cleanup = await privacy(host);
        else {
          const module = await import(`./${route}.js`);
          if (current === sequence) cleanup = await module.mount(host, ctx);
        }
        if ($("#voiceGuides").checked) speak(guide());
      } catch (error) {
        host.replaceChildren();
        const p = document.createElement("p");
        p.className = "notice";
        p.textContent = "This view could not open: " + error.message;
        host.append(p);
      }
      updateVaultStatus();
    });
  return transition;
}
camera.addEventListener("status", (e) => {
  $("#cameraStatus").textContent = e.detail;
  $("#cameraPanel").dataset.running = String(
    e.detail.startsWith("Camera active"),
  );
});
camera.addEventListener("error", (e) => notify(e.detail));
$("#stopCamera").onclick = () => {
  camera.stop();
  void renderRoute();
};
$("#language").onchange = (e) => {
  language = e.target.value;
  try {
    localStorage.setItem("asha_everyday_language", language);
  } catch {}
  void renderRoute();
};
$("#theme").onclick = () => {
  const theme =
    document.documentElement.dataset.theme === "dark" ? "light" : "dark";
  document.documentElement.dataset.theme = theme;
  try {
    localStorage.setItem("asha_everyday_theme", theme);
  } catch {}
};
$("#readGuide").onclick = () => speak(guide());
$("#closeAsha").onclick = () => {
  $("#ashaPanel").hidden = true;
  $("#ashaBubble").focus();
};
$("#companionForm").onsubmit = async (e) => {
  e.preventDefault();
  const text = $("#companionQuestion").value.trim();
  const target = $("#companionAnswer");
  const decision = evaluateSafety(text, { region: "BD" });
  if (!decision.allowLLM) {
    target.textContent = safetyMessage(decision, language);
    return;
  }
  if (/^(hi|hello|hey|হ্যালো|হাই)[!. ]*$/iu.test(text)) {
    target.textContent =
      language === "bn"
        ? "আমি পাশে আছি। " + guide()
        : "I’m here with you. " + guide();
    return;
  }
  if (!$("#companionConsent").checked) {
    target.textContent = guide();
    return;
  }
  const button = e.target.querySelector("button");
  button.disabled = true;
  target.textContent = "Connecting…";
  try {
    const answer = await askCare({
      text,
      context: [],
      consent: true,
      language,
      region: "BD",
    });
    target.textContent = answer.reply;
  } catch (error) {
    target.textContent = error.message;
  } finally {
    button.disabled = false;
  }
};
// A drag handle and a tap share the bubble without triggering a tap after movement.
const bubble = $("#ashaBubble"),
  companion = $("#companion");
let drag;
bubble.onpointerdown = (e) => {
  const r = companion.getBoundingClientRect();
  drag = { x: e.clientX, y: e.clientY, left: r.left, top: r.top, moved: false };
  bubble.setPointerCapture(e.pointerId);
};
bubble.onpointermove = (e) => {
  if (!drag) return;
  const dx = e.clientX - drag.x,
    dy = e.clientY - drag.y;
  if (Math.hypot(dx, dy) > 6) drag.moved = true;
  if (!drag.moved) return;
  companion.style.right = "auto";
  companion.style.bottom = "auto";
  companion.style.left =
    Math.max(
      8,
      Math.min(innerWidth - companion.offsetWidth - 8, drag.left + dx),
    ) + "px";
  companion.style.top =
    Math.max(
      8,
      Math.min(innerHeight - companion.offsetHeight - 8, drag.top + dy),
    ) + "px";
};
bubble.onpointerup = () => {
  const moved = drag?.moved;
  drag = null;
  if (!moved) {
    $("#ashaPanel").hidden = !$("#ashaPanel").hidden;
    const r = companion.getBoundingClientRect();
    if (r.top < 8 || r.bottom > innerHeight || r.right > innerWidth) {
      companion.style.left = "auto";
      companion.style.top = "auto";
      companion.style.right = "14px";
      companion.style.bottom = "16px";
    }
  }
};
bubble.onpointercancel = () => {
  drag = null;
};
bubble.onkeydown = (e) => {
  if (e.key === "Enter" || e.key === " ") {
    e.preventDefault();
    $("#ashaPanel").hidden = !$("#ashaPanel").hidden;
  }
};
window.addEventListener("hashchange", () => void renderRoute());
window.addEventListener("pagehide", () => {
  camera.stop();
  store.lock();
  globalThis.speechSynthesis?.cancel();
});
if ("serviceWorker" in navigator)
  navigator.serviceWorker.register("/sw.js").catch(() => {});
void renderRoute();
