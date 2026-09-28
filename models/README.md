# Local inference assets

Face and hand models plus MediaPipe runtime are preserved under `neuroface/` from the supplied unified-web repository. Its `vendor/manifest.json` records versions and SHA-256 hashes.

The new pose model is Google's MediaPipe Pose Landmarker Lite, float16, version 1:
https://storage.googleapis.com/mediapipe-models/pose_landmarker/pose_landmarker_lite/float16/1/pose_landmarker_lite.task

The YOLO model is the ONNX Community export of Ultralytics YOLO26n-pose (FP32), downloaded 2026-09-27:
https://huggingface.co/onnx-community/yolo26n-pose-ONNX/blob/main/onnx/model.onnx

YOLO licensing: AGPL-3.0, see YOLO-LICENSE.txt and Ultralytics' licensing terms. An enterprise license may be needed for a proprietary commercial distribution. ONNX Runtime 1.22.0 is MIT licensed (app/ORT-LICENSE.txt).

This export returns `[1,300,57]`: normalized boxes, detection score, class, then 17 triplets. It normalizes all three keypoint components by 640. The decoder restores the confidence component by multiplying by 640; x/y are already normalized. The decoder has a regression test and a real-image inference test.

All inference stays in the browser. No raw camera images are sent to the cloud. Models are loaded on demand and cached by the service worker. YOLO is an optional worker-based cross-check because of its CPU cost on phones; MediaPipe pose stays active in all patient interfaces.
