import { evaluateSafety, safetyMessage } from "./safety.js";
import { SpeechCapture } from "../speech-capture.js";

export function visitSummary(records) {
  return [
    "ASHA visit preparation",
    "Prepared " + new Date().toISOString(),
    ...records.map(
      (r) =>
        `${r.timestamp} · ${r.module} · ${r.source} · ${r.model_id}@${r.model_version}\n${JSON.stringify(r.value)}\nCorrection: ${r.correction_status}`,
    ),
  ].join("\n\n");
}

export async function mount(host, ctx) {
  host.innerHTML = `<div class="module-heading"><span class="eyebrow">ASHA CARE</span><h2>Your health, in your words</h2><p>Keep a journal and prepare for a visit. Urgent guidance works without a cloud connection.</p></div>
  <div class="two-column"><section class="card"><h3>How are you feeling?</h3><form id="symptomForm">
    <label class="field">Symptoms / লক্ষণ<textarea name="symptoms" rows="4" maxlength="2000" required placeholder="What changed? / কী পরিবর্তন হয়েছে?"></textarea></label>
    <div class="two-column"><label class="field">Started<input name="onset" type="datetime-local"></label><label class="field">How does it feel?<select name="severity"><option value="unsure">Unsure</option><option value="mild">Mild</option><option value="moderate">Moderate</option><option value="severe">Severe</option></select></label></div>
    <fieldset><legend>Any of these now?</legend><label><input type="checkbox" name="redFlag" value="breathlessness"> Breathing difficulty / শ্বাসকষ্ট</label><label><input type="checkbox" name="redFlag" value="fainting"> Faintness / অজ্ঞান লাগা</label><label><input type="checkbox" name="redFlag" value="sweating"> Unusual sweating</label><label><input type="checkbox" name="redFlag" value="radiating"> Pain spreading to arm or jaw</label></fieldset>
    <div class="actions"><button class="primary">Check guidance</button><button type="button" id="saveSymptom" class="secondary">Save journal entry</button></div></form><div id="careGuidance" role="status" aria-live="polite"></div>
    <label class="field">Emergency region<select id="careRegion"><option value="BD">Bangladesh · 999</option><option value="GB">United Kingdom · 999</option><option value="US">United States · 911</option><option value="CA">Canada · 911</option><option value="IN">India · 112</option><option value="EU">EU · 112</option><option value="OTHER">Other · local emergency number</option></select></label>
  </section><section class="card"><h3>Talk with Asha</h3><p class="muted">For nonurgent explanations and visit preparation.</p><label><input id="careCloud" type="checkbox"> Send this message and selected context to cloud AI</label><label><input id="shareContext" type="checkbox"> Include my visible journal and health profile (up to five recent entries)</label><form id="careChat"><label class="field">Your question<textarea id="careQuestion" required maxlength="600" rows="3"></textarea></label><button class="primary">Ask Asha</button></form><div id="careAnswer" role="status" aria-live="polite"></div><button id="readCare" class="secondary" type="button">Read answer aloud</button></section></div>
  <section class="card"><h3>Health context you choose to share</h3><form id="healthForm"><div class="two-column"><label class="field">Conditions you have been told about<input name="conditions" maxlength="400"></label><label class="field">Allergies<input name="allergies" maxlength="400"></label><label class="field">Medicines you take<input name="medications" maxlength="600"></label><label class="field">Blood pressure, from your device<input name="bloodPressure" maxlength="30" placeholder="e.g. 120/80 mmHg"></label><label class="field">Weight (kg)<input name="weight" type="number" min="1" max="400" step="0.1"></label></div><button class="secondary">Save self-reported context</button></form></section>
  <section class="card"><div class="section-heading"><h3>Your journal</h3><button class="secondary" id="exportVisit">Download visit summary</button></div><div id="journalRows"></div></section>`;
  let lastAnswer = "",
    active = true,
    busy = false;
  const q = (s) => host.querySelector(s);
  // Explicit OS speech consent: some browsers send audio to their recognition service.
  const voiceArea = document.createElement("div");
  voiceArea.className = "notice";
  voiceArea.innerHTML = `<label><input type="checkbox" id="careVoiceConsent"> Use browser voice input. Audio may be processed by your browser’s speech service.</label><label class="field">Write into<select id="dictationTarget"><option value="symptoms">Symptom description</option><option value="question">Question for Asha</option></select></label><div class="actions"><button class="secondary" id="startDictation" type="button">Start listening · up to 90s</button><button class="secondary" id="stopDictation" type="button">Stop listening</button></div><p class="small" id="dictationStatus" role="status">Review recognized words before saving or sending.</p>`;
  q("#symptomForm").before(voiceArea);
  let dictationTarget = null;
  const capture = new SpeechCapture({
    Recognition:
      globalThis.SpeechRecognition || globalThis.webkitSpeechRecognition,
    onText(text) {
      if (!active || !dictationTarget) return;
      dictationTarget.value = text.slice(0, dictationTarget.maxLength);
      if (dictationTarget.name === "symptoms") {
        const values = input(),
          decision = evaluateSafety(values.text, values);
        if (decision.level === "emergency")
          showDecision(decision, q("#careGuidance"));
      }
    },
    onState(state) {
      if (active)
        q("#dictationStatus").textContent =
          state.state === "listening"
            ? "Listening. You can pause naturally; review the words before sending."
            : state.state === "paused"
              ? "Listening paused while Asha speaks."
              : state.state === "error"
                ? "Voice input unavailable or not permitted. You can type instead."
                : "Listening stopped. Review the recognized words.";
    },
  });
  const releaseSpeech = ctx.registerSpeechCapture?.(capture);
  q("#startDictation").onclick = () => {
    if (!q("#careVoiceConsent").checked)
      return ctx.notify("Choose browser voice consent before listening.");
    dictationTarget =
      q("#dictationTarget").value === "symptoms"
        ? q("[name=symptoms]")
        : q("#careQuestion");
    capture.start({
      language: ctx.language() === "bn" ? "bn-BD" : "en-US",
      initialText: dictationTarget.value,
    });
    if (globalThis.speechSynthesis?.speaking) capture.pauseForOutput();
  };
  q("#stopDictation").onclick = () => capture.stop();
  q("#careVoiceConsent").onchange = (e) => {
    if (!e.target.checked) capture.stop("consent-revoked");
  };
  const pauseHidden = () => {
    if (document.hidden) capture.stop("background");
  };
  document.addEventListener("visibilitychange", pauseHidden);
  function input() {
    const data = new FormData(q("#symptomForm"));
    return {
      text: String(data.get("symptoms") || ""),
      onset: String(data.get("onset") || ""),
      severity: String(data.get("severity")),
      redFlags: data.getAll("redFlag"),
      region: q("#careRegion").value,
    };
  }
  function showDecision(decision, target) {
    target.replaceChildren();
    const p = document.createElement("p");
    p.className = decision.level === "emergency" ? "urgent" : "notice";
    p.textContent = safetyMessage(decision, ctx.language());
    target.append(p);
    if (decision.level === "emergency" && decision.contact) {
      const a = document.createElement("a");
      a.href = "tel:" + decision.contact;
      a.className = "primary";
      a.textContent = "Call emergency services · " + decision.contact;
      target.append(a);
    }
  }
  q("#symptomForm").onsubmit = (e) => {
    e.preventDefault();
    const v = input();
    showDecision(evaluateSafety(v.text, v), q("#careGuidance"));
  };
  async function renderJournal() {
    const rows = await ctx.store.list("care");
    if (!active) return;
    q("#journalRows").replaceChildren();
    for (const row of rows.slice(0, 40)) {
      const p = document.createElement("p");
      p.textContent = `${new Date(row.timestamp).toLocaleString()} · ${row.source} · ${row.value.text || row.value.type || "Health context"}`;
      const button = document.createElement("button");
      button.className = "secondary";
      button.textContent = "Delete";
      button.onclick = async () => {
        await ctx.store.remove(row.id);
        await renderJournal();
      };
      p.append(" ", button);
      q("#journalRows").append(p);
    }
    if (!rows.length)
      q("#journalRows").textContent = "Your saved journal entries appear here.";
  }
  q("#saveSymptom").onclick = async () => {
    try {
      const v = input();
      if (!v.text.trim()) return ctx.notify("Describe what you noticed first.");
      const decision = evaluateSafety(v.text, v);
      showDecision(decision, q("#careGuidance"));
      await ctx.store.add({
        module: "care",
        value: {
          type: "symptom",
          ...v,
          guidanceLevel: decision.level,
          policy: decision.policyVersion,
        },
        units: "entry",
        source: "user",
        model_id: decision.protocolId,
        model_version: decision.policyVersion,
        correction_status: "confirmed",
        consent_scope: "care",
      });
      await renderJournal();
      ctx.notify("Journal entry saved on this device.");
    } catch (error) {
      ctx.notify(error.message);
    }
  };
  q("#healthForm").onsubmit = async (e) => {
    e.preventDefault();
    try {
      const values = Object.fromEntries(new FormData(e.target));
      await ctx.store.add({
        module: "care",
        value: { type: "self-reported health context", ...values },
        units: "entry",
        source: "user",
        correction_status: "confirmed",
        consent_scope: "care",
      });
      ctx.notify("Self-reported context saved.");
      await renderJournal();
    } catch (error) {
      ctx.notify(error.message);
    }
  };
  q("#careChat").onsubmit = async (e) => {
    e.preventDefault();
    if (busy) return;
    const text = q("#careQuestion").value.trim();
    const decision = evaluateSafety(text, { region: q("#careRegion").value });
    if (!decision.allowLLM) {
      showDecision(decision, q("#careAnswer"));
      lastAnswer = safetyMessage(decision, ctx.language());
      return;
    }
    if (!q("#careCloud").checked) {
      q("#careAnswer").textContent =
        "Allow cloud assistance to send this question, or save it in your journal for a visit.";
      return;
    }
    busy = true;
    const button = e.target.querySelector("button");
    button.disabled = true;
    q("#careAnswer").textContent = "Connecting with Asha…";
    try {
      const context = q("#shareContext").checked
        ? (await ctx.store.list("care")).slice(0, 5)
        : [];
      const result = await ctx.askCare({
        text,
        context,
        region: q("#careRegion").value,
        language: ctx.language(),
        consent: true,
      });
      if (active) {
        lastAnswer = result.reply;
        q("#careAnswer").textContent =
          (result.cloudStatus === "unavailable"
            ? "Cloud assistance is unavailable. Local guidance: "
            : "") + lastAnswer;
      }
    } catch (error) {
      if (active) q("#careAnswer").textContent = error.message;
    } finally {
      busy = false;
      if (active) button.disabled = false;
    }
  };
  q("#readCare").onclick = () => {
    if (lastAnswer) ctx.speak(lastAnswer);
  };
  q("#exportVisit").onclick = async () => {
    const text = visitSummary(await ctx.store.list());
    ctx.download("asha-visit-summary.txt", text, "text/plain");
  };
  await renderJournal();
  return () => {
    active = false;
    capture.stop("navigation");
    releaseSpeech?.();
    document.removeEventListener("visibilitychange", pauseHidden);
  };
}
