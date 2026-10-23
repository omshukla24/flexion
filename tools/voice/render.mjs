// Renders every coach line (server/app/lines.js) once in Amazon Polly's generative voice → server/app/voice/<id>.mp3.
// Only new or changed lines are rendered (manifest.json keeps the words each clip was made from). Needs the AWS CLI and keys.
// Usage (from the project root): node tools/voice/render.mjs   ·   ~2,000 characters for the full set ≈ $0.06 at $30 per 1M.
import { execFileSync } from "node:child_process";
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { delimiter, dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { LINES } from "../../server/app/lines.js";

const VOICE = "Ruth";  // picked by ear, 2026-10-23
const RATE = "90%";    // a little slower than Polly's natural pace: calm, not slow-motion
const out = join(dirname(fileURLToPath(import.meta.url)), "../../server/app/voice");
const manifestPath = join(out, "manifest.json");
const env = { ...process.env, PATH: [process.env.PATH, "C:\\Program Files\\Amazon\\AWSCLIV2"].join(delimiter) };

mkdirSync(out, { recursive: true });
const old = existsSync(manifestPath) ? JSON.parse(readFileSync(manifestPath, "utf8")) : { lines: {} };
const same = old.voice === VOICE && old.rate === RATE;
let chars = 0;
for (const [id, text] of Object.entries(LINES)) {
  const file = join(out, `${id}.mp3`);
  if (same && old.lines[id] === text && existsSync(file)) continue;
  const ssml = `<speak><prosody rate="${RATE}">${text.replace(/&/g, "&amp;").replace(/</g, "&lt;")}</prosody></speak>`;
  chars += Number(execFileSync("aws", ["polly", "synthesize-speech", "--engine", "generative", "--voice-id", VOICE, "--region", "us-east-1",
    "--output-format", "mp3", "--text-type", "ssml", "--text", ssml, file, "--query", "RequestCharacters", "--output", "text"], { env, encoding: "utf8" }).trim());
  console.log(`rendered ${id}`);
}
writeFileSync(manifestPath, `${JSON.stringify({ voice: VOICE, rate: RATE, lines: LINES }, null, 2)}\n`);
console.log(`done: ${chars} characters billed this run`);
