import { test } from 'node:test';
import assert from 'node:assert/strict';
import { landmarks, BONES, TIPS, fingerCurls } from '../src/scenes/hand-pose.js';

const dist = (a, b) => Math.hypot(a[0] - b[0], a[1] - b[1], a[2] - b[2]);

test('returns 21 landmarks in MediaPipe order', () => {
  assert.equal(landmarks(0).length, 21);
  assert.equal(landmarks(1).length, 21);
});

test('bones are rigid: every bone keeps its length at any curl', () => {
  const open = landmarks(0);
  for (const c of [0.25, 0.5, 0.75, 1]) {
    const p = landmarks(c);
    BONES.forEach(([a, b]) => assert.ok(Math.abs(dist(p[a], p[b]) - dist(open[a], open[b])) < 1e-9, `bone ${a}-${b} at ${c}`));
  }
});

test('open hand points the fingers up; a fist brings the tips toward the palm side', () => {
  const open = landmarks(0);
  const fist = landmarks(1);
  for (const tip of TIPS.slice(1)) {
    const mcp = tip - 3;
    assert.ok(open[tip][1] > open[mcp][1] + 2, `tip ${tip} above its knuckle when open`);
    assert.ok(fist[tip][2] > 0.5, `tip ${tip} curls toward +z (palm side)`);
    assert.ok(dist(fist[tip], fist[0]) < dist(open[tip], open[0]), `tip ${tip} closer to the wrist in a fist`);
  }
});

test('curl is clamped and per-finger curls stay within 0..1', () => {
  assert.deepEqual(landmarks(-1), landmarks(0));
  assert.deepEqual(landmarks(2), landmarks(1));
  fingerCurls(1).forEach((v) => assert.ok(v >= 0 && v <= 1));
});
