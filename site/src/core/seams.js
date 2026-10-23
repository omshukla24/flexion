// Scene seams: one designed transition per scene change. Each is a fixed
// overlay scrubbed by the next section's arrival that moves only transform, clip and opacity,
// and is visible only while its timeline is part-way. Reduced motion keeps the meaning as a
// plain fade through the seam's cover colour (CSS hides the moving parts).
import { gsap } from 'gsap';
import { prefersReducedMotion } from './env.js';
import { ramp, smooth, SWEEP, sweepAngle, diveOrigin, reach, punchDepth, fitHand, banded } from './seam-math.js';

const SVG = 'http://www.w3.org/2000/svg';
const svgNode = (tag, attrs, parent) => {
  const n = document.createElementNS(SVG, tag);
  Object.entries(attrs).forEach(([k, v]) => n.setAttribute(k, v));
  parent?.append(n);
  return n;
};

// 0→1 Landmark punch (one-shot, run by the preloader): 21 rose landmarks of an open hand light up on the loader,
// then each opens as a hole, wrist first and up the fingers, until the page shows through. `open` = hand-space points.
export function landmarkPunch(el, open) {
  const tl = gsap.timeline();
  const vw = window.innerWidth, vh = window.innerHeight;
  if (!el || !vw || !vh) return tl; // zero-size viewport: the caller just removes the loader
  const pts = fitHand(open, vw, vh);
  const svg = svgNode('svg', { class: 'punch', viewBox: `0 0 ${vw} ${vh}`, 'aria-hidden': 'true' });
  const mask = svgNode('mask', { id: 'punch-holes', maskUnits: 'userSpaceOnUse', x: 0, y: 0, width: vw, height: vh }, svgNode('defs', {}, svg));
  svgNode('rect', { width: vw, height: vh, fill: '#fff' }, mask);
  svgNode('rect', { class: 'punch-ground', width: vw, height: vh, mask: 'url(#punch-holes)' }, svg);
  const make = (cls) => pts.map(([x, y]) => svgNode('circle', { cx: x.toFixed(1), cy: y.toFixed(1), r: 0, ...(cls ? { class: cls } : { fill: '#000' }) }, cls ? svg : mask));
  const holes = make(null), rings = make('punch-ring'), dots = make('punch-dot');
  el.append(svg);
  el.classList.add('is-punching'); // from here the masked rect paints the loader's ground (CSS)
  const at = (i) => punchDepth(i) * 0.1;
  tl.to(dots, { attr: { r: 5 }, duration: 0.3, ease: 'back.out(2)', stagger: (i) => at(i) * 0.6 }).addLabel('open', '+=0.1');
  pts.forEach(([x, y], i) => {
    const r = reach(x, y, vw, vh);
    tl.to([holes[i], rings[i]], { attr: { r }, duration: 1, ease: 'power3.in' }, `open+=${at(i)}`)
      .to(rings[i], { opacity: 0, duration: 1, ease: 'power2.in' }, `open+=${at(i)}`)
      .to(dots[i], { opacity: 0, duration: 0.25 }, `open+=${at(i)}`);
  });
  return tl;
}

function seam(el, trigger, start, end, build, onFrame) {
  if (!el || !trigger) return () => {};
  const reduced = prefersReducedMotion();
  const tl = gsap.timeline({
    scrollTrigger: { trigger, start, end, scrub: 0.6 },
    onUpdate: () => {
      const p = tl.progress();
      el.style.visibility = p > 0 && p < 1 ? 'visible' : 'hidden';
      if (!reduced) onFrame?.(p);
    },
  });
  if (reduced) tl.fromTo(el, { opacity: 0 }, { opacity: 1, ease: 'none', duration: 0.5 }).to(el, { opacity: 0, ease: 'none', duration: 0.5 });
  else build(tl);
  return () => { tl.scrollTrigger?.kill(); tl.kill(); };
}

const hold = (tl) => tl.to({}, { duration: 1 }); // the frame callback draws; the timeline only carries progress

// 1→2 Joint dive: from the rose PIP bead the hero camera dives to, a thin rose ring opens with night right
// behind it (v4: no full-screen rose flood), while the hero veil turns night underneath, then night fades into Why.
export function jointDive(el, { next, anchor, veil }) {
  const [rose, night] = el?.querySelectorAll('.dive-disc') ?? [];
  let origin = null; // locked where the joint was when the dive began, so the disc never chases it off-screen
  return seam(el, next, 'top bottom', 'top 35%', hold, (p) => {
    const vw = window.innerWidth, vh = window.innerHeight;
    if (!origin || p < 0.02) origin = diveOrigin(anchor?.getBoundingClientRect(), vw, vh);
    const [x, y] = origin;
    const r = reach(x, y, vw, vh), at = `at ${x}px ${y}px`;
    const ring = smooth(ramp(p, 0, 0.6)) * (r + 60);
    rose.style.clipPath = `circle(${ring.toFixed(1)}px ${at})`;
    night.style.clipPath = `circle(${Math.max(0, ring - 0.05 * Math.min(vw, vh)).toFixed(1)}px ${at})`;
    el.style.opacity = String(1 - ramp(p, 0.8, 1));
    if (veil) veil.style.opacity = String(ramp(p, 0.3, 0.6));
  });
}

// 2→3 Hatch sweep: the noise band's MDC95 hatch rules across the screen behind a rose edge, then narrows into the
// band the beads drop into and lifts off the pinned noise scene. Transforms only: a clip-path here repainted the
// whole screen every frame (33 ms at 4× CPU).
export function hatchSweep(el, next) {
  const cover = el?.querySelector('.hatch-cover'), edge = el?.querySelector('.hatch-edge');
  return seam(el, next, 'top 85%', 'top top', hold, (p) => {
    const across = smooth(ramp(p, 0, 0.45)), narrow = smooth(ramp(p, 0.5, 0.88)) * 0.86; // a 14 % band is left
    cover.style.transform = `translateX(${((across - 1) * 100).toFixed(2)}%) scaleY(${(1 - narrow).toFixed(4)})`;
    edge.style.transform = `translateX(${(across * window.innerWidth).toFixed(1)}px)`;
    edge.style.opacity = String(1 - ramp(p, 0.42, 0.5));
    el.style.opacity = String(1 - ramp(p, 0.86, 1));
  });
}

// 3→4 Goniometer sweep: an arm pivots on the bottom-left corner. It rises while the fence scrolls
// in and the window ground follows it (a rotated half-plane, so no repaint), then falls back once the fence
// pins and reveals it. The printed scale counter-rotates so it stays still. Until the arm is up,
// a night layer rides the fence's top edge, so the open wedge only ever shows the noise scene.
export function goniometerSweep(el, next) {
  const veil = el?.querySelector('.sweep-hold'), fill = el?.querySelector('.sweep-fill'), print = el?.querySelector('.sweep-print'), arm = el?.querySelector('.sweep-arm');
  return seam(el, next, SWEEP.start, SWEEP.end, hold, (p) => {
    const a = sweepAngle(p);
    veil.style.transform = `translateY(${Math.max(0, next.getBoundingClientRect().top).toFixed(1)}px)`;
    veil.style.opacity = p < SWEEP.coverEnd ? '1' : '0';
    fill.style.transform = arm.style.transform = `rotate(${a.toFixed(2)}deg)`;
    print.style.transform = `rotate(${(-a).toFixed(2)}deg)`;
  });
}

// 4→5 Tape on, tape off: three strips of kinesiology tape lay on across the fence with a stretch from one end,
// then peel away from the other end, onto the putty. Each strip's tilt is its CSS `rotate`, so GSAP's adds to it.
export function tapeOnOff(el, next) {
  const strips = el ? [...el.querySelectorAll('.tape')] : [];
  return seam(el, next, 'top 95%', 'top 5%', (tl) => {
    gsap.set(strips, { scaleX: 0, transformOrigin: '0% 50%' });
    tl.to(strips, { scaleX: 1, ease: 'power3.out', duration: 0.42, stagger: 0.06 })
      .set(strips, { transformOrigin: '100% 50%' }, '+=0.04')
      .to(strips, { rotation: -16, yPercent: -170, ease: 'power2.in', duration: 0.42, stagger: 0.06 });
  });
}

// 5→6 Print feed: a print head with a rose LED runs down the screen and lays a page behind it in raster bands;
// crop marks snap in at the corners, then the page lifts onto the report desk.
export function printFeed(el, next) {
  const page = el?.querySelector('.print-page'), head = el?.querySelector('.print-head'), marks = el ? [...el.querySelectorAll('.crop')] : [];
  return seam(el, next, 'top 95%', 'top 5%', hold, (p) => {
    const run = ramp(p, 0.04, 0.6), snap = ramp(p, 0.6, 0.66);
    page.style.clipPath = `inset(0 0 ${(100 - banded(run, 16) * 100).toFixed(2)}% 0)`;
    head.style.transform = `translateY(${(run * window.innerHeight).toFixed(1)}px)`;
    head.style.opacity = String(1 - snap);
    marks.forEach((c) => { c.style.opacity = String(snap); c.style.transform = `scale(${(1.6 - 0.6 * snap).toFixed(3)})`; });
    el.style.opacity = String(1 - ramp(p, 0.8, 1));
  });
}

// 6→7 Fist wipe, its only use: five finger bands close, little finger first, then open on your
// camera with the tips turning from rose to white.
export function fistWipe(el, next) {
  const bands = el ? [...el.children].reverse() : [];
  return seam(el, next, 'top 85%', 'top 5%', (tl) => {
    gsap.set(bands, { yPercent: -101, '--tip': '#E0457B' });
    tl.to(bands, { yPercent: 0, ease: 'power2.in', duration: 0.5, stagger: 0.05 })
      .to(bands, { yPercent: -101, ease: 'power2.out', duration: 0.5, stagger: 0.05 })
      .to(bands, { '--tip': '#FFFFFF', ease: 'none', duration: 0.25, stagger: 0.05 }, 0.7);
  });
}
