// The Noise Band's numbers: validation run 4 (2026-10-20, spike/day1/data/run4-build4-confirm-G2.csv),
// index fingertip-to-knuckle distance divided by palm length, 10 re-formed fists.
export const FISTS = [0.188, 0.238, 0.169, 0.193, 0.189, 0.175, 0.171, 0.178, 0.152, 0.18];
export const OPEN = 0.766;

export const mean = (xs) => xs.reduce((s, x) => s + x, 0) / xs.length;
export const sd = (xs) => {
  const m = mean(xs);
  return Math.sqrt(xs.reduce((s, x) => s + (x - m) ** 2, 0) / (xs.length - 1));
};
export const BASE = mean(FISTS);
// shortcut (same as the spike): SD of repeat trials as the SEM; switch to an ICC-based SEM with test-retest data.
export const MDC95 = 1.96 * Math.SQRT2 * sd(FISTS);

// Lower = the fingertip closes further toward the knuckle = a tighter fist.
export function verdict(v) {
  const d = v - BASE;
  if (Math.abs(d) <= MDC95) return 'noise';
  return d > 0 ? 'looser' : 'tighter';
}

// Dot plot: each value takes the lowest row where it doesn't touch an earlier bead.
export function stackRows(values, minGap) {
  const placed = [];
  return values.map((v) => {
    let row = 0;
    while (placed.some((p) => p.row === row && Math.abs(p.v - v) < minGap)) row += 1;
    placed.push({ v, row });
    return row;
  });
}
