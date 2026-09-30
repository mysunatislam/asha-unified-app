---
type: App Guide
title: Posture and possible wake patterns
description: Shared pose tracking, sustained changes, and wake-like observations.
tags: [asha, posture, camera]
status: draft
generated: { by: codex/2026-09-30, at: 2026-09-30T12:00:31Z }
verified: { by: process:okf-source-parity-test, at: 2026-09-30T12:00:31Z }
verification_scope: Exact guide-text match only; not clinical validation.
sources:
  - id: app-guide
    resource: https://github.com/mysunatislam/neurobridge-asha-unified-app/blob/main/server/knowledge.js
    title: Versioned Asha application guide
---

# Guidance

Lightweight pose estimation shares the camera with face and both hands in every patient interface. Optional YOLO provides a second posture estimate. Shoulders must be visible; hips improve lean estimates. A minute of sustained change prompts a comfort check-in. Closed-eye/still-body then open-eye/movement is a possible wake pattern, not a sleep-stage classifier.
