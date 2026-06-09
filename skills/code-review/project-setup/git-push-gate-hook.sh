#!/usr/bin/env bash
# git-push-gate-hook.sh — PreToolUse hook for the code-review skill.
#
# Triggered on Bash(git push:*) commands. Checks whether the current HEAD
# has been approved by /code-review (marker file at .git/code-review-passed-<sha>).
# If marker missing → emits permissionDecision deny JSON to block the push.
# If marker present → silent allow.
#
# Bypass: if the latest commit message contains [skip-review] OR the env var
# CODE_REVIEW_BYPASS=1 is set, the hook allows the push without checking.
#
# Hook protocol: read JSON from stdin, write JSON to stdout, exit 0 always.
# Block by emitting hookSpecificOutput.permissionDecision = "deny".
#
# Designed to be self-contained — no jq required (uses python3 from system).

DIAG_LOG="/tmp/code-review-hook-diag.log"

log() { printf '%s [code-review-hook] %s\n' "$(date +%T)" "$1" >> "$DIAG_LOG"; }

# Read stdin (tool input JSON)
INPUT=$(cat) || { log "FAIL:stdin_read"; exit 0; }

# Extract tool_name and command via python3 (always available on macOS/Linux)
TOOL_NAME=$(printf '%s' "$INPUT" | python3 -c 'import json,sys; d=json.load(sys.stdin); print(d.get("tool_name",""))' 2>/dev/null) || { log "FAIL:parse_tool_name"; exit 0; }
COMMAND=$(printf '%s' "$INPUT" | python3 -c 'import json,sys; d=json.load(sys.stdin); print(d.get("tool_input",{}).get("command",""))' 2>/dev/null) || { log "FAIL:parse_command"; exit 0; }

# Only intercept Bash commands
[[ "$TOOL_NAME" != "Bash" ]] && exit 0

# Only intercept actual `git push` invocations.
# Match: start-of-line OR after `&&` / `;` / `|`, then optional env-var prefix, then `git push`.
# Don't match: heredocs, comments, echo'd strings.
if ! printf '%s' "$COMMAND" | grep -qE '(^|&&|;|\|)\s*(GIT_[A-Z_]+=("[^"]*"|[^ ]+)\s+)*git\s+push(\s|$)'; then
  exit 0
fi

log "MATCH cmd=$(printf '%s' "$COMMAND" | head -c 80)"

# Bypass: env var
if [[ "${CODE_REVIEW_BYPASS:-0}" == "1" ]]; then
  log "BYPASS:env"
  exit 0
fi

# Resolve repo root (current working directory's git root)
REPO_ROOT=$(git rev-parse --show-toplevel 2>/dev/null) || { log "FAIL:no_repo_root"; exit 0; }

# Bypass: latest commit message contains [skip-review]
LATEST_MSG=$(git -C "$REPO_ROOT" log -1 --format='%B' 2>/dev/null) || true
if printf '%s' "$LATEST_MSG" | grep -q '\[skip-review\]'; then
  log "BYPASS:commit_marker"
  exit 0
fi

# Resolve check-marker script.
# CODE_REVIEW_CHECKER env var overrides for testing/development.
# Otherwise prefer user-level skill location.
CHECKER="${CODE_REVIEW_CHECKER:-$HOME/.claude/skills/code-review/scripts/check-marker.cjs}"
if [[ ! -f "$CHECKER" ]]; then
  log "FAIL:checker_not_found path=$CHECKER"
  # Fail-open: don't block when the skill isn't installed at the user level.
  # Project hook is in place but skill helpers aren't reachable.
  exit 0
fi

# Run the marker check
CHECK_OUT=$(node "$CHECKER" --repo-root "$REPO_ROOT" 2>&1)
CHECK_EXIT=$?

case $CHECK_EXIT in
  0)
    # Marker present — allow silently
    log "ALLOW marker_present"
    exit 0
    ;;
  1)
    # Marker missing or stale — block
    log "BLOCK $CHECK_OUT"
    REASON="🚫 code-review hasn't approved this commit yet.

$CHECK_OUT

The code-review skill writes a marker file (.git/code-review-passed-<sha>)
on PUSH READY verdict. The marker for the current HEAD is missing — either
the skill hasn't run since the last code change, or the marker expired
because HEAD has moved.

To proceed:
  1. Run /code-review (or invoke the code-review skill) on this branch.
  2. Address any FIX FIRST or DEFER + DOCUMENT verdicts surfaced.
  3. Re-attempt the push.

To bypass (if you genuinely need to push without review — e.g., docs-only
fix, urgent revert, or external trigger):
  - Add [skip-review] to your latest commit message, OR
  - Set CODE_REVIEW_BYPASS=1 in the environment for this push only.

The bypass is intentionally noisy. If you find yourself reaching for it
often, the gate is mistuned for your workflow — open a PR against the
agent-skills repo to refine the trigger condition."

    # Emit structured deny JSON. Use python3 for safe JSON encoding.
    printf '%s' "$REASON" | python3 -c '
import json, sys
reason = sys.stdin.read()
print(json.dumps({
    "hookSpecificOutput": {
        "hookEventName": "PreToolUse",
        "permissionDecision": "deny",
        "permissionDecisionReason": reason
    }
}))
'
    exit 0
    ;;
  2)
    # Infrastructure error (not a git repo, etc.) — fail open with log
    log "WARN check-exit=2 $CHECK_OUT"
    exit 0
    ;;
  *)
    log "WARN check-exit=$CHECK_EXIT $CHECK_OUT"
    exit 0
    ;;
esac
