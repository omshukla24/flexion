// [data-magnetic] elements lean toward the pointer; an optional
// [data-magnetic-inner] child leans further for a parallax-within-the-button feel.
import { gsap } from 'gsap';
import { CURSOR, EASE } from '../config.js';
import { hasFinePointer, prefersReducedMotion } from './env.js';

export function initMagnetic(root = document) {
  if (!hasFinePointer() || prefersReducedMotion()) return () => {};
  const offs = [];

  root.querySelectorAll('[data-magnetic]').forEach((el) => {
    const inner = el.querySelector('[data-magnetic-inner]');
    const targets = [el, inner].filter(Boolean);
    let rect = null;

    const enter = () => {
      gsap.set(targets, { x: 0, y: 0 });
      rect = el.getBoundingClientRect(); // measured at rest so the pull does not chase itself
    };
    const move = (e) => {
      if (!rect) enter();
      const dx = e.clientX - (rect.left + rect.width / 2);
      const dy = e.clientY - (rect.top + rect.height / 2);
      const pull = { duration: 0.6, ease: EASE.settle, overwrite: 'auto' };
      gsap.to(el, { x: dx * CURSOR.magneticPullX, y: dy * CURSOR.magneticPullY, ...pull });
      if (inner) gsap.to(inner, { x: dx * CURSOR.magneticInner, y: dy * CURSOR.magneticInner, ...pull });
    };
    const leave = () => {
      rect = null;
      gsap.to(targets, { x: 0, y: 0, duration: 1.1, ease: EASE.elastic, overwrite: 'auto' });
    };

    el.addEventListener('pointerenter', enter);
    el.addEventListener('pointermove', move);
    el.addEventListener('pointerleave', leave);
    offs.push(() => {
      el.removeEventListener('pointerenter', enter);
      el.removeEventListener('pointermove', move);
      el.removeEventListener('pointerleave', leave);
      gsap.set(targets, { clearProps: 'transform' });
    });
  });

  return () => offs.forEach((off) => off());
}
