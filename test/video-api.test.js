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

function mockRunPodResponses(payloads) {
  const originalRequest = https.request;
  const seen = [];
  https.request = (options, callback) => {
    const entry = { options, body: "" };
    seen.push(entry);
    const req = new EventEmitter();
    req.write = chunk => { entry.body += chunk; };
    req.end = () => {
      const res = new EventEmitter();
      res.statusCode = 200;
      callback(res);
      queueMicrotask(() => {
        res.emit("data", Buffer.from(JSON.stringify(payloads.shift())));
        res.emit("end");
      });
    };
    return req;
  };
  return {
    seen,
    restore() { https.request = originalRequest; },
  };
}

test("complete video API validates missing production configuration", async () => {
  const previous = {
    endpoint: process.env.RUNPOD_ENDPOINT_ID,
    key: process.env.RUNPOD_API_KEY,
    gemini: process.env.GEMINI_API_KEY,
  };
  delete process.env.RUNPOD_ENDPOINT_ID;
  delete process.env.RUNPOD_API_KEY;
  delete process.env.GEMINI_API_KEY;
  try {
    const response = await fetch(baseUrl + "/api/explainer/video", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ story: { title: "Test", narration: "Test", scenes: [{}] } }),
    });
    const body = await response.json();
    assert.equal(response.status, 503);
    assert.match(body.error, /RUNPOD_ENDPOINT_ID/);
  } finally {
    if (previous.endpoint === undefined) delete process.env.RUNPOD_ENDPOINT_ID;
    else process.env.RUNPOD_ENDPOINT_ID = previous.endpoint;
    if (previous.key === undefined) delete process.env.RUNPOD_API_KEY;
    else process.env.RUNPOD_API_KEY = previous.key;
    if (previous.gemini === undefined) delete process.env.GEMINI_API_KEY;
    else process.env.GEMINI_API_KEY = previous.gemini;
  }
});

test("complete video API submits and polls a RunPod job", async () => {
  const previous = {
    endpoint: process.env.RUNPOD_ENDPOINT_ID,
    key: process.env.RUNPOD_API_KEY,
    gemini: process.env.GEMINI_API_KEY,
    music: process.env.LYRIA_ENABLED,
  };
  process.env.RUNPOD_ENDPOINT_ID = "endpoint-test";
  process.env.RUNPOD_API_KEY = "runpod-test";
  process.env.GEMINI_API_KEY = "gemini-test";
  process.env.LYRIA_ENABLED = "false";
  const mock = mockRunPodResponses([
    { id: "runpod-job-123", status: "IN_QUEUE" },
    { status: "COMPLETED", output: { finalVideoUrl: "https://storage.example/final.mp4", durationSec: 45, sceneCount: 8 } },
  ]);
  try {
    const story = {
      title: "Speed of Light",
      narration: "Light travels fast.",
      durationSec: 45,
      scenes: [{ narration: "Light moves." }],
    };
    const started = await fetch(baseUrl + "/api/explainer/video", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ story, voice: "Charon", musicEnabled: false }),
    });
    const startBody = await started.json();
    assert.equal(started.status, 202);
    assert.equal(startBody.jobId, "runpod-job-123");
    const submitted = JSON.parse(mock.seen[0].body);
    assert.equal(submitted.input.story.productionSettings.voice, "Charon");
    assert.equal(submitted.input.story.productionSettings.musicEnabled, false);

    const completed = await fetch(baseUrl + "/api/explainer/video/" + startBody.jobId);
    const finalBody = await completed.json();
    assert.equal(completed.status, 200);
    assert.equal(finalBody.status, "completed");
    assert.equal(finalBody.video.finalVideoUrl, "https://storage.example/final.mp4");
    assert.equal(mock.seen.length, 2);
  } finally {
    mock.restore();
    if (previous.endpoint === undefined) delete process.env.RUNPOD_ENDPOINT_ID;
    else process.env.RUNPOD_ENDPOINT_ID = previous.endpoint;
    if (previous.key === undefined) delete process.env.RUNPOD_API_KEY;
    else process.env.RUNPOD_API_KEY = previous.key;
    if (previous.gemini === undefined) delete process.env.GEMINI_API_KEY;
    else process.env.GEMINI_API_KEY = previous.gemini;
    if (previous.music === undefined) delete process.env.LYRIA_ENABLED;
    else process.env.LYRIA_ENABLED = previous.music;
  }
});

test("paid background music cannot be requested while Lyria is disabled", async () => {
  const previous = {
    endpoint: process.env.RUNPOD_ENDPOINT_ID,
    key: process.env.RUNPOD_API_KEY,
    gemini: process.env.GEMINI_API_KEY,
    music: process.env.LYRIA_ENABLED,
  };
  process.env.RUNPOD_ENDPOINT_ID = "endpoint-test";
  process.env.RUNPOD_API_KEY = "runpod-test";
  process.env.GEMINI_API_KEY = "gemini-test";
  process.env.LYRIA_ENABLED = "false";
  try {
    const response = await fetch(baseUrl + "/api/explainer/video", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        story: { title: "Test", narration: "Test.", scenes: [{}] },
        musicEnabled: true,
      }),
    });
    const body = await response.json();
    assert.equal(response.status, 503);
    assert.match(body.error, /Lyria is not enabled/);
  } finally {
    if (previous.endpoint === undefined) delete process.env.RUNPOD_ENDPOINT_ID;
    else process.env.RUNPOD_ENDPOINT_ID = previous.endpoint;
    if (previous.key === undefined) delete process.env.RUNPOD_API_KEY;
    else process.env.RUNPOD_API_KEY = previous.key;
    if (previous.gemini === undefined) delete process.env.GEMINI_API_KEY;
    else process.env.GEMINI_API_KEY = previous.gemini;
    if (previous.music === undefined) delete process.env.LYRIA_ENABLED;
    else process.env.LYRIA_ENABLED = previous.music;
  }
});
