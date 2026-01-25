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
if tool_name != "Bash":
    sys.exit(0)

# Strip heredoc content before checking for git commit
# This prevents matching "git commit" that appears inside heredocs
def strip_heredocs(cmd):
    """Remove heredoc content to avoid false matches."""
    # Match heredoc: << 'MARKER' or <<MARKER ... MARKER
    # Replace content between markers with placeholder
    result = re.sub(
        r"<<\s*['\"]?(\w+)['\"]?\s*\n.*?\n\s*\1",
        "<<HEREDOC_STRIPPED",
        cmd,
        flags=re.DOTALL
    )
    return result

# Strip heredocs and check if this is actually a git commit command
stripped_cmd = strip_heredocs(command)

# Check for git commit -m at meaningful positions (start, after && or ;)
# Must NOT be inside quotes or echo/cat commands
git_commit_pattern = r'(?:^|&&|;)\s*(?:GIT_[A-Z_]+="[^"]*"\s+)*git\s+commit\s+(?:-[a-z]+\s+)*-m\s'
if not re.search(git_commit_pattern, stripped_cmd):
    sys.exit(0)

# Extract commit message - try heredoc format FIRST (most common for Claude Code)
# Heredoc format: -m "$(cat <<'EOF' ... EOF )"
commit_msg = None

# Heredoc pattern - handles various formats Claude Code uses
heredoc_match = re.search(
    r'-m\s+"?\$\(cat\s+<<[\'"](EOF|COMMIT_MSG)[\'"]?\s*\n(.*?)\n\s*\1\s*\)?"?',
    command,
    re.DOTALL
)
if heredoc_match:
    commit_msg = heredoc_match.group(2).strip()
    # Get first line only for validation
    commit_msg = commit_msg.split('\n')[0]

# If no heredoc, try simple -m "message" format
if not commit_msg:
    # Simple double-quoted message (but NOT if it starts with $( which indicates heredoc)
    match = re.search(r'-m\s+"((?!\$\()[^"\\]*(?:\\.[^"\\]*)*)"', command)
    if match:
        commit_msg = match.group(1)
        commit_msg = commit_msg.replace('\\"', '"')

# If still no match, try single quotes
if not commit_msg:
    match = re.search(r"-m\s+'([^']*)'", command)
    if match:
        commit_msg = match.group(1)

# Can't extract message, allow it
if not commit_msg:
    sys.exit(0)

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
