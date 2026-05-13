const fs = require("node:fs");
const path = require("node:path");
const { verifyArtifactLayout } = require("./artifacts.ts");

const REQUIRED_SCRIPTS = ["build", "verify", "test", "ops"];
const REQUIRED_TS_INCLUDES = ["src/**/*.ts", "tests/**/*.ts"];
const REQUIRED_SOURCE_FILES = [
  "src/cli.ts",
  "src/status.ts",
  "src/artifacts.ts",
  "src/safetyScan.ts"
];

function readJsonFile(filePath) {
  try {
    return {
      ok: true,
      value: JSON.parse(fs.readFileSync(filePath, "utf8")),
      error: null
    };
  } catch (error) {
    return {
      ok: false,
      value: null,
      error: error instanceof Error ? error.message : String(error)
    };
  }
}

function getNodeMajor(version = process.versions.node) {
  const [major] = version.split(".");
  return Number.parseInt(major, 10);
}

function checkNodeRuntime(version = process.versions.node) {
  return {
    required: "22.x",
    actual: `v${version}`,
    ok: getNodeMajor(version) === 22
  };
}

function collectStatus(rootDir = process.cwd()) {
  const root = path.resolve(rootDir);
  const packageJson = readJsonFile(path.join(root, "package.json"));
  const tsconfig = readJsonFile(path.join(root, "tsconfig.json"));
  const packageScripts = packageJson.value && packageJson.value.scripts
    ? packageJson.value.scripts
    : {};
  const tsIncludes = tsconfig.value && Array.isArray(tsconfig.value.include)
    ? tsconfig.value.include
    : [];
  const scripts = REQUIRED_SCRIPTS.map((name) => ({
    name,
    present: typeof packageScripts[name] === "string"
  }));
  const include = REQUIRED_TS_INCLUDES.map((pattern) => ({
    pattern,
    present: tsIncludes.includes(pattern)
  }));
  const sourceFiles = REQUIRED_SOURCE_FILES.map((filePath) => ({
    path: filePath,
    present: fs.existsSync(path.join(root, filePath))
  }));
  const artifactLayout = verifyArtifactLayout(root);
  const node = checkNodeRuntime();

  return {
    ok: Boolean(
      node.ok
        && packageJson.ok
        && tsconfig.ok
        && scripts.every((script) => script.present)
        && include.every((entry) => entry.present)
        && sourceFiles.every((file) => file.present)
        && artifactLayout.ok
    ),
    root,
    node,
    package: {
      path: "package.json",
      ok: packageJson.ok,
      name: packageJson.value ? packageJson.value.name : null,
      error: packageJson.error,
      scripts
    },
    tsconfig: {
      path: "tsconfig.json",
      ok: tsconfig.ok,
      error: tsconfig.error,
      include
    },
    sourceFiles,
    gitignore: artifactLayout.gitignore,
    runtime: {
      localOnly: true
    }
  };
}

module.exports = {
  REQUIRED_SCRIPTS,
  REQUIRED_SOURCE_FILES,
  REQUIRED_TS_INCLUDES,
  checkNodeRuntime,
  collectStatus,
  getNodeMajor,
  readJsonFile
};
