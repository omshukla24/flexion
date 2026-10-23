import { test } from 'node:test';
import assert from 'node:assert/strict';
import { FISTS, BASE, MDC95, verdict, stackRows } from '../src/scenes/band-math.js';
import { simulate, flareIndex, DAYS } from '../src/scenes/fence-math.js';
import { LEVELS, PRESS, levelAt, radius, squeezeStep } from '../src/scenes/grip-math.js';
import { SAMPLE, dayGauges, onArc } from '../src/scenes/report-math.js';

test('noise band reproduces the validation run-4 numbers', () => {
  assert.equal(FISTS.length, 10);
  assert.equal(BASE.toFixed(3), '0.183');
  assert.equal(MDC95.toFixed(3), '0.063');
});

test('verdict: inside the band is noise; outside says which way', () => {
  assert.equal(verdict(BASE), 'noise');
  assert.equal(verdict(BASE + MDC95 - 0.001), 'noise');
  assert.equal(verdict(BASE + MDC95 + 0.001), 'looser');
  assert.equal(verdict(BASE - MDC95 - 0.001), 'tighter');
});

test('dot plot stacks touching beads and keeps distant ones on the floor', () => {
  assert.deepEqual(stackRows([0.1, 0.105, 0.2, 0.102], 0.01), [0, 1, 0, 2]);
});

test('the target never passes the fence, with or without the gentle routine', () => {
  for (const fence of [0.55, 0.72, 0.9]) {
    for (const gentleFrom of [-1, 16]) {
      const days = simulate({ fence, gentleFrom });
      assert.equal(days.length, DAYS);
      days.forEach((d) => assert.ok(d.target <= fence + 1e-12, `day ${d.day} fence ${fence}`));
    }
  }
});

test('two low mornings in a row raise the flare on the second one', () => {
  const days = simulate({ fence: 0.72 });
  assert.equal(flareIndex(days), 15);
  assert.equal(flareIndex(simulate({ fence: 0.72, flare: [] })), -1);
});

test('grip: scroll walks the five putty levels in order', () => {
  assert.deepEqual([0, 0.19, 0.21, 0.5, 0.79, 0.81, 1].map(levelAt), [0, 0, 1, 2, 3, 4, 4]);
  assert.equal(LEVELS.length, 5);
});

test('grip: no squeeze, no dent; fingertips dent, firmer putty dents less', () => {
  const away = [0, -1, 0];
  assert.equal(radius(PRESS[1], 0, 2), 1);
  assert.ok(radius(PRESS[1], 1, 0) < 0.8, 'extra soft dents deep');
  assert.ok(radius(PRESS[1], 1, 4) > radius(PRESS[1], 1, 0), 'extra firm dents less');
  assert.ok(radius(away, 1, 0) > 1, 'the rest bulges a little');
});

test('grip: the squeeze is linear, so two GPU morph targets (bulge, dents) reproduce it exactly', () => {
  for (const v of [PRESS[0], PRESS[4], [0, -1, 0], [0.6, 0.6, 0.52]]) {
    for (const level of [0, 2, 4]) {
      for (const s of [0.25, 0.7]) assert.ok(Math.abs(radius(v, s, level) - (1 + s * (radius(v, 1, level) - 1))) < 1e-12);
    }
  }
});

test('grip: squeeze presses fast and creeps back slowly', () => {
  let s = 0;
  for (let i = 0; i < 12; i += 1) s = squeezeStep(s, true, 1 / 60);
  assert.ok(s > 0.8, `pressed ${s}`);
  let r = 1;
  for (let i = 0; i < 12; i += 1) r = squeezeStep(r, false, 1 / 60);
  assert.ok(r > 0.6, `released ${r}`);
});

test('report: the sample week matches the sample PDF (76 % on normal days, 60 % flagged on Sat and Sun)', () => {
  const g = dayGauges(SAMPLE);
  assert.deepEqual(g.days.map((d) => Math.round(d.value * 100)), [76, 76, 76, 76, 76, 60, 60]);
  assert.deepEqual(g.days.map((d) => d.off), [false, false, false, false, false, true, true]);
  assert.equal(Math.round(g.usual * 100), 77);
});

test('report: gauge arcs run from straight up (0) to flat right (1)', () => {
  const near = (a, b) => a.every((v, i) => Math.abs(v - b[i]) < 1e-9);
  assert.ok(near(onArc(0, 0, 10, 0), [0, -10]));
  assert.ok(near(onArc(0, 0, 10, 1), [10, 0]));
});

test('the gentle routine slows the climb after the flare', () => {
  const normal = simulate({ fence: 0.95 });
  const gentle = simulate({ fence: 0.95, gentleFrom: 16 });
  assert.ok(gentle[27].target < normal[27].target);
  assert.equal(gentle[15].target, normal[15].target);
});
