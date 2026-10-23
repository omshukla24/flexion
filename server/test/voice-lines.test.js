import { test } from "node:test";
import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";
import { LINES } from "../app/lines.js";
import { startSession, advance, DEFAULT_TARGETS, SETTLE_MS, HOLD_MS, REST_MS, FIX_AFTER_MS, NUDGE_MS, GONE_MS, STEP_TIMEOUT_MS, GRIP_TIMEOUT_MS } from "../app/session-core.js";

const clip = (id) => new URL(`../app/voice/${id}.mp3`, import.meta.url);
const hand = (state, o = {}) => ({ state, formIssue: o.issue ?? null, rom: { index: 0.5, fist: 0.5, thumb: 0.7, width: 0.8 }, curls: {}, reps: o.reps ?? 0, holding: o.holding });

/** Every line a session can say with the demo targets, across passes, fixes, nudges, timeouts, rests and stops. */
function spoken() {
  const ids = new Set();
  const run = (s, h, ms) => { let st = s; const end = st.t + ms; while (st.t < end && st.step !== "done") { st = advance(st, { type: "frame", t: st.t + 33, hand: h }); if (st.say) ids.add(st.say.line); } return st; };
  const ev = (s, e) => { const st = advance(s, { t: s.t, ...e }); if (st.say) ids.add(st.say.line); return st; };
  let s = startSession({ t: 0, targets: DEFAULT_TARGETS });
  ids.add(s.say.line);
  s = run(s, null, NUDGE_MS + SETTLE_MS + 100);                       // nudge-hello
  s = run(s, hand("Open"), HOLD_MS + 100);
  s = run(run(s, null, SETTLE_MS + GONE_MS + 200), hand("Partial"), NUDGE_MS + 6000); // gone, then nudge-open (gone pushes the nudge back)
  for (let i = 0; i < 9; i++) s = run(run(s, hand("Open"), HOLD_MS + 100), null, REST_MS + 100);
  s = run(run(s, null, SETTLE_MS + 100), hand("Fist", { issue: "thumb-tucked" }), FIX_AFTER_MS + 200);
  s = run(s, hand("Fist", { issue: "sideways" }), FIX_AFTER_MS + 600);
  s = run(s, hand("Fist"), 600);                                       // fixed
  s = ev(ev(ev(s, { type: "pause", why: "pain" }), { type: "resume" }), { type: "slower" });
  s = ev(ev(s, { type: "pause" }), { type: "resume" });
  s = run(s, null, STEP_TIMEOUT_MS + 100);                             // fist timed out → reps-10-skip
  s = run(s, hand("Open", { reps: 0 }), SETTLE_MS * 2 + NUDGE_MS + 200); // nudge-reps
  for (let r = 1; r <= 10; r++) s = run(s, hand("Open", { reps: r }), 200);
  s = run(s, null, SETTLE_MS * 2 + NUDGE_MS + 200);                   // nudge-grip-phone
  s = run(s, hand("Open"), GRIP_TIMEOUT_MS);                           // done-skip
  // the other branches: fist after a pass, grip after a skip, done after a pass, stop
  let p = ev(ev(startSession({ t: 0 }), { type: "skip" }), { type: "skip" });
  p = ev(ev(p, { type: "skip" }), { type: "skip" }); // reps skipped → grip-phone-skip
  p = run(run(p, null, SETTLE_MS * 2 + 100), hand("Open", { holding: "cell phone" }), HOLD_MS + 200);
  let q = run(startSession({ t: 0 }), hand("Open"), SETTLE_MS * 2 + HOLD_MS + 200);
  for (let i = 0; i < 3; i++) q = run(run(q, hand("Open"), HOLD_MS + 100), null, REST_MS + 100);
  q = run(q, null, SETTLE_MS + 100);
  for (let i = 0; i < 5; i++) q = run(run(q, hand("Fist"), HOLD_MS + 100), null, REST_MS + 100); // → reps-10
  ev(q, { type: "stop" });
  return ids;
}

test("every line a session can say has words and a recorded clip", () => {
  const ids = spoken();
  for (const id of ["hello", "open", "fist", "fist-skip", "reps-10", "reps-10-skip", "grip-phone", "grip-phone-skip", "done", "done-skip", "stopped",
    "count-1", "count-2", "count-4", "reps-half", "reps-two", "reps-last", "fix-sideways", "fix-thumb-tucked", "fixed", "gone",
    "nudge-hello", "nudge-open", "nudge-reps", "nudge-grip-phone", "paused", "pain", "resumed", "slower"]) assert.ok(ids.has(id), `never said: ${id}`);
  for (const id of ids) {
    assert.ok(id && LINES[id], `a demo-target line with no words: ${id}`);
    assert.ok(existsSync(clip(id)), `no clip for ${id}: run node tools/voice/render.mjs`);
  }
});

test("every clip matches the words it was rendered from", () => {
  const manifest = JSON.parse(readFileSync(new URL("../app/voice/manifest.json", import.meta.url), "utf8"));
  assert.deepEqual(manifest.lines, LINES, "lines.js changed since the clips were made: run node tools/voice/render.mjs");
  for (const id of Object.keys(LINES)) assert.ok(existsSync(clip(id)), id);
});
