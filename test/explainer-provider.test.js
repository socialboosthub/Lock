const test = require("node:test");
const assert = require("node:assert/strict");
const https = require("node:https");
const { EventEmitter } = require("node:events");
const { startExplainerGeneration } = require("../lib/providers/llm");

test("explainer uses GenerateContent without the Interactions API revision header", async () => {
  const originalRequest = https.request;
  const originalKey = process.env.GEMINI_API_KEY;
  const originalModel = process.env.GEMINI_MODEL;
  let requestOptions;
  let requestBody = "";

  process.env.GEMINI_API_KEY = "test-key";
  process.env.GEMINI_MODEL = "gemini-3.8-flash";

  https.request = (options, onResponse) => {
    requestOptions = options;
    const req = new EventEmitter();
    req.write = chunk => { requestBody += chunk; };
    req.setTimeout = () => {};
    req.end = () => {
      const res = new EventEmitter();
      res.statusCode = 200;
      onResponse(res);
      queueMicrotask(() => {
        res.emit("data", Buffer.from(JSON.stringify({
          candidates: [{
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
          }]
        })));
        res.emit("end");
      });
    };
    return req;
  };

  try {
    const result = await startExplainerGeneration("Speed of light");
    assert.equal(result.status, "completed");
    assert.equal(result.story.scenes.length, 2);
    assert.equal(requestOptions.method, "POST");
    assert.match(requestOptions.path, /:generateContent$/);
    assert.equal(requestOptions.headers["x-goog-api-key"], "test-key");
    assert.equal(requestOptions.headers["Api-Revision"], undefined);
    const sent = JSON.parse(requestBody);
    assert.equal(sent.generationConfig.responseMimeType, "application/json");
    assert.match(sent.contents[0].parts[0].text, /Speed of light/);
  } finally {
    https.request = originalRequest;
    if (originalKey === undefined) delete process.env.GEMINI_API_KEY;
    else process.env.GEMINI_API_KEY = originalKey;
    if (originalModel === undefined) delete process.env.GEMINI_MODEL;
    else process.env.GEMINI_MODEL = originalModel;
  }
});
