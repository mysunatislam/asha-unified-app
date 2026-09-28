const $ = (id) => document.getElementById(id);
const escape = (value) =>
  String(value ?? "").replace(
    /[&<>"']/g,
    (c) =>
      ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[
        c
      ],
  );
const cell = (label, id) =>
  `<div class="metric"><small>${label}</small><strong id="nf-${id}">—</strong></div>`;
const row = (...items) =>
  `<div class="metrics">${items.map(([label, id]) => cell(label, id)).join("")}</div>`;
const chart = (id, label) =>
  `<span class="eyebrow">${label}</span><canvas id="${id}" class="chart" aria-label="${label}"></canvas>`;
const units = [
  ["AU1", "Inner brow raise"],
  ["AU4", "Brow lowering"],
  ["AU6", "Cheek raise"],
  ["AU12", "Smile · zygomatic"],
  ["AU20", "Lip stretch"],
  ["AU25", "Lip opening"],
];
export function faceStudio() {
  return `<div class="face-studio">
    <div class="card face-studio-title"><span class="eyebrow">FACESPEAK · COMPLETE FACIAL ANALYSIS</span><h2>NeuroFace Sense</h2><p>Eyes, eyebrows, cheeks, smile, lips and head movement — live from the shared camera.</p><div class="actions"><button id="nf-calibrate" class="primary">Calibrate patient</button><button id="nf-reference" class="secondary">Relearn relaxed reference</button></div><p id="nf-pipeline" class="small muted">Start the camera, then relax briefly to learn the neutral reference.</p></div>
    <div class="face-module-grid">
      <section class="card"><h3>♥ Facial Signal Consistency</h3><p class="small muted">Tracking proxy, not a score of motor ability.</p>${row(["Eye signal", "eyeScore"], ["Lip signal", "lipScore"], ["Smile balance", "smileScore"], ["Head signal", "headScore"])}<p id="nf-alert" class="observation-status">Start the camera to observe movement.</p></section>
      <section class="card"><h3>👁 Eye Analysis <small>Module 2</small></h3>${row(["Status", "eyeState"], ["Last blink", "blinkDuration"], ["Blinks · last 60s", "blinkRate"])}${row(["EAR L", "earL"], ["EAR R", "earR"], ["L–R Δ", "earDiff"])}${chart("eyeChart", "EYE OPENNESS · LIVE EAR")}${cell("Signal debug", "eyeDebug")}${cell("Gaze", "gaze")}</section>
      <section class="card"><h3>💪 Muscle Activity <small>Module 3</small></h3><div class="face-au-grid">${units.map(([key, label]) => `<div class="face-au"><label for="nf-bar-${key}">${key} · ${label}<b id="nf-value-${key}">—</b></label><progress id="nf-bar-${key}" max="100" value="0"></progress></div>`).join("")}</div><p id="nf-auStatus" class="small muted">Learning the original neutral-relative geometry reference.</p><p class="small muted">AU-inspired movement indicators, not validated clinical muscle measurements. 0% at rest is normal.</p></section>
      <section class="card"><h3>😊 Smile Analysis <small>Module 4</small></h3>${row(["Intensity", "smileIntensity"], ["Symmetry", "symmetry"], ["Status", "smileState"])}${row(["Left activity", "smileLeft"], ["Right activity", "smileRight"])}${chart("smileChart", "SMILE INTENSITY")}<p class="small muted">Neutral-relative symmetry. Symmetric smiling is excluded from the sustained one-sided-lip flag.</p></section>
      <section class="card"><h3>👄 Lip Control <small>Module 5</small></h3>${row(["Gesture", "lipGesture"], ["MAR", "mar"], ["Pucker", "pucker"])}${chart("lipChart", "LIP OPENING")}${cell("Lip deviation", "deviation")}${cell("Sustained one-sided hold", "lipHold")}<progress id="nf-lipProgress" max="60" value="0" aria-label="Sustained one-sided lip hold, seconds"></progress><p id="nf-lipFlag" class="small muted">60 seconds of persistent same-side displacement is required.</p>${row(["Brow / corner pattern", "affectBrow"], ["Squeeze / tension pattern", "affectTension"])}<p class="small muted">Expression patterns are not proof of sadness or pain. A lip flag is not a seizure diagnosis.</p></section>
      <section class="card"><h3>〰 Facial Motion <small>Module 6</small></h3>${row(["Displacement", "displacement"], ["Acceleration", "acceleration"], ["Rhythm", "rhythm"])}${chart("motionChart", "LANDMARK DISPLACEMENT")}${cell("Movement state", "motionState")}<p class="small muted">Large or repeated motion can also be intentional. This does not distinguish involuntary movement from voluntary movement.</p></section>
      <section class="card"><h3>↔ Head Movement <small>Module 7</small></h3>${row(["Yaw", "yaw"], ["Pitch", "pitch"], ["Roll", "roll"])}${cell("Observed pose", "headPose")}${cell("Nod detected", "nod")}${chart("yawChart", "LEFT / RIGHT HEAD TURN")}${chart("pitchChart", "UP / DOWN HEAD MOVEMENT")}<p id="nf-headState" class="small muted">Complete a turn and return to center to count it.</p></section>
      <section class="card"><h3>🗣 FaceSpeak Communication</h3><div id="nf-rules"></div><p id="faceCalibrationStatus" class="small muted"></p><p class="small muted">Calibrated head, smile and deliberate blink responses are available. Three quick practiced blinks ask Asha for help. Wait for her question, then make one separate deliberate blink to confirm. Normal blink counts alone never send a request.</p><button id="nf-calibrateRules" class="secondary">Guided gesture calibration →</button></section>
      <section class="card face-log"><div class="section-heading"><h3>📋 Activity Log</h3><div class="actions"><button id="nf-clearLog" class="text-button">Clear</button><button id="nf-exportLog" class="text-button">Export JSON</button></div></div><div id="nf-log" class="face-event-log"><p class="muted">No observations yet.</p></div></section>
    </div>
  </div>`;
}
const text = (id, value) => {
  const element = $("nf-" + id);
  if (element && element.textContent !== String(value))
    element.textContent = value;
};
const num = (n, decimals = 2) =>
  Number.isFinite(n) ? n.toFixed(decimals) : "—";
const pct = (n) => (Number.isFinite(n) ? Math.round(n * 100) + "%" : "—");
export function paintFaceStudio(s, trained, progress) {
  if (!$("nf-pipeline")) return;
  const a = s.analysis || {},
    f = s.raw || {};
  text(
    "pipeline",
    `${a.valid ? "Face tracked" : "Tracking paused"} · ${Math.round(f.fps || 0)} processed fps · ${s.latency || 0} ms · ${a.reason || "Waiting for camera"}`,
  );
  text("eyeState", a.valid ? a.eye?.state || "Observing" : "Unavailable");
  text(
    "blinkDuration",
    a.eye?.last
      ? (a.eye.last.duration / 1000).toFixed(2) +
          "s" +
          (a.eye.last.deliberate ? " · deliberate" : "")
      : "—",
  );
  text("blinkRate", a.valid ? `${a.eye?.count || 0} / 60s` : "—");
  text("earL", num(f.earLeft));
  text("earR", num(f.earRight));
  text("earDiff", a.valid ? num(Math.abs(f.earLeft - f.earRight), 3) : "—");
  text(
    "eyeDebug",
    a.valid
      ? `${a.eye?.total || 0} observed blinks total · live EAR reference ${num(a.eye?.reference?.left)} / ${num(a.eye?.reference?.right)} · counts after both eyes reopen. ${a.eye?.reason || "Deliberate FaceSpeak commands are checked separately."}`
      : "Waiting for reliable tracking",
  );
  text(
    "gaze",
    a.valid && a.gaze?.available
      ? `${a.gaze.label} (${num(a.gaze.x)}, ${num(a.gaze.y)})`
      : "Unavailable",
  );
  for (const [key] of units) {
    // Absolute model scores have no personal neutral reference and can remain
    // high at rest. Never present them as calibrated muscle activity.
    const value = a.valid && a.au?.ready ? a.au.values[key] : null;
    text(
      "value-" + key,
      value === null || value === undefined ? "—" : value + "%",
    );
    $("nf-bar-" + key).value = value || 0;
  }
  text(
    "auStatus",
    !a.valid
      ? "Landmark geometry unavailable — paused."
      : a.au?.ready
        ? "Fixed neutral-relative geometry active. Raise or lower your brows, smile, or open your lips to see live changes."
        : `Reference needed — relax your brows and keep eyes open briefly · ${a.au?.progress || 0}/45 valid frames. Use Relearn relaxed reference if needed.`,
  );
  text("smileIntensity", pct(a.smile?.intensity));
  text(
    "symmetry",
    a.valid && a.ready ? num(a.smile?.symmetry, 0) + "%" : "Reference needed",
  );
  text("smileState", a.smile?.state || "Unavailable");
  text("smileLeft", pct(a.smile?.left));
  text("smileRight", pct(a.smile?.right));
  text("lipGesture", a.lip?.gesture || "Unavailable");
  text("mar", num(f.mar));
  text("pucker", a.valid ? pct(a.lip?.pucker) : "—");
  text(
    "deviation",
    a.valid
      ? `${a.lip.kind} · ${num(Math.abs(a.lip.deviation) * 100, 1)}% · ${a.lip.active ? a.lip.side : "within threshold"}${a.ready ? "" : " · reference pending"}`
      : "Tracking unavailable",
  );
  text("lipHold", `${num(a.lip?.duration || 0, 1)} / 60 seconds`);
  $("nf-lipProgress").value = Math.min(60, a.lip?.duration || 0);
  const warning = !!a.lip?.latched;
  text(
    "lipFlag",
    warning
      ? "Possible sustained movement abnormality — review camera angle and patient comfort. Caregiver check-in is offered; no seizure diagnosis or automatic call."
      : a.lip?.active
        ? "Timing the same-side displacement. Changing sides or losing tracking resets the hold."
        : "No sustained one-sided-lip flag. A full 60-second hold is required.",
  );
  $("nf-lipFlag").classList.toggle("error", warning);
  text("affectBrow", pct(a.affect?.browCornerPattern));
  text("affectTension", pct(a.affect?.squeezeTensionPattern));
  for (const k of ["yaw", "pitch", "roll"])
    text(k, a.valid ? num(a.head?.[k], 0) + "°" : "—");
  text("headPose", a.head?.label || "Unavailable");
  text(
    "nod",
    a.head?.nodRecent
      ? "Yes ✓"
      : a.valid
        ? "Waiting for a full nod + return"
        : "Unavailable",
  );
  text(
    "headState",
    `${a.head?.state || "—"} · Nod ${a.head?.nodState || "—"} · relative to your neutral pose`,
  );
  text("displacement", num(a.motion?.displacement, 4));
  text("acceleration", num(a.motion?.acceleration, 3));
  text(
    "rhythm",
    Number.isFinite(a.motion?.frequency)
      ? num(a.motion.frequency, 1) + " Hz"
      : "Collecting",
  );
  text("motionState", a.motion?.label || "Unavailable");
  for (const [id, key] of [
    ["eyeScore", "eye"],
    ["lipScore", "lip"],
    ["smileScore", "smile"],
    ["headScore", "head"],
  ])
    text(id, a.scores ? num(a.scores[key], 0) + "%" : "—");
  text(
    "alert",
    warning
      ? "Sustained lip displacement flagged — check-in offered."
      : a.valid
        ? "Observed signals only · not a clinical ability assessment."
        : "Waiting for valid facial tracking.",
  );
  const rules = [
    ["Prompted nod", "Water or yes", "NOD_COMPLETED"],
    ["Prompted left turn + return", "Food", "LEFT_TURN_COMPLETED"],
    ["Prompted right turn + return", "Toilet", "RIGHT_TURN_COMPLETED"],
    ["3 quick deliberate blinks", "Ask Asha · then confirm", "RAPID_BLINK_REQUEST"],
    ["Separate deliberate blink", "Confirm after Asha's question", "BLINK_CONFIRM"],
  ]
    .map(
      ([label, phrase, event]) =>
        `<div class="rule"><span>${label}<small>${event ? trained?.enabled?.includes(event) ? "Calibrated" : "Calibration needed" : "Always safe"}</small></span><strong>${phrase}</strong></div>`,
    )
    .join("");
  if ($("nf-rules").dataset.content !== rules) {
    $("nf-rules").dataset.content = rules;
    $("nf-rules").innerHTML = rules;
  }
  $("faceCalibrationStatus").textContent = trained
    ? "Personal gesture calibration saved " +
      new Date(trained.savedAt).toLocaleDateString()
    : "Open guided calibration to enable comfortable movements. Live observations work without gesture enrollment.";
  const log = a.log || [];
  const signature = log.map((x) => x.t + x.label).join("|");
  if ($("nf-log").dataset.signature !== signature) {
    $("nf-log").dataset.signature = signature;
    $("nf-log").innerHTML = log.length
      ? log
          .map(
            (x) =>
              `<p><time>${Math.floor(x.t / 60000)}:${String(Math.floor(x.t / 1000) % 60).padStart(2, "0")}</time> ${escape(x.label)}</p>`,
          )
          .join("")
      : '<p class="muted">No observations yet.</p>';
  }
}
