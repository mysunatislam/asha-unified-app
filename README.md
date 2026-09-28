# NeuroBridge Asha · Unified app

A new application built from the preserved `neurobridge-asha-unified-web` assets. Original repositories are not modified.

## Live application

- Patient / caregiver setup: https://neurobridge-asha-live.vercel.app/
- Direct FaceSpeak demo: https://neurobridge-asha-live.vercel.app/?module=facespeak
- Caregiver dashboard: https://neurobridge-asha-live.vercel.app/?role=caregiver
- New source repository: https://github.com/mysunatislam/neurobridge-asha-unified-app

## Explore without a patient link

Choose **Explore live demo** on the first page or open a direct `?module=` link. FaceSpeak, FingerSpeak, VitalSense, SenseAssist and posture are all available in Details. Tap **Start camera** to run the actual models; guided calibration can be tried there. A generic demo care circle is created automatically when the service is available, so Asha chat and confirmed caregiver requests can also be tested without pasting credentials. Cloud chat asks for consent before sending words. To test delivery on another phone, use **Copy demo caregiver link**. If the service is down, local sensing still opens and the page identifies the missing cloud connection.

## Two-phone walkthrough

1. Open the main link and choose **Set up with a caregiver**. On **Tell Asha about you**, optionally choose support needs or skip. Next select actual capabilities, including vision, hearing and speech. Speech support is suggested alongside other viable modes, not instead of them.
2. Select **Next**, review the recommendation, and create a private care circle.
3. If the setup was completed on the patient phone, stay there; no patient link is needed. Copy the **caregiver link** to the other phone. If setup was completed elsewhere, use the patient link on the patient phone. An ID alone cannot authorize access.
4. On the patient phone choose **Start support**. Open **Details → FaceSpeak · NeuroFace Sense** for the full facial dashboard. Relax with eyes open briefly to learn the observation reference, then choose **Calibrate patient** for measured gesture calibration; unsupported movements can be skipped. FingerSpeak opens its complete two-hand calibration, speaking and evaluation studio on the same camera.
5. Tap Water, confirm, then acknowledge on the caregiver phone. The patient sees Sent → Received → Acknowledged. The same request flow is used for trained gestures and confirmed speech.
6. The caregiver can enable push notifications. On iOS, install the page to the Home Screen first. Foreground dashboard polling works without push. Allow sound on the patient device with an initial touch.

## Implemented

- Clean light/dark responsive UI and installable PWA. Large controls, visible labels, keyboard focus, reduced-motion support, live status, movable floating Asha companion.
- Capability assessment and recommendations without module access restrictions. Manual interface choice is always possible.
- Optional “Tell Asha about you” setup: accident-related voice loss, ALS, stroke recovery, cerebral palsy, older-adult support, locked-in syndrome, autism, temporary voice loss or another reason. Multiple choices, goals, and skip are supported. This self-described context is editable by the caregiver and is never used to infer or limit capabilities.
- NeuroFace Sense (including FaceSpeak calibration), FingerSpeak, VitalSense and posture remain enabled together on the shared camera, regardless of the open details tab. Live status distinguishes tracked signals from searching or weak signals. Facial expression values are model signals, never a percentage of the patient's ability.
- One camera stream shared by face, two independent hands, local forehead color-pulse sampling, and body pose. Face/pose and hand processing use independently backpressured workers where supported, with GPU/CPU and compatible single-worker/foreground fallbacks. FingerSpeak receives priority hand sampling during calibration or live use without opening another camera.
- FaceSpeak: measured neutral baseline; practiced rapid triple blink and separate longer confirmation blink for eye-only communication; three observed repetitions for selected smile/pucker/nod/head-turn skills; only captured skills enabled. Asha asks before a caregiver request is sent. Normal blink counts never send requests.
- NeuroFace details restore the original neutral-relative AU geometry for eyebrow raise/lowering, cheek raise, smile, lip stretch and lip opening; bilateral eye/smile measurements; yaw/pitch/roll and nod state; motion curves; and an exportable observation log. The original blink/smile/head state machines and calibrated thresholds are preserved. Signal consistency is not a motor-ability score.
- The visible blink count follows completed bilateral dips and recoveries in the same raw EAR signal as the curve, using a recent open-eye reference rather than a stale maximum or saved camera baseline. Tracking gaps, isolated spikes, winks and held closures are rejected. These observed blinks never emit FaceSpeak commands; deliberate calibrated request recognition stays separate.
- FingerSpeak: the original full two-hand interface, real recorded samples, guided calibration, temporal model training, prototype/DTW comparison, held-out evaluation, probability curves, and live intent/release gating. Its model and samples are scoped to the patient and retained when moving between pages. Familiar-pose three-hold mappings remain an optional shortcut. Assessment never blocks this module.
- Body posture: MediaPipe Pose Landmarker Lite in every patient view. Optional YOLO26n-pose ONNX cross-check in its own worker. Actual body landmarks, not a decorative overlay.
- Rest-like to awake-like check-in: continuous valid closed-eye/still-body observations for 60 seconds, then open eyes and movement. Occlusion or tracking gaps reset evidence. This does **not** measure sleep stages.
- Sustained posture or asymmetric lip cues prompt the patient to confirm a caregiver request. The original lateral-lip (3.5% face width) and corner-asymmetry (4%) thresholds use a same-side 60-second observation timer, with pose/symmetric-smile guards and tracking-loss reset. Startup displacement is not learned away as neutral. A flag is not a seizure diagnosis and never places an automatic emergency call.
- VitalSense: local CHROM-style signal and spectral pulse-trend estimate with motion/lighting/signal rejection. No fabricated blood pressure, SpO2 or temperature values.
- SenseAssist: browser transcription/dictation, editable heard text, server-powered AI interpretation with alternatives and explicit speaker confirmation, spoken output, caregiver sending, and AI practice guidance.
- Asha server-side intelligence from every module. Device voice selection and recorded caregiver phrases; confirmed local preferences and optional needs scanning. No voice-cloning claim.
- Patient-scoped caregiver requests, separate hashed role tokens, idempotent retries, received/acknowledged receipts, current status, multiple assigned patients, and optional web push. Notification bodies contain no patient details.
- API keys are server environment variables only. Private storage namespace, rate limits, origin checks, consent, no-store responses, and daily expired-session cleanup.

## Important current limits

This is a functioning demonstration application, **not a validated clinical or emergency monitoring device**. Camera-derived posture, facial asymmetry and pulse are engineering observations. Do not rely on it as the only means of obtaining assistance.

Browser camera monitoring works only while the patient page remains open and active. A locked/backgrounded phone may stop the camera. Web push is best-effort and OS-dependent; it is not an emergency dispatch service.

The supplied provider key successfully supports text reasoning and speech interpretation. Its dedicated `/v1/voice-typing/session` returned **401** in the integration check. Therefore the shipped microphone transcript comes from browser speech recognition (or keyboard dictation), **not a falsely labeled provider audio transcription service**. No clinical dysarthric-speech accuracy or speaker-identification claim is made. Direct provider audio requires the supported audio endpoint/protocol and corresponding entitlement.

Camera-model tests use official MediaPipe fixtures, not patient validation. Mobile performance and real gesture accuracy depend on device, lighting and positioning; calibrate on the actual patient's phone.

## Development

```sh
npm install
npm test
npm start
```

Local preview: http://127.0.0.1:4180. The development server proxies API requests to the deployed backend; it never embeds secrets. Browser tests are in `tests/`, and use the desktop's bundled Playwright/Chrome paths; adapt these paths for another machine. Test artifacts are ignored by Git and deployment.

`api/` contains Vercel serverless functions; `server/` contains persistence and validation. `app/` is the unified frontend and camera pipeline. The original static export remains in Git history and supporting assets are reused. FingerSpeak is embedded from `neuroface/fingerspeak.html`, receiving hand results and the parent's existing media stream through a same-origin bridge; it cannot request another camera or microphone. Other legacy frontend routes are redirected/excluded on Vercel.

Server secrets: `MAIRA_API_KEY`, `MAIRA_PROJECT_KEY`, `BLOB_READ_WRITE_TOKEN`, `VAPID_PUBLIC_KEY`, `VAPID_PRIVATE_KEY`, `VAPID_SUBJECT`, `CRON_SECRET`. Never set them in frontend code or a public repository. `scripts/provision.mjs` is an operator helper for this workstation; it transfers credentials in memory.

## Verification

- Automated original-engine regression, neutral-relative AU/head, 60-second lip hold, calibration, role, signal rejection and YOLO decoder tests.
- Two isolated browser contexts with real cloud storage: create care circle → patient request → caregiver receipt → acknowledgment → patient confirmation.
- Real cloud interpretation of `wed wabbit wghreen` produced `red rabbit green` with a confirmation question and alternatives.
- Actual MediaPipe/YOLO initialization and real-image pose inference; separate face/two-hand fixtures.
- Shared-camera regression detects both hands and accepts a real 900 ms calibration sequence without weakening the original continuity, frame-count, hand-count or distance checks. Capture allows up to three seconds to obtain that valid window; slow/occluded captures are rejected rather than padded with duplicate frames.
- Responsive screenshots, no horizontal overflow, no application JavaScript exceptions in the browser flow.

Model sources, licenses and hashes: `models/README.md`, `models/manifest.json`, and `neuroface/vendor/manifest.json`. YOLO's AGPL license requires attention before proprietary commercial distribution.
