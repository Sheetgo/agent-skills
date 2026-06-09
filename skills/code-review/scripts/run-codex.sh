#!/bin/bash
# Wrapper around Codex CLI for code-review skill Layer 1 (a).
#
# Usage: run-codex.sh <output-file>
#
# Detects diff base hybrid:
#   - PR base if branch has open PR (gh pr view --json baseRefName)
#   - origin/master otherwise
#
# Exits 0 on success (output file populated).
# Exits 1 on Codex CLI failure (quota / not found / etc).
# Exits 2 on missing prerequisites.

set -euo pipefail

OUTPUT_FILE="${1:-/tmp/codex-review-output.txt}"

# Resolve the Codex CLI binary in priority order, so the skill works on any
# OS/machine — not just a macOS desktop-app install:
#   1. $CODEX_BIN override (point this at your codex if it lives elsewhere)
#   2. `codex` on PATH (the standard `npm i -g @openai/codex` / `brew install --cask codex` install)
#   3. Known fallback locations (macOS desktop app + common bindirs)
CODEX_BINARY=""
if [ -n "${CODEX_BIN:-}" ] && [ -x "${CODEX_BIN}" ]; then
  CODEX_BINARY="$CODEX_BIN"
elif command -v codex >/dev/null 2>&1; then
  CODEX_BINARY="$(command -v codex)"
else
  for cand in \
    "/Applications/Codex.app/Contents/Resources/codex" \
    "$HOME/.codex/bin/codex" \
    "/opt/homebrew/bin/codex" \
    "/usr/local/bin/codex"; do
    if [ -x "$cand" ]; then CODEX_BINARY="$cand"; break; fi
  done
fi

if [ -z "$CODEX_BINARY" ]; then
  echo "ERROR: Codex CLI not found. Install it (npm i -g @openai/codex, or brew install --cask codex)" >&2
  echo "       and run 'codex login', or set CODEX_BIN=/path/to/codex. See SETUP.md." >&2
  echo "       Continuing without Codex → Layer 1 will run reviewer-only." >&2
  exit 2
fi
if ! command -v gh >/dev/null 2>&1; then
  echo "ERROR: gh CLI not found" >&2
  exit 2
fi

# Detect current branch
CURRENT_BRANCH=$(git rev-parse --abbrev-ref HEAD)
if [ "$CURRENT_BRANCH" = "HEAD" ]; then
  echo "ERROR: Detached HEAD; cannot determine PR base" >&2
  exit 2
fi

# Detect base ref
BASE_REF=""
if PR_BASE=$(gh pr view "$CURRENT_BRANCH" --json baseRefName --jq .baseRefName 2>/dev/null) && [ -n "$PR_BASE" ]; then
  BASE_REF="origin/$PR_BASE"
  echo "[run-codex] PR open, using base: $BASE_REF" >&2
else
  # No PR: use the remote's default branch (origin/HEAD), falling back to
  # main then master — don't assume the default branch is "master".
  DEFAULT_BRANCH=$(git symbolic-ref --quiet refs/remotes/origin/HEAD 2>/dev/null | sed 's@^refs/remotes/origin/@@')
  if [ -z "$DEFAULT_BRANCH" ]; then
    if git rev-parse --verify origin/main >/dev/null 2>&1; then
      DEFAULT_BRANCH="main"
    else
      DEFAULT_BRANCH="master"
    fi
  fi
  BASE_REF="origin/$DEFAULT_BRANCH"
  echo "[run-codex] No PR open, using base: $BASE_REF" >&2
fi

# Verify base ref exists locally; fetch if needed. A failed fetch must not let
# set -e propagate a raw exit 128 — surface it as exit 2 (missing prerequisite).
if ! git rev-parse --verify "$BASE_REF" >/dev/null 2>&1; then
  echo "[run-codex] Fetching ${BASE_REF#origin/}" >&2
  if ! git fetch origin "${BASE_REF#origin/}" >/dev/null 2>&1; then
    echo "ERROR: base ref $BASE_REF not found and could not be fetched" >&2
    exit 2
  fi
fi

# Run Codex review
echo "[run-codex] Running: $CODEX_BINARY review --base $BASE_REF" >&2
if ! "$CODEX_BINARY" review --base "$BASE_REF" > "$OUTPUT_FILE" 2>&1; then
  if grep -q "usage limit" "$OUTPUT_FILE"; then
    echo "[run-codex] Codex CLI quota hit" >&2
    exit 1
  fi
  echo "[run-codex] Codex CLI failed" >&2
  cat "$OUTPUT_FILE" >&2
  exit 1
fi

echo "[run-codex] Output saved to: $OUTPUT_FILE" >&2
echo "$OUTPUT_FILE"
