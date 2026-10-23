// The site's sample one-check report (the sheet beside the weekly page in the Report section): one illustration session
// run through the real session-core and buildSessionReport, with small hold-to-hold variation like a real camera gives.
// Usage (from server/): node scripts/sample-session.js [out.pdf]   (default ../site/public/sample-session.pdf)
// Then the picture: pdftoppm -png -r 110 -singlefile <pdf> x && ffmpeg -i x.png -q:v 82 ../site/public/sample-session.webp
import { writeFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import * as pdf from "pdf-lib";
import { startSession, advance, HOLD_MS, SETTLE_MS, REST_MS, FIX_AFTER_MS } from "../app/session-core.js";
import { buildSessionReport } from "../app/session-report.js";

const out = process.argv[2] ?? fileURLToPath(new URL("../../site/public/sample-session.pdf", import.meta.url));
const wobble = (i, k) => ((i * 7 + k * 3) % 5) - 2; // a deterministic ±2 so no two holds read the same
const curls = (fist, i) => Object.fromEntries(["thumb", "index", "middle", "ring", "little"].map((f, k) =>
  [f, (fist ? [58, 87, 96, 93, 84] : [14, 27, 22, 20, 23])[k] + wobble(i, k)]));
let n = 0;
const hand = (state, o = {}) => {
  const i = n++, fist = state === "Fist";
  return { state, formIssue: o.issue ?? null, curls: curls(fist, i), reps: o.reps ?? 0, holding: o.holding,
    rom: { index: (fist ? 0.16 : 0.79) + wobble(i, 1) / 100, fist: (fist ? 0.19 : 0.79) + wobble(i, 2) / 100, thumb: fist ? 1.02 : 1.3, width: fist ? 0.84 : 0.67 } };
};
const hold = (s, h, ms) => { let st = s; const end = st.t + ms; while (st.t < end && st.step !== "done") st = advance(st, { type: "frame", t: st.t + 33, hand: h }); return st; };
const relax = (s) => hold(s, null, REST_MS + 400);

let s = hold(startSession({ t: 0 }), hand("Open"), SETTLE_MS + HOLD_MS + 900);
s = hold(s, null, SETTLE_MS + 300);
for (let i = 0; i < 3; i++) s = relax(hold(s, hand("Open"), HOLD_MS + 700));
s = hold(hold(s, null, SETTLE_MS + 300), hand("Fist", { issue: "thumb-tucked" }), FIX_AFTER_MS + 1400);
for (let i = 0; i < 5; i++) s = relax(hold(s, hand("Fist"), HOLD_MS + 600));
s = hold(s, hand("Open"), SETTLE_MS + 300);
for (let r = 1; r <= 10; r++) s = hold(s, hand(r % 2 ? "Fist" : "Open", { reps: r }), 2100 + (r % 3) * 250);
s = hold(hold(s, null, SETTLE_MS + 600), hand("Partial", { holding: "cell phone" }), HOLD_MS + 1800);

const when = Date.UTC(2026, 9, 19, 2, 40); // Mon 19 Oct 2026, 08:10 IST
const bytes = await buildSessionReport({ log: s.log, result: s.result, progress: { baseline: 0.18, change: "noise" }, hand: "right", when }, pdf);
await writeFile(out, bytes);
console.log(`wrote ${out} (${bytes.length} bytes, step ${s.step})`);
