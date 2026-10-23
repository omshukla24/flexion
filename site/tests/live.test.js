import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { sideOf, summary } from '../src/scenes/live-math.js';

// When the voice speaks is tested with the coach page's own code (server/test/session-core, speaker-core, talk-core).

// A real camera test, 2026-10-23: with the swap, a left hand read "Right" and a right hand "Left".
test('sideOf keeps MediaPipe handedness as the real hand (our frames are unmirrored)', () => {
  assert.equal(sideOf('Left'), 'Left');
  assert.equal(sideOf('Right'), 'Right');
  assert.equal(sideOf('?'), '');
});

test('summary reads the finished session in plain words and points at the report', () => {
  assert.equal(summary({ fistIndex: 0.18, reps: 10, grip: 'pass' }), 'All done. Fist reading 0.18, 10 reps, grip passed. Your report is ready below.');
  assert.equal(summary({ fistIndex: null, reps: 0, grip: 'fail' }), 'All done. No fist reading, 0 reps, grip not done. Your report is ready below.');
});

test('the live section never speaks on its own: no speechSynthesis or cancel in live.js, only the shared coach voice', () => {
  const src = readFileSync(new URL('../src/scenes/live.js', import.meta.url), 'utf8');
  assert.doesNotMatch(src, /speechSynthesis|SpeechSynthesisUtterance/);
  assert.match(src, /createCoachVoice/);
});
