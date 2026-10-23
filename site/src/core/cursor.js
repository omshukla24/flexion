// Two-part cursor: a fast difference-blended dot and a lagging ring.
// Hover targets grow the ring; data-cursor-label="Drag" writes a word inside it;
// data-cursor="hidden" hands the pointer to a scene that draws its own.
import { gsap } from 'gsap';
import { CURSOR } from '../config.js';
import { hasFinePointer, prefersReducedMotion } from './env.js';

const INTERACTIVE = '[data-cursor], a, button, [role="button"], summary, label, select';

export function initCursor() {
  if (!hasFinePointer() || prefersReducedMotion()) return () => {};

  const dot = document.createElement('div');
  const ring = document.createElement('div');
  const label = document.createElement('span');
  dot.className = 'cursor-dot';
  ring.className = 'cursor-ring';
  label.className = 'cursor-label';
  dot.setAttribute('aria-hidden', 'true');
  ring.setAttribute('aria-hidden', 'true');
  // The dot is a goniometer hub: a short rose needle turns toward where the pointer is heading.
  const hub = document.createElement('div');
  const needle = document.createElement('i');
  hub.className = 'cursor-hub';
  hub.setAttribute('aria-hidden', 'true');
  hub.append(needle);
  ring.append(label);
  document.body.append(ring, hub, dot);
  document.documentElement.dataset.cursor = 'custom';

  gsap.set([dot, ring], { xPercent: -50, yPercent: -50, autoAlpha: 0 });
  gsap.set(hub, { autoAlpha: 0 });
  const dotX = gsap.quickTo([dot, hub], 'x', { duration: CURSOR.dotLerp, ease: 'power3' });
  const dotY = gsap.quickTo([dot, hub], 'y', { duration: CURSOR.dotLerp, ease: 'power3' });
  let angle = -45, aim = -45, lastX = 0, lastY = 0, onTarget = false;
  const turn = () => {
    const d = ((aim - angle + 540) % 360) - 180; // the short way round
    if (Math.abs(d) < 0.1) return;
    angle += d * 0.16;
    needle.style.rotate = `${angle.toFixed(1)}deg`;
  };
  gsap.ticker.add(turn);
  // Click: a thin peak-hold tick stays where the needle's tip was for a second, like today's best on the dial.
  const tick = (e) => {
    const rad = ((angle - 90) * Math.PI) / 180, len = 20;
    const t = document.createElement('i');
    t.className = 'cursor-tick';
    t.setAttribute('aria-hidden', 'true');
    document.body.append(t);
    gsap.set(t, { x: e.clientX + Math.cos(rad) * len, y: e.clientY + Math.sin(rad) * len, rotation: angle, xPercent: -50, yPercent: -50 });
    gsap.to(t, { autoAlpha: 0, delay: 1, duration: 0.35, onComplete: () => t.remove() });
  };
  const ringX = gsap.quickTo(ring, 'x', { duration: CURSOR.ringLerp, ease: 'power3' });
  const ringY = gsap.quickTo(ring, 'y', { duration: CURSOR.ringLerp, ease: 'power3' });

  let visible = false;
  let hidden = false;
  const show = (on) => {
    if (on === visible) return;
    visible = on;
    gsap.to([dot, ring], { autoAlpha: on && !hidden ? 1 : 0, duration: 0.3, overwrite: 'auto' });
    gsap.to(hub, { autoAlpha: on && !hidden && !onTarget ? 1 : 0, duration: 0.3, overwrite: 'auto' });
  };

  const onMove = (e) => {
    const dx = e.clientX - lastX, dy = e.clientY - lastY;
    if (dx * dx + dy * dy > 16) {
      aim = (Math.atan2(dy, dx) * 180) / Math.PI + 90; // the needle is drawn pointing up
      lastX = e.clientX;
      lastY = e.clientY;
    }
    dotX(e.clientX);
    dotY(e.clientY);
    ringX(e.clientX);
    ringY(e.clientY);
    show(true);
  };

  const onOver = (e) => {
    const target = e.target instanceof Element ? e.target.closest(INTERACTIVE) : null;
    const mode = target?.dataset.cursor;
    const text = target?.dataset.cursorLabel || '';
    hidden = mode === 'hidden';
    onTarget = Boolean(target);
    gsap.to([dot, ring], { autoAlpha: hidden ? 0 : 1, duration: 0.25, overwrite: 'auto' });
    gsap.to(hub, { autoAlpha: hidden || onTarget ? 0 : 1, duration: 0.25, overwrite: 'auto' }); // on a button the ring speaks
    if (hidden) return;
    label.textContent = text;
    ring.classList.toggle('is-active', Boolean(target));
    ring.classList.toggle('has-label', Boolean(text));
    const scale = text ? CURSOR.labelScale : target ? CURSOR.hoverScale : 1;
    gsap.to(ring, { scale, duration: 0.4, ease: 'power3.out', overwrite: 'auto' });
    gsap.to(dot, { scale: target ? 0.4 : 1, duration: 0.4, ease: 'power3.out', overwrite: 'auto' });
  };

  const onLeaveWindow = (e) => {
    if (!e.relatedTarget) show(false);
  };
  const onDown = (e) => {
    gsap.to(ring, { scale: '-=0.25', duration: 0.15, overwrite: 'auto' });
    if (!hidden && !onTarget) tick(e);
  };
  const onUp = (e) => onOver(e);

  window.addEventListener('pointermove', onMove, { passive: true });
  document.addEventListener('pointerover', onOver);
  document.addEventListener('pointerout', onLeaveWindow);
  window.addEventListener('pointerdown', onDown);
  window.addEventListener('pointerup', onUp);

  return () => {
    window.removeEventListener('pointermove', onMove);
    document.removeEventListener('pointerover', onOver);
    document.removeEventListener('pointerout', onLeaveWindow);
    window.removeEventListener('pointerdown', onDown);
    window.removeEventListener('pointerup', onUp);
    gsap.ticker.remove(turn);
    dot.remove();
    ring.remove();
    hub.remove();
    delete document.documentElement.dataset.cursor;
  };
}
