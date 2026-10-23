import { test } from "node:test";
import assert from "node:assert/strict";
import {
  curls, call3d, view, stateOf, rom2d, formIssue, iou, merge, handRegion, holding, repCounter, REP_START, rgbBase64,
} from "../app/vision-core.js";

const DEG = Math.PI / 180;
const BONE = 0.03; // metres per finger bone in the synthetic hands

/** Finger points after `base`: each bone bends `angles[i]` degrees further toward the palm (-z) in the plane of `dir` and z. */
function finger(base, dir, angles) {
  const pts = [];
  let total = 0, p = base;
  for (const a of angles) {
    total += a * DEG;
    p = { x: p.x + BONE * dir.x * Math.cos(total), y: p.y + BONE * dir.y * Math.cos(total), z: p.z - BONE * Math.sin(total) };
    pts.push(p);
  }
  return pts;
}

/** 21 world landmarks with the palm flat in the x-y plane, fingers pointing -y, each finger bent by the given joint angles. */
function hand({ thumb = [0, 0, 0], index = [0, 0, 0], middle = [0, 0, 0], ring = [0, 0, 0], little = [0, 0, 0] } = {}) {
  const wrist = { x: 0, y: 0, z: 0 };
  const up = (x) => { const l = Math.hypot(x, -0.09); return { x: x / l, y: -0.09 / l }; };
  const mcp = (x) => ({ x, y: -0.09, z: 0 });
  const cmc = { x: 0.03, y: -0.02, z: 0 };
  // thumb chain 1 → 2 → 3 → 4: point 2 sits on the CMC direction, then the MCP and IP angles bend it
  const tDir = { x: 0.6, y: -0.8 };
  const t2 = { x: cmc.x + BONE * tDir.x, y: cmc.y + BONE * tDir.y, z: 0 };
  return [wrist, cmc, t2, ...finger(t2, tDir, thumb.slice(0, 2)),
    mcp(0.03), ...finger(mcp(0.03), up(0.03), index),
    mcp(0.01), ...finger(mcp(0.01), up(0.01), middle),
    mcp(-0.01), ...finger(mcp(-0.01), up(-0.01), ring),
    mcp(-0.03), ...finger(mcp(-0.03), up(-0.03), little)];
}

test("curls: a straight hand reads near 0% on every finger", () => {
  const c = curls(hand());
  for (const f of ["thumb", "index", "middle", "ring", "little"]) assert.ok(c[f] < 3, `${f} = ${c[f]}`);
});

test("curls: joint angles add up to the right share of a full curl", () => {
  const c = curls(hand({ index: [45, 50, 35], middle: [90, 100, 70], thumb: [30, 30] }));
  assert.ok(Math.abs(c.index - 50) < 1, `index ${c.index}`);
  assert.ok(Math.abs(c.middle - 100) < 1, `middle ${c.middle}`);
  assert.ok(Math.abs(c.thumb - 50) < 1, `thumb ${c.thumb}`);
});

test("curls: caps at 100% when joints bend past a tight fist", () => {
  assert.equal(curls(hand({ ring: [100, 110, 90] })).ring, 100);
});

test("call3d: open, partial and fist by mean finger curl", () => {
  assert.equal(call3d({ index: 10, middle: 10, ring: 10, little: 10 }), "Open");
  assert.equal(call3d({ index: 40, middle: 50, ring: 45, little: 45 }), "Partial");
  assert.equal(call3d({ index: 80, middle: 90, ring: 85, little: 80 }), "Fist");
});

test("view: palm plane facing the camera, tilted, and edge-on", () => {
  const pts = (p5, p17) => { const a = Array(21).fill({ x: 0, y: 0, z: 0 }); return a.map((p, i) => (i === 5 ? p5 : i === 17 ? p17 : p)); };
  assert.equal(view(pts({ x: 0.03, y: -0.09, z: 0 }, { x: -0.03, y: -0.09, z: 0 })), "flat to camera");
  const tilt = 60 * DEG; // palm turned 60° about the vertical axis: |n.z| = cos 60° = 0.5
  assert.equal(view(pts({ x: 0.03 * Math.cos(tilt), y: -0.09, z: 0.03 * Math.sin(tilt) }, { x: -0.03 * Math.cos(tilt), y: -0.09, z: -0.03 * Math.sin(tilt) })), "angled");
  assert.equal(view(pts({ x: 0, y: -0.09, z: 0.03 }, { x: 0, y: -0.09, z: -0.03 })), "side-on");
});

test("stateOf: a confident gesture wins, including thumb up", () => {
  const s = stateOf({ name: "Thumb_Up", score: 0.73 }, "Fist");
  assert.deepEqual(s, { state: "Thumb up", source: "gesture model" });
});

test("stateOf: an unsure or 'None' gesture defers to the 3D call", () => {
  assert.deepEqual(stateOf({ name: "Closed_Fist", score: 0.4 }, "Partial"), { state: "Partial", source: "3D curl" });
  assert.deepEqual(stateOf({ name: "None", score: 0.95 }, "Fist"), { state: "Fist", source: "3D curl" });
  assert.deepEqual(stateOf(undefined, "Open"), { state: "Open", source: "3D curl" });
});

test("rom2d: ratios are distances divided by palm length (wrist → middle knuckle)", () => {
  const pts = Array(21).fill([0, 0]);
  const p = pts.map((q, i) => ({ 0: [0, 0], 9: [0, -100], 5: [30, -95], 8: [30, -175], 17: [-30, -90], 4: [50, -60] })[i] ?? [0, -100]);
  const r = rom2d(p);
  assert.ok(Math.abs(r.index - 0.8) < 1e-9);
  assert.ok(Math.abs(r.width - Math.hypot(60, 5) / 100) < 1e-9);
  assert.ok(Math.abs(r.thumb - Math.hypot(80, 30) / 100) < 1e-9);
});

test("formIssue: sideways hand, tucked thumb in a fist, or none", () => {
  assert.equal(formIssue({ width: 0.3, thumb: 0.7 }, "Fist"), "sideways");
  assert.equal(formIssue({ width: 0.9, thumb: 0.5 }, "Fist"), "thumb-tucked");
  assert.equal(formIssue({ width: 0.9, thumb: 0.5 }, "Open"), null, "a tucked thumb only matters in a fist");
  assert.equal(formIssue({ width: 0.45, thumb: 0.6 }, "Fist"), null, "thresholds are inclusive");
});

test("iou: identical boxes 1, disjoint 0, half overlap 1/3", () => {
  const a = { x: 0, y: 0, w: 10, h: 10 };
  assert.equal(iou(a, a), 1);
  assert.equal(iou(a, { x: 20, y: 0, w: 10, h: 10 }), 0);
  assert.ok(Math.abs(iou(a, { x: 5, y: 0, w: 10, h: 10 }) - 1 / 3) < 1e-9);
});

test("merge: keeps the best of overlapping same-name boxes, keeps other names, does not mutate", () => {
  const input = [
    { name: "cup", score: 0.5, b: { x: 0, y: 0, w: 10, h: 10 } },
    { name: "cup", score: 0.8, b: { x: 1, y: 1, w: 10, h: 10 } },
    { name: "book", score: 0.6, b: { x: 0, y: 0, w: 10, h: 10 } },
  ];
  const copy = structuredClone(input);
  const out = merge(input);
  assert.deepEqual(out.map((o) => [o.name, o.score]), [["cup", 0.8], ["book", 0.6]]);
  assert.deepEqual(input, copy);
});

test("handRegion: square around the hand, 2.2× its size, centred", () => {
  const hand1 = [[600, 300], [800, 300], [700, 500]]; // 200 × 200 extent, centre (700, 400)
  const r = handRegion([hand1], 1280, 720);
  assert.deepEqual([r.x, r.y, r.s].map(Math.round), [480, 180, 440]);
});

test("handRegion: clamps at the frame edge, caps at the short side, floors tiny hands, null with no hands", () => {
  assert.deepEqual(handRegion([[[0, 0], [100, 100]]], 1280, 720), { x: 0, y: 0, s: 352 }); // 160 px floor × 2.2
  assert.equal(handRegion([[[0, 0], [1000, 700]]], 1280, 720).s, 720);
  assert.equal(handRegion([[[640, 360], [650, 370]]], 1280, 720).s, 352);
  assert.equal(handRegion([], 1280, 720), null);
});

test("holding: 2+ grip points inside an object box (25% margin) name the object", () => {
  const pts = Array(21).fill([500, 500]);
  const objects = [{ name: "bottle", box: { x: 480, y: 480, w: 40, h: 40 } }, { name: "book", box: { x: 0, y: 0, w: 10, h: 10 } }];
  assert.equal(holding(pts, objects), "bottle");
  assert.equal(holding(pts, [objects[1]]), undefined);
});

test("holding: a thin phone held upright counts with only the thumb on it and a fingertip at its edge", () => {
  const phone = { name: "cell phone", box: { x: 600, y: 300, w: 60, h: 120 } };
  const pts = Array(21).fill([900, 900]);
  pts[4] = [630, 360];  // thumb tip on the screen
  pts[8] = [685, 330];  // index tip wrapped round the far edge
  pts[12] = [700, 370]; pts[16] = [705, 400]; pts[20] = [700, 430]; pts[9] = [740, 400]; // the rest of the hand behind and beside it
  assert.equal(holding(pts, [phone]), "cell phone");
  pts[8] = [700, 330]; // one point alone is not a grip
  assert.equal(holding(pts, [phone]), undefined);
});

const run = (states) => states.reduce((s, x) => repCounter(s, x), REP_START);

test("repCounter: open → fist → open counts one rep", () => {
  assert.equal(run(["Open", "Open", "Open", "Fist", "Fist", "Fist", "Open", "Open", "Open"]).reps, 1);
});

test("repCounter: a one-frame flicker does not count", () => {
  assert.equal(run(["Open", "Open", "Open", "Fist", "Open", "Open", "Open"]).reps, 0);
});

test("repCounter: starting in a fist and opening is not a rep", () => {
  assert.equal(run(["Fist", "Fist", "Fist", "Open", "Open", "Open"]).reps, 0);
});

test("repCounter: partial and other gestures in between are ignored", () => {
  const seq = ["Open", "Open", "Open", "Partial", "Fist", "Fist", "Fist", "Thumb up", "Open", "Open", "Open"];
  assert.equal(run(seq).reps, 1);
});

test("repCounter: never mutates the previous state", () => {
  const s0 = run(["Open", "Open", "Open"]);
  const frozen = structuredClone(s0);
  repCounter(s0, "Fist");
  assert.deepEqual(s0, frozen);
});

test("rgbBase64 drops the alpha channel of canvas pixels and base64s the RGB bytes (identify's crop format)", () => {
  const b64 = rgbBase64(Uint8ClampedArray.from([1, 2, 3, 255, 4, 5, 6, 0]));
  assert.deepEqual([...Buffer.from(b64, "base64")], [1, 2, 3, 4, 5, 6]);
});
