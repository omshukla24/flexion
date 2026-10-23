// The weekly therapist PDF: a pure function, history in → PDF bytes out, readable in 30 seconds.
// Standard Helvetica (WinAnsi text only, nothing embedded); colours from the locked palette, no red.
import { PDFDocument, StandardFonts, rgb } from "pdf-lib";
import { flareCheck, nextTargets, progressOf } from "./routine.js";

const W = 612, H = 792, M = 48;          // US Letter, points
const IST_MS = 330 * 60_000;
const DAY_MS = 24 * 3600_000;
const ROW = 14, FOOTER = 54;
const hex = (h) => rgb(parseInt(h.slice(1, 3), 16) / 255, parseInt(h.slice(3, 5), 16) / 255, parseInt(h.slice(5, 7), 16) / 255);
const C = { ink: hex("#0F1B2D"), muted: hex("#4A5A6B"), line: hex("#B7C6D1"), band: hex("#E3EBF0"), rose: hex("#E0457B"), ok: hex("#13774F"), care: hex("#9A5800") };
const COLS = [["Date", 0], ["Time", 62], ["Done", 102], ["Reps", 140], ["Grip", 176], ["Fixes", 218], ["Pain", 256], ["Fist", 292], ["Change vs usual", 334]];

const WEEKDAY = ["SUN", "MON", "TUE", "WED", "THU", "FRI", "SAT"];
const local = (t) => new Date(t + IST_MS).toISOString();
const dayOf = (t) => local(t).slice(0, 10);
const median = (xs) => { const s = [...xs].sort((a, b) => a - b), m = s.length >> 1; return s.length % 2 ? s[m] : (s[m - 1] + s[m]) / 2; };
const f2 = (x) => (Number.isFinite(x) ? x.toFixed(2) : "-");

/** Flare events inside the range: flareCheck at the end of each local day, deduplicated by the day pair it names. */
function flaresIn(history, mdc95, from, to) {
  const seen = new Map();
  for (let t = from; t < to + DAY_MS; t += DAY_MS) {
    const end = Math.min(t, to);
    const r = flareCheck(history.filter((s) => Date.parse(s.ts) <= end), mdc95, end);
    if (r.flare) seen.set(r.days.join(), r.days);
  }
  return [...seen.values()];
}

/** Fist closure for the day gauges: how far the index tip travels from open to fist, 0–1 (one fan per day). */
const closure = (fist, open) => (Number.isFinite(fist) && open > 0 ? Math.min(1, Math.max(0, 1 - fist / open)) : null);

/** The last (up to) 7 local days of the range, each with its median closure, or null on a day with no check. */
function dayGauges(rows, to) {
  return Array.from({ length: 7 }, (_, i) => dayOf(to - (6 - i) * DAY_MS)).map((day) => {
    const today = rows.filter((s) => dayOf(Date.parse(s.ts)) === day && Number.isFinite(s.fistIndex) && s.openIndex > 0);
    return { day, label: `${WEEKDAY[new Date(`${day}T00:00:00Z`).getUTCDay()]} ${day.slice(5)}`, value: today.length ? median(today.map((s) => closure(s.fistIndex, s.openIndex))) : null };
  });
}

/** The numbers the PDF shows, kept apart from the drawing. */
function summarize({ from, to, sessions, routine, mdc95 }) {
  const all = [...sessions].sort((a, b) => a.ts.localeCompare(b.ts));
  const inRange = (s) => Date.parse(s.ts) >= from && Date.parse(s.ts) <= to;
  const rows = all.flatMap((s, i) => (inRange(s) ? [{ ...s, change: progressOf(all.slice(0, i + 1), mdc95).change }] : []));
  const before = all.filter((s) => Date.parse(s.ts) < from && Number.isFinite(s.fistIndex)).map((s) => s.fistIndex);
  const week = rows.filter((s) => Number.isFinite(s.fistIndex)).map((s) => s.fistIndex);
  const baseline = before.length >= 3 ? median(before) : week.length ? median(week) : null;
  const maxReps = routine?.limits?.maxReps;
  const opens = rows.filter((s) => s.openIndex > 0).map((s) => s.openIndex);
  const usualOpen = opens.length ? median(opens) : null;
  return {
    rows, baseline,
    gauges: dayGauges(rows, to),
    usual: baseline !== null && usualOpen ? { value: closure(baseline, usualOpen), noise: mdc95 / usualOpen } : null,
    days: new Set(rows.map((s) => dayOf(Date.parse(s.ts)))).size,
    span: Math.max(1, Math.round((to - from) / DAY_MS)),
    flares: flaresIn(all.filter((s) => Date.parse(s.ts) <= to), mdc95, from, to),
    overLimit: maxReps ? rows.filter((s) => s.reps > maxReps) : [],
    progression: routine ? nextTargets(routine, all.filter((s) => Date.parse(s.ts) <= to), to).reason : null,
  };
}

/** `{ userId, hand, from, to, sessions, routine, mdc95 }` → PDF bytes. `sessions` is the full history; the range picks the rows. */
export async function buildReport({ userId, hand, from, to, sessions, routine, mdc95 }) {
  const doc = await PDFDocument.create();
  const [reg, bold] = await Promise.all([doc.embedFont(StandardFonts.Helvetica), doc.embedFont(StandardFonts.HelveticaBold)]);
  doc.setTitle(`Flexion weekly hand report, ${hand} hand, ${dayOf(from)} to ${dayOf(to)}`);
  doc.setProducer("Flexion");
  const sum = summarize({ from, to, sessions, routine, mdc95 });
  let page, y;

  const text = (s, x, yy, { size = 10, font = reg, color = C.ink } = {}) => page.drawText(s, { x, y: yy, size, font, color });
  const right = (s, xr, yy, o = {}) => text(s, xr - (o.font ?? reg).widthOfTextAtSize(s, o.size ?? 10), yy, o);
  const line = (x1, y1, x2, y2, color = C.line, thickness = 0.75, dash) => page.drawLine({ start: { x: x1, y: y1 }, end: { x: x2, y: y2 }, color, thickness, dashArray: dash });
  const newPage = () => {
    page = doc.addPage([W, H]);
    y = H - M;
  };

  // ---- header ----
  newPage();
  text("Flexion", M, y - 18, { size: 22, font: bold });
  text("Weekly hand report", M, y - 36, { size: 12, color: C.muted });
  right(`Patient ${userId} · ${hand} hand`, W - M, y - 12, { size: 10, font: bold });
  right(`${dayOf(from)} to ${dayOf(to)} (IST)`, W - M, y - 26);
  const nEx = routine?.exercises.length;
  right(routine ? `Routine: from the therapist's sheet (${nEx} exercise${nEx > 1 ? "s" : ""})` : "Routine: demo targets, no sheet on file", W - M, y - 40, { color: C.muted });
  y -= 52;
  line(M, y, W - M, y, C.ink, 1);
  y -= 22;

  // ---- summary ----
  const n = sum.rows.length;
  const say = (s, o) => { text(s, M, y, { size: 11, ...o }); y -= 16; };
  if (!n) {
    say("No sessions this week.", { font: bold, size: 14 });
    say("Nothing was measured between these dates, so there is no trend to show.", { color: C.muted });
  } else {
    const done = sum.rows.filter((s) => s.completed).length, pain = sum.rows.filter((s) => s.pain).length;
    const looser = sum.rows.filter((s) => s.change === "looser").length, tighter = sum.rows.filter((s) => s.change === "tighter").length;
    say(`${n} sessions this week, on ${sum.days} of ${sum.span} days. Completed: ${done}. Pain flags: ${pain}.`, { font: bold });
    say(`Real change vs the usual fist reading (beyond MDC95 ${mdc95.toFixed(3)}): ${looser} looser, ${tighter} tighter.`);
    if (sum.flares.length) say(`Flare: ${sum.flares.map((d) => d.join(" and ")).join("; ")} (two days in a row looser than usual, beyond day-to-day noise).`, { color: C.care, font: bold });
    else say("Flare: none.");
  }
  if (!routine) say("No routine on file: demo targets, so the therapist's limits can't be checked yet.", { color: C.muted });
  else {
    say(`Never exceeded the therapist's limits: ${sum.overLimit.length ? "no" : "yes"}.`, { font: bold, color: sum.overLimit.length ? C.care : C.ok });
    for (const s of sum.overLimit) say(`   ${dayOf(Date.parse(s.ts))}: ${s.reps} reps (max ${routine.limits.maxReps}).`, { color: C.care });
    say(`Progression: ${sum.progression}`, { color: C.muted });
  }

  // ---- one single-arc gauge per day: fist closure, needle from straight up (0 %) to flat (100 %) ----
  if (n) {
    y -= 8;
    text("Fist closure per day (median): how far the index fingertip travels from open hand to fist. Band = your usual ± noise.", M, y, { size: 9, color: C.muted });
    const cell = (W - 2 * M) / 7, r = 34, top = y - 14;
    const at = (cx, cy, rr, v) => [cx + rr * Math.sin((v * Math.PI) / 2), cy + rr * Math.cos((v * Math.PI) / 2)];
    const arc = (cx, cy, rr, v0, v1, color, thickness) => {
      const steps = Math.max(2, Math.ceil((v1 - v0) * 24));
      for (let k = 0; k < steps; k += 1) line(...at(cx, cy, rr, v0 + ((v1 - v0) * k) / steps), ...at(cx, cy, rr, v0 + ((v1 - v0) * (k + 1)) / steps), color, thickness);
    };
    sum.gauges.forEach((g, i) => {
      const x0 = M + i * cell, cx = x0 + 6, cy = top - 10 - r;
      text(g.label, x0, top, { size: 8, font: bold, color: C.muted });
      if (sum.usual) {
        arc(cx, cy, r - 4, Math.max(0, sum.usual.value - sum.usual.noise), Math.min(1, sum.usual.value + sum.usual.noise), C.line, 6);
        line(...at(cx, cy, r - 10, sum.usual.value), ...at(cx, cy, r + 2, sum.usual.value), C.muted, 1);
      }
      arc(cx, cy, r, 0, 1, C.ink, 0.6);
      for (let t = 0; t <= 10; t += 1) line(...at(cx, cy, r, t / 10), ...at(cx, cy, r + (t % 5 ? 2 : 4), t / 10), C.ink, 0.5);
      if (g.value === null) { text("no check", cx, cy - 13, { size: 8, color: C.muted }); return; }
      const off = sum.usual && Math.abs(g.value - sum.usual.value) > sum.usual.noise;
      line(cx, cy, ...at(cx, cy, r - 1, g.value), off ? C.care : C.rose, 1.8);
      page.drawCircle({ x: cx, y: cy, size: 2.4, color: off ? C.care : C.rose });
      text(`${Math.round(g.value * 100)}%`, cx, cy - 13, { size: 10, font: bold, color: off ? C.care : C.ink });
    });
    y = top - r - 36;
  }

  // ---- trend chart: one point per session, the MDC95 band around the usual reading ----
  if (n) {
    y -= 10;
    text("Fist reading per session: index fingertip to knuckle ÷ palm length. Lower = a tighter fist.", M, y, { size: 9, color: C.muted });
    y -= 10;
    const cx = M + 30, cw = W - M - cx, ch = 110, cy = y - ch;
    const values = sum.rows.map((s) => s.fistIndex).filter(Number.isFinite);
    const top = Math.ceil((Math.max(0.4, ...values, (sum.baseline ?? 0) + mdc95) + 0.05) * 10) / 10;
    const yOf = (v) => cy + (v / top) * ch, xOf = (t) => cx + ((t - from) / Math.max(1, to - from)) * cw;
    if (sum.baseline !== null) {
      const lo = yOf(Math.max(0, sum.baseline - mdc95)), hi = yOf(Math.min(top, sum.baseline + mdc95));
      page.drawRectangle({ x: cx, y: lo, width: cw, height: hi - lo, color: C.band });
      line(cx, lo, cx + cw, lo, C.muted, 0.5, [3, 2]);
      line(cx, hi, cx + cw, hi, C.muted, 0.5, [3, 2]);
      line(cx, yOf(sum.baseline), cx + cw, yOf(sum.baseline), C.muted, 1);
      text(`your usual ${f2(sum.baseline)} ± ${mdc95.toFixed(3)} (MDC95)`, cx + 6, hi + 4, { size: 8, color: C.muted }); // left end: the newest points sit on the right
    }
    for (let v = 0; v <= top + 1e-9; v += 0.1) {
      line(cx - 3, yOf(v), cx, yOf(v), C.ink, 0.5);
      right(v.toFixed(1), cx - 6, yOf(v) - 3, { size: 8, color: C.muted });
    }
    line(cx, cy, cx, cy + ch, C.ink, 0.75);
    line(cx, cy, cx + cw, cy, C.ink, 0.75);
    for (let t = from; t <= to; t += DAY_MS) right(dayOf(t).slice(5), xOf(t) + 10, cy - 12, { size: 8, color: C.muted });
    const pts = sum.rows.filter((s) => Number.isFinite(s.fistIndex)).map((s) => [xOf(Date.parse(s.ts)), yOf(s.fistIndex)]);
    pts.slice(1).forEach(([x, yy], i) => line(pts[i][0], pts[i][1], x, yy, C.rose, 1));
    for (const [x, yy] of pts) page.drawCircle({ x, y: yy, size: 3, color: C.rose });
    y = cy - 34;
  }

  // ---- session table ----
  const header = () => {
    for (const [name, dx] of COLS) text(name, M + dx, y, { size: 8, font: bold, color: C.muted });
    y -= 5;
    line(M, y, W - M, y, C.line);
    y -= ROW - 4;
  };
  if (n) header();
  for (const s of sum.rows) {
    if (y < M + FOOTER) { newPage(); header(); }
    const t = local(Date.parse(s.ts));
    const change = { noise: "normal range", looser: "looser (real)", tighter: "tighter (real)" }[s.change] ?? "building baseline";
    const cells = [t.slice(0, 10), t.slice(11, 16), s.completed ? "yes" : "no", String(s.reps), s.grip ?? "-", String(s.fixes), s.pain ? "pain" : "-", f2(s.fistIndex), change];
    cells.forEach((c, i) => text(c, M + COLS[i][1], y, { size: 9, color: i === 8 && s.change === "looser" ? C.care : i === 6 && s.pain ? C.care : C.ink }));
    y -= ROW;
  }

  // ---- the therapist's signature line, under the last row ----
  if (y < M + FOOTER + 6) newPage(); // the line needs ~22 pt above the footer rule
  y -= 22;
  text("Reviewed by", M, y, { size: 9, color: C.muted });
  line(M + 58, y - 2, M + 280, y - 2, C.ink, 0.75);
  text("Date", M + 300, y, { size: 9, color: C.muted });
  line(M + 324, y - 2, M + 430, y - 2, C.ink, 0.75);

  // ---- footer on every page ----
  const pages = doc.getPages();
  pages.forEach((p, i) => {
    page = p;
    line(M, M + 30, W - M, M + 30);
    text("Measurement aid, not a diagnosis. Values from a consumer webcam; see method.", M, M + 18, { size: 8, font: bold, color: C.muted });
    text(`Method: index fingertip-to-knuckle distance ÷ palm length, median of a steady window; MDC95 ${mdc95.toFixed(3)} from repeat trials.`, M, M + 6, { size: 8, color: C.muted });
    right(`${i + 1} / ${pages.length}`, W - M, M + 18, { size: 8, color: C.muted });
  });
  return doc.save();
}
