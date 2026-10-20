// VitalSense's full observation view, using the shared camera and local POS pipeline.
// The source module is preserved at vitalsense/index.html.
export function vitalsStudio() {
  return `<section class="vitals-studio" aria-label="VitalSense camera observations">
    <div class="card vitals-heading">
      <div class="section-heading"><div><span class="eyebrow">YOUR RHYTHM · SHARED CAMERA</span><h2>VitalSense</h2></div><span id="vsStatus" class="pill">Camera paused</span></div>
      <p class="muted">Keep your face still in steady light. Estimates appear when the signal is ready.</p>
      <div class="vitals-readings">
        <div class="vitals-reading vitals-heart"><span class="eyebrow">HEART RATE · ESTIMATE</span><div class="vitals-heart-reading"><span id="vsHeart" class="vitals-heart-stage" data-beating="false" aria-hidden="true"><span class="vitals-heart-ring"></span><span class="vitals-heart-ring vitals-heart-ring-late"></span><svg class="vitals-heart-icon" viewBox="0 0 32 32" focusable="false"><path d="M16 28 4.9 17.3C-2.7 9.9 7.8-1.1 16 7.2 24.2-1.1 34.7 9.9 27.1 17.3Z"/></svg></span><strong><span id="pulseValue">—</span><small>bpm</small></strong></div><span id="vsHeartNote">12 seconds of steady signal needed</span></div>
        <div class="vitals-reading"><span class="eyebrow">BREATHING · ESTIMATE</span><strong><span id="vsBreathing">—</span><small>br/min</small></strong><span id="vsBreathingReason">30 seconds of steady signal needed</span></div>
        <div class="vitals-reading"><span class="eyebrow">HRV · RMSSD</span><strong><span id="vsRmssd">—</span><small>ms</small></strong><span id="vsHrvReason">Waiting for usable beat timing</span></div>
        <div class="vitals-reading"><span class="eyebrow">SIGNAL QUALITY</span><strong id="pulseQuality">—</strong><span id="vsSampling">No skin regions sampled yet</span></div>
      </div>
      <p id="pulseReason" class="vitals-status" role="status">Start the shared camera to begin.</p>
      <div class="vitals-collection"><progress id="vsCollection" max="1" value="0" aria-label="Signal collection progress"></progress><span id="pulseWindow">0 / 12 sec</span></div>
    </div>
    <div class="card vitals-baseline">
      <div class="section-heading"><div><span class="eyebrow">YOUR SESSION REFERENCE</span><h3>Personal baseline</h3></div><button id="vsCalibrate" class="secondary">Calibrate 30 seconds</button></div>
      <p class="muted">Keep still to build your session reference.</p>
      <div class="metrics"><div class="metric"><small>Baseline</small><strong id="vsBaseline">Not calibrated</strong></div><div class="metric"><small>Compared with baseline</small><strong id="vsCompared">—</strong></div><div class="metric"><small>Signal confidence</small><strong id="vsConfidence">—</strong></div></div>
      <progress id="vsBaselineProgress" max="1" value="0" aria-label="Baseline calibration progress"></progress><p id="vsBaselineNote" class="small muted">30 seconds of usable readings needed.</p>
    </div>
    <div class="card vitals-wave"><div class="section-heading"><h3>Live pulse waveform</h3><span id="vsFps" class="pill">— fps</span></div><canvas id="vsWave" class="vitals-chart" aria-label="Recovered local pulse waveform"></canvas><p class="small muted">A recovered color signal from the camera, not an ECG.</p></div>
    <div class="vitals-insights">
      <div class="card"><div class="section-heading"><h3>Session trend</h3><button id="vsReset" class="text-button">Reset session</button></div><canvas id="vsTrend" class="vitals-chart" aria-label="Confident pulse estimates over this session"></canvas><p id="vsTrendNote" class="small muted">Confident readings will appear here.</p></div>
      <div class="card"><h3>Beat timing</h3><div class="metrics"><div class="metric"><small>Observed beats</small><strong id="vsBeats">—</strong></div><div class="metric"><small>Mean interval</small><strong id="vsInterval">—</strong></div><div class="metric"><small>Session range</small><strong id="vsRange">—</strong></div></div><p class="small muted">HRV appears only with usable beat timing.</p></div>
      <div class="card vitals-log-card"><div class="section-heading"><h3>Reading log</h3><button id="vsExport" class="text-button">Export CSV</button></div><div id="vsLog" class="vitals-log"><p class="muted">No confident readings yet.</p></div></div>
    </div>
    <details class="card vitals-method"><summary>Measurement details &amp; limits</summary><p>Face tracking locates the forehead and both cheeks. Dark, overexposed and moving regions are rejected. Pulse needs 12 seconds of continuous samples; breathing needs 30 seconds. Keep the camera steady, face a light source, and avoid talking during collection.</p><p>POS color projection, detrending and frequency analysis recover a pulse trend. The heart animation follows the current accepted pulse estimate; it does not mark individual measured heartbeats. Breathing uses small head movements. Beat intervals and provisional HRV are especially sensitive to camera timing, lighting and motion.</p><p>Calibration needs 30 continuous seconds of confident readings. The saved baseline is a session reference; a difference does not measure stress or diagnose discomfort. Skin tone, camera processing and changes in light can affect all observations.</p><p>These are experimental camera estimates. They do not measure blood pressure, oxygen saturation or temperature, and do not trigger emergency calls. Use a validated device for clinical measurements.</p></details>
  </section>`;
}

const clamp = (x, a, b) => Math.max(a, Math.min(b, x));
const number = (x, digits = 0) => Number.isFinite(x) ? x.toFixed(digits) : "—";
const charts = new WeakMap(), views = new WeakMap(), EMPTY = [];
let palette, activeView;
function releaseView() {
  if (!activeView) return;
  for (const el of activeView.elements.values()) {
    const s = el && charts.get(el);
    if (s?.raf != null) cancelAnimationFrame(s.raf);
    s?.observer?.disconnect();
    if (s) charts.delete(el);
  }
  activeView.elements.get("vsHeart")?.setAttribute("data-beating", "false");
  activeView = null;
}
function colors() {
  const root = document.documentElement, theme = root.dataset?.theme || "light";
  if (!palette || palette.root !== root || palette.theme !== theme) {
    const css = getComputedStyle(root);
    palette = { root, theme, line: css.getPropertyValue("--line").trim(), muted: css.getPropertyValue("--muted").trim(), accent: css.getPropertyValue("--accent").trim() };
  }
  return palette;
}
function plotPath(c, xy, gaps, from, blend = 1) {
  c.beginPath();
  for (let i = 0; i < xy.length; i += 2) {
    const y = from ? from[i + 1] + (xy[i + 1] - from[i + 1]) * blend : xy[i + 1];
    if (!i || gaps?.has(i)) c.moveTo(xy[i], y); else c.lineTo(xy[i], y);
  }
  c.stroke();
}
function drawChart(s, now) {
  if (document.hidden || s.el.isConnected === false) { s.raf = null; return; }
  const { c, w, h, colors: css } = s;
  c.clearRect(0, 0, w, h);
  c.strokeStyle = css.line; c.lineWidth = 1;
  plotPath(c, s.grid, s.gridGaps);
  if (s.xy.length < 4) {
    c.fillStyle = css.muted; c.font = "12px system-ui"; c.fillText(s.empty, 12, 85);
    return;
  }
  const blend = s.from ? clamp((now - s.started) / s.duration, 0, 1) : 1;
  c.strokeStyle = css.accent; c.lineWidth = 2;
  plotPath(c, s.xy, s.gaps, s.from, blend);
  if (s.unit) {
    c.fillStyle = css.muted; c.font = "11px system-ui";
    c.fillText(`${number(s.hi)} ${s.unit}`, 8, 13); c.fillText(`${number(s.lo)} ${s.unit}`, 8, h - 3);
  }
  if (blend >= 1) s.from = null;
  else if (s.raf == null) s.raf = requestAnimationFrame(t => animateChart(s, t));
}
function animateChart(s, now) {
  s.raf = null;
  if (document.hidden || s.el.isConnected === false) { s.from = null; return; }
  // Optical data arrives at 2 Hz. Interpolate only between these observed plots,
  // with a 30-fps display budget independent of camera/landmark inference.
  if (now - (s.lastDraw || 0) < 32) { s.raf = requestAnimationFrame(t => animateChart(s, t)); return; }
  s.lastDraw = now;
  drawChart(s, now);
}
function chart(el, points, { unit = "", wave = false, empty = "Waiting for a steady signal" } = {}) {
  if (!el) return;
  let s = charts.get(el);
  if (!s) {
    s = { el, c: el.getContext("2d"), xy: new Float32Array(), dirty: true, raf: null, unit };
    charts.set(el, s);
    if (typeof ResizeObserver !== "undefined") {
      s.observer = new ResizeObserver(() => { s.dirty = true; }); s.observer.observe(el);
    }
  }
  const css = colors(), ratio = Math.min(window.devicePixelRatio || 1, 2);
  const resized = s.dirty || s.ratio !== ratio;
  if (!resized && s.source === points && s.colors === css && s.empty === empty) return;
  const now = performance.now(), previous = s.xy;
  if (resized) {
    s.w = Math.max(200, el.clientWidth); s.h = 160; s.ratio = ratio; s.dirty = false;
    const width = Math.round(s.w * ratio), height = Math.round(s.h * ratio);
    if (el.width !== width) el.width = width;
    if (el.height !== height) el.height = height;
    s.c.setTransform(ratio, 0, 0, ratio, 0, 0);
    s.grid = new Float32Array([0,40,s.w,40,0,80,s.w,80,0,120,s.w,120]); s.gridGaps = new Set([4,8]);
  }
  const valid = [];
  let lo = Infinity, hi = -Infinity;
  for (let i = 0; i < points.length; i++) {
    const x = wave ? i : points[i].t, y = wave ? points[i] : points[i].bpm;
    if (!Number.isFinite(x) || !Number.isFinite(y)) continue;
    valid.push({ x, y }); lo = Math.min(lo, y); hi = Math.max(hi, y);
  }
  const padding = Math.max((hi - lo) * .12, unit ? 3 : .00001);
  s.lo = lo - padding; s.hi = hi + padding;
  const t0 = valid[0]?.x || 0, span = Math.max(1, (valid.at(-1)?.x || 0) - t0);
  s.xy = new Float32Array(valid.length * 2); s.gaps = new Set();
  for (let i = 0; i < valid.length; i++) {
    s.xy[i * 2] = 8 + (s.w - 16) * (valid[i].x - t0) / span;
    s.xy[i * 2 + 1] = s.h - 14 - (s.h - 28) * (valid[i].y - s.lo) / (s.hi - s.lo);
    if (unit && i && valid[i].x - valid[i - 1].x > 5000) s.gaps.add(i * 2);
  }
  if (s.raf != null) cancelAnimationFrame(s.raf);
  s.raf = null;
  const animate = wave && !resized && previous.length >= 4 && previous.length === s.xy.length && !window.matchMedia?.("(prefers-reduced-motion: reduce)").matches;
  // Never generate an ECG or new signal samples: only blend observed positions.
  s.from = animate ? previous : null;
  s.duration = clamp(now - (s.updated || now - 250), 120, 500);
  s.started = now; s.updated = now; s.source = points; s.colors = css; s.empty = empty;
  drawChart(s, now);
}

export function usableVitalSignal(p, running, now = performance.now()) {
  return !!running && !document.hidden && Number.isFinite(p.bpm) && p.bpm >= 42 && p.bpm <= 200 &&
    ["good", "fair"].includes(p.status) && p.confidence > 0 && Number.isFinite(p.at) && now >= p.at && now - p.at <= 1000;
}

export function paintVitals(p = {}, running = false) {
  const statusElement = document.getElementById("vsStatus");
  if (!statusElement) { releaseView(); return; }
  let view = views.get(statusElement);
  if (!view) { view = { elements: new Map([["vsStatus", statusElement]]) }; views.set(statusElement, view); }
  if (activeView !== view) { releaseView(); activeView = view; }
  const element = id => {
    if (!view.elements.has(id)) view.elements.set(id, document.getElementById(id));
    return view.elements.get(id);
  };
  const text = (id, value) => { const e = element(id); if (e && e.textContent !== String(value)) e.textContent = value; };
  const progress = (id, value) => { const e = element(id); if (e && e.value !== value) e.value = value; };
  const usable = running && Number.isFinite(p.bpm);
  const beating = usableVitalSignal(p, running), heart = element("vsHeart");
  if (heart) {
    heart.dataset.beating = String(beating);
    if (beating) heart.style.setProperty("--beat-duration", `${Math.round(60000 / p.bpm)}ms`);
  }
  const baseline = p.baseline || {};
  text("vsStatus", !running ? "Camera paused" : ({good:"Good signal",fair:"Checking signal",poor:"Adjust positioning",collecting:"Collecting signal"}[p.status] || "Collecting signal"));
  statusElement.dataset.signal = running ? p.status || "collecting" : "paused";
  text("pulseValue", usable ? number(p.bpm) : "—");
  text("vsHeartNote", usable ? "Camera estimate · current signal" : "12 seconds of steady signal needed");
  text("vsBreathing", running ? number(p.breathingBpm) : "—");
  text("vsBreathingReason", running ? p.breathingReason || "30 seconds of steady signal needed" : "Camera paused");
  text("vsRmssd", running ? number(p.hrv?.rmssd) : "—");
  text("vsHrvReason", running ? p.hrv?.reason || "Waiting for usable beat timing" : "Camera paused");
  text("pulseQuality", running && p.windowSeconds > 0 ? `${number((p.quality || 0) * 100)}%` : "—");
  text("vsSampling", running ? `${p.roiCount || 0} / 3 skin regions · ${number(p.sampleFps, 1)} samples/sec` : "No skin regions sampled");
  text("pulseReason", running ? p.reason || "Collecting a steady signal…" : "Start the shared camera to begin.");
  text("pulseWindow", `${running ? number(p.windowSeconds || 0, 1) : "0"} / ${p.requiredSeconds || 12} sec`);
  progress("vsCollection", running ? clamp((p.windowSeconds || 0) / (p.requiredSeconds || 12), 0, 1) : 0);
  text("vsBaseline", Number.isFinite(baseline.bpm) ? `${number(baseline.bpm)} bpm` : baseline.calibrating && running ? "Calibrating…" : "Not calibrated");
  text("vsCompared", usable && Number.isFinite(baseline.bpm) ? `${p.bpm >= baseline.bpm ? "+" : ""}${number(p.bpm - baseline.bpm)} bpm` : "—");
  text("vsConfidence", usable ? `${number(p.confidence ?? (p.quality || 0) * 100)}%` : "—");
  progress("vsBaselineProgress", clamp(baseline.progress || 0, 0, 1));
  text("vsCalibrate", baseline.calibrating && running ? "Restart calibration" : Number.isFinite(baseline.bpm) ? "Recalibrate 30 seconds" : "Calibrate 30 seconds");
  text("vsBaselineNote", baseline.calibrating && running ? "Keep still · 30 seconds of confident readings needed." : Number.isFinite(baseline.bpm) ? "Session reference saved." : "30 seconds of usable readings needed.");
  text("vsFps", running ? `${number(p.sampleFps, 1)} samples/sec` : "Paused");
  text("vsBeats", running && p.hrv?.beats ? p.hrv.beats : "—");
  text("vsInterval", running && Number.isFinite(p.hrv?.meanIbi) ? `${number(p.hrv.meanIbi)} ms` : "—");
  const trend = p.trend || EMPTY;
  if (view.trend !== trend) {
    const rates = trend.filter(r => Number.isFinite(r.bpm)).map(r => r.bpm);
    text("vsRange", rates.length ? `${number(Math.min(...rates))}–${number(Math.max(...rates))} bpm` : "—");
    text("vsTrendNote", rates.length ? `${rates.length} session readings · gaps mean unavailable signal.` : "Confident readings will appear here.");
    view.trend = trend;
  }
  chart(element("vsWave"), running ? p.signal || EMPTY : EMPTY, {wave:true, empty:running ? "Collecting a steady signal…" : "Camera paused"});
  chart(element("vsTrend"), trend, {unit:"bpm", empty:"No confident session readings yet"});
  const log = element("vsLog"), sourceReadings = p.readings || EMPTY;
  if (log && view.readings !== sourceReadings) {
    view.readings = sourceReadings;
    const readings = sourceReadings.slice(-40).reverse();
    log.replaceChildren();
    if (!readings.length) { const empty = document.createElement("p"); empty.className = "muted"; empty.textContent = "No confident readings yet."; log.append(empty); }
    for (const r of readings) {
      const row = document.createElement("div"); row.className = "vitals-log-row";
      const time = document.createElement("span"); time.textContent = `${number(r.t / 1000)} s elapsed`;
      const value = document.createElement("strong"); value.textContent = `${number(r.bpm)} bpm`;
      row.append(time, value); log.append(row);
    }
    element("vsExport").disabled = !readings.length;
  }
}

export function exportVitals(p = {}) {
  const lines = ["page_elapsed_seconds,pulse_bpm,quality_percent"];
  for (const r of p.readings || []) if (Number.isFinite(r.t) && Number.isFinite(r.bpm))
    lines.push(`${(r.t / 1000).toFixed(2)},${r.bpm.toFixed(1)},${Number.isFinite(r.quality) ? Math.round(r.quality * 100) : ""}`);
  const url = URL.createObjectURL(new Blob([lines.join("\n")], {type:"text/csv;charset=utf-8"}));
  const a = document.createElement("a"); a.href = url; a.download = "vitalsense-session-estimates.csv"; a.click();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}
