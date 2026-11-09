# Validation and evidence

Current engineering checks:

1. `npm test` — 231 automated tests cover the full suite. Existing blink observations/intent confirmation, facial baseline, head returns, hand profiles/two-hand geometry, caregiver rules, RAG/tool verification, speech echo blocking and VitalSense signal windows remain covered.
2. `node tests/everyday-browser.mjs` — passed real local Clinic API journeys in separate admin/patient/clinician browser contexts; independent modules; Nutrition save/versioned correction/delete; vault create/reload/wrong-password/unlock/lock/export payload/delete and ciphertext inspection; EyeSpeak touch/Bangla/English letters/undo/switch/focus; permission denial; offline urgent UI with zero AI requests; dark/light mobile layout; no page errors.
3. `node tests/everyday-offline.mjs` — passed service-worker install, offline shell reload, local chest-symptom guidance and independent Nutrition navigation without server connectivity.
4. `node scripts/everyday-benchmark.mjs --browser` — verified installed face/pose SHA and byte counts; ran real CPU/WASM inference. See `MODEL_BENCHMARKS.md` for workload and limits.

The managed Chrome cancelled file-system downloads. QA therefore verified the actual JSON export through the product's copyable export fallback, plus deletion, instead of claiming an OS file was saved. Screenshots and report JSON are local ignored `artifacts/` outputs. Browser camera-denial tests and synthetic feed benchmarks do not validate human pose/gaze accuracy. This work did not repeat production caregiver delivery or use physical phones; the existing workflow is preserved and its logic tests passed.

Pending release evaluation:

| Area               | Dataset/reference and metrics required                                                                                                                                                               |
| ------------------ | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Nutrition vision   | Licensed Bangladesh dishes; patient-independent held-out splits; top-1/top-3, macro-F1, ECE, per-dish breakdown; no activation without trained weights                                               |
| Portions/nutrition | Weighed meals, measured retained oil/salt, gram/kcal MAE, ingredient-bound interval coverage and correction rate                                                                                     |
| Move               | Independent goniometer/reference video, rep-count MAE, invalid-rep false accepts, camera angle/occlusion/lighting and limited-mobility cases                                                         |
| EyeSpeak           | Intended users and caregivers, 5/9/16 setup time, held-out target accuracy, false selections/minute, characters/minute, drift, fatigue, glasses and head/screen changes                              |
| Care safety        | Qualified clinicians author/review scenarios; Bangla/English/code switching/ASR errors/negation/contradictions; urgent recall and false-alert review, offline/no-network and model adversarial cases |
| Speech             | Consented Bangla/English/code-switch recordings; transcription/error and privacy comparison of OS ASR vs a specifically licensed optional offline pack                                               |
| Performance        | Low-end Android and supported iOS: cold/warm p50/p95, peak process RAM, sustained FPS, battery/thermal load and download failures                                                                    |
| Privacy/security   | External review of tenant isolation, capability exposure, backup/deletion behavior, provider terms, encryption, browser XSS protections and professional identity access                             |
| Accessibility      | Keyboard/screen reader, contrast, motor/fatigue needs, Bangla fonts/voices and intended-user usability; no camera-only dependency                                                                    |

Do not invent a numeric accuracy, clinical recovery score, reliable food identity, cornea precision, diagnosis or clinical clearance from these software tests. Clinical release remains gated off.
