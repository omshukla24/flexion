import { test } from 'node:test';
import assert from 'node:assert/strict';
import { wrap, grid, influence, targetAngle, springStep, REST } from '../src/scenes/needle-math.js';

const close = (a, b, eps = 1e-6) => assert.ok(Math.abs(a - b) < eps, `${a} vs ${b}`);

test('wrap keeps angles in (-π, π] so needles take the short way round', () => {
  close(wrap(0), 0);
  close(wrap(Math.PI * 1.5), -Math.PI / 2);
  close(wrap(-Math.PI * 1.5), Math.PI / 2);
});

test('grid fills the box at the pitch, centred, as x,y pairs', () => {
  const g = grid(300, 90, 30);
  assert.equal(g.length, 10 * 3 * 2);
  close(g[0], 15); close(g[1], 15);
  close(g[g.length - 2], 285); close(g[g.length - 1], 75);
});

test('influence is 1 at the pointer, 0 at and past the radius, smooth between', () => {
  close(influence(0, 0, 100), 1);
  assert.equal(influence(100, 0, 100), 0);
  assert.equal(influence(300, 0, 100), 0);
  close(influence(50, 0, 100), 0.5);
});

test('a needle at the pointer turns fully toward it; one out of reach stays at rest', () => {
  const near = targetAngle(100, 100, 100 + 1e-9, 100, 200); // pointer just right of the pivot
  close(near.angle, 0, 1e-3);
  const far = targetAngle(0, 0, 500, 500, 200);
  assert.equal(far.k, 0);
  close(far.angle, REST);
  const left = targetAngle(100, 100, 0, 100, 200); // pointer to the left: shortest turn from straight up is counter-clockwise
  assert.ok(left.angle < REST && left.angle >= -Math.PI);
});

test('the spring settles on the target and takes the short way across ±π', () => {
  let a = Math.PI - 0.1, v = 0;
  for (let i = 0; i < 240; i++) [a, v] = springStep(a, v, -Math.PI + 0.1, 220, 21.4, 1 / 60);
  close(wrap(a - (-Math.PI + 0.1)), 0, 1e-3);
  close(v, 0, 1e-2);
});
