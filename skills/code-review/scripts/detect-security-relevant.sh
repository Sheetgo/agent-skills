#!/bin/bash
# Detect security-relevant diff via file-name pattern match.
#
# Usage: detect-security-relevant.sh <diff-base> <diff-head> [<patterns-file>]
#
# Outputs JSON: { "hasSecurityRelevance": bool, "matches": [...] }
# Exit 0 always (informational, not gating).

set -euo pipefail

DIFF_BASE="${1:-}"
DIFF_HEAD="${2:-HEAD}"
PATTERNS_FILE="${3:-$(dirname "$0")/../project-setup/security-patterns.example.txt}"

if [ -z "$DIFF_BASE" ]; then
  echo "Usage: detect-security-relevant.sh <diff-base> <diff-head> [<patterns-file>]" >&2
  exit 1
fi

if [ ! -f "$PATTERNS_FILE" ]; then
  echo '{"hasSecurityRelevance": false, "matches": [], "warning": "patterns file not found"}'
  exit 0
fi

# Escape a value for safe embedding inside a JSON string (backslash + double-quote).
json_escape() {
  local s=${1//\\/\\\\}
  s=${s//\"/\\\"}
  printf '%s' "$s"
}

# Get changed files (three-dot: only what this branch changed since the merge-base).
CHANGED=$(git diff --name-only "$DIFF_BASE...$DIFF_HEAD")

# Build matches as JSON array
echo -n '{"hasSecurityRelevance": '
HAS_MATCH="false"
MATCHES=""
while IFS= read -r pattern; do
  [ -z "$pattern" ] && continue
  case "$pattern" in '#'*) continue ;; esac
  while IFS= read -r file; do
    [ -z "$file" ] && continue
    LOWER_FILE=$(echo "$file" | tr '[:upper:]' '[:lower:]')
    LOWER_PATTERN=$(echo "$pattern" | tr '[:upper:]' '[:lower:]')
    if [[ "$LOWER_FILE" == *"$LOWER_PATTERN"* ]]; then
      HAS_MATCH="true"
      [ -n "$MATCHES" ] && MATCHES="$MATCHES,"
      MATCHES="$MATCHES{\"file\":\"$(json_escape "$file")\",\"pattern\":\"$(json_escape "$pattern")\"}"
    fi
  done <<< "$CHANGED"
done < "$PATTERNS_FILE"

echo "$HAS_MATCH, \"matches\": [$MATCHES]}"
