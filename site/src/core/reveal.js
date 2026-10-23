// Scroll reveals. Markup opts in with attributes, so content stays plain HTML:
//   data-split     words rise out of a mask (no blur: a blurred lede read as text hidden behind text)
//   data-rise      fade up once when it enters
//   data-count     count to the value (data-prefix / data-suffix kept outside)
//   data-parallax  drift by that fraction of its height while in view
import { gsap } from 'gsap';
import { ScrollTrigger } from 'gsap/ScrollTrigger';
import { REVEAL, EASE } from '../config.js';
import { prefersReducedMotion } from './env.js';
import { formatCount } from './math.js';
import { revealHeading } from './headings.js';

// Wraps every word in .w-wrap > .w while keeping inline markup (em, strong, a).
export function splitWords(el) {
  if (el.dataset.splitDone) return el.querySelectorAll('.w');
  const walk = (node) => {
    for (const child of [...node.childNodes]) {
      if (child.nodeType === Node.TEXT_NODE) {
        const frag = document.createDocumentFragment();
        for (const part of child.textContent.split(/(\s+)/)) {
          if (!part) continue;
          if (/^\s+$/.test(part)) {
            frag.append(' ');
            continue;
          }
          const wrap = document.createElement('span');
          const word = document.createElement('span');
          wrap.className = 'w-wrap';
          word.className = 'w';
          word.textContent = part;
          wrap.append(word);
          frag.append(wrap);
        }
        child.replaceWith(frag);
      } else if (child.nodeType === Node.ELEMENT_NODE && child.tagName !== 'BR') {
        walk(child);
      }
    }
  };
  walk(el);
  el.dataset.splitDone = '1';
  return el.querySelectorAll('.w');
}

function countUp(el, reduced) {
  const target = parseFloat(el.dataset.count) || 0;
  if (reduced) {
    el.textContent = formatCount(target);
    return null;
  }
  const state = { v: 0 };
  el.textContent = '0';
  return gsap.to(state, {
    v: target,
    duration: 2.1,
    ease: EASE.emergence,
    paused: true,
    onUpdate: () => {
      el.textContent = formatCount(state.v);
    },
  });
}

export function initReveals(root = document) {
  const reduced = prefersReducedMotion();
  const triggers = [];
  const track = (tween) => tween?.scrollTrigger && triggers.push(tween.scrollTrigger);

  root.querySelectorAll('[data-split]').forEach((el) => {
    const words = splitWords(el);
    if (reduced || el.closest('[data-hero]')) return; // the hero runs its own intro
    if (el.dataset.reveal) return track(revealHeading(el, [...words], el.dataset.reveal)); // each section's own (headings.js)
    track(gsap.from(words, {
      yPercent: REVEAL.yPercent,
      duration: REVEAL.duration,
      stagger: REVEAL.stagger,
      ease: EASE.emergence,
      scrollTrigger: { trigger: el, start: REVEAL.start, once: true },
    }));
  });

  if (!reduced) {
    root.querySelectorAll('[data-rise]').forEach((el) => {
      track(gsap.from(el, {
        opacity: 0,
        y: 42,
        duration: 1,
        ease: EASE.settle,
        scrollTrigger: { trigger: el, start: 'top 92%', once: true },
      }));
    });
    root.querySelectorAll('[data-parallax]').forEach((el) => {
      const amount = parseFloat(el.dataset.parallax) || 0.15;
      track(gsap.fromTo(el, { yPercent: -amount * 50 }, {
        yPercent: amount * 50,
        ease: 'none',
        scrollTrigger: { trigger: el, start: 'top bottom', end: 'bottom top', scrub: true },
      }));
    });
  }

  root.querySelectorAll('[data-count]').forEach((el) => {
    const tween = countUp(el, reduced);
    if (!tween) return;
    triggers.push(ScrollTrigger.create({ trigger: el, start: 'top 88%', once: true, onEnter: () => tween.play() }));
  });

  return () => triggers.forEach((t) => t.kill());
}

// Hero headline: the masked lines (hidden by boot before the preloader opened) rise. The cast (eyebrow, sub, button)
// stays put: it is already painted under the preloader, and the sub is the LCP text.
export function playHeroIntro(hero) {
  if (!hero) return null;
  const lines = hero.querySelectorAll('[data-line]');
  const cast = hero.querySelectorAll('[data-hero-cast]');
  if (prefersReducedMotion()) {
    gsap.set([lines, cast], { clearProps: 'all' });
    return null;
  }
  return gsap.timeline().to(lines, { yPercent: 0, duration: 1.35, stagger: 0.12, ease: EASE.emergence });
}
