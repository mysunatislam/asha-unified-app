# Measured assets and initial benchmarks

Run `node scripts/everyday-benchmark.mjs` for actual local source/gzip inventory and weight integrity. Add `--browser` while `npm start` is running to execute real MediaPipe CPU/WASM inference. The JSON report is `artifacts/everyday-benchmark.json`; it contains individual asset bytes/hashes and the browser user agent. Measurements below are from the November 10 implementation QA session (local Bangladesh date; report UTC can be November 9).

| Measurement                                                                                    |                        Observed |
| ---------------------------------------------------------------------------------------------- | ------------------------------: |
| All Everyday JS/CSS/HTML + shared speech module + avatar/favicon (before final small UI fixes) |                   454,412 bytes |
| Sum of per-file gzip sizes of those assets                                                     |                   275,395 bytes |
| Existing face weights                                                                          | 3,758,596 bytes; gzip 3,334,759 |
| Existing pose weights                                                                          | 5,777,746 bytes; gzip 4,971,496 |
| Existing SIMD WASM + loader                                                                    | 9,778,336 bytes; gzip 2,976,249 |
| Existing no-SIMD alternative + loader                                                          | 9,652,795 bytes; gzip 2,971,465 |
| Existing vision bundle                                                                         |      137,811 bytes; gzip 39,925 |

These are source/artifact sizes, not a native APK or an entire legacy-app install. Runtime chooses a WASM variant, not both. Model assets are lazy; the service worker precaches the small Everyday shell, not the large weights. The gzip sums are a calculation, not a claim about actual hosting transfer headers or Brotli. Rerun after source changes for exact current bytes. No new checkpoint or LLM pack was installed.

Real browser smoke benchmark: Headless Chrome 156 on Windows, 12 logical cores, browser-reported 16 GB memory hint, 640×480 synthetic camera feed. One model at a time, CPU delegate explicitly selected; 25 observations each, first five excluded from warm percentiles.

| Model     | One load measurement | Warm median | Warm p95 | Warm samples |
| --------- | -------------------: | ----------: | -------: | -----------: |
| Pose Lite |             372.7 ms |     34.9 ms |  38.6 ms |           20 |
| Face      |             191.3 ms |      8.1 ms |  13.4 ms |           20 |

Load includes local fetch, integrity check and model creation; this is not a repeated cold-load p50/p95. The synthetic camera may contain no detected person, so this is a runtime/fallback smoke benchmark, not representative human tracking performance or an accuracy result. It is not a low-end Android measurement. Unit tests additionally force GPU initialization failure and prove CPU fallback and corrupt-weight rejection.

Not measured: peak process/WASM RAM, realistic human end-to-end FPS/latency, phone battery and thermal behavior, low-light robustness, weighed-meal kcal/gram error, population gaze metrics, independent-reference angle error. No app-wide “25–60 MB” planning estimate is presented as a measured result. Inference scheduling targets at most 10 observations/s and adapts down when processing is slower; this is a scheduling limit, not a measured sustained FPS guarantee.

Initial **targets**, not achieved claims: usable manual/journal/AAC touch UI on 2 GB Android; ≤100 ms median camera observation processing where practical; pose p95 ≤150 ms; no simultaneous heavy models; bounded failure/permission states. Target-device profiling and held-out evaluation determine whether these targets are appropriate.

Candidate models have no installed size, hash, RAM or quality result yet; their exact checkpoint/input shape/precision/data licence must be recorded before benchmarking. INT8 distillation, TCN form classification, segmentation and Whisper are research work, not completed optimization.
