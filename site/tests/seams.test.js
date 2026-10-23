import { test } from 'node:test';
import assert from 'node:assert/strict';
import { ramp, smooth, SWEEP, sweepAngle, diveOrigin, reach, punchDepth, fitHand, banded, waveCurl } from '../src/core/seam-math.js';

const close = (a, b) => assert.ok(Math.abs(a - b) < 1e-9, `${a} vs ${b}`);
test('ramp clamps to 0..1 and smooth keeps its ends', () => {
  assert.equal(ramp(-1, 0.2, 0.6), 0);
  close(ramp(0.4, 0.2, 0.6), 0.5);
  assert.equal(ramp(2, 0.2, 0.6), 1);
  assert.equal(smooth(0), 0);
  assert.equal(smooth(1), 1);
  assert.equal(smooth(0.5), 0.5);
});

test('goniometer arm rises to vertical as the fence pins, holds, then falls back', () => {
  assert.equal(sweepAngle(0), 90);
  assert.equal(sweepAngle(SWEEP.coverEnd), 0);
  assert.equal(sweepAngle((SWEEP.coverEnd + SWEEP.revealStart) / 2), 0);
  assert.equal(sweepAngle(1), 90);
  // monotonic on each leg, so scrolling never jitters the arm
  for (let p = 0.01; p <= SWEEP.coverEnd; p += 0.01) assert.ok(sweepAngle(p) <= sweepAngle(p - 0.01));
  for (let p = SWEEP.revealStart + 0.01; p <= 1; p += 0.01) assert.ok(sweepAngle(p) >= sweepAngle(p - 0.01));
});

test('cover ends exactly when the fence pins: 90 vh of a 115 vh trigger', () => {
  const vh = (s) => Number(s.match(/-?\d+/)[0]);
  close(SWEEP.coverEnd, vh(SWEEP.start) / (vh(SWEEP.start) - vh(SWEEP.end)));
});

test('dive opens from the callout, or from above centre when it is hidden or off-screen', () => {
  assert.deepEqual(diveOrigin({ left: 600, top: 300, width: 0, height: 0 }, 1440, 900), [600, 300]);
  diveOrigin({ left: 0, top: 0, width: 0, height: 0 }, 390, 844).forEach((v, i) => close(v, [195, 379.8][i]));
  assert.deepEqual(diveOrigin({ left: 600, top: -40, width: 0, height: 0 }, 1440, 900), [720, 405]);
  assert.deepEqual(diveOrigin(undefined, 1000, 800), [500, 360]);
});

test('reach covers the farthest corner', () => {
  assert.equal(reach(0, 0, 300, 400), 500);
  assert.equal(reach(150, 200, 300, 400), 250);
});

test('landmark punch opens wrist first, then each joint row out to the tips', () => {
  assert.equal(punchDepth(0), 0);
  assert.deepEqual([1, 5, 9, 13, 17].map(punchDepth), [1, 1, 1, 1, 1]);
  assert.deepEqual([4, 8, 12, 16, 20].map(punchDepth), [4, 4, 4, 4, 4]);
  assert.deepEqual([2, 7, 11, 19].map(punchDepth), [2, 3, 3, 3]);
});

test('fitHand centres the hand, keeps its proportions and turns y down', () => {
  const pts = fitHand([[0, 0], [2, 4], [-2, 2]], 1000, 800, 0.5);
  assert.deepEqual(pts[0], [500, 600]); // the lowest point (wrist) sits lowest on screen
  assert.deepEqual(pts[1], [700, 200]); // 4 units tall = 0.5 × 800 px, so 100 px a unit
  assert.deepEqual(pts[2], [300, 400]);
  // in the open hand's frame, a smaller pose stays small
  assert.deepEqual(fitHand([[0, 0], [0, 2]], 1000, 800, 0.5, [[0, 0], [0, 4]]), [[500, 600], [500, 400]]);
});

test('print feed lays the page in whole bands', () => {
  assert.equal(banded(0, 14), 0);
  assert.equal(banded(0.07, 14), 0);
  assert.equal(banded(0.5, 14), 0.5);
  assert.equal(banded(1, 14), 1);
  for (let a = 0; a <= 1; a += 0.013) assert.ok(banded(a, 14) <= a + 1e-12);
});

test('the footer hand waves: open, a fist halfway, open again', () => {
  assert.equal(waveCurl(0), 0);
  close(waveCurl(0.5), 1);
  close(waveCurl(1), 0);
  assert.ok(waveCurl(0.25) > 0 && waveCurl(0.25) < 1);
});
