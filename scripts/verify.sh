#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$ROOT_DIR"

NODE_MAJOR="$(node -p "process.versions.node.split('.')[0]")"
if [[ "$NODE_MAJOR" != "22" ]]; then
  echo "Node 22 is required; found $(node --version)" >&2
  exit 1
fi

npm run build
npm test
npm run ops -- status
npm run ops -- verify-artifacts
npm run ops -- safety-scan
