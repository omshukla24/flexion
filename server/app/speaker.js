// The calm speaker in the browser: plays session-core's `say` lines one at a time (speaker-core's rules) in Ruth's
// pre-rendered voice (Amazon Polly, tools/voice/render.mjs); the browser's own voice only when a clip is missing.
// Used by the coach page and the site's live section. The voice switch is remembered per browser.
import { IDLE, GAP_MS, offer, next, ended, estimateMs } from "./speaker-core.js";

const KEY = "flexion.voice";
const read = () => { try { return localStorage.getItem(KEY); } catch { return null; } };
const write = (v) => { try { localStorage.setItem(KEY, v); } catch { /* private window: the switch still works for this visit */ } };

/** clipUrl(id) → the clip's URL or null; onLine(line) when one starts; onState(speaking); onHeard(line) when one ends. */
export function createSpeaker({ clipUrl = () => null, onLine, onState, onHeard } = {}) {
  const synth = globalThis.speechSynthesis;
  let q = IDLE, on = read() !== "off", rate = 1, gap = GAP_MS, audio = null, fallback = 0, wake = 0, voice = null;
  const pickVoice = () => {
    const us = (synth?.getVoices() ?? []).filter((v) => v.lang === "en-US");
    voice = us.find((v) => /Natural|Aria|Jenny|Google US English/.test(v.name)) ?? us[0] ?? null;
  };
  pickVoice();
  synth?.addEventListener?.("voiceschanged", pickVoice);

  function finish(line) {
    if (q.playing !== line) return; // stopped, or already ended by the other signal
    clearTimeout(fallback);
    audio = null;
    q = ended(q, performance.now(), gap);
    onState?.(false);
    onHeard?.(line);
    pump();
  }

  function browserSay(line) {
    if (!synth) return; // the fallback timer ends the line
    const u = Object.assign(new SpeechSynthesisUtterance(line.text), { voice, lang: "en-US", rate: 0.85 * rate });
    u.onend = u.onerror = () => finish(line);
    synth.speak(u);
  }

  function play(line) {
    onLine?.(line);
    onState?.(true);
    fallback = setTimeout(() => finish(line), estimateMs(line.text, 0.85 * rate) + 2500); // Chrome sometimes never sends `end`
    const src = line.audio ? `data:audio/wav;base64,${line.audio}` : line.line ? clipUrl(line.line) : null;
    if (!src) return browserSay(line);
    let fell = false;
    const fall = () => { if (fell || q.playing !== line) return; fell = true; audio = null; browserSay(line); };
    audio = new Audio(src);
    audio.playbackRate = rate; // the clips are already rendered at 90 % pace; "slower" stretches them a little (pitch kept)
    audio.onloadedmetadata = () => { clearTimeout(fallback); fallback = setTimeout(() => finish(line), (audio.duration / audio.playbackRate) * 1000 + 1500); };
    audio.onended = () => finish(line);
    audio.onerror = fall;
    audio.play().catch(fall);
  }

  function pump() {
    clearTimeout(wake);
    if (!on) return;
    let line;
    [q, line] = next(q, performance.now());
    if (line) return play(line);
    if (q.pending && !q.playing) wake = setTimeout(pump, Math.max(30, q.quietUntil - performance.now()));
  }

  function stop() {
    clearTimeout(fallback);
    clearTimeout(wake);
    synth?.cancel();
    audio?.pause();
    audio = null;
    q = IDLE;
    onState?.(false);
  }

  return {
    /** Queue a `say` line ({ id, line, kind, text, audio? }); nothing happens while the voice is off. */
    say(line) { if (!on || !line) return; q = offer(q, line, performance.now()); pump(); },
    /** Say the last line again ("repeat"). */
    repeat() { if (q.last) this.say({ ...q.last, kind: "step" }); },
    /** "Slower": a slower voice and longer breaths, for the rest of the visit. */
    slower() { rate = Math.max(0.8, rate - 0.07); gap = Math.min(2500, gap * 1.3); },
    /** Keep quiet for `ms` (another voice is talking: Alexa's reply in the Echo Show frame). */
    wait(ms) { q = { ...q, quietUntil: Math.max(q.quietUntil, performance.now() + ms) }; },
    stop,
    get speaking() { return !!q.playing; },
    get on() { return on; },
    set on(v) { on = !!v; write(on ? "on" : "off"); if (!on) stop(); },
  };
}
