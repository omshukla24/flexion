// Pure camera math for Flexion: no DOM, no MediaPipe, so Node tests cover it. vision.js feeds it landmarks.

// [chain of landmark ids, degrees of flexion summed over its joints at a full curl]
export const FINGERS = {
  thumb: [[1, 2, 3, 4], 120],
  index: [[0, 5, 6, 7, 8], 260],
  middle: [[0, 9, 10, 11, 12], 260],
  ring: [[0, 13, 14, 15, 16], 260],
  little: [[0, 17, 18, 19, 20], 260],
};
export const BONES = [[0,1],[1,2],[2,3],[3,4],[0,5],[5,6],[6,7],[7,8],[5,9],[9,10],[10,11],[11,12],[9,13],[13,14],[14,15],[15,16],[13,17],[0,17],[17,18],[18,19],[19,20]];
export const GESTURES = { Closed_Fist: "Fist", Open_Palm: "Open", Pointing_Up: "Pointing", Thumb_Up: "Thumb up", Thumb_Down: "Thumb down", Victory: "Victory", ILoveYou: "I love you", None: "-" };
export const OPEN_BELOW = 25, FIST_ABOVE = 65; // mean finger curl % for the 3D open / fist call
export const GESTURE_TRUST = 0.6;              // below this score the trained gesture model defers to the 3D call
export const MIN_WIDTH = 0.45;      // knuckle width ÷ palm length; below it the hand is sideways and 2D ratios lie (run 1)
export const MIN_FIST_THUMB = 0.6;  // thumb tip → little knuckle ÷ palm; below it the thumb is tucked and the fingers can't close (runs 3–4)
export const GRIP_POINTS = [4, 8, 12, 16, 20, 9]; // fingertips + palm centre; 3+ inside an object box = holding it
export const CROP_SCALE = 2.2, MIN_CROP = 160;     // zoom pass: square 2.2× the hands' extent, never from less than 160 px
export const STABLE_FRAMES = 3;     // a pose must hold this many frames before the rep counter believes it (kills flicker)

const sub = (a, b) => [a.x - b.x, a.y - b.y, a.z - b.z];
const cross = (u, v) => [u[1] * v[2] - u[2] * v[1], u[2] * v[0] - u[0] * v[2], u[0] * v[1] - u[1] * v[0]];
const norm = (u) => Math.hypot(...u);
const angle = (u, v) => Math.acos(Math.max(-1, Math.min(1, (u[0] * v[0] + u[1] * v[1] + u[2] * v[2]) / (norm(u) * norm(v))))) * 180 / Math.PI;
const dist = (a, b) => Math.hypot(a[0] - b[0], a[1] - b[1]);

/** Flexion per finger as % of a full curl, from 3D world landmarks: the same whichever way the hand faces. */
export function curls(wl) {
  return Object.fromEntries(Object.entries(FINGERS).map(([f, [chain, full]]) => {
    let deg = 0;
    for (let i = 1; i < chain.length - 1; i++) deg += angle(sub(wl[chain[i]], wl[chain[i - 1]]), sub(wl[chain[i + 1]], wl[chain[i]]));
    return [f, Math.min(100, 100 * deg / full)];
  }));
}

/** Mean curl of the four fingers → "Open" | "Partial" | "Fist". */
export function call3d(c) {
  const mean4 = (c.index + c.middle + c.ring + c.little) / 4;
  return mean4 < OPEN_BELOW ? "Open" : mean4 > FIST_ABOVE ? "Fist" : "Partial";
}

/** How squarely the palm plane faces the camera (|z of the palm normal|). */
export function view(wl) {
  const n = cross(sub(wl[5], wl[0]), sub(wl[17], wl[0]));
  const r = Math.abs(n[2]) / norm(n);
  return r > 0.7 ? "flat to camera" : r > 0.35 ? "angled" : "side-on";
}

/** Final pose: any confident trained gesture wins; otherwise the 3D call. `g` is the model's top category or undefined. */
export function stateOf(g, call) {
  const name = GESTURES[g?.categoryName ?? g?.name];
  return g && g.score >= GESTURE_TRUST && name && name !== "-"
    ? { state: name, source: "gesture model" }
    : { state: call, source: "3D curl" };
}

/** 2D range-of-motion ratios from image points ([x, y] pixels), each ÷ palm length (wrist → middle knuckle). */
export function rom2d(p) {
  const palm = dist(p[0], p[9]);
  const r = (a, b) => dist(p[a], p[b]) / palm;
  const fingers = [r(8, 5), r(12, 9), r(16, 13), r(20, 17)];
  return { index: fingers[0], thumb: r(4, 17), width: r(5, 17), fist: fingers.reduce((s, x) => s + x, 0) / 4 };
}

/** Form problem that makes the 2D ROM numbers untrustworthy, or null. */
export function formIssue(rom, state) {
  if (rom.width < MIN_WIDTH) return "sideways";
  if (state === "Fist" && rom.thumb < MIN_FIST_THUMB) return "thumb-tucked";
  return null;
}

/** Intersection over union of two {x, y, w, h} boxes. */
export function iou(a, b) {
  const ix = Math.max(0, Math.min(a.x + a.w, b.x + b.w) - Math.max(a.x, b.x));
  const iy = Math.max(0, Math.min(a.y + a.h, b.y + b.h) - Math.max(a.y, b.y));
  return ix * iy / (a.w * a.h + b.w * b.h - ix * iy);
}

/** Highest score first; drops a lower-scored box of the same object overlapping a kept one (the zoom and full passes often both see it). */
export function merge(objects) {
  const sorted = [...objects].sort((a, b) => b.score - a.score);
  return sorted.filter((o, i) => !sorted.slice(0, i).some((p) => p.name === o.name && iou(p.b, o.b) > 0.3));
}

/** Square crop around every hand ([[x, y], …] per hand, unmirrored pixels) for the zoomed object pass; null when no hands. */
export function handRegion(handsPts, W, H) {
  if (!handsPts.length) return null;
  const xs = handsPts.flatMap((h) => h.map(([x]) => x)), ys = handsPts.flatMap((h) => h.map(([, y]) => y));
  const [x0, x1, y0, y1] = [Math.min(...xs), Math.max(...xs), Math.min(...ys), Math.max(...ys)];
  const s = Math.min(H, W, CROP_SCALE * Math.max(x1 - x0, y1 - y0, MIN_CROP));
  const clamp = (v, hi) => Math.max(0, Math.min(hi, v));
  return { x: clamp((x0 + x1 - s) / 2, W - s), y: clamp((y0 + y1 - s) / 2, H - s), s };
}

/** Name of the smallest object whose box (with a 25% margin) holds 2+ grip points of this hand, if any. */
// A held phone's box is thin: fingers wrap its edges and the palm sits behind it, so 3 points inside a 10% margin never happened.
// Smallest, not highest-scored: the person's box (and a bed or sofa) always surrounds the hand too, and outscores the phone.
export function holding(pts, objects) {
  const inside = ([x, y], b) => { const m = 0.25 * Math.max(b.w, b.h); return x > b.x - m && x < b.x + b.w + m && y > b.y - m && y < b.y + b.h + m; };
  return objects.filter((o) => GRIP_POINTS.filter((i) => inside(pts[i], o.box)).length >= 2)
    .sort((a, b) => a.box.w * a.box.h - b.box.w * b.box.h)[0]?.name;
}

export const REP_START = Object.freeze({ stable: null, candidate: null, count: 0, reps: 0, fromOpen: false });

/** Immutable rep reducer: a rep is a held Open → held Fist → held Open. Other states (Partial, gestures) are ignored. */
export function repCounter(s, handState) {
  if (handState !== "Open" && handState !== "Fist") return s;
  if (handState === s.stable) return s.candidate ? { ...s, candidate: null, count: 0 } : s;
  const count = handState === s.candidate ? s.count + 1 : 1;
  if (count < STABLE_FRAMES) return { ...s, candidate: handState, count };
  const isRep = s.stable === "Fist" && handState === "Open" && s.fromOpen;
  return { stable: handState, candidate: null, count: 0, reps: s.reps + (isRep ? 1 : 0), fromOpen: handState === "Fist" && s.stable === "Open" };
}

/** Canvas RGBA pixels → base64 of the plain RGB bytes, the crop format identify takes. */
export function rgbBase64(rgba) {
  let s = "";
  for (let i = 0; i < rgba.length; i += 4) s += String.fromCharCode(rgba[i], rgba[i + 1], rgba[i + 2]);
  return btoa(s);
}
