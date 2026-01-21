#!/usr/bin/env python3
"""
Git Conventions Hook
Validates commit messages follow team conventions: type: Description
"""

import json
import sys
import re

try:
    input_data = json.load(sys.stdin)
except json.JSONDecodeError as e:
    print(f"Error: Invalid JSON input: {e}", file=sys.stderr)
    sys.exit(1)

tool_name = input_data.get("tool_name", "")
tool_input = input_data.get("tool_input", {})
command = tool_input.get("command", "")

# Only validate git commit commands
if tool_name != "Bash" or "git commit" not in command:
    sys.exit(0)

# Extract commit message from -m flag
# Handle both -m "message" and -m 'message' formats, including escaped quotes
# Pattern handles: -m "message with \"quotes\"" and -m 'message'
match = re.search(r'git commit.*?-m\s+"((?:[^"\\]|\\.)*)"', command)
if not match:
    # Try single quotes
    match = re.search(r"git commit.*?-m\s+'((?:[^'\\]|\\.)*)'", command)
if not match:
    # Also try heredoc format: -m "$(cat <<'EOF' ... EOF)"
    heredoc_match = re.search(
        r'git commit.*?-m\s+"?\$\(cat\s+<<["\']?EOF["\']?\s*\n(.+?)\n\s*EOF',
        command,
        re.DOTALL
    )
    if heredoc_match:
        commit_msg = heredoc_match.group(1).strip()
        # Get first line only for validation
        commit_msg = commit_msg.split('\n')[0]
    else:
        sys.exit(0)  # Can't extract message, allow it
else:
    commit_msg = match.group(1)
    # Unescape quotes
    commit_msg = commit_msg.replace('\\"', '"').replace("\\'", "'")

# Passthrough patterns - skip validation for these
passthrough_patterns = [
    r'^Merge ',           # Merge commits
    r'^Revert "',         # Revert commits
    r'^Initial commit',   # Initial commit
]

for pattern in passthrough_patterns:
    if re.match(pattern, commit_msg):
        sys.exit(0)

# Validate commit message format
# Format: type: Description (capital letter, at least one more char)
# Types: feat, fix, docs, chore, test
valid_pattern = r'^(feat|fix|docs|chore|test): [A-Z].+'

if not re.match(valid_pattern, commit_msg):
    reason = f"""❌ Invalid commit message format

Your message: {commit_msg}

Commit messages must follow: type: Description

Types: feat, fix, docs, chore, test

Examples:
  ✅ feat: Add user authentication
  ✅ fix: Resolve memory leak in parser
  ✅ test: Add unit tests for auth module
  ✅ docs: Update README
  ✅ chore: Update dependencies

Invalid:
  ❌ added new feature (no type)
  ❌ feat:Add feature (missing space after colon)
  ❌ feat: add feature (lowercase description)
  ❌ feature: Add (invalid type, use 'feat')"""

    output = {
        "hookSpecificOutput": {
            "hookEventName": "PreToolUse",
            "permissionDecision": "deny",
            "permissionDecisionReason": reason
        }
    }
    print(json.dumps(output))
    sys.exit(0)

# Valid commit message
sys.exit(0)
