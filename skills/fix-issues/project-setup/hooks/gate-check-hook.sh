#!/usr/bin/env bash
# gate-check-hook.sh — PostToolUse hook for fix-issues gate validation
#
# Triggered on Edit|Write to docs/fix-sessions/*/FIX-*.md files.
# Detects "GATE N PASSED" markers and runs check-fix-gate.cjs automatically.
#
# FIX-ID: extracted from filename (FIX-009.md → FIX-009)
# Session dir: parent directory of the issue file
#
# Input: JSON on stdin with tool_input fields (file_path, new_string or content)
# Output: JSON with hookSpecificOutput.additionalContext on match
#
# v3.1.8: Hardened against silent failures. Uses printf over echo for
# variable expansion, explicit error handling instead of set -euo pipefail,
# and error trap to prevent silent exits.

# Persistent diagnostic log — survives across sessions for post-mortem analysis
DIAG_LOG="/tmp/gate-hook-diag.log"

# Error trap: log any unexpected exit so the hook never fails silently
trap 'echo "$(date +%T) TRAP:unexpected_exit line=$LINENO exit=$?" >> "$DIAG_LOG"' ERR

# Read stdin (tool input JSON) — use cat, capture in variable
INPUT=$(cat) || { echo "$(date +%T) FAIL:stdin_read" >> "$DIAG_LOG"; exit 0; }

# Extract file_path — use printf (not echo) to avoid escape interpretation
FILE_PATH=$(printf '%s' "$INPUT" | jq -r '.tool_input.file_path // empty' 2>/dev/null) || true

# Exit silently if not a per-issue file in a session directory
if [[ -z "$FILE_PATH" ]] || [[ ! "$FILE_PATH" =~ docs/fix-sessions/.*/FIX-[0-9]{3}\.md$ ]]; then
  exit 0
fi

echo "$(date +%T) MATCH file=$FILE_PATH" >> "$DIAG_LOG"

# Extract the text that was written (new_string for Edit, content for Write)
NEW_TEXT=$(printf '%s' "$INPUT" | jq -r '.tool_input.new_string // .tool_input.content // empty' 2>/dev/null) || true

# Exit silently if no GATE marker in the written text
if [[ -z "$NEW_TEXT" ]] || ! printf '%s' "$NEW_TEXT" | grep -qiE 'GATE [1-3] PASSED'; then
  exit 0
fi

# Find the repo root (handles worktrees)
REPO_ROOT=$(git rev-parse --show-toplevel 2>/dev/null) || true
if [[ -z "$REPO_ROOT" ]]; then
  echo "$(date +%T) FAIL:no_repo_root" >> "$DIAG_LOG"
  exit 0
fi

# Try project-local first, then user-level skill location
SCRIPT_PATH="$REPO_ROOT/scripts/check-fix-gate.cjs"
if [[ ! -f "$SCRIPT_PATH" ]]; then
  SCRIPT_PATH="$HOME/.claude/skills/fix-issues/project-setup/scripts/check-fix-gate.cjs"
fi
if [[ ! -f "$SCRIPT_PATH" ]]; then
  echo "$(date +%T) FAIL:script_not_found" >> "$DIAG_LOG"
  exit 0
fi

# Extract FIX-ID from filename (FIX-009.md → FIX-009)
FIX_ID=$(basename "$FILE_PATH" .md)

# Extract session directory
SESSION_DIR=$(dirname "$FILE_PATH")
if [[ ! "$SESSION_DIR" = /* ]]; then
  SESSION_DIR="$REPO_ROOT/$SESSION_DIR"
fi

# Extract all GATE numbers from the written text
GATES=$(printf '%s' "$NEW_TEXT" | grep -oiE 'GATE ([1-3]) PASSED' | grep -oE '[1-3]') || true

if [[ -z "$GATES" ]]; then
  echo "$(date +%T) FAIL:gate_extract file=$FIX_ID" >> "$DIAG_LOG"
  exit 0
fi

# Run validation for each GATE marker found
RESULTS=""
for GATE_NUM in $GATES; do
  EXIT_CODE=0
  OUTPUT=$(node "$SCRIPT_PATH" "$SESSION_DIR" "$GATE_NUM" "$FIX_ID" 2>&1) || EXIT_CODE=$?

  # Continuation nudge — ONLY on GATE 3 PASS
  if [[ "$GATE_NUM" == "3" && $EXIT_CODE -eq 0 ]]; then
    OUTPUT="$OUTPUT
[CONTINUATION-NUDGE] $FIX_ID VERIFIED. Pick next QUEUED issue from SESSION.md and start Phase 1. Do NOT stop or wait for user input. If no QUEUED issues remain, proceed to Phase 5 wrap-up."
  fi

  if [[ -n "$OUTPUT" ]]; then
    if [[ -n "$RESULTS" ]]; then
      RESULTS="$RESULTS\n\n---\n\n$OUTPUT"
    else
      RESULTS="$OUTPUT"
    fi
  fi
done

# Output results as additionalContext if we have any
if [[ -n "$RESULTS" ]]; then
  ESCAPED=$(printf '%b' "$RESULTS" | jq -Rs .)
  echo "$(date +%T) OUTPUT gates=$GATES fix=$FIX_ID" >> "$DIAG_LOG"
  printf '%s\n' "{\"hookSpecificOutput\":{\"hookEventName\":\"PostToolUse\",\"additionalContext\":${ESCAPED}}}"
else
  echo "$(date +%T) NO_RESULTS gates=$GATES fix=$FIX_ID" >> "$DIAG_LOG"
fi
