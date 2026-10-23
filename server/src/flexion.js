import { randomUUID } from "node:crypto";
import { readFile } from "node:fs/promises";
import { McpServer } from "@modelcontextprotocol/server";
import { registerAppResource, registerAppTool, RESOURCE_MIME_TYPE } from "@modelcontextprotocol/ext-apps/server";
import { z } from "zod";
import { DEFAULT_TARGETS } from "../app/session-core.js";
import { IdentifyInput } from "./identify.js";
import { buildReport } from "./report.js";
import { flareCheck, progressOf } from "./routine.js";

export const COACH_URI = "ui://flexion/coach.html";
// Measured fist noise from validation run 4 (2026-10-20): index tip→knuckle ÷ palm. A smaller change is day-to-day noise, not progress.
export const MDC95 = 0.063;
// shortcut: one demo user (no account linking in v1); per-user ids arrive with OAuth
export const USER = "demo";
const COACH_HTML = await readFile(new URL("../app/index.html", import.meta.url), "utf8");

const Hand = z.enum(["left", "right"]);
const Ratio = z.number().min(0).max(3).nullable(); // a length ÷ palm length; null when that step wasn't captured
/** A finished coach session: session-core's result plus the hand. Unknown keys are dropped. */
export const Session = z.object({
  hand: Hand,
  completed: z.boolean(),
  durationMs: z.number().min(0).max(3_600_000),
  openIndex: Ratio,
  fistIndex: Ratio,
  fistThumb: Ratio,
  reps: z.number().int().min(0).max(1000),
  grip: z.enum(["pass", "fail", "skipped"]).nullable(),
  fixes: z.number().int().min(0).max(1000),
  incomplete: z.array(z.enum(["hello", "open", "fist", "reps", "grip"])).max(5),
  pain: z.boolean().default(false),
});

/** Progress for one hand: the newest session vs baseline, plus the flare check. */
export async function progressFor(store, hand) {
  const history = await store.listSessions(USER, hand);
  return { hand, progress: progressOf(history, MDC95), flare: flareCheck(history, MDC95), mdc95: MDC95 };
}

/** Stores a validated session (save_session and POST /api/session) and returns the results-card numbers. */
export async function recordSession(store, { hand, ...session }) {
  const saved = await store.saveSession(USER, hand, session);
  return { session: saved, ...(await progressFor(store, hand)) };
}

/** Builds the PDF for the last `days` days, stores it and returns its link plus the numbers Alexa reads out. */
export async function weeklyReport(store, { hand, days }, appOrigin, now = Date.now()) {
  const from = now - days * 24 * 3600_000;
  const [sessions, routine] = await Promise.all([store.listSessions(USER, hand), store.getRoutine(USER)]);
  const bytes = await buildReport({ userId: USER, hand, from, to: now, sessions, routine, mdc95: MDC95 });
  // shortcut: the unguessable key is the only guard on /files/ until OAuth. Not S3 presigned links: ones signed with the Lambda role's session credentials die within hours, not 7 days.
  const blob = await store.putBlob(USER, `reports/${hand}-${new Date(now).toISOString().slice(0, 10)}-${randomUUID()}.pdf`, bytes, "application/pdf");
  return { url: `${appOrigin}/files/${blob.key}`, hand, days, sessions: sessions.filter((s) => Date.parse(s.ts) >= from).length, flare: flareCheck(sessions, MDC95, now).flare };
}

const f = (x) => x.toFixed(2);
const GRIP = { pass: "grip task passed", fail: "grip task not done" };

/** What Alexa says: the same facts as the results card, in plain words. */
export function sayProgress({ last, baseline, change, need, streak }, flare) {
  if (!last) return "No hand checks yet. Say: start my hand check.";
  const facts = [Number.isFinite(last.fistIndex) ? `fist reading ${f(last.fistIndex)}, lower is tighter` : "no fist reading", `${last.reps} reps`, GRIP[last.grip]].filter(Boolean);
  const said = [`Your last hand check${last.completed ? "" : " was cut short"}: ${facts.join(", ")}.`];
  if (need) said.push(`${need} more check${need > 1 ? "s" : ""} and I'll know your normal range.`);
  else if (change === "noise") said.push(`That's within your normal range; your usual is ${f(baseline)}.`);
  else if (change) said.push(`That's a real change: ${change} than your usual ${f(baseline)}, beyond day-to-day noise.`);
  if (flare?.flare) said.push(flare.reason);
  if (streak >= 2) said.push(`You're on a ${streak}-day streak.`);
  return said.join(" ");
}

const reply = (r) => ({ content: [{ type: "text", text: sayProgress(r.progress, r.flare) }], structuredContent: r });

/** One fresh server per request (createMcpHandler is stateless). `appOrigin` serves the coach's modules from /app/; `identify` is shared across requests (it holds the model and the rate limit). */
export function createFlexionServer({ store, appOrigin, identify }) {
  const server = new McpServer({ name: "flexion", version: "0.2.0" });
  // MediaPipe loads its JS and wasm from jsDelivr and its models from Google Storage; the coach's own modules come from this server.
  const ui = {
    csp: { resourceDomains: ["https://cdn.jsdelivr.net", appOrigin], connectDomains: ["https://cdn.jsdelivr.net", "https://storage.googleapis.com"] },
    permissions: { camera: {} },
  };

  server.registerTool(
    "ping",
    {
      title: "Ping",
      description: "Health check. Returns the server time so callers can measure round-trip latency.",
      annotations: { readOnlyHint: true },
    },
    async () => ({ content: [{ type: "text", text: `pong ${new Date().toISOString()}` }] }),
  );

  registerAppTool(
    server,
    "start_hand_check",
    {
      title: "Start hand check",
      description: "Open the camera hand coach: a few calm minutes of guided open-hand, fist, rep and grip steps. Use when the user asks to check, measure, test or exercise their hand or fingers.",
      inputSchema: z.object({ hand: Hand.default("right").describe("The hand to check") }),
      annotations: { readOnlyHint: true },
      _meta: { ui: { resourceUri: COACH_URI } },
    },
    async ({ hand }) => ({
      // Spoken by Alexa while the view opens; short, because the coach waits for it to end before its first line (one voice at a time).
      content: [{ type: "text", text: `Let's check your ${hand} hand. I'll guide you, slowly. It takes a few minutes.` }],
      // shortcut: demo targets for every user; routine exercises map to coach steps once sheets become routines
      structuredContent: { hand, targets: DEFAULT_TARGETS },
    }),
  );

  registerAppTool(
    server,
    "save_session",
    {
      title: "Save session",
      description: "Called by the coach view when a session ends: stores it and compares it with the user's baseline.",
      inputSchema: Session,
      _meta: { ui: { resourceUri: COACH_URI, visibility: ["app"] } },
    },
    async (session) => reply(await recordSession(store, session)),
  );

  registerAppTool(
    server,
    "identify_object",
    {
      title: "Identify object",
      description: "Called by the coach view in the grip step: names the object in the hand crop and checks it against the objects the task accepts.",
      inputSchema: IdentifyInput,
      _meta: { ui: { resourceUri: COACH_URI, visibility: ["app"] } },
    },
    async (req) => {
      const r = await identify(req);
      return { content: [{ type: "text", text: r.error ? `Can't identify: ${r.error}` : `${r.label} (${r.confidence} confidence)` }], structuredContent: r };
    },
  );

  server.registerTool(
    "get_progress",
    {
      title: "Get progress",
      description: "How the user's hand is doing: the last check against their own baseline, whether it's a real change or normal day-to-day noise, and their streak. Use when they ask how their hand or exercises are going.",
      inputSchema: z.object({ hand: Hand.default("right").describe("Which hand") }),
      annotations: { readOnlyHint: true },
    },
    async ({ hand }) => reply(await progressFor(store, hand)),
  );

  // A plain tool, not an MCP Task: Tasks exist only in the 2025-11-25 wire era (deleted in 2026-07-28), SDK v2 has no
  // server-side Task API, and the PDF builds in well under Alexa's 3 s budget.
  server.registerTool(
    "weekly_report",
    {
      title: "Weekly report",
      description: "Make the user's one-page PDF for their hand therapist: sessions, the trend against their normal range, flare days and the therapist's limits. Use when they ask for a report, a summary for their therapist, or how their week went on paper.",
      inputSchema: z.object({ hand: Hand.default("right").describe("Which hand"), days: z.number().int().min(1).max(31).default(7).describe("How many days back") }),
    },
    async (args) => {
      const r = await weeklyReport(store, args, appOrigin);
      const what = r.sessions ? `${r.sessions} session${r.sessions > 1 ? "s" : ""}${r.flare ? ", and a flare in the last two days" : ""}` : "no sessions, so it just says that";
      return {
        content: [
          { type: "text", text: `Your ${r.days}-day report for your ${r.hand} hand is ready: ${what}. The link is on your screen, ready to send to your therapist.` },
          { type: "resource_link", uri: r.url, name: "Flexion weekly report", mimeType: "application/pdf" },
        ],
        structuredContent: r,
      };
    },
  );

  registerAppResource(
    server,
    "Flexion coach",
    COACH_URI,
    { description: "Camera coach that guides a hand session step by step and measures range of motion with MediaPipe.", _meta: { ui } },
    async () => ({
      contents: [{ uri: COACH_URI, mimeType: RESOURCE_MIME_TYPE, text: COACH_HTML.replace("<head>", `<head>\n<base href="${appOrigin}/app/">`), _meta: { ui } }],
    }),
  );

  return server;
}
