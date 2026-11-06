const test = require("node:test");
const assert = require("node:assert/strict");
const https = require("node:https");
const { EventEmitter } = require("node:events");
const { startExplainerGeneration } = require("../lib/providers/llm");

test("explainer falls back when the preferred Gemini model is overloaded", async () => {
  const originalRequest = https.request;
  const originalKey = process.env.GEMINI_API_KEY;
  const originalModel = process.env.GEMINI_MODEL;
  const originalFallbacks = process.env.GEMINI_FALLBACK_MODELS;
  const requests = [];

  process.env.GEMINI_API_KEY = "test-key";
  process.env.GEMINI_MODEL = "gemini-3.8-flash";
  process.env.GEMINI_FALLBACK_MODELS = "gemini-3.7-flash,gemini-3.6-flash";

  https.request = (options, onResponse) => {
    const entry = { options, body: "" };
    requests.push(entry);
    const req = new EventEmitter();
    req.write = chunk => { entry.body += chunk; };
    req.setTimeout = () => {};
    req.end = () => {
      const res = new EventEmitter();
      const attempt = requests.length;
      res.statusCode = attempt <= 4 ? 503 : 200;
      onResponse(res);
      queueMicrotask(() => {
        const payload = attempt <= 4
          ? { error: { message: "This model is currently experiencing high demand.", status: "UNAVAILABLE" } }
          : { candidates: [{
              content: { parts: [{ text: JSON.stringify({
                title: "How Light Travels",
                topic: "Speed of light",
                durationSec: 45,
                narration: "Light travels incredibly fast.",
                scenes: [
                  { narration: "Light moves through space at an extraordinary speed." },
                  { narration: "That speed is about 300,000 kilometres per second." }
                ]
              }) }] },
              finishReason: "STOP"
            }] };
        res.emit("data", Buffer.from(JSON.stringify(payload)));
        res.emit("end");
      });
    };
    return req;
  };

  try {
    const result = await startExplainerGeneration("Speed of light", "natural", [
      { name: "Professor Nova", description: "Silver glasses, navy coat, curly black hair." }
    ]);
    assert.equal(result.status, "completed");
    assert.equal(result.story.scenes.length, 2);
    assert.equal(requests.length, 5);
    assert.match(requests[0].options.path, /models\/gemini-3\.8-flash:generateContent$/);
    assert.match(requests[1].options.path, /models\/gemini-3\.7-flash:generateContent$/);
    assert.match(requests[2].options.path, /models\/gemini-3\.6-flash:generateContent$/);
    assert.match(requests[3].options.path, /models\/gemini-3\.5-flash-lite:generateContent$/);
    assert.match(requests[4].options.path, /models\/gemini-3\.1-flash-lite:generateContent$/);
    assert.equal(requests[4].options.headers["x-goog-api-key"], "test-key");
    assert.equal(requests[4].options.headers["Api-Revision"], undefined);
    const sent = JSON.parse(requests[4].body);
    assert.equal(sent.generationConfig.responseMimeType, "application/json");
    assert.match(sent.contents[0].parts[0].text, /Speed of light/);
    assert.match(sent.contents[0].parts[0].text, /Professor Nova/);
    assert.match(sent.contents[0].parts[0].text, /Silver glasses/);
  } finally {
    https.request = originalRequest;
    if (originalKey === undefined) delete process.env.GEMINI_API_KEY;
    else process.env.GEMINI_API_KEY = originalKey;
    if (originalModel === undefined) delete process.env.GEMINI_MODEL;
    else process.env.GEMINI_MODEL = originalModel;
    if (originalFallbacks === undefined) delete process.env.GEMINI_FALLBACK_MODELS;
    else process.env.GEMINI_FALLBACK_MODELS = originalFallbacks;
  }
});
