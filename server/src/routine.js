// The therapist stays in charge: a routine carries the sheet's limits, progression moves only inside them,
// and a flare is a measured drop (beyond MDC95 on 2 days in a row), never a guess. parseSheet (Nova) joins later.
import { z } from "zod";

const WEEK_MS = 7 * 24 * 3600_000;
const DAY_MS = 24 * 3600_000;
const STEP = 0.10;     // most a target may rise in one step, once a week
const CLEAN_RUN = 3;   // completed, pain-free sessions in a row before any rise
const MIN_BASELINE = 3; // earlier sessions needed before a flare can be called
const IST_MIN = 330;   // calendar days are the user's local days; the first users are in India (IST)

const Exercise = z.object({
  id: z.string().regex(/^[a-z0-9-]{1,40}$/),
  name: z.string().min(1).max(80),
  sets: z.number().int().min(1).max(10),
  reps: z.number().int().min(1).max(100),
  holdSec: z.number().min(0).max(120).optional(),
  perDay: z.number().int().min(1).max(10).optional(),
  notes: z.string().max(300).optional(),
  quote: z.string().min(1).max(300), // the sheet text this exercise came from: nothing invented
});
export const Routine = z.object({
  exercises: z.array(Exercise).min(1).max(20),
  limits: z.object({
    maxReps: z.number().int().min(1).max(100).optional(),
    maxHoldSec: z.number().min(0).max(120).optional(),
    romTargetPct: z.number().min(0).max(100).optional(),
    painStop: z.boolean(),
    other: z.array(z.string().max(200)).max(10),
  }),
  gentle: z.array(Exercise).max(20).optional(),
  sourceQuotes: z.array(z.string().max(300)).min(1),
});

const newestFirst = (sessions) => [...sessions].sort((a, b) => b.ts.localeCompare(a.ts));

/** ts of the oldest session in the unbroken newest-first run that used `reps` for this exercise, or null. */
function levelSince(sessions, id, reps) {
  let since = null;
  for (const s of sessions) {
    if (s.targets?.[id]?.reps !== reps) break;
    since = s.ts;
  }
  return since;
}

const step = (value, cap) => (value === undefined ? undefined : Math.min(cap ?? value, Math.floor(value * (1 + STEP))));

/** Today's targets: the sheet, or the last level reached, raised ≤ 10% only after 3 clean sessions and a week at that level, never past the limits. */
export function nextTargets(routine, history, now = Date.now()) {
  const sessions = newestFirst(history);
  const recent = sessions.slice(0, CLEAN_RUN);
  const painful = recent.some((s) => s.pain);
  const clean = recent.length === CLEAN_RUN && recent.every((s) => s.completed && !s.pain);
  let progressed = false, allAtCap = true;
  const exercises = routine.exercises.map((ex) => {
    const capReps = routine.limits.maxReps ?? ex.reps; // no max on the sheet: the sheet value is the ceiling
    const capHold = routine.limits.maxHoldSec ?? ex.holdSec;
    const last = sessions[0]?.targets?.[ex.id] ?? {};
    const reps = Math.min(last.reps ?? ex.reps, capReps);
    const holdSec = last.holdSec ?? ex.holdSec;
    const since = levelSince(sessions, ex.id, reps);
    const ready = clean && since !== null && now - Date.parse(since) >= WEEK_MS;
    const next = ready ? { reps: step(reps, capReps), holdSec: step(holdSec, capHold) } : { reps, holdSec };
    if (next.reps > reps || (next.holdSec ?? 0) > (holdSec ?? 0)) progressed = true;
    if (next.reps < capReps) allAtCap = false;
    return { id: ex.id, name: ex.name, sets: ex.sets, ...next };
  });
  const reason = painful ? "Holding steady: there was a pain flag in your last 3 sessions."
    : !clean ? "Holding steady: it needs 3 completed, pain-free sessions in a row."
    : progressed ? "Up by up to 10%: 3 clean sessions and a week at this level."
    : allAtCap ? "You're at the limit your therapist set."
    : "Holding steady: each level is kept for 7 days before it rises.";
  return { exercises, progressed, reason };
}

const median = (xs) => { const s = [...xs].sort((a, b) => a - b), m = s.length >> 1; return s.length % 2 ? s[m] : (s[m - 1] + s[m]) / 2; };

/** Flare = the daily fist metric (higher is worse) beyond baseline + MDC95 on the 2 most recent days, which must be consecutive and recent. */
export function flareCheck(history, mdc95, now = Date.now(), tzOffsetMin = IST_MIN) {
  const day = (t) => new Date(t + tzOffsetMin * 60_000).toISOString().slice(0, 10);
  const scored = history.filter((s) => Number.isFinite(s.fistIndex));
  const byDay = Object.groupBy(scored, (s) => day(Date.parse(s.ts)));
  const days = Object.keys(byDay).sort().reverse();
  if (days.length < 2) return { flare: false, reason: "Not enough days of sessions yet." };
  const [d1, d2] = days;
  if (Date.parse(day(now)) - Date.parse(d1) > DAY_MS) return { flare: false, reason: "No session yesterday or today." };
  const older = scored.filter((s) => { const d = day(Date.parse(s.ts)); return d !== d1 && d !== d2; });
  if (older.length < MIN_BASELINE) return { flare: false, reason: `Need at least ${MIN_BASELINE} earlier sessions for a baseline.` };
  const baseline = median(older.map((s) => s.fistIndex));
  const [m1, m2] = [d1, d2].map((d) => median(byDay[d].map((s) => s.fistIndex)));
  const consecutive = Date.parse(d1) - Date.parse(d2) === DAY_MS;
  const worse = (m) => m - baseline > mdc95;
  if (consecutive && worse(m1) && worse(m2)) {
    return { flare: true, reason: `Your fist was less closed than your usual on ${d2} and ${d1}, by more than normal day-to-day variation.`, baseline, days: [d2, d1] };
  }
  return { flare: false, reason: "Within your normal range.", baseline };
}

/** Newest session vs the personal baseline (median fist of earlier sessions): a change counts only beyond MDC95. Lower = a tighter fist. */
export function progressOf(history, mdc95, now = Date.now(), tzOffsetMin = IST_MIN) {
  const day = (t) => new Date(t + tzOffsetMin * 60_000).toISOString().slice(0, 10);
  const sessions = newestFirst(history);
  const days = [...new Set(sessions.map((s) => day(Date.parse(s.ts))))];
  let streak = days.length && Date.parse(day(now)) - Date.parse(days[0]) <= DAY_MS ? 1 : 0;
  while (streak && streak < days.length && Date.parse(days[streak - 1]) - Date.parse(days[streak]) === DAY_MS) streak++;
  const [last = null, ...rest] = sessions;
  const earlier = rest.filter((s) => Number.isFinite(s.fistIndex));
  if (earlier.length < MIN_BASELINE) return { last, baseline: null, change: null, need: MIN_BASELINE - earlier.length, streak };
  const baseline = median(earlier.map((s) => s.fistIndex));
  if (!Number.isFinite(last.fistIndex)) return { last, baseline, change: null, streak };
  const delta = last.fistIndex - baseline;
  return { last, baseline, delta, change: Math.abs(delta) <= mdc95 ? "noise" : delta > 0 ? "looser" : "tighter", streak };
}
