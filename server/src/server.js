import { readFile } from "node:fs/promises";
import { createServer } from "node:http";
import { extname, resolve } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { createMcpHandler, localhostAllowedHostnames } from "@modelcontextprotocol/server";
import { hostHeaderValidation, localhostHostValidation, localhostOriginValidation, originValidation, toNodeHandler } from "@modelcontextprotocol/node";
import { z } from "zod";
import { createFlexionServer, recordSession, Session } from "./flexion.js";
import { createIdentifier, IdentifyInput } from "./identify.js";
import { rateLimit } from "./limit.js";
import { createStore } from "./store.js";
import { COACH_TOOLS, sonicTurn } from "./voice.js";

const PORT = Number(process.env.PORT ?? 3001);
const HOST = process.env.HOST ?? "127.0.0.1";
const MAX_BODY = 2 * 1024 * 1024; // sheet photos fit; anything bigger is refused
// ALLOWED_HOSTS: comma-separated public hostnames (the Lambda URL, a tunnel), allowed on top of localhost as Host and as browser Origin.
const extraHosts = (process.env.ALLOWED_HOSTS ?? "").split(",").map((h) => h.trim()).filter(Boolean);
const hostOk = extraHosts.length ? hostHeaderValidation([...localhostAllowedHostnames(), ...extraHosts]) : localhostHostValidation();
const originOk = extraHosts.length ? originValidation([...localhostAllowedHostnames(), ...extraHosts]) : localhostOriginValidation();

// Static folders: the coach app (MCP App view) and the Echo Show host simulator.
const STATIC = { "/app/": fileURLToPath(new URL("../app/", import.meta.url)), "/host/": fileURLToPath(new URL("../host/", import.meta.url)) };
const APP_TYPES = { ".html": "text/html; charset=utf-8", ".js": "text/javascript; charset=utf-8", ".css": "text/css; charset=utf-8", ".json": "application/json", ".woff2": "font/woff2", ".mp3": "audio/mpeg" };

/** A file from one static folder; anything outside it or with an unknown extension is a 404. */
async function serveStatic(prefix, path, res) {
  try {
    const dir = STATIC[prefix];
    const file = resolve(dir, decodeURIComponent(path.slice(prefix.length)));
    const type = APP_TYPES[extname(file)];
    if (!type || !file.startsWith(dir)) throw new Error("not a static file");
    const body = await readFile(file);
    // no-cache: Chrome kept running stale builds of the spike page (2026-10-20).
    // CORS *: the MCP App iframe has the host's sandbox origin and loads these public modules cross-origin.
    res.writeHead(200, { "content-type": type, "cache-control": "no-cache", "access-control-allow-origin": "*" }).end(body);
  } catch {
    res.writeHead(404).end();
  }
}

/** GET /files/users/<id>/<key>.pdf: a stored report. The store validates id and key, so traversal is a 404. */
async function serveFile(path, res, store) {
  try {
    const [, , users, id, ...rest] = decodeURIComponent(path).split("/"); // "", "files", "users", id, key…
    const key = rest.join("/");
    if (users !== "users" || !key.endsWith(".pdf")) throw new Error("not a report");
    const bytes = await store.getBlob(id, key);
    if (!bytes) throw new Error("no such report");
    res.writeHead(200, { "content-type": "application/pdf", "cache-control": "private, no-store" }).end(bytes);
  } catch {
    res.writeHead(404).end();
  }
}

const json = (res, status, body) => res.writeHead(status, { "content-type": "application/json" }).end(JSON.stringify(body));

/** Body as text, or null past `max` bytes (the rest is drained, never buffered). */
async function readBody(req, max = MAX_BODY) {
  const chunks = [];
  let size = 0;
  for await (const c of req) {
    size += c.length;
    if (size <= max) chunks.push(c);
  }
  return size > max ? null : Buffer.concat(chunks).toString("utf8");
}

/** POST /api/session: save_session for the standalone coach, when there is no MCP host. */
async function apiSession(req, res, store) {
  if (req.method !== "POST") return json(res, 405, { error: "POST only" });
  const text = await readBody(req);
  if (text === null) return json(res, 413, { error: "body too large" });
  let body;
  try {
    body = JSON.parse(text);
  } catch {
    return json(res, 400, { error: "invalid JSON" });
  }
  const parsed = Session.safeParse(body);
  if (!parsed.success) return json(res, 400, { error: "invalid session" });
  json(res, 200, await recordSession(store, parsed.data));
}

// The host passes the tools it got from tools/list, as Alexa hands an MCP server's tools to its model; the prompt stays server-side.
// mode "coach" (the user talking back mid-session): the server supplies the session actions as tools; `state` says where the session is.
const VoiceTurn = z.object({
  text: z.string().trim().min(1).max(300),
  mode: z.enum(["intent", "coach"]).default("intent"),
  tools: z.array(z.object({ name: z.string().max(64), description: z.string().max(1000).default(""), inputSchema: z.record(z.string(), z.unknown()).optional() })).max(8).default([]),
  state: z.string().max(200).optional(),
});
const VOICE_BODY = 16 * 1024;

/** The caller's address for the rate limit: the last X-Forwarded-For hop (the one AWS adds), else the socket. */
const callerOf = (req) => req.headers["x-forwarded-for"]?.split(",").at(-1).trim() || req.socket.remoteAddress;

/** POST /api/voice: the simulator's utterance → Nova 2 Sonic picks a tool ({ tool, args }) or answers itself ({ say, audio }). */
async function apiVoice(req, res, voice, allow) {
  // CORS for the site (Amplify is another origin); the Origin guard has already refused anything not in ALLOWED_HOSTS.
  if (req.headers.origin) res.setHeader("access-control-allow-origin", req.headers.origin).setHeader("vary", "origin");
  if (req.method === "OPTIONS") return res.writeHead(204, { "access-control-allow-methods": "POST", "access-control-allow-headers": "content-type", "access-control-max-age": "600" }).end();
  if (req.method !== "POST") return json(res, 405, { error: "POST only" });
  const text = await readBody(req, VOICE_BODY);
  if (text === null) return json(res, 413, { error: "body too large" });
  let body;
  try {
    body = JSON.parse(text);
  } catch {
    return json(res, 400, { error: "invalid JSON" });
  }
  const parsed = VoiceTurn.safeParse(body);
  if (!parsed.success) return json(res, 400, { error: "invalid voice turn" });
  if (!allow(callerOf(req))) return json(res, 429, { error: "slow down" });
  try {
    const { mode, state, text: said, tools } = parsed.data;
    json(res, 200, await voice(mode === "coach"
      ? { mode, text: state ? `${said}\n(Where the session is: ${state})` : said, tools: COACH_TOOLS }
      : { mode, text: said, tools }));
  } catch (e) {
    console.error("[api/voice]", e); // the detail stays in the log; the host falls back to its keyword rules
    json(res, 503, { error: "voice unavailable" });
  }
}

const IDENTIFY_BODY = 256 * 1024; // a 224 px crop is 200 KB in base64

/** POST /api/identify: identify_object for the standalone coach, when there is no MCP host. */
async function apiIdentify(req, res, identify) {
  if (req.method !== "POST") return json(res, 405, { error: "POST only" });
  const text = await readBody(req, IDENTIFY_BODY);
  if (text === null) return json(res, 413, { error: "body too large" });
  let body;
  try {
    body = JSON.parse(text);
  } catch {
    return json(res, 400, { error: "invalid JSON" });
  }
  const parsed = IdentifyInput.safeParse(body);
  if (!parsed.success) return json(res, 400, { error: "invalid identify request" });
  const r = await identify(parsed.data); // never throws: failures come back as { label: "unknown", confidence: "low", error }
  json(res, r.error === "rate_limited" ? 429 : 200, r);
}

export function startServer(port = PORT, host = HOST, { store = createStore(), publicUrl = process.env.PUBLIC_URL, voice = sonicTurn, identify = createIdentifier() } = {}) {
  let appOrigin = publicUrl?.replace(/\/$/, ""); // set from the bound port below when no public URL is given
  const voiceAllowed = rateLimit({ gapMs: 2000, perMinute: 30 });
  // Serves the stateless 2026-07-28 spec and falls back to stateless 2025-era Streamable HTTP (what the Alexa toolkit speaks).
  const mcp = toNodeHandler(createMcpHandler(() => createFlexionServer({ store, appOrigin, identify }), { onerror: (e) => console.error("[mcp]", e) }));
  const http = createServer(async (req, res) => {
    const path = new URL(req.url, "http://localhost").pathname;
    if (path === "/healthz") return res.writeHead(200, { "content-type": "text/plain" }).end("ok");
    if (path === "/") return res.writeHead(302, { location: "/host/index.html" }).end(); // the root opens the Echo Show simulator
    const prefix = Object.keys(STATIC).find((p) => path.startsWith(p));
    if (prefix) return serveStatic(prefix, path, res);
    if (path.startsWith("/files/")) return hostOk(req, res) && serveFile(path, res, store);
    if (path !== "/mcp" && path !== "/api/session" && path !== "/api/voice" && path !== "/api/identify") return res.writeHead(404).end();
    if (!hostOk(req, res) || !originOk(req, res)) return;
    if (path === "/api/voice") return apiVoice(req, res, voice, voiceAllowed);
    if (path === "/api/identify") return apiIdentify(req, res, identify);
    if (path === "/api/session") {
      return apiSession(req, res, store).catch((e) => {
        console.error("[api/session]", e);
        if (!res.headersSent) json(res, 500, { error: "server error" });
      });
    }
    const t0 = performance.now();
    await mcp(req, res);
    // Server-side time per request: the number the Alexa 500 ms budget is checked against.
    console.log(`${req.method} /mcp ${res.statusCode} ${(performance.now() - t0).toFixed(1)} ms`);
  });
  return new Promise((resolve, reject) => http.once("error", reject).listen(port, host, () => {
    appOrigin ??= `http://${host}:${http.address().port}`;
    resolve(http);
  }));
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  // FLEXION_DATA: a throwaway store folder, so ?stub demo runs never land in the real baseline
  const store = createStore({ dir: process.env.FLEXION_DATA });
  const http = await startServer(PORT, HOST, { store });
  const at = `http://${HOST}:${http.address().port}`;
  console.log(`Flexion MCP server on ${at}/mcp · coach ${at}/app/index.html · Echo Show host simulator ${at}/host/index.html · store ${store.backend}`);
}
