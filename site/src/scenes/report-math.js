// "The Monday Report" sample week: the same numbers as /sample-report.pdf, which server/src/report.js built.
// An illustration week, not patient data.
import { clamp } from '../core/math.js';

const NORMAL = [0.18, 0.19];
const LOOSE = [0.3, 0.31];
export const SAMPLE = {
  patient: 'sample', hand: 'right', range: '2026-10-12 to 2026-10-18 (IST)',
  usual: 0.18, open: 0.77, mdc95: 0.063,
  days: [['MON', '10-12', NORMAL], ['TUE', '10-13', NORMAL], ['WED', '10-14', NORMAL], ['THU', '10-15', NORMAL], ['FRI', '10-16', NORMAL], ['SAT', '10-17', LOOSE], ['SUN', '10-18', LOOSE]],
};

const median = (xs) => { const s = [...xs].sort((a, b) => a - b), m = s.length >> 1; return s.length % 2 ? s[m] : (s[m - 1] + s[m]) / 2; };
/** Fist closure 0–1: how far the index fingertip travels from the open hand to the fist. */
export const closure = (fist, open) => clamp(1 - fist / open, 0, 1);

/** One gauge per day, as the PDF draws them: median closure, and whether it sits outside your usual band. */
export function dayGauges({ days, usual, open, mdc95 }) {
  const u = closure(usual, open), noise = mdc95 / open;
  return { usual: u, noise, days: days.map(([dow, date, fists]) => {
    const value = median(fists.map((f) => closure(f, open)));
    return { label: `${dow} ${date}`, value, off: Math.abs(value - u) > noise };
  }) };
}

/** A point on a gauge arc: 0 points straight up, 1 lies flat to the right (SVG, y down). */
export const onArc = (cx, cy, r, v) => [cx + r * Math.sin((v * Math.PI) / 2), cy - r * Math.cos((v * Math.PI) / 2)];
