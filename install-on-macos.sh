#!/usr/bin/env bash
# Install ux-heuristic-audit as a Claude Code skill on macOS.
# Reports any issues encountered so the user can act on them.

set -u

SKILL_NAME="ux-heuristic-audit"
SKILL_DIR="${HOME}/.claude/skills/${SKILL_NAME}"
REPO_URL="https://github.com/mdigital/ux-heuristic-audit.git"
ISSUES=()

log()  { printf "\033[1;34m==>\033[0m %s\n" "$*"; }
warn() { printf "\033[1;33m[warn]\033[0m %s\n" "$*"; ISSUES+=("$*"); }
fail() { printf "\033[1;31m[fail]\033[0m %s\n" "$*"; ISSUES+=("$*"); }
ok()   { printf "\033[1;32m[ok]\033[0m %s\n" "$*"; }

# --- 1. macOS check -----------------------------------------------------------
if [[ "$(uname -s)" != "Darwin" ]]; then
  fail "This installer targets macOS. Detected: $(uname -s)."
fi

# --- 2. Xcode command line tools (for git) -----------------------------------
if ! xcode-select -p >/dev/null 2>&1; then
  warn "Xcode Command Line Tools missing. Run: xcode-select --install"
fi

# --- 3. Homebrew (optional, used to install node) -----------------------------
HAS_BREW=0
if command -v brew >/dev/null 2>&1; then
  HAS_BREW=1
  ok "Homebrew found: $(brew --version | head -1)"
else
  warn "Homebrew not installed. See https://brew.sh (needed only if Node.js is missing)."
fi

# --- 4. Node.js ≥ 18 ----------------------------------------------------------
need_node_install=0
if ! command -v node >/dev/null 2>&1; then
  need_node_install=1
else
  NODE_MAJOR="$(node -p 'process.versions.node.split(".")[0]' 2>/dev/null || echo 0)"
  if [[ "${NODE_MAJOR}" -lt 18 ]]; then
    warn "Node.js $(node -v) is older than v18."
    need_node_install=1
  else
    ok "Node.js $(node -v)"
  fi
fi

if [[ "${need_node_install}" -eq 1 ]]; then
  if [[ "${HAS_BREW}" -eq 1 ]]; then
    log "Installing Node.js via Homebrew…"
    if ! brew install node; then
      fail "brew install node failed."
    fi
  else
    fail "Node.js ≥ 18 required. Install from https://nodejs.org or install Homebrew first."
  fi
fi

# --- 5. git -------------------------------------------------------------------
if ! command -v git >/dev/null 2>&1; then
  fail "git not found. Install Xcode Command Line Tools: xcode-select --install"
fi

# --- 6. Claude Code -----------------------------------------------------------
if ! command -v claude >/dev/null 2>&1; then
  warn "Claude Code CLI ('claude') not on PATH. Install from https://claude.com/claude-code"
fi

# --- 7. Clone or update skill -------------------------------------------------
mkdir -p "${HOME}/.claude/skills"
if [[ -d "${SKILL_DIR}/.git" ]]; then
  log "Skill already cloned — pulling latest…"
  if ! git -C "${SKILL_DIR}" pull --ff-only; then
    warn "git pull failed in ${SKILL_DIR}. Continuing with existing checkout."
  fi
elif [[ -d "${SKILL_DIR}" ]]; then
  warn "${SKILL_DIR} exists but is not a git checkout. Skipping clone."
else
  log "Cloning ${REPO_URL} → ${SKILL_DIR}"
  if ! git clone "${REPO_URL}" "${SKILL_DIR}"; then
    fail "git clone failed. Check network / repo URL."
  fi
fi

# --- 8. npm install -----------------------------------------------------------
if [[ -d "${SKILL_DIR}" ]] && command -v npm >/dev/null 2>&1; then
  log "Installing Node dependencies…"
  if ! (cd "${SKILL_DIR}" && npm install); then
    fail "npm install failed in ${SKILL_DIR}."
  fi
else
  fail "Cannot run npm install (npm missing or skill dir absent)."
fi

# --- 9. Playwright chromium ---------------------------------------------------
if [[ -d "${SKILL_DIR}" ]]; then
  log "Installing Playwright chromium browser (~130 MB)…"
  if ! (cd "${SKILL_DIR}" && npx --yes playwright install chromium); then
    fail "Playwright browser install failed. Try manually: cd ${SKILL_DIR} && npx playwright install chromium"
  fi
fi

# --- 10. Summary --------------------------------------------------------------
echo
if [[ ${#ISSUES[@]} -eq 0 ]]; then
  ok "Installation complete. Restart Claude Code and run: /ux-heuristic-audit https://example.com"
  exit 0
else
  printf "\n\033[1;31mInstallation finished with %d issue(s):\033[0m\n" "${#ISSUES[@]}"
  for i in "${ISSUES[@]}"; do
    printf "  • %s\n" "$i"
  done
  exit 1
fi
