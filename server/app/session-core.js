// The coach's brain: a pure, immutable state machine. coach.js and the site feed it vision frames, show its banner (`cue`)
// and speak its `say` lines. Flow: hello → open ×N → fist ×N (form guards) → reps → grip task → done.
// Paced for people, not statues: a new step settles before anything counts, a short wobble is forgiven,
// counts rest between them, and the voice speaks on events only, never on every frame.
import { LINES, numberWord } from "./lines.js";

export const HOLD_MS = 1000;           // a pose must hold this long to count: a calm "hold it there", not a freeze
export const GRACE_MS = 400;           // a wobble or a missed frame shorter than this keeps the hold
export const SETTLE_MS = 3000;         // after a step starts nothing counts yet: time to hear the line and move
export const HEARD_MS = 1000;          // …and at least this long after the step's line has finished playing
export const REST_MS = 1500;           // the next count can't start sooner after the last one
export const FIX_AFTER_MS = 1500;      // a form slip is shown at once, but said and counted only when it lasts this long
export const NUDGE_MS = 12_000;        // nothing counted this long after settling → "Take your time…"
export const NUDGE_AGAIN_MS = 15_000;  // and not again sooner (also the gap between "I can't see your hand")
export const GONE_MS = 3000;           // no hand this long → "I can't see your hand."
export const STEP_TIMEOUT_MS = 60_000; // a step with no valid pose moves on and the session is marked incomplete
export const GRIP_TIMEOUT_MS = 40_000; // failing the grip task doesn't void the ROM session
// The 40 s grip limit keeps identify to ≤ 19 calls a session; the server caps each session at 60 as well.
export const IDENTIFY_AFTER_MS = 2000; // the detector gets 2 s after the grip step settles before the coach asks identify
export const IDENTIFY_GAP_MS = 2000;   // then at most one identify call every 2 s
// accept: the detector's COCO names and identify's labels for the same objects (≤ 10: identify's `expect` cap).
// The phone, with a game controller, book or mouse also passing: no cup needed, only what is already at hand.
export const DEFAULT_TARGETS = { open: 3, fist: 5, reps: 10, grip: { object: "phone", accept: [
  "cell phone", "mobile phone", "remote", "game controller", "book", "mouse", "computer mouse", "cup", "mug", "bottle"] } };

const ORDER = ["hello", "open", "fist", "reps", "grip", "done"];
const POSE = { open: "Open", fist: "Fist" };
const MEASURED = ["open", "fist", "reps"]; // steps whose absence makes the session incomplete
const FINGERS = ["thumb", "index", "middle", "ring", "little"];
// Banner text: it can be longer than the spoken line and changes freely (it's silent).
const RELAX = "Relax your hand, then again.";
const FIX = { sideways: "Turn your palm to face me.", "thumb-tucked": "Thumb across the outside." };

const cue = (kind, text) => ({ kind, text });
const nextStep = (step) => ORDER[ORDER.indexOf(step) + 1];
const median = (xs) => { const s = [...xs].sort((a, b) => a - b), m = s.length >> 1; return s.length % 2 ? s[m] : (s[m - 1] + s[m]) / 2; };

function instruction(step, targets) {
  return {
    hello: "Hold your hand up, palm to me.",
    open: "Open your hand wide. Hold it there.",
    fist: "Make a fist, thumb outside. Hold it there.",
    reps: `Open and close your hand ${targets.reps} times. Slowly.`,
    grip: `Pick up your ${targets.grip.object}. Hold it up.`,
    done: "All done. Here's today.",
  }[step];
}

/** A new spoken line. `line` is its clip id in LINES (null when only words exist, e.g. an object with no clip). */
function speak(s, id, kind, words) {
  const n = s.sayN + 1;
  return { ...s, sayN: n, say: { id: n, line: LINES[id] ? id : null, kind, text: LINES[id] ?? words } };
}

/** What the coach says when a step starts; `praise` when the last step ended well. */
function stepLine(s, step, how) {
  const ok = how === "pass", { reps, grip } = s.targets, skip = ok ? "" : "-skip";
  if (step === "hello" || step === "open") return [step];
  if (step === "fist") return [`fist${skip}`];
  if (step === "reps") return [`reps-${reps}${skip}`, ok ? `Well done. Open and close, ${numberWord(reps)} times, slowly.` : `Let's move on. Open and close, ${numberWord(reps)} times.`];
  if (step === "grip") return [`grip-${grip.object}${skip}`, ok ? `Well done. Now pick up your ${grip.object}.` : `Let's move on. Pick up your ${grip.object}.`];
  return [how === "stop" ? "stopped" : s.grip === "pass" ? "done" : "done-skip", "Well done today."];
}

function nudgeLine(s) {
  const obj = s.targets.grip.object;
  return s.step === "grip" ? [`nudge-grip-${obj}`, `Take your time. Pick up your ${obj}.`] : [`nudge-${s.step}`];
}

/** A fresh session at time `t` (ms). `targets` comes from routine.nextTargets or the demo default. */
export function startSession({ t, targets = DEFAULT_TARGETS }) {
  return enter({
    t0: t, targets, captures: { open: [], fist: [] }, repsDone: 0, grip: null, incomplete: [], fixes: 0, result: null,
    ident: { last: -Infinity, busy: false }, sayN: 0, say: null, paused: null, pace: 1, goneSaidAt: -Infinity,
    log: { steps: [], counts: [], fixes: [], reps: [], grip: null, pauses: [] },
  }, "hello", t);
}

/** Moves to `step`; `how` the last step ended: "pass" | "skip" | "timeout" | "stop". */
function enter(s, step, t, how = "pass") {
  const steps = s.step ? [...s.log.steps, { step: s.step, t0: s.stepT0 - s.t0, t1: t - s.t0, outcome: how }] : s.log.steps;
  const settleUntil = t + SETTLE_MS * s.pace;
  const next = speak({
    ...s, step, t, stepT0: t, settleUntil, holdSince: null, badSince: null, awaySince: null, window: [], armed: true,
    lastCountT: -Infinity, issue: null, repsBase: null, nudgeAt: settleUntil + NUDGE_MS * s.pace, goneSince: null,
    cue: cue("instruction", instruction(step, s.targets)), log: { ...s.log, steps },
  }, ...(([id, words]) => [id, "step", words])(stepLine(s, step, how)));
  return step === "done" ? finish({ ...next, stepSayId: next.say.id }) : { ...next, stepSayId: next.say.id };
}

function finish(s) {
  const of = (pose, key) => (s.captures[pose].length ? median(s.captures[pose].map((c) => c[key])) : null);
  return {
    ...s,
    result: {
      completed: !s.incomplete.some((st) => MEASURED.includes(st)),
      durationMs: s.t - s.t0,
      openIndex: of("open", "index"),
      fistIndex: of("fist", "index"),
      fistThumb: of("fist", "thumb"),
      reps: s.repsDone,
      grip: s.grip ?? (s.incomplete.includes("grip") ? "skipped" : null),
      fixes: s.fixes,
      incomplete: s.incomplete,
      targets: s.targets,
    },
  };
}

/** Grace-aware hold: good frames grow it; a bad stretch shorter than GRACE_MS is forgiven. → [state, held long enough]. */
function holdOn(s, good, sample = null) {
  if (good) {
    const holdSince = s.holdSince ?? s.t;
    return [{ ...s, holdSince, badSince: null, window: sample ? [...s.window, sample] : s.window }, s.t - holdSince >= HOLD_MS];
  }
  const badSince = s.badSince ?? s.t;
  if (s.holdSince !== null && s.t - badSince < GRACE_MS) return [{ ...s, badSince }, false];
  return [{ ...s, badSince, holdSince: null, window: [] }, false];
}

/** A form slip is on the banner at once; said and counted once it has lasted FIX_AFTER_MS; "That's it." when it ends. */
function trackIssue(s, hand) {
  const kind = hand?.formIssue ?? null, is = s.issue;
  if (kind) {
    const cur = is && is.kind === kind && s.t - is.lastAt < GRACE_MS ? { ...is, lastAt: s.t } : { kind, since: s.t, lastAt: s.t, said: false };
    if (cur.said || s.t - cur.since < FIX_AFTER_MS) return { ...s, issue: cur };
    return speak({ ...s, issue: { ...cur, said: true }, fixes: s.fixes + 1 }, `fix-${kind}`, "fix", FIX[kind]);
  }
  if (!is || s.t - is.lastAt < GRACE_MS) return s; // a missed frame doesn't end it
  const ended = { ...s, issue: null };
  if (!is.said) return ended;
  const logged = { ...ended, log: { ...s.log, fixes: [...s.log.fixes, { issue: is.kind, t: is.since - s.t0, ms: is.lastAt - is.since }] } };
  return hand ? speak(logged, "fixed", "fix") : logged;
}

function summarize(window) {
  const of = (get) => median(window.map(get));
  const curls = window[0]?.curls ? Object.fromEntries(FINGERS.map((f) => [f, of((r) => r.curls[f])])) : null;
  return { index: of((r) => r.index), fist: of((r) => r.fist), thumb: of((r) => r.thumb), width: of((r) => r.width), curls };
}

function banner(s, hand, inPose) {
  if (hand?.formIssue) return cue("fix", FIX[hand.formIssue]);
  if (inPose && (!s.armed || s.t - s.lastCountT < REST_MS * s.pace)) return s.cue.kind === "correct" ? s.cue : cue("instruction", RELAX);
  if (s.holdSince !== null) return cue("correct", "✔ That's it. Hold it there.");
  return cue("instruction", instruction(s.step, s.targets));
}

function onHello(s, hand) {
  if (s.t < s.settleUntil) return s;
  const [h, held] = holdOn(s, !!hand);
  return held ? enter(h, "open", s.t) : h;
}

function onCapture(s, hand) {
  const inPose = !!hand && hand.state === POSE[s.step];
  const awaySince = inPose ? null : s.awaySince ?? s.t;
  const armed = s.armed || (awaySince !== null && s.t - awaySince >= GRACE_MS); // re-armed only by a real relax
  if (s.t < s.settleUntil) return { ...s, awaySince, armed };
  const tracked = trackIssue({ ...s, awaySince, armed }, hand);
  const good = inPose && !hand.formIssue && armed && s.t - s.lastCountT >= REST_MS * s.pace;
  const [h, held] = holdOn(tracked, good, good ? { ...hand.rom, curls: hand.curls } : null);
  if (!held) return { ...h, cue: banner(h, hand, inPose) };
  const c = summarize(h.window), captures = { ...h.captures, [s.step]: [...h.captures[s.step], c] };
  const n = captures[s.step].length, N = s.targets[s.step];
  const after = {
    ...h, captures, holdSince: null, window: [], armed: false, lastCountT: s.t, nudgeAt: s.t + NUDGE_MS * s.pace,
    cue: cue("correct", `✔ ${n} of ${N}. ${RELAX}`), log: { ...h.log, counts: [...h.log.counts, { step: s.step, n, t: s.t - s.t0, ...c }] },
  };
  return n >= N ? enter(after, nextStep(s.step), s.t) : speak(after, `count-${n}`, "count", `That's ${numberWord(n)}. Relax, then again.`);
}

const milestone = (done, N) => (done === N - 1 ? "reps-last" : done === N - 2 && N >= 4 ? "reps-two" : done === Math.floor(N / 2) && N >= 6 ? "reps-half" : null);

function onReps(s, hand) {
  if (!hand) return s;
  if (s.t < s.settleUntil) return { ...s, repsBase: hand.reps }; // reps made while the line plays don't count
  const repsBase = s.repsBase ?? hand.reps; // the vision rep counter is cumulative: count from its value when the step settled
  const N = s.targets.reps, done = Math.min(N, Math.max(0, hand.reps - repsBase));
  if (done <= s.repsDone) return { ...s, repsBase };
  const reps = [...s.log.reps, ...Array.from({ length: done - s.repsDone }, () => s.t - s.t0)];
  const at = { ...s, repsBase, repsDone: done, nudgeAt: s.t + NUDGE_MS * s.pace, cue: cue("progress", `${done} of ${N}`), log: { ...s.log, reps } };
  if (done >= N) return enter(at, "grip", s.t);
  const mile = milestone(done, N);
  return mile ? speak(at, mile, "count") : at;
}

function passGrip(s, by) {
  return enter({ ...s, grip: "pass", log: { ...s.log, grip: { outcome: "pass", ms: s.t - s.stepT0, by } } }, "done", s.t);
}

function onGrip(s, hand) {
  if (s.t < s.settleUntil) return s;
  const held = !!hand?.holding && s.targets.grip.accept.includes(hand.holding);
  const [h, ok] = holdOn(s, held);
  if (ok) return passGrip(h, "detector");
  return held ? { ...h, cue: cue("correct", "✔ That's it. Hold it up.") } : h; // never names what the camera sees
}

/** Nudges and "I can't see your hand", once the step has settled and nothing else was said this frame. */
function watch(s, hand) {
  if (s.t < s.settleUntil) return s;
  if (!hand && s.step !== "hello") {
    const goneSince = s.goneSince ?? s.t;
    if (s.t - goneSince < GONE_MS || s.t - s.goneSaidAt < NUDGE_AGAIN_MS) return { ...s, goneSince };
    return speak({ ...s, goneSince, goneSaidAt: s.t, nudgeAt: Math.max(s.nudgeAt, s.t + NUDGE_AGAIN_MS) }, "gone", "nudge");
  }
  const seen = hand ? { ...s, goneSince: null } : s;
  if (s.t < s.nudgeAt) return seen;
  return speak({ ...seen, nudgeAt: s.t + NUDGE_AGAIN_MS * s.pace }, ...(([id, words]) => [id, "nudge", words])(nudgeLine(s)));
}

/** Whether the coach should send identify a hand crop now: grip step settled, hand in view, no detector match yet, no call out, gaps kept. */
export function wantsIdentify(s, hand) {
  const { last, busy } = s.ident;
  return s.step === "grip" && !s.paused && !!hand && s.holdSince === null && !busy && s.t - s.settleUntil >= IDENTIFY_AFTER_MS && s.t - last >= IDENTIFY_GAP_MS;
}

// Silent on a miss or a failure: the coach never says what the user holds; a failure just lets the session run on.
const onIdentified = (s, { matches }) => (s.step === "grip" && matches ? passGrip(s, "identify") : s);

const later = (step) => ORDER.slice(ORDER.indexOf(step), -1);

function pause(s, t, why) {
  if (s.paused) return s;
  return speak({ ...s, t, paused: { t, why }, holdSince: null, badSince: null, window: [], issue: null }, why === "pain" ? "pain" : "paused", "step");
}

function resume(s, t) {
  if (!s.paused) return s;
  const d = t - s.paused.t, settleUntil = t + SETTLE_MS * s.pace;
  return speak({
    ...s, t, paused: null, stepT0: s.stepT0 + d, lastCountT: s.lastCountT + d, settleUntil, nudgeAt: settleUntil + NUDGE_MS * s.pace,
    goneSince: null, goneSaidAt: s.goneSaidAt + d, ident: { ...s.ident, last: s.ident.last + d },
    log: { ...s.log, pauses: [...s.log.pauses, { t: s.paused.t - s.t0, ms: d, why: s.paused.why }] },
  }, "resumed", "step");
}

/**
 * Pure reducer. Events: {type:"frame", t, hand|null} · {type:"skip", t} · {type:"stop", t} · {type:"pause", t, why?} · {type:"resume", t}
 * · {type:"slower", t} · {type:"heard", t, id} (a `say` line finished playing) · {type:"identifying", t} · {type:"identified", t, matches}.
 */
export function advance(s, ev) {
  if (s.step === "done") return s;
  const t = ev.t ?? s.t;
  if (ev.type === "pause") return pause(s, t, ev.why ?? "asked");
  if (ev.type === "resume") return resume(s, t);
  if (ev.type === "heard") return ev.id === s.stepSayId ? { ...s, settleUntil: Math.max(s.settleUntil, t + HEARD_MS * s.pace) } : s;
  if (ev.type === "slower") return speak({ ...s, pace: Math.min(2, s.pace * 1.3) }, "slower", "step");
  if (ev.type === "stop") return enter({ ...s, incomplete: [...s.incomplete, ...later(s.step)] }, "done", t, "stop");
  if (ev.type === "skip") return enter({ ...s, incomplete: [...s.incomplete, s.step] }, nextStep(s.step), t, "skip");
  if (ev.type === "identifying") return { ...s, t, ident: { last: t, busy: true } };
  if (ev.type === "identified") return onIdentified({ ...s, t, ident: { ...s.ident, busy: false } }, ev);
  if (ev.type !== "frame") return s;
  if (s.paused) return { ...s, t };
  const limit = s.step === "grip" ? GRIP_TIMEOUT_MS : STEP_TIMEOUT_MS;
  if (t - s.stepT0 > limit) {
    return s.step === "grip"
      ? enter({ ...s, grip: "fail", log: { ...s.log, grip: { outcome: "fail", ms: t - s.stepT0, by: null } } }, "done", t, "timeout")
      : enter({ ...s, incomplete: [...s.incomplete, s.step] }, nextStep(s.step), t, "timeout");
  }
  const at = { ...s, t };
  const handler = { hello: onHello, reps: onReps, grip: onGrip }[s.step] ?? onCapture;
  const next = handler(at, ev.hand);
  return next.step === s.step && next.sayN === s.sayN ? watch(next, ev.hand) : next;
}
