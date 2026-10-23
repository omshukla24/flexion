// Pure helpers shared by the scenes. No DOM access here so they stay unit-testable.

export const clamp = (value, min, max) => Math.min(max, Math.max(min, value));

// Wraps any number into [0, 1).
export const frac = (value) => ((value % 1) + 1) % 1;

export const lerp = (a, b, t) => a + (b - a) * t;

// Frame-rate independent smoothing toward a target.
export const damp = (current, target, lambda, dtSeconds) =>
  lerp(current, target, 1 - Math.exp(-lambda * dtSeconds));

export const smoothstep = (edge0, edge1, x) => {
  const t = clamp((x - edge0) / (edge1 - edge0), 0, 1);
  return t * t * (3 - 2 * t);
};

// Pose of card `index` of `count` on the helix ring at `travel` (loops every 1.0).
// travel === index / count puts that card front and centre.
export function helixPose(index, count, travel, { turns, spread, falloff }, viewportHeight) {
  const offset = frac(0.5 + travel - index / count) - 0.5;
  const angle = offset * 360 * turns;
  const facing = (Math.cos((angle * Math.PI) / 180) + 1) / 2;
  const reach = Math.pow(1 - Math.min(1, Math.abs(offset) / falloff), 0.9);
  return {
    angle,
    y: offset * spread * viewportHeight,
    facing,
    opacity: reach * (0.18 + 0.82 * facing),
    zIndex: Math.round(100 * facing),
  };
}

// Travel value closest to `current` that brings card `index` to the front.
export function travelToFront(index, count, current) {
  const base = index / count;
  return base + Math.round(current - base);
}

export const nearestStep = (value, steps) => Math.round(value * steps) / steps;

export const padPercent = (progress) => String(Math.round(clamp(progress, 0, 1) * 100)).padStart(3, '0');

export const formatCount = (value, locale = 'en-US') => Math.round(value).toLocaleString(locale);

// Scale at which a glyph stroke `strokePx` wide (at scale 1) swallows the viewport.
export const portalScale = (strokePx, viewportW, viewportH, safety = 2.2) =>
  (Math.hypot(viewportW, viewportH) * safety) / Math.max(1, strokePx);

// Resting poses for a floating deck of `count` cards.
// x, y are percentages of the stage; z in px; rotations in degrees.
const DECK_LAYOUTS = {
  1: [{ x: 0, y: 2, z: 40, rx: 0, ry: 0, rz: 0 }],
  2: [
    { x: -24, y: 0, z: -20, rx: 0, ry: 20, rz: -3 },
    { x: 24, y: 0, z: -20, rx: 0, ry: -20, rz: 3 },
  ],
  3: [
    { x: -30, y: -6, z: -70, rx: -4, ry: 24, rz: -4 },
    { x: 0, y: 8, z: 30, rx: 3, ry: 0, rz: 0 },
    { x: 30, y: -6, z: -70, rx: -4, ry: -24, rz: 4 },
  ],
  4: [
    { x: -36, y: -8, z: -150, rx: -5, ry: 27, rz: -4 },
    { x: -12, y: 10, z: 10, rx: 6, ry: 11, rz: -3 },
    { x: 12, y: 10, z: 10, rx: 6, ry: -11, rz: 3 },
    { x: 36, y: -8, z: -150, rx: -5, ry: -27, rz: 4 },
  ],
};

export function deckSlots(count) {
  if (DECK_LAYOUTS[count]) return DECK_LAYOUTS[count];
  // Beyond four: fan the cards along a shallow arc, centre card forward.
  return Array.from({ length: count }, (_, i) => {
    const t = count === 1 ? 0 : i / (count - 1) - 0.5;
    return { x: t * 80, y: Math.abs(t) * -14 + 6, z: -Math.abs(t) * 260 + 20, rx: 0, ry: -t * 50, rz: t * 6 };
  });
}
