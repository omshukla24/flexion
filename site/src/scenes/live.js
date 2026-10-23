// "Try it live": the coach's own vision engine (server/app/vision.js) on the visitor's camera.
// Nothing loads before the tap. MediaPipe runs in this tab on the GPU; the video is never uploaded.
// The camera only watches (both hands, objects boxed) and stays silent; the coach speaks only during a therapy session
// the visitor starts, in the same calm voice as the coach page (slow, never cut off,
// a voice switch, talk back, and a real report of the session to download, made in this tab).
import { sideOf, summary } from './live-math.js';

// Ruth's voice clips (server/app/voice, made by tools/voice/render.mjs): only their URLs here; a clip loads when it plays.
const CLIPS = import.meta.glob('../../../server/app/voice/*.mp3', { eager: true, query: '?url', import: 'default' });
const clipUrl = (id) => CLIPS[`../../../server/app/voice/${id}.mp3`] ?? null;
// shortcut: the live coach server's URL is written here; move it to a build-time env var if the server ever moves
const VOICE_API = 'https://ajsz3ao7tetyacjcyputpsz2mm0edogp.lambda-url.us-east-1.on.aws/api/voice';

const NAMES = ['thumb', 'index', 'middle', 'ring', 'little'];
const ROSE = '#E0457B';
const pad = (v, n) => String(Math.max(0, Math.round(v))).padStart(n, '0');

export function initLive(section) {
  if (!section) return () => {};
  const q = (sel) => section.querySelector(sel);
  const video = q('[data-live-video]');
  const canvas = q('[data-live-overlay]');
  const note = q('[data-live-note]');
  const cueEl = q('[data-live-cue]');
  const btn = q('[data-live-start]');
  const label = btn.querySelector('span') ?? btn;
  const tBtn = q('[data-live-therapy]');
  const tLabel = tBtn.querySelector('span') ?? tBtn;
  const switches = q('[data-live-switches]');
  const voiceBtn = q('[data-live-voice]');
  const talkBtn = q('[data-live-talk]');
  const reportBtn = q('[data-live-report]');
  const bars = [...section.querySelectorAll('.live-bars li')].map((li) => ({ fill: li.querySelector('i'), val: li.querySelector('b') }));
  const ctx = canvas.getContext('2d');
  let vision = null, core = null, cv = null, voice = null, bones = [], running = false, busy = false;
  let coaching = false, therapy = null, side = 'right', lastRun = null; // therapy: the running session's session-core state, made on its first frame
  const say = (text) => { note.hidden = !text; note.textContent = text; };
  const cue = (text) => { cueEl.hidden = !text; cueEl.textContent = text; };

  /** Text that reads the right way round: the canvas is mirrored by CSS, so each label is flipped back. */
  function tag(text, x, y, color, align = 'left') {
    ctx.save();
    ctx.translate(x, y);
    ctx.scale(-1, 1);
    ctx.font = '600 22px ui-monospace, SFMono-Regular, Menlo, monospace';
    ctx.textAlign = align;
    const w = ctx.measureText(text).width, x0 = align === 'center' ? -w / 2 : 0;
    ctx.fillStyle = 'rgb(13 21 32 / 0.72)';
    ctx.fillRect(x0 - 6, -22, w + 12, 30);
    ctx.fillStyle = color;
    ctx.fillText(text, 0, 0);
    ctx.restore();
  }

  function drawObject({ name, score, box: b }) {
    ctx.save();
    ctx.setLineDash([10, 8]);
    ctx.lineWidth = 3;
    ctx.strokeStyle = 'rgb(245 248 250 / 0.9)';
    ctx.strokeRect(b.x, b.y, b.w, b.h);
    ctx.restore();
    // Below 50 % the detector's names are mostly wrong (a mouse read "stop sign 33%"): box it, don't name it.
    if (score >= 0.5) tag(`${name} ${Math.round(score * 100)}%`, b.x + b.w, Math.max(26, b.y - 8), '#F5F8FA'); // the box's right edge in video pixels is its left edge on screen
  }

  function drawHand(h) {
    ctx.lineWidth = 3;
    ctx.strokeStyle = 'rgb(255 255 255 / 0.75)';
    ctx.beginPath();
    for (const [a, b] of bones) { ctx.moveTo(...h.pts[a]); ctx.lineTo(...h.pts[b]); }
    ctx.stroke();
    h.pts.forEach(([x, y], i) => {
      const tip = i > 0 && i % 4 === 0;
      ctx.beginPath();
      ctx.arc(x, y, tip ? 9 : 6, 0, Math.PI * 2);
      ctx.fillStyle = 'rgb(245 248 250 / 0.85)';
      ctx.fill();
      ctx.strokeStyle = tip ? ROSE : '#0F1B2D';
      ctx.stroke();
    });
    const s = sideOf(h.side);
    if (s) tag(s, h.pts[0][0], h.pts[0][1] + 44, ROSE, 'center');
  }

  function draw({ t, hands, objects }) {
    if (video.videoWidth && canvas.width !== video.videoWidth) Object.assign(canvas, { width: video.videoWidth, height: video.videoHeight });
    ctx.clearRect(0, 0, canvas.width, canvas.height);
    objects.filter((o) => o.name !== 'person').forEach(drawObject); // the visitor is always in frame; their box would only clutter
    hands.forEach(drawHand);
    const h = hands[0];
    say(h || coaching ? '' : 'Show me your hands.');
    if (h) {
      q('[data-live-state]').textContent = `${sideOf(h.side) || 'Hand'} · ${h.state}`;
      q('[data-live-reps]').textContent = pad(h.reps, 2);
      NAMES.forEach((n, k) => {
        const v = Math.min(100, Math.max(0, h.curls[n]));
        bars[k].fill.style.width = `${v}%`;
        bars[k].val.textContent = pad(v, 3);
      });
    }
    if (coaching) coach(t, h ?? null);
  }

  // shortcut: coaches the first hand MediaPipe returns, as the coach app does; pick by side once sessions name a hand
  function coach(t, hand) {
    if (hand && sideOf(hand.side)) side = sideOf(hand.side).toLowerCase();
    therapy = core.advance(therapy ?? core.startSession({ t, targets: core.DEFAULT_TARGETS }), { type: 'frame', t, hand });
    changed();
  }

  /** After every session change: speak a new line once, show the banner, wrap up at the end. */
  function changed() {
    voice.sync(therapy);
    if (therapy.step === 'done') return finishTherapy(therapy);
    cue(therapy.paused ? 'Resting. Say “ready” when you want to carry on.' : therapy.cue.text);
  }

  function keep(s) {
    if (!s.log.counts.length && !s.log.reps.length) return; // nothing measured, nothing to report
    lastRun = { log: s.log, result: s.result, hand: side, when: Date.now() };
    reportBtn.hidden = false;
  }

  function idle() {
    coaching = false;
    therapy = null;
    tLabel.textContent = 'Start therapy';
    tBtn.setAttribute('aria-pressed', 'false');
  }

  /** The session ended by itself: its last line ("Well done today.") is already queued, so the voice is left to finish it. */
  function finishTherapy(s) {
    keep(s);
    idle();
    cue(summary(s.result));
  }

  /** The visitor pressed Stop (or the camera went off): silent at once; what was measured can still be downloaded. */
  function stopTherapy() {
    voice?.reset();
    if (therapy) keep(core.advance(therapy, { type: 'stop', t: performance.now() }));
    idle();
    cue('');
  }

  function toggleTherapy() {
    if (coaching) return stopTherapy();
    voice.reset();
    coaching = true; // the session starts on the next camera frame (session-core counts time from frames)
    therapy = null;
    reportBtn.hidden = true;
    tLabel.textContent = 'Stop therapy';
    tBtn.setAttribute('aria-pressed', 'true');
    cue('Starting therapy…');
  }

  function setVoice(on) {
    voice.speaker.on = on;
    voiceBtn.setAttribute('aria-pressed', String(on));
    voiceBtn.textContent = on ? 'Voice on' : 'Voice off';
  }

  async function downloadReport() {
    if (!lastRun) return;
    reportBtn.disabled = true;
    try {
      const [{ buildSessionReport }, pdf] = await Promise.all([import('../../../server/app/session-report.js'), import('../../../server/app/pdf-lib.js')]);
      const bytes = await buildSessionReport(lastRun, pdf);
      const a = Object.assign(document.createElement('a'), {
        href: URL.createObjectURL(new Blob([bytes], { type: 'application/pdf' })),
        download: `flexion-${new Date(lastRun.when).toISOString().slice(0, 10)}-${lastRun.hand}-hand.pdf`,
      });
      a.click();
      setTimeout(() => URL.revokeObjectURL(a.href), 10_000);
    } catch (e) {
      console.warn('[live] report', e);
      cue('The report didn’t build. Try the button again.');
    } finally {
      reportBtn.disabled = false;
    }
  }

  function stop() {
    if (coaching) stopTherapy();
    cue('');
    vision?.stop();
    running = false;
    section.classList.remove('is-live');
    tBtn.hidden = switches.hidden = true;
    if (voice?.listener) voice.listener.on = false;
    ctx.clearRect(0, 0, canvas.width, canvas.height);
    label.textContent = 'Use my camera';
    say('Camera off. Nothing was recorded.');
  }

  async function toggle() {
    if (busy) return;
    if (running) return stop();
    busy = true;
    btn.disabled = true;
    label.textContent = 'Loading the hand model…';
    try {
      if (!vision) {
        const [{ createVision }, vcore, score, coachVoice] = await Promise.all([
          import('../../../server/app/vision.js'), import('../../../server/app/vision-core.js'), import('../../../server/app/session-core.js'),
          import('../../../server/app/coach-voice.js'),
        ]);
        bones = vcore.BONES;
        core = score;
        cv = coachVoice;
        voice = cv.createCoachVoice({
          clipUrl,
          dispatch: (ev) => { if (therapy) { therapy = core.advance(therapy, ev); changed(); } },
          ask: async (text) => {
            const res = await fetch(VOICE_API, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ text, mode: 'coach', state: cv.stateOf(therapy) }), signal: AbortSignal.timeout(15_000) });
            return res.ok ? res.json() : null;
          },
          onListen: (state) => {
            talkBtn.setAttribute('aria-pressed', String(state === 'on'));
            if (state === 'denied') cue('No microphone access, so Talk is off.');
          },
          onHeardText: (text) => { if (!coaching) cue(`Heard: “${text}”. Start therapy to talk with the coach.`); },
        });
        setVoice(voice.speaker.on);
        talkBtn.hidden = !voice.listener;
        vision = await createVision({ video, onFrame: draw, maxHands: 2 });
      }
      await vision.start();
      running = true;
      section.classList.add('is-live');
      label.textContent = 'Stop the camera';
      tBtn.hidden = switches.hidden = false;
      say('Show me your hands.');
    } catch (e) {
      console.warn('[live]', e);
      label.textContent = 'Use my camera';
      say(e?.name === 'NotAllowedError' ? 'Camera access was declined, so nothing ran. Nothing was recorded.' : `The camera or the hand model didn't start (${e?.name ?? 'error'}).`);
    } finally {
      busy = false;
      btn.disabled = false;
    }
  }

  const onVoice = () => setVoice(!voice.speaker.on);
  const onTalk = () => { voice.listener.on = !voice.listener.on; };
  // The camera turns off when the section leaves the screen: no forgotten webcam light.
  const io = new IntersectionObserver(([e]) => { if (!e.isIntersecting && running) stop(); });
  io.observe(section);
  btn.addEventListener('click', toggle);
  tBtn.addEventListener('click', toggleTherapy);
  voiceBtn.addEventListener('click', onVoice);
  talkBtn.addEventListener('click', onTalk);
  reportBtn.addEventListener('click', downloadReport);
  return () => {
    btn.removeEventListener('click', toggle);
    tBtn.removeEventListener('click', toggleTherapy);
    voiceBtn.removeEventListener('click', onVoice);
    talkBtn.removeEventListener('click', onTalk);
    reportBtn.removeEventListener('click', downloadReport);
    io.disconnect();
    if (running) stop();
  };
}
