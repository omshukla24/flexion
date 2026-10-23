import { after, before, test } from "node:test";
import assert from "node:assert/strict";
import { request } from "node:http";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { Client, StreamableHTTPClientTransport } from "@modelcontextprotocol/client";
import { startServer } from "../src/server.js";
import { COACH_URI, MDC95, USER } from "../src/flexion.js";
import { createStore } from "../src/store.js";
import { DEFAULT_TARGETS } from "../app/session-core.js";
import { measure } from "../scripts/latency.js";

let http, url, origin, client, dir, store;
// Stand-in for Nova 2 Sonic: records each turn; "fail" makes it throw like a Bedrock error would.
const voiceCalls = [];
const voice = async (turn) => {
  voiceCalls.push(turn);
  if (turn.text === "fail") throw new Error("AccessDeniedException: secret account detail");
  return { tool: "get_progress", args: { hand: "right" } };
};
// Stand-in for SigLIP: records each request; session "busy" is rate limited, as the real identifier answers.
const identifyCalls = [];
const identify = async (req) => {
  identifyCalls.push(req);
  return req.session === "busy" ? { label: "unknown", confidence: "low", error: "rate_limited" } : { label: "cup", confidence: "high", matchesExpect: true };
};

before(async () => {
  dir = await mkdtemp(join(tmpdir(), "flexion-server-"));
  store = createStore({ dir });
  http = await startServer(0, "127.0.0.1", { store, voice, identify });
  origin = `http://127.0.0.1:${http.address().port}`;
  url = new URL("/mcp", origin);
  client = new Client({ name: "flexion-test", version: "0.0.0" });
  await client.connect(new StreamableHTTPClientTransport(url));
});

after(async () => {
  await client.close();
  http.close();
  await rm(dir, { recursive: true, force: true });
});

// A finished coach session, as session-core's result plus the hand.
const result = (over = {}) => ({ hand: "right", completed: true, durationMs: 95_000, openIndex: 0.77, fistIndex: 0.18, fistThumb: 0.9, reps: 10, grip: "pass", fixes: 1, incomplete: [], ...over });
const daysAgo = (d) => new Date(Date.now() - d * 24 * 3600_000).toISOString();

/** Raw HTTP so tests can set Host/Origin and see the exact status and body. */
const raw = (path, { method = "POST", headers = {}, body } = {}) => new Promise((resolve, reject) => {
  request(new URL(path, origin), { method, headers: { "content-type": "application/json", ...headers } }, (res) => {
    let text = "";
    res.setEncoding("utf8").on("data", (c) => (text += c)).on("end", () => resolve({ status: res.statusCode, text }));
  }).on("error", reject).end(body);
});

test("lists the model tools and the app-only save_session and identify_object, linked to the coach view", async () => {
  const { tools } = await client.listTools();
  assert.deepEqual(tools.map((t) => t.name).sort(), ["get_progress", "identify_object", "ping", "save_session", "start_hand_check", "weekly_report"]);
  const by = Object.fromEntries(tools.map((t) => [t.name, t]));
  assert.equal(by.start_hand_check._meta.ui.resourceUri, COACH_URI);
  assert.deepEqual(by.save_session._meta.ui.visibility, ["app"]);
  assert.deepEqual(by.identify_object._meta.ui.visibility, ["app"]);
  assert.equal(by.get_progress._meta?.ui?.visibility, undefined);
});

test("start_hand_check speaks the intro for the chosen hand and returns today's targets", async () => {
  const r = await client.callTool({ name: "start_hand_check", arguments: { hand: "left" } });
  assert.match(r.content[0].text, /left hand/i);
  assert.ok(r.content[0].text.split(/\s+/).length <= 16, "short: the coach waits for Alexa to finish it before its first line");
  assert.deepEqual(r.structuredContent, { hand: "left", targets: DEFAULT_TARGETS });
  const d = await client.callTool({ name: "start_hand_check", arguments: {} });
  assert.equal(d.structuredContent.hand, "right");
});

test("coach view is MCP App HTML that loads its modules from this server, with camera permission", async () => {
  const { contents: [view] } = await client.readResource({ uri: COACH_URI });
  assert.equal(view.mimeType, "text/html;profile=mcp-app");
  assert.ok(view.text.includes(`<base href="${origin}/app/">`), "base points at this server's /app/");
  assert.match(view.text, /coach\.js/);
  assert.deepEqual(view._meta.ui.permissions, { camera: {} });
  assert.ok(view._meta.ui.csp.resourceDomains.includes(origin));
  assert.ok(view._meta.ui.csp.resourceDomains.includes("https://cdn.jsdelivr.net"));
  assert.ok(view._meta.ui.csp.connectDomains.includes("https://storage.googleapis.com"));
});

test("get_progress before any session tells the user how to start", async () => {
  const r = await client.callTool({ name: "get_progress", arguments: {} });
  assert.match(r.content[0].text, /no hand checks yet/i);
  assert.equal(r.structuredContent.progress.last, null);
});

test("save_session rejects an invalid session and stores nothing", async () => {
  const r = await client.callTool({ name: "save_session", arguments: result({ fistIndex: -1 }) }).catch(() => ({ isError: true }));
  assert.equal(r.isError, true);
  assert.equal((await store.listSessions(USER, "right")).length, 0);
});

test("save_session stores the session and calls a real change against the baseline; get_progress speaks it", async () => {
  for (const [d, v] of [[3, 0.18], [2, 0.19], [1, 0.18]]) await store.saveSession(USER, "right", { ...result({ fistIndex: v }), ts: daysAgo(d) });
  const r = await client.callTool({ name: "save_session", arguments: result({ fistIndex: 0.30 }) });
  const { session, progress, flare, mdc95 } = r.structuredContent;
  assert.equal(session.fistIndex, 0.30);
  assert.equal(progress.baseline, 0.18);
  assert.equal(progress.change, "looser");
  assert.equal(progress.streak, 4);
  assert.equal(flare.flare, false);
  assert.equal(mdc95, MDC95);
  assert.equal((await store.listSessions(USER, "right")).length, 4);

  const p = await client.callTool({ name: "get_progress", arguments: { hand: "right" } });
  assert.match(p.content[0].text, /real change/i);
  assert.match(p.content[0].text, /4-day streak/);
  assert.equal(p.structuredContent.progress.change, "looser");
});

test("weekly_report builds the PDF, stores it under an unguessable key and links it; the link serves it", async () => {
  const r = await client.callTool({ name: "weekly_report", arguments: { hand: "right" } });
  assert.match(r.content[0].text, /report/i);
  assert.equal(r.structuredContent.sessions, 4);
  const link = r.content.find((c) => c.type === "resource_link");
  assert.equal(link.mimeType, "application/pdf");
  assert.match(link.uri, new RegExp(`^${origin}/files/users/${USER}/reports/right-.+-[0-9a-f-]{36}\\.pdf$`));
  const pdf = await fetch(link.uri);
  assert.equal(pdf.status, 200);
  assert.equal(pdf.headers.get("content-type"), "application/pdf");
  assert.equal(Buffer.from(await pdf.arrayBuffer()).subarray(0, 5).toString("latin1"), "%PDF-");
  for (const p of [`/files/users/${USER}/reports/nope.pdf`, `/files/users/${USER}/..%2f${USER}.json`, `/files/users/${USER}/reports%2f..%2f..%2f${USER}.json`]) {
    assert.equal((await fetch(new URL(p, origin))).status, 404, p);
  }
});

test("POST /api/session mirrors save_session for the standalone app", async () => {
  const r = await raw("/api/session", { body: JSON.stringify(result({ hand: "left", fistIndex: 0.2 })) });
  assert.equal(r.status, 200);
  const body = JSON.parse(r.text);
  assert.equal(body.session.hand, "left");
  assert.equal(body.session.fistIndex, 0.2);
  assert.equal(body.progress.need, 3);
});

test("/api/session refuses bad JSON, invalid sessions, big bodies, other methods and foreign origins, leaking nothing", async () => {
  const bad = await raw("/api/session", { body: "{nope" });
  assert.equal(bad.status, 400);
  assert.doesNotMatch(bad.text, /\bat |\.js|SyntaxError/);
  assert.equal((await raw("/api/session", { body: JSON.stringify(result({ hand: "both" })) })).status, 400);
  assert.equal((await raw("/api/session", { body: "x".repeat(2 * 1024 * 1024 + 1) })).status, 413);
  assert.equal((await raw("/api/session", { method: "GET" })).status, 405);
  assert.equal((await raw("/api/session", { headers: { origin: "https://evil.example" }, body: JSON.stringify(result()) })).status, 403);
});

const PROGRESS_TOOL = { name: "get_progress", description: "How the user's hand is doing.", inputSchema: { type: "object", properties: { hand: { type: "string" } } } };

test("POST /api/voice asks Sonic with the host's words and tools and returns its pick", async () => {
  const r = await raw("/api/voice", { headers: { "x-forwarded-for": "10.0.0.1" }, body: JSON.stringify({ text: "how is my hand doing", tools: [PROGRESS_TOOL] }) });
  assert.equal(r.status, 200);
  assert.deepEqual(JSON.parse(r.text), { tool: "get_progress", args: { hand: "right" } });
  assert.deepEqual(voiceCalls.at(-1), { mode: "intent", text: "how is my hand doing", tools: [PROGRESS_TOOL] });
});

test("coach mode: the server hands Sonic the session actions as tools, with where the session is", async () => {
  const r = await raw("/api/voice", { headers: { "x-forwarded-for": "10.0.0.5" }, body: JSON.stringify({ text: "can we take it easier", mode: "coach", state: "step fist, 2 of 5 counted" }) });
  assert.equal(r.status, 200);
  const turn = voiceCalls.at(-1);
  assert.equal(turn.mode, "coach");
  assert.deepEqual(turn.tools.map((t) => t.name), ["pause", "resume", "repeat", "slower", "skip", "stop"]);
  assert.match(turn.text, /^can we take it easier\n.*step fist, 2 of 5 counted/);
});

test("/api/voice answers the site's CORS preflight for an allowed origin only, and its replies carry that origin", async () => {
  const site = "http://localhost:5181";
  const pre = await new Promise((resolve, reject) => request(new URL("/api/voice", origin), { method: "OPTIONS", headers: { origin: site, "access-control-request-method": "POST" } },
    (res) => resolve(res)).on("error", reject).end());
  assert.equal(pre.statusCode, 204);
  assert.equal(pre.headers["access-control-allow-origin"], site);
  assert.match(pre.headers["access-control-allow-headers"], /content-type/);
  const post = await fetch(new URL("/api/voice", origin), { method: "POST", headers: { origin: site, "content-type": "application/json", "x-forwarded-for": "10.0.0.6" }, body: JSON.stringify({ text: "hi", mode: "coach" }) });
  assert.equal(post.headers.get("access-control-allow-origin"), site);
  assert.equal((await raw("/api/voice", { method: "OPTIONS", headers: { origin: "https://evil.example" } })).status, 403);
});

test("/api/voice refuses a second turn from the same address inside 2 s", async () => {
  const turn = () => raw("/api/voice", { headers: { "x-forwarded-for": "10.0.0.2" }, body: JSON.stringify({ text: "how am I doing", tools: [] }) });
  assert.equal((await turn()).status, 200);
  assert.equal((await turn()).status, 429);
});

test("/api/voice answers 503 when Sonic fails, without leaking the error", async () => {
  const r = await raw("/api/voice", { headers: { "x-forwarded-for": "10.0.0.3" }, body: JSON.stringify({ text: "fail", tools: [] }) });
  assert.equal(r.status, 503);
  assert.ok(!r.text.includes("secret"));
});

test("/api/voice refuses empty or long text, too many tools, bad JSON, other methods and foreign origins, without asking Sonic", async () => {
  const before = voiceCalls.length;
  const post = (body, headers = {}) => raw("/api/voice", { headers: { "x-forwarded-for": "10.0.0.4", ...headers }, body });
  assert.equal((await post(JSON.stringify({ text: " ", tools: [] }))).status, 400);
  assert.equal((await post(JSON.stringify({ text: "x".repeat(301), tools: [] }))).status, 400);
  assert.equal((await post(JSON.stringify({ text: "hi", tools: Array(9).fill(PROGRESS_TOOL) }))).status, 400);
  assert.equal((await post("{nope")).status, 400);
  assert.equal((await raw("/api/voice", { method: "GET" })).status, 405);
  assert.equal((await post(JSON.stringify({ text: "hi", tools: [] }), { origin: "https://evil.example" })).status, 403);
  assert.equal(voiceCalls.length, before);
});

const CROP = Buffer.alloc(224 * 224 * 3).toString("base64");

test("identify_object passes the coach's crop, expected objects and session to identify and returns its verdict", async () => {
  const args = { rgb: CROP, expect: ["cup", "mug"], session: "s-tool" };
  const r = await client.callTool({ name: "identify_object", arguments: args });
  assert.deepEqual(r.structuredContent, { label: "cup", confidence: "high", matchesExpect: true });
  assert.deepEqual(identifyCalls.at(-1), args);
});

test("POST /api/identify mirrors identify_object for the standalone coach, and answers 429 when rate limited", async () => {
  const ok = await raw("/api/identify", { body: JSON.stringify({ rgb: CROP, session: "s-http" }) });
  assert.equal(ok.status, 200);
  assert.deepEqual(JSON.parse(ok.text), { label: "cup", confidence: "high", matchesExpect: true });
  const busy = await raw("/api/identify", { body: JSON.stringify({ rgb: CROP, session: "busy" }) });
  assert.equal(busy.status, 429);
  assert.equal(JSON.parse(busy.text).error, "rate_limited");
});

test("/api/identify refuses a missing session, too many labels, big bodies, bad JSON, other methods and foreign origins, without calling identify", async () => {
  const before = identifyCalls.length;
  assert.equal((await raw("/api/identify", { body: JSON.stringify({ rgb: CROP }) })).status, 400);
  assert.equal((await raw("/api/identify", { body: JSON.stringify({ rgb: CROP, session: "s", expect: Array(11).fill("cup") }) })).status, 400);
  assert.equal((await raw("/api/identify", { body: JSON.stringify({ rgb: "x".repeat(300_000), session: "s" }) })).status, 413);
  assert.equal((await raw("/api/identify", { body: "{nope" })).status, 400);
  assert.equal((await raw("/api/identify", { method: "GET" })).status, 405);
  assert.equal((await raw("/api/identify", { headers: { origin: "https://evil.example" }, body: JSON.stringify({ rgb: CROP, session: "s" }) })).status, 403);
  assert.equal(identifyCalls.length, before);
});

test("ping and get_progress answer via the SDK client and raw 2025-11-25 JSON-RPC inside the 500 ms Alexa budget", async () => {
  for (const tool of ["ping", "get_progress"]) {
    const r = await measure(url, 10, tool);
    assert.equal(r.legacy.protocol, "2025-11-25");
    for (const era of Object.values(r)) assert.ok(era.p95 < 500, `${tool} ${JSON.stringify(era)}`);
  }
});

test("rejects a foreign Host header (DNS-rebinding guard)", async () => {
  assert.equal((await raw("/mcp", { headers: { host: "evil.example" }, body: "{}" })).status, 403);
});

test("serves browser modules from /app/ as JavaScript, open to the MCP App iframe's origin", async () => {
  const res = await fetch(new URL("/app/vision-core.js", origin));
  assert.equal(res.status, 200);
  assert.match(res.headers.get("content-type"), /^text\/javascript/);
  assert.equal(res.headers.get("access-control-allow-origin"), "*");
  assert.match(await res.text(), /export function curls/);
  const font = await fetch(new URL("/app/fonts/atkinson-hyperlegible-next-latin.woff2", origin));
  assert.equal(font.status, 200);
  assert.equal(font.headers.get("content-type"), "font/woff2");
  assert.equal(font.headers.get("access-control-allow-origin"), "*");
});

test("serves the coach's voice clips from /app/voice/ as audio", async () => {
  const res = await fetch(new URL("/app/voice/hello.mp3", origin));
  assert.equal(res.status, 200);
  assert.equal(res.headers.get("content-type"), "audio/mpeg");
  assert.ok((await res.arrayBuffer()).byteLength > 5000);
});

test("serves the Echo Show host simulator from /host/", async () => {
  const page = await fetch(new URL("/host/index.html", origin));
  assert.equal(page.status, 200);
  assert.match(page.headers.get("content-type"), /^text\/html/);
  assert.match(await page.text(), /host\.js/);
  assert.match((await fetch(new URL("/host/host-core.js", origin))).headers.get("content-type"), /^text\/javascript/);
  const root = await fetch(origin, { redirect: "manual" });
  assert.equal(root.status, 302);
  assert.equal(root.headers.get("location"), "/host/index.html");
});

test("/app/ and /host/ refuse path traversal and unknown files", async () => {
  for (const p of ["/app/..%2fsrc%2fserver.js", "/app/%2e%2e/src/server.js", "/app/nope.js", "/app/vision-core.exe", "/host/..%2fsrc%2fserver.js", "/host/..%2fapp%2fcoach.js"]) {
    assert.equal((await fetch(new URL(p, origin))).status, 404, p);
  }
});

test("ALLOWED_HOSTS also admits that hostname as a browser Origin (the deployed coach and simulator), and nothing else", async () => {
  const { spawn } = await import("node:child_process");
  const data = await mkdtemp(join(tmpdir(), "flexion-allowed-"));
  const child = spawn(process.execPath, ["src/server.js"], { env: { ...process.env, PORT: "0", ALLOWED_HOSTS: "flexion.example", FLEXION_DATA: data } });
  try {
    const at = await new Promise((resolve, reject) => {
      child.stdout.setEncoding("utf8").on("data", (t) => { const m = t.match(/on (http:\/\/[\d.]+:\d+)\//); if (m) resolve(m[1]); });
      child.once("exit", (code) => reject(new Error(`server exited ${code}`)));
    });
    const post = (headers) => new Promise((resolve, reject) => {
      request(new URL("/api/session", at), { method: "POST", headers: { "content-type": "application/json", ...headers } }, (res) => resolve(res.resume().statusCode))
        .on("error", reject).end(JSON.stringify(result()));
    });
    assert.equal(await post({ host: "flexion.example", origin: "https://flexion.example" }), 200);
    assert.equal(await post({ host: "flexion.example", origin: "https://evil.example" }), 403);
    assert.equal(await post({ host: "evil.example" }), 403);
  } finally {
    child.kill();
    await rm(data, { recursive: true, force: true });
  }
});
