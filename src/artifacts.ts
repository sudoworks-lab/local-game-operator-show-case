const fs = require("node:fs");
const path = require("node:path");

const REQUIRED_IGNORES = ["node_modules", "artifacts", "logs", "cache"];

function toPosix(filePath) {
  return filePath.split(path.sep).join("/");
}

function normalizeIgnoreLine(line) {
  const trimmed = line.trim();

  if (!trimmed || trimmed.startsWith("#") || trimmed.startsWith("!")) {
    return null;
  }

  return trimmed
    .replace(/^\.?\//, "")
    .replace(/\/+$/, "");
}

function readGitignoreEntries(rootDir) {
  const gitignorePath = path.join(rootDir, ".gitignore");
  const result = {
    exists: false,
    entries: new Set(),
    path: ".gitignore",
    error: null
  };

  try {
    const content = fs.readFileSync(gitignorePath, "utf8");
    result.exists = true;

    for (const line of content.split(/\r?\n/)) {
      const entry = normalizeIgnoreLine(line);
      if (entry) {
        result.entries.add(entry);
      }
    }
  } catch (error) {
    result.error = error instanceof Error ? error.message : String(error);
  }

  return result;
}

function verifyArtifactLayout(rootDir = process.cwd()) {
  const root = path.resolve(rootDir);
  const gitignore = readGitignoreEntries(root);
  const required = REQUIRED_IGNORES.map((name) => {
    const absolutePath = path.join(root, name);

    return {
      name,
      path: toPosix(name),
      ignored: gitignore.entries.has(name),
      present: fs.existsSync(absolutePath)
    };
  });

  return {
    ok: gitignore.exists && required.every((entry) => entry.ignored),
    root,
    gitignore: {
      path: gitignore.path,
      exists: gitignore.exists,
      error: gitignore.error,
      required
    }
  };
}

module.exports = {
  REQUIRED_IGNORES,
  normalizeIgnoreLine,
  readGitignoreEntries,
  verifyArtifactLayout
};
