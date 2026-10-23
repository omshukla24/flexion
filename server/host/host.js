// Echo Show host simulator: what Alexa+ would do with our server, shown step by step.
// Voice or text in → a tool call over Streamable HTTP (raw 2025-era JSON-RPC, as the Alexa toolkit speaks) → the spoken result,
// and for tools with a ui:// resource, the MCP App in a sandboxed frame wired through the ext-apps AppBridge. Every message is logged.
import { AppBridge, PostMessageTransport, buildAllowAttribute } from "https://cdn.jsdelivr.net/npm/@modelcontextprotocol/ext-apps@2.0.3/dist/src/app-bridge.js/+esm";
import { brief, cspFor, forApp, forModel, intentOf, pickOf, voiceRequest } from "./host-core.js";

const MCP = new URL("/mcp", location.origin);
const PROTOCOL = "2025-11-25";        // what the Alexa toolkit negotiates
const ECHO_SHOW_ZOOM = 1.667;         // Echo Show 8/15 scale the 768x480 base canvas by this
const HELP = "Try “check my hand” or “how did I do”.";
const $ = (id) => document.getElementById(id);
const t0 = performance.now();

let protocol = null, tools = [], rpcId = 0, bridge = null;

// ---- log: every MCP message, newest at the bottom ----
function log(dir, what, data, kind = "") {
  const li = document.createElement("li");
  li.dataset.kind = kind;
  const t = Object.assign(document.createElement("span"), { className: "t", textContent: `+${((performance.now() - t0) / 1000).toFixed(2)}s` });
  const b = Object.assign(document.createElement("b"), { textContent: `${dir} ` });
  li.append(t, b, document.createTextNode(what));
  if (data !== undefined) li.append(Object.assign(document.createElement("code"), { textContent: typeof data === "string" ? data : brief(data) }));
  $("log").append(li);
  li.scrollIntoView({ block: "end" });
}

// ---- MCP over Streamable HTTP ----
async function rpc(method, params, kind = "") {
  const id = ++rpcId;
  log("host → server", method, params, kind);
  const res = await fetch(MCP, {
    method: "POST",
    headers: { "content-type": "application/json", accept: "application/json, text/event-stream", ...(protocol && { "mcp-protocol-version": protocol }) },
    body: JSON.stringify({ jsonrpc: "2.0", id, method, params }),
  });
  const text = await res.text();
  if (!res.ok) { log("server → host", `${method} HTTP ${res.status}`, text, "err"); throw new Error(`HTTP ${res.status}`); }
  const sse = res.headers.get("content-type")?.includes("text/event-stream");
  const msg = JSON.parse(sse ? text.split("\n").find((l) => l.startsWith("data: ")).slice(6) : text);
  if (msg.error) { log("server → host", `${method} error`, msg.error, "err"); throw new Error(msg.error.message); }
  log("server → host", method, msg.result, kind);
  return msg.result;
}

// ---- Alexa's voice: tool results in the browser's en-US voice (instant, exact words); Sonic's own replies in its own audio ----
const synth = globalThis.speechSynthesis;
let clip = null;
function say(text, audio = null) {
  $("caption").replaceChildren(Object.assign(document.createElement("b"), { textContent: "Alexa: " }), document.createTextNode(text));
  log("alexa", audio ? "says (Nova 2 Sonic voice)" : "says", text, "alexa");
  synth?.cancel();
  clip?.pause();
  if (audio) {
    clip = new Audio(`data:audio/wav;base64,${audio}`);
    clip.play().catch((e) => log("host", `audio: ${e.message}`, undefined, "err"));
    return;
  }
  if (!synth) return;
  const voice = synth.getVoices().find((v) => v.lang === "en-US" && /Natural|Aria|Jenny|Google US English/.test(v.name)) ?? null;
  synth.speak(Object.assign(new SpeechSynthesisUtterance(text), { voice, lang: "en-US", rate: 0.95 }));
}
const textOf = (r) => r.content?.find((c) => c.type === "text")?.text ?? "";

// ---- the device screen ----
function fitDevice() {
  const room = $("stage").clientWidth - 28, z = Math.min(ECHO_SHOW_ZOOM, room / 768, (innerHeight - 300) / 480);
  $("screen").style.zoom = Math.max(0.4, z);
  $("zoomNote").textContent = `768 × 480 base canvas at ${z.toFixed(2)}× (an Echo Show 8/15 uses ${ECHO_SHOW_ZOOM}×)`;
}
addEventListener("resize", fitDevice);

function closeView() {
  bridge?.close?.().catch(() => {});
  bridge = null;
  $("screen").querySelector("iframe")?.remove();
  $("idle").hidden = false;
}

/** Renders a tool's ui:// resource the way an MCP Apps host does: sandboxed frame, declared CSP and permissions, AppBridge. */
async function openView(tool, args, result) {
  closeView();
  const { contents: [res] } = await rpc("resources/read", { uri: tool._meta.ui.resourceUri });
  const ui = res._meta?.ui ?? {};
  const frame = Object.assign(document.createElement("iframe"), { title: "Flexion coach (MCP App)" });
  frame.sandbox = "allow-scripts allow-same-origin"; // G4b: the camera needs a real origin inside the frame
  frame.allow = buildAllowAttribute(ui.permissions);
  $("idle").hidden = true;
  $("screen").append(frame);

  bridge = new AppBridge(null, { name: "flexion-echo-show-sim", version: "0.1.0" }, { serverTools: {}, updateModelContext: { text: {} }, logging: {} });
  bridge.oninitialized = () => {
    log("view → host", "ui/initialized", undefined, "app");
    bridge.sendToolInput({ arguments: args });
    bridge.sendToolResult(result);
    log("host → view", "ui/notifications/tool-input + tool-result", { arguments: args, structuredContent: result.structuredContent }, "app");
  };
  // The view's tools/call goes through the host, which enforces visibility: app-only tools yes, model-only tools no.
  bridge.oncalltool = async (params) => {
    log("view → host", `tools/call ${params.name}`, params.arguments, "app");
    const t = tools.find((x) => x.name === params.name);
    if (!t || !forApp(t)) {
      log("host → view", `refused ${params.name}: not callable from the view`, undefined, "err");
      throw new Error(`${params.name} is not callable from the view`);
    }
    return rpc("tools/call", params, "app");
  };
  bridge.onupdatemodelcontext = async (p) => {
    log("view → host", "ui/update-model-context", p, "ctx");
    $("context").textContent = `Model context: ${p.content?.[0]?.text ?? ""}`;
    // Speak only the saved result (save_session's summary); the step updates are context for the model, not words for the user.
    if (p.structuredContent?.step === "done" && p.structuredContent.progress) say(p.content?.[0]?.text ?? "Saved.");
    return {};
  };
  bridge.onloggingmessage = (p) => log("view", "log", p);
  // Listen before the frame's App starts its handshake (setHostContext needs the transport; the view reads it at ui/initialize).
  await bridge.connect(new PostMessageTransport(frame.contentWindow, frame.contentWindow));
  bridge.setHostContext({
    theme: matchMedia("(prefers-color-scheme: dark)").matches ? "dark" : "light",
    displayMode: "inline", platform: "web", locale: "en-US", timeZone: "Asia/Kolkata",
    containerDimensions: { width: 768, height: 480 }, deviceCapabilities: { touch: true, hover: false },
    "flexion/stub": $("stub").checked,
  });
  // Then load the view, under only the CSP its resource declared.
  const csp = cspFor(ui.csp);
  log("host", "renders the view with CSP", csp);
  frame.srcdoc = res.text.replace("<head>", `<head>\n<meta http-equiv="Content-Security-Policy" content="${csp}">`);
}

// ---- Nova 2 Sonic picks the tool, the way Alexa's model would ----
/** The user's words → Sonic's `{ tool, args }` or `{ say, audio }`; null when it can't help, so the keyword rules take over. */
async function askSonic(said) {
  const t = performance.now();
  try {
    const res = await fetch(new URL("/api/voice", location.origin), {
      method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(voiceRequest(said, tools)), signal: AbortSignal.timeout(15_000),
    });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    const pick = pickOf(await res.json(), tools);
    const secs = `${((performance.now() - t) / 1000).toFixed(1)} s`;
    if (!pick) log("nova 2 sonic", `no usable answer in ${secs}; using keyword rules`, undefined, "err");
    else log("nova 2 sonic", pick.tool ? `chose ${pick.tool} in ${secs}` : `answers itself in ${secs}`, pick.tool ? pick.args : pick.say, "sonic");
    return pick;
  } catch (e) {
    log("host", `Nova 2 Sonic unavailable (${e.message}); using keyword rules`, undefined, "err");
    return null;
  }
}

// ---- one utterance → one tool call ----
async function handle(text) {
  const said = text.trim();
  if (!said) return;
  log("user", "says", said, "user");
  const pick = await askSonic(said);
  if (pick?.say) return say(pick.say, pick.audio);
  const intent = pick ?? intentOf(said, tools);
  if (!intent) return say(HELP);
  try {
    const result = await rpc("tools/call", { name: intent.tool, arguments: intent.args });
    say(textOf(result) || "Done.");
    const link = result.content?.find((c) => c.type === "resource_link");
    if (link) $("caption").append(" ", Object.assign(document.createElement("a"), { href: link.uri, target: "_blank", rel: "noopener", textContent: `Open “${link.name}”` }));
    const tool = tools.find((t) => t.name === intent.tool);
    if (tool._meta?.ui?.resourceUri && $("screenOn").checked) await openView(tool, intent.args, result);
  } catch (e) {
    console.error("[host]", e);
    say("Sorry, Flexion didn't answer. Try again in a moment.");
  }
}

$("ask").addEventListener("submit", (e) => {
  e.preventDefault();
  handle($("text").value);
  $("text").value = "";
});
document.querySelectorAll("[data-say]").forEach((b) => b.addEventListener("click", () => handle(b.dataset.say)));
$("screenOn").addEventListener("change", () => { if (!$("screenOn").checked) closeView(); });

// Voice in: Chrome's Web Speech recognition; typing stays as the fallback.
const Recognition = globalThis.SpeechRecognition ?? globalThis.webkitSpeechRecognition;
if (!Recognition) $("mic").hidden = true;
$("mic").addEventListener("click", () => {
  const rec = Object.assign(new Recognition(), { lang: "en-US", interimResults: false, maxAlternatives: 1 });
  $("mic").setAttribute("aria-pressed", "true");
  rec.onresult = (e) => handle(e.results[0][0].transcript);
  rec.onerror = (e) => log("host", `speech recognition: ${e.error}`, undefined, "err");
  rec.onend = () => $("mic").setAttribute("aria-pressed", "false");
  rec.start();
});

// ---- connect: initialize, then list tools the way the model would see them ----
fitDevice();
try {
  const init = await rpc("initialize", { protocolVersion: PROTOCOL, capabilities: {}, clientInfo: { name: "flexion-echo-show-sim", version: "0.1.0" } });
  protocol = init.protocolVersion;
  tools = (await rpc("tools/list", {})).tools;
  const hidden = tools.filter((t) => !forModel(t)).map((t) => t.name);
  log("host", `model sees: ${tools.filter(forModel).map((t) => t.name).join(", ")}${hidden.length ? ` · app-only, hidden from the model: ${hidden.join(", ")}` : ""}`);
  $("conn").textContent = `Connected · ${init.serverInfo?.name} ${init.serverInfo?.version} · protocol ${protocol}`;
} catch (e) {
  console.error("[host]", e);
  $("conn").textContent = "Server unreachable";
}
