import assert from "node:assert/strict";
import { test } from "node:test";
import { sonicTurn, toolSpecs, wav, COACH_TOOLS } from "../src/voice.js";

const enc = new TextEncoder(), dec = new TextDecoder();
const out = (event) => ({ chunk: { bytes: enc.encode(JSON.stringify({ event })) } });

/** A stand-in for Bedrock: records every event sent and, like Sonic, replies with `events` once the mic is streaming
 *  (never, with `hang`; then stays open without ending, with `thenQuiet`, as Sonic does while it waits for the next turn). */
function fakeClient(events, { hang = false, thenQuiet = false } = {}) {
  const sent = [];
  let listening;
  const micOpen = new Promise((r) => { listening = r; });
  return {
    sent,
    async stream(modelId, body) {
      (async () => {
        for await (const e of body) {
          const event = JSON.parse(dec.decode(e.chunk.bytes)).event;
          sent.push(event);
          if (event.audioInput) listening();
        }
      })();
      return (async function* () {
        if (hang) await new Promise(() => {});
        await micOpen;
        yield* events;
        if (thenQuiet) await new Promise(() => {});
      })();
    },
  };
}

const HAND_CHECK = {
  name: "start_hand_check",
  description: "Open the camera hand coach.",
  inputSchema: { $schema: "https://json-schema.org/draft/2020-12/schema", type: "object", properties: { hand: { type: "string", enum: ["left", "right"] } }, additionalProperties: false },
};

test("toolSpecs turns MCP tools into Sonic tool specs with a plain JSON schema", () => {
  const [spec] = toolSpecs([HAND_CHECK]);
  assert.equal(spec.toolSpec.name, "start_hand_check");
  assert.equal(spec.toolSpec.description, "Open the camera hand coach.");
  assert.deepEqual(JSON.parse(spec.toolSpec.inputSchema.json), { type: "object", properties: { hand: { type: "string", enum: ["left", "right"] } } });
});

test("wav wraps 16-bit mono PCM at 24 kHz in a 44-byte header", () => {
  const w = wav(Buffer.from([1, 2, 3, 4]));
  assert.equal(w.length, 48);
  assert.equal(w.toString("ascii", 0, 4), "RIFF");
  assert.equal(w.readUInt32LE(4), 40);
  assert.equal(w.toString("ascii", 8, 16), "WAVEfmt ");
  assert.deepEqual([w.readUInt16LE(20), w.readUInt16LE(22), w.readUInt32LE(24), w.readUInt32LE(28), w.readUInt16LE(32), w.readUInt16LE(34)], [1, 1, 24000, 48000, 2, 16]);
  assert.equal(w.toString("ascii", 36, 40), "data");
  assert.equal(w.readUInt32LE(40), 4);
});

test("intent mode returns the tool Sonic picked, with its arguments", async () => {
  const client = fakeClient([out({ completionStart: {} }), out({ toolUse: { toolName: "start_hand_check", toolUseId: "t1", content: '{"hand":"left"}' } })]);
  const r = await sonicTurn({ mode: "intent", text: "check my left hand", tools: [HAND_CHECK] }, { client });
  assert.deepEqual(r, { tool: "start_hand_check", args: { hand: "left" } });
});

test("intent mode sends the user's words and the tools to Sonic", async () => {
  const client = fakeClient([out({ toolUse: { toolName: "start_hand_check", toolUseId: "t1", content: "{}" } })]);
  await sonicTurn({ mode: "intent", text: "check my left hand", tools: [HAND_CHECK] }, { client });
  const prompt = client.sent.find((e) => e.promptStart).promptStart;
  assert.equal(prompt.toolConfiguration.tools[0].toolSpec.name, "start_hand_check");
  assert.ok(client.sent.some((e) => e.textInput?.content === "check my left hand"));
});

test("a spoken reply comes back as text plus WAV audio; the user's echoed words are left out", async () => {
  const pcm = Buffer.from([1, 2, 3, 4]).toString("base64");
  const client = fakeClient([
    out({ textOutput: { role: "USER", content: "hello" } }),
    out({ textOutput: { role: "ASSISTANT", content: "Hi there." } }),
    out({ audioOutput: { content: pcm } }),
    out({ completionEnd: {} }),
  ]);
  const r = await sonicTurn({ mode: "intent", text: "hello", tools: [HAND_CHECK] }, { client });
  assert.equal(r.say, "Hi there.");
  assert.equal(Buffer.from(r.audio, "base64").length, 48);
});

test("coach mode: the calm-coach prompt, the session actions as tools, and a picked action comes back", async () => {
  const client = fakeClient([out({ toolUse: { toolName: "slower", toolUseId: "t1", content: "{}" } })]);
  const r = await sonicTurn({ mode: "coach", text: "can we go a bit easier?", tools: COACH_TOOLS }, { client });
  assert.deepEqual(r, { tool: "slower", args: {} });
  const prompt = client.sent.find((e) => e.promptStart).promptStart;
  assert.deepEqual(prompt.toolConfiguration.tools.map((t) => t.toolSpec.name), ["pause", "resume", "repeat", "slower", "skip", "stop"]);
  assert.match(client.sent.find((e) => e.textInput).textInput.content, /calm/i);
  assert.match(client.sent.find((e) => e.textInput).textInput.content, /therapist/i);
});

test("speak mode offers no tools and asks Sonic to keep every number", async () => {
  const client = fakeClient([out({ textOutput: { role: "ASSISTANT", content: "Your fist reading is 0.18." } }), out({ completionEnd: {} })]);
  const r = await sonicTurn({ mode: "speak", text: "Your last hand check: fist reading 0.18." }, { client });
  assert.equal(r.say, "Your fist reading is 0.18.");
  assert.equal(client.sent.find((e) => e.promptStart).promptStart.toolConfiguration, undefined);
  assert.match(client.sent.find((e) => e.textInput).textInput.content, /number/);
});

const stage = (s) => ({ contentStart: { role: "ASSISTANT", type: "TEXT", additionalModelFields: JSON.stringify({ generationStage: s }) } });

test("a spoken reply ends at the audio's END_TURN, while Sonic keeps the session open", async () => {
  const client = fakeClient([
    out(stage("SPECULATIVE")), out({ textOutput: { role: "ASSISTANT", content: "Sorry, I can't do that." } }), out({ contentEnd: { type: "TEXT", stopReason: "PARTIAL_TURN" } }),
    out({ contentStart: { role: "ASSISTANT", type: "AUDIO" } }), out({ audioOutput: { content: Buffer.from([1, 2]).toString("base64") } }),
    out({ contentEnd: { type: "AUDIO", stopReason: "END_TURN" } }),
  ], { thenQuiet: true });
  const r = await sonicTurn({ mode: "intent", text: "what's the weather", tools: [] }, { client, timeoutMs: 500 });
  assert.equal(r.say, "Sorry, I can't do that.");
  assert.equal(Buffer.from(r.audio, "base64").length, 46);
});

test("the FINAL copy of the reply text is not added to the SPECULATIVE text already spoken", async () => {
  const client = fakeClient([
    out(stage("SPECULATIVE")), out({ textOutput: { role: "ASSISTANT", content: "One." } }),
    out(stage("SPECULATIVE")), out({ textOutput: { role: "ASSISTANT", content: "Two." } }),
    out(stage("FINAL")), out({ textOutput: { role: "ASSISTANT", content: "One." } }),
    out({ contentEnd: { type: "AUDIO", stopReason: "END_TURN" } }),
  ], { thenQuiet: true });
  const r = await sonicTurn({ mode: "speak", text: "One. Two." }, { client, timeoutMs: 500 });
  assert.equal(r.say, "One. Two.");
});

test("a stream error from Bedrock rejects with its message", async () => {
  const client = fakeClient([{ modelStreamErrorException: { message: "boom" } }]);
  await assert.rejects(sonicTurn({ mode: "intent", text: "hi", tools: [] }, { client }), /boom/);
});

test("a silent stream times out instead of hanging", async () => {
  const client = fakeClient([], { hang: true });
  await assert.rejects(sonicTurn({ mode: "intent", text: "hi", tools: [] }, { client, timeoutMs: 50 }), /timed out/);
});
