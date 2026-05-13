#!/usr/bin/env node

const { spawnSync } = require("node:child_process");

type VerifyStep = {
  command: string;
  args: string[];
};

const requiredNodeMajor = 22;
const nodeMajor = Number.parseInt(process.versions.node.split(".")[0], 10);

if (nodeMajor !== requiredNodeMajor) {
  console.error(`Node 22 is required; found ${process.version}`);
  process.exit(1);
}

const steps: VerifyStep[] = [
  { command: "npm", args: ["run", "build"] },
  { command: "npm", args: ["test"] },
  { command: "npm", args: ["run", "ops", "--", "status"] },
  { command: "npm", args: ["run", "ops", "--", "verify-artifacts"] },
  { command: "npm", args: ["run", "ops", "--", "safety-scan"] }
];

for (const step of steps) {
  const result = spawnSync(step.command, step.args, {
    stdio: "inherit",
    shell: process.platform === "win32"
  });

  if (result.error) {
    console.error(`Failed to start verify step: ${step.command} ${step.args.join(" ")}`);
    console.error(result.error.message);
    process.exit(1);
  }

  if (result.status !== 0) {
    process.exit(result.status === null ? 1 : result.status);
  }
}
