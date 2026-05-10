const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const { scanProject } = require("../src/safetyScan.ts");

function makeTempRoot(prefix) {
  return fs.mkdtempSync(path.join(os.tmpdir(), prefix));
}

test("scanProject reports coordinates without matched content", (t) => {
  const root = makeTempRoot("lgo-scan-hit-");
  const sourceDir = path.join(root, "src");
  const name = "API_" + "TOKEN";
  const value = "localcheck" + "1234567890abcdef";
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));

  fs.mkdirSync(sourceDir, { recursive: true });
  fs.writeFileSync(path.join(sourceDir, "case.ts"), `${name}=${value}\n`);

  const result = scanProject(root);
  const serialized = JSON.stringify(result);

  assert.equal(result.ok, false);
  assert.equal(result.findings.length, 1);
  assert.deepEqual(result.findings[0], {
    ruleId: "env-credential",
    severity: "medium",
    file: "src/case.ts",
    line: 1
  });
  assert.equal(serialized.includes(value), false);
  assert.equal(serialized.includes(`${name}=${value}`), false);
});

test("scanProject skips runtime-output directories", (t) => {
  const root = makeTempRoot("lgo-scan-skip-");
  const logsDir = path.join(root, "logs");
  const name = "ACCESS_" + "TOKEN";
  const value = "skipcheck" + "1234567890abcdef";
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));

  fs.mkdirSync(logsDir, { recursive: true });
  fs.writeFileSync(path.join(logsDir, "runtime.log"), `${name}=${value}\n`);

  const result = scanProject(root);

  assert.equal(result.ok, true);
  assert.equal(result.findings.length, 0);
  assert.equal(
    result.skipped.some((entry) => entry.path === "logs" && entry.reason === "excluded-directory"),
    true
  );
});
