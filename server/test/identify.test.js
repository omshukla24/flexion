import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";
import { test } from "node:test";
import { fileURLToPath } from "node:url";
import { createIdentifier } from "../src/identify.js";

const crop = () => Buffer.alloc(224 * 224 * 3, 128).toString("base64");
// A two-label stand-in for SigLIP: the encoder's vector decides the ranking.
const labels = [{ label: "cup", e: [1, 0] }, { label: "pen", e: [0, 1] }];
const fakeLoad = (vector, seen = []) => async () => ({ labels, encode: async (t) => (seen.push(t), vector) });
const open = () => true;

test("names the object in a 224 px crop from the encoder's embedding", async () => {
  const seen = [];
  const identify = createIdentifier({ load: fakeLoad([1, 0.2], seen), allow: open });
  assert.deepEqual(await identify({ rgb: crop(), session: "s1" }), { label: "cup", confidence: "high" });
  assert.equal(seen[0].length, 3 * 224 * 224);
});

test("checks the object against the labels the task accepts", async () => {
  const identify = createIdentifier({ load: fakeLoad([1, 0.2]), allow: open });
  assert.equal((await identify({ rgb: crop(), expect: ["pen"], session: "s1" })).matchesExpect, false);
  assert.equal((await identify({ rgb: crop(), expect: ["cup", "mug"], session: "s1" })).matchesExpect, true);
});

test("a crop of the wrong size is refused without running the model or using up the limit", async () => {
  let ran = 0, asked = 0;
  const identify = createIdentifier({ load: async () => ({ labels, encode: async () => (ran++, [1, 0]) }), allow: () => (asked++, true) });
  assert.deepEqual(await identify({ rgb: Buffer.alloc(100).toString("base64"), session: "s1" }), { label: "unknown", confidence: "low", error: "bad_image" });
  assert.equal(ran + asked, 0);
});

test("by default allows one call per session every 2 s, and says rate_limited without running the model", async () => {
  const seen = [];
  const identify = createIdentifier({ load: fakeLoad([1, 0.2], seen) });
  assert.equal((await identify({ rgb: crop(), session: "a" })).label, "cup");
  assert.deepEqual(await identify({ rgb: crop(), session: "a" }), { label: "unknown", confidence: "low", error: "rate_limited" });
  assert.equal((await identify({ rgb: crop(), session: "b" })).label, "cup");
  assert.equal(seen.length, 2);
});

test("a model that fails to load gives unknown/low, the next call loads again, and a loaded model is kept", async () => {
  let loads = 0;
  const load = async () => {
    if (++loads === 1) throw new Error("NoSuchKey: models/siglip");
    return { labels, encode: async () => [0, 1] };
  };
  const identify = createIdentifier({ load, allow: open });
  assert.deepEqual(await identify({ rgb: crop(), session: "s1" }), { label: "unknown", confidence: "low", error: "unavailable" });
  assert.equal((await identify({ rgb: crop(), session: "s1" })).label, "pen");
  await identify({ rgb: crop(), session: "s1" });
  assert.equal(loads, 2);
});

// The real model on the private test photos (gitignored), so this runs only where they exist:
// FLEXION_SIGLIP_MODEL=<path to vision_model_quantized.onnx> npm test
const DIR = fileURLToPath(new URL("./fixtures/identify/", import.meta.url));
const EARBUDS = ["wireless earbuds", "earbuds charging case"];
const FIXTURES = {
  "IMG_20261022_105407": EARBUDS,
  "IMG_20261022_105417": ["computer mouse"],
  "IMG_20261022_105430": ["game controller"],
  "crop-earbuds": EARBUDS,
  "crop-controller": ["game controller"],
};
const ready = process.env.FLEXION_SIGLIP_MODEL && Object.keys(FIXTURES).every((n) => existsSync(`${DIR}${n}.rgb`));

test("real SigLIP: every fixture matches its object, none matches a cup, top-1 right on at least 4 of 5", { skip: !ready && "needs FLEXION_SIGLIP_MODEL and the private fixtures" }, async (t) => {
  const identify = createIdentifier({ allow: open });
  let right = 0;
  for (const [name, object] of Object.entries(FIXTURES)) {
    const rgb = readFileSync(`${DIR}${name}.rgb`).toString("base64");
    const t0 = performance.now();
    const r = await identify({ rgb, expect: object, session: "it" });
    t.diagnostic(`${name}: ${r.label} (${r.confidence}) ${(performance.now() - t0).toFixed(0)} ms`);
    assert.equal(r.matchesExpect, true, name);
    assert.equal((await identify({ rgb, expect: ["cup", "mug"], session: "it" })).matchesExpect, false, name);
    if (object.includes(r.label)) right++;
  }
  assert.ok(right >= 4, `top-1 right on ${right} of 5`);
});
