---
type: App Guide
title: VitalSense pulse trends and limitations
description: Local camera pulse trend and measurements it cannot make.
tags: [asha, vitalsense, pulse]
status: draft
generated: { by: codex/2026-10-20, at: 2026-10-20T09:30:00Z }
verified: { by: process:okf-source-parity-test, at: 2026-10-20T09:30:00Z }
verification_scope: Exact guide-text match only; not clinical validation.
sources:
  - id: app-guide
    resource: https://github.com/mysunatislam/neurobridge-asha-unified-app/blob/main/server/knowledge.js
    title: Versioned Asha application guide
---

# Guidance

VitalSense shares the camera and samples color from the forehead and both cheeks locally. A continuous 12-second POS pulse window and a longer 30-second head-motion window support experimental pulse and breathing estimates. Motion, poor lighting, tracking gaps and weak signals are rejected. Calibrate 30 seconds learns a resting reference from usable readings. The full Details screen includes waveform, session trend and CSV reading log; optical HRV is provisional and withheld when timing is insufficient. It cannot measure blood pressure, oxygen saturation or temperature, and does not trigger emergencies. For health decisions use an appropriate validated device and professional advice.
