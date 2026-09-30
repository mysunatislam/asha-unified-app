// Generated from okf/*.md by node okf/compile.mjs. Do not edit by hand.
export const okfDocuments = [
  {
    "id": "guide:companion",
    "module": "companion",
    "type": "App Guide",
    "title": "Asha companion and confirmed requests",
    "description": "How Asha guides the patient and confirms requests.",
    "status": "draft",
    "text": "The caregiver starts support once on the patient phone to grant camera/audio permission. Asha introduces each page, checks in gently about every two minutes while support is active, and asks after sustained changes. Pause Asha check-ins is available. Details contains every module. The caregiver completes assessment and calibration; no capability locks access. A calibrated patient response proposes a request, then a separate confirmation sends it to the assigned caregiver. Ordinary blinks never initiate or confirm requests. The app does not place telephone calls. Do not announce delivery without a verified receipt.",
    "provenance": "https://github.com/mysunatislam/neurobridge-asha-unified-app/blob/main/server/knowledge.js",
    "verification": "source-text-parity"
  },
  {
    "id": "guide:assessment",
    "module": "assessment",
    "type": "App Guide",
    "title": "Capability assessment and module choice",
    "description": "Available capabilities guide module suggestions without blocking access.",
    "status": "draft",
    "text": "Recommend FingerSpeak for available hands/fingers, FaceSpeak for available eyes/lips/head, and SenseAssist alongside either when speech is available. All modules can be opened manually. Blind users need spoken guidance, hearing-impaired users need visible text. If no gesture can be captured, caregiver-assisted or touch communication remains necessary.",
    "provenance": "https://github.com/mysunatislam/neurobridge-asha-unified-app/blob/main/server/knowledge.js",
    "verification": "source-text-parity"
  },
  {
    "id": "guide:facespeak",
    "module": "facespeak",
    "type": "App Guide",
    "title": "FaceSpeak calibration and confirmation",
    "description": "Facial movement practice and the separate request confirmation.",
    "status": "draft",
    "text": "Calibrate patient captures neutral and available movements. Eye-only communication is supported: practice three quick consecutive blinks with full reopening, then separately practice a slower deliberate yes blink (about half a second). A calibrated rapid triple blink proposes the currently offered need, or water if none is offered. It never sends by itself. Asha asks the question aloud; after she finishes, keep eyes open briefly, then make the separate deliberate confirmation blink. Ordinary blink counts never send requests. Cadence cannot prove intent, so the independent confirmation is essential. Head and smile responses remain available: prompted nod for water, left-return for food, right-return for toilet. Without a calibrated response, ask a caregiver to help set it up in Details. Scores are movement features, not clinical ability. Sustained changes prompt a question, never an automatic request or diagnosis.",
    "provenance": "https://github.com/mysunatislam/neurobridge-asha-unified-app/blob/main/server/knowledge.js",
    "verification": "source-text-parity"
  },
  {
    "id": "guide:fingerspeak",
    "module": "fingerspeak",
    "type": "App Guide",
    "title": "FingerSpeak hand communication",
    "description": "Personal gesture practice with either or both hands.",
    "status": "draft",
    "text": "Both hands are tracked. Choose a familiar pose and its meaning, then hold, relax and repeat three times to learn. Show the saved pose to propose a request and repeat a mapped pose to confirm. No hand ability assessment blocks opening FingerSpeak. If no usable gesture is captured, suggest FaceSpeak or caregiver assistance without locking the hand interface.",
    "provenance": "https://github.com/mysunatislam/neurobridge-asha-unified-app/blob/main/server/knowledge.js",
    "verification": "source-text-parity"
  },
  {
    "id": "guide:senseassist",
    "module": "senseassist",
    "type": "App Guide",
    "title": "SenseAssist speech practice and clarification",
    "description": "Speech practice, editable transcripts, and speaker confirmation.",
    "status": "draft",
    "text": "Two uses: gentle phrase practice and clarification of heard words. Browser recognition produces editable transcripts; AI interpretation proposes candidate wording. Speaker confirmation is necessary. Confirmed words can be spoken aloud or sent through the caregiver request flow. Do not claim that transcript differences are a diagnosis or objective phoneme score.",
    "provenance": "https://github.com/mysunatislam/neurobridge-asha-unified-app/blob/main/server/knowledge.js",
    "verification": "source-text-parity"
  },
  {
    "id": "guide:vitalsense",
    "module": "vitalsense",
    "type": "App Guide",
    "title": "VitalSense pulse trends and limitations",
    "description": "Local camera pulse trend and measurements it cannot make.",
    "status": "draft",
    "text": "The camera samples forehead color locally for a 20-second pulse-trend window. Motion, lighting changes and weak spectral signals are rejected. It cannot measure blood pressure, oxygen saturation or temperature, and does not trigger emergencies. For health decisions use an appropriate validated device and professional advice.",
    "provenance": "https://github.com/mysunatislam/neurobridge-asha-unified-app/blob/main/server/knowledge.js",
    "verification": "source-text-parity"
  },
  {
    "id": "guide:posture",
    "module": "posture",
    "type": "App Guide",
    "title": "Posture and possible wake patterns",
    "description": "Shared pose tracking, sustained changes, and wake-like observations.",
    "status": "draft",
    "text": "Lightweight pose estimation shares the camera with face and both hands in every patient interface. Optional YOLO provides a second posture estimate. Shoulders must be visible; hips improve lean estimates. A minute of sustained change prompts a comfort check-in. Closed-eye/still-body then open-eye/movement is a possible wake pattern, not a sleep-stage classifier.",
    "provenance": "https://github.com/mysunatislam/neurobridge-asha-unified-app/blob/main/server/knowledge.js",
    "verification": "source-text-parity"
  },
  {
    "id": "guide:caregiver",
    "module": "caregiver",
    "type": "App Guide",
    "title": "Caregiver delivery and acknowledgement",
    "description": "Private caregiver view, request receipts, and live update limits.",
    "status": "draft",
    "text": "Use the private caregiver link from setup on the second phone. View Requests & updates and acknowledge to let the patient know. Sent means server-stored; received means the dashboard fetched it; acknowledged requires a caregiver action. Push is optional, and on iPhone requires installation to the Home Screen. Keep the dashboard open for foreground live updates. Patient camera sensing stops when the browser is backgrounded or locked.",
    "provenance": "https://github.com/mysunatislam/neurobridge-asha-unified-app/blob/main/server/knowledge.js",
    "verification": "source-text-parity"
  }
];
