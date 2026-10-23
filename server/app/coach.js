// Flexion coach, the MCP App view: camera frames (vision.js) → the coach's brain (session-core.js) → banner, voice and the Fan.
// In a host it talks through the ext-apps App bridge (save_session, identify_object, model context); opened on its own it uses POST /api/session and /api/identify.
import { createVision } from "./vision.js";
import { BONES, rgbBase64 } from "./vision-core.js";
import { DEFAULT_TARGETS, advance, startSession, wantsIdentify } from "./session-core.js";
import { createCoachVoice, stateOf } from "./coach-voice.js";
import { estimateMs } from "./speaker-core.js";
import { LINES } from "./lines.js";

const EXT_APPS = "https://cdn.jsdelivr.net/npm/@modelcontextprotocol/ext-apps@2.0.3/dist/src/app-with-deps.js";
const PDF_LIB = "https://cdn.jsdelivr.net/npm/pdf-lib@1.17.1/+esm"; // the server's own pdf-lib version, for the report download
const STEPS = ["hello", "open", "fist", "reps", "grip", "done"];
const ALEXA_WAIT_MAX_MS = 12_000; // in a host, the coach keeps quiet while Alexa says start_hand_check's reply (at most this long)
const RESULT_WAIT_MS = 1500; // how long a host gets to deliver start_hand_check's targets before the demo targets are used
const FAN = { cx: [62, 161, 260, 359, 458], cy: [190, 166, 158, 166, 190], r: 84, names: ["thumb", "index", "middle", "ring", "little"] };
const SCALE = { min: 0, max: 0.8, x0: 24, x1: 396 }; // results scale for the fist reading (open hand ≈ 0.77)
const NS = "http://www.w3.org/2000/svg";

const $ = (id) => document.getElementById(id);
const root = document.documentElement;
const css = (n) => getComputedStyle(root).getPropertyValue(n).trim();
const reduced = matchMedia("(prefers-reduced-motion: reduce)").matches;
const params = new URLSearchParams(location.search);
const inHost = window.parent !== window;

let app = null, vision = null, session = null, live = null, lastStep = null, saving = false;
let hand = params.get("hand") === "left" ? "left" : "right", targets = DEFAULT_TARGETS;
const sessionId = crypto.randomUUID(); // keys identify's rate limit on the server

const fit = () => { $("coach").style.zoom = Math.min(innerWidth / 768, innerHeight / 480); };
addEventListener("resize", fit);
fit();

/** SVG element with attributes; fill/stroke go through style so CSS custom properties stay live across themes. */
function el(tag, attrs, parent) {
  const e = document.createElementNS(NS, tag);
  for (const k in attrs) /^(fill|stroke)$/.test(k) ? e.style.setProperty(k, attrs[k]) : e.setAttribute(k, attrs[k]);
  parent?.appendChild(e);
  return e;
}
const pol = (cx, cy, r, v) => { const a = -Math.PI / 2 + v * Math.PI / 2; return [cx + r * Math.cos(a), cy + r * Math.sin(a)]; };

// ---- the Fan: five goniometer arcs, 0–100 % curl; rose needle = now, thin ink tick = today's peak ----
function buildFan(svg) {
  const fan = { needles: [], peaks: [], pos: FAN.cx.map(() => 0), vel: FAN.cx.map(() => 0), peak: FAN.cx.map(() => 0) };
  FAN.cx.forEach((cx, i) => {
    const cy = FAN.cy[i], r = FAN.r, g = el("g", {}, svg);
    const [ax, ay] = pol(cx, cy, r, 0), [ex, ey] = pol(cx, cy, r, 1);
    el("path", { d: `M${ax},${ay} A${r},${r} 0 0 1 ${ex},${ey}`, fill: "none", stroke: "var(--line)", "stroke-width": 2 }, g);
    for (let t = 0; t <= 10; t++) {
      const [x0, y0] = pol(cx, cy, r, t / 10), [x1, y1] = pol(cx, cy, r - (t % 5 ? 5 : 10), t / 10);
      el("line", { x1: x0, y1: y0, x2: x1, y2: y1, stroke: "var(--ink)", opacity: 0.4, "stroke-width": 1 }, g);
    }
    fan.peaks.push(el("line", { stroke: "var(--ink)", "stroke-width": 1.5 }, g));
    fan.needles.push(el("line", { x1: cx, y1: cy, x2: cx, y2: cy - r + 4, stroke: "var(--rose)", "stroke-width": 3, "stroke-linecap": "round" }, g));
    el("circle", { cx, cy, r: 5, fill: "var(--rose)" }, g);
    el("text", { x: cx, y: cy + 32, "text-anchor": "middle", "font-family": css("--font-mono"), "font-size": 22, fill: "var(--muted)" }, g).textContent = FAN.names[i];
  });
  return fan;
}
const fan = buildFan($("fan"));

// One spring family (needle k/c from tokens); reduced motion snaps.
let lastT = performance.now();
function tick(now) {
  const dt = Math.min(0.033, (now - lastT) / 1000), k = +css("--spring-needle-k"), c = +css("--spring-needle-c");
  lastT = now;
  FAN.names.forEach((name, i) => {
    const goal = Math.min(1, Math.max(0, (live?.curls?.[name] ?? 0) / 100));
    if (reduced) fan.pos[i] = goal;
    else { fan.vel[i] += (k * (goal - fan.pos[i]) - c * fan.vel[i]) * dt; fan.pos[i] += fan.vel[i] * dt; }
    if (live) fan.peak[i] = Math.max(fan.peak[i], fan.pos[i]);
    const [x, y] = pol(FAN.cx[i], FAN.cy[i], FAN.r - 4, fan.pos[i]);
    fan.needles[i].setAttribute("x2", x);
    fan.needles[i].setAttribute("y2", y);
    const [p0x, p0y] = pol(FAN.cx[i], FAN.cy[i], FAN.r + 2, fan.peak[i]), [p1x, p1y] = pol(FAN.cx[i], FAN.cy[i], FAN.r - 12, fan.peak[i]);
    Object.entries({ x1: p0x, y1: p0y, x2: p1x, y2: p1y }).forEach(([a, v]) => fan.peaks[i].setAttribute(a, v));
  });
  if (session && !["reps", "done"].includes(session.step)) $("read").firstChild.nodeValue = live ? Math.round(fan.pos[1] * 100) : "–";
  requestAnimationFrame(tick);
}
requestAnimationFrame(tick);

// ---- voice: the calm speaker (Ruth's clips, one line at a time, never cut off), the voice switch and talking back ----
// session-core decides what is said and when (events only); the banner may change every frame, silently.
const voice = createCoachVoice({
  clipUrl: (id) => new URL(`voice/${id}.mp3`, import.meta.url).href,
  dispatch: (ev) => { if (session && session.step !== "done") { session = advance(session, ev); spoke(); } },
  ask: async (text) => {
    const res = await fetch("/api/voice", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ text, mode: "coach", state: stateOf(session) }), signal: AbortSignal.timeout(15_000) });
    return res.ok ? res.json() : null;
  },
  onLine: (l) => { $("said").textContent = `Coach: “${l.text}”`; },
  onSpeaking: (on) => $("voice").classList.toggle("on", on),
  onListen: (state) => { $("talkToggle").setAttribute("aria-pressed", String(state === "on")); if (state === "denied") $("said").textContent = "No microphone access, so Talk is off."; },
  onHeardText: (text) => { $("said").textContent = `You: “${text}”`; },
});
// In a host, Alexa speaks the saved result, so the coach's own closing line stays quiet.
const spoke = () => voice.sync(session, { quiet: inHost && session?.step === "done" });
const line = (id) => ({ id: `${id}-${performance.now()}`, line: id, kind: "step", text: LINES[id] });

function setVoice(on) {
  voice.speaker.on = on;
  $("voiceToggle").setAttribute("aria-pressed", String(on));
  $("voiceToggle").textContent = on ? "Voice on" : "Voice off";
}
setVoice(voice.speaker.on);
$("voiceToggle").addEventListener("click", () => setVoice(!voice.speaker.on));
// Talk back on the standalone page only: on an Echo Show, Alexa owns the microphone.
$("talkToggle").hidden = inHost || !voice.listener;
$("talkToggle").addEventListener("click", () => { voice.listener.on = !voice.listener.on; });

// ---- live screen ----
function setBanner(kind, text, step = "") {
  $("banner").dataset.kind = kind;
  $("cue").textContent = text;
  $("step").textContent = step;
}

function stepLabel(s) {
  const T = s.targets;
  const what = {
    hello: "CAMERA", open: `OPEN ${s.captures.open.length}/${T.open}`, fist: `FIST ${s.captures.fist.length}/${T.fist}`,
    reps: `REPS ${s.repsDone}/${T.reps}`, grip: `GRIP · ${T.grip.object.toUpperCase()}`, done: "DONE",
  }[s.step];
  return `STEP ${STEPS.indexOf(s.step) + 1}/${STEPS.length} · ${what}`;
}

let colors = {};
const readColors = () => { colors = { ink: css("--ink"), rose: css("--rose"), bead: css("--surface") }; };
readColors();
const ctx = $("overlay").getContext("2d");

/** Landmark beads on the camera image, in video pixels (the canvas is mirrored with the video). */
function drawOverlay(h) {
  const c = $("overlay"), v = $("video");
  if (v.videoWidth && c.width !== v.videoWidth) Object.assign(c, { width: v.videoWidth, height: v.videoHeight });
  ctx.clearRect(0, 0, c.width, c.height);
  if (!h?.pts) return;
  ctx.globalAlpha = 0.7;
  ctx.lineWidth = 3;
  ctx.strokeStyle = colors.bead;
  ctx.beginPath();
  for (const [a, b] of BONES) { ctx.moveTo(...h.pts[a]); ctx.lineTo(...h.pts[b]); }
  ctx.stroke();
  ctx.globalAlpha = 1;
  h.pts.forEach(([x, y], i) => {
    const tip = i > 0 && i % 4 === 0;
    ctx.beginPath();
    ctx.arc(x, y, tip ? 9 : 6, 0, Math.PI * 2);
    ctx.fillStyle = colors.bead;
    ctx.fill();
    ctx.strokeStyle = tip ? colors.rose : colors.ink;
    ctx.stroke();
  });
}

function render(now) {
  const s = session;
  setBanner(s.cue.kind, s.cue.text, stepLabel(s));
  if (s.step === "reps") {
    $("readLabel").textContent = "Reps · open and close";
    $("read").innerHTML = `${s.repsDone}<small>/${s.targets.reps}</small>`;
  } else if (s.step !== lastStep) {
    $("readLabel").textContent = "Index curl · now";
    $("read").innerHTML = "–<small>%</small>";
  }
  if (s.step !== lastStep) {
    lastStep = s.step;
    tellHost(`The Flexion coach is on step "${s.step}". On screen: ${s.cue.text}`, { step: s.step });
  }
}

/** A fresh session; `?grip` skips straight to the grip step to test identify without the warm-up (nothing is saved). */
function begin(t) {
  let s = startSession({ t, targets });
  while (params.has("grip") && s.step !== "grip") s = advance(s, { type: "skip", t });
  return s;
}

function onFrame({ t, hands }) {
  // shortcut: coaches the first hand MediaPipe returns; filter by side once two-hand sessions exist
  live = hands[0] ?? null;
  session = advance(session ?? begin(t), { type: "frame", t, hand: live });
  spoke();
  drawOverlay(live);
  render(t);
  if (wantsIdentify(session, live)) identifyHand(t);
  if (session.step === "done" && !saving) {
    saving = true;
    live = null;
    vision.stop();
    finish(session.result);
  }
}

const tellHost = (text, structuredContent) => app?.updateModelContext({ content: [{ type: "text", text }], structuredContent }).catch(() => {});

// ---- identify: in the grip step, SigLIP on the server names what the object detector can't ----
async function callIdentify(args) {
  if (app) {
    const r = await app.callServerTool({ name: "identify_object", arguments: args });
    if (r.isError) throw new Error(r.content?.[0]?.text ?? "identify_object failed");
    return r.structuredContent;
  }
  const res = await fetch("/api/identify", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(args) });
  if (!res.ok && res.status !== 429) throw new Error(`HTTP ${res.status}`); // a 429 carries { error: "rate_limited" }
  return res.json();
}

async function identifyHand(t) {
  session = advance(session, { type: "identifying", t });
  const rgb = vision.snapshotHand(0);
  let matches = false; // a miss, a hand gone before the snapshot, or a failure: the coach stays quiet and the step runs on
  try {
    if (rgb) matches = (await callIdentify({ rgb, expect: session.targets.grip.accept, session: sessionId })).matchesExpect === true;
  } catch (e) {
    console.error("[coach] identify", e);
  }
  session = advance(session, { type: "identified", t: performance.now(), matches });
  spoke();
}

// ---- results card: today vs the personal baseline, with the MDC95 noise band ----
const fmt = (x) => (Number.isFinite(x) ? x.toFixed(2) : "–");
const xOf = (v) => SCALE.x0 + (Math.min(SCALE.max, Math.max(SCALE.min, v)) - SCALE.min) / (SCALE.max - SCALE.min) * (SCALE.x1 - SCALE.x0);

function scaleSvg(today, baseline, mdc95) {
  const svg = el("svg", { viewBox: "0 0 420 92", role: "img", "aria-label": "Fist reading on a scale, lower is tighter" });
  el("line", { x1: 0, y1: 0, x2: 0, y2: 6, stroke: "var(--muted)", "stroke-width": 1.5 },
    el("pattern", { id: "hatch", width: 6, height: 6, patternUnits: "userSpaceOnUse", patternTransform: "rotate(45)" }, el("defs", {}, svg)));
  if (Number.isFinite(baseline)) {
    el("rect", { x: xOf(baseline - mdc95), y: 18, width: xOf(baseline + mdc95) - xOf(baseline - mdc95), height: 30, fill: "url(#hatch)", opacity: 0.7 }, svg);
    el("line", { x1: xOf(baseline), y1: 12, x2: xOf(baseline), y2: 54, stroke: "var(--muted)", "stroke-width": 2 }, svg);
    el("text", { x: xOf(baseline), y: 9, "text-anchor": "middle", "font-size": 15, fill: "var(--muted)", "font-family": css("--font-mono") }, svg).textContent = "YOUR USUAL";
  }
  el("line", { x1: SCALE.x0, y1: 48, x2: SCALE.x1, y2: 48, stroke: "var(--ink)", "stroke-width": 1.5 }, svg);
  for (let v = 0; v <= SCALE.max + 1e-9; v += 0.05) {
    const major = Math.round(v * 100) % 20 === 0;
    el("line", { x1: xOf(v), y1: 48, x2: xOf(v), y2: major ? 58 : 53, stroke: "var(--ink)", opacity: 0.5, "stroke-width": 1 }, svg);
    if (major) el("text", { x: xOf(v), y: 72, "text-anchor": "middle", "font-size": 15, fill: "var(--muted)", "font-family": css("--font-mono") }, svg).textContent = v.toFixed(1);
  }
  el("text", { x: SCALE.x0, y: 88, "font-size": 15, fill: "var(--muted)", "font-family": css("--font-mono") }, svg).textContent = "← TIGHTER";
  el("text", { x: SCALE.x1, y: 88, "text-anchor": "end", "font-size": 15, fill: "var(--muted)", "font-family": css("--font-mono") }, svg).textContent = "LOOSER →";
  if (Number.isFinite(today)) el("circle", { cx: xOf(today), cy: 33, r: 9, fill: "var(--rose)", stroke: "var(--surface)", "stroke-width": 2 }, svg);
  return svg;
}

const VERDICT = {
  noise: ["Real change: no", "Inside your normal day-to-day range.", ""],
  tighter: ["Real change: yes, tighter", "Your fist closed further than your usual.", "ok"],
  looser: ["Real change: yes, looser", "Your fist was looser than your usual.", "care"],
};

function verdictOf(progress) {
  if (!progress) return ["Saving your check…", "", ""];
  if (progress.need) return ["Building your normal range", `${progress.need} more check${progress.need > 1 ? "s" : ""} and I can call real change.`, ""];
  return VERDICT[progress.change] ?? ["No fist reading today", "Real change needs a fist reading.", ""];
}

/** r: save_session's structuredContent, or just { session } while saving or after a failed save. */
function showResults(r, status, retry) {
  const s = r.session, p = r.progress;
  const [head, sub, tone] = verdictOf(p);
  const mins = Math.floor(s.durationMs / 60_000), secs = Math.round(s.durationMs / 1000) % 60;
  const grip = { pass: `${s.targets?.grip?.object ?? targets.grip.object} ✔`, fail: "not done", skipped: "skipped" }[s.grip] ?? "–";
  const box = $("results");
  $("videoBox").hidden = $("side").hidden = true;
  box.hidden = false;
  box.innerHTML = `
    <header><span class="label">Today · ${s.hand} hand</span><span class="label status" data-ok="${status === "Saved"}">${status}</span></header>
    <div><span class="label">Fist reading</span><div class="reading">${fmt(s.fistIndex)}<small>${p?.baseline != null ? `usual ${fmt(p.baseline)}` : "lower is tighter"}</small></div></div>
    <div class="verdict tape" data-tone="${tone}">${head}<small>${sub}</small></div>
    <dl class="facts">
      <dt>Reps</dt><dd>${s.reps}/${targets.reps}</dd>
      <dt>Grip</dt><dd>${grip}</dd>
      <dt>Form fixes</dt><dd>${s.fixes}</dd>
      <dt>Time</dt><dd>${mins}:${String(secs).padStart(2, "0")}</dd>
      <dt>Streak</dt><dd>${p?.streak ? `${p.streak} day${p.streak > 1 ? "s" : ""}` : "–"}</dd>
      <dt>Complete</dt><dd>${s.completed ? "yes" : "no"}</dd>
    </dl>`;
  box.insertBefore(scaleSvg(s.fistIndex, p?.baseline, r.mdc95 ?? 0), box.querySelector(".verdict"));
  if (retry) {
    const b = Object.assign(document.createElement("button"), { textContent: "Try saving again", onclick: retry });
    box.append(b);
  }
  setBanner({ care: "fix", ok: "correct" }[tone] ?? "instruction", p ? head : "All done. Saving now.", "STEP 6/6 · DONE");
}

async function save(payload) {
  if (app) {
    const r = await app.callServerTool({ name: "save_session", arguments: payload });
    if (r.isError) throw new Error(r.content?.[0]?.text ?? "save_session failed");
    tellHost(r.content?.[0]?.text ?? "Session saved.", { step: "done", ...r.structuredContent }); // Alexa speaks the result
    return r.structuredContent;
  }
  const res = await fetch("/api/session", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(payload) });
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  return res.json();
}

const verdictLine = (p) => (p?.need ? "v-building" : { noise: "v-noise", tighter: "v-tighter", looser: "v-looser" }[p?.change] ?? "v-none");

/** The detailed PDF of this session (standalone page only: an Echo Show doesn't download files; Alexa's weekly_report does that). */
function offerReport(progress) {
  if (inHost) return;
  const log = session.log, result = session.result;
  const b = Object.assign(document.createElement("button"), { textContent: "Download report (PDF)", className: "report" });
  b.onclick = async () => {
    b.disabled = true;
    try {
      const [{ buildSessionReport }, pdf] = await Promise.all([import("./session-report.js"), import(PDF_LIB)]);
      const bytes = await buildSessionReport({ log, result, progress, hand, when: Date.now() }, pdf);
      const a = Object.assign(document.createElement("a"), { href: URL.createObjectURL(new Blob([bytes], { type: "application/pdf" })), download: `flexion-${new Date().toISOString().slice(0, 10)}-${hand}-hand.pdf` });
      a.click();
      setTimeout(() => URL.revokeObjectURL(a.href), 10_000);
    } catch (e) {
      console.error("[coach] report", e);
      b.textContent = "Report didn't build. Try again";
    } finally {
      b.disabled = false;
    }
  };
  $("results").append(b);
}

async function finish(result) {
  const payload = { ...result, hand, durationMs: Math.round(result.durationMs) };
  if (params.has("grip")) { // keeps identify tests out of the real store
    showResults({ session: payload }, "Test run, not saved");
    return offerReport(null);
  }
  showResults({ session: payload }, "Saving…");
  try {
    const r = await save(payload);
    showResults(r, "Saved");
    offerReport(r.progress);
    if (!app) voice.speaker.say(line(verdictLine(r.progress))); // in a host, Alexa speaks save_session's summary instead
  } catch (e) {
    console.error("[coach] save failed", e);
    showResults({ session: payload }, "Not saved yet", () => finish(result)); // keep the numbers on screen and let the user retry
    offerReport(null);
  }
}

// ---- camera failure: say so plainly and hand over to voice ----
function cameraFailed(e) {
  const denied = e?.name === "NotAllowedError" || e?.name === "SecurityError";
  const cue = "Camera is off. Tell me how it feels.";
  setBanner("fix", cue, "NO CAMERA");
  $("note").hidden = false;
  $("note").textContent = denied
    ? "No camera access, so I can't measure today. You can still talk it through: tell me how your hand feels."
    : `The camera or the hand model didn't start (${e?.name ?? "error"}). You can still tell me how your hand feels.`;
  voice.speaker.say(line("camera-off"));
  tellHost("The camera is unavailable, so the hand check can't measure today. Ask the user how their hand feels and continue by voice.", { step: "camera-unavailable" });
}

// ---- ?stub: a scripted hand that walks the whole flow in ~1.5 min at a person's pace (layout checks and demos without a camera) ----
function createStubVision({ onFrame }) {
  const OPEN = { state: "Open", rom: { index: 0.77, fist: 0.8, thumb: 1.1, width: 0.62 }, curls: { thumb: 12, index: 6, middle: 5, ring: 8, little: 10 } };
  const FIST = { state: "Fist", rom: { index: 0.18, fist: 0.21, thumb: 0.92, width: 0.6 }, curls: { thumb: 58, index: 88, middle: 91, ring: 86, little: 83 } };
  const TUCKED = { ...FIST, rom: { ...FIST.rom, thumb: 0.42 }, formIssue: "thumb-tucked" };
  // Follows the coach like a person would, timed from the start of each step: hold ~2.6 s, rest ~1.4 s.
  const cycle = (k, pose) => (k % 4000 < 2600 ? pose : null);
  const handAt = (t) => {
    const s = session, k = t - (s?.stepT0 ?? t);
    if (!s || s.paused) return null;
    if (s.step === "hello") return k > 1200 ? OPEN : null;
    if (s.step === "open") return cycle(k, OPEN);
    if (s.step === "fist") return k < 5200 ? TUCKED : cycle(k, FIST); // a lasting thumb tuck first, so a fix is said and fixed
    if (s.step === "reps") return { ...(Math.floor(k / 900) % 2 ? FIST : OPEN), reps: Math.floor(k / 1800) };
    // grip: an open hand the detector can't name, so identify gets the drawn mug below; the detector's cup is the backstop
    if (s.step === "grip") return k < 9000 ? OPEN : { ...OPEN, holding: "cup" };
    return null;
  };
  let timer = null;
  return {
    async start() {
      $("note").hidden = false;
      $("note").textContent = "Demo feed: a scripted hand, no camera.";
      timer = setInterval(() => {
        const t = performance.now(), h = handAt(t);
        onFrame({ t, hands: h ? [h] : [] });
      }, 33);
    },
    stop() { clearInterval(timer); },
    /** A drawn mug instead of a camera crop: SigLIP reads it as "cup" (checked 2026-10-22), so identify really runs. */
    snapshotHand() {
      const g = Object.assign(document.createElement("canvas"), { width: 224, height: 224 }).getContext("2d");
      g.fillStyle = "#f2efe9";
      g.fillRect(0, 0, 224, 224);
      g.fillStyle = g.strokeStyle = "#c0392b";
      g.fillRect(52, 60, 100, 120);
      g.lineWidth = 16;
      g.beginPath();
      g.arc(152, 120, 32, -Math.PI / 2, Math.PI / 2);
      g.stroke();
      return rgbBase64(g.getImageData(0, 0, 224, 224).data);
    },
  };
}

// ---- start ----
const applyTheme = (theme) => { if (theme === "light" || theme === "dark") { root.dataset.theme = theme; readColors(); } };

/** Connects to the MCP host and waits (briefly) for start_hand_check's hand and targets. */
async function connectHost() {
  const { App } = await import(EXT_APPS);
  app = new App({ name: "flexion-coach", version: "0.2.0" });
  const got = new Promise((done) => {
    app.ontoolinput = ({ arguments: a }) => { if (a?.hand === "left" || a?.hand === "right") hand = a.hand; };
    app.ontoolresult = ({ content, structuredContent: sc }) => {
      // One voice at a time: Alexa is saying this reply right now, so the coach's first line waits for it.
      const reply = content?.find((c) => c.type === "text")?.text;
      if (reply) voice.speaker.wait(Math.min(ALEXA_WAIT_MAX_MS, estimateMs(reply) + 1000));
      if (sc?.targets) targets = sc.targets;
      if (sc?.hand) hand = sc.hand;
      done();
    };
    setTimeout(done, RESULT_WAIT_MS);
  });
  app.onhostcontextchanged = (c) => applyTheme(c.theme);
  await app.connect();
  applyTheme(app.getHostContext()?.theme);
  await got;
}

async function run() {
  $("start").hidden = true;
  setBanner("instruction", "Getting the camera ready…", "STEP 1/6 · CAMERA");
  try {
    // "flexion/stub" in host context: the host simulator's no-camera run (a srcdoc frame has no ?query)
    const stub = params.has("stub") || app?.getHostContext()?.["flexion/stub"] === true;
    vision = stub ? createStubVision({ onFrame }) : await createVision({ video: $("video"), onFrame, maxHands: 2 });
    await vision.start();
  } catch (e) {
    console.error("[coach] camera", e);
    cameraFailed(e);
  }
}

if (inHost) {
  connectHost().catch((e) => console.error("[coach] host bridge", e)).finally(run);
} else {
  // Standalone: one tap starts it, because browsers only allow speech after a user gesture (and no autoplaying sound).
  setBanner("instruction", "Ready when you are.", "FLEXION · HAND CHECK");
  $("start").hidden = false;
  $("start").addEventListener("click", run, { once: true });
}
