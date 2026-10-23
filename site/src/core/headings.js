// Heading reveals: no two sections reveal their title the same way. Markup picks one with
// data-reveal on a [data-split] heading. Each moves only transform, opacity, colour or the font's own axes inside
// boxes pinned to their final width, so no line ever reflows (CLS). Reduced motion never reaches here.
import { gsap } from 'gsap';
import { ScrambleTextPlugin } from 'gsap/ScrambleTextPlugin';
import { REVEAL, EASE } from '../config.js';

gsap.registerPlugin(ScrambleTextPlugin);

const ROSE = '#FF6E9C'; // rose-night: the Live title sits on night

// Wraps each letter of the split words in .c (inline-block) so letters can move on their own.
function splitChars(words) {
  return words.flatMap((w) => {
    const letters = [...w.textContent].map((ch) => {
      const c = document.createElement('span');
      c.className = 'c';
      c.textContent = ch;
      return c;
    });
    w.replaceChildren(...letters);
    return letters;
  });
}

// Back to one text node per word once the letters have landed: the page ends exactly as the plain split left it.
const unsplit = (words) => words.forEach((w) => { w.textContent = w.textContent; });

// Pin each word to its laid-out width while its glyphs change, then let go.
const pin = (els) => els.forEach((e) => { e.style.width = `${e.getBoundingClientRect().width}px`; });
const unpin = (els) => els.forEach((e) => { e.style.width = ''; });

// The word's own wdth/wght (an <em> is condensed and heavy), so the flex lands exactly on the CSS.
function axes(el) {
  const cs = getComputedStyle(el);
  const get = (tag, fallback) => Number(cs.fontVariationSettings.match(new RegExp(`"${tag}"\\s+([\\d.]+)`))?.[1] ?? fallback);
  return [get('wdth', 100), get('wght', parseFloat(cs.fontWeight) || 400)];
}

// Why: words flex in on the width axis, narrowest first, like fingers opening.
function flex(tl, words) {
  gsap.set(words, { opacity: 0 });
  tl.call(() => pin(words), null, 0); // pinned when it plays, so a resize before then can't leave stale widths
  words.forEach((w, i) => {
    const [wd, wg] = axes(w);
    const s = { k: 0 };
    let shown = -1;
    // The width clicks open in 6 ticks, like a dial: a word re-rasterises only on a tick, not every frame (smooth flexing
    // of ~10 large words cost 33 ms frames at 4× CPU)
    const paint = () => {
      const q = Math.round(s.k * 6) / 6;
      if (q === shown) return;
      shown = q;
      w.style.fontVariationSettings = `"wdth" ${(50 + (wd - 50) * q).toFixed(1)}, "wght" ${wg}`;
    };
    tl.call(paint, null, 0)
      .to(w, { opacity: 1, duration: 0.2 }, i * 0.11)
      .to(s, { k: 1, duration: 0.38, ease: EASE.settle, onUpdate: paint, onComplete: () => { w.style.fontVariationSettings = ''; } }, i * 0.11);
  });
  tl.call(() => unpin(words));
}

// Noise: each word decodes out of readout digits (< 600 ms in all).
function decode(tl, words) {
  gsap.set(words, { opacity: 0 });
  tl.call(() => pin(words), null, 0);
  words.forEach((w, i) => {
    tl.to(w, { opacity: 1, duration: 0.05 }, i * 0.05)
      .to(w, { duration: 0.42, scrambleText: { text: w.textContent, chars: '0123456789%', revealDelay: 0.12, speed: 0.8 } }, i * 0.05);
  });
  tl.call(() => unpin(words));
}

// Fence: words rise, then an ink dashed line draws under the italic words and ends in the therapist's T flag (CSS).
function underline(tl, words, el) {
  const line = el.querySelector('em');
  tl.from(words, { yPercent: REVEAL.yPercent, duration: REVEAL.duration, stagger: REVEAL.stagger, ease: EASE.emergence }, 0);
  if (!line) return;
  line.classList.add('draw-line');
  gsap.set(line, { '--u': 0, '--t': 0 });
  tl.to(line, { '--u': 1, duration: 0.8, ease: 'power2.inOut' }, 0.45).to(line, { '--t': 1, duration: 0.4, ease: EASE.elastic });
}

// Grip: letters squash in like putty pressed flat, then spring back to shape.
function squash(tl, words, el) {
  el.classList.add('reveal-squash'); // letters may spill past the word mask while squashed; the mask returns after
  tl.from(splitChars(words), { scaleY: 0.2, scaleX: 1.5, yPercent: 35, opacity: 0, transformOrigin: '50% 100%', duration: 0.75, stagger: 0.028, ease: 'back.out(2.2)' })
    .call(() => { el.classList.remove('reveal-squash'); unsplit(words); });
}

// Report: words print left to right behind a rose caret, which blinks and goes.
function print(tl, words, el) {
  el.classList.add('reveal-print');
  const caret = document.createElement('i');
  caret.className = 'type-caret';
  caret.setAttribute('aria-hidden', 'true');
  el.append(caret);
  const place = (w) => {
    const b = el.getBoundingClientRect(), r = w.getBoundingClientRect();
    Object.assign(caret.style, { left: `${r.right - b.left + 4}px`, top: `${r.top - b.top}px`, height: `${r.height}px` });
  };
  gsap.set(words, { opacity: 0 });
  words.forEach((w, i) => tl.call(() => place(w), null, i * 0.11).set(w, { opacity: 1 }, i * 0.11));
  tl.to(caret, { opacity: 0, duration: 0.2, repeat: 5, yoyo: true, ease: 'steps(1)' }).set(caret, { opacity: 0 });
}

// Live: letters light up in scattered order, each flashing rose like a landmark being found, then settling.
function light(tl, words) {
  const chars = splitChars(words);
  const n = chars.length;
  const order = chars.map((_, i) => (i * 7) % n); // a fixed scatter, not random: the same every visit
  gsap.set(chars, { opacity: 0.16 });
  chars.forEach((c, i) => {
    const t = order[i] * 0.045, final = getComputedStyle(c).color;
    tl.set(c, { color: ROSE, opacity: 1 }, t).set(c, { color: final, clearProps: 'color' }, t + 0.3); // steps, not a colour tween: no repaint every frame
  });
  tl.call(() => unsplit(words));
}

const STYLES = { flex, decode, underline, squash, print, light };

export function revealHeading(el, words, kind) {
  const style = STYLES[kind];
  if (!style) return null;
  const tl = gsap.timeline({ scrollTrigger: { trigger: el, start: REVEAL.start, once: true } });
  style(tl, words, el);
  return tl;
}
