const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");

test("AI Director's primary render button invokes full video generation, not canvas demo", () => {
  const source = fs.readFileSync(path.join(__dirname, "../public/app.js"), "utf8");
  assert.match(source, /const fullVideoReady = started\.video\?\.status === "ready"/);
  assert.match(source, /\$\("renderBtn"\)\.disabled = !fullVideoReady/);
  assert.match(source, /\$\("renderBtn"\)\.addEventListener\("click", \(\) => \{[\s\S]*?generateFullVideo\(\);/);
  assert.doesNotMatch(source, /\$\("renderBtn"\)\.addEventListener\("click", \(\) => \{\s*\/\/ Free-first sample path[\s\S]*?renderVideo\(\);/);
});
