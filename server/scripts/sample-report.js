// The site's downloadable sample report: an illustration week (Mon 12 – Sun 18 Oct 2026) built by the real buildReport.
// Its numbers match site/src/scenes/report-math.js SAMPLE; re-run after any change to src/report.js.
// Usage (from server/): node scripts/sample-report.js [out.pdf]   (default ../site/public/sample-report.pdf)
import { writeFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import { buildReport } from "../src/report.js";

const out = process.argv[2] ?? fileURLToPath(new URL("../../site/public/sample-report.pdf", import.meta.url));
const ist = (day, hh, mm = 0) => new Date(Date.UTC(2026, 9, day, hh, mm) - 330 * 60_000).toISOString(); // IST wall time → UTC
const s = (ts, o = {}) => ({ ts, hand: "right", completed: true, durationMs: 98_000, openIndex: 0.77, fistIndex: 0.18, fistThumb: 0.9, reps: 10, grip: "pass", fixes: 0, incomplete: [], pain: false, ...o });
const before = [[8, 0.18], [9, 0.19], [10, 0.18], [11, 0.17]].map(([d, f]) => s(ist(d, 8), { fistIndex: f }));
const week = [12, 13, 14, 15, 16, 17, 18].flatMap((d) => [
  s(ist(d, 8), { fistIndex: d >= 17 ? 0.3 : 0.18, fixes: d === 12 ? 2 : 0 }),
  s(ist(d, 19), { fistIndex: d >= 17 ? 0.31 : 0.19, ...(d === 14 && { pain: true, completed: false, reps: 4 }) }),
]);
const routine = { exercises: [{ id: "fist-open", name: "Fist and open", sets: 1, reps: 10, quote: "Make a gentle fist, then open wide, 10 times" }], limits: { maxReps: 12, painStop: true, other: [] }, sourceQuotes: ["sample sheet"] };
const bytes = await buildReport({ userId: "sample", hand: "right", from: Date.parse(ist(12, 0)), to: Date.parse(ist(18, 23, 59)), sessions: [...before, ...week], routine, mdc95: 0.063 });
await writeFile(out, bytes);
console.log(`wrote ${out} (${bytes.length} bytes)`);
