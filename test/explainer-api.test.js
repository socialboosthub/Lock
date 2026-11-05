const test = require("node:test");
const assert = require("node:assert/strict");
const https = require("node:https");
const { EventEmitter } = require("node:events");
const app = require("../server");

let server;
let baseUrl;

test.before(async () => {
  server = app.listen(0);
  await new Promise(resolve => server.once("listening", resolve));
  baseUrl = "http://127.0.0.1:" + server.address().port;
});

test.after(async () => {
  if (server) await new Promise(resolve => server.close(resolve));
});

test("explainer API generates a plan and includes saved character references", async () => {
  const previousKey = process.env.GEMINI_API_KEY;
  const previousModel = process.env.GEMINI_MODEL;
  process.env.GEMINI_API_KEY = "gemini-test";
  process.env.GEMINI_MODEL = "gemini-3.8-flash";

  const originalRequest = https.request;
  let sentBody = "";
  https.request = (options, callback) => {
    const req = new EventEmitter();
    req.write = chunk => { sentBody += chunk; };
    req.setTimeout = () => {};
    req.end = () => {
      const res = new EventEmitter();
      res.statusCode = 200;
      callback(res);
      const story = {
        title: "The Speed of Light",
        topic: "Speed of light",
        durationSec: 45,
        narration: "Light travels at an extraordinary speed.",
        scenes: [
          { start: 0, end: 45, narration: "Light travels at an extraordinary speed.", action: "A beam of light races through space.", visualPrompt: "A luminous beam in a dark space laboratory." }
        ],
        characters: [
          { id: "char_1", name: "Professor Nova", description: "Silver glasses and a navy coat." }
        ],
      };
      queueMicrotask(() => {
        res.emit("data", Buffer.from(JSON.stringify({
          candidates: [{
            content: { parts: [{ text: JSON.stringify(story) }] },
            finishReason: "STOP"
          }]
        })));
        res.emit("end");
      });
    };
    return req;
  };

  try {
    const response = await fetch(baseUrl + "/api/explainer/plan", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        topic: "Speed of light",
        characterReferences: [
          { name: "Professor Nova", description: "Silver glasses, navy coat, curly black hair." }
        ],
      }),
    });
    const result = await response.json();
    assert.equal(response.status, 200);
    assert.equal(result.ok, true);
    assert.equal(result.story.scenes.length, 1);
    const sent = JSON.parse(sentBody);
    const prompt = sent.contents[0].parts[0].text;
    assert.match(prompt, /Professor Nova/);
    assert.match(prompt, /Silver glasses, navy coat, curly black hair/);
  } finally {
    https.request = originalRequest;
    if (previousKey === undefined) delete process.env.GEMINI_API_KEY;
    else process.env.GEMINI_API_KEY = previousKey;
    if (previousModel === undefined) delete process.env.GEMINI_MODEL;
    else process.env.GEMINI_MODEL = previousModel;
  }
});
