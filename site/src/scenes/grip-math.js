// "The Grip" numbers: the putty ladder and how a squeeze dents the blob.
import { clamp } from '../core/math.js';

export const LEVELS = [
  { name: 'Extra soft', color: '#D9B98C' },
  { name: 'Soft', color: '#E9C846' },
  { name: 'Medium', color: '#E07A5F' },
  { name: 'Firm', color: '#5FAE76' },
  { name: 'Extra firm', color: '#4F7FCF' },
];

/** Ladder level for scroll progress 0–1: five equal steps. */
export const levelAt = (p) => Math.min(LEVELS.length - 1, Math.floor(clamp(p, 0, 1) * LEVELS.length));

const unit = ([x, y, z]) => { const n = Math.hypot(x, y, z); return [x / n, y / n, z / n]; };
// Where the five fingertips press on a unit blob: four fingers across the front, the thumb from the left.
export const PRESS = [[0.42, 0.52, 0.74], [0.5, 0.17, 0.85], [0.5, -0.17, 0.85], [0.42, -0.5, 0.76], [-0.9, 0.05, 0.43]].map(unit);
const WIDTH = 0.06; // dent size, in 1 − cos(angle from the fingertip): ~20° to 1/e depth

/** How deep the fingertips go on this level at full squeeze; firmer putty gives less. */
export const depthAt = (level) => 0.36 - level * 0.055;

/** How much of the full dent unit direction `v` gets (0–1). Fixed per point, so the scene computes it once. */
export function dentAt(v) {
  let dent = 0;
  for (const d of PRESS) dent += Math.exp(-(1 - (v[0] * d[0] + v[1] * d[1] + v[2] * d[2])) / WIDTH);
  return Math.min(1, dent);
}

/** How far the rest of the putty bulges at full squeeze; firmer putty bulges less. */
export const bulgeAt = (level) => 0.05 * (1 - level * 0.12);

/** Radial scale for unit direction `v` at squeeze `s` (0–1): dents under the fingertips, a slight bulge everywhere else.
 *  Linear in `s`, so the scene blends it on the GPU as two morph targets (bulge, dents). */
export const radius = (v, s, level) => 1 - s * depthAt(level) * dentAt(v) + s * bulgeAt(level);

/** Squeeze follows the hold: quick to press, slow to creep back, like real putty. */
export const squeezeStep = (s, held, dt) => s + ((held ? 1 : 0) - s) * (1 - Math.exp(-dt * (held ? 9 : 2.2)));
