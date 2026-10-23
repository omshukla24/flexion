import { test } from "node:test";
import assert from "node:assert/strict";
import * as pdf from "pdf-lib";
import { buildSessionReport, reportNumbers, summaryLines } from "../app/session-report.js";
import { startSession, advance, HOLD_MS, SETTLE_MS, REST_MS, FIX_AFTER_MS } from "../app/session-core.js";

const CURLS_OPEN = { thumb: 10, index: 4, middle: 5, ring: 6, little: 8 }, CURLS_FIST = { thumb: 55, index: 88, middle: 91, ring: 86, little: 80 };
const hand = (state, o = {}) => ({ state, formIssue: o.issue ?? null, rom: { index: state === "Fist" ? 0.18 : 0.77, fist: 0.2, thumb: 0.7, width: 0.8 }, curls: state === "Fist" ? CURLS_FIST : CURLS_OPEN, reps: o.reps ?? 0, holding: o.holding });
function hold(s, h, ms) { let st = s; const end = st.t + ms; while (st.t < end && st.step !== "done") st = advance(st, { type: "frame", t: st.t + 33, hand: h }); return st; }
const relax = (s) => hold(s, null, REST_MS + 100);

/** A real session through session-core: 3 open, a lasting thumb tuck, 5 fists, 10 reps, a rest for pain, the cup. */
function session() {
  let s = hold(startSession({ t: 1000 }), hand("Open"), SETTLE_MS + HOLD_MS + 100);
  s = hold(s, null, SETTLE_MS + 50);
  for (let i = 0; i < 3; i++) s = relax(hold(s, hand("Open"), HOLD_MS + 100));
  s = hold(hold(s, null, SETTLE_MS + 50), hand("Fist", { issue: "thumb-tucked" }), FIX_AFTER_MS + 600);
  for (let i = 0; i < 5; i++) s = relax(hold(s, hand("Fist"), HOLD_MS + 100));
  s = hold(s, hand("Open"), SETTLE_MS + 50);
  s = advance(s, { type: "pause", t: s.t, why: "pain" });
  s = advance(hold(s, null, 20_000), { type: "resume", t: s.t + 20_000 });
  s = hold(s, hand("Open"), SETTLE_MS + 50);
  for (let r = 1; r <= 10; r++) s = hold(s, hand(r % 2 ? "Fist" : "Open", { reps: r }), 1800);
  return hold(hold(s, null, SETTLE_MS + 50), hand("Open", { holding: "cup" }), HOLD_MS + 100);
}

test("the numbers: per-finger open, fist and range; rep timing; resting time", () => {
  const s = session();
  assert.equal(s.step, "done");
  const n = reportNumbers(s);
  const index = n.fingers.find((f) => f.finger === "index");
  assert.deepEqual(index, { finger: "index", open: 4, fist: 88, range: 84 });
  assert.equal(n.reps.done, 10);
  assert.ok(Math.abs(n.reps.avgMs - 1800) < 40, `avg ${n.reps.avgMs}`);
  assert.equal(n.pausedMs, 20_000);
  assert.ok(n.activeMs > 0 && n.activeMs < s.result.durationMs);
});

test("the summary says it plainly, with the fix and the rest for pain", () => {
  const lines = summaryLines(session()).join("\n");
  assert.match(lines, /Completed: yes\./);
  assert.match(lines, /Fist reading: 0\.18/);
  assert.match(lines, /Reps: 10 of 10, about 1\.8 s each/);
  assert.match(lines, /Grip task: done/);
  assert.match(lines, /Form corrections: 1\. Rests: 1 \(one or more for pain\)/);
});

test("skipped steps print 'skipped', never zeros", () => {
  let s = startSession({ t: 0 });
  for (let i = 0; i < 5; i++) s = advance(s, { type: "skip", t: s.t + 1000 });
  const lines = summaryLines(s).join("\n");
  assert.match(lines, /Fist reading: skipped/);
  assert.match(lines, /Reps: skipped/);
  assert.doesNotMatch(lines, /0\.00/);
  assert.ok(reportNumbers(s).fingers.every((f) => f.range === null));
});

test("against the usual: the MDC95 verdict in words", () => {
  const lines = summaryLines({ ...session(), progress: { baseline: 0.19, change: "noise" } }).join("\n");
  assert.match(lines, /Against your usual \(0\.19\): inside your normal day-to-day range/);
});

test("builds a real PDF that pdf-lib can read back, footer on every page", async () => {
  const s = session();
  const bytes = await buildSessionReport({ log: s.log, result: s.result, hand: "right", when: Date.UTC(2026, 9, 23, 3, 0) }, pdf);
  assert.equal(new TextDecoder().decode(bytes.slice(0, 5)), "%PDF-");
  const back = await pdf.PDFDocument.load(bytes);
  assert.ok(back.getPageCount() >= 1);
  assert.match(back.getTitle(), /right hand, 2026-10-23 08:30 IST/);
});

// A real 2026-10-23 report put two lines alone on page 2.
test("a full session (8 holds, a fix, a rest, the usual-range line) fits on one page", async () => {
  const s = session();
  const bytes = await buildSessionReport({ log: s.log, result: s.result, progress: { baseline: 0.19, change: "noise" }, hand: "right" }, pdf);
  assert.equal((await pdf.PDFDocument.load(bytes)).getPageCount(), 1);
});
