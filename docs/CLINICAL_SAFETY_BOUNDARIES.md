# Clinical safety boundaries

**Clinical release is disabled. The rule set is precautionary, versioned and not clinician-reviewed.** Its tests are engineering-authored scenarios, not a clinician-authored validation dataset. It is not an exhaustive symptom checker, autonomous triage system, diagnosis or medical-device approval.

`SAFETY_POLICY` in `app/everyday/safety.js` is the source of truth. Reported/uncertain chest discomfort, breathing difficulty, loss of consciousness/faintness and associated warning flags produce urgent templates before any model call. Structured flags cannot be negated by narrative text. English/Bangla/transliteration, common spelling errors, negation and contradictory reports are covered by tests; coverage is limited and recognition can fail for untested language. An educational question alone is distinguished from a current symptom report. Overlong or empty text cannot proceed to AI.

Urgent guidance works without accounts, cloud availability or a payment. It offers region-aware contact instructions (Bangladesh 999; configurable GB/US/CA/EU/India; other regions use the local emergency number) and a user-operated telephone link. The app does not call anyone or send a caregiver/clinician message. It does not use exercise, arm raising, diet history or a model to rule out a heart attack. Current source references:

- [NHS heart attack information](https://www.nhs.uk/conditions/heart-attack/)
- [Bangladesh Police hotline information](https://police.portal.gov.bd/pages/static-pages/6922dcc4933eb65569e11ed9)
- [Police Telecom national emergency service](https://telecom-police.portal.gov.bd/pages/static-pages/695e3b0cc4774958d7b72321)

Nonurgent AI output is bounded educational text for visit preparation. It cannot invoke tools or change measurements. Malformed output, a failed provider, claims of contacting someone, common false reassurance and prohibited exercise/medication instructions fall back to a local template. These checks are defense in depth, not proof that all model-generated medical text is safe. A medically reviewed knowledge base, adversarial evaluation and clinician sign-off are required before health use beyond this prototype.

Move measures a camera-plane angle, not force, pain, bone health or clinical recovery. Its personal-practice thresholds are editable settings. Rehabilitation uses an explicitly clinician-origin plan, but this demo does not verify that professional's identity; do not represent it as a verified clinical prescription workflow. Camera occlusion/gaps discard incomplete movements.

Nutrition ranges reflect entered ingredient/gram bounds, not validated confidence intervals or hidden-oil/salt inference. USDA ingredient references do not establish the accuracy of a regional meal recipe. EyeSpeak's held-out setup check does not establish population gaze accuracy, fatigue safety or suitability for every user. Existing VitalSense values remain camera estimates and are not replaced with invented device measurements.

Release gates: qualified clinical review and authored cases; intended-user usability/accessibility testing; multilingual/ASR red-team scenarios; weighed-meal and independent motion/gaze evaluations; privacy/security review; professional identity and staffed-workflow decisions; and jurisdiction-specific regulatory assessment. None is implied complete by passing software tests.
