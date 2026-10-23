// Lenis smooth scroll driven by the GSAP ticker, so ScrollTrigger, Lenis and every
// scene share one clock. Reduced motion keeps native scrolling.
import Lenis from 'lenis';
import { gsap } from 'gsap';
import { ScrollTrigger } from 'gsap/ScrollTrigger';
import { LENIS } from '../config.js';
import { prefersReducedMotion } from './env.js';

gsap.registerPlugin(ScrollTrigger);

let lenis = null;

export function initScroll() {
  gsap.defaults({ ease: 'expo.out', duration: 0.8 });
  ScrollTrigger.defaults({ anticipatePin: 1, fastScrollEnd: true });

  let resizeTimer;
  const onResize = () => {
    clearTimeout(resizeTimer);
    resizeTimer = setTimeout(() => ScrollTrigger.refresh(), 200);
  };
  window.addEventListener('resize', onResize);

  if (prefersReducedMotion()) {
    return () => window.removeEventListener('resize', onResize);
  }

  lenis = new Lenis({ ...LENIS, autoRaf: false });
  lenis.on('scroll', ScrollTrigger.update);
  const tick = (time) => lenis.raf(time * 1000);
  gsap.ticker.add(tick);
  gsap.ticker.lagSmoothing(0);

  return () => {
    window.removeEventListener('resize', onResize);
    gsap.ticker.remove(tick);
    lenis.destroy();
    lenis = null;
  };
}

export const getLenis = () => lenis;

export const scrollVelocity = () => (lenis ? lenis.velocity : 0);

export function stopScroll() {
  lenis?.stop();
  document.documentElement.classList.add('is-locked');
}

export function startScroll() {
  lenis?.start();
  document.documentElement.classList.remove('is-locked');
}

// Scroll to a number (px) or an element, through Lenis when it is running.
export function scrollToTarget(target, options = {}) {
  if (lenis) {
    lenis.scrollTo(target, { duration: 1.4, ...options });
    return;
  }
  const top = typeof target === 'number' ? target : target.getBoundingClientRect().top + window.scrollY;
  window.scrollTo({ top, behavior: prefersReducedMotion() ? 'auto' : 'smooth' });
}
