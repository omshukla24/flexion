// "The Monday Report": scroll prints a page that mirrors /sample-report.pdf. Seven single-arc day gauges fly in
// and stack into their row, the summary prints, the trend draws, the rows print, and the signature line draws last.
// Drawn in SVG in the PDF's own coordinates (612 x 792 pt, y down), so the page and the real report line up.
import { gsap } from 'gsap';
import { SAMPLE, dayGauges, onArc } from './report-math.js';
import { prefersReducedMotion } from '../core/env.js';

const NS = 'http://www.w3.org/2000/svg';
const W = 612, H = 792, M = 48, R = 34;
const SUMMARY = [
  ['14 sessions this week, on 7 of 7 days. Completed: 13. Pain flags: 1.', 'b'],
  ['Real change vs the usual fist reading (beyond MDC95 0.063): 4 looser, 0 tighter.', ''],
  ['Flare: 2026-10-17 and 2026-10-18 (two days in a row looser than usual, beyond day-to-day noise).', 'b care'],
  ["Never exceeded the therapist's limits: yes.", 'b ok'],
  ['Progression: Holding steady: each level is kept for 7 days before it rises.', 'mute'],
];
const COLS = [0, 62, 102, 140, 176, 218, 256, 292, 334];

function el(tag, attrs = {}, parent, text) {
  const e = document.createElementNS(NS, tag);
  for (const [k, v] of Object.entries(attrs)) e.setAttribute(k, v);
  if (text !== undefined) e.textContent = text;
  parent?.appendChild(e);
  return e;
}

/** Each row of the sample week's table (two checks a day; Monday's first needed 2 form fixes, Wednesday evening hurt). */
function rows() {
  return SAMPLE.days.flatMap(([, date, fists]) => [['08:00', fists[0]], ['19:00', fists[1]]].map(([time, f]) => {
    const pain = date === '10-14' && time === '19:00';
    return [`2026-${date}`, time, pain ? 'no' : 'yes', pain ? '4' : '10', 'pass', date === '10-12' && time === '08:00' ? '2' : '0', pain ? 'pain' : '-', f.toFixed(2), f > 0.25 ? 'looser (real)' : 'normal range'];
  }));
}

/** A group that prints left to right: its own clip rect grows from 0 to the full width. */
function printed(svg, defs, id, y0, y1) {
  const clip = el('clipPath', { id }, defs);
  const rect = el('rect', { x: M - 4, y: y0, width: 0, height: y1 - y0 }, clip);
  return { g: el('g', { 'clip-path': `url(#${id})` }, svg), rect };
}

function gauge(parent, g, i) {
  const slot = el('g', { transform: `translate(${M + i * ((W - 2 * M) / 7)} 226)` }, parent);
  const fly = el('g', {}, slot);
  const cx = 6, cy = 44;
  el('text', { x: 0, y: 0, class: 'b mute s8' }, fly, g.label);
  const band = [Math.max(0, gauges.usual - gauges.noise), Math.min(1, gauges.usual + gauges.noise)];
  const [bx0, by0] = onArc(cx, cy, R - 4, band[0]), [bx1, by1] = onArc(cx, cy, R - 4, band[1]);
  el('path', { d: `M${bx0} ${by0} A${R - 4} ${R - 4} 0 0 1 ${bx1} ${by1}`, class: 'band-arc' }, fly);
  const [ux0, uy0] = onArc(cx, cy, R - 10, gauges.usual), [ux1, uy1] = onArc(cx, cy, R + 2, gauges.usual);
  el('line', { x1: ux0, y1: uy0, x2: ux1, y2: uy1, class: 'usual' }, fly);
  const [ax, ay] = onArc(cx, cy, R, 0), [ex, ey] = onArc(cx, cy, R, 1);
  el('path', { d: `M${ax} ${ay} A${R} ${R} 0 0 1 ${ex} ${ey}`, class: 'arc' }, fly);
  for (let t = 0; t <= 10; t += 1) {
    const [x0, y0] = onArc(cx, cy, R, t / 10), [x1, y1] = onArc(cx, cy, R + (t % 5 ? 2 : 4), t / 10);
    el('line', { x1: x0, y1: y0, x2: x1, y2: y1, class: 'tick' }, fly);
  }
  const needle = el('line', { x1: cx, y1: cy, x2: cx, y2: cy - R + 1, class: g.off ? 'needle care' : 'needle' }, fly);
  el('circle', { cx, cy, r: 2.4, class: g.off ? 'hub care' : 'hub' }, fly);
  el('text', { x: cx, y: cy + 13, class: g.off ? 'b care s10' : 'b s10' }, fly, `${Math.round(g.value * 100)}%`);
  return { fly, needle, value: g.value };
}

const gauges = dayGauges(SAMPLE);

export function createReportPage(stage, { onState } = {}) {
  if (!stage) return { setProgress() {}, dispose() {} };
  const svg = el('svg', { viewBox: `-28 -28 ${W + 56} ${H + 56}`, class: 'paper', role: 'img', 'aria-label': 'A sample weekly report page' }, stage);
  const defs = el('defs', {}, svg);
  const blur = el('filter', { id: 'paper-shadow', x: '-10%', y: '-10%', width: '120%', height: '120%' }, defs);
  el('feGaussianBlur', { stdDeviation: 10 }, blur);
  const sheet = el('g', {}, svg);
  el('rect', { x: 6, y: 14, width: W, height: H, class: 'shadow', filter: 'url(#paper-shadow)' }, sheet);
  el('rect', { x: 0, y: 0, width: W, height: H, class: 'sheet' }, sheet);
  const marks = el('g', { class: 'crop' }, svg);
  for (const [x, y, dx, dy] of [[0, 0, -1, -1], [W, 0, 1, -1], [0, H, -1, 1], [W, H, 1, 1]]) {
    el('line', { x1: x + dx * 6, y1: y, x2: x + dx * 20, y2: y }, marks);
    el('line', { x1: x, y1: y + dy * 6, x2: x, y2: y + dy * 20 }, marks);
  }

  const head = printed(sheet, defs, 'rp-head', 40, 104);
  el('text', { x: M, y: 66, class: 'b s22' }, head.g, 'Flexion');
  el('text', { x: M, y: 84, class: 'mute s12' }, head.g, 'Weekly hand report');
  el('text', { x: W - M, y: 60, class: 'b s10 end' }, head.g, `Patient ${SAMPLE.patient} · ${SAMPLE.hand} hand`);
  el('text', { x: W - M, y: 74, class: 's10 end' }, head.g, SAMPLE.range);
  el('text', { x: W - M, y: 88, class: 'mute s10 end' }, head.g, "Routine: from the therapist's sheet (1 exercise)");
  el('line', { x1: M, y1: 100, x2: W - M, y2: 100, class: 'rule' }, head.g);

  const summary = SUMMARY.map(([s, cls], i) => {
    const p = printed(sheet, defs, `rp-sum${i}`, 110 + i * 16, 126 + i * 16);
    el('text', { x: M, y: 122 + i * 16, class: `s11 ${cls}` }, p.g, s);
    return p;
  });

  const cap = printed(sheet, defs, 'rp-cap', 202, 216);
  el('text', { x: M, y: 212, class: 'mute s9' }, cap.g, 'Fist closure per day (median): how far the index fingertip travels from open hand to fist. Band = your usual ± noise.');
  const gaugeLayer = el('g', {}, sheet);
  const days = gauges.days.map((g, i) => gauge(gaugeLayer, g, i));

  // Trend: the sample's 14 readings over the band, as on the PDF.
  const chart = el('g', { class: 'chart' }, sheet);
  const cx0 = M + 30, cw = W - M - cx0, cy1 = 430, ch = 110, top = 0.5;
  const yOf = (v) => cy1 - (v / top) * ch;
  el('text', { x: M, y: 310, class: 'mute s9' }, chart, 'Fist reading per session: index fingertip to knuckle ÷ palm length. Lower = a tighter fist.');
  const band = el('rect', { x: cx0, y: yOf(SAMPLE.usual + SAMPLE.mdc95), width: cw, height: yOf(SAMPLE.usual - SAMPLE.mdc95) - yOf(SAMPLE.usual + SAMPLE.mdc95), class: 'band' }, chart);
  el('line', { x1: cx0, y1: yOf(SAMPLE.usual), x2: cx0 + cw, y2: yOf(SAMPLE.usual), class: 'usual' }, chart);
  el('line', { x1: cx0, y1: cy1 - ch, x2: cx0, y2: cy1, class: 'axis' }, chart);
  el('line', { x1: cx0, y1: cy1, x2: cx0 + cw, y2: cy1, class: 'axis' }, chart);
  for (let v = 0; v <= top + 1e-9; v += 0.1) el('text', { x: cx0 - 6, y: yOf(v) + 3, class: 'mute s8 end' }, chart, v.toFixed(1));
  const table = rows();
  const pts = table.map((r, i) => `${cx0 + ((i + 0.6) / table.length) * cw},${yOf(Number(r[7]))}`).join(' ');
  const trend = el('polyline', { points: pts, class: 'trend' }, chart);
  const dots = el('g', {}, chart);
  pts.split(' ').forEach((p) => { const [x, y] = p.split(',').map(Number); el('circle', { cx: x, cy: y, r: 2.6, class: 'dot' }, dots); });

  const thead = printed(sheet, defs, 'rp-thead', 450, 466);
  ['Date', 'Time', 'Done', 'Reps', 'Grip', 'Fixes', 'Pain', 'Fist', 'Change vs usual'].forEach((c, i) => el('text', { x: M + COLS[i], y: 460, class: 'b mute s8' }, thead.g, c));
  el('line', { x1: M, y1: 465, x2: W - M, y2: 465, class: 'hair' }, thead.g);
  const trows = table.map((r, k) => {
    const p = printed(sheet, defs, `rp-row${k}`, 466 + k * 14, 480 + k * 14);
    r.forEach((c, i) => el('text', { x: M + COLS[i], y: 476 + k * 14, class: `s9 ${(i === 8 && c.startsWith('looser')) || (i === 6 && c === 'pain') ? 'care' : ''}` }, p.g, c));
    return p;
  });

  const sig = el('g', { class: 'sig' }, sheet);
  el('text', { x: M, y: 690, class: 'mute s9' }, sig, 'Reviewed by');
  const sigLine = el('line', { x1: M + 58, y1: 692, x2: M + 280, y2: 692, class: 'sign' }, sig);
  el('text', { x: M + 300, y: 690, class: 'mute s9' }, sig, 'Date');
  const dateLine = el('line', { x1: M + 324, y1: 692, x2: M + 430, y2: 692, class: 'sign' }, sig);
  el('line', { x1: M, y1: 714, x2: W - M, y2: 714, class: 'hair' }, sheet);
  el('text', { x: M, y: 726, class: 'b mute s8' }, sheet, 'Measurement aid, not a diagnosis. Values from a consumer webcam; see method.');
  el('text', { x: M, y: 738, class: 'mute s8' }, sheet, 'Method: index fingertip-to-knuckle distance ÷ palm length, median of a steady window; MDC95 0.063 from repeat trials.');
  el('text', { x: W - M, y: 726, class: 'mute s8 end' }, sheet, '1 / 1');

  // ---- the print, as one timeline that scroll scrubs ----
  const full = W - 2 * M + 8;
  const tl = gsap.timeline({ paused: true });
  tl.from(sheet, { y: 70, opacity: 0, duration: 0.12, ease: 'expo.out' }, 0)
    .from(marks, { opacity: 0, duration: 0.06 }, 0.06)
    .to(head.rect, { attr: { width: full }, duration: 0.1, ease: 'none' }, 0.1)
    .to(cap.rect, { attr: { width: full }, duration: 0.05, ease: 'none' }, 0.16);
  const landed = days.map((d, i) => {
    const at = 0.18 + i * 0.06;
    // Gauges rise from the empty chart area below, so none crosses the printed header or caption.
    // Pivots are local (own bounding box): the needle turns on its hub even while its gauge is still flying in.
    tl.from(d.fly, { x: (i - 3) * 46, y: 150 + (i % 3) * 40, rotation: i % 2 ? 16 : -14, scale: 1.7, opacity: 0, duration: 0.12, ease: 'expo.out', transformOrigin: '50% 50%' }, at)
      .fromTo(d.needle, { rotation: 0 }, { rotation: d.value * 90, transformOrigin: '50% 100%', duration: 0.08, ease: 'back.out(1.6)' }, at + 0.06);
    return at + 0.12;
  });
  // The summary prints after the last gauge lands (0.66), so no gauge flies across its text.
  summary.forEach((s, i) => tl.to(s.rect, { attr: { width: full }, duration: 0.04, ease: 'none' }, 0.66 + i * 0.02));
  const len = trend.getTotalLength?.() || 600;
  gsap.set(trend, { strokeDasharray: len, strokeDashoffset: len });
  tl.from([band, dots], { opacity: 0, duration: 0.06 }, 0.7)
    .to(trend, { strokeDashoffset: 0, duration: 0.1, ease: 'none' }, 0.7)
    .to(thead.rect, { attr: { width: full }, duration: 0.03, ease: 'none' }, 0.78);
  trows.forEach((r, k) => tl.to(r.rect, { attr: { width: full }, duration: 0.03, ease: 'none' }, 0.79 + k * 0.007));
  [sigLine, dateLine].forEach((l) => { const n = Number(l.getAttribute('x2')) - Number(l.getAttribute('x1')); gsap.set(l, { strokeDasharray: n, strokeDashoffset: n }); });
  tl.from(sig, { opacity: 0, duration: 0.03 }, 0.91)
    .to(sigLine, { strokeDashoffset: 0, duration: 0.05, ease: 'power2.inOut' }, 0.92)
    .to(dateLine, { strokeDashoffset: 0, duration: 0.03, ease: 'power2.inOut' }, 0.96)
    .set({}, {}, 1);

  let last = '';
  const report = () => {
    const t = tl.time();
    const n = landed.filter((end) => t >= end).length;
    const phase = t < 0.18 ? 'print' : n < 7 ? 'stack' : t < 0.96 ? 'flare' : 'sign';
    if (`${n}:${phase}` !== last) { last = `${n}:${phase}`; onState?.({ days: n, phase }); }
  };
  tl.eventCallback('onUpdate', report);
  const reduced = prefersReducedMotion();
  if (reduced) tl.progress(1);
  report();

  return {
    setProgress(p) {
      if (reduced) return;
      gsap.to(tl, { progress: Math.min(1, p / 0.92), duration: 0.5, ease: 'power3.out', overwrite: true }); // the page is complete before the pin lets go
    },
    dispose() { tl.kill(); gsap.killTweensOf(tl); svg.remove(); },
  };
}
