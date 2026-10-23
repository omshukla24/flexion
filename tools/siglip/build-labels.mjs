// SigLIP text embeddings for every object in the list, so the server only runs the image half of the model.
// Re-run after editing labels.txt: npm install && npm run labels  (HF_CACHE: where the model files go; default ./.cache)
// Usage: node build-labels.mjs <labels.txt> <out.json>
import { AutoTokenizer, SiglipTextModel, env } from "@huggingface/transformers";
import { readFileSync, writeFileSync } from "node:fs";

const MODEL = "Xenova/siglip-base-patch16-224";
const TEMPLATE = "This is a photo of {}."; // the prompt the 2026-10-22 test used
const [labelsPath, outPath] = process.argv.slice(2);
if (!labelsPath || !outPath) throw new Error("usage: node build-labels.mjs <labels.txt> <out.json>");
if (process.env.HF_CACHE) env.cacheDir = process.env.HF_CACHE;

const labels = [...new Set(readFileSync(labelsPath, "utf8").split("\n").map((s) => s.trim()).filter(Boolean))];
const tokenizer = await AutoTokenizer.from_pretrained(MODEL);
const model = await SiglipTextModel.from_pretrained(MODEL, { dtype: "q8" });
// SigLIP was trained on text padded to max_length (64); shorter padding changes the embeddings.
const inputs = tokenizer(labels.map((l) => TEMPLATE.replace("{}", l)), { padding: "max_length", truncation: true });
const { pooler_output: out } = await model(inputs);
const dim = out.dims[1];
const rows = labels.map((label, i) => {
  const v = out.data.slice(i * dim, (i + 1) * dim), n = Math.hypot(...v);
  return { label, e: Array.from(v, (x) => Math.round((x / n) * 1e4) / 1e4) }; // 4 decimals: cosine error ~3e-5, far below label gaps
});
writeFileSync(outPath, JSON.stringify({ model: MODEL, file: "onnx/vision_model_quantized.onnx", template: TEMPLATE, size: 224, dim, labels: rows }));
console.log(`${rows.length} labels × ${dim} → ${outPath}`);
