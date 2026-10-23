// Talking back to the coach, the instant part (no network): what the user said → an action, or null (then Nova 2 Sonic answers).
// Order matters: pain beats everything (the coach never pushes through pain), then "don't stop", stop, pause, resume, …
const RULES = [
  ["pain", /\b(hurts?|hurting|pain(ful)?|ouch|sore|aches?|aching)\b/],
  ["resume", /\b(don'?t stop|keep going)\b/],
  ["stop", /\b(stop|finish|quit|that'?s enough|i'?m done|end (it|the session|this))\b/],
  ["pause", /\b(wait|pause|hold on|a break|rest|one (moment|sec(ond)?|minute)|give me a (sec(ond)?|minute|moment)|not ready)\b/],
  ["resume", /\b(ready|continue|go on|carry on|let'?s go|resume|start again)\b/],
  ["repeat", /\b(repeat|again|say that|what did you say|pardon|come again)\b/],
  ["slower", /\b(slow(er)?( down)?|too fast)\b/],
  ["skip", /\b(skip|move on|next (one|step|exercise))\b|^next$/],
];

export function actionOf(text) {
  const t = text.toLowerCase().replace(/[^a-z' ]/g, " ").replace(/\s+/g, " ").trim();
  return RULES.find(([, re]) => re.test(t))?.[0] ?? null;
}
