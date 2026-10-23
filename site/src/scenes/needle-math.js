// Needle field math. Every tick is a small goniometer needle resting at 0° (straight up); near the
// pointer it swings toward it on the site's needle spring. Pure, so it is tested without a canvas.
export const REST = -Math.PI / 2; // canvas y points down, so -90° is "up"
const TAU = Math.PI * 2;

// Angle in (-π, π], so a needle always takes the short way round.
export const wrap = (a) => {
  const r = (((a + Math.PI) % TAU) + TAU) % TAU - Math.PI;
  return r === -Math.PI ? Math.PI : r;
};

// Pivot points as [x0, y0, x1, y1, …], one per cell, the grid centred in the box.
export function grid(w, h, pitch) {
  const cols = Math.max(1, Math.floor(w / pitch));
  const rows = Math.max(1, Math.floor(h / pitch));
  const ox = (w - cols * pitch) / 2 + pitch / 2;
  const oy = (h - rows * pitch) / 2 + pitch / 2;
  const out = new Float32Array(cols * rows * 2);
  for (let r = 0, i = 0; r < rows; r++) for (let c = 0; c < cols; c++, i += 2) { out[i] = ox + c * pitch; out[i + 1] = oy + r * pitch; }
  return out;
}

// 1 at the pointer, 0 from the radius out, smoothstep between.
export function influence(dx, dy, radius) {
  const d = Math.hypot(dx, dy);
  if (d >= radius) return 0;
  const t = 1 - d / radius;
  return t * t * (3 - 2 * t);
}

export function targetAngle(x, y, px, py, radius) {
  const k = influence(px - x, py - y, radius);
  if (!k) return { angle: REST, k: 0 };
  return { angle: REST + wrap(Math.atan2(py - y, px - x) - REST) * k, k };
}

// Damped angular spring (semi-implicit Euler), error measured the short way round.
export function springStep(a, v, target, k, c, dt) {
  const nv = v + (k * wrap(target - a) - c * v) * dt;
  return [a + nv * dt, nv];
}
