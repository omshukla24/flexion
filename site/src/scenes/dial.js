// The printed goniometer behind the hand, drawn once to a canvas texture. Its
// centre is the wrist; % curl runs from a0 (open) clockwise through sweep (fist).
// Never degrees: the metric is tip-to-knuckle / palm, not a joint angle.
export const DIAL = { size: 32, px: 2048, rOuter: 7.4, a0: 100, sweep: 90 };

const MONO = '"Atkinson Hyperlegible Mono", ui-monospace, monospace';

export function drawDial({ ground, ink, fence }) {
  const c = document.createElement('canvas');
  c.width = c.height = DIAL.px;
  const g = c.getContext('2d');
  const u = DIAL.px / DIAL.size; // px per world unit
  const cx = DIAL.px / 2;
  const cy = DIAL.px / 2;
  const ang = (v) => (-(DIAL.a0 - DIAL.sweep * v) * Math.PI) / 180;
  const at = (r, v) => [cx + Math.cos(ang(v)) * r * u, cy + Math.sin(ang(v)) * r * u];
  const line = (a, b, w, alpha = 1) => { g.globalAlpha = alpha; g.lineWidth = w; g.beginPath(); g.moveTo(...a); g.lineTo(...b); g.stroke(); };
  const text = (s, x, y, size, alpha = 1, weight = 600, align = 'left') => {
    g.globalAlpha = alpha; g.font = `${weight} ${size}px ${MONO}`; g.textAlign = align; g.fillText(s, x, y);
  };

  g.fillStyle = ground;
  g.fillRect(0, 0, c.width, c.height);
  // Studio light: a pool behind the hand, falling off to the edges.
  const pool = g.createRadialGradient(cx, cy - 3.2 * u, 0, cx, cy - 3.2 * u, 15 * u);
  pool.addColorStop(0, 'rgba(255,255,255,0.22)'); // soft: a stronger pool reads as glare
  pool.addColorStop(0.42, 'rgba(255,255,255,0)');
  pool.addColorStop(1, 'rgba(15,27,45,0.13)');
  g.fillStyle = pool;
  g.fillRect(0, 0, c.width, c.height);
  g.strokeStyle = ink;
  g.fillStyle = ink;
  g.lineCap = 'round';

  // Main scale: arc, 1 % ticks, numbers every 10.
  g.globalAlpha = 0.85;
  g.lineWidth = 3;
  g.beginPath();
  g.arc(cx, cy, DIAL.rOuter * u, ang(0), ang(1));
  g.stroke();
  for (let i = 0; i <= 100; i += 1) {
    const v = i / 100;
    const len = i % 10 === 0 ? 0.6 : i % 5 === 0 ? 0.38 : 0.2;
    line(at(DIAL.rOuter, v), at(DIAL.rOuter - len, v), i % 10 === 0 ? 3 : 1.6, 0.8);
    if (i % 10 === 0) {
      const [x, y] = at(DIAL.rOuter + 0.62, v);
      text(String(i).padStart(3, '0'), x, y + 7, 18, 0.8, 600, 'center');
    }
  }

  // The therapist's fence: ink, dashed, with its T flag.
  g.setLineDash([16, 11]);
  line(at(3.9, fence), at(DIAL.rOuter + 0.25, fence), 3.5, 0.95);
  g.setLineDash([]);
  const [fx, fy] = at(DIAL.rOuter + 0.55, fence);
  g.globalAlpha = 1;
  g.fillRect(fx - 4, fy - 34, 34, 34);
  g.fillStyle = ground;
  text('T', fx + 13, fy - 8, 24, 1, 800, 'center');
  g.fillStyle = ink;
  // Under the fence line's inner end, in the dial's empty corner: outside the arc it widened the dial past "100",
  // which shrank the whole hero to fit it.
  const [sx, sy] = at(3.9, fence);
  text('THERAPIST', sx, sy + 34, 20, 0.75);
  text(`LIMIT ${Math.round(fence * 100)} %`, sx, sy + 58, 20, 0.75);

  // Hub at the wrist.
  g.globalAlpha = 0.7;
  g.lineWidth = 2;
  g.beginPath();
  g.arc(cx, cy, 0.42 * u, 0, Math.PI * 2);
  g.stroke();

  g.globalAlpha = 1;
  return c;
}
