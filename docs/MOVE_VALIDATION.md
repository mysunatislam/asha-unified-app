# ASHA Move implementation and validation

## Implemented behavior

`app/everyday/move.js` mounts the movement workspace through the shared Everyday camera service. It requests the existing MediaPipe Pose Landmarker Lite task and closes the camera when paused, when the page is hidden, or when the module unmounts. The module owns no second camera stream or inference loop.

Four movement counters are implemented.

| Movement              | Observed angle       | Camera placement and additional requirement                                                                 |
| --------------------- | -------------------- | ----------------------------------------------------------------------------------------------------------- |
| Seated knee extension | Hip–knee–ankle       | Side-on at knee height, seated on a stable chair                                                            |
| Elbow flexion         | Shoulder–elbow–wrist | Side-on to the working arm, upper arm held still                                                            |
| Shoulder flexion      | Hip–shoulder–elbow   | Side-on, upper arm visible, comfortably straight elbow                                                      |
| Sit to stand          | Hip–knee–ankle       | Side-on with shoulder, hip, knee and ankle visible, including a clear hip rise before the return to sitting |

Angles are camera-plane estimates with image aspect ratio restored. They are not calibrated clinical joint measurements. The default practice thresholds are software starting settings that the user can adjust to a comfortable movement. Rehabilitation requires a matching clinician-origin plan with clinician name, approval timestamp, movement and side. The module accepts explicit plan limits and repetitions from that plan. A clinician-origin field records where the plan came from. Qualification and clinical approval are controlled by the surrounding clinic workflow.

Task-specific landmark visibility and presence must reach 0.65, and required joints must lie inside the camera frame. A second person is rejected when the shared camera supplies `personCount > 1`. A confidence-aware One Euro filter resets after an invalid observation or a gap over 400 ms. The repetition state machine requires an observed start, target hold, and return. Holding a position, starting at the target, a short threshold crossing, tracking loss and an incomplete return cannot independently add a repetition.

Saved sessions include exercise, working side, observed repetitions, completed sets, practice limits, observed angle range, valid and invalid frame counts, observation time, camera-active duration, model version and clinician plan ID when available. They use `source: camera_estimate`, `units: session`, `correction_status: unconfirmed` and `consent_scope: move`. Raw video is not stored. History supports deletion and JSON export. Adjacent sessions show repetition counts and a reminder to use the same camera placement and limits when comparing.

## Reused model and source records

- Existing asset `models/pose_landmarker_lite.task`.
- Pinned source `https://storage.googleapis.com/mediapipe-models/pose_landmarker/pose_landmarker_lite/float16/1/pose_landmarker_lite.task`.
- Existing recorded size 5,777,746 bytes.
- Existing recorded SHA-256 `59929e1d1ee95287735ddd833b19cf4ac46d29bc7afddbbf6753c459690d574a`.
- Official task documentation `https://developers.google.com/edge/mediapipe/solutions/vision/pose_landmarker` describes 33 image and world landmarks, video input and monotonic timestamps.
- Runtime/model provenance is inherited from `models/manifest.json` and `neuroface/vendor/manifest.json`. No new model weights or inference runtime dependency were installed by this module.

## Checks completed

Run `node --test tests/everyday-move.test.mjs` from the repository root. Thirteen checks passed during implementation.

1. Aspect-correct angle geometry and degenerate-point rejection.
2. Required joint confidence, framing and supplied multi-person rejection.
3. Complete cycles for each of the four exercises.
4. Target-first startup and incomplete movement rejection.
5. A held target cannot create repeated counts.
6. Threshold jitter cannot satisfy the target hold.
7. Occlusion and camera gaps discard incomplete repetitions.
8. Sit-to-stand needs hip rise as well as knee extension.
9. Filter state resets after tracking loss.
10. Invalid practice and clinician thresholds are rejected.
11. Rehabilitation plans require a matching movement and clinician-origin metadata.
12. Generated landmark sequences produce provenance-bearing session records and exclude a paused interval from observed time.
13. Camera-frame duration and valid-observation time remain separate when joints are occluded.

These checks use generated angles and landmark trajectories to test geometry, state transitions and records. Browser integration and target-phone inference are separate checks. No joint-angle error, repetition-count error, battery drain, temperature rise or target-device FPS has been measured by this module.

## Required participant and reference evaluation

- Compare counted repetitions with independent video annotations. Report count MAE, incomplete-repetition sensitivity and false repetitions per observed minute.
- Compare angles and ranges with a goniometer or motion-capture reference under predefined camera placement. Report bias, absolute error and limits of agreement per exercise.
- Separate people and recording sessions between development and evaluation. Include comfortable movement ranges and intended mobility levels.
- Test front, side and partly turned cameras, occlusion, loose clothing, varied lighting, glasses where relevant to setup, and other people entering the view.
- Report the proportion of frames and complete attempts rejected for quality alongside accuracy on accepted observations.
- Measure cold/warm startup, p50/p95 frame latency, FPS, memory, battery and thermal behavior on physical low-cost Android phones, then supported iOS and desktop browsers.
- Have a qualified clinician define rehabilitation limits and review the intended workflow before rehabilitation use. Pose-derived movement does not establish pain, muscle force, bone health or recovery.
