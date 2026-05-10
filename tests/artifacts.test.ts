const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const { verifyArtifactLayout } = require("../src/artifacts.ts");

function makeTempRoot(prefix) {
  return fs.mkdtempSync(path.join(os.tmpdir(), prefix));
}

test("verifyArtifactLayout accepts required ignore entries", (t) => {
  const root = makeTempRoot("lgo-artifacts-ok-");
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  fs.writeFileSync(path.join(root, ".gitignore"), [
    "node_modules/",
    "artifacts/",
    "logs/",
    "cache/"
  ].join("\n"));

  const result = verifyArtifactLayout(root);

  assert.equal(result.ok, true);
  assert.equal(result.gitignore.required.every((entry) => entry.ignored), true);
});

test("verifyArtifactLayout reports missing ignore entries", (t) => {
  const root = makeTempRoot("lgo-artifacts-missing-");
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  fs.writeFileSync(path.join(root, ".gitignore"), [
    "node_modules/",
    "artifacts/",
    "logs/"
  ].join("\n"));

  const result = verifyArtifactLayout(root);

  assert.equal(result.ok, false);
  assert.deepEqual(
    result.gitignore.required
      .filter((entry) => !entry.ignored)
      .map((entry) => entry.name),
    ["cache"]
  );
});
