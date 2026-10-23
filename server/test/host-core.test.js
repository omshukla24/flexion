import { test } from "node:test";
import assert from "node:assert/strict";
import { brief, cspFor, forApp, forModel, intentOf, pickOf, voiceRequest } from "../host/host-core.js";

const TOOLS = [
  { name: "ping" },
  { name: "start_hand_check", _meta: { ui: { resourceUri: "ui://flexion/coach.html" } } },
  { name: "get_progress" },
  { name: "save_session", _meta: { ui: { resourceUri: "ui://flexion/coach.html", visibility: ["app"] } } },
];

test("visibility: tools default to both; app-only tools are hidden from the model", () => {
  assert.equal(forModel(TOOLS[1]), true);
  assert.equal(forApp(TOOLS[1]), true);
  assert.equal(forModel(TOOLS[3]), false);
  assert.equal(forApp(TOOLS[3]), true);
  assert.equal(forApp({ name: "x", _meta: { ui: { visibility: ["model"] } } }), false);
});

test("intents: hand checks, with the hand named", () => {
  assert.deepEqual(intentOf("Alexa, check my hand", TOOLS), { tool: "start_hand_check", args: { hand: "right" } });
  assert.deepEqual(intentOf("test my LEFT hand", TOOLS), { tool: "start_hand_check", args: { hand: "left" } });
  assert.deepEqual(intentOf("start my exercises", TOOLS), { tool: "start_hand_check", args: { hand: "right" } });
});

test("intents: progress questions win over the word 'check'", () => {
  assert.equal(intentOf("how did I do", TOOLS).tool, "get_progress");
  assert.equal(intentOf("how is my hand doing?", TOOLS).tool, "get_progress");
  assert.equal(intentOf("how did my hand check go", TOOLS).tool, "get_progress");
});

test("intents: no match, a tool the server doesn't list, and app-only tools all give null", () => {
  assert.equal(intentOf("what's the weather", TOOLS), null);
  assert.equal(intentOf("send my weekly report", TOOLS), null);
  assert.equal(intentOf("save my session", TOOLS), null);
  assert.equal(intentOf("how did I do", TOOLS.filter((t) => t.name !== "get_progress")), null);
});

test("voice request: the words plus only the tools the model may see, without their _meta", () => {
  const tools = [{ name: "get_progress", description: "How it's going.", inputSchema: { type: "object" }, _meta: { x: 1 } }, TOOLS[3]];
  assert.deepEqual(voiceRequest("how am I doing", tools), { text: "how am I doing", tools: [{ name: "get_progress", description: "How it's going.", inputSchema: { type: "object" } }] });
});

test("sonic pick: a listed model tool with a valid hand goes through", () => {
  assert.deepEqual(pickOf({ tool: "start_hand_check", args: { hand: "left" } }, TOOLS), { tool: "start_hand_check", args: { hand: "left" } });
});

test("sonic pick: an unknown hand is dropped so the tool's default applies", () => {
  assert.deepEqual(pickOf({ tool: "get_progress", args: { hand: "both", extra: 1 } }, TOOLS), { tool: "get_progress", args: {} });
});

test("sonic pick: a tool the server doesn't list, or an app-only one, is refused", () => {
  assert.equal(pickOf({ tool: "delete_everything", args: {} }, TOOLS), null);
  assert.equal(pickOf({ tool: "save_session", args: {} }, TOOLS), null);
});

test("sonic pick: Sonic's own spoken reply passes through as words plus audio", () => {
  assert.deepEqual(pickOf({ say: "Sorry, I can't do that.", audio: "UklGRg==" }, TOOLS), { say: "Sorry, I can't do that.", audio: "UklGRg==" });
  assert.equal(pickOf({}, TOOLS), null);
});

test("csp: only the resource's declared domains, plus wasm for MediaPipe; never the host's own origin", () => {
  const csp = cspFor({ resourceDomains: ["https://cdn.jsdelivr.net", "http://127.0.0.1:3001"], connectDomains: ["https://storage.googleapis.com"] });
  assert.match(csp, /default-src 'none'/);
  const script = csp.split("; ").find((d) => d.startsWith("script-src"));
  assert.match(script, /https:\/\/cdn\.jsdelivr\.net/);
  assert.match(script, /http:\/\/127\.0\.0\.1:3001/);
  assert.match(script, /'wasm-unsafe-eval'/);
  assert.doesNotMatch(script, /'self'|'unsafe-inline'/);
  assert.match(csp.split("; ").find((d) => d.startsWith("connect-src")), /storage\.googleapis\.com/);
  assert.match(csp.split("; ").find((d) => d.startsWith("media-src")), /mediastream: .*http:\/\/127\.0\.0\.1:3001/); // camera + voice clips
  assert.match(cspFor(undefined), /default-src 'none'/);
});

test("brief shortens long strings in the protocol log (identify's crop is 200 KB of base64) and keeps the rest", () => {
  const out = brief({ name: "identify_object", arguments: { rgb: "A".repeat(200_704), session: "s1" } });
  assert.equal(out, `{"name":"identify_object","arguments":{"rgb":"${"A".repeat(24)}… (196 KB)","session":"s1"}}`);
  assert.equal(brief("plain text"), '"plain text"');
});
