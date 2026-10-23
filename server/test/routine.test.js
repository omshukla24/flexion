import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { Routine, nextTargets, flareCheck, progressOf } from "../src/routine.js";

const sample = JSON.parse(readFileSync(new URL("./fixtures/routine-sample.json", import.meta.url), "utf8"));
const NOW = Date.parse("2026-10-21T03:00:00Z"); // 08:30 IST
const daysAgo = (d, h = 0) => new Date(NOW - (d * 24 + h) * 3600_000).toISOString();
const session = (d, { reps = 10, completed = true, pain = false, fistIndex = 0.18 } = {}) =>
  ({ ts: daysAgo(d), completed, pain, fistIndex, targets: { "fist-open": { reps, holdSec: undefined } } });
const targetOf = (t, id) => t.exercises.find((e) => e.id === id);

test("Routine schema accepts the sample sheet and rejects an exercise without its sheet quote", () => {
  assert.ok(Routine.safeParse(sample).success);
  const noQuote = structuredClone(sample);
  delete noQuote.exercises[0].quote;
  assert.equal(Routine.safeParse(noQuote).success, false);
});

test("no history: today's targets are exactly the sheet", () => {
  const t = nextTargets(sample, [], NOW);
  assert.equal(targetOf(t, "fist-open").reps, 10);
  assert.equal(targetOf(t, "tendon-glide").holdSec, 5);
  assert.equal(t.progressed, false);
});

test("progresses at most 10% after 3 clean sessions held for a week", () => {
  const history = [session(1), session(3), session(5), session(8)];
  const t = nextTargets(sample, history, NOW);
  assert.equal(targetOf(t, "fist-open").reps, 11);
  assert.equal(t.progressed, true);
});

test("does not progress before the level has been held 7 days", () => {
  const t = nextTargets(sample, [session(1), session(2), session(3)], NOW);
  assert.equal(targetOf(t, "fist-open").reps, 10);
  assert.match(t.reason, /7 days/);
});

test("a pain flag in the last 3 sessions freezes progression", () => {
  const t = nextTargets(sample, [session(1, { pain: true }), session(3), session(5), session(9)], NOW);
  assert.equal(targetOf(t, "fist-open").reps, 10);
  assert.match(t.reason, /pain/);
});

test("an incomplete session in the last 3 blocks progression", () => {
  const t = nextTargets(sample, [session(1), session(3, { completed: false }), session(5), session(9)], NOW);
  assert.equal(targetOf(t, "fist-open").reps, 10);
});

test("never goes past the therapist's max reps", () => {
  const history = [14, 14, 14, 14].map((reps, i) => session(1 + i * 3, { reps }));
  const t = nextTargets(sample, history, NOW);
  assert.equal(targetOf(t, "fist-open").reps, 15);
  const atMax = [15, 15, 15, 15].map((reps, i) => session(1 + i * 3, { reps }));
  assert.equal(targetOf(nextTargets(sample, atMax, NOW), "fist-open").reps, 15);
});

test("without a max on the sheet, targets never rise above the sheet value", () => {
  const noMax = { ...sample, limits: { ...sample.limits, maxReps: undefined } };
  const t = nextTargets(noMax, [session(1), session(3), session(5), session(9)], NOW);
  assert.equal(targetOf(t, "fist-open").reps, 10);
});

const fistDays = (values) => values.map((v, i) => session(values.length - i, { fistIndex: v })); // oldest first → day N … day 1

test("flare: two days in a row worse than baseline by more than MDC95", () => {
  const r = flareCheck(fistDays([0.18, 0.19, 0.18, 0.18, 0.30, 0.31]), 0.063, NOW);
  assert.equal(r.flare, true);
});

test("no flare for a single bad day", () => {
  assert.equal(flareCheck(fistDays([0.18, 0.19, 0.18, 0.18, 0.18, 0.31]), 0.063, NOW).flare, false);
});

test("no flare when the drop stays inside MDC95", () => {
  assert.equal(flareCheck(fistDays([0.18, 0.19, 0.18, 0.18, 0.22, 0.23]), 0.063, NOW).flare, false);
});

test("no flare when the two bad days are not consecutive", () => {
  const history = [session(1, { fistIndex: 0.31 }), session(3, { fistIndex: 0.30 }), session(4), session(5), session(6), session(7)];
  assert.equal(flareCheck(history, 0.063, NOW).flare, false);
});

test("no flare call without at least 3 baseline sessions", () => {
  const r = flareCheck(fistDays([0.18, 0.30, 0.31]), 0.063, NOW);
  assert.equal(r.flare, false);
  assert.match(r.reason, /baseline/);
});

test("progress: no sessions yet", () => {
  const p = progressOf([], 0.063, NOW);
  assert.equal(p.last, null);
  assert.equal(p.change, null);
  assert.equal(p.streak, 0);
});

test("progress: no real-change call until 3 earlier sessions make a baseline", () => {
  const p = progressOf(fistDays([0.18, 0.19, 0.30]), 0.063, NOW);
  assert.equal(p.last.fistIndex, 0.30);
  assert.equal(p.baseline, null);
  assert.equal(p.change, null);
  assert.equal(p.need, 1);
});

test("progress: inside MDC95 is noise, beyond it looser or tighter (lower = tighter fist)", () => {
  assert.equal(progressOf(fistDays([0.18, 0.19, 0.18, 0.22]), 0.063, NOW).change, "noise");
  const looser = progressOf(fistDays([0.18, 0.19, 0.18, 0.30]), 0.063, NOW);
  assert.equal(looser.change, "looser");
  assert.equal(looser.baseline, 0.18);
  assert.equal(progressOf(fistDays([0.18, 0.19, 0.18, 0.10]), 0.063, NOW).change, "tighter");
});

test("progress: a newest session without a fist reading gets no change call", () => {
  const p = progressOf([...fistDays([0.18, 0.19, 0.18]), { ts: daysAgo(0), completed: false, fistIndex: null }], 0.063, NOW);
  assert.equal(p.last.completed, false);
  assert.equal(p.change, null);
});

test("progress: streak counts consecutive local days that end today or yesterday", () => {
  assert.equal(progressOf([session(0), session(0, { reps: 5 }), session(1), session(2), session(4)], 0.063, NOW).streak, 3);
  assert.equal(progressOf([session(1), session(2)], 0.063, NOW).streak, 2);
  assert.equal(progressOf([session(2), session(3)], 0.063, NOW).streak, 0);
});
