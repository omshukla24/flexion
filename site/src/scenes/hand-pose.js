// Pure hand-pose math for "The Reading": 21 landmarks in MediaPipe order for a
// curl value 0 (open) .. 1 (fist). Hand space: wrist at the origin, fingers up
// (+y), palm facing +z, units ~ 2.5 cm. No three.js here, so Node can test it.

const P = (x, y, z = 0) => [x, y, z];
const add = (a, b, s = 1) => [a[0] + b[0] * s, a[1] + b[1] * s, a[2] + b[2] * s];
const norm = (v) => { const l = Math.hypot(...v) || 1; return [v[0] / l, v[1] / l, v[2] / l]; };
const dirAt = (deg) => [Math.cos((deg * Math.PI) / 180), Math.sin((deg * Math.PI) / 180), 0];

export const WRIST = P(0, 0);
export const THUMB_CMC = P(-0.95, 0.7, 0.15);
// MCP, rest direction (deg from +x), bone lengths MCP->PIP->DIP->TIP
export const FINGERS = [
  { name: 'index', mcp: P(-0.95, 3.5), dir: 101, len: [1.5, 0.92, 0.75], k: 0.94 },
  { name: 'middle', mcp: P(-0.12, 3.7), dir: 90, len: [1.68, 1.05, 0.8], k: 1 },
  { name: 'ring', mcp: P(0.65, 3.55), dir: 81, len: [1.55, 0.95, 0.75], k: 0.97 },
  { name: 'little', mcp: P(1.32, 3.18), dir: 71, len: [1.22, 0.75, 0.62], k: 0.9 },
];
const THUMB = { dir: 125, len: [1.1, 0.95, 0.75], bend: norm([0.85, 0.15, 0.6]), mult: [0.55, 0.85, 0.7] };
const JOINT = [1.0, 1.15, 0.75]; // MCP, PIP, DIP share of the curl

// One finger chain: rest direction d, bending toward n by cumulative angles.
function chain(base, d, bend, len, angles) {
  const dot = bend[0] * d[0] + bend[1] * d[1] + bend[2] * d[2];
  const n = norm(add(bend, d, -dot)); // bend must be perpendicular to d, or bones stretch
  const pts = [];
  let p = base;
  let th = 0;
  len.forEach((l, i) => {
    th += angles[i];
    p = add(add(p, d, l * Math.cos(th)), n, l * Math.sin(th));
    pts.push(p);
  });
  return pts;
}

export function landmarks(curl) {
  const c = Math.min(1, Math.max(0, curl));
  const q = (c * Math.PI) / 2;
  const thumb = chain(THUMB_CMC, dirAt(THUMB.dir), THUMB.bend, THUMB.len, THUMB.mult.map((m) => m * q * 1.4));
  const out = [WRIST, THUMB_CMC, ...thumb];
  for (const f of FINGERS) out.push(f.mcp, ...chain(f.mcp, dirAt(f.dir), [0, 0, 1], f.len, JOINT.map((j) => j * q * f.k)));
  return out;
}

// Per-finger curl as the product reports it (0..1), thumb first.
export const fingerCurls = (curl) => [0.8, ...FINGERS.map((f) => f.k)].map((k) => Math.min(1, curl * k));

export const BONES = [
  [0, 1], [1, 2], [2, 3], [3, 4],
  [0, 5], [5, 6], [6, 7], [7, 8],
  [5, 9], [9, 10], [10, 11], [11, 12],
  [9, 13], [13, 14], [14, 15], [15, 16],
  [13, 17], [17, 18], [18, 19], [19, 20], [0, 17],
];
export const TIPS = [4, 8, 12, 16, 20];
// Bead radius per landmark: wrist, then per joint rank.
export const radius = (i) => (i === 0 ? 0.34 : TIPS.includes(i) ? 0.2 : [1, 5, 9, 13, 17].includes(i) ? 0.27 : 0.23);
