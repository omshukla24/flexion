// MediaPipe wiring for Flexion: camera frames in, per-frame hand + object results out. All the math lives in vision-core.js.
import { FilesetResolver, GestureRecognizer, ObjectDetector } from "https://cdn.jsdelivr.net/npm/@mediapipe/tasks-vision@0.10.14/vision_bundle.mjs";
import { curls, call3d, view, stateOf, rom2d, formIssue, merge, handRegion, holding, repCounter, REP_START, GESTURES, rgbBase64 } from "./vision-core.js";

const MP = "https://cdn.jsdelivr.net/npm/@mediapipe/tasks-vision@0.10.14";
const GESTURE_MODEL = "https://storage.googleapis.com/mediapipe-models/gesture_recognizer/gesture_recognizer/float16/1/gesture_recognizer.task";
// Lite2 (448 px input) over Lite0 (320 px): Lite0 found a held phone ~1% of the time and never a book (2026-10-20).
const OBJECT_MODEL = "https://storage.googleapis.com/mediapipe-models/object_detector/efficientdet_lite2/float16/1/efficientdet_lite2.tflite";
const OBJECT_EVERY = 3; // the object model is heavier: every 3rd camera frame (~10 fps)
const CROP_PX = 448;    // zoom pass fed at the object model's input size
const SNAP_PX = 224;    // identify crops: SigLIP's input size, sent as plain RGB

/**
 * Camera → `onFrame({ t, fps, hands, objects, timing })` once per real camera frame.
 * Points and boxes are in unmirrored video pixels; mirroring for a selfie view is the caller's job.
 */
export async function createVision({ video, onFrame, maxHands = 4, objectsOn = true }) {
  const fileset = await FilesetResolver.forVisionTasks(`${MP}/wasm`);
  const gestures = await GestureRecognizer.createFromOptions(fileset, { baseOptions: { modelAssetPath: GESTURE_MODEL, delegate: "GPU" }, runningMode: "VIDEO", numHands: maxHands });
  const makeObjects = (delegate) => ObjectDetector.createFromOptions(fileset, { baseOptions: { modelAssetPath: OBJECT_MODEL, delegate }, runningMode: "VIDEO", scoreThreshold: 0.3, maxResults: 10 });
  const objects = objectsOn ? await makeObjects("GPU").catch(() => makeObjects("CPU")) : null;
  const crop = Object.assign(document.createElement("canvas"), { width: CROP_PX, height: CROP_PX });
  const cropCtx = crop.getContext("2d");
  let running = false, frame = 0, objPass = 0, fullObjs = [], handObjs = [], objs = [], hands = [], objectsMs = 0;
  let frames = 0, fps = 0, fpsT = performance.now();
  const reps = {}; // rep reducer state per hand side (the reducer itself is immutable)

  const detect = (src, t, ox, oy, k) => objects.detectForVideo(src, t).detections.map((d) => ({
    name: d.categories[0].categoryName, score: d.categories[0].score,
    b: { x: ox + d.boundingBox.originX * k, y: oy + d.boundingBox.originY * k, w: d.boundingBox.width * k, h: d.boundingBox.height * k },
  }));

  // Alternates a full-frame pass with a zoomed pass around the hands, so a held object gets ~4× the pixels.
  function runObjects(t) {
    const t0 = performance.now();
    const r = ++objPass % 2 ? handRegion(hands.map((h) => h.pts), video.videoWidth, video.videoHeight) : null;
    if (r) {
      cropCtx.drawImage(video, r.x, r.y, r.s, r.s, 0, 0, CROP_PX, CROP_PX);
      handObjs = detect(crop, t, r.x, r.y, r.s / CROP_PX);
    } else {
      fullObjs = detect(video, t, 0, 0, 1);
      if (!hands.length) handObjs = [];
    }
    objs = merge([...handObjs, ...fullObjs]).map((o) => ({ name: o.name, score: o.score, box: o.b }));
    objectsMs = performance.now() - t0;
  }

  function analyse(res) {
    const W = video.videoWidth, H = video.videoHeight;
    return res.landmarks.map((lm, i) => {
      const pts = lm.map((l) => [l.x * W, l.y * H]);
      const c = curls(res.worldLandmarks[i]);
      const call = call3d(c);
      const g = res.gestures[i]?.[0];
      const { state, source } = stateOf(g, call);
      const side = res.handedness[i]?.[0]?.categoryName ?? "?";
      const rom = rom2d(pts);
      reps[side] = repCounter(reps[side] ?? REP_START, state);
      return {
        side, pts, curls: c, mean4: (c.index + c.middle + c.ring + c.little) / 4, call3d: call,
        gesture: { name: GESTURES[g?.categoryName] ?? "-", score: g?.score ?? 0 }, state, source,
        view: view(res.worldLandmarks[i]), holding: holding(pts, objs), rom, formIssue: formIssue(rom, state), reps: reps[side].reps,
      };
    });
  }

  function loop() {
    if (!running) return;
    const t = performance.now();
    if (objects && ++frame % OBJECT_EVERY === 0) runObjects(t);
    const t0 = performance.now();
    const res = gestures.recognizeForVideo(video, t0 + 0.01); // own timestamp stream, strictly increasing
    const handsMs = performance.now() - t0;
    hands = analyse(res);
    frames++;
    if (t - fpsT > 1000) { fps = frames * 1000 / (t - fpsT); frames = 0; fpsT = t; }
    onFrame({ t, fps, hands, objects: objs, timing: { handsMs, objectsMs } });
    video.requestVideoFrameCallback(loop); // once per real camera frame, not per monitor refresh
  }

  return {
    async start() {
      if (!video.srcObject) video.srcObject = await navigator.mediaDevices.getUserMedia({ video: { width: 1280, height: 720 } });
      await video.play();
      running = true;
      video.requestVideoFrameCallback(loop);
    },
    stop() {
      running = false;
      video.srcObject?.getTracks().forEach((tr) => tr.stop());
      video.srcObject = null;
    },
    resetReps() { for (const k of Object.keys(reps)) delete reps[k]; },
    /** Base64 RGB of the 224 px square around hand `i` (identify's input), or null when that hand isn't in view. */
    snapshotHand(i = 0) {
      const r = hands[i] && handRegion([hands[i].pts], video.videoWidth, video.videoHeight);
      if (!r) return null;
      const g = Object.assign(document.createElement("canvas"), { width: SNAP_PX, height: SNAP_PX }).getContext("2d");
      g.imageSmoothingQuality = "high"; // SigLIP's answer shifts with how the crop is shrunk; smoother is closer to its own resize
      g.drawImage(video, r.x, r.y, r.s, r.s, 0, 0, SNAP_PX, SNAP_PX);
      return rgbBase64(g.getImageData(0, 0, SNAP_PX, SNAP_PX).data);
    },
  };
}
