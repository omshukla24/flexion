// Echo Show host simulator, the pure parts: tool visibility, utterance → tool call, and the CSP put on the view.
// host.js does the DOM, the voice and the MCP wiring.

/** The model sees a tool unless `_meta.ui.visibility` leaves "model" out (MCP Apps; the default is both). */
export const forModel = (tool) => tool._meta?.ui?.visibility?.includes("model") ?? true;
/** The view may call a tool unless `_meta.ui.visibility` leaves "app" out. */
export const forApp = (tool) => tool._meta?.ui?.visibility?.includes("app") ?? true;

/** JSON for the protocol log, with long strings (identify's crop is 200 KB of base64) cut to their start and size. */
export const brief = (data) => JSON.stringify(data, (_, v) => (typeof v === "string" && v.length > 300 ? `${v.slice(0, 24)}… (${Math.round(v.length / 1024)} KB)` : v));

const RULES = [
  [/\b(how|progress|doing|going|results?)\b/, "get_progress"], // before "check": "how did my hand check go" asks about progress
  [/\b(weekly|report|therapist)\b/, "weekly_report"],
  [/\b(check|measure|test|start|exercises?|hand)\b/, "start_hand_check"],
];

/**
 * Utterance → `{ tool, args }`, or null when nothing matches or the model can't see that tool.
 * The fallback when Nova 2 Sonic (POST /api/voice) is unreachable: no AWS keys locally, Bedrock errors, or the rate limit.
 */
export function intentOf(text, tools) {
  const t = text.toLowerCase();
  const name = RULES.find(([re]) => re.test(t))?.[1];
  const tool = tools.find((x) => x.name === name && forModel(x));
  return tool ? { tool: tool.name, args: { hand: /\bleft\b/.test(t) ? "left" : "right" } } : null;
}

/** POST /api/voice body: the words plus the tools the model may see (name, description, schema), as Alexa hands them to its model. */
export function voiceRequest(text, tools) {
  return { text, tools: tools.filter(forModel).slice(0, 8).map(({ name, description, inputSchema }) => ({ name, description, inputSchema })) };
}

/**
 * Nova 2 Sonic's reply → `{ tool, args }` for a listed model tool, `{ say, audio }` when Sonic answers itself, else null.
 * Only `hand` survives in args, and only as left/right: the tool's own default covers anything else.
 */
export function pickOf(reply, tools) {
  if (reply.tool) {
    const tool = tools.find((t) => t.name === reply.tool && forModel(t));
    const hand = reply.args?.hand;
    return tool ? { tool: tool.name, args: hand === "left" || hand === "right" ? { hand } : {} } : null;
  }
  return reply.say ? { say: reply.say, audio: reply.audio ?? null } : null;
}

/** The CSP a host puts on a view, built only from the resource's `_meta.ui.csp`, so an undeclared domain fails here first. */
export function cspFor(csp = {}) {
  const res = (csp.resourceDomains ?? []).join(" "), con = (csp.connectDomains ?? []).join(" ");
  return [
    "default-src 'none'",
    `script-src 'wasm-unsafe-eval' ${res}`, // MediaPipe compiles WebAssembly
    `style-src 'unsafe-inline' ${res}`,     // style="" attributes in the view's markup
    `font-src ${res}`,
    `img-src data: blob: ${res}`,
    `media-src blob: mediastream: ${res}`,  // the camera, and the coach's voice clips from its declared resource domain
    `connect-src ${con}`,
  ].join("; ");
}
