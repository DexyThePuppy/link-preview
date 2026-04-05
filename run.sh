#!/usr/bin/env bash
#
# Clone or update https://github.com/DexyThePuppy/link-preview, install npm
# dependencies, and start the HTTP server.
#
# Deploy (systemd / screen): use the absolute path to this file so cwd does not
# matter, e.g.  /bin/bash /home/LinkPreview/link-preview/run.sh
# Ensure the app tree exists at that path (clone the repo there first).
#
# Environment (all optional):
#   REPO_URL         — Git clone URL (default: DexyThePuppy/link-preview)
#   DEST_DIR         — Clone directory when this script is not inside the repo
#   HOST             — Bind address (default: 0.0.0.0)
#   PORT             — Listen port (default: 6767)
#   GIT_CLONE_DEPTH  — Shallow clone depth (default: 1). Set 0 for full history.
#   NO_UPDATE        — If 1, skip git pull when already in a clone
#   CLEAN_INSTALL    — If 1, remove node_modules before install (fixes bad extracts)
#   NPM_CONFIG_CACHE — npm cache dir (default: <app>/.npm-cache)
#   HOME / TMPDIR    — If unset or not writable (common for service users),
#                      this script sets a writable HOME/TMPDIR under the app dir.
#
# Usage:
#   chmod +x run.sh && /bin/bash "$(pwd)/run.sh"
#   CLEAN_INSTALL=1 /bin/bash /path/to/repo/run.sh

set -euo pipefail

readonly DEFAULT_REPO_HTTPS="https://github.com/DexyThePuppy/link-preview.git"
readonly MIN_NODE_MAJOR=18

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]:-$0}")" && pwd)"

err() {
  printf '%s\n' "$*" >&2
}

info() {
  printf '[run] %s\n' "$*" >&2
}

need_cmd() {
  command -v "$1" >/dev/null 2>&1 || {
    err "Missing required command: $1"
    exit 1
  }
}

path_writable_dir() {
  local n="${1:-}"
  [[ -n "$n" ]] && [[ -d "$n" ]] && [[ -w "$n" ]]
}

require_node() {
  need_cmd node
  need_cmd npm
  local major
  major="$(node -p 'parseInt(process.version.slice(1), 10)')"
  if ((major < MIN_NODE_MAJOR)); then
    err "Node.js ${MIN_NODE_MAJOR}+ required (found $(node --version))."
    exit 1
  fi
}

# DevOps: systemd/screen users often get HOME=/home/foo when that dir is missing
# or not writable — npm then dies with EACCES on mkdir. Pin cache + HOME under APP_DIR.
setup_service_env() {
  local app="$1"

  if ! path_writable_dir "${HOME:-}"; then
    export HOME="${app}/.run-home"
    mkdir -p "$HOME"
    info "Using writable HOME=${HOME} (service-style HOME was missing or not writable)"
  fi

  export NPM_CONFIG_CACHE="${NPM_CONFIG_CACHE:-${app}/.npm-cache}"
  mkdir -p "$NPM_CONFIG_CACHE"

  if ! path_writable_dir "${TMPDIR:-/tmp}"; then
    export TMPDIR="${app}/.tmp"
    mkdir -p "$TMPDIR"
    info "Using TMPDIR=${TMPDIR}"
  elif [[ -z "${TMPDIR:-}" ]]; then
    export TMPDIR="${app}/.tmp"
    mkdir -p "$TMPDIR"
  fi
}

repo_root_markers() {
  [[ -f "${1}/package.json" && -f "${1}/lib/index.js" && -f "${1}/server/index.js" ]]
}

resolve_app_dir() {
  local dest="${1:-}"
  local repo_url="${2:-}"

  if repo_root_markers "${SCRIPT_DIR}"; then
    printf '%s' "${SCRIPT_DIR}"
    return
  fi

  if [[ -d "${dest}/.git" ]]; then
    printf '%s' "${dest}"
    return
  fi

  if [[ -e "${dest}" ]]; then
    err "DEST_DIR exists but is not a git repo: ${dest}"
    err "Remove it or point DEST_DIR somewhere else."
    exit 1
  fi

  need_cmd git
  local depth_arg=()
  if [[ "${GIT_CLONE_DEPTH:-1}" != "0" ]]; then
    depth_arg=(--depth "${GIT_CLONE_DEPTH:-1}")
  fi
  info "Cloning ${repo_url} -> ${dest}"
  git clone "${depth_arg[@]}" "${repo_url}" "${dest}"
  printf '%s' "${dest}"
}

git_fast_forward() {
  local dir="$1"
  [[ -d "${dir}/.git" ]] || return 0
  [[ "${NO_UPDATE:-0}" == "1" ]] && {
    info "Skipping git pull (NO_UPDATE=1)"
    return 0
  }
  info "Updating repo (git pull --ff-only)..."
  git -C "${dir}" pull --ff-only origin 2>/dev/null || git -C "${dir}" pull --ff-only || true
}

npm_install_deps() {
  if [[ "${CLEAN_INSTALL:-0}" == "1" ]]; then
    info "CLEAN_INSTALL=1: removing node_modules..."
    rm -rf node_modules
  fi
  info "Installing npm dependencies..."
  if [[ -f package-lock.json ]]; then
    npm ci "$@" || npm install "$@"
  else
    npm install "$@"
  fi
}

# --- main --------------------------------------------------------------------

REPO_URL="${REPO_URL:-${DEFAULT_REPO_HTTPS}}"
DEST_DIR="${DEST_DIR:-${SCRIPT_DIR}/link-preview-server}"

require_node

APP_DIR="$(resolve_app_dir "${DEST_DIR}" "${REPO_URL}")"
export APP_DIR

git_fast_forward "${APP_DIR}"
cd "${APP_DIR}"

setup_service_env "${APP_DIR}"

npm_install_deps

export HOST="${HOST:-0.0.0.0}"
export PORT="${PORT:-6767}"

info "Starting server on http://${HOST}:${PORT}/"
exec npm start
