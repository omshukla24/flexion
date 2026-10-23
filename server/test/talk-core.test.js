import { test } from "node:test";
import assert from "node:assert/strict";
import { actionOf } from "../app/talk-core.js";

const cases = {
  pain: ["it hurts", "Wait, it hurts!", "ouch", "my finger is sore", "that's painful, stop"],
  pause: ["wait", "hold on a second", "can I take a break", "give me a minute", "I'm not ready"],
  resume: ["ready", "okay, I'm ready", "let's go", "carry on", "don't stop", "keep going"],
  stop: ["stop", "I'm done", "that's enough for today", "end the session"],
  repeat: ["repeat that", "what did you say?", "say that again", "pardon"],
  slower: ["slower please", "you're going too fast", "slow down"],
  skip: ["skip this one", "move on", "next", "next exercise"],
};

for (const [action, phrases] of Object.entries(cases)) {
  test(`"${phrases[0]}" and friends → ${action}`, () => {
    for (const p of phrases) assert.equal(actionOf(p), action, p);
  });
}

test("questions and chat go to Sonic (null)", () => {
  for (const p of ["how am I doing", "what is this exercise for", "what's next for my hand", "thank you"]) assert.equal(actionOf(p), null, p);
});
