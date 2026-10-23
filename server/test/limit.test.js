import assert from "node:assert/strict";
import { test } from "node:test";
import { rateLimit } from "../src/limit.js";

test("allows the first call from a key and refuses a second one inside the gap", () => {
  const allow = rateLimit({ gapMs: 2000, perMinute: 30 });
  assert.equal(allow("a", 0), true);
  assert.equal(allow("a", 1999), false);
  assert.equal(allow("a", 2000), true);
});

test("keys don't share a gap", () => {
  const allow = rateLimit({ gapMs: 2000, perMinute: 30 });
  assert.equal(allow("a", 0), true);
  assert.equal(allow("b", 10), true);
});

test("caps all keys together per rolling minute, then frees up", () => {
  const allow = rateLimit({ gapMs: 0, perMinute: 3 });
  assert.deepEqual(["a", "b", "c", "d"].map((k, i) => allow(k, i)), [true, true, true, false]);
  assert.equal(allow("e", 60_000), true);
});

test("a refused call doesn't count against the minute", () => {
  const allow = rateLimit({ gapMs: 2000, perMinute: 2 });
  allow("a", 0);
  allow("a", 1); // refused by the gap
  assert.equal(allow("b", 2), true);
});

test("perKey caps one key's calls in all, while other keys still pass", () => {
  const allow = rateLimit({ gapMs: 0, perMinute: 100, perKey: 2 });
  assert.deepEqual([0, 1, 2].map((t) => allow("a", t)), [true, true, false]);
  assert.equal(allow("a", 120_000), false);
  assert.equal(allow("b", 3), true);
});
