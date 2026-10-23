// The needle field behind "Why": a field of goniometer needles at rest (0°). The pointer is a joint:
// needles within reach swing to read it on the needle spring and warm to rose. On touch the "joint" follows
// the scroll through the section. Reduced motion: one still frame. Sleeps when settled and off screen.
// Phones get none: needles swinging behind the body copy read as clutter.
import { gsap } from 'gsap';
import { prefersReducedMotion, hasFinePointer, cssVar } from '../core/env.js';
import { REST, grid, influence, wrap, springStep } from './needle-math.js';

const PITCH = 30;      // px between pivots (~1,500 needles on a 1440×900 screen)
const RADIUS = 210;    // px of reach
const LEN = 9;         // px needle length at rest; a reading needle grows to 1.7×
const SETTLED = 1e-3;  // rad and rad/s under which the field sleeps

export function createNeedleField(canvas, section) {
  const fine = hasFinePointer();
  if (!fine && canvas) canvas.hidden = true;
  const ctx = fine ? canvas?.getContext('2d') : null;
  if (!ctx) return () => {};
  const reduced = prefersReducedMotion();
  const k = Number(cssVar('--spring-needle-k')) || 220;
  const c = Number(cssVar('--spring-needle-c')) || 21.4;
  const rest = cssVar('--mist') || '#98A9B9';
  const hot = cssVar('--rose-night') || '#FF6E9C';
  let w = 0, h = 0, pts = new Float32Array(0), ang = new Float32Array(0), vel = new Float32Array(0), heat = new Float32Array(0);
  const p = { x: -1e4, y: -1e4, on: false };
  let awake = false, visible = false, running = false;

  function resize() {
    const dpr = Math.min(window.devicePixelRatio || 1, 2);
    w = section.clientWidth;
    h = section.clientHeight;
    canvas.width = Math.round(w * dpr);
    canvas.height = Math.round(h * dpr);
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    pts = grid(w, h, PITCH);
    const n = pts.length / 2;
    ang = new Float32Array(n).fill(REST);
    vel = new Float32Array(n);
    heat = new Float32Array(n);
    draw();
  }

  function draw() {
    ctx.clearRect(0, 0, w, h);
    ctx.lineCap = 'round';
    ctx.lineWidth = 1.25;
    ctx.strokeStyle = rest;
    ctx.globalAlpha = 0.2;
    ctx.beginPath();
    for (let i = 0, n = ang.length; i < n; i++) {
      if (heat[i] > 0.02) continue;
      const x = pts[i * 2], y = pts[i * 2 + 1];
      ctx.moveTo(x, y);
      ctx.lineTo(x + Math.cos(ang[i]) * LEN, y + Math.sin(ang[i]) * LEN);
    }
    ctx.stroke();
    ctx.strokeStyle = hot;
    for (let i = 0, n = ang.length; i < n; i++) {
      if (heat[i] <= 0.02) continue;
      const x = pts[i * 2], y = pts[i * 2 + 1], len = LEN * (1 + 0.7 * heat[i]);
      ctx.globalAlpha = 0.2 + 0.7 * heat[i];
      ctx.beginPath();
      ctx.moveTo(x, y);
      ctx.lineTo(x + Math.cos(ang[i]) * len, y + Math.sin(ang[i]) * len);
      ctx.stroke();
    }
    ctx.globalAlpha = 1;
  }

  const tick = (time, deltaMs) => {
    const dt = Math.min(deltaMs / 1000, 1 / 30);
    let moving = false;
    for (let i = 0, n = ang.length; i < n; i++) {
      // targetAngle() inlined: no per-needle allocation in the frame loop
      const dx = p.x - pts[i * 2], dy = p.y - pts[i * 2 + 1];
      const near = p.on ? influence(dx, dy, RADIUS) : 0;
      const goal = near ? REST + wrap(Math.atan2(dy, dx) - REST) * near : REST;
      [ang[i], vel[i]] = springStep(ang[i], vel[i], goal, k, c, dt);
      heat[i] += (near - heat[i]) * Math.min(1, dt * 10);
      if (Math.abs(vel[i]) > SETTLED || Math.abs(goal - ang[i]) > SETTLED || heat[i] > 0.02) moving = true;
    }
    draw();
    if (!moving && !p.on) { awake = false; sync(); }
  };
  function sync() {
    const want = visible && awake && !document.hidden;
    if (want && !running) gsap.ticker.add(tick);
    if (!want && running) gsap.ticker.remove(tick);
    running = want;
  }
  const wake = () => { if (!awake) { awake = true; sync(); } };

  const rect = () => canvas.getBoundingClientRect();
  const onMove = (e) => {
    const r = rect();
    p.x = e.clientX - r.left;
    p.y = e.clientY - r.top;
    p.on = p.x > -RADIUS && p.y > -RADIUS && p.x < w + RADIUS && p.y < h + RADIUS;
    if (p.on) wake();
  };
  const onLeave = () => { p.on = false; };
  // Touch: the joint walks down the section with the scroll, swinging across it.
  const onScroll = () => {
    const r = rect();
    const prog = Math.min(1, Math.max(0, (innerHeight - r.top) / (r.height + innerHeight)));
    p.x = w * (0.5 + 0.38 * Math.sin(prog * Math.PI * 2));
    p.y = h * prog;
    p.on = prog > 0 && prog < 1;
    if (p.on) wake();
  };

  const ro = new ResizeObserver(resize);
  ro.observe(section);
  if (reduced) return () => ro.disconnect();

  const io = new IntersectionObserver(([e]) => { visible = e.isIntersecting; if (!visible) p.on = false; sync(); });
  io.observe(section);
  document.addEventListener('visibilitychange', sync);
  if (fine) {
    window.addEventListener('pointermove', onMove, { passive: true });
    document.documentElement.addEventListener('pointerleave', onLeave);
  } else window.addEventListener('scroll', onScroll, { passive: true });

  return () => {
    gsap.ticker.remove(tick);
    ro.disconnect();
    io.disconnect();
    document.removeEventListener('visibilitychange', sync);
    window.removeEventListener('pointermove', onMove);
    document.documentElement.removeEventListener('pointerleave', onLeave);
    window.removeEventListener('scroll', onScroll);
  };
}
