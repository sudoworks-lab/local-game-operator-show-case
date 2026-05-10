const test = require("node:test");
const assert = require("node:assert/strict");
const path = require("node:path");
const { collectStatus } = require("../src/status.ts");

test("collectStatus validates the repo ops baseline", () => {
  const root = path.resolve(__dirname, "..");
  const result = collectStatus(root);

  assert.equal(result.ok, true);
  assert.equal(result.node.ok, true);
  assert.equal(result.package.scripts.every((script) => script.present), true);
  assert.equal(result.tsconfig.include.every((entry) => entry.present), true);
  assert.equal(result.sourceFiles.every((file) => file.present), true);
});
