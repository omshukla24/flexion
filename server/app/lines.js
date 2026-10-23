// Every line the coach can say, by id: one list for session-core, the speaker and the voice clips (tools/voice/render.mjs).
// Calm, second person, ≤ 8 words; the pain line is longer because safety wins.
const WORDS = ["zero", "one", "two", "three", "four", "five", "six", "seven", "eight", "nine", "ten"];

const counts = Object.fromEntries(WORDS.slice(1, 10).map((w, i) => [`count-${i + 1}`, `That's ${w}. Relax, then again.`]));

export const LINES = {
  hello: "When you're ready, hand up, palm to me.",
  open: "Open your hand wide, and hold it.",
  fist: "Well done. Now a fist, thumb outside.",
  "fist-skip": "Let's move on. A fist, thumb outside.",
  "reps-10": "Well done. Open and close, ten times, slowly.",
  "reps-10-skip": "Let's move on. Open and close, ten times.",
  "grip-phone": "Well done. Now pick up your phone.",
  "grip-phone-skip": "Let's move on. Pick up your phone.",
  done: "That's everything. Well done today.",
  "done-skip": "Let's leave it there. Well done today.",
  stopped: "Okay, we'll stop here. Well done today.",
  ...counts,
  "reps-half": "Halfway there.",
  "reps-two": "Two more.",
  "reps-last": "Last one.",
  "fix-sideways": "Turn your palm to face me.",
  "fix-thumb-tucked": "Thumb across the outside.",
  fixed: "That's it.",
  "nudge-hello": "Take your time. Hand up, palm to me.",
  "nudge-open": "Take your time. Open your hand wide.",
  "nudge-fist": "Take your time. A fist, thumb outside.",
  "nudge-reps": "Take your time. Open, then close.",
  "nudge-grip-phone": "Take your time. Pick up your phone.",
  gone: "I can't see your hand.",
  paused: "Okay. Rest. Say ready to go on.",
  pain: "Let's stop and rest. If it keeps hurting, tell your therapist.",
  resumed: "Okay, let's carry on.",
  slower: "Okay, I'll slow down.",
  "camera-off": "Camera is off. Tell me how it feels.",
  "v-noise": "Saved. Inside your usual range today.",
  "v-tighter": "Saved. Your fist closed further than usual.",
  "v-looser": "Saved. Your fist was looser than usual.",
  "v-building": "Saved. A few more checks build your range.",
  "v-none": "Saved. No fist reading today.",
};

export const numberWord = (n) => WORDS[n] ?? String(n);
