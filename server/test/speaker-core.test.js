import { test } from "node:test";
import assert from "node:assert/strict";
import { IDLE, offer, next, ended, GAP_MS, REPEAT_MS, STALE_MS, estimateMs } from "../app/speaker-core.js";

const line = (text, kind = "count", id = text) => ({ id, line: null, kind, text });

test("a line starts at once when nothing plays", () => {
  const [q, say] = next(offer(IDLE, line("That's one."), 0), 0);
  assert.equal(say.text, "That's one.");
  assert.equal(q.playing.text, "That's one.");
});

test("never interrupts: a new line waits for the current one, then a breath", () => {
  let [q] = next(offer(IDLE, line("Open your hand wide.", "step"), 0), 0);
  q = offer(q, line("That's one."), 500);
  assert.equal(next(q, 600)[1], null, "still playing");
  q = ended(q, 2000);
  assert.equal(next(q, 2000 + GAP_MS - 1)[1], null, "the breath");
  assert.equal(next(q, 2000 + GAP_MS)[1].text, "That's one.");
});

test("one line waits: a newer line of equal or higher rank replaces it, a lower one doesn't", () => {
  let [q] = next(offer(IDLE, line("A", "step"), 0), 0);
  q = offer(q, line("That's one."), 10);
  q = offer(q, line("Thumb across the outside.", "fix"), 20);
  q = offer(q, line("Take your time.", "nudge"), 30);
  assert.equal(q.pending.text, "Thumb across the outside.");
  q = offer(q, line("Well done. Now a fist.", "step"), 40);
  assert.equal(q.pending.text, "Well done. Now a fist.");
});

test("a waiting count, fix or nudge older than the stale time is dropped; a step line never is", () => {
  let [q] = next(offer(IDLE, line("A", "step"), 0), 0);
  q = ended(offer(q, line("That's one."), 10), 100);
  assert.equal(next(q, 10 + STALE_MS + 1)[1], null);
  [q] = next(offer(IDLE, line("A", "step"), 0), 0);
  q = ended(offer(q, line("Now a fist.", "step"), 10), 100);
  assert.equal(next(q, 10 + STALE_MS * 3)[1].text, "Now a fist.");
});

test("the same words aren't said again within the repeat window, except a step line", () => {
  let [q] = next(offer(IDLE, line("I can't see your hand.", "nudge"), 0), 0);
  q = ended(q, 1500);
  q = offer(q, line("I can't see your hand.", "nudge", 2), 4000);
  assert.equal(q.pending, null);
  q = offer(q, line("I can't see your hand.", "nudge", 3), REPEAT_MS + 1);
  assert.equal(q.pending.text, "I can't see your hand.");
  [q] = next(offer(IDLE, line("Okay, let's carry on.", "step"), 0), 0);
  q = offer(ended(q, 1000), line("Okay, let's carry on.", "step", 9), 2000);
  assert.ok(q.pending);
});

test("a line's estimated length grows with its words and with a slower rate", () => {
  assert.ok(estimateMs("Okay.", 1) < estimateMs("Let's stop and rest. If it keeps hurting, tell your therapist.", 1));
  assert.ok(estimateMs("Two more.", 0.85) > estimateMs("Two more.", 1));
});
