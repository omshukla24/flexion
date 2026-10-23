import { test } from "node:test";
import assert from "node:assert/strict";
import { inflateSync } from "node:zlib";
import { PDFDocument, PDFName, PDFRawStream } from "pdf-lib";
import { buildReport } from "../src/report.js";

const DAY = 24 * 3600_000;
const TO = Date.parse("2026-10-21T12:00:00Z"); // 17:30 IST
const FROM = TO - 7 * DAY;
const at = (daysAgo, h = 0) => new Date(TO - daysAgo * DAY + h * 3600_000).toISOString();
const session = (ts, over = {}) => ({ ts, hand: "right", completed: true, durationMs: 95_000, openIndex: 0.77, fistIndex: 0.18, fistThumb: 0.9, reps: 10, grip: "pass", fixes: 0, incomplete: [], pain: false, ...over });

// 4 baseline sessions before the week, then 14 in it (2 a day); the last 2 days are looser by more than MDC95 → 1 flare.
const BEFORE = [10, 9, 8, 8].map((d, i) => session(at(d, i), { fistIndex: [0.18, 0.19, 0.18, 0.17][i] }));
const WEEK = [6, 5, 4, 3, 2, 1, 0].flatMap((d) => [session(at(d, -3), { fistIndex: d <= 1 ? 0.30 : 0.18 }), session(at(d, -1), { fistIndex: d <= 1 ? 0.31 : 0.19 })])
  .map((s, i) => (i === 3 ? { ...s, pain: true, completed: false, reps: 4 } : s));
const HISTORY = [...BEFORE, ...WEEK];

/** All text drawn on every page (pdf-lib writes standard-font text as hex strings, sometimes in Flate streams). */
async function textOf(bytes) {
  const doc = await PDFDocument.load(bytes);
  const out = doc.getPages().map((page) => {
    const refs = page.node.get(PDFName.of("Contents"));
    const list = refs.asArray ? refs.asArray() : [refs];
    return list.map((ref) => {
      const stream = doc.context.lookup(ref, PDFRawStream);
      const flate = String(stream.dict.get(PDFName.of("Filter")) ?? "").includes("FlateDecode");
      const raw = Buffer.from(flate ? inflateSync(stream.contents) : stream.contents).toString("latin1");
      return [...raw.matchAll(/<([0-9A-Fa-f]+)> Tj/g)].map((m) => Buffer.from(m[1], "hex").toString("latin1")).join(" ");
    }).join(" ");
  });
  return { pages: doc.getPageCount(), text: out.join(" ") };
}

test("the fixture week gives a 1–2 page PDF with the session count, the flare dates and the adherence line", async () => {
  const bytes = await buildReport({ userId: "demo", hand: "right", from: FROM, to: TO, sessions: HISTORY, routine: null, mdc95: 0.063 });
  assert.equal(Buffer.from(bytes.subarray(0, 5)).toString("latin1"), "%PDF-");
  const { pages, text } = await textOf(bytes);
  assert.equal(pages, 1, "a 2-session-a-day week, gauges and signature line fit on one page");
  assert.match(text, /14 sessions/);
  assert.match(text, /Flare: 2026-10-20 and 2026-10-21/);
  assert.match(text, /No routine on file/);
  assert.match(text, /Measurement aid, not a diagnosis/);
  assert.match(text, /Reviewed by/);
  for (const d of ["THU 10-15", "WED 10-21"]) assert.match(text, new RegExp(d), `day gauge ${d}`);
  assert.match(text, /THU 10-15 76%/, "a normal day: median of 1 − 0.18÷0.77 and 1 − 0.19÷0.77");
  assert.match(text, /WED 10-21 60%/, "a flare day: 1 − 0.305÷0.77");
  assert.match(text, /pain/i);
  assert.doesNotMatch(text, /diagnos(is|ed) (of|with)|you have/i);
});

test("with a routine, adherence is computed: reps over the therapist's max are listed", async () => {
  const routine = { exercises: [{ id: "fist-open", name: "Fist and open", sets: 1, reps: 10, quote: "Make a fist, then open, 10 times" }], limits: { maxReps: 12, painStop: true, other: [] }, sourceQuotes: ["sheet"] };
  const ok = await textOf(await buildReport({ userId: "demo", hand: "right", from: FROM, to: TO, sessions: HISTORY, routine, mdc95: 0.063 }));
  assert.match(ok.text, /Never exceeded the therapist's limits: yes/);
  const over = HISTORY.map((s, i) => (i === HISTORY.length - 1 ? { ...s, reps: 15 } : s));
  const bad = await textOf(await buildReport({ userId: "demo", hand: "right", from: FROM, to: TO, sessions: over, routine, mdc95: 0.063 }));
  assert.match(bad.text, /Never exceeded the therapist's limits: no/);
  assert.match(bad.text, /15 reps/);
});

test("an empty week is a 1-page 'no sessions this week' report, not an error", async () => {
  const { pages, text } = await textOf(await buildReport({ userId: "demo", hand: "left", from: FROM, to: TO, sessions: BEFORE, routine: null, mdc95: 0.063 }));
  assert.equal(pages, 1);
  assert.match(text, /No sessions this week/);
});

test("30 days of sessions build in under a second", async () => {
  const month = Array.from({ length: 60 }, (_, i) => session(at(30 - i / 2), { fistIndex: 0.17 + (i % 5) * 0.01 }));
  const t = performance.now();
  await buildReport({ userId: "demo", hand: "right", from: TO - 30 * DAY, to: TO, sessions: month, routine: null, mdc95: 0.063 });
  assert.ok(performance.now() - t < 1000);
});
