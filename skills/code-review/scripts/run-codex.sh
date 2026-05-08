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
CODEX_BINARY="/Applications/Codex.app/Contents/Resources/codex"

# Verify prerequisites
if [ ! -x "$CODEX_BINARY" ]; then
  echo "ERROR: Codex CLI not found at $CODEX_BINARY" >&2
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
  BASE_REF="origin/master"
  echo "[run-codex] No PR open, using base: $BASE_REF" >&2
fi

# Verify base ref exists locally; fetch if needed
if ! git rev-parse --verify "$BASE_REF" >/dev/null 2>&1; then
  echo "[run-codex] Fetching $BASE_REF" >&2
  git fetch origin "${BASE_REF#origin/}"
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
