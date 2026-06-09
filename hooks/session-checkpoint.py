#!/usr/bin/env python3
"""
Session Checkpoint Hook
Intercepts finishing-a-development-branch skill to force documentation update.
Denies with instructions to run session-persist workflow before finishing.
"""

import json
import os
import subprocess
import sys

try:
    input_data = json.load(sys.stdin)
except json.JSONDecodeError:
    sys.exit(0)

tool_name = input_data.get("tool_name", "")
tool_input = input_data.get("tool_input", {})

# Only intercept Skill tool calls
if tool_name != "Skill":
    sys.exit(0)

# Check if the skill being invoked is finishing-a-development-branch
skill_name = tool_input.get("skill", "")
if "finishing-a-development-branch" not in skill_name:
    sys.exit(0)

# Check for session-persist marker. Run git in the hook's cwd (not the process
# CWD, which may be a subdirectory) and resolve the marker against the repo root
# so the lookup matches where session-persist writes it.
cwd = input_data.get("cwd") or os.getcwd()


def _git(*git_args):
    return subprocess.check_output(
        ["git", "-C", cwd, *git_args],
        text=True, stderr=subprocess.DEVNULL, timeout=5,
    ).strip()


try:
    branch = _git("branch", "--show-current")
    repo_root = _git("rev-parse", "--show-toplevel")
except (subprocess.CalledProcessError, FileNotFoundError, subprocess.TimeoutExpired):
    # Can't determine branch/root, allow through
    sys.exit(0)

if not branch:
    sys.exit(0)

# Percent-encode "/" (not replace with "-") so feat/x and feat-x don't collide
# on the same session directory. Must match the encoding in the session-notes,
# squash-commits, and undo-squash skills (see CLAUDE.md "Session State").
sanitized_branch = branch.replace("/", "%2F")
marker_path = os.path.join(
    repo_root, ".claude", "sessions", sanitized_branch, "session-persist-done"
)

if os.path.exists(marker_path):
    # Documentation already updated, allow finishing
    sys.exit(0)

# Deny with instructions to run session-persist first
reason = """Before finishing this branch, you must update documentation.

Run the full session-persist workflow NOW (do not ask for permission):

1. Scan conversation for discoveries, decisions, deferred work, assumptions, patterns, and edge cases
2. Find and read the plan file(s) for this branch in docs/plans/
3. Write updates to plan files
4. Commit with a descriptive message summarizing what knowledge was added
5. Create the marker file: .claude/sessions/{branch}/session-persist-done
6. Display the catch-up summary to the user

After completing all steps, retry finishing the branch.""".format(branch=sanitized_branch)

output = {
    "hookSpecificOutput": {
        "hookEventName": "PreToolUse",
        "permissionDecision": "deny",
        "permissionDecisionReason": reason
    }
}
print(json.dumps(output))
sys.exit(0)
