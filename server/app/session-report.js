// One session's detailed PDF: session-core's log and
// result in → PDF bytes out. pdf-lib is passed in, so the same file runs in Node tests, the site (bundled) and the coach page (CDN).
// Standard Helvetica, WinAnsi text only (no ✔ or arrows); the palette of the weekly report (server/src/report.js).
const W = 612, H = 792, M = 48, FOOT = 28; // tight enough that a full session fits one page
const IST_MS = 330 * 60_000;
const FINGERS = ["thumb", "index", "middle", "ring", "little"];
const ISSUE = { sideways: "Palm turned sideways", "thumb-tucked": "Thumb tucked inside the fist" };
const STEP = { hello: "Hand in view", open: "Open hand", fist: "Fist", reps: "Open and close", grip: "Grip task" };
const OUTCOME = { pass: "done", skip: "skipped", timeout: "skipped (time ran out)", stop: "stopped" };

const median = (xs) => { const s = xs.filter(Number.isFinite).sort((a, b) => a - b), m = s.length >> 1; return !s.length ? null : s.length % 2 ? s[m] : (s[m - 1] + s[m]) / 2; };
const f2 = (x) => (Number.isFinite(x) ? x.toFixed(2) : "-");
const pct = (x) => (Number.isFinite(x) ? `${Math.round(x)}%` : "-");
export const clock = (ms) => { const s = Math.max(0, Math.round(ms / 1000)); return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, "0")}`; };
const secs = (ms) => (Number.isFinite(ms) ? `${(ms / 1000).toFixed(1)} s` : "-");
const stamp = (t) => new Date(t + IST_MS).toISOString().slice(0, 16).replace("T", " ");

/** The numbers the PDF shows, kept apart from the drawing. */
export function reportNumbers({ log, result }) {
  const of = (step) => log.counts.filter((c) => c.step === step);
  const fingers = FINGERS.map((f) => {
    const open = median(of("open").map((c) => c.curls?.[f])), fist = median(of("fist").map((c) => c.curls?.[f]));
    return { finger: f, open, fist, range: open !== null && fist !== null ? fist - open : null };
  });
  const gaps = log.reps.slice(1).map((t, i) => t - log.reps[i]).filter((g) => g > 0);
  const pausedMs = log.pauses.reduce((a, p) => a + p.ms, 0);
  return {
    fingers,
    reps: { done: result.reps, target: result.targets?.reps, avgMs: gaps.length ? gaps.reduce((a, b) => a + b, 0) / gaps.length : null, fastMs: gaps.length ? Math.min(...gaps) : null, slowMs: gaps.length ? Math.max(...gaps) : null },
    pausedMs, activeMs: result.durationMs - pausedMs,
    skipped: result.incomplete ?? [],
  };
}

/** The summary in plain words, one line each (tested; the PDF prints them as they are). */
export function summaryLines({ log, result, progress }, n = reportNumbers({ log, result })) {
  const skipped = (step) => n.skipped.includes(step);
  const lines = [
    `Completed: ${result.completed ? "yes" : "no"}${n.skipped.length ? ` (skipped: ${n.skipped.map((s) => STEP[s].toLowerCase()).join(", ")})` : ""}.`,
    skipped("fist") || !Number.isFinite(result.fistIndex)
      ? "Fist reading: skipped, so there is no fist reading today."
      : `Fist reading: ${f2(result.fistIndex)} (index fingertip to palm, scaled to your hand; lower is a tighter fist).`,
    skipped("open") || !Number.isFinite(result.openIndex) ? "Open-hand reading: skipped." : `Open-hand reading: ${f2(result.openIndex)}.`,
  ];
  if (progress?.baseline != null && Number.isFinite(result.fistIndex)) {
    const words = { noise: "inside your normal day-to-day range", tighter: "a real change: tighter than your usual", looser: "a real change: looser than your usual" }[progress.change];
    lines.push(`Against your usual (${f2(progress.baseline)}): ${words ?? "not enough checks yet to call real change"}.`);
  } else if (progress?.need) lines.push(`Building your normal range: ${progress.need} more check${progress.need > 1 ? "s" : ""} before real change can be called.`);
  lines.push(skipped("reps") ? "Reps: skipped." : `Reps: ${n.reps.done} of ${n.reps.target}${n.reps.avgMs ? `, about ${secs(n.reps.avgMs)} each` : ""}.`);
  const g = log.grip;
  lines.push(result.grip === "pass" ? `Grip task: done in ${secs(g?.ms)}${g?.by === "identify" ? " (checked by the object model)" : ""}.` : result.grip === "fail" ? "Grip task: not done before time ran out." : "Grip task: skipped.");
  lines.push(`Form corrections: ${result.fixes}. Rests: ${log.pauses.length}${log.pauses.some((p) => p.why === "pain") ? " (one or more for pain)" : ""}.`);
  return lines;
}

/** `{ log, result, progress?, hand, when }` (when = the end time, ms since epoch) → PDF bytes. `pdf` = the pdf-lib module. */
export async function buildSessionReport({ log, result, progress = null, hand = "right", when = Date.now() }, { PDFDocument, StandardFonts, rgb }) {
  const hex = (h) => rgb(parseInt(h.slice(1, 3), 16) / 255, parseInt(h.slice(3, 5), 16) / 255, parseInt(h.slice(5, 7), 16) / 255);
  const C = { ink: hex("#0F1B2D"), muted: hex("#4A5A6B"), line: hex("#B7C6D1"), band: hex("#E3EBF0"), rose: hex("#E0457B"), ok: hex("#13774F"), care: hex("#9A5800") };
  const doc = await PDFDocument.create();
  const [reg, bold] = await Promise.all([doc.embedFont(StandardFonts.Helvetica), doc.embedFont(StandardFonts.HelveticaBold)]);
  doc.setTitle(`Flexion hand check, ${hand} hand, ${stamp(when)} IST`);
  doc.setProducer("Flexion");
  const n = reportNumbers({ log, result });
  let page, y;

  const text = (s, x, yy, { size = 10, font = reg, color = C.ink } = {}) => page.drawText(s, { x, y: yy, size, font, color });
  const right = (s, xr, yy, o = {}) => text(s, xr - (o.font ?? reg).widthOfTextAtSize(s, o.size ?? 10), yy, o);
  const rule = (yy, color = C.line, thickness = 0.75) => page.drawLine({ start: { x: M, y: yy }, end: { x: W - M, y: yy }, color, thickness });
  const newPage = () => { page = doc.addPage([W, H]); y = H - M; };
  const room = (need) => { if (y - need < M + FOOT) newPage(); };
  const heading = (s, need = 60) => { room(need); y -= 10; text(s, M, y, { size: 12, font: bold }); y -= 6; rule(y); y -= 16; };
  /** A simple table: cols = [[title, x offset, align]], rows = arrays of strings. */
  const table = (cols, rows) => {
    const head = () => { cols.forEach(([t, x, a]) => (a === "r" ? right(t, M + x, y, { size: 8, font: bold, color: C.muted }) : text(t, M + x, y, { size: 8, font: bold, color: C.muted }))); y -= 14; };
    head();
    rows.forEach((r) => {
      if (y < M + FOOT + 14) { newPage(); head(); }
      cols.forEach(([, x, a], i) => (a === "r" ? right(r[i], M + x, y, { size: 9 }) : text(r[i], M + x, y, { size: 9 })));
      y -= 12;
    });
  };

  // ---- header + summary ----
  newPage();
  text("Flexion", M, y - 18, { size: 22, font: bold });
  text("Hand check report", M, y - 36, { size: 12, color: C.muted });
  right(`${hand[0].toUpperCase()}${hand.slice(1)} hand`, W - M, y - 12, { size: 10, font: bold });
  right(`${stamp(when)} IST`, W - M, y - 26);
  right(`Session ${clock(result.durationMs)}${n.pausedMs ? ` (resting ${clock(n.pausedMs)})` : ""}`, W - M, y - 40, { color: C.muted });
  y -= 52;
  rule(y, C.ink, 1);
  y -= 22;
  summaryLines({ log, result, progress }, n).forEach((s, i) => { text(s, M, y, { size: 11, font: i ? reg : bold }); y -= 16; });

  // ---- fingers: how far each one bends, open hand vs fist ----
  heading("How far each finger bends");
  text("0% = straight, 100% = fully bent. Median of the counted holds. The bar runs from your open hand to your fist.", M, y, { size: 9, color: C.muted });
  y -= 18;
  const x0 = M + 70, x1 = W - M - 150, xOf = (v) => x0 + (Math.min(100, Math.max(0, v)) / 100) * (x1 - x0);
  [0, 25, 50, 75, 100].forEach((v) => { right(`${v}%`, xOf(v) + 8, y, { size: 7, color: C.muted }); });
  y -= 6;
  n.fingers.forEach((f) => {
    y -= 16;
    text(f.finger[0].toUpperCase() + f.finger.slice(1), M, y, { size: 10, font: bold });
    page.drawRectangle({ x: x0, y: y - 2, width: x1 - x0, height: 10, color: C.band });
    if (f.range !== null) {
      const a = xOf(Math.min(f.open, f.fist)), b = xOf(Math.max(f.open, f.fist));
      page.drawRectangle({ x: a, y: y - 2, width: Math.max(2, b - a), height: 10, color: C.rose });
      text(`open ${pct(f.open)}  fist ${pct(f.fist)}  range ${pct(f.range)}`, x1 + 10, y, { size: 9 });
    } else text(f.open === null && f.fist === null ? "skipped" : `open ${pct(f.open)}  fist ${pct(f.fist)}`, x1 + 10, y, { size: 9, color: C.muted });
  });
  y -= 14;

  // ---- every counted hold ----
  heading("Every counted hold");
  table(
    [["#", 0], ["Step", 18], ["At", 92], ["Index", 150, "r"], ["Fist", 192, "r"], ["Thumb", 234, "r"], ["Width", 276, "r"], ...FINGERS.map((f, i) => [f, 316 + i * 40, "r"])],
    log.counts.length
      ? log.counts.map((c, i) => [String(i + 1), STEP[c.step], clock(c.t), f2(c.index), f2(c.fist), f2(c.thumb), f2(c.width), ...FINGERS.map((f) => pct(c.curls?.[f]))])
      : [["-", "No holds were counted.", "", "", "", "", "", "", "", "", "", ""]],
  );

  // ---- steps ----
  heading("Steps, in order");
  table([["Step", 0], ["Started", 130], ["Took", 200], ["Result", 260]],
    log.steps.map((s) => [STEP[s.step] ?? s.step, clock(s.t0), clock(s.t1 - s.t0), OUTCOME[s.outcome] ?? s.outcome]));

  // ---- reps, form, rests (kept on one page with its heading) ----
  const rr = n.reps;
  const notes = [
    n.skipped.includes("reps") ? "Reps: skipped." : `Reps: ${rr.done} of ${rr.target}. ${rr.avgMs ? `Average ${secs(rr.avgMs)} a rep (fastest ${secs(rr.fastMs)}, slowest ${secs(rr.slowMs)}).` : ""}`,
    ...(log.fixes.length ? log.fixes.map((f) => `Form: ${ISSUE[f.issue] ?? f.issue} at ${clock(f.t)}, corrected after ${secs(f.ms)}.`) : ["Form: no corrections needed."]),
    ...log.pauses.map((p) => `Rest at ${clock(p.t)} for ${clock(p.ms)}${p.why === "pain" ? ", because it hurt" : ""}.`),
  ];
  heading("Reps, form and rests", 32 + notes.length * 15); // the heading itself takes 32
  notes.forEach((s) => { room(16); text(s, M, y, { size: 10, color: s.includes("hurt") ? C.care : C.ink }); y -= 15; });

  // ---- footer on every page ----
  const pages = doc.getPages();
  pages.forEach((p, i) => {
    page = p;
    page.drawLine({ start: { x: M, y: M + 14 }, end: { x: W - M, y: M + 14 }, color: C.line, thickness: 0.5 });
    text("Not a diagnosis. Share it with your therapist. Measured by a camera, not a clinical goniometer.", M, M, { size: 8, color: C.muted });
    right(`Flexion · page ${i + 1} of ${pages.length}`, W - M, M, { size: 8, color: C.muted });
  });
  return doc.save();
}
