// Flexion site boot. Order matters: preloader, sections top to bottom,
// chrome last, then the hero intro. The preloader ends on fonts; the Reading loads in
// its own chunk after first paint and fades in when ready (three.js no longer
// sits in front of the hero copy, so it stops counting against LCP).
import './styles/tokens.css';
import './styles/base.css';
import './styles/components.css';
import './styles/flexion.css';
import { gsap } from 'gsap';
import { ScrollTrigger } from 'gsap/ScrollTrigger';
import { prefersReducedMotion } from './core/env.js';
import { initScroll, stopScroll, startScroll } from './core/scroll.js';
import { runPreloader } from './core/preloader.js';
import { initCursor } from './core/cursor.js';
import { initMagnetic } from './core/magnetic.js';
import { initReveals, playHeroIntro } from './core/reveal.js';
import { initNav } from './core/nav.js';
import { initFlexWord } from './core/flex-word.js';
import { layerSections, shadeOnCover } from './core/stack.js';
import { lerp } from './core/math.js';
import { initLive } from './scenes/live.js';
import { createNeedleField } from './scenes/needle-field.js';
import { jointDive, hatchSweep, goniometerSweep, tapeOnOff, printFeed, fistWipe } from './core/seams.js';
import { initWaveHand } from './core/wave-hand.js';

const BRAND = 'FLEXION';
const pad3 = (v) => String(Math.round(v)).padStart(3, '0');

function heroScrollOut(hero) {
  const tl = gsap.timeline({ scrollTrigger: { trigger: hero, start: 'top top', end: 'bottom bottom', scrub: 0.8 } });
  tl.to(hero.querySelector('.hero-copy'), { y: -80, opacity: 0, ease: 'none', duration: 0.3 }, 0.08)
    .to(hero.querySelectorAll('.hero-hint'), { opacity: 0, ease: 'none', duration: 0.1 }, 0)
    .to(hero.querySelector('.hud'), { opacity: 0, ease: 'none', duration: 0.08 }, 0.52); // gone before the dive, so it never runs up under the bar
  return () => {
    tl.scrollTrigger?.kill();
    tl.kill();
  };
}

// Live readout: HUD rows, the pinned PIP callout, and the wordmark that flexes with the hand.
function readingView(hero) {
  const rows = [...hero.querySelectorAll('.hud-row')].map((r) => ({ bar: r.querySelector('i'), val: r.querySelector('b') }));
  const peak = hero.querySelector('[data-hud-peak]');
  const pip = hero.querySelector('[data-anchor-val]');
  const marks = [hero.querySelector('[data-wordmark]'), document.querySelector('[data-flex-brand]')];
  return ({ curls, peak: best, curl }) => {
    curls.forEach((v, i) => {
      rows[i].bar.style.width = `${v * 100}%`;
      rows[i].val.textContent = pad3(v * 100);
    });
    peak.textContent = `${pad3(best * 100)} %`;
    pip.textContent = pad3(curls[1] * 100);
    const fv = `"wdth" ${lerp(128, 58, curl).toFixed(1)}, "wght" ${lerp(540, 860, curl).toFixed(0)}`;
    marks.forEach((m) => m && (m.style.fontVariationSettings = fv));
  };
}

// Readouts beside the set-pieces. Status colour only where it means something (v4): amber = a flag, green = a real improvement.
function noiseView(section) {
  const val = section.querySelector('[data-noise-val]');
  const out = section.querySelector('[data-noise-verdict]');
  const words = { noise: ['Normal day-to-day noise', ''], looser: ['Real change: a looser fist than usual', 'care'], tighter: ['Real change: a tighter fist than usual', 'ok'] };
  return ({ value, verdict }) => {
    val.textContent = value.toFixed(3);
    [out.textContent, out.dataset.tone] = words[verdict];
  };
}

function fenceView(section, scene) {
  const q = (sel) => section.querySelector(sel);
  section.querySelectorAll('[data-gentle]').forEach((b) => b.addEventListener('click', () => scene()?.setGentle(b.dataset.gentle === 'yes')));
  return (d) => {
    q('[data-day]').textContent = String(d.day).padStart(2, '0');
    q('[data-target]').textContent = pad3(d.target * 100);
    q('[data-fence-val]').textContent = pad3(d.fence * 100);
    const status = q('[data-fence-status]');
    const atFence = d.target >= d.fence - 0.001;
    [status.textContent, status.dataset.tone] = d.low ? ['Low morning: below your usual range', 'care']
      : d.gentle === true ? ['Gentle routine, as you chose', '']
        : atFence ? ['Holding at your therapist’s limit', ''] : ['Building up', ''];
    q('[data-ask]').hidden = !d.prompt;
  };
}

function gripView(section) {
  const q = (sel) => section.querySelector(sel);
  const steps = [...section.querySelectorAll('.ladder li')];
  return ({ level, name, squeeze }) => {
    q('[data-grip-n]').textContent = String(level + 1).padStart(2, '0');
    q('[data-grip-squeeze]').textContent = pad3(squeeze * 100);
    if (q('[data-grip-name]').textContent !== name) q('[data-grip-name]').textContent = name;
    steps.forEach((li, i) => li.setAttribute('aria-current', String(i === level)));
  };
}

function reportView(section) {
  const day = section.querySelector('[data-report-day]');
  const out = section.querySelector('[data-report-status]');
  const words = { print: ['Printing the page…', ''], stack: ['Stacking the mornings', ''], flare: ['Flare flagged: Saturday and Sunday', 'care'], sign: ['Ready for your therapist to sign', ''] };
  return ({ days, phase }) => {
    day.textContent = String(days);
    [out.textContent, out.dataset.tone] = words[phase];
  };
}

// Easter egg: type `zaliff` anywhere, or open /#zaliff, and the glass hand becomes the Zaliff prosthesis.
function zaliff(reading, hero) {
  if (!reading || !hero) return () => {};
  const head = hero.querySelector('.hud-head span');
  const greeting = hero.querySelector('[data-greeting]');
  const before = { head: head?.textContent, greeting: greeting?.textContent };
  let on = false, typed = '';
  const toggle = () => {
    on = !on;
    reading.setSkin(on ? 'zaliff' : 'glass');
    if (head) head.textContent = on ? 'Calibrated · Zaliff' : before.head;
    if (greeting) greeting.textContent = on ? 'New hand, same routine.' : before.greeting;
  };
  const onKey = (e) => {
    if (e.key.length !== 1 || e.ctrlKey || e.metaKey || e.altKey) return;
    typed = (typed + e.key.toLowerCase()).slice(-6);
    if (typed === 'zaliff') { typed = ''; toggle(); }
  };
  document.addEventListener('keydown', onKey);
  if (location.hash === '#zaliff') toggle();
  return () => document.removeEventListener('keydown', onKey);
}

// Section index gauge: a single arc whose needle shows how far down the page the section sits. No number:
// printed as "047 %" it read as a measurement beside the real ones.
function indexGauges(sections) {
  const max = Math.max(1, document.documentElement.scrollHeight - window.innerHeight);
  sections.forEach((section) => {
    const idx = section.querySelector('.index[data-gauge]');
    if (!idx || idx.querySelector('svg')) return;
    const p = Math.min(1, Math.max(0, section.offsetTop / max));
    const a = Math.PI * (1 - p);
    const svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
    svg.setAttribute('viewBox', '0 0 26 15');
    svg.setAttribute('aria-hidden', 'true');
    svg.innerHTML = `<path d="M2 13 A11 11 0 0 1 24 13"/><line x1="13" y1="13" x2="${(13 + 9 * Math.cos(a)).toFixed(1)}" y2="${(13 - 9 * Math.sin(a)).toFixed(1)}"/>`;
    idx.prepend(svg);
  });
}

function greet(el) {
  if (!el) return;
  const now = new Date();
  const h = now.getHours();
  const part = h < 12 ? 'Good morning' : h < 18 ? 'Good afternoon' : 'Good evening';
  el.textContent = `${part} · ${now.toTimeString().slice(0, 5)} · hand check`;
}

function countLandmarks(el, reduced) {
  if (!el) return;
  const n = { v: reduced ? 21 : 0 };
  const render = () => { el.textContent = String(Math.round(n.v)).padStart(2, '0'); };
  if (reduced) return render();
  gsap.to(n, { v: 21, duration: 1.9, ease: 'power2.out', onUpdate: render });
}

// Phones and tablets: the report page fills exactly the band between the copy and the readout (it ran under the title).
function fitPaper(section) {
  const stage = section?.querySelector('.paper-stage');
  const col = section?.querySelector('.piece-col');
  const copy = col?.querySelector('.piece-copy');
  const readout = col?.querySelector('.readout');
  if (!stage || !copy || !readout) return () => {};
  const sheet = section.querySelector('[data-session-sheet]');
  // The one-check sheet sits under the weekly page's left edge, as big as the free desk allows; hidden if it can't fit.
  // It is pulled out from under the weekly page by the same scroll that prints the week.
  let slide = null, q = 0;
  const placeSheet = () => {
    const paper = stage.getBoundingClientRect(); // the stage is sized to the page (width = height × 0.79)
    if (!sheet || !paper.width) return;
    const box = section.querySelector('.piece-sticky').getBoundingClientRect();
    const right = paper.left + paper.width * 0.1;
    const w = Math.min(paper.height * 0.84 * (935 / 1210), right - col.getBoundingClientRect().right - 32), h = w * (1210 / 935);
    const fits = window.innerWidth > 900 && w >= paper.width * 0.55; // smaller than that reads as clutter, not a page
    sheet.hidden = !fits;
    if (!fits) return;
    Object.assign(sheet.style, { left: `${right - w - box.left}px`, top: `${paper.bottom - box.top - h - paper.height * 0.06}px`, width: `${w}px`, height: `${h}px` });
    slide?.kill();
    slide = gsap.fromTo(sheet, { x: paper.left + paper.width / 2 - (right - w / 2), rotation: 0, autoAlpha: 0 },
      { x: 0, rotation: -3.5, autoAlpha: 1, ease: 'power2.out', paused: true });
    slide.progress(q);
  };
  // Out between 14 % and 44 % of the print: after the weekly page has landed, while its gauges stack.
  const sheetAt = (p) => (prefersReducedMotion() ? 1 : Math.min(1, Math.max(0, (p / 0.92 - 0.14) / 0.3)));
  const st = sheet && ScrollTrigger.create({ trigger: section, start: 'top top', end: 'bottom bottom', onUpdate: (self) => {
    q = sheetAt(self.progress);
    if (slide) gsap.to(slide, { progress: q, duration: 0.5, ease: 'power3.out', overwrite: true });
  } });
  q = sheetAt(st?.progress ?? 0);
  const fit = () => {
    placeSheet();
    if (window.innerWidth > 900) { stage.style.top = stage.style.height = ''; return; }
    const top = col.offsetTop + copy.offsetTop + copy.offsetHeight + 12;
    const bottom = col.offsetTop + readout.offsetTop - 12;
    stage.style.top = `${top}px`;
    stage.style.height = `${Math.max(80, bottom - top)}px`;
  };
  const ro = new ResizeObserver(fit);
  [section.querySelector('.piece-sticky'), copy, readout, stage].forEach((el) => ro.observe(el));
  fit();
  return () => { ro.disconnect(); st?.kill(); slide?.kill(); };
}

async function boot() {
  const reduced = prefersReducedMotion();
  document.documentElement.classList.toggle('reduced-motion', reduced);
  const cleanups = [initScroll()];
  stopScroll();

  const hero = document.querySelector('[data-hero]');
  const canvas = hero?.querySelector('[data-reading]');
  greet(hero?.querySelector('[data-greeting]'));
  const anchors = [...(hero?.querySelectorAll('[data-anchor]') ?? [])].map((el) => ({ i: Number(el.dataset.anchor), el }));
  // The dial prints with the mono face, so its font must be in before the scene draws.
  // Mono + Anybody print the dial; Next is the hero copy (the LCP text, font-display: swap).
  const fonts = Promise.all(['600 26px "Atkinson Hyperlegible Mono"', '540 100px "Anybody"', '400 16px "Atkinson Hyperlegible Next"'].map((f) => document.fonts.load(f)));
  // Fonts in + two frames = the copy has painted in its real face; only then fetch three.js, so it can't count against LCP.
  // The timer covers hidden tabs, where rAF never fires.
  const painted = fonts.then(() => new Promise((r) => { requestAnimationFrame(() => requestAnimationFrame(r)); setTimeout(r, 500); }));
  if (canvas) canvas.style.opacity = '0';
  const readingReady = canvas
    ? painted.then(() => import('./scenes/reading.js')).then(({ createReading }) => createReading(canvas, { onReading: readingView(hero), anchors })).catch(() => null)
    : Promise.resolve(null);

  // The title lines wait in their masks before the preloader opens, so the wipe never shows them twice.
  if (!reduced) gsap.set(hero?.querySelectorAll('[data-line]') ?? [], { yPercent: 110 });
  await runPreloader(document.querySelector('[data-preloader]'), { tasks: [fonts] });
  startScroll();

  const sections = [...document.querySelectorAll('main > section')];
  const pieces = {};
  const progress = {};
  layerSections(sections.filter((s) => s.classList.contains('stack')));
  sections.forEach((section, i) => {
    cleanups.push(initReveals(section));
    if (section.classList.contains('stack')) cleanups.push(shadeOnCover(sections[i - 1], section));
    const name = section.dataset.piece;
    if (name) {
      const st = ScrollTrigger.create({ trigger: section, start: 'top top', end: 'bottom bottom', onUpdate: (self) => { progress[name] = self.progress; pieces[name]?.setProgress(self.progress); } });
      cleanups.push(() => st.kill());
    }
  });
  // Seams in page order, after the sections (ScrollTrigger order); one per scene change.
  cleanups.push(
    jointDive(document.querySelector('[data-seam-dive]'), { next: document.querySelector('#why'), anchor: hero?.querySelector('[data-anchor="6"]'), veil: hero?.querySelector('[data-hero-veil]') }),
    hatchSweep(document.querySelector('[data-seam-hatch]'), document.querySelector('#noise')),
    goniometerSweep(document.querySelector('[data-seam-sweep]'), document.querySelector('#fence')),
    tapeOnOff(document.querySelector('[data-seam-tape]'), document.querySelector('#grip')),
    printFeed(document.querySelector('[data-seam-print]'), document.querySelector('#report')),
    fistWipe(document.querySelector('[data-fist-wipe]'), document.querySelector('#live')),
  );
  cleanups.push(initLive(document.querySelector('#live')));
  const why = document.querySelector('#why');
  if (why) cleanups.push(createNeedleField(why.querySelector('[data-needle-field]'), why));

  // Set-pieces build when they come within a screen of view, each in its own chunk (three.js is already
  // cached), so four WebGL compiles no longer block the first load (Lighthouse TBT).
  const noise = document.querySelector('[data-piece="noise"]');
  const fence = document.querySelector('[data-piece="fence"]');
  const grip = document.querySelector('[data-piece="grip"]');
  const report = document.querySelector('[data-piece="report"]');
  cleanups.push(fitPaper(report));
  const builders = {
    noise: () => import('./scenes/noise-band.js').then((m) => m.createNoiseBand(noise.querySelector('[data-noise]'), { onVerdict: noiseView(noise) })),
    fence: () => import('./scenes/fence.js').then((m) => m.createFence(fence.querySelector('[data-fence]'), { onDay: fenceView(fence, () => pieces.fence), anchor: fence.querySelector('[data-fence-flag]') })),
    grip: () => import('./scenes/grip.js').then((m) => m.createGrip(grip.querySelector('[data-grip]'), { onState: gripView(grip) })),
    report: () => import('./scenes/report-page.js').then((m) => m.createReportPage(report.querySelector('[data-report]'), { onState: reportView(report) })),
  };
  const near = new IntersectionObserver((entries) => entries.forEach(({ isIntersecting, target }) => {
    const name = target.dataset.piece;
    if (!isIntersecting) return;
    near.unobserve(target);
    builders[name]().then((scene) => { pieces[name] = scene; scene.setProgress(progress[name] ?? 0); cleanups.push(() => scene.dispose()); });
  }), { rootMargin: '100% 0px' });
  [noise, fence, grip, report].filter(Boolean).forEach((el) => near.observe(el));
  cleanups.push(() => near.disconnect());

  cleanups.push(
    initNav({ nav: document.querySelector('[data-nav]'), rail: document.querySelector('[data-rail]'), brand: BRAND }),
    initCursor(),
    initMagnetic(),
    initFlexWord(),
    initWaveHand(),
  );
  ScrollTrigger.refresh();
  indexGauges(sections);

  const pause = document.querySelector('[data-pause-motion]');
  pause?.addEventListener('click', () => {
    const on = document.documentElement.classList.toggle('motion-paused');
    pause.setAttribute('aria-pressed', String(on));
    pause.textContent = on ? 'Play motion' : 'Pause motion';
  });
  const intro = playHeroIntro(hero);
  const armScrollOut = () => hero && cleanups.push(heroScrollOut(hero));
  if (intro) intro.then(armScrollOut); else armScrollOut();

  window.__flexion = { reading: null, pieces, dispose: () => cleanups.reverse().forEach((fn) => fn?.()) };
  const reading = await readingReady;
  if (canvas) gsap.to(canvas, { opacity: 1, duration: reading && !reduced ? 0.9 : 0, ease: 'power2.out' });
  if (!reading) return;
  cleanups.push(() => reading.dispose());
  if (hero) {
    const st = ScrollTrigger.create({ trigger: hero, start: 'top top', end: 'bottom bottom', onUpdate: (self) => reading.setProgress(self.progress) });
    reading.setProgress(st.progress);
    cleanups.push(() => st.kill());
  }
  cleanups.push(zaliff(reading, hero));
  reading.intro();
  countLandmarks(hero?.querySelector('[data-hud-landmarks]'), reduced);
  window.__flexion.reading = reading;
}

boot();
