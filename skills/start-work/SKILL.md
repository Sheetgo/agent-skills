---
name: start-work
description: "Initialize a feature or fix branch with session tracking. Use when starting new work: implementing features, fixing bugs, or beginning any task that will involve multiple commits."
---

# Start Work Session

## Overview

This skill creates a properly named branch and initializes session tracking for commit consolidation later.

## When to Use

- Starting a new feature or fix
- Beginning work that will span multiple commits
- When SessionStart hook suggests it (on main branch)

## Flow

When invoked, ask the user:

1. **Work type?** → `feature` or `fix`
2. **Ticket ID?** → e.g., `SG-1234` (optional, press Enter to skip)
3. **Short description?** → e.g., `user authentication` (use kebab-case, no spaces)

## Branch Naming

| Type | With Ticket | Without Ticket |
|------|-------------|----------------|
| Feature | `feature/SG-1234-user-auth` | `feature/user-auth` |
| Fix | `fix/SG-1234-login-bug` | `fix/login-bug` |

## Execution Steps

After gathering input, execute these steps:

### 1. Safety Checks

```bash
# Check for uncommitted changes
if [ -n "$(git status --porcelain)" ]; then
  echo "Error: Uncommitted changes exist. Please commit or stash first."
  # Offer: git stash -m "WIP before starting new work"
fi

# Check if already on feature/fix branch
CURRENT=$(git branch --show-current)
if echo "$CURRENT" | grep -qE "^(feature|fix)/"; then
  echo "Warning: Already on $CURRENT. Switch to main first or continue on this branch?"
fi
```

### 2. Prepare Main Branch

```bash
git checkout main
git pull origin main
```

### 3. Clean Orphaned Tags and Old Backups

```bash
# Clean orphaned session tags
for tag in $(git tag -l "_session-start-*"); do
  # Extract branch name from tag (remove timestamp suffix)
  TAG_BRANCH=$(echo "$tag" | sed 's/_session-start-\(.*\)-[0-9]*$/\1/')
  # Check if branch still exists
  if ! git branch --list | grep -q "$TAG_BRANCH"; then
    git tag -d "$tag"
    echo "Cleaned orphaned session tag: $tag"
  fi
done

# Clean old squash backup tags (from previous completed work)
for tag in $(git tag -l "_squash-backup-*"); do
  git tag -d "$tag"
  echo "Cleaned old squash backup: $tag"
done

# Clean old session directories for deleted branches
if [ -d ".claude/sessions" ]; then
  for session_dir in .claude/sessions/*/; do
    if [ -d "$session_dir" ]; then
      DIR_NAME=$(basename "$session_dir")
      # Convert back to branch name format
      BRANCH_CHECK=$(echo "$DIR_NAME" | tr '-' '/')
      # Check if any matching branch exists
      if ! git branch --list | grep -qE "(feature|fix)/$DIR_NAME"; then
        rm -rf "$session_dir"
        echo "Cleaned orphaned session dir: $session_dir"
      fi
    fi
  done
fi
```

### 4. Create Branch

```bash
# Build branch name
# TYPE = feature or fix
# TICKET = SG-1234 or empty
# SLUG = user-auth (kebab-case description)

if [ -n "$TICKET" ]; then
  BRANCH_NAME="${TYPE}/${TICKET}-${SLUG}"
else
  BRANCH_NAME="${TYPE}/${SLUG}"
fi

git checkout -b "$BRANCH_NAME"
```

### 5. Create Session Marker

```bash
SANITIZED_BRANCH=$(echo "$BRANCH_NAME" | tr '/' '-')
TIMESTAMP=$(date +%s)
SESSION_TAG="_session-start-${SANITIZED_BRANCH}-${TIMESTAMP}"

git tag "$SESSION_TAG"
echo "Created session marker: $SESSION_TAG"
```

### 6. Create Session Metadata

```bash
SESSION_DIR=".claude/sessions/${SANITIZED_BRANCH}"
mkdir -p "$SESSION_DIR"

cat > "$SESSION_DIR/session.json" << EOF
{
  "branch": "$BRANCH_NAME",
  "baseBranch": "main",
  "tag": "$SESSION_TAG",
  "type": "$TYPE",
  "ticket": "$TICKET",
  "description": "$DESCRIPTION",
  "created": "$(date -Iseconds)",
  "lastActivity": "$(date -Iseconds)",
  "commits": {
    "count": 0,
    "lastSha": null,
    "externalCount": 0
  },
  "squashHistory": []
}
EOF

echo "Session initialized at: $SESSION_DIR/session.json"
```

### 7. Confirmation

Output to user:
```
Created branch: feature/SG-1234-user-auth
Session marker: _session-start-feature-SG-1234-user-auth-1704672000
Session metadata: .claude/sessions/feature-SG-1234-user-auth/session.json

Ready to work! When done, use /squash-commits to consolidate your commits.
```

## Integration with Plans

If a plan file exists in `docs/plans/` that matches today's date:
- Suggest using the plan title as the description
- Offer to create todos from plan tasks
