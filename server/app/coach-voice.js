// The coach's voice for one page (coach page, site's live section): speaks each new `say` line of the session through the
// calm speaker, hears the user while Talk is on, and turns what they say into session events, or asks Nova 2 Sonic.
import { createSpeaker } from "./speaker.js";
import { createListener } from "./talk.js";
import { actionOf } from "./talk-core.js";

const SONIC_ACTIONS = ["pause", "resume", "repeat", "slower", "skip", "stop"];

/**
 * dispatch(ev): applies a session-core event to the page's session (and calls sync). ask(text) → Promise of { tool } or
 * { say, audio } from /api/voice (coach mode), or null. onHeardText(text) shows what was heard.
 */
export function createCoachVoice({ clipUrl, dispatch, ask, onLine, onSpeaking, onListen, onHeardText }) {
  let lastSay = 0;
  const listener = createListener({ onText: heard, onState: onListen });
  const speaker = createSpeaker({
    clipUrl, onLine,
    onState: (on) => { listener?.hold(on); onSpeaking?.(on); },
    onHeard: (l) => { if (l.kind === "step") dispatch({ type: "heard", t: performance.now(), id: l.id }); },
  });

  function act(a) {
    const t = performance.now();
    if (a === "pain") { speaker.stop(); return dispatch({ type: "pause", t, why: "pain" }); } // the one time the coach is cut off: it hurts
    if (a === "pause") return dispatch({ type: "pause", t, why: "asked" });
    if (a === "repeat") return speaker.repeat();
    if (a === "slower") speaker.slower();
    dispatch({ type: a, t }); // resume, skip, stop, slower
  }

  async function heard(text) {
    onHeardText?.(text);
    const a = actionOf(text);
    if (a) return act(a);
    const r = await ask?.(text).catch(() => null);
    if (SONIC_ACTIONS.includes(r?.tool)) return act(r.tool);
    if (r?.say) speaker.say({ id: `sonic-${performance.now()}`, line: null, kind: "step", text: r.say, audio: r.audio });
  }

  return {
    speaker, listener, heard,
    /** Call after every session change: speaks a new `say` line once (`quiet` skips it, e.g. a line Alexa says instead). */
    sync(session, { quiet = false } = {}) {
      const s = session?.say;
      if (!s || s.id === lastSay) return;
      lastSay = s.id;
      if (!quiet) speaker.say(s);
    },
    /** A new session: its say ids start again at 1. */
    reset() { lastSay = 0; speaker.stop(); },
  };
}

/** Where the session is, in a few words for Sonic ("step fist, 2 of 5 counted, paused"). */
export function stateOf(s) {
  if (!s) return "not started";
  const n = s.step === "open" || s.step === "fist" ? `, ${s.captures[s.step].length} of ${s.targets[s.step]} counted` : s.step === "reps" ? `, ${s.repsDone} of ${s.targets.reps} reps` : "";
  return `step ${s.step}${n}${s.paused ? ", paused" : ""}`;
}
