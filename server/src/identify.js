// identify: names the object in the hand from a 224 px crop, with SigLIP's image encoder on onnxruntime
// against the label embeddings in identify-labels.json. Used by the app-only identify_object tool and POST /api/identify.
import { readFile } from "node:fs/promises";
import { z } from "zod";
import { pixelsToTensor, rank, verdict } from "./identify-core.js";
import { rateLimit } from "./limit.js";

const SIZE = 224;
export const MODEL_KEY = "models/siglip-vision-q8.onnx"; // in the data bucket; deploy.mjs uploads it

export const IdentifyInput = z.object({
  rgb: z.string().max(210_000).describe("The hand crop: 224×224 RGB bytes, row-major, base64"),
  expect: z.array(z.string().max(64)).max(10).optional().describe("Labels the task accepts, e.g. cup and mug"),
  session: z.string().min(1).max(64).describe("The coach session's id, for the rate limit"),
});

/** The model file: FLEXION_SIGLIP_MODEL (a local path) or the data bucket's copy (bytes; onnxruntime takes either). */
async function modelSource({ local = process.env.FLEXION_SIGLIP_MODEL, bucket = process.env.FLEXION_BUCKET } = {}) {
  if (local) return local;
  if (!bucket) throw new Error("identify needs FLEXION_SIGLIP_MODEL or FLEXION_BUCKET");
  const { GetObjectCommand, S3Client } = await import("@aws-sdk/client-s3");
  return (await new S3Client({}).send(new GetObjectCommand({ Bucket: bucket, Key: MODEL_KEY }))).Body.transformToByteArray();
}

/** The encoder (crop tensor → image embedding) and the labels. onnxruntime loads lazily, so other routes don't pay for it. */
async function loadModel() {
  const [ort, source, labels] = await Promise.all([
    import("onnxruntime-node"),
    modelSource(),
    readFile(new URL("./identify-labels.json", import.meta.url), "utf8").then((t) => JSON.parse(t).labels),
  ]);
  const session = await ort.InferenceSession.create(source);
  const encode = async (tensor) => (await session.run({ pixel_values: new ort.Tensor("float32", tensor, [1, 3, SIZE, SIZE]) })).pooler_output.data;
  return { encode, labels };
}

const failed = (error) => ({ label: "unknown", confidence: "low", error });

/** `identify({ rgb, expect?, session })` → `{ label, confidence, matchesExpect? }`, or `{ label: "unknown", confidence: "low", error }`. */
export function createIdentifier({ load = loadModel, allow = rateLimit({ gapMs: 2000, perMinute: 60, perKey: 60 }) } = {}) {
  let model; // the load promise: kept once it works, dropped on failure so the next call tries again
  return async ({ rgb, expect, session }) => {
    const bytes = Buffer.from(rgb, "base64");
    if (bytes.length !== SIZE * SIZE * 3) return failed("bad_image");
    if (!allow(session)) return failed("rate_limited");
    try {
      model ??= load().catch((e) => {
        model = undefined;
        throw e;
      });
      const { encode, labels } = await model;
      const ranked = rank(await encode(pixelsToTensor(bytes, SIZE)), labels);
      console.log(`[identify] ${ranked.slice(0, 3).map((r) => `${r.label} ${r.score.toFixed(4)}`).join(" | ")}`); // labels and scores only, never the image
      return verdict(ranked, expect);
    } catch (e) {
      console.error("[identify]", e); // the detail stays in the log; the coach says it can't check right now
      return failed("unavailable");
    }
  };
}
