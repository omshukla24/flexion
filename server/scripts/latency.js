// Day-1 gate G6 (server side): call `ping` and `get_progress` over Streamable HTTP in both protocol eras and report p50/p95.
// Usage: node scripts/latency.js [url] [calls]   e.g. node scripts/latency.js https://<tunnel>/mcp 50
import { pathToFileURL } from "node:url";
import { Client, StreamableHTTPClientTransport } from "@modelcontextprotocol/client";

const BUDGET_MS = 500; // Alexa MCP Toolkit: every tool round trip under 500 ms
const LEGACY_PROTOCOL = "2025-11-25"; // what the Alexa toolkit negotiates

const percentiles = (ms) => {
  const s = [...ms].sort((a, b) => a - b);
  const at = (p) => s[Math.min(s.length - 1, Math.floor(p * s.length))];
  return { p50: at(0.5), p95: at(0.95), max: s.at(-1) };
};

async function timeCalls(n, call) {
  const ms = [];
  for (let i = 0; i < n; i++) {
    const t = performance.now();
    await call();
    ms.push(performance.now() - t);
  }
  return percentiles(ms);
}

// SDK client with its default negotiation (observed: the 2025 initialize handshake).
async function measureSdk(url, n, tool) {
  const client = new Client({ name: "flexion-latency", version: "0.1.0" });
  const t0 = performance.now();
  await client.connect(new StreamableHTTPClientTransport(url));
  const connectMs = performance.now() - t0;
  try {
    return { connectMs, ...(await timeCalls(n, () => client.callTool({ name: tool }))) };
  } finally {
    await client.close();
  }
}

// Raw 2025-era JSON-RPC, the way the Alexa toolkit and the Echo bridge talk to an MCP server.
async function rpc(url, body, protocol) {
  const res = await fetch(url, {
    method: "POST",
    headers: { "content-type": "application/json", accept: "application/json, text/event-stream", ...(protocol && { "mcp-protocol-version": protocol }) },
    body: JSON.stringify(body),
  });
  const text = await res.text();
  if (!res.ok) throw new Error(`HTTP ${res.status}: ${text}`);
  const isSse = res.headers.get("content-type")?.includes("text/event-stream");
  const msg = JSON.parse(isSse ? text.split("\n").find((l) => l.startsWith("data: ")).slice(6) : text);
  if (msg.error) throw new Error(`JSON-RPC error: ${JSON.stringify(msg.error)}`);
  return msg.result;
}

async function measureLegacy(url, n, tool) {
  const t0 = performance.now();
  const init = await rpc(url, {
    jsonrpc: "2.0", id: 1, method: "initialize",
    params: { protocolVersion: LEGACY_PROTOCOL, capabilities: {}, clientInfo: { name: "flexion-latency-legacy", version: "0.1.0" } },
  });
  const connectMs = performance.now() - t0;
  let id = 2;
  const stats = await timeCalls(n, () => rpc(url, { jsonrpc: "2.0", id: id++, method: "tools/call", params: { name: tool, arguments: {} } }, init.protocolVersion));
  return { protocol: init.protocolVersion, connectMs, ...stats };
}

export async function measure(url, n = 50, tool = "ping") {
  return { sdk: await measureSdk(url, n, tool), legacy: await measureLegacy(url, n, tool) };
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const url = new URL(process.argv[2] ?? "http://127.0.0.1:3001/mcp");
  const n = Number(process.argv[3] ?? 50);
  let ok = true;
  for (const tool of ["ping", "get_progress"]) {
    const result = await measure(url, n, tool);
    for (const [era, r] of Object.entries(result)) {
      ok &&= r.p95 < BUDGET_MS;
      console.log(`${tool.padEnd(12)} ${era.padEnd(6)} ${r.protocol ?? ""} connect ${r.connectMs.toFixed(0)} ms · p50 ${r.p50.toFixed(1)} · p95 ${r.p95.toFixed(1)} · max ${r.max.toFixed(1)} ms`);
    }
  }
  console.log(`G6 ${ok ? "PASS" : "FAIL"}: p95 ${ok ? "<" : "≥"} ${BUDGET_MS} ms over ${n} calls per tool to ${url}`);
  process.exitCode = ok ? 0 : 1;
}
