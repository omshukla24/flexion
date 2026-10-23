// "Try it live", the pure parts: which hand is which, and the end-of-session line.
// (When the voice speaks is server/app/session-core.js + speaker-core.js now, shared with the coach page.)

/** The user's real hand. HandLandmarker on our unmirrored frames already names it right: the swap the docs suggest
 * labelled a left hand "Right" on a real camera (2026-10-23). */
export const sideOf = (handedness) => ({ Left: 'Left', Right: 'Right' })[handedness] ?? '';

const GRIP = { pass: 'grip passed', fail: 'grip not done', skipped: 'grip skipped' };

/** The line on screen when a session ends. */
export function summary({ fistIndex, reps, grip }) {
  const fist = Number.isFinite(fistIndex) ? `Fist reading ${fistIndex.toFixed(2)}` : 'No fist reading';
  return `All done. ${fist}, ${reps} reps, ${GRIP[grip] ?? 'no grip task'}. Your report is ready below.`;
}
