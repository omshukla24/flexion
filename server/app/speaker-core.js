// The calm speaker's rules, pure: one line at a time, never cut off, a breath between lines
// (a voice that cuts itself off sounds like a machine). speaker.js plays what `next` hands it and calls `ended` when the line is over.
export const GAP_MS = 1200;    // silence after a line before the next one starts
export const REPEAT_MS = 8000; // the same words aren't said twice inside this window (a new step's line may be)
export const STALE_MS = 4000;  // a waiting count, fix or nudge older than this is no longer true: dropped
const RANK = { step: 3, fix: 2, count: 1, nudge: 0 };

export const IDLE = Object.freeze({ playing: null, pending: null, quietUntil: 0, last: null, saidAt: {} });

/** A line wants saying. It waits in the one pending slot; a newer line of equal or higher rank takes the slot. */
export function offer(q, line, now) {
  if (line.kind !== "step" && now - (q.saidAt[line.text] ?? -Infinity) < REPEAT_MS) return q;
  if (q.pending && RANK[q.pending.kind] > RANK[line.kind]) return q;
  return { ...q, pending: { ...line, at: now } };
}

/** → [queue, the line to start now or null]: nothing while a line plays or during the breath after one. */
export function next(q, now) {
  const p = q.pending;
  if (!p || q.playing || now < q.quietUntil) return [q, null];
  if (p.kind !== "step" && now - p.at > STALE_MS) return [{ ...q, pending: null }, null];
  return [{ ...q, pending: null, playing: p, last: p, saidAt: { ...q.saidAt, [p.text]: now } }, p];
}

/** The playing line is over; the breath starts. */
export const ended = (q, now, gap = GAP_MS) => ({ ...q, playing: null, quietUntil: now + gap });

/** How long a line should take to say: ~2.6 words a second at rate 1, plus a lead-in. A fallback when no end event comes. */
export const estimateMs = (text, rate = 1) => 400 + (text.trim().split(/\s+/).length / 2.6 / rate) * 1000;
