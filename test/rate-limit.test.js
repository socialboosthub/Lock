const test = require("node:test");
const assert = require("node:assert/strict");
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

test("video generation endpoint rate-limits repeated jobs from one IP", async () => {
  const send = () => fetch(baseUrl + "/api/explainer/video", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "X-Forwarded-For": "203.0.113.77",
    },
    body: JSON.stringify({ story: null }),
  });
  const first = await send();
  const firstBody = await first.json();
  assert.equal(first.status, 400);
  assert.match(firstBody.error, /AI Director plan/);

  const second = await send();
  const secondBody = await second.json();
  assert.equal(second.status, 429);
  assert.match(secondBody.error, /too many requests/);
  assert.ok(Number(second.headers.get("retry-after")) > 0);
});
