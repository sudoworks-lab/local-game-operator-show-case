const fs = require("node:fs");
const path = require("node:path");

const piece = (...parts) => parts.join("");

const DEFAULT_EXCLUDED_DIRECTORIES = new Set([
  ".git",
  ".vite",
  "artifacts",
  "cache",
  "captures",
  "dist",
  "logs",
  "node_modules",
  "out",
  "outputs",
  "screenshots"
]);

const DEFAULT_TEXT_EXTENSIONS = new Set([
  ".css",
  piece(".", "env"),
  ".html",
  ".js",
  ".json",
  ".md",
  ".mjs",
  ".ps1",
  ".sh",
  ".ts",
  ".txt",
  ".yaml",
  ".yml"
]);

const MAX_FILE_BYTES = 1024 * 1024;

const RULES = [
  {
    id: "pem-private-key",
    severity: "high",
    pattern: /-----BEGIN [A-Z0-9 ]*PRIVATE KEY-----/i
  },
  {
    id: "assigned-credential",
    severity: "high",
    pattern: new RegExp(
      `(?:${piece("api", "[_-]?", "key")}|${piece("access", "[_-]?", "to", "ken")}|${piece(
        "refresh",
        "[_-]?",
        "to",
        "ken"
      )}|${piece("au", "th", "[_-]?", "to", "ken")}|${piece("client", "[_-]?", "sec", "ret")}|${piece(
        "pass",
        "word"
      )})\\s*[:=]\\s*["']?[A-Za-z0-9_./+=:-]{16,}`,
      "i"
    )
  },
  {
    id: "bearer-credential",
    severity: "high",
    pattern: new RegExp(`(?:${piece("Author", "ization")}\\s*:\\s*)?Bearer\\s+[A-Za-z0-9._~+/=-]{20,}`, "i")
  },
  {
    id: "env-credential",
    severity: "medium",
    pattern: new RegExp(
      `^[A-Z0-9_]*(?:${piece("API", "_", "KEY")}|${piece("TO", "KEN")}|${piece("SEC", "RET")}|${piece(
        "PASS",
        "WORD"
      )})[A-Z0-9_]*\\s*=\\s*[^\\s#'"]{12,}`
    )
  }
];

function toPosix(filePath) {
  return filePath.split(path.sep).join("/");
}

function isTextFile(filePath) {
  const basename = path.basename(filePath);

  if (basename === ".gitignore" || basename.startsWith(piece(".", "env"))) {
    return true;
  }

  return DEFAULT_TEXT_EXTENSIONS.has(path.extname(filePath).toLowerCase());
}

function shouldSkipDirectory(dirent, excludedDirectories) {
  return !dirent.isDirectory() || excludedDirectories.has(dirent.name);
}

function walkFiles(rootDir, options = {}) {
  const excludedDirectories = options.excludedDirectories || DEFAULT_EXCLUDED_DIRECTORIES;
  const files = [];
  const skipped = [];
  const stack = [rootDir];

  while (stack.length > 0) {
    const currentDir = stack.pop();
    let dirents;

    try {
      dirents = fs.readdirSync(currentDir, { withFileTypes: true });
    } catch (error) {
      skipped.push({
        path: toPosix(path.relative(rootDir, currentDir)),
        reason: error instanceof Error ? error.message : String(error)
      });
      continue;
    }

    for (const dirent of dirents) {
      const currentPath = path.join(currentDir, dirent.name);

      if (dirent.isSymbolicLink()) {
        skipped.push({
          path: toPosix(path.relative(rootDir, currentPath)),
          reason: "symbolic-link"
        });
        continue;
      }

      if (dirent.isDirectory()) {
        if (shouldSkipDirectory(dirent, excludedDirectories)) {
          skipped.push({
            path: toPosix(path.relative(rootDir, currentPath)),
            reason: "excluded-directory"
          });
        } else {
          stack.push(currentPath);
        }
        continue;
      }

      if (dirent.isFile()) {
        files.push(currentPath);
      }
    }
  }

  return { files, skipped };
}

function scanFile(filePath, rootDir, options = {}) {
  const maxFileBytes = options.maxFileBytes || MAX_FILE_BYTES;
  const findings = [];

  if (!isTextFile(filePath)) {
    return {
      findings,
      skipped: {
        path: toPosix(path.relative(rootDir, filePath)),
        reason: "non-text-extension"
      }
    };
  }

  const stat = fs.statSync(filePath);
  if (stat.size > maxFileBytes) {
    return {
      findings,
      skipped: {
        path: toPosix(path.relative(rootDir, filePath)),
        reason: "too-large"
      }
    };
  }

  const content = fs.readFileSync(filePath, "utf8");
  if (content.includes("\u0000")) {
    return {
      findings,
      skipped: {
        path: toPosix(path.relative(rootDir, filePath)),
        reason: "binary-content"
      }
    };
  }

  const lines = content.split(/\r?\n/);

  for (let index = 0; index < lines.length; index += 1) {
    for (const rule of RULES) {
      if (rule.pattern.test(lines[index])) {
        findings.push({
          ruleId: rule.id,
          severity: rule.severity,
          file: toPosix(path.relative(rootDir, filePath)),
          line: index + 1
        });
      }
    }
  }

  return { findings, skipped: null };
}

function scanProject(rootDir = process.cwd(), options = {}) {
  const root = path.resolve(rootDir);
  const { files, skipped } = walkFiles(root, options);
  const findings = [];
  let scannedFiles = 0;

  for (const filePath of files) {
    const result = scanFile(filePath, root, options);
    if (result.skipped) {
      skipped.push(result.skipped);
      continue;
    }

    scannedFiles += 1;
    findings.push(...result.findings);
  }

  findings.sort((left, right) => {
    if (left.file === right.file) {
      return left.line - right.line;
    }

    return left.file.localeCompare(right.file);
  });

  return {
    ok: findings.length === 0,
    root,
    scannedFiles,
    skipped,
    findings
  };
}

module.exports = {
  DEFAULT_EXCLUDED_DIRECTORIES,
  DEFAULT_TEXT_EXTENSIONS,
  MAX_FILE_BYTES,
  RULES,
  isTextFile,
  scanFile,
  scanProject,
  walkFiles
};
