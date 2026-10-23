import assert from "node:assert/strict";
import { test } from "node:test";
import { NEAR, pixelsToTensor, rank, verdict } from "../src/identify-core.js";

test("pixelsToTensor turns RGB bytes into channel planes scaled to -1…1", () => {
  // 2×2 image: red, green, blue, white
  const rgb = Uint8Array.from([255, 0, 0, 0, 255, 0, 0, 0, 255, 255, 255, 255]);
  assert.deepEqual([...pixelsToTensor(rgb, 2)], [1, -1, -1, 1, -1, 1, -1, 1, -1, -1, 1, 1]);
});

test("pixelsToTensor maps mid-grey to zero", () => {
  const t = pixelsToTensor(Uint8Array.from([127.5, 127.5, 127.5].map(Math.round)), 1);
  assert.ok(t.every((v) => Math.abs(v) < 0.005));
});

test("pixelsToTensor refuses a buffer of the wrong size", () => {
  assert.throws(() => pixelsToTensor(new Uint8Array(11), 2), /12 bytes/);
});

test("rank sorts labels by cosine similarity, highest first", () => {
  const labels = [{ label: "cup", e: [1, 0] }, { label: "pen", e: [0, 1] }];
  const out = rank([0.2, 3], labels);
  assert.deepEqual(out.map((r) => r.label), ["pen", "cup"]);
  assert.ok(Math.abs(out[0].score - 3 / Math.hypot(0.2, 3)) < 1e-9);
});

test("rank does not depend on the length of the image embedding", () => {
  const labels = [{ label: "cup", e: [1, 0] }, { label: "pen", e: [0, 1] }];
  const [a, b] = [rank([10, 1], labels), rank([1, 0.1], labels)];
  assert.deepEqual(a.map((r) => r.label), b.map((r) => r.label));
  a.forEach((r, i) => assert.ok(Math.abs(r.score - b[i].score) < 1e-12));
});

// Scores as SigLIP gives them: cosine, close together, the runner-up often a look-alike (earbuds vs their case).
const ranked = (...pairs) => pairs.map(([label, score]) => ({ label, score }));

test("verdict names the top label, confident when it leads the runner-up clearly", () => {
  assert.deepEqual(verdict(ranked(["earbuds charging case", 0.1007], ["wireless earbuds", 0.09], ["VR headset", 0.0575])), { label: "earbuds charging case", confidence: "high" });
});

test("verdict is medium on a small lead and low on a near-tie", () => {
  assert.equal(verdict(ranked(["game controller", 0.0996], ["joystick", 0.0963])).confidence, "medium");
  assert.equal(verdict(ranked(["wireless earbuds", 0.1003], ["earbuds charging case", 0.0996])).confidence, "low");
});

test("verdict matches an expected object that is a near-tie look-alike of the top label", () => {
  const r = ranked(["mouse pad", 0.0916], ["computer mouse", 0.0878], ["VR headset", 0.0476]);
  assert.equal(verdict(r, ["computer mouse"]).matchesExpect, true);
});

test("verdict matches a look-alike 0.011 behind (the earbuds photo with only \"wireless earbuds\" expected)", () => {
  const r = ranked(["earbuds charging case", 0.1007], ["wireless earbuds", 0.09], ["VR headset", 0.0575]);
  assert.equal(verdict(r, ["wireless earbuds"]).matchesExpect, true);
});

test("verdict does not match an expected object far below the top label", () => {
  const r = ranked(["game controller", 0.0996], ["joystick", 0.0963], ["TV remote control", 0.0661]);
  assert.equal(verdict(r, ["TV remote control", "cup"]).matchesExpect, false);
  assert.ok(0.0996 - 0.0661 > NEAR);
});

test("verdict leaves matchesExpect out when nothing was expected", () => {
  assert.equal("matchesExpect" in verdict(ranked(["cup", 0.1], ["mug", 0.09])), false);
});
