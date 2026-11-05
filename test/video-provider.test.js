const test = require("node:test");
const assert = require("node:assert/strict");
const https = require("node:https");
const { EventEmitter } = require("node:events");
const { startVideoJob, getVideoJob, isVideoProviderConfigured } = require("../lib/providers/video");

function mockResponse(payload, statusCode = 200) {
  const originalRequest = https.request;
  let optionsSeen;
  https.request = (options, callback) => {
    optionsSeen = options;
    const req = new EventEmitter();
    req.write = value => { req.body = (req.body || "") + value; };
    req.end = () => {
      const res = new EventEmitter();
      res.statusCode = statusCode;
      callback(res);
      queueMicrotask(() => {
        res.emit("data", Buffer.from(JSON.stringify(payload)));
        res.emit("end");
      });
    };
    return req;
  };
  return {
    get options() { return optionsSeen; },
    restore() { https.request = originalRequest; },
  };
}

test("video provider reports missing RunPod configuration without sending a request", async () => {
  const previous = {
    endpoint: process.env.RUNPOD_ENDPOINT_ID,
    key: process.env.RUNPOD_API_KEY,
    gemini: process.env.GEMINI_API_KEY,
    ready: process.env.AHM_VIDEO_WORKER_READY,
  };
  delete process.env.RUNPOD_ENDPOINT_ID;
  delete process.env.RUNPOD_API_KEY;
  delete process.env.GEMINI_API_KEY;
  delete process.env.AHM_VIDEO_WORKER_READY;
  try {
    assert.equal(isVideoProviderConfigured(), false);
    await assert.rejects(
      startVideoJob({ jobId: "test-job-12345678", story: { scenes: [{}] } }),
      error => error.code === "VIDEO_PROVIDER_NOT_CONFIGURED"
    );
  } finally {
    if (previous.endpoint === undefined) delete process.env.RUNPOD_ENDPOINT_ID;
    else process.env.RUNPOD_ENDPOINT_ID = previous.endpoint;
    if (previous.key === undefined) delete process.env.RUNPOD_API_KEY;
    else process.env.RUNPOD_API_KEY = previous.key;
    if (previous.ready === undefined) delete process.env.AHM_VIDEO_WORKER_READY;
    else process.env.AHM_VIDEO_WORKER_READY = previous.ready;
    if (previous.gemini === undefined) delete process.env.GEMINI_API_KEY;
    else process.env.GEMINI_API_KEY = previous.gemini;
    if (previous.ready === undefined) delete process.env.AHM_VIDEO_WORKER_READY;
    else process.env.AHM_VIDEO_WORKER_READY = previous.ready;
  }
});

test("video provider submits a complete story to RunPod Serverless", async () => {
  const previous = {
    endpoint: process.env.RUNPOD_ENDPOINT_ID,
    key: process.env.RUNPOD_API_KEY,
    gemini: process.env.GEMINI_API_KEY,
  };
  process.env.RUNPOD_ENDPOINT_ID = "endpoint-test";
  process.env.RUNPOD_API_KEY = "runpod-test";
  process.env.GEMINI_API_KEY = "gemini-test";
  process.env.AHM_VIDEO_WORKER_READY = "true";
  const mock = mockResponse({ id: "worker-job-123", status: "IN_QUEUE" });
  try {
    const story = { title: "Test", narration: "A test.", scenes: [{ action: "A scene" }] };
    const result = await startVideoJob({ jobId: "ahm-job-12345678", story });
    assert.equal(result.id, "worker-job-123");
    assert.equal(mock.options.method, "POST");
    assert.match(mock.options.path, /endpoint-test\/run$/);
  } finally {
    mock.restore();
    if (previous.endpoint === undefined) delete process.env.RUNPOD_ENDPOINT_ID;
    else process.env.RUNPOD_ENDPOINT_ID = previous.endpoint;
    if (previous.key === undefined) delete process.env.RUNPOD_API_KEY;
    else process.env.RUNPOD_API_KEY = previous.key;
    if (previous.gemini === undefined) delete process.env.GEMINI_API_KEY;
    else process.env.GEMINI_API_KEY = previous.gemini;
  }
});

test("video provider returns the final MP4 URL when the worker completes", async () => {
  const previous = { endpoint: process.env.RUNPOD_ENDPOINT_ID, key: process.env.RUNPOD_API_KEY, ready: process.env.AHM_VIDEO_WORKER_READY };
  process.env.RUNPOD_ENDPOINT_ID = "endpoint-test";
  process.env.RUNPOD_API_KEY = "runpod-test";
  process.env.AHM_VIDEO_WORKER_READY = "true";
  const mock = mockResponse({
    status: "COMPLETED",
    output: {
      finalVideoUrl: "https://storage.example/ahm/final.mp4",
      durationSec: 45,
      sceneCount: 8,
      audio: { narration: "generated", backgroundMusic: "generated" },
      format: "mp4",
    },
  });
  try {
    const result = await getVideoJob("worker-job-123");
    assert.equal(result.status, "completed");
    assert.equal(result.video.finalVideoUrl, "https://storage.example/ahm/final.mp4");
    assert.equal(result.video.durationSec, 45);
    assert.match(mock.options.path, /status\/worker-job-123$/);
  } finally {
    mock.restore();
    if (previous.endpoint === undefined) delete process.env.RUNPOD_ENDPOINT_ID;
    else process.env.RUNPOD_ENDPOINT_ID = previous.endpoint;
    if (previous.key === undefined) delete process.env.RUNPOD_API_KEY;
    else process.env.RUNPOD_API_KEY = previous.key;
  }
});
