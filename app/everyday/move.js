import {
  EXERCISES,
  MOVE_MODEL,
  MoveSession,
  movementConfig,
  resolvePlan,
} from "./move-engine.js";

const PHASES = {
  find_start: "Find the comfortable starting position",
  reach_target: "Move toward your selected target",
  return_start: "Return to the starting position",
};
const PHASES_BN = {
  find_start: "স্বচ্ছন্দ শুরুর অবস্থানে আসুন",
  reach_target: "নির্বাচিত লক্ষ্যের দিকে নড়ুন",
  return_start: "শুরুর অবস্থানে ফিরে আসুন",
};

function el(tag, text = "", className = "") {
  const node = document.createElement(tag);
  node.textContent = text;
  node.className = className;
  return node;
}

function field(label, control) {
  const wrapper = el("label", "", "field");
  control.setAttribute("aria-label", label);
  wrapper.append(el("span", label), control);
  return wrapper;
}

function input(type, value, attributes = {}) {
  const node = document.createElement("input");
  node.type = type;
  node.value = String(value);
  for (const [name, attribute] of Object.entries(attributes))
    node.setAttribute(name, String(attribute));
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

function download(value, filename, type = "application/json") {
  const url = URL.createObjectURL(new Blob([value], { type }));
  const link = document.createElement("a");
  link.href = url;
  link.download = filename;
  link.click();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

/** Real pose-based practice. The shared camera owns model loading and tracks. */
export function mount(host, context) {
  const language =
    typeof context.language === "function"
      ? context.language()
      : context.language;
  const bn = language === "bn" || language === "bn-BD";
  const text = (english, bangla) => (bn ? bangla : english);
  let alive = true;
  let running = false;
  let starting = false;
  let runVersion = 0;
  let session = null;
  let savedId = null;
  let history = [];
  let activePlan = null;
  let lastPaint = 0;
  let lastSave = null;

  const panel = el("section", "", "card move-controls");
  panel.append(el("h2", text("ASHA Move", "আশা মুভ")));
  panel.append(
    el(
      "p",
      text(
        "Count a comfortable movement you choose. Rehabilitation uses the limits in your clinician’s plan.",
        "আপনার নির্বাচিত স্বচ্ছন্দ নড়াচড়া গণনা করুন। পুনর্বাসনের জন্য চিকিৎসকের পরিকল্পনার সীমা ব্যবহার করুন।",
      ),
      "muted",
    ),
  );
  const controls = el("div", "", "module-form-grid");
  const exercise = select(
    Object.entries(EXERCISES).map(([key, value]) => [
      key,
      bn ? value.labelBn : value.label,
    ]),
  );
  exercise.id = "moveExercise";
  const side = select([
    ["left", text("Left", "বাম")],
    ["right", text("Right", "ডান")],
  ]);
  side.id = "moveSide";
  const mode = select([
    ["practice", text("Personal movement practice", "নিজের নড়াচড়ার অনুশীলন")],
    ["rehab", text("Clinician plan", "চিকিৎসকের পরিকল্পনা")],
  ]);
  mode.id = "moveMode";
  const goal = input("number", 5, { min: 1, max: 100, step: 1 });
  goal.id = "moveGoal";
  const hold = input("number", 0.25, { min: 0, max: 10, step: 0.25 });
  hold.id = "moveHold";
  const target = input("number", EXERCISES.knee_extension.target, {
    min: 0,
    max: 180,
    step: 1,
  });
  target.id = "moveTarget";
  controls.append(
    field(text("Movement", "নড়াচড়া"), exercise),
    field(text("Working side", "যে পাশ নাড়াবেন"), side),
    field(text("Use", "ব্যবহার"), mode),
    field(
      text("Your repetitions per set", "প্রতি সেটে আপনার পুনরাবৃত্তি"),
      goal,
    ),
    field(text("Target hold · seconds", "লক্ষ্যে ধরে রাখা · সেকেন্ড"), hold),
    field(
      text("Camera-plane target · degrees", "ক্যামেরার সমতলে লক্ষ্য · ডিগ্রি"),
      target,
    ),
  );
  const guide = el("p", "", "notice");
  const planNotice = el("p", "", "notice");
  const planSelect = select([
    ["", text("Use personal practice", "নিজের অনুশীলন ব্যবহার করুন")],
  ]);
  const planField = field(
    text("Saved clinician plan", "সংরক্ষিত চিকিৎসকের পরিকল্পনা"),
    planSelect,
  );
  planField.hidden = true;
  let localPlans = [];
  const actions = el("div", "", "actions");
  const start = el(
    "button",
    text("Start camera and practice", "ক্যামেরা ও অনুশীলন শুরু করুন"),
    "primary",
  );
  const pause = el("button", text("Pause", "বিরতি"), "secondary");
  const finish = el(
    "button",
    text("Finish and save", "শেষ করে সংরক্ষণ করুন"),
    "secondary",
  );
  start.id = "moveStart";
  pause.id = "movePause";
  finish.id = "moveFinish";
  pause.disabled = true;
  finish.disabled = true;
  actions.append(start, pause, finish);
  const status = el(
    "p",
    text(
      "Camera off. Read the placement guide, then start when ready.",
      "ক্যামেরা বন্ধ। অবস্থানের নির্দেশনা পড়ে প্রস্তুত হলে শুরু করুন।",
    ),
    "notice",
  );
  status.id = "moveStatus";
  status.setAttribute("role", "status");
  status.setAttribute("aria-live", "polite");
  const metrics = el("div", "", "stats-grid");
  const metric = (label, id) => {
    const card = el("div", "", "card");
    const value = el("strong", "—");
    value.id = id;
    card.append(el("span", label, "muted"), value);
    metrics.append(card);
    return value;
  };
  const angleValue = metric(
    text("Camera-plane angle", "ক্যামেরার সমতলে কোণ"),
    "moveAngle",
  );
  const repValue = metric(
    text("Completed repetitions", "সম্পূর্ণ পুনরাবৃত্তি"),
    "moveReps",
  );
  const setValue = metric(text("Completed sets", "সম্পূর্ণ সেট"), "moveSets");
  const timeValue = metric(
    text("Observed movement time", "পর্যবেক্ষিত সময়"),
    "moveTime",
  );
  const qualityValue = metric(
    text("Landmark confidence", "দেহবিন্দুর নির্ভরযোগ্যতা"),
    "moveQuality",
  );
  const phaseValue = el(
    "p",
    text(
      "Find a comfortable starting position.",
      "স্বচ্ছন্দ শুরুর অবস্থানে আসুন।",
    ),
  );
  phaseValue.id = "movePhase";
  panel.append(
    controls,
    planField,
    guide,
    planNotice,
    actions,
    status,
    metrics,
    phaseValue,
  );
  panel.append(
    el(
      "p",
      text(
        "The angle is an estimate in the camera’s image plane. Camera placement changes the reading. Stop if the movement causes pain, dizziness or discomfort.",
        "কোণটি ক্যামেরার ছবির সমতলে একটি আনুমানিক মান। ক্যামেরার অবস্থান বদলালে মান বদলায়। ব্যথা, মাথা ঘোরা বা অস্বস্তি হলে থামুন।",
      ),
      "muted",
    ),
  );

  const historyPanel = el("section", "", "card");
  historyPanel.append(el("h3", text("Your sessions", "আপনার সেশন")));
  const historyActions = el("div", "", "actions");
  const exportButton = el(
    "button",
    text("Export sessions", "সেশন রপ্তানি করুন"),
    "secondary",
  );
  exportButton.id = "moveExport";
  historyActions.append(exportButton);
  const historyRows = el("div");
  historyRows.id = "moveHistory";
  historyPanel.append(historyActions, historyRows);
  host.replaceChildren(panel, historyPanel);

  const announce = (message) => {
    status.textContent = message;
    context.notify?.(message);
  };

  function stopCamera() {
    runVersion++;
    running = false;
    starting = false;
    context.camera?.stop?.();
    session?.pause();
    pause.disabled = true;
    start.disabled = false;
    finish.disabled = !session?.validFrames || !!savedId;
    for (const control of [
      exercise,
      side,
      mode,
      goal,
      hold,
      target,
      planSelect,
    ])
      control.disabled = false;
    if (alive) refreshGuide();
  }

  function chosenPlan() {
    if (planSelect.value)
      return localPlans.find((item) => item.id === planSelect.value) ?? null;
    return context.plan ?? null;
  }

  function refreshGuide() {
    const spec = EXERCISES[exercise.value];
    guide.textContent = bn ? spec.guideBn : spec.guide;
    activePlan = resolvePlan(chosenPlan(), exercise.value, side.value);
    if (mode.value === "rehab") {
      for (const control of [goal, hold, target]) control.disabled = true;
      if (activePlan) {
        target.value = String(activePlan.limits.target);
        goal.value = String(activePlan.repsPerSet ?? activePlan.reps ?? 5);
        hold.value = String((activePlan.holdMs ?? 250) / 1000);
      }
      planNotice.textContent = activePlan
        ? text(
            `Clinician plan from ${activePlan.clinicianName}. Limits from ${new Date(activePlan.approvedAt).toLocaleDateString()} will be used.`,
            `${activePlan.clinicianName}-এর পরিকল্পনা। ${new Date(activePlan.approvedAt).toLocaleDateString()} তারিখের সীমা ব্যবহার হবে।`,
          )
        : text(
            "Choose a matching clinician-approved plan before starting rehabilitation. Personal movement practice remains available.",
            "পুনর্বাসন শুরুর আগে এই নড়াচড়ার অনুমোদিত চিকিৎসকের পরিকল্পনা বেছে নিন। নিজের নড়াচড়ার অনুশীলন ব্যবহার করতে পারেন।",
          );
    } else {
      if (!running && !starting)
        for (const control of [goal, hold, target]) control.disabled = false;
      planNotice.textContent = text(
        "The displayed targets are adjustable practice settings. Choose comfortable limits. A rehabilitation plan is configured by your clinician.",
        "দেখানো লক্ষ্য অনুশীলনের জন্য বদলানো যায়। স্বচ্ছন্দ সীমা বেছে নিন। পুনর্বাসনের পরিকল্পনা আপনার চিকিৎসক নির্ধারণ করবেন।",
      );
    }
  }

  function resetSession() {
    stopCamera();
    session = null;
    savedId = null;
    lastSave = null;
    repValue.textContent = setValue.textContent = "0";
    angleValue.textContent = qualityValue.textContent = "—";
    timeValue.textContent = "0 s";
    finish.disabled = true;
    refreshGuide();
  }

  exercise.addEventListener("change", () => {
    target.value = String(EXERCISES[exercise.value].target);
    resetSession();
  });
  for (const control of [side, mode, goal, hold, target, planSelect])
    control.addEventListener("change", resetSession);

  async function loadHistory() {
    try {
      const records = await context.store.list("move");
      if (!alive) return;
      history = records;
      renderHistory();
    } catch (error) {
      if (alive)
        historyRows.replaceChildren(
          el(
            "p",
            text(
              "Session history could not be read. Try unlocking your local data store.",
              "সেশনের ইতিহাস পড়া যায়নি। স্থানীয় তথ্যের তালা খুলে দেখুন।",
            ),
            "muted",
          ),
        );
    }
  }

  function renderHistory() {
    exportButton.disabled = !history.length;
    historyRows.replaceChildren();
    if (!history.length) {
      historyRows.append(
        el(
          "p",
          text(
            "Saved sessions appear here. Only observed movements are counted.",
            "সংরক্ষিত সেশন এখানে দেখা যাবে। শুধু দেখা সম্পূর্ণ নড়াচড়া গণনা করা হয়।",
          ),
          "muted",
        ),
      );
      return;
    }
    const groups = new Map();
    for (const record of history) {
      const value = record.value;
      if (!value || !EXERCISES[value.exerciseId]) continue;
      const key = `${value.exerciseId}:${value.side}`;
      if (!groups.has(key)) groups.set(key, []);
      groups.get(key).push(record);
      const row = el("article", "", "card");
      const spec = EXERCISES[value.exerciseId];
      row.append(
        el(
          "h4",
          `${bn ? spec.labelBn : spec.label} · ${value.side === "left" ? text("left", "বাম") : text("right", "ডান")}`,
        ),
      );
      row.append(
        el(
          "p",
          `${new Date(record.timestamp).toLocaleString()} · ${value.reps} ${text("reps", "বার")} · ${value.sets} ${text("sets", "সেট")} · ${Math.round((value.observedMs ?? 0) / 1000)} s`,
        ),
      );
      row.append(
        el(
          "p",
          text(
            `Observed angle range ${value.romDegrees ?? "—"}° · camera estimate · ${value.planId ? "clinician plan" : "personal practice"}`,
            `পর্যবেক্ষিত কোণের বিস্তার ${value.romDegrees ?? "—"}° · ক্যামেরার আনুমানিক মান · ${value.planId ? "চিকিৎসকের পরিকল্পনা" : "নিজের অনুশীলন"}`,
          ),
          "muted",
        ),
      );
      const actions = el("div", "", "actions");
      const summary = el(
        "button",
        text("Export this session", "এই সেশন রপ্তানি করুন"),
        "secondary",
      );
      summary.addEventListener("click", () =>
        download(
          JSON.stringify(record, null, 2),
          `asha-move-${record.id}.json`,
        ),
      );
      const remove = el("button", text("Delete", "মুছুন"), "secondary");
      remove.addEventListener("click", async () => {
        remove.disabled = true;
        try {
          await context.store.remove(record.id);
          await loadHistory();
        } catch (error) {
          if (alive) {
            remove.disabled = false;
            announce(error.message);
          }
        }
      });
      actions.append(summary, remove);
      row.append(actions);
      historyRows.append(row);
    }
    for (const [key, records] of groups) {
      if (records.length < 2) continue;
      const latest = records[0].value;
      const previous = records[1].value;
      const comparable =
        latest.angleMethod === previous.angleMethod &&
        latest.planId === previous.planId;
      const summary = el(
        "p",
        comparable
          ? text(
              `${EXERCISES[latest.exerciseId].label} (${latest.side}): latest ${latest.reps} reps, previous ${previous.reps}. Compare only with the same camera placement and movement limits.`,
              `${EXERCISES[latest.exerciseId].labelBn}: সর্বশেষ ${latest.reps} বার, আগে ${previous.reps} বার। একই ক্যামেরার অবস্থান ও সীমায় তুলনা করুন।`,
            )
          : text(
              "Sessions with different plans or angle methods are listed separately.",
              "আলাদা পরিকল্পনা বা কোণের পদ্ধতির সেশন আলাদাভাবে দেখুন।",
            ),
        "notice",
      );
      summary.dataset.trend = key;
      historyRows.prepend(summary);
    }
  }

  start.addEventListener("click", async () => {
    if (starting || running) return;
    try {
      refreshGuide();
      if (mode.value === "rehab" && !activePlan)
        throw new Error(
          text(
            "A matching clinician-approved plan is required for rehabilitation.",
            "পুনর্বাসনের জন্য এই নড়াচড়ার চিকিৎসকের অনুমোদিত পরিকল্পনা প্রয়োজন।",
          ),
        );
      if (!context.camera?.start)
        throw new Error(
          text(
            "Camera tracking is unavailable on this device. Your history remains available.",
            "এই যন্ত্রে ক্যামেরায় নড়াচড়া দেখা যাচ্ছে না। ইতিহাস দেখতে পারবেন।",
          ),
        );
      const overrides =
        mode.value === "rehab"
          ? { ...(activePlan.limits ?? {}), holdMs: activePlan.holdMs ?? 250 }
          : { target: Number(target.value), holdMs: Number(hold.value) * 1000 };
      const config = movementConfig(exercise.value, overrides);
      const repsPerSet =
        mode.value === "rehab"
          ? Number(activePlan.repsPerSet ?? activePlan.reps ?? goal.value)
          : Number(goal.value);
      if (!session || savedId) {
        session = new MoveSession({
          exerciseId: exercise.value,
          side: side.value,
          repsPerSet,
          config,
          plan: mode.value === "rehab" ? activePlan : null,
        });
        savedId = null;
        lastSave = null;
        lastPaint = 0;
      }
      const version = ++runVersion;
      starting = true;
      start.disabled = true;
      for (const control of [
        exercise,
        side,
        mode,
        goal,
        hold,
        target,
        planSelect,
      ])
        control.disabled = true;
      announce(
        text(
          "Starting the shared pose camera…",
          "দেহের নড়াচড়া দেখার ক্যামেরা চালু হচ্ছে…",
        ),
      );
      await context.camera.start("pose", (frame) => {
        if (!alive || version !== runVersion) return;
        const result = session.update(frame);
        if (frame.timestamp - lastPaint < 100 && !result.counted) return;
        lastPaint = frame.timestamp;
        angleValue.textContent = result.valid
          ? `${Math.round(result.angle)}°`
          : "—";
        qualityValue.textContent = result.valid
          ? `${Math.round(result.confidence * 100)}%`
          : "—";
        repValue.textContent = String(result.reps);
        setValue.textContent = String(
          Math.floor(result.reps / session.repsPerSet),
        );
        timeValue.textContent = `${Math.round(session.observedMs / 1000)} s`;
        phaseValue.textContent = (bn ? PHASES_BN : PHASES)[result.phase];
        status.textContent = result.valid
          ? result.counted
            ? text(
                "One complete repetition observed.",
                "একটি সম্পূর্ণ পুনরাবৃত্তি দেখা হয়েছে।",
              )
            : text(
                "Tracking your movement. Continue at a comfortable pace.",
                "নড়াচড়া দেখা হচ্ছে। স্বচ্ছন্দ গতিতে চালিয়ে যান।",
              )
          : bn
            ? "দেহের প্রয়োজনীয় বিন্দু দেখা যাচ্ছে না। ক্যামেরার অবস্থান ঠিক করুন।"
            : result.reason;
        finish.disabled = !session.validFrames || !!savedId;
      });
      if (!alive || version !== runVersion) return;
      running = true;
      starting = false;
      pause.disabled = false;
      start.textContent = text("Resume camera", "ক্যামেরা আবার চালু করুন");
      announce(
        text(
          "Camera ready. Find the starting position before the first repetition.",
          "ক্যামেরা প্রস্তুত। প্রথমবারের আগে শুরুর অবস্থানে আসুন।",
        ),
      );
    } catch (error) {
      if (!alive) return;
      stopCamera();
      announce(error.message);
    }
  });

  pause.addEventListener("click", () => {
    stopCamera();
    announce(
      text(
        "Paused. Resume from the starting position; an incomplete movement will not count.",
        "বিরতি। শুরুর অবস্থান থেকে আবার শুরু করুন। অসম্পূর্ণ নড়াচড়া গণনা হবে না।",
      ),
    );
  });

  finish.addEventListener("click", async () => {
    if (!session || savedId || lastSave) return;
    stopCamera();
    if (!session.validFrames) return;
    finish.disabled = true;
    lastSave = session.record();
    try {
      const saved = await context.store.add(lastSave);
      savedId = saved?.id ?? "saved";
      if (!alive) return;
      announce(
        text(
          "Session saved with its camera source and tracking quality.",
          "ক্যামেরার উৎস ও পর্যবেক্ষণের মানসহ সেশন সংরক্ষিত হয়েছে।",
        ),
      );
      await loadHistory();
    } catch (error) {
      lastSave = null;
      if (alive) {
        finish.disabled = false;
        announce(error.message);
      }
    }
  });

  exportButton.addEventListener("click", () =>
    download(
      JSON.stringify(
        {
          model: MOVE_MODEL,
          exportedAt: new Date().toISOString(),
          records: history,
        },
        null,
        2,
      ),
      "asha-move-sessions.json",
    ),
  );

  const onVisibility = () => {
    if (document.hidden && (running || starting)) {
      stopCamera();
      announce(
        text(
          "Camera paused while this page is in the background.",
          "পাতা আড়ালে থাকায় ক্যামেরা বন্ধ হয়েছে।",
        ),
      );
    }
  };
  document.addEventListener("visibilitychange", onVisibility);
  refreshGuide();
  void loadHistory();
  void context.store
    .list("plans")
    .then((records) => {
      if (!alive) return;
      localPlans = records.filter(
        (record) =>
          record.source === "clinician" &&
          record.value?.clinicianName &&
          record.value?.approvedAt,
      );
      if (localPlans.length) {
        planField.hidden = false;
        for (const record of localPlans) {
          const option = el(
            "option",
            `${record.value.clinicianName} · ${new Date(record.value.approvedAt).toLocaleDateString()}`,
          );
          option.value = record.id;
          planSelect.append(option);
        }
        if (
          context.plan?.id &&
          localPlans.some((record) => record.id === context.plan.id)
        )
          planSelect.value = context.plan.id;
        refreshGuide();
      }
    })
    .catch(() => {});

  return () => {
    alive = false;
    stopCamera();
    document.removeEventListener("visibilitychange", onVisibility);
  };
}
