// The public website imports no camera, speech or AI engines.
const query = new URLSearchParams(location.search);
if (query.has("module") || query.has("role"))
  location.replace("/app" + location.search + location.hash);
const root = document.documentElement;
let theme = "light";
try {
  theme = localStorage.getItem("asha-site-theme") || "light";
} catch {}
const themeButton = document.getElementById("siteTheme");
function applyTheme() {
  root.dataset.theme = theme;
  themeButton.setAttribute("aria-pressed", String(theme === "dark"));
  themeButton.setAttribute(
    "aria-label",
    `Switch to ${theme === "dark" ? "light" : "dark"} mode`,
  );
}
applyTheme();
themeButton.addEventListener("click", () => {
  theme = theme === "light" ? "dark" : "light";
  applyTheme();
  try {
    localStorage.setItem("asha-site-theme", theme);
  } catch {}
});
const menu = document.getElementById("siteMenu");
function closeMenu() {
  menu.setAttribute("aria-expanded", "false");
  document.getElementById("navigation").classList.remove("open");
}
menu.addEventListener("click", () => {
  const open = menu.getAttribute("aria-expanded") !== "true";
  menu.setAttribute("aria-expanded", String(open));
  document.getElementById("navigation").classList.toggle("open", open);
});
document
  .querySelectorAll("#navigation a")
  .forEach((a) => a.addEventListener("click", closeMenu));
document.addEventListener("keydown", (e) => {
  if (e.key === "Escape") closeMenu();
});
document.getElementById("year").textContent = new Date().getFullYear();
const features = {
  face: [
    "FACE + EYES",
    "A movement can become a message.",
    "Guided calibration learns a personal baseline for deliberate blinks, smiles and head movements. A separate confirmation keeps ordinary movement from becoming an unintended request.",
    "FaceSpeak",
    "facespeak",
    "◉",
    "SMALL SIGNALS. REAL MEANING.",
  ],
  hand: [
    "HANDS + FINGERS",
    "A gesture that feels like you.",
    "Track both hands and practice personal gestures for chosen phrases. See live movement before calibration, then train the signals that work best for you.",
    "FingerSpeak",
    "fingerspeak",
    "✋",
    "YOUR GESTURE. YOUR VOICE.",
  ],
  speech: [
    "SPEECH + UNDERSTANDING",
    "Help the words come through.",
    "Practice speech or ask Asha to suggest a likely meaning for unclear words. Sound-first interpretation offers alternatives—and asks the speaker to check the meaning.",
    "SenseAssist",
    "senseassist",
    "“",
    "UNDERSTAND. PRACTICE. CONNECT.",
  ],
  vitals: [
    "CAMERA + OBSERVATION",
    "A window into your rhythm.",
    "Observe experimental pulse and breathing trends from the shared camera. Signal-quality checks explain when readings are not ready. These are not clinical measurements.",
    "VitalSense",
    "vitalsense",
    "♡",
    "AWARENESS, NOT A DIAGNOSIS.",
  ],
  posture: [
    "BODY + POSITION",
    "See the bigger picture.",
    "Local pose tracking adds movement and position context alongside face and hand sensing. Explore observations in Details; posture alone never diagnoses or places a call.",
    "Posture",
    "posture",
    "⌁",
    "CONTEXT FOR MORE THOUGHTFUL CARE.",
  ],
};
const tabs = [...document.querySelectorAll("[data-capability]")];
function choose(tab) {
  tabs.forEach((b) => {
    b.setAttribute("aria-selected", String(b === tab));
    b.tabIndex = b === tab ? 0 : -1;
  });
  const [label, title, copy, name, module, symbol, caption] =
    features[tab.dataset.capability];
  for (const [id, text] of Object.entries({
    "capability-label": label,
    "capability-title": title,
    "capability-copy": copy,
    "capability-symbol": symbol,
    "capability-caption": caption,
  }))
    document.getElementById(id).textContent = text;
  const link = document.getElementById("capability-link");
  link.textContent = `Explore ${name} ↗`;
  link.href = `/app?module=${module}`;
  document
    .getElementById("capability-panel")
    .setAttribute("aria-labelledby", tab.id);
  document.querySelector(".capability-visual").dataset.visual =
    tab.dataset.capability;
}
tabs.forEach((tab, i) => {
  tab.addEventListener("click", () => choose(tab));
  tab.addEventListener("keydown", (e) => {
    let next;
    if (["ArrowRight", "ArrowDown"].includes(e.key))
      next = (i + 1) % tabs.length;
    else if (["ArrowLeft", "ArrowUp"].includes(e.key))
      next = (i - 1 + tabs.length) % tabs.length;
    else if (e.key === "Home") next = 0;
    else if (e.key === "End") next = tabs.length - 1;
    if (next != null) {
      e.preventDefault();
      choose(tabs[next]);
      tabs[next].focus();
    }
  });
});
