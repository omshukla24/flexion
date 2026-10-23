// identify, the pure parts: a hand crop's RGB bytes → SigLIP's input tensor, and labels ranked against the image embedding.
// identify.js runs the model; the label embeddings come from tools/siglip/build-labels.mjs.

/** RGB bytes (row-major, size×size×3) → Float32 CHW planes, each value (v/255 − 0.5)/0.5 as SigLIP's processor does. */
export function pixelsToTensor(rgb, size) {
  const n = size * size;
  if (rgb.length !== n * 3) throw new Error(`expected ${n * 3} bytes for a ${size}×${size} RGB crop, got ${rgb.length}`);
  const out = new Float32Array(n * 3);
  for (let i = 0; i < n; i++) for (let c = 0; c < 3; c++) out[c * n + i] = rgb[i * 3 + c] / 127.5 - 1;
  return out;
}

const norm = (v) => Math.hypot(...v);

/** Labels `[{ label, e }]` (e: unit-length text embeddings) by cosine similarity to `embedding`, highest first. */
export function rank(embedding, labels) {
  const len = norm(embedding);
  return labels
    .map(({ label, e }) => ({ label, score: e.reduce((s, x, i) => s + x * embedding[i], 0) / len }))
    .sort((a, b) => b.score - a.score);
}

// Calibrated on 5 private test photos (2026-10-22): the top label led the runner-up by 0.0007–0.0106, and the runner-up was
// usually a look-alike (earbuds vs their case, mouse pad vs mouse); wrong objects sat ≥ 0.027 below the top. Scores also
// shift a little between CPUs (Lambda's linux build missed a 0.0038 look-alike that matched on the PC), hence the slack.
export const NEAR = 0.012; // labels this close to the top score count as the same guess when checking `expect`
const HIGH = 0.008, MEDIUM = 0.003;

/** Ranked labels → `{ label, confidence }`, plus `matchesExpect` when the task named the objects it accepts. */
export function verdict(ranked, expect) {
  const [top, next] = ranked;
  const lead = top.score - (next?.score ?? -1);
  const out = { label: top.label, confidence: lead >= HIGH ? "high" : lead >= MEDIUM ? "medium" : "low" };
  if (expect) out.matchesExpect = ranked.some((r) => top.score - r.score <= NEAR && expect.includes(r.label));
  return out;
}
