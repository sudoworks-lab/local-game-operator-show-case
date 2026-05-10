#!/usr/bin/env node

const { verifyArtifactLayout } = require("./artifacts.ts");
const { scanProject } = require("./safetyScan.ts");
const { collectStatus } = require("./status.ts");

const COMMANDS = ["status", "verify-artifacts", "safety-scan"];

function writeJson(value, stdout = process.stdout) {
  stdout.write(`${JSON.stringify(value, null, 2)}\n`);
}

function writeHelp(stdout = process.stdout) {
  stdout.write([
    "Usage: npm run ops -- <command>",
    "",
    "Commands:",
    "  status            Report local ops readiness.",
    "  verify-artifacts  Check runtime-output ignore rules.",
    "  safety-scan       Scan local text files and print coordinates only."
  ].join("\n"));
  stdout.write("\n");
}

function run(argv = process.argv.slice(2), options = {}) {
  const command = argv[0];
  const rootDir = options.rootDir || process.cwd();
  const stdout = options.stdout || process.stdout;
  const stderr = options.stderr || process.stderr;

  if (!command || command === "--help" || command === "-h") {
    writeHelp(stdout);
    return 0;
  }

  if (!COMMANDS.includes(command)) {
    stderr.write(`Unknown ops command: ${command}\n`);
    writeHelp(stderr);
    return 2;
  }

  if (command === "status") {
    const result = collectStatus(rootDir);
    writeJson(result, stdout);
    return result.ok ? 0 : 1;
  }

  if (command === "verify-artifacts") {
    const result = verifyArtifactLayout(rootDir);
    writeJson(result, stdout);
    return result.ok ? 0 : 1;
  }

  const result = scanProject(rootDir);
  writeJson(result, stdout);
  return result.ok ? 0 : 1;
}

if (require.main === module) {
  process.exitCode = run();
}

module.exports = {
  COMMANDS,
  run,
  writeHelp,
  writeJson
};
