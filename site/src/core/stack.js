// Stacked sections: each .stack section overlaps the one before with rounded
// shoulders (CSS), and the covered section dims as it is buried, selling depth.
import { gsap } from 'gsap';
import { prefersReducedMotion } from './env.js';

export function layerSections(sections) {
  sections.forEach((section, i) => {
    section.style.zIndex = String(i + 2);
  });
}

export function shadeOnCover(previous, section) {
  if (!previous || prefersReducedMotion()) return () => {};
  const tween = gsap.fromTo(previous, { '--shade': 0 }, {
    '--shade': 0.6,
    ease: 'none',
    scrollTrigger: { trigger: section, start: 'top bottom', end: 'top top', scrub: true },
  });
  return () => {
    tween.scrollTrigger?.kill();
    tween.kill();
  };
}
