# Feature flags

`app/everyday/contracts.js` exports the explicit code flags. They describe implemented capability, not clinical clearance or remote entitlement. The existing assistive modules are unchanged and independently reachable at `/app`.

| Flag                                        | State | Meaning                                                                                                                      |
| ------------------------------------------- | ----- | ---------------------------------------------------------------------------------------------------------------------------- |
| Nutrition / Move / EyeSpeak / Care / Clinic | On    | Independently usable interactive code paths; camera and cloud require explicit action/consent                                |
| Food vision                                 | Off   | No food-trained, licensed, evaluated classifier/segmentation weights are supplied                                            |
| Offline ASR                                 | Off   | Browser ASR is optional; no Whisper pack installed                                                                           |
| Clinical release                            | Off   | Symptom protocol review/validation is pending                                                                                |
| Signed release packs                        | Off   | Verification/install/rollback/eviction infrastructure is tested, but no production trust key or signed release is configured |

Weights already bundled in the repo are lazy loaded with pinned SHA-256 and size checks. MediaPipe GPU failure falls back to CPU/WASM. One model runs at a time; inference scheduling adapts downward when it takes longer. Camera permission denial keeps touch, manual logging, journals and switch scanning usable.

Activating food vision requires held-out food/portion evaluation, licensed weights and model/source metadata. Activating signed packs requires an operator-controlled offline signing key, pinned public trust key, signed manifests and release/rollback testing. The private signing key must never be put in this repository. Clinical release cannot be enabled by a UI checkbox or an LLM response.
