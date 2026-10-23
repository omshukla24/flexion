// The footer hand: a small 21-landmark hand drawn like the live tracker's overlay. Once the
// wordmark has opened, it waves once: open → fist → open, with a little turn at the wrist. Static and open
// under reduced motion or "Pause motion".
import { gsap } from 'gsap';
import { landmarks, BONES, TIPS } from '../scenes/hand-pose.js';
import { fitHand, waveCurl } from './seam-math.js';
import { prefersReducedMotion } from './env.js';

const BOX = 64;
const SVG = 'http://www.w3.org/2000/svg';

export function initWaveHand(root = document) {
  const svg = root.querySelector('[data-wave-hand]');
  if (!svg) return () => {};
  const open = landmarks(0);
  const place = (curl) => fitHand(landmarks(curl), BOX, BOX, 0.9, open);
  const hand = document.createElementNS(SVG, 'g'); // svgOrigin needs a child, not the root <svg>
  svg.append(hand);
  const make = (tag, cls) => { const n = document.createElementNS(SVG, tag); n.setAttribute('class', cls); hand.append(n); return n; };
  const bones = BONES.map(() => make('line', 'wave-bone'));
  const joints = open.map((_, i) => make('circle', TIPS.includes(i) ? 'wave-joint is-tip' : 'wave-joint'));
  const draw = (curl) => {
    const pts = place(curl);
    BONES.forEach(([a, b], i) => {
      bones[i].setAttribute('x1', pts[a][0].toFixed(2)); bones[i].setAttribute('y1', pts[a][1].toFixed(2));
      bones[i].setAttribute('x2', pts[b][0].toFixed(2)); bones[i].setAttribute('y2', pts[b][1].toFixed(2));
    });
    joints.forEach((j, i) => { j.setAttribute('cx', pts[i][0].toFixed(2)); j.setAttribute('cy', pts[i][1].toFixed(2)); j.setAttribute('r', i === 0 ? 2.6 : 1.8); });
  };
  svg.setAttribute('viewBox', `0 0 ${BOX} ${BOX}`);
  draw(0);
  if (prefersReducedMotion()) return () => {};

  const [wx, wy] = place(0)[0];
  const wave = { t: 0 };
  let tl = null;
  const io = new IntersectionObserver(([e]) => {
    if (!e.isIntersecting) return;
    io.disconnect();
    if (document.documentElement.classList.contains('motion-paused')) return;
    tl = gsap.timeline({ delay: 1.4 }) // after the wordmark's letters have opened
      .to(wave, { t: 1, duration: 1.5, ease: 'none', onUpdate: () => draw(waveCurl(wave.t)) })
      .to(hand, { keyframes: { rotation: [0, -12, 9, -5, 0] }, svgOrigin: `${wx} ${wy}`, duration: 1.5, ease: 'sine.inOut' }, 0);
  }, { threshold: 0.6 });
  io.observe(svg);
  return () => { io.disconnect(); tl?.kill(); };
}
