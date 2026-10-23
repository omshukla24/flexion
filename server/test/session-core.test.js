import { test } from "node:test";
import assert from "node:assert/strict";
import {
  startSession, advance, wantsIdentify, DEFAULT_TARGETS, HOLD_MS, GRACE_MS, SETTLE_MS, HEARD_MS, REST_MS, FIX_AFTER_MS, NUDGE_MS, GONE_MS,
  STEP_TIMEOUT_MS, GRIP_TIMEOUT_MS, IDENTIFY_AFTER_MS, IDENTIFY_GAP_MS,
} from "../app/session-core.js";
import { LINES } from "../app/lines.js";

const FRAME_MS = 33;
const TARGETS = { open: 3, fist: 5, reps: 10, grip: { object: "phone", accept: ["cell phone", "cup", "wine glass"] } };
const CURLS = { thumb: 10, index: 5, middle: 5, ring: 6, little: 8 };
const hand = (state, { issue = null, index = state === "Fist" ? 0.18 : 0.77, holding, reps = 0 } = {}) =>
  ({ state, formIssue: issue, rom: { index, fist: index, thumb: 0.7, width: 0.8 }, curls: CURLS, holding, reps });

/** Feeds `ms` worth of frames showing `h` (or no hand); `said` collects every new spoken line on the way. */
function hold(s, h, ms, said = []) {
  let state = s;
  const end = state.t + ms;
  while (state.t < end && state.step !== "done") {
    const next = advance(state, { type: "frame", t: state.t + FRAME_MS, hand: h }); // a finished session ignores frames
    if (next.say !== state.say && next.say) said.push(next.say.line);
    state = next;
  }
  return state;
}
const away = (s, said) => hold(s, null, REST_MS + 100, said); // a real relax between counts
const settle = (s, h = null, said) => hold(s, h, SETTLE_MS + 50, said);
const skip = (s) => advance(s, { type: "skip", t: s.t });

function captureN(s, pose, n, opts, said) {
  let state = s;
  for (let i = 0; i < n; i++) state = away(hold(state, hand(pose, opts), HOLD_MS + 100, said), said);
  return state;
}
const toOpen = (said) => settle(hold(startSession({ t: 0, targets: TARGETS }), hand("Open"), SETTLE_MS + HOLD_MS + 100, said), null, said);

function throughFist(said) {
  let s = captureN(toOpen(said), "Open", 3, undefined, said);
  return captureN(settle(s, null, said), "Fist", 5, undefined, said);
}
const atGrip = () => {
  let s = settle(throughFist(), hand("Open", { reps: 0 }));
  s = hold(s, hand("Open", { reps: 10 }), 100);
  return settle(s); // past the grip step's settle time
};

test("starts on the hello step and says the hello line", () => {
  const s = startSession({ t: 0, targets: TARGETS });
  assert.equal(s.step, "hello");
  assert.match(s.cue.text, /hand/i);
  assert.equal(s.say.line, "hello");
  assert.equal(s.say.text, LINES.hello);
});

test("full happy path: hello → 3 open → 5 fist → 10 reps → holding the cup → done", () => {
  let s = settle(throughFist(), hand("Open", { reps: 0 }));
  assert.equal(s.step, "reps");
  s = hold(s, hand("Open", { reps: 4 }), 100);
  assert.equal(s.step, "reps");
  s = hold(s, hand("Open", { reps: 14 }), 100);
  assert.equal(s.step, "grip");
  s = hold(settle(s), hand("Partial", { holding: "cup" }), HOLD_MS + 100);
  assert.equal(s.step, "done");
  assert.equal(s.result.completed, true);
  assert.equal(s.result.reps, 10);
  assert.equal(s.result.grip, "pass");
  assert.ok(Math.abs(s.result.fistIndex - 0.18) < 1e-9);
  assert.ok(Math.abs(s.result.openIndex - 0.77) < 1e-9);
  assert.ok(s.result.durationMs > 0);
  assert.equal(s.say.line, "done");
});

// No cup needed: a phone, a game controller, a book or a mouse also pass.
test("the demo grip task asks for your phone and passes with a phone, controller, book or mouse", () => {
  assert.equal(DEFAULT_TARGETS.grip.object, "phone");
  assert.ok(DEFAULT_TARGETS.grip.accept.length <= 10, "identify takes at most 10 expected labels");
  // the detector's names (cell phone, remote, book, mouse) and identify's (mobile phone, game controller, computer mouse)
  for (const held of ["cell phone", "mobile phone", "remote", "game controller", "book", "mouse", "computer mouse"]) {
    let s = startSession({ t: 0, targets: DEFAULT_TARGETS });
    for (let i = 0; i < 4; i++) s = skip(s);
    assert.equal(s.step, "grip");
    assert.equal(s.cue.text, "Pick up your phone. Hold it up.");
    assert.equal(s.say.line, "grip-phone-skip");
    s = hold(settle(s), hand("Partial", { holding: held }), HOLD_MS + 100);
    assert.equal(s.result?.grip, "pass", held);
  }
});

test("reps count from the vision counter's value once the step has settled", () => {
  let s = startSession({ t: 0, targets: TARGETS });
  for (const step of ["hello", "open", "fist"]) s = advance(s, { type: "skip", t: s.t + 10 }); // reach reps with no hand seen yet
  assert.equal(s.step, "reps");
  s = hold(s, hand("Open", { reps: 7 }), SETTLE_MS + 100); // reps made while the line plays don't count
  s = hold(s, hand("Open", { reps: 16 }), 100);
  assert.equal(s.step, "reps", "9 done, not 16");
  s = hold(s, hand("Open", { reps: 17 }), 100);
  assert.equal(s.step, "grip");
});

test("nothing counts while a new step settles", () => {
  const s = hold(toOpen(), hand("Open"), 100);
  const fresh = skip(s); // fist starts now
  const early = hold(fresh, hand("Fist"), SETTLE_MS - 200);
  assert.equal(early.captures.fist.length, 0);
  assert.equal(hold(early, hand("Fist"), HOLD_MS + 300).captures.fist.length, 1);
});

test("hearing the step's line keeps the settle going a moment longer", () => {
  const s = skip(hold(toOpen(), hand("Open"), 100));
  const heardAt = s.t + SETTLE_MS - 100; // the line was queued behind another and ended late
  const h = advance(hold(s, null, SETTLE_MS - 100), { type: "heard", t: heardAt, id: s.say.id });
  assert.equal(hold(h, hand("Fist"), HEARD_MS - 100).captures.fist.length, 0);
  assert.equal(hold(h, hand("Fist"), HEARD_MS + HOLD_MS + 100).captures.fist.length, 1);
});

test("a pose held for less than the hold time is not captured", () => {
  const s = away(hold(toOpen(), hand("Open"), HOLD_MS - 200));
  assert.equal(s.captures.open.length, 0);
});

test("a wobble shorter than the grace time keeps the hold; a longer one resets it", () => {
  let s = hold(toOpen(), hand("Open"), HOLD_MS - 300);
  const wobbled = hold(hold(s, hand("Partial"), GRACE_MS - 100), hand("Open"), 400);
  assert.equal(wobbled.captures.open.length, 1, "the 300 ms flicker was forgiven");
  const reset = hold(hold(s, null, GRACE_MS + 100), hand("Open"), 400);
  assert.equal(reset.captures.open.length, 0);
});

test("holding one pose without re-forming it captures only once", () => {
  const s = hold(toOpen(), hand("Open"), HOLD_MS * 5);
  assert.equal(s.captures.open.length, 1);
  assert.match(s.cue.text, /relax/i);
});

test("after a count, the next can't land before the rest time", () => {
  let s = hold(toOpen(), hand("Open"), HOLD_MS + 100);
  s = hold(s, null, GRACE_MS + 50); // relaxed, but only briefly
  s = hold(s, hand("Open"), REST_MS - GRACE_MS - 150 + HOLD_MS - 300);
  assert.equal(s.captures.open.length, 1);
  assert.equal(hold(s, hand("Open"), 800).captures.open.length, 2);
});

test("a short form slip is shown but not said; a lasting one is said once, counted once, then confirmed", () => {
  let s = settle(captureN(toOpen(), "Open", 3));
  assert.equal(s.step, "fist");
  const said = [];
  const brief = hold(s, hand("Fist", { issue: "thumb-tucked" }), FIX_AFTER_MS - 500, said);
  assert.equal(brief.cue.kind, "fix");
  assert.equal(brief.fixes, 0);
  assert.deepEqual(said, []);
  s = hold(s, hand("Fist", { issue: "thumb-tucked" }), FIX_AFTER_MS * 2, said);
  assert.equal(s.captures.fist.length, 0);
  assert.match(s.cue.text, /thumb/i);
  assert.equal(s.fixes, 1, "one fix per occurrence, not per frame");
  assert.deepEqual(said, ["fix-thumb-tucked"]);
  s = hold(s, hand("Fist"), GRACE_MS + 100, said);
  assert.equal(s.cue.kind, "correct");
  assert.deepEqual(said, ["fix-thumb-tucked", "fixed"]);
  assert.equal(s.log.fixes.length, 1);
  assert.equal(s.log.fixes[0].issue, "thumb-tucked");
});

test("the wrong pose gets the step's instruction, not a capture", () => {
  const s = hold(settle(captureN(toOpen(), "Open", 3)), hand("Open"), HOLD_MS * 2);
  assert.equal(s.captures.fist.length, 0);
  assert.match(s.cue.text, /fist/i);
});

test("speaks on events, not on every frame: counts, then the step's last count merges into the next step's line", () => {
  const said = [];
  captureN(toOpen(said), "Open", 3, undefined, said);
  assert.deepEqual(said, ["open", "count-1", "count-2", "fist"]);
});

test("reps say only the start and three milestones", () => {
  const said = [];
  let s = settle(throughFist(), hand("Open", { reps: 0 }));
  for (let r = 1; r <= 10; r++) s = hold(s, hand("Open", { reps: r }), 900, said);
  assert.deepEqual(said, ["reps-half", "reps-two", "reps-last", "grip-phone"]);
  assert.equal(s.log.reps.length, 10);
});

test("a step that times out moves on, says so, and marks the session incomplete", () => {
  const said = [];
  const s = hold(toOpen(), null, STEP_TIMEOUT_MS + 100, said);
  assert.equal(s.step, "fist");
  assert.deepEqual(s.incomplete, ["open"]);
  assert.equal(said.at(-1), "fist-skip");
  assert.equal(s.log.steps.find((x) => x.step === "open").outcome, "timeout");
});

test("nothing counted for a while → one calm nudge, then not again for a while; a hand out of view → 'I can't see your hand'", () => {
  const said = [];
  hold(toOpen(), hand("Partial"), NUDGE_MS + 10_000, said);
  assert.deepEqual(said, ["nudge-open"]);
  const gone = [];
  hold(toOpen(), null, GONE_MS + 1000, gone);
  assert.deepEqual(gone, ["gone"]);
});

test("'skip' moves on and marks the step incomplete", () => {
  const s = skip(hold(toOpen(), hand("Open"), 100));
  assert.equal(s.step, "fist");
  assert.deepEqual(s.incomplete, ["open"]);
});

test("pause freezes the step: paused time doesn't count toward the timeout; pain says the pain line", () => {
  let s = hold(toOpen(), null, 1000);
  s = advance(s, { type: "pause", t: s.t, why: "pain" });
  assert.equal(s.say.line, "pain");
  s = hold(s, null, STEP_TIMEOUT_MS + 5000);
  assert.equal(s.step, "open", "still on the step after a long rest");
  s = advance(s, { type: "resume", t: s.t });
  assert.equal(s.say.line, "resumed");
  assert.equal(s.log.pauses.length, 1);
  assert.equal(s.log.pauses[0].why, "pain");
  assert.equal(hold(s, null, STEP_TIMEOUT_MS - 6000).step, "open");
});

test("'stop' ends the session: the rest is incomplete, the grip skipped", () => {
  const s = advance(captureN(toOpen(), "Open", 3), { type: "stop", t: 99_000 });
  assert.equal(s.step, "done");
  assert.equal(s.result.completed, false);
  assert.equal(s.result.grip, "skipped");
  assert.equal(s.say.line, "stopped");
});

test("'slower' stretches the settle and rest times", () => {
  const s = ((o) => advance(o, { type: "slower", t: o.t }))(toOpen());
  assert.equal(s.say.line, "slower");
  assert.ok(s.pace > 1);
});

test("the log keeps every count with the five finger curls and the step timeline", () => {
  const s = throughFist();
  assert.equal(s.log.counts.length, 8);
  assert.deepEqual(s.log.counts[0].curls, CURLS);
  assert.equal(s.log.counts[0].step, "open");
  assert.deepEqual(s.log.steps.map((x) => [x.step, x.outcome]), [["hello", "pass"], ["open", "pass"], ["fist", "pass"]]);
});

test("the grip banner and voice never name what the camera sees", () => {
  const s = hold(atGrip(), hand("Partial", { holding: "wine glass" }), HOLD_MS - 300);
  assert.doesNotMatch(s.cue.text, /wine/i);
});

test("grip passes on an identify match for objects the detector can't name", () => {
  const s = ((g) => advance(g, { type: "identified", t: g.t, label: "ceramic mug", matches: true }))(atGrip());
  assert.equal(s.step, "done");
  assert.equal(s.result.grip, "pass");
  assert.equal(s.log.grip.by, "identify");
});

test("grip times out as a fail but the ROM session still counts as completed", () => {
  const s = hold(atGrip(), hand("Open"), GRIP_TIMEOUT_MS + 200);
  assert.equal(s.step, "done");
  assert.equal(s.result.grip, "fail");
  assert.equal(s.result.completed, true);
  assert.equal(s.say.line, "done-skip");
});

test("advance never mutates the state it was given", () => {
  const s = startSession({ t: 0, targets: TARGETS });
  const frozen = structuredClone(s);
  advance(s, { type: "frame", t: 40, hand: hand("Open") });
  advance(s, { type: "pause", t: 50 });
  assert.deepEqual(s, frozen);
});

// ---- identify in the grip step: SigLIP on the server names what the detector can't ----
test("identify is wanted 2 s after the grip step settles with a hand in view, never while a call is out, then at most every 2 s", () => {
  const h = hand("Open");
  let s = atGrip();
  assert.equal(s.step, "grip");
  assert.equal(wantsIdentify(hold(s, h, IDENTIFY_AFTER_MS - 300), h), false);
  s = hold(s, h, IDENTIFY_AFTER_MS + 50);
  assert.equal(wantsIdentify(s, h), true);
  assert.equal(wantsIdentify(s, null), false);
  s = advance(s, { type: "identifying", t: s.t });
  assert.equal(wantsIdentify(s, h), false);
  s = advance(s, { type: "identified", t: s.t + 100, label: "mouse pad", matches: false });
  assert.equal(wantsIdentify(hold(s, h, 1000), h), false);
  assert.equal(wantsIdentify(hold(s, h, IDENTIFY_GAP_MS), h), true);
});

test("identify is not wanted while the detector already sees the object, or outside the grip step", () => {
  const cup = hand("Open", { holding: "cup" });
  const s = hold(atGrip(), hand("Open"), IDENTIFY_AFTER_MS + 50);
  assert.equal(wantsIdentify(advance(s, { type: "frame", t: s.t + 33, hand: cup }), cup), false);
  assert.equal(wantsIdentify(throughFist(), hand("Fist")), false);
});

test("identify is silent: looking, a miss and a failure leave the cue alone, and the grip step runs on to its timeout", () => {
  let s = hold(atGrip(), hand("Open"), IDENTIFY_AFTER_MS + 50);
  const asked = s.cue;
  s = advance(s, { type: "identifying", t: s.t });
  s = advance(s, { type: "identified", t: s.t + 50, label: "mouse pad", matches: false });
  assert.deepEqual(s.cue, asked);
  s = hold(s, hand("Open"), IDENTIFY_GAP_MS);
  s = advance(s, { type: "identifying", t: s.t });
  s = advance(s, { type: "identified", t: s.t + 50, label: "unknown", matches: false, error: "unavailable" });
  assert.deepEqual(s.cue, asked);
  s = hold(s, hand("Open"), GRIP_TIMEOUT_MS);
  assert.equal(s.result.grip, "fail");
});

test("an identify with no label (the hand left before the snapshot) changes nothing but frees the next call", () => {
  let s = hold(atGrip(), hand("Open"), IDENTIFY_AFTER_MS + 50);
  s = advance(s, { type: "identifying", t: s.t });
  const cue = s.cue;
  s = advance(s, { type: "identified", t: s.t + 50, label: null, matches: false });
  assert.deepEqual(s.cue, cue);
  assert.equal(wantsIdentify(hold(s, hand("Open"), IDENTIFY_GAP_MS), hand("Open")), true);
});
