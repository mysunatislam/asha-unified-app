let face,
  hand,
  pose,
  busy = false,
  lastHand = 0,
  lastPose = 0,
  delegate = "GPU";
let handsPriority = false;
let role = "all";
self.onmessage = async ({ data: d }) => {
  if (d.type === "schedule") {
    handsPriority = !!d.handsPriority;
    return;
  }
  if (d.type === "init") {
    try {
      role = d.role || "all";
      const {
        FaceLandmarker,
        HandLandmarker,
        PoseLandmarker,
        FilesetResolver,
      } = await import("../neuroface/vendor/vision_bundle.mjs");
      const f = await FilesetResolver.forVisionTasks(
        new URL("../neuroface/vendor/wasm/", self.location.href).href,
      );
      const create = async (Type, model, options) => {
        // Hands and face must not serialize on the same GPU command queue.
        // The small hand model runs in WASM beside GPU face/pose inference.
        delegate = role === "hand" ? "CPU" : "GPU";
        const o = {
          runningMode: "VIDEO",
          canvas: new OffscreenCanvas(1, 1),
          baseOptions: {
            delegate,
            modelAssetPath: new URL(model, self.location.href).href,
          },
          ...options,
        };
        try {
          return await Type.createFromOptions(f, o);
        } catch {
          o.baseOptions.delegate = "CPU";
          delegate = "CPU";
          return Type.createFromOptions(f, o);
        }
      };
      if (role !== "hand")
        face = await create(
          FaceLandmarker,
          "../neuroface/models/face_landmarker.task",
          {
            numFaces: 1,
            outputFaceBlendshapes: true,
            outputFacialTransformationMatrixes: true,
            minFaceDetectionConfidence: 0.6,
            minTrackingConfidence: 0.6,
          },
        );
      if (role !== "face")
        hand = await create(
          HandLandmarker,
          "../neuroface/models/hand_landmarker.task",
          {
            numHands: 2,
            minHandDetectionConfidence: 0.55,
            minTrackingConfidence: 0.55,
          },
        );
      if (role !== "hand")
        pose = await create(
          PoseLandmarker,
          "../models/pose_landmarker_lite.task",
          {
            numPoses: 1,
            minPoseDetectionConfidence: 0.6,
            minTrackingConfidence: 0.6,
          },
        );
      self.postMessage({ type: "ready", delegate });
    } catch (e) {
      self.postMessage({
        type: "error",
        message: "Camera models could not load: " + e.message,
      });
    }
    return;
  }
  if (d.type === "frame") {
    if (busy || (role === "hand" ? !hand : !face)) {
      d.bitmap.close();
      return;
    }
    busy = true;
    const start = performance.now();
    try {
      const fr = face?.detectForVideo(d.bitmap, d.t) || null;
      let hr = null,
        pr = null;
      // Dedicated hands never wait for face/pose. "all" is the compatibility path.
      const handDue = (d.t - lastHand) / (handsPriority ? 1 : 250),
        poseDue = (d.t - lastPose) / 500;
      if (
        role === "hand" ||
        (hand &&
          handDue >= 1 &&
          (handsPriority ? poseDue < 1 : handDue >= poseDue))
      ) {
        hr = hand.detectForVideo(d.bitmap, d.t);
        lastHand = d.t;
      } else if (pose && poseDue >= 1) {
        pr = pose.detectForVideo(d.bitmap, d.t);
        lastPose = d.t;
      }
      self.postMessage({
        type: "result",
        t: d.t,
        face: fr,
        hand: hr,
        pose: pr,
        ms: performance.now() - start,
      });
    } catch (e) {
      self.postMessage({ type: "frameError", message: e.message });
    } finally {
      d.bitmap.close();
      busy = false;
    }
  }
};
