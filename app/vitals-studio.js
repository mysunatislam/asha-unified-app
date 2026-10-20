// VitalSense's full observation view, using the shared camera and local POS pipeline.
// The source module is preserved at vitalsense/index.html.
export function vitalsStudio() {
  return `<section class="vitals-studio" aria-label="VitalSense camera observations">
    <div class="card vitals-heading">
      <div class="section-heading"><div><span class="eyebrow">YOUR RHYTHM · SHARED CAMERA</span><h2>VitalSense</h2></div><span id="vsStatus" class="pill">Camera paused</span></div>
      <p class="muted">Face the camera in steady light. VitalSense samples your forehead and both cheeks, then checks the signal before showing a pulse estimate.</p>
      <div class="vitals-readings">
        <div class="vitals-reading vitals-heart"><span class="eyebrow">HEART RATE · ESTIMATE</span><strong><span id="pulseValue">—</span><small>bpm</small></strong><span id="vsHeartNote">12 seconds of steady signal needed</span></div>
        <div class="vitals-reading"><span class="eyebrow">BREATHING · ESTIMATE</span><strong><span id="vsBreathing">—</span><small>br/min</small></strong><span id="vsBreathingReason">30 seconds of steady signal needed</span></div>
        <div class="vitals-reading"><span class="eyebrow">HRV · RMSSD</span><strong><span id="vsRmssd">—</span><small>ms</small></strong><span id="vsHrvReason">Waiting for usable beat timing</span></div>
        <div class="vitals-reading"><span class="eyebrow">SIGNAL QUALITY</span><strong id="pulseQuality">—</strong><span id="vsSampling">No skin regions sampled yet</span></div>
      </div>
      <p id="pulseReason" class="vitals-status" role="status">Start the shared camera to begin.</p>
      <div class="vitals-collection"><progress id="vsCollection" max="1" value="0" aria-label="Signal collection progress"></progress><span id="pulseWindow">0 / 12 sec</span></div>
    </div>
    <div class="card vitals-baseline">
      <div class="section-heading"><div><span class="eyebrow">YOUR SESSION REFERENCE</span><h3>Personal baseline</h3></div><button id="vsCalibrate" class="secondary">Calibrate 30 seconds</button></div>
      <p class="muted">Sit comfortably and keep still while confident readings build your resting reference.</p>
      <div class="metrics"><div class="metric"><small>Baseline</small><strong id="vsBaseline">Not calibrated</strong></div><div class="metric"><small>Compared with baseline</small><strong id="vsCompared">—</strong></div><div class="metric"><small>Signal confidence</small><strong id="vsConfidence">—</strong></div></div>
      <progress id="vsBaselineProgress" max="1" value="0" aria-label="Baseline calibration progress"></progress><p id="vsBaselineNote" class="small muted">Calibration uses 30 seconds of usable readings. It does not measure stress or diagnose discomfort.</p>
    </div>
    <div class="card vitals-wave"><div class="section-heading"><h3>Live pulse waveform</h3><span id="vsFps" class="pill">— fps</span></div><canvas id="vsWave" class="vitals-chart" aria-label="Recovered local pulse waveform"></canvas><p class="small muted">A recovered color signal from the camera, not an ECG.</p></div>
    <div class="vitals-insights">
      <div class="card"><div class="section-heading"><h3>Session trend</h3><button id="vsReset" class="text-button">Reset session</button></div><canvas id="vsTrend" class="vitals-chart" aria-label="Confident pulse estimates over this session"></canvas><p id="vsTrendNote" class="small muted">Confident readings will appear here.</p></div>
      <div class="card"><h3>Beat timing</h3><div class="metrics"><div class="metric"><small>Observed beats</small><strong id="vsBeats">—</strong></div><div class="metric"><small>Mean interval</small><strong id="vsInterval">—</strong></div><div class="metric"><small>Session range</small><strong id="vsRange">—</strong></div></div><p class="small muted">Beat intervals are especially sensitive to camera timing and motion. HRV stays unavailable when timing cannot support a useful estimate.</p></div>
      <div class="card vitals-log-card"><div class="section-heading"><h3>Reading log</h3><button id="vsExport" class="text-button">Export CSV</button></div><div id="vsLog" class="vitals-log"><p class="muted">No confident readings yet.</p></div></div>
    </div>
    <details class="card vitals-method"><summary>How VitalSense works &amp; measurement limits</summary><p>Face tracking locates three skin regions: the forehead and both cheeks. Dark, overexposed and moving regions are rejected. Actual camera RGB samples are timestamped and resampled only when a continuous signal is available.</p><p>The original VitalSense POS color projection, detrending and frequency analysis recover a pulse trend. Breathing uses a longer window of small head movements. Changes in lighting, talking, movement, camera processing and skin tone can all affect these observations.</p><p>These are experimental camera estimates. They do not measure blood pressure, oxygen saturation or temperature, and they do not trigger emergency calls. Use a validated device for clinical measurements.</p></details>
  </section>`;
}

const clamp = (x, a, b) => Math.max(a, Math.min(b, x));
const number = (x, digits = 0) => Number.isFinite(x) ? x.toFixed(digits) : "—";
function chart(id, points, { color = "--accent", unit = "", fixedRange, empty = "Waiting for a steady signal" } = {}) {
  const el = document.getElementById(id);
  if (!el) return;
  const ratio = Math.min(window.devicePixelRatio || 1, 2);
  const w = Math.max(200, el.clientWidth), h = 160;
  el.width = Math.round(w * ratio); el.height = Math.round(h * ratio);
  const c = el.getContext("2d");
  c.scale(ratio, ratio);
  const css = getComputedStyle(document.documentElement);
  c.strokeStyle = css.getPropertyValue("--line").trim();
  c.lineWidth = 1;
  for (let row = 1; row < 4; row++) {
    c.beginPath(); c.moveTo(0, h * row / 4); c.lineTo(w, h * row / 4); c.stroke();
  }
  const valid = points.filter(p => Number.isFinite(p.y) && Number.isFinite(p.x));
  if (valid.length < 2) {
    c.fillStyle = css.getPropertyValue("--muted").trim(); c.font = "12px system-ui";
    c.fillText(empty, 12, 85); return;
  }
  let lo = fixedRange?.[0] ?? Math.min(...valid.map(p => p.y));
  let hi = fixedRange?.[1] ?? Math.max(...valid.map(p => p.y));
  const padding = Math.max((hi - lo) * .12, unit ? 3 : .00001);
  lo -= padding; hi += padding;
  const t0 = valid[0].x, span = Math.max(1, valid.at(-1).x - t0);
  c.strokeStyle = css.getPropertyValue(color).trim(); c.lineWidth = 2;
  c.beginPath();
  valid.forEach((p, i) => {
    const x = 8 + (w - 16) * (p.x - t0) / span, y = h - 14 - (h - 28) * (p.y - lo) / (hi - lo);
    if (!i || (unit && p.x - valid[i - 1].x > 5000)) c.moveTo(x, y); else c.lineTo(x, y);
  });
  c.stroke();
  if (unit) {
    c.fillStyle = css.getPropertyValue("--muted").trim(); c.font = "11px system-ui";
    c.fillText(`${number(hi)} ${unit}`, 8, 13); c.fillText(`${number(lo)} ${unit}`, 8, h - 3);
  }
}

export function paintVitals(p = {}, running = false) {
  if (!document.getElementById("vsStatus")) return;
  const text = (id, value) => { const e = document.getElementById(id); if (e) e.textContent = value; };
  const usable = running && Number.isFinite(p.bpm);
  const baseline = p.baseline || {};
  text("vsStatus", !running ? "Camera paused" : ({good:"Good signal",fair:"Checking signal",poor:"Adjust positioning",collecting:"Collecting signal"}[p.status] || "Collecting signal"));
  document.getElementById("vsStatus").dataset.signal = running ? p.status || "collecting" : "paused";
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
  document.getElementById("vsCollection").value = running ? clamp((p.windowSeconds || 0) / (p.requiredSeconds || 12), 0, 1) : 0;
  text("vsBaseline", Number.isFinite(baseline.bpm) ? `${number(baseline.bpm)} bpm` : baseline.calibrating && running ? "Calibrating…" : "Not calibrated");
  text("vsCompared", usable && Number.isFinite(baseline.bpm) ? `${p.bpm >= baseline.bpm ? "+" : ""}${number(p.bpm - baseline.bpm)} bpm` : "—");
  text("vsConfidence", usable ? `${number(p.confidence ?? (p.quality || 0) * 100)}%` : "—");
  document.getElementById("vsBaselineProgress").value = clamp(baseline.progress || 0, 0, 1);
  text("vsCalibrate", baseline.calibrating && running ? "Restart calibration" : Number.isFinite(baseline.bpm) ? "Recalibrate 30 seconds" : "Calibrate 30 seconds");
  text("vsBaselineNote", baseline.calibrating && running ? "Keep still. Only usable, continuous readings count toward your 30-second baseline." : Number.isFinite(baseline.bpm) ? "Session reference saved. The difference above is an observation, not a stress or health diagnosis." : "Calibration uses 30 seconds of usable readings. It does not measure stress or diagnose discomfort.");
  text("vsFps", running ? `${number(p.sampleFps, 1)} samples/sec` : "Paused");
  text("vsBeats", running && p.hrv?.beats ? p.hrv.beats : "—");
  text("vsInterval", running && Number.isFinite(p.hrv?.meanIbi) ? `${number(p.hrv.meanIbi)} ms` : "—");
  const trend = (p.trend || []).filter(r => Number.isFinite(r.bpm));
  text("vsRange", trend.length ? `${number(Math.min(...trend.map(r => r.bpm)))}–${number(Math.max(...trend.map(r => r.bpm)))} bpm` : "—");
  text("vsTrendNote", trend.length ? `${trend.length} confident session readings. Gaps indicate unavailable signal.` : "Confident readings will appear here.");
  chart("vsWave", running ? (p.signal || []).map((y, i) => ({x:i, y})) : [], {empty:running ? "Collecting a steady signal…" : "Camera paused"});
  chart("vsTrend", trend.map(r => ({x:r.t, y:r.bpm})), {unit:"bpm", empty:"No confident session readings yet"});
  const log = document.getElementById("vsLog"), readings = (p.readings || []).slice(-40).reverse();
  const signature = readings.map(r => `${r.t}:${r.bpm}`).join("|");
  if (log.dataset.content !== signature) {
    log.dataset.content = signature;
    log.replaceChildren();
    if (!readings.length) { const empty = document.createElement("p"); empty.className = "muted"; empty.textContent = "No confident readings yet."; log.append(empty); }
    for (const r of readings) {
      const row = document.createElement("div"); row.className = "vitals-log-row";
      const time = document.createElement("span"); time.textContent = `${number(r.t / 1000)} s elapsed`;
      const value = document.createElement("strong"); value.textContent = `${number(r.bpm)} bpm`;
      row.append(time, value); log.append(row);
    }
  }
  document.getElementById("vsExport").disabled = !readings.length;
}

export function exportVitals(p = {}) {
  const lines = ["page_elapsed_seconds,pulse_bpm,quality_percent"];
  for (const r of p.readings || []) if (Number.isFinite(r.t) && Number.isFinite(r.bpm))
    lines.push(`${(r.t / 1000).toFixed(2)},${r.bpm.toFixed(1)},${Number.isFinite(r.quality) ? Math.round(r.quality * 100) : ""}`);
  const url = URL.createObjectURL(new Blob([lines.join("\n")], {type:"text/csv;charset=utf-8"}));
  const a = document.createElement("a"); a.href = url; a.download = "vitalsense-session-estimates.csv"; a.click();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}
