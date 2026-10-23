// Nova 2 Sonic as the simulator's voice: one short bidirectional stream per turn.
// Bedrock's Converse API is closed to this account until AWS finishes verifying it; the bidirectional stream is not (2026-10-22).
//   intent: the user's words + the model-visible MCP tools → { tool, args }, or a spoken reply { say, audio }
//   speak:  a tool's result text → Sonic says it → { say, audio }
//   coach:  the user talking back mid-session (site, standalone coach) → a session action { tool } or a calm reply { say, audio }
// The event sequence is the one proven by scratchpad/sonic/probe.mjs: session → prompt → system text → open mic (silence) → user text.

export const SONIC_MODEL = "amazon.nova-2-sonic-v1:0";
const REGION = process.env.SONIC_REGION ?? "us-east-1";
const VOICE = "tiffany"; // en-US
const SILENCE = Buffer.alloc(1024).toString("base64"); // 32 ms of 16 kHz mono: Sonic waits on an open mic
const PROMPTS = {
  intent: "You are Alexa on an Echo Show, running Flexion, a hand-therapy coach. When the user asks for something one of your tools does, call that tool. Otherwise answer in one short, friendly sentence.",
  speak: "You are Alexa on an Echo Show. The user's message is a result from the Flexion hand-therapy skill. Say it to them naturally in at most two short sentences. Keep every number and every hand (left or right) exactly as written. Don't add advice.",
  coach: "You are the Flexion hand-therapy coach, talking with someone in the middle of a slow, gentle hand exercise session on camera. Be calm and patient, and brief: at most two short sentences, under 25 words in all, never rushing them. If they want to pause, carry on, hear the last instruction again, go slower, skip this step or stop, call that tool. If anything hurts, tell them to rest and to ask their therapist; give no other medical advice.",
};

/** Talking back during a session: the actions Sonic may take for the user, by name (no arguments). */
export const COACH_TOOLS = Object.entries({
  pause: "Pause the session so the user can rest.",
  resume: "Carry on after a pause.",
  repeat: "Say the last instruction again.",
  slower: "Slow the coach down for the rest of the session.",
  skip: "Skip the current exercise step.",
  stop: "End the session now.",
}).map(([name, description]) => ({ name, description, inputSchema: { type: "object", properties: {} } }));

/** MCP tools → Sonic tool specs. Only type/properties/required survive: Sonic wants a plain schema, not $schema or additionalProperties. */
export function toolSpecs(tools) {
  return tools.map(({ name, description, inputSchema: { type = "object", properties = {}, required } = {} }) => ({
    toolSpec: { name, description, inputSchema: { json: JSON.stringify({ type, properties, ...(required && { required }) }) } },
  }));
}

/** 16-bit mono PCM → a WAV file (Sonic speaks at 24 kHz). */
export function wav(pcm, rate = 24000) {
  const h = Buffer.alloc(44);
  h.write("RIFF", 0, "ascii");
  h.writeUInt32LE(36 + pcm.length, 4);
  h.write("WAVEfmt ", 8, "ascii");
  h.writeUInt32LE(16, 16);
  h.writeUInt16LE(1, 20); // PCM
  h.writeUInt16LE(1, 22); // mono
  h.writeUInt32LE(rate, 24);
  h.writeUInt32LE(rate * 2, 28);
  h.writeUInt16LE(2, 32);
  h.writeUInt16LE(16, 34);
  h.write("data", 36, "ascii");
  h.writeUInt32LE(pcm.length, 40);
  return Buffer.concat([h, pcm]);
}

let shared;
/** The real Bedrock client, loaded on first use so the server's cold start doesn't pay for it. */
async function bedrock() {
  const { BedrockRuntimeClient, InvokeModelWithBidirectionalStreamCommand } = await import("@aws-sdk/client-bedrock-runtime");
  const c = new BedrockRuntimeClient({ region: REGION }); // this client defaults to the HTTP/2 handler the stream needs
  return { stream: async (modelId, body, abortSignal) => (await c.send(new InvokeModelWithBidirectionalStreamCommand({ modelId, body }), { abortSignal })).body };
}

const enc = new TextEncoder(), dec = new TextDecoder();
const ev = (event) => ({ chunk: { bytes: enc.encode(JSON.stringify({ event })) } });
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

/** One turn with Sonic. `client` is injected in tests ({ stream(modelId, body, signal) → async iterable of output events }). */
// The audio arrives at speaking speed (a 7 s answer ends ~9.5 s after the stream opens), so the timeout leaves room for two sentences.
export async function sonicTurn({ mode, text, tools = [] }, { client, timeoutMs = 15_000 } = {}) {
  client ??= shared ??= await bedrock();
  const P = "p", abort = new AbortController();
  let done = false;
  const intent = mode !== "speak"; // intent and coach turns may call a tool

  async function* input() {
    yield ev({ sessionStart: { inferenceConfiguration: { maxTokens: 300, topP: 0.9, temperature: 0.5 } } });
    yield ev({ promptStart: {
      promptName: P, textOutputConfiguration: { mediaType: "text/plain" },
      audioOutputConfiguration: { mediaType: "audio/lpcm", sampleRateHertz: 24000, sampleSizeBits: 16, channelCount: 1, voiceId: VOICE, encoding: "base64", audioType: "SPEECH" },
      ...(intent && { toolUseOutputConfiguration: { mediaType: "application/json" }, toolConfiguration: { tools: toolSpecs(tools) } }),
    } });
    yield ev({ contentStart: { promptName: P, contentName: "sys", type: "TEXT", interactive: false, role: "SYSTEM", textInputConfiguration: { mediaType: "text/plain" } } });
    yield ev({ textInput: { promptName: P, contentName: "sys", content: PROMPTS[mode] } });
    yield ev({ contentEnd: { promptName: P, contentName: "sys" } });
    yield ev({ contentStart: { promptName: P, contentName: "mic", type: "AUDIO", interactive: true, role: "USER",
      audioInputConfiguration: { mediaType: "audio/lpcm", sampleRateHertz: 16000, sampleSizeBits: 16, channelCount: 1, audioType: "SPEECH", encoding: "base64" } } });
    yield ev({ contentStart: { promptName: P, contentName: "say", type: "TEXT", interactive: true, role: "USER", textInputConfiguration: { mediaType: "text/plain" } } });
    yield ev({ textInput: { promptName: P, contentName: "say", content: text } });
    yield ev({ contentEnd: { promptName: P, contentName: "say" } });
    while (!done) { yield ev({ audioInput: { promptName: P, contentName: "mic", content: SILENCE } }); await sleep(32); }
    yield ev({ contentEnd: { promptName: P, contentName: "mic" } });
    yield ev({ promptEnd: { promptName: P } });
    yield ev({ sessionEnd: {} });
  }

  async function collect() {
    const said = [], pcm = [];
    let stage = null;
    for await (const e of await client.stream(SONIC_MODEL, input(), abort.signal)) {
      if (!e.chunk?.bytes) {
        const [kind, err] = Object.entries(e)[0] ?? [];
        throw new Error(`Sonic ${kind}: ${err?.message ?? "stream error"}`);
      }
      const o = JSON.parse(dec.decode(e.chunk.bytes)).event ?? {};
      if (o.toolUse && intent) {
        let args = {};
        try { args = JSON.parse(o.toolUse.content || "{}"); } catch { /* keep {}: the tool's own defaults apply */ }
        return { tool: o.toolUse.toolName, args };
      }
      // Sonic streams each sentence as SPECULATIVE text beside its audio, then repeats the whole reply as FINAL text seconds later.
      if (o.contentStart?.type === "TEXT") stage = JSON.parse(o.contentStart.additionalModelFields ?? "{}").generationStage ?? null;
      if (o.textOutput?.role === "ASSISTANT" && stage !== "FINAL") said.push(o.textOutput.content);
      if (o.audioOutput) pcm.push(Buffer.from(o.audioOutput.content, "base64"));
      // The reply is over when its audio ends the turn; completionEnd only comes when the session closes.
      if ((o.contentEnd?.type === "AUDIO" && o.contentEnd.stopReason === "END_TURN") || o.completionEnd) break;
    }
    // Chunks usually start with their own space; joining with one more and collapsing keeps both cases right.
    return { say: said.join(" ").replace(/\s+/g, " ").trim(), audio: pcm.length ? wav(Buffer.concat(pcm)).toString("base64") : null };
  }

  let timer;
  try {
    return await Promise.race([collect(), new Promise((_, no) => { timer = setTimeout(() => no(new Error(`Sonic timed out after ${timeoutMs} ms`)), timeoutMs); })]);
  } finally {
    clearTimeout(timer);
    done = true;
    abort.abort();
  }
}
