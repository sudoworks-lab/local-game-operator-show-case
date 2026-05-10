#!/usr/bin/env node

import { createRequire } from "node:module";
import path from "node:path";
import { fileURLToPath } from "node:url";

const require = createRequire(import.meta.url);
const scriptDir = path.dirname(fileURLToPath(import.meta.url));
const rootDir = path.resolve(scriptDir, "..");

const requiredModules = [
  {
    file: "src/cli.ts",
    exports: ["run"]
  },
  {
    file: "src/status.ts",
    exports: ["collectStatus"]
  },
  {
    file: "src/artifacts.ts",
    exports: ["verifyArtifactLayout"]
  },
  {
    file: "src/safetyScan.ts",
    exports: ["scanProject"]
  }
];

function fail(message, detail) {
  console.error(message);
  if (detail) {
    console.error(JSON.stringify(detail, null, 2));
  }
  process.exit(1);
}

const nodeMajor = Number.parseInt(process.versions.node.split(".")[0], 10);
if (nodeMajor !== 22) {
  fail("Node 22 is required for the local ops baseline.", {
    actual: process.version
  });
}

for (const moduleInfo of requiredModules) {
  const loaded = require(path.join(rootDir, moduleInfo.file));

  for (const exportName of moduleInfo.exports) {
    if (typeof loaded[exportName] !== "function") {
      fail("Ops module export check failed.", {
        file: moduleInfo.file,
        exportName
      });
    }
  }
}

const { collectStatus } = require(path.join(rootDir, "src/status.ts"));
const { scanProject } = require(path.join(rootDir, "src/safetyScan.ts"));
const status = collectStatus(rootDir);

if (!status.ok) {
  fail("Ops status check failed.", {
    scripts: status.package.scripts.filter((script) => !script.present),
    includes: status.tsconfig.include.filter((entry) => !entry.present),
    sourceFiles: status.sourceFiles.filter((file) => !file.present),
    gitignore: status.gitignore.required.filter((entry) => !entry.ignored)
  });
}

const scan = scanProject(rootDir);
if (!scan.ok) {
  fail("Ops safety scan failed.", {
    findings: scan.findings
  });
}

console.log(`ops build ok: ${requiredModules.length} modules checked, ${scan.scannedFiles} files scanned`);
