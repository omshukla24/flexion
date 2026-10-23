// Talking back, in the browser: Chrome/Edge speech recognition while the Talk switch is on. Half-duplex: it stops listening
// while the coach speaks (so it never hears itself) and listens again after. Off by default; null where the browser can't.
export function createListener({ onText, onState }) {
  const Rec = globalThis.SpeechRecognition ?? globalThis.webkitSpeechRecognition;
  if (!Rec) return null;
  let rec = null, wanted = false, held = false;

  function start() {
    if (!wanted || held || rec) return;
    rec = Object.assign(new Rec(), { lang: "en-US", continuous: true, interimResults: false, maxAlternatives: 1 });
    const mine = rec;
    rec.onresult = (e) => { const r = e.results[e.results.length - 1]; if (r?.isFinal && r[0].transcript.trim()) onText(r[0].transcript.trim()); };
    rec.onerror = (e) => { if (e.error === "not-allowed" || e.error === "service-not-allowed") { wanted = false; onState?.("denied"); } };
    rec.onend = () => { if (rec === mine) rec = null; if (wanted && !held) setTimeout(start, 300); }; // Chrome ends a session after a silence
    try { rec.start(); onState?.("on"); } catch { rec = null; }
  }
  function halt() { const r = rec; rec = null; r?.abort(); }

  return {
    get on() { return wanted; },
    set on(v) { wanted = !!v; if (wanted) start(); else { halt(); onState?.("off"); } },
    /** true while the coach speaks: deaf until it's done. */
    hold(v) { held = !!v; if (held) halt(); else start(); },
  };
}
