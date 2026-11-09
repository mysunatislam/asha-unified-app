import {
  CHECK_TARGETS,
  DwellSelector,
  GAZE_MODEL_VERSION,
  calibrationTargets,
  extractGazeFeatures,
  fitGazeModel,
  predictGaze,
  validateGazeModel,
} from "./gaze-engine.js";

const PHRASES = {
  en: [
    "I need water",
    "I need the toilet",
    "Please help me",
    "I am comfortable",
    "Yes",
    "No",
    "Thank you",
    "Please wait",
  ],
  bn: [
    "আমার পানি দরকার",
    "আমি টয়লেটে যেতে চাই",
    "আমাকে সাহায্য করুন",
    "আমি আরামে আছি",
    "হ্যাঁ",
    "না",
    "ধন্যবাদ",
    "একটু অপেক্ষা করুন",
  ],
};
const WORDS = {
  en: [
    "water",
    "toilet",
    "help",
    "food",
    "hello",
    "please",
    "thank",
    "yes",
    "no",
    "comfortable",
  ],
  bn: ["পানি", "খাবার", "সাহায্য", "হ্যাঁ", "না", "ধন্যবাদ", "আরাম", "টয়লেট"],
};

function button(text, action, parent, id) {
  const node = document.createElement("button");
  node.type = "button";
  node.className = "secondary";
  node.textContent = text;
  node.addEventListener("click", action);
  if (id) node.dataset.gazeTarget = id;
  parent.append(node);
  return node;
}

/** Interactive AAC remains available when gaze calibration is unavailable. */
export function mount(host, ctx) {
  host.innerHTML = `
    <section class="card">
      <h2>EyeSpeak · চোখের ভাষা</h2>
      <p>Choose a phrase or build your words. Touch, a keyboard switch, and calibrated gaze can select tiles.</p>
      <div class="actions">
        <label class="field">Language / ভাষা<select data-language><option value="en">English</option><option value="bn">বাংলা</option></select></label>
        <label class="field">Selection time<select data-dwell><option value="800">0.8 seconds</option><option value="1100" selected>1.1 seconds</option><option value="1500">1.5 seconds</option></select></label>
      </div>
    </section>
    <section class="card" data-aac>
      <div class="actions" data-modes></div>
      <label class="field">Your message / আপনার কথা<textarea data-message rows="2" maxlength="1000" aria-label="Your message"></textarea></label>
      <div class="actions" data-edit></div>
      <div class="actions" data-suggestions aria-label="Word suggestions"></div>
      <div data-tiles aria-label="Communication tiles"></div>
      <p data-selection class="muted" role="status" aria-live="polite">Touch a tile to begin.</p>
      <div class="actions" data-scan></div>
    </section>
    <section class="card">
      <h3>Set up your gaze</h3>
      <p>Keep your head comfortable and look at each target. A caregiver can help press Capture. A separate target check is required before gaze selection starts.</p>
      <div class="actions">
        <button type="button" class="secondary" data-camera>Start eye camera</button>
        <label class="field">Calibration points<select data-count><option value="5">5 points</option><option value="9" selected>9 points</option><option value="16">16 points</option></select></label>
        <button type="button" class="primary" data-calibrate>Calibrate gaze</button>
        <button type="button" class="secondary" data-check disabled>Check gaze targets</button>
        <button type="button" class="primary" data-enable disabled>Enable gaze selection</button>
        <button type="button" class="secondary" data-pause>Pause camera</button>
      </div>
      <p data-status class="notice" role="status" aria-live="polite">Gaze is off. Touch and switch input work now.</p>
      <label><input type="checkbox" data-remember> Remember this calibration on this device</label>
      <div class="actions" style="margin-top:12px">
        <button type="button" class="secondary" data-save disabled>Save calibration</button>
        <button type="button" class="secondary" data-restore hidden>Restore saved calibration</button>
        <button type="button" class="secondary" data-reset>Reset calibration</button>
      </div>
      <p class="muted">Experimental screen-gaze mapping. A target check measures fit for this setup. Recheck after moving the camera, changing screen orientation, or noticing drift.</p>
    </section>`;
  const find = (selector) => host.querySelector(selector);
  const output = find("[data-message]");
  const tiles = find("[data-tiles]");
  const status = find("[data-status]");
  const selection = find("[data-selection]");
  const aac = find("[data-aac]");
  const dwell = new DwellSelector();
  let language = ctx.language?.() === "bn" ? "bn" : "en";
  let mode = "phrases",
    group = null,
    model = null,
    savedRecord = null;
  let phrasePage = 0,
    groupPage = 0;
  let cameraRunning = false,
    gazeEnabled = false,
    disposed = false;
  let cameraStart = null,
    calibrationStarting = false;
  let previousOverflow = null;
  let calibration = null,
    overlay = null,
    capture = null,
    captureTimer = null,
    settleTimer = null;
  let lastGaze = null,
    scanTimer = null,
    scanIndex = -1,
    lastAnnouncement = 0;
  const undo = [];
  find("[data-language]").value = language;

  function sayStatus(text) {
    if (!disposed) status.textContent = text;
  }
  function edit(text) {
    undo.push(output.value);
    if (undo.length > 50) undo.shift();
    output.value = text.slice(0, 1000);
    renderSuggestions();
  }
  function append(text) {
    edit(output.value + text);
  }
  function speakMessage() {
    const text = output.value.trim();
    if (text) ctx.speak(text);
  }
  function renderSuggestions() {
    const area = find("[data-suggestions]");
    area.replaceChildren();
    const part = output.value.match(/([^\s]+)$/u)?.[1]?.toLowerCase();
    if (!part) return;
    for (const word of WORDS[language]
      .filter((word) => word.startsWith(part) && word !== part)
      .slice(0, 3)) {
      button(
        word,
        () => edit(output.value.slice(0, -part.length) + word + " "),
        area,
        "word-" + word,
      );
    }
  }
  function selectPhrase(phrase) {
    edit(phrase);
    ctx.speak(phrase);
  }
  function renderTiles() {
    scanIndex = -1;
    tiles.replaceChildren();
    tiles.style.cssText = `display:grid;grid-template-columns:repeat(${mode === "keyboard" ? 4 : 2},minmax(0,1fr));gap:12px;margin-top:16px`;
    const goHome = () => {
      mode = "home";
      group = null;
      renderTiles();
    };
    if (mode === "home") {
      button(
        "Phrases / বাক্য",
        () => {
          mode = "phrases";
          renderTiles();
        },
        tiles,
        "menu-phrases",
      );
      button(
        "Letters / অক্ষর",
        () => {
          mode = "groups";
          group = null;
          renderTiles();
        },
        tiles,
        "menu-letters",
      );
      button(
        "Edit message",
        () => {
          mode = "edit";
          renderTiles();
        },
        tiles,
        "menu-edit",
      );
      button("Speak / বলুন", speakMessage, tiles, "menu-speak");
      button(
        "Pause gaze",
        () => {
          gazeEnabled = false;
          dwell.reset();
          refreshButtons();
          sayStatus("Gaze selection paused.");
        },
        tiles,
        "pause-gaze",
      );
      button(
        "Exit focus view",
        () => {
          if (aac.dataset.focused === "true") focusMode();
        },
        tiles,
        "exit-focus",
      );
    } else if (mode === "edit") {
      button("Space / ফাঁক", () => append(" "), tiles, "edit-space");
      button(
        "Delete / মুছুন",
        () => edit([...output.value].slice(0, -1).join("")),
        tiles,
        "edit-delete",
      );
      button(
        "Undo / ফিরিয়ে আনুন",
        () => {
          if (undo.length) output.value = undo.pop();
          renderSuggestions();
        },
        tiles,
        "edit-undo",
      );
      button("Clear / সব মুছুন", () => edit(""), tiles, "edit-clear");
      button("Home / শুরু", goHome, tiles, "home");
      button("Speak / বলুন", speakMessage, tiles, "edit-speak");
    } else if (mode === "phrases") {
      PHRASES[language]
        .slice(phrasePage * 4, phrasePage * 4 + 4)
        .forEach((phrase, index) =>
          button(
            phrase,
            () => selectPhrase(phrase),
            tiles,
            "phrase-" + (phrasePage * 4 + index),
          ),
        );
      button(
        phrasePage ? "Previous phrases" : "More phrases",
        () => {
          phrasePage = phrasePage ? 0 : 1;
          renderTiles();
        },
        tiles,
        "phrase-page",
      );
      button("Home / শুরু", goHome, tiles, "home");
    } else if (mode === "groups" && group === null) {
      const groups =
        language === "en"
          ? ["ABCDEFG", "HIJKLMN", "OPQRST", "UVWXYZ"]
          : [
              "অআইঈউঊঋ",
              "এঐওঔ",
              "কখগঘঙচছজঝঞ",
              "টঠডঢণতথদধন",
              "পফবভমযরল",
              "শষসহড়ঢ়য়",
              "ািীুূৃেৈোৌংঃঁ",
            ];
      if (groupPage * 4 >= groups.length) groupPage = 0;
      groups.slice(groupPage * 4, groupPage * 4 + 4).forEach((letters, index) =>
        button(
          letters.split("").join(" "),
          () => {
            group = letters;
            renderTiles();
          },
          tiles,
          "group-" + (groupPage * 4 + index),
        ),
      );
      if (groups.length > 4)
        button(
          groupPage ? "Previous letters" : "More letters",
          () => {
            groupPage = groupPage ? 0 : 1;
            renderTiles();
          },
          tiles,
          "group-page",
        );
      button("Home / শুরু", goHome, tiles, "home");
    } else if (mode === "groups" && [...group].length > 4) {
      const letters = [...group];
      for (let index = 0; index < letters.length; index += 4) {
        const part = letters.slice(index, index + 4).join("");
        button(
          [...part].join(" "),
          () => {
            group = part;
            renderTiles();
          },
          tiles,
          "subgroup-" + index,
        );
      }
      button(
        "Back to letter groups",
        () => {
          group = null;
          renderTiles();
        },
        tiles,
        "back",
      );
      button("Home / শুরু", goHome, tiles, "home");
    } else {
      const letters =
        mode === "keyboard"
          ? language === "en"
            ? "ABCDEFGHIJKLMNOPQRSTUVWXYZ"
            : "অআইঈউঊএঐওঔকখগঘঙচছজঝঞটঠডঢণতথদধনপফবভমযরলশষসহািীুূেো"
          : group;
      [...letters].forEach((letter) =>
        button(letter, () => append(letter), tiles, "letter-" + letter),
      );
      if (mode === "groups") {
        button(
          language === "bn" ? "ফিরে যান" : "Back to letter groups",
          () => {
            group = null;
            renderTiles();
          },
          tiles,
          "back",
        );
        button("Home / শুরু", goHome, tiles, "home");
      }
    }
    for (const tile of tiles.children) {
      tile.style.cssText = `min-height:${mode === "keyboard" ? "58px" : "clamp(108px,20vh,220px)"};font-size:${mode === "keyboard" ? "1.15rem" : "1.2rem"};white-space:normal;overflow-wrap:anywhere`;
    }
  }
  function focusMode() {
    const focused = aac.dataset.focused === "true";
    aac.dataset.focused = String(!focused);
    aac.style.cssText = focused
      ? ""
      : "position:fixed;inset:8px;z-index:80;overflow:auto;background:var(--card,var(--surface,#fff));color:var(--ink,#123);padding:14px;margin:0";
    for (const selector of [
      "[data-modes]",
      "[data-edit]",
      "[data-suggestions]",
      "[data-scan]",
    ]) {
      find(selector).hidden = !focused;
      find(selector).style.display = focused ? "" : "none";
    }
    focusClose.hidden = focused;
    focusClose.style.display = focused ? "none" : "";
    if (focused) {
      aac.removeAttribute("role");
      aac.removeAttribute("aria-modal");
      document.body.style.overflow = previousOverflow ?? "";
      previousOverflow = null;
    } else {
      aac.setAttribute("role", "dialog");
      aac.setAttribute("aria-modal", "true");
      aac.setAttribute("aria-label", "EyeSpeak focused communication");
      previousOverflow = document.body.style.overflow;
      document.body.style.overflow = "hidden";
    }
    dwell.reset();
  }
  const focusClose = button("Exit focus view", focusMode, aac);
  focusClose.hidden = true;
  focusClose.style.cssText =
    "position:absolute;right:10px;top:8px;z-index:1;min-height:40px";
  for (const [label, selectedMode] of [
    ["Phrases / বাক্য", "phrases"],
    ["Large letter groups", "groups"],
    ["A–Z keyboard", "keyboard"],
  ])
    button(
      label,
      () => {
        mode = selectedMode;
        group = null;
        renderTiles();
        dwell.reset();
      },
      find("[data-modes]"),
    );
  button("Focus view", focusMode, find("[data-modes]"));
  button("Speak / বলুন", speakMessage, find("[data-edit]"), "speak");
  button("Space / ফাঁক", () => append(" "), find("[data-edit]"), "space");
  button(
    "Delete / মুছুন",
    () => edit([...output.value].slice(0, -1).join("")),
    find("[data-edit]"),
    "delete",
  );
  button(
    "Undo / ফিরিয়ে আনুন",
    () => {
      if (undo.length) output.value = undo.pop();
      renderSuggestions();
    },
    find("[data-edit]"),
    "undo",
  );
  button("Clear / সব মুছুন", () => edit(""), find("[data-edit]"), "clear");
  const scanStart = button(
    "Start switch scanning",
    startScan,
    find("[data-scan]"),
  );
  button(
    "Select highlighted tile (Space)",
    activateScanned,
    find("[data-scan]"),
  );
  button("Stop scanning", stopScan, find("[data-scan]"));
  output.addEventListener("input", renderSuggestions);
  renderTiles();

  function scanTargets() {
    return [...aac.querySelectorAll("[data-gaze-target]")].filter(
      (node) => !node.disabled && node.getClientRects().length,
    );
  }
  function clearHighlights() {
    for (const node of host.querySelectorAll("[data-gaze-target]")) {
      node.style.outline = "";
      node.style.outlineOffset = "";
    }
  }
  function startScan() {
    gazeEnabled = false;
    find("[data-enable]").textContent = "Enable gaze selection";
    stopScan();
    scanIndex = -1;
    const advance = () => {
      const nodes = scanTargets();
      if (!nodes.length) return;
      clearHighlights();
      scanIndex = (scanIndex + 1) % nodes.length;
      nodes[scanIndex].style.outline = "4px solid #7c3aed";
      nodes[scanIndex].style.outlineOffset = "2px";
      selection.textContent = `Switch scan: ${nodes[scanIndex].textContent}. Press Space or Select.`;
    };
    advance();
    scanTimer = setInterval(advance, 1500);
    scanStart.setAttribute("aria-pressed", "true");
  }
  function stopScan() {
    clearInterval(scanTimer);
    scanTimer = null;
    scanStart.setAttribute("aria-pressed", "false");
    clearHighlights();
  }
  function activateScanned() {
    const node = scanTargets()[scanIndex];
    if (scanTimer && node) node.click();
  }
  function keydown(event) {
    if (event.key === "Escape") {
      stopScan();
      stopCalibration();
      if (aac.dataset.focused === "true") focusMode();
    }
    if (
      scanTimer &&
      event.code === "Space" &&
      !/INPUT|TEXTAREA|SELECT/.test(event.target.tagName)
    ) {
      event.preventDefault();
      activateScanned();
    }
  }
  document.addEventListener("keydown", keydown);

  function refreshButtons() {
    find("[data-check]").disabled = !model;
    find("[data-enable]").disabled = !model?.validation?.passed;
    find("[data-save]").disabled = !model?.validation?.passed;
    find("[data-enable]").textContent = gazeEnabled
      ? "Pause gaze selection"
      : "Enable gaze selection";
  }
  async function ensureCamera() {
    if (cameraRunning) return;
    if (!cameraStart) {
      sayStatus("Starting eye camera…");
      cameraStart = ctx.camera
        .start("face", frame)
        .then(() => {
          if (disposed) return ctx.camera.stop();
          cameraRunning = true;
        })
        .finally(() => {
          cameraStart = null;
        });
    }
    return cameraStart;
  }
  function frame(data) {
    if (disposed) return;
    const features = extractGazeFeatures(
      data.landmarks,
      data.width,
      data.height,
    );
    if (capture?.active) collect(features, data.timestamp);
    if (calibration || !gazeEnabled) return;
    if (!features.valid) {
      dwell.update(null, data.timestamp, false);
      clearHighlights();
      selection.textContent = features.reason;
      return;
    }
    const point = predictGaze(model, features.values);
    if (!point.valid) {
      dwell.update(null, data.timestamp, false);
      clearHighlights();
      selection.textContent = point.reason;
      return;
    }
    const weight = 0.35;
    lastGaze = lastGaze
      ? {
          x: lastGaze.x * (1 - weight) + point.x * weight,
          y: lastGaze.y * (1 - weight) + point.y * weight,
        }
      : { x: point.x, y: point.y };
    const x = lastGaze.x * window.innerWidth,
      y = lastGaze.y * window.innerHeight;
    const marginX = (point.error || 0.02) * window.innerWidth;
    const marginY = (point.error || 0.02) * window.innerHeight;
    const target = [...aac.querySelectorAll("[data-gaze-target]")].find(
      (node) => {
        const r = node.getBoundingClientRect();
        return (
          !node.disabled &&
          r.width > 0 &&
          r.height > 0 &&
          x - marginX >= r.left &&
          x + marginX <= r.right &&
          y - marginY >= r.top &&
          y + marginY <= r.bottom
        );
      },
    );
    const selected = dwell.update(
      target?.dataset.gazeTarget ?? null,
      data.timestamp,
      true,
    );
    clearHighlights();
    if (target) {
      target.style.outline = "4px solid #0f9f87";
      target.style.outlineOffset = "2px";
    }
    if (data.timestamp - lastAnnouncement > 500) {
      selection.textContent = target
        ? `${target.textContent} · ${Math.round(dwell.progress * 100)}%`
        : "Look near the center of a large tile. Larger phrase tiles are easier to select.";
      lastAnnouncement = data.timestamp;
    }
    if (selected && target) {
      target.click();
      selection.textContent = `Selected ${target.textContent}. Look away before selecting it again.`;
    }
  }

  function stopCalibration() {
    clearTimeout(captureTimer);
    clearTimeout(settleTimer);
    capture = null;
    calibration = null;
    overlay?.remove();
    overlay = null;
  }
  function presentTarget() {
    const run = calibration;
    if (!run) return;
    overlay.replaceChildren();
    const [x, y] = run.targets[run.index];
    const title = document.createElement("p");
    title.textContent = `${run.check ? "Target check" : "Calibration"} ${run.index + 1} / ${run.targets.length}. Look at the target, then capture.`;
    title.style.cssText =
      "position:absolute;top:5px;left:10px;right:10px;text-align:center;background:var(--card,#fff);padding:8px;pointer-events:none";
    overlay.append(title);
    const point = button("Capture", () => beginCapture(x, y, point), overlay);
    point.style.cssText = `position:absolute;left:${x * 100}%;top:${y * 100}%;transform:translate(-50%,-50%);min-width:72px;min-height:72px;border:4px solid #2563eb;border-radius:50%;background:#fff;color:#123;font-size:15px`;
    const cancel = button(
      "Cancel / বাতিল",
      () => {
        stopCalibration();
        sayStatus("Calibration stopped. Touch and switch input are available.");
      },
      overlay,
    );
    cancel.style.cssText =
      "position:absolute;bottom:8px;left:8px;min-height:44px;background:#fff;color:#123;border:1px solid #aaa";
    point.focus({ preventScroll: true });
  }
  function beginCapture(x, y, node) {
    if (capture) return;
    node.disabled = true;
    node.textContent = "Look here";
    capture = { x, y, active: false, samples: [], lastTime: null, node };
    settleTimer = setTimeout(() => {
      if (capture) capture.active = true;
    }, 700);
    captureTimer = setTimeout(() => {
      if (!capture) return;
      capture.node.disabled = false;
      capture.node.textContent = "Retry";
      capture = null;
      sayStatus(
        "Not enough continuous eye observations. Keep both eyes visible in steady light, then retry.",
      );
    }, 4200);
  }
  function collect(features, timestamp) {
    const current = capture;
    if (!current || !Number.isFinite(timestamp)) return;
    if (!features.valid) {
      current.samples = [];
      current.lastTime = null;
      return;
    }
    if (current.lastTime !== null && timestamp <= current.lastTime) return;
    if (current.lastTime !== null && timestamp - current.lastTime > 350)
      current.samples = [];
    current.lastTime = timestamp;
    current.samples.push({
      features: [...features.values],
      x: current.x,
      y: current.y,
      timestamp,
    });
    const span = timestamp - current.samples[0].timestamp;
    current.node.textContent = `${Math.min(100, Math.round((span / 900) * 100))}%`;
    if (current.samples.length < 8 || span < 900) return;
    clearTimeout(captureTimer);
    clearTimeout(settleTimer);
    calibration.samples.push(...current.samples);
    capture = null;
    calibration.index++;
    if (calibration.index < calibration.targets.length) return presentTarget();
    const run = calibration;
    stopCalibration();
    try {
      if (run.check) {
        const validation = validateGazeModel(model, run.samples);
        model = { ...model, validation };
        sayStatus(
          validation.passed
            ? `Target check passed for this setup. Average error ${Math.round(validation.meanError * 100)}% of the screen coordinates. You can enable gaze selection.`
            : `Target check needs improvement (average error ${Math.round(validation.meanError * 100)}%). Recalibrate in steady light or continue with touch/switch input.`,
        );
      } else {
        model = {
          ...fitGazeModel(run.samples),
          viewport: { width: window.innerWidth, height: window.innerHeight },
        };
        sayStatus(
          "Calibration captured. Check three new targets before enabling gaze selection.",
        );
      }
    } catch (error) {
      if (!run.check) model = null;
      sayStatus(error.message);
    }
    refreshButtons();
  }
  async function beginCalibration(check = false) {
    if (calibrationStarting) return;
    calibrationStarting = true;
    gazeEnabled = false;
    dwell.reset();
    stopScan();
    stopCalibration();
    try {
      await ensureCamera();
      if (disposed) return;
      if (check && !model)
        throw new Error("Capture calibration before the target check.");
      calibration = {
        check,
        targets: check
          ? CHECK_TARGETS
          : calibrationTargets(Number(find("[data-count]").value)),
        index: 0,
        samples: [],
      };
      overlay = document.createElement("div");
      overlay.setAttribute("role", "dialog");
      overlay.setAttribute("aria-modal", "true");
      overlay.setAttribute(
        "aria-label",
        check ? "Gaze target check" : "Gaze calibration",
      );
      overlay.style.cssText =
        "position:fixed;inset:0;z-index:10000;background:var(--canvas,#eef4fc);color:var(--ink,#13253f);overflow:hidden";
      document.body.append(overlay);
      presentTarget();
    } catch (error) {
      sayStatus(
        error.message ||
          "The eye camera could not start. Touch and switch input are available.",
      );
    } finally {
      calibrationStarting = false;
    }
    refreshButtons();
  }
  function pauseCamera() {
    gazeEnabled = false;
    cameraRunning = false;
    lastGaze = null;
    dwell.reset();
    stopCalibration();
    ctx.camera.stop();
    clearHighlights();
    sayStatus("Eye camera paused. Touch and switch input are available.");
    refreshButtons();
  }
  function viewportChanged() {
    if (!model) return;
    if (
      Math.abs(model.viewport.width - window.innerWidth) < 32 &&
      Math.abs(model.viewport.height - window.innerHeight) < 100
    )
      return;
    gazeEnabled = false;
    model = { ...model, validation: null };
    dwell.reset();
    stopCalibration();
    sayStatus(
      "Screen size changed. Check gaze targets again before enabling gaze.",
    );
    refreshButtons();
  }
  function visibilityChanged() {
    if (document.hidden) {
      stopScan();
      pauseCamera();
    }
  }
  find("[data-language]").addEventListener("change", (event) => {
    language = event.target.value;
    group = null;
    renderTiles();
    renderSuggestions();
    dwell.reset();
  });
  find("[data-dwell]").addEventListener("change", (event) => {
    dwell.dwellMs = Number(event.target.value);
    dwell.reset();
  });
  find("[data-camera]").addEventListener("click", () => {
    ensureCamera()
      .then(() =>
        sayStatus(
          "Eye camera is ready. Calibrate gaze before enabling selection.",
        ),
      )
      .catch((error) => sayStatus(error.message));
  });
  find("[data-calibrate]").addEventListener(
    "click",
    () => void beginCalibration(false),
  );
  find("[data-check]").addEventListener(
    "click",
    () => void beginCalibration(true),
  );
  find("[data-pause]").addEventListener("click", pauseCamera);
  find("[data-enable]").addEventListener("click", async () => {
    if (gazeEnabled) {
      gazeEnabled = false;
    } else {
      if (!model?.validation?.passed) return;
      try {
        await ensureCamera();
      } catch (error) {
        return sayStatus(error.message);
      }
      gazeEnabled = true;
      stopScan();
      if (mode === "keyboard") {
        mode = "groups";
        group = null;
        renderTiles();
      }
      if (aac.dataset.focused !== "true") focusMode();
    }
    lastGaze = null;
    dwell.reset();
    sayStatus(
      gazeEnabled
        ? "Gaze selection is on. Look at the center of a large tile and hold. Look away to reselect the same tile."
        : "Gaze selection paused.",
    );
    refreshButtons();
  });
  find("[data-reset]").addEventListener("click", async () => {
    pauseCamera();
    model = null;
    if (savedRecord) {
      try {
        await ctx.store.remove(savedRecord.id);
      } catch (error) {
        ctx.notify(error.message);
      }
    }
    savedRecord = null;
    find("[data-restore]").hidden = true;
    refreshButtons();
    sayStatus("Calibration cleared. Capture a fresh calibration when ready.");
  });
  find("[data-save]").addEventListener("click", async () => {
    if (!find("[data-remember]").checked)
      return sayStatus("Choose Remember this calibration before saving it.");
    if (!model?.validation?.passed) return;
    try {
      savedRecord = await ctx.store.add({
        module: "eyespeak",
        value: { kind: "calibration", model },
        units: "calibration",
        source: "camera_estimate",
        model_id: "mediapipe-face-personal-ridge",
        model_version: GAZE_MODEL_VERSION,
        confidence: null,
        correction_status: "confirmed",
        consent_scope: "eyespeak",
      });
      sayStatus(
        "Calibration saved on this device. Check targets again when restoring it.",
      );
    } catch (error) {
      sayStatus(error.message);
    }
  });
  find("[data-restore]").addEventListener("click", () => {
    const candidate = savedRecord?.value?.model;
    if (!candidate) return;
    if (
      !Number.isFinite(candidate.viewport?.width) ||
      !Number.isFinite(candidate.viewport?.height) ||
      Math.abs(candidate.viewport.width - window.innerWidth) > 40 ||
      Math.abs(candidate.viewport.height - window.innerHeight) > 100
    )
      return sayStatus(
        "The saved screen size differs. Capture a new calibration for this screen.",
      );
    model = { ...candidate, validation: null };
    gazeEnabled = false;
    refreshButtons();
    sayStatus(
      "Calibration restored. Run the target check before enabling gaze.",
    );
  });
  void ctx.store
    .list("eyespeak")
    .then((records) => {
      if (disposed) return;
      savedRecord =
        records.find(
          (record) =>
            record.value?.kind === "calibration" &&
            record.value.model?.version === GAZE_MODEL_VERSION,
        ) || null;
      find("[data-restore]").hidden = !savedRecord;
    })
    .catch(() => {});
  window.addEventListener("resize", viewportChanged);
  document.addEventListener("visibilitychange", visibilityChanged);

  return () => {
    disposed = true;
    if (previousOverflow !== null)
      document.body.style.overflow = previousOverflow;
    stopScan();
    stopCalibration();
    dwell.reset();
    ctx.camera.stop();
    document.removeEventListener("keydown", keydown);
    window.removeEventListener("resize", viewportChanged);
    document.removeEventListener("visibilitychange", visibilityChanged);
  };
}
