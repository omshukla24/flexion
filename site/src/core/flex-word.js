// The footer wordmark flexes like a hand: it opens letter by letter when it comes into view (fist → open), then
// letters near the pointer curl toward a fist and turn rose. Tokens: --flex-open "wdth" 128 "wght" 540, --flex-fist 58 / 860.
import { gsap } from 'gsap';
import { prefersReducedMotion } from './env.js';

const OPEN = [128, 540], FIST = [58, 860];
const REACH = 1.5; // a letter starts to curl when the pointer is within 1.5 letter-widths

export function initFlexWord(root = document) {
  const word = root.querySelector('[data-flex-word]');
  if (!word) return () => {};
  const letters = [...word.children].map((el) => ({ el, k: 0, target: 0 }));
  const paint = (l) => {
    l.el.style.fontVariationSettings = `"wdth" ${OPEN[0] + (FIST[0] - OPEN[0]) * l.k}, "wght" ${OPEN[1] + (FIST[1] - OPEN[1]) * l.k}`;
    l.el.style.setProperty('--k', l.k.toFixed(3));
  };
  // Size the word to fill its row with every letter open, whatever the font's metrics; then pin each letter's slot to
  // its open size, so a curling letter repaints only itself and never reflows the row (4× CPU: 29 ms frames before).
  const fit = () => {
    const ks = letters.map((l) => l.k);
    // contain: size (CSS) would measure every slot as 0, so it is lifted while measuring
    letters.forEach((l) => { l.k = 0; paint(l); Object.assign(l.el.style, { width: '', height: '', contain: 'none' }); });
    word.style.fontSize = '100px';
    const natural = letters.reduce((a, l) => a + l.el.getBoundingClientRect().width, 0);
    if (!natural) return; // not laid out yet (hidden); the resize or fonts-ready call fits it
    word.style.fontSize = `${(100 * word.clientWidth / natural) * 0.97}px`;
    const sizes = letters.map((l) => l.el.getBoundingClientRect());
    letters.forEach((l, i) => { Object.assign(l.el.style, { width: `${sizes[i].width}px`, height: `${sizes[i].height}px`, contain: '' }); l.k = ks[i]; paint(l); });
  };
  fit();
  document.fonts?.ready.then(fit);
  window.addEventListener('resize', fit);
  if (prefersReducedMotion()) return () => window.removeEventListener('resize', fit);

  let ready = false;
  letters.forEach((l) => { l.k = 1; paint(l); });
  const io = new IntersectionObserver(([e]) => {
    if (!e.isIntersecting) return;
    io.disconnect();
    // One letter after another, each repainting only itself: two or three giant glyphs re-render per frame, not seven.
    letters.forEach((l, i) => gsap.to(l, { k: 0, duration: 0.36, delay: i * 0.17, ease: 'power3.out', onUpdate: () => paint(l),
      onComplete: i === letters.length - 1 ? () => { ready = true; } : undefined }));
  }, { threshold: 0.5 });
  io.observe(word);

  const onMove = (e) => {
    const r = word.getBoundingClientRect();
    const near = e.clientY > r.top - r.height * 0.5 && e.clientY < r.bottom + r.height * 0.5;
    letters.forEach((l) => {
      const b = l.el.getBoundingClientRect();
      l.target = near ? Math.max(0, 1 - Math.abs(e.clientX - (b.left + b.width / 2)) / (b.width * REACH)) : 0;
    });
  };
  const onLeave = () => letters.forEach((l) => { l.target = 0; });
  const tick = () => {
    if (!ready || document.documentElement.classList.contains('motion-paused')) return; // the footer's "Pause motion"
    letters.forEach((l) => {
      const k = l.k + (l.target - l.k) * 0.14;
      if (Math.abs(k - l.k) > 0.001) { l.k = k; paint(l); }
    });
  };
  window.addEventListener('pointermove', onMove, { passive: true });
  document.addEventListener('pointerleave', onLeave);
  gsap.ticker.add(tick);
  return () => {
    window.removeEventListener('resize', fit);
    io.disconnect();
    window.removeEventListener('pointermove', onMove);
    document.removeEventListener('pointerleave', onLeave);
    gsap.ticker.remove(tick);
  };
}
