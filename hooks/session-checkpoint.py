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

# Check for session-persist marker
try:
    branch = subprocess.check_output(
        ["git", "branch", "--show-current"],
        text=True, stderr=subprocess.DEVNULL
    ).strip()
except (subprocess.CalledProcessError, FileNotFoundError):
    # Can't determine branch, allow through
    sys.exit(0)

if not branch:
    sys.exit(0)

sanitized_branch = branch.replace("/", "-")
marker_path = f".claude/sessions/{sanitized_branch}/session-persist-done"

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
