import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  clamp, frac, smoothstep, helixPose, travelToFront, nearestStep,
  padPercent, formatCount, portalScale, deckSlots,
} from '../src/core/math.js';

const RING = { turns: 0.5, spread: 2.4, falloff: 0.46 };

test('frac wraps negatives into [0, 1)', () => {
  assert.equal(frac(1.25), 0.25);
  assert.equal(frac(-0.25), 0.75);
  assert.equal(frac(3), 0);
});

test('clamp and smoothstep hold their bounds', () => {
  assert.equal(clamp(5, 0, 1), 1);
  assert.equal(clamp(-5, 0, 1), 0);
  assert.equal(smoothstep(0, 1, -1), 0);
  assert.equal(smoothstep(0, 1, 2), 1);
  assert.equal(smoothstep(0, 1, 0.5), 0.5);
});

test('helixPose puts the card whose travel matches it front and centre', () => {
  const pose = helixPose(2, 5, 2 / 5, RING, 1000);
  assert.equal(Math.round(pose.angle), 0);
  assert.equal(Math.round(pose.y), 0);
  assert.equal(pose.facing, 1);
  assert.equal(pose.zIndex, 100);
  assert.ok(pose.opacity > 0.99);
});

test('helixPose fades cards past the falloff to zero', () => {
  const far = helixPose(0, 2, 0.5, RING, 1000);
  assert.equal(far.opacity, 0);
  assert.ok(far.zIndex < 100);
});

test('travelToFront picks the nearest equivalent loop position', () => {
  assert.equal(travelToFront(1, 4, 0.2), 0.25);
  assert.equal(travelToFront(1, 4, 2.1), 2.25);
  assert.equal(travelToFront(3, 4, 0.1), -0.25);
});

test('nearestStep snaps to the card grid', () => {
  assert.equal(nearestStep(0.33, 5), 0.4);
  assert.equal(nearestStep(0.09, 5), 0);
});

test('padPercent gives the three-digit HUD counter', () => {
  assert.equal(padPercent(0), '000');
  assert.equal(padPercent(0.48), '048');
  assert.equal(padPercent(1.4), '100');
});

test('formatCount groups thousands', () => {
  assert.equal(formatCount(9999.6), '10,000');
});

test('portalScale grows as the stroke gets thinner', () => {
  const thick = portalScale(40, 1920, 1080);
  const thin = portalScale(10, 1920, 1080);
  assert.ok(thin > thick);
  assert.ok(thick * 40 >= Math.hypot(1920, 1080));
});

test('deckSlots returns one pose per card for any count', () => {
  const keys = ['x', 'y', 'z', 'rx', 'ry', 'rz'];
  for (const n of [1, 2, 3, 4, 6, 9]) {
    const slots = deckSlots(n);
    assert.equal(slots.length, n);
    for (const s of slots) for (const k of keys) assert.equal(typeof s[k], 'number');
  }
});
