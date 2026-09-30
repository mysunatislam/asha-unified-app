---
type: App Guide
title: VitalSense pulse trends and limitations
description: Local camera pulse trend and measurements it cannot make.
tags: [asha, vitalsense, pulse]
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

The camera samples forehead color locally for a 20-second pulse-trend window. Motion, lighting changes and weak spectral signals are rejected. It cannot measure blood pressure, oxygen saturation or temperature, and does not trigger emergencies. For health decisions use an appropriate validated device and professional advice.
