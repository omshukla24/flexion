// Pure seam geometry. Every seam reads one scroll progress p in [0, 1]
// and derives each part from it with a ramp, so scrolling back plays it in reverse.

export const ramp = (p, a, b) => Math.min(1, Math.max(0, (p - a) / (b - a)));
export const smooth = (t) => t * t * (3 - 2 * t);

// Goniometer sweep, triggered on the fence from 'top 100%' to 'top -25%' (125 vh of scroll).
// The arm rises 90° → 0° while the fence scrolls in (covering in the window ground), is up when the fence
// pins at 100/125, then falls back 0° → 90° to reveal it: extension, then flexion.
export const SWEEP = { start: 'top 100%', end: 'top -25%', coverEnd: 100 / 125, revealStart: 0.82 };
export function sweepAngle(p, { coverEnd, revealStart } = SWEEP) {
  if (p <= coverEnd) return 90 * (1 - smooth(ramp(p, 0, coverEnd)));
  if (p < revealStart) return 0;
  return 90 * smooth(ramp(p, revealStart, 1));
}

// Joint dive origin: the index PIP callout's screen position. On phones the callout is
// display: none (an all-zero rect), and it can leave the screen as the hero scrolls away;
// then the dive opens from just above centre.
export function diveOrigin(rect, vw, vh) {
  const laidOut = rect && (rect.left || rect.top || rect.width || rect.height);
  const onScreen = laidOut && rect.left >= 0 && rect.left <= vw && rect.top >= 0 && rect.top <= vh;
  return onScreen ? [rect.left, rect.top] : [vw * 0.5, vh * 0.45];
}

// Radius that covers the whole viewport from (x, y).
export const reach = (x, y, vw, vh) => Math.hypot(Math.max(x, vw - x), Math.max(y, vh - y));

// Landmark punch (preloader → hero): a MediaPipe landmark's row counted from the wrist (0), knuckles (1) out to the
// tips (4), so the holes open wrist first and run up the fingers.
export const punchDepth = (i) => (i === 0 ? 0 : ((i - 1) % 4) + 1);

// Hand-space points (y up) fitted to the screen: centred, `frac` of the shorter side tall, y turned down. `ref` sets
// the frame, so a curling hand keeps the open hand's scale instead of growing back to full height.
export function fitHand(points, vw, vh, frac = 0.6, ref = points) {
  const xs = ref.map((p) => p[0]), ys = ref.map((p) => p[1]);
  const [x0, x1, y0, y1] = [Math.min(...xs), Math.max(...xs), Math.min(...ys), Math.max(...ys)];
  const s = (frac * Math.min(vw, vh)) / (y1 - y0 || 1);
  const cx = (x0 + x1) / 2, cy = (y0 + y1) / 2;
  return points.map(([x, y]) => [vw / 2 + (x - cx) * s, vh / 2 - (y - cy) * s]);
}

// Print feed (grip → report): the page is laid in whole raster bands, never a smooth edge.
export const banded = (a, n) => Math.floor(a * n) / n;

// The footer hand's one wave: open → fist at the half → open, on the curl easing.
export const waveCurl = (t) => smooth(1 - Math.abs(1 - 2 * Math.min(1, Math.max(0, t))));
