#!/usr/bin/env bash
set -euo pipefail

# Clone (or update) the app from GitHub, install all npm dependencies from
# package.json / package-lock.json, and start the HTTP server.
#
# Environment (optional):
#   REPO_URL   Git remote (default: upstream from this project’s package.json)
#   DEST_DIR   Clone target when this script is not inside the repo (default: ./link-preview-server next to this file)
#   HOST       bind address (default: 0.0.0.0)
#   PORT       listen port (default: 3000)
#
# Examples:
#   chmod +x run.sh && ./run.sh
#   REPO_URL=https://github.com/you/link-preview.git DEST_DIR=./app ./run.sh

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"

if ! command -v node >/dev/null 2>&1; then
  echo "Node.js is required (v18+). Install from https://nodejs.org/" >&2
  exit 1
fi
if ! node -e "process.exit(Number(process.version.slice(1).split('.')[0]) >= 18 ? 0 : 1)" 2>/dev/null; then
  echo "Node.js 18 or newer is required (found $(node --version))." >&2
  exit 1
fi
if ! command -v npm >/dev/null 2>&1; then
  echo "npm is required (install Node.js; npm is included)." >&2
  exit 1
fi
REPO_URL="${REPO_URL:-https://github.com/AndrejGajdos/link-preview-generator.git}"
DEST_DIR="${DEST_DIR:-${SCRIPT_DIR}/link-preview-server}"

APP_DIR=""
if [[ -f "${SCRIPT_DIR}/package.json" && -f "${SCRIPT_DIR}/lib/index.js" && -f "${SCRIPT_DIR}/server/index.js" ]]; then
  APP_DIR="${SCRIPT_DIR}"
elif [[ -d "${DEST_DIR}/.git" ]]; then
  APP_DIR="${DEST_DIR}"
elif [[ ! -e "${DEST_DIR}" ]]; then
  if ! command -v git >/dev/null 2>&1; then
    echo "git is required to clone the repository." >&2
    exit 1
  fi
  git clone --depth 1 "${REPO_URL}" "${DEST_DIR}"
  APP_DIR="${DEST_DIR}"
else
  echo "DEST_DIR is not a git repo: ${DEST_DIR} — remove it or set DEST_DIR to an empty path." >&2
  exit 1
fi

if [[ -d "${APP_DIR}/.git" ]]; then
  git -C "${APP_DIR}" pull --ff-only || true
fi

cd "${APP_DIR}"

echo "Installing npm packages (dependencies from package.json)..."
if [[ -f package-lock.json ]]; then
  npm ci || npm install
else
  npm install
fi

export HOST="${HOST:-0.0.0.0}"
export PORT="${PORT:-3000}"
exec npm start
