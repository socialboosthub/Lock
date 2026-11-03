const test = require("node:test");
const assert = require("node:assert/strict");
const { normalizeStoryPackage } = require("../lib/providers/llm");

test("Director normalizes scene timing to a continuous timeline", () => {
  const story = normalizeStoryPackage({
    title: "The Secret Beneath the Lake",
    durationSec: 60,
    narration: "A short story.",
    scenes: [
      { narration: "Noah found a strange key beneath the lake." },
      { narration: "He unlocked the old door and freed the shadows." },
      { narration: "His own shadow returned at the end." }
    ]
  });
  assert.equal(story.scenes[0].start, 0);
  assert.equal(story.scenes.at(-1).end, 60);
  for (let i = 0; i < story.scenes.length - 1; i++) {
    assert.equal(story.scenes[i].end, story.scenes[i + 1].start);
    assert.ok(story.scenes[i].durationSec > 0);
  }
});

test("Director creates short subtitle phrases without changing narration words", () => {
  const source = "Noah sold his shadow. His mother could no longer recognize him!";
  const story = normalizeStoryPackage({
    title: "The Shadow",
    durationSec: 40,
    narration: source,
    scenes: [{ narration: source }]
  });
  const phrases = story.scenes[0].subtitlePhrases;
  assert.ok(phrases.length > 1);
  assert.equal(phrases.join(" "), source);
});

test("Director clamps invalid duration to the supported 30–120 second range", () => {
  const story = normalizeStoryPackage({
    title: "Test",
    durationSec: 500,
    scenes: [{ narration: "One scene." }]
  });
  assert.equal(story.durationSec, 120);
  assert.equal(story.scenes[0].end, 120);
});
