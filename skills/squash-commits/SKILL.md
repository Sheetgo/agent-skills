---
name: squash-commits
description: "Consolidate commits into cohesive logical groups. Use ONLY when all todos are completed and you're ready to push."
---

# Squash Commits

## Overview

This skill analyzes commits since branch creation, groups them by logical boundaries (todo items + commit prefixes), and consolidates them into clean, meaningful commits.

## When to Use

- **ONLY** when all todos are completed (hook will notify you)
- Manual invocation via `/squash-commits` when explicitly requested by user

## Safety Checks (Run First)

Before any squash operation, verify:

### 1. Clean Working Tree

```bash
if [ -n "$(git status --porcelain)" ]; then
  echo "Error: Working directory not clean."
  echo "Please commit or stash changes first."
  exit 1
fi
```

### 2. Get Current Branch

```bash
BRANCH=$(git branch --show-current)
SANITIZED_BRANCH=$(echo "$BRANCH" | tr '/' '-')

if echo "$BRANCH" | grep -qE "^(main|master)$"; then
  echo "Error: Cannot squash on main/master branch."
  exit 1
fi
```

### 3. Find Branch Start Point

```bash
# Use merge-base to find where branch diverged from master
MERGE_BASE=$(git merge-base master HEAD 2>/dev/null)
if [ -z "$MERGE_BASE" ]; then
  echo "Error: Cannot find merge base with master."
  exit 1
fi

COMMIT_COUNT=$(git log "$MERGE_BASE"..HEAD --oneline | wc -l | tr -d " ")
echo "Found $COMMIT_COUNT commits since branching from master."
```

### 4. Check for Pushed Commits

```bash
UPSTREAM=$(git rev-parse --abbrev-ref @{u} 2>/dev/null)
if [ -n "$UPSTREAM" ]; then
  # Check if merge-base is in remote
  if git branch -r --contains "$MERGE_BASE" 2>/dev/null | grep -q "origin/"; then
    REMOTE_HEAD=$(git rev-parse "origin/$BRANCH" 2>/dev/null)
    if [ -n "$REMOTE_HEAD" ] && [ "$REMOTE_HEAD" != "$(git rev-parse HEAD)" ]; then
      echo "Warning: Some commits may have been pushed."
      echo "Squashing will require force push. Continue? [y/n]"
    fi
  fi
fi
```

### 5. Check for Merge Commits

```bash
MERGES=$(git log "$MERGE_BASE"..HEAD --merges --oneline | wc -l | tr -d " ")
if [ "$MERGES" -gt 0 ]; then
  echo "Warning: Branch has $MERGES merge commit(s)."
  echo "Squashing may produce unexpected results. Continue? [y/n]"
fi
```

### 6. Check for Recent Squash

```bash
SESSION_DIR=".claude/sessions/${SANITIZED_BRANCH}"
if [ -f "$SESSION_DIR/last-squash.json" ]; then
  LAST_SHA=$(jq -r .newHead "$SESSION_DIR/last-squash.json" 2>/dev/null)
  if [ "$LAST_SHA" = "$(git rev-parse HEAD)" ]; then
    echo "Already squashed at current HEAD."
    echo "Make more commits first, or use /undo-squash to restore."
    exit 0
  fi
fi
```

## Analysis Phase

### Get Commits to Analyze

```bash
git log "$MERGE_BASE"..HEAD --oneline --format="%H|%s|%aI"
```

### Grouping Algorithm

1. **Map commits to todo items** (if TodoWrite history available):
   - Correlate commit timestamps with todo `in_progress` times
   - Commits during a todo's active period belong to that todo

2. **Fallback: Group by commit prefix**:
   - Extract prefix: `feat:`, `fix:`, `test:`, `docs:`, `chore:`
   - Group consecutive commits with same prefix family

3. **Determine dominant prefix per group**:
   - `feat` + anything → `feat:` (feature includes its tests/fixes)
   - `fix` + `test` → `fix:` (fix includes its verification)
   - `test` only → `test:`
   - `docs` only → `docs:`
   - `chore` only → `chore:`

4. **Handle external commits** (no Claude signature):
   - Group separately or merge with adjacent group
   - Ask user preference if significant

## Preview (Show Before Executing)

```
Proposed consolidation (15 commits -> 3):

1. feat: Implement user authentication (ref SG-1234)
   - Combines: 6 commits
   - Files: auth.ts, auth.test.ts, middleware.ts

2. feat: Add session management (ref SG-1234)
   - Combines: 5 commits
   - Files: session.ts, session.test.ts

3. chore: Clean up legacy auth code
   - Combines: 4 commits
   - Files: legacy-auth.ts (deleted), imports.ts

Proceed? [Y/n]
```

## Backup Before Squash

```bash
SESSION_DIR=".claude/sessions/${SANITIZED_BRANCH}"
mkdir -p "$SESSION_DIR"

# Create backup tag
BACKUP_TAG="_squash-backup-$(date +%s)"
git tag "$BACKUP_TAG"

# Create bundle for undo
git bundle create "$SESSION_DIR/pre-squash.bundle" "$MERGE_BASE"..HEAD

# Record in-progress state
cat > "$SESSION_DIR/squash-in-progress.json" << EOF
{
  "status": "started",
  "backupTag": "$BACKUP_TAG",
  "originalHead": "$(git rev-parse HEAD)",
  "mergeBase": "$MERGE_BASE",
  "startTime": "$(date -Iseconds)"
}
EOF

echo "Backup created: $BACKUP_TAG"
```

## Execution

```bash
# 1. Soft reset to merge base
git reset --soft "$MERGE_BASE"

# 2. Create consolidated commits (Claude determines grouping)
# For each group:
#   git add <files-in-group>
#   git commit -m "<prefix>: <message> (ref <ticket>)"

# 3. Update squash state (KEEP backups for undo!)
rm "$SESSION_DIR/squash-in-progress.json"

# 4. Record successful squash with undo info
cat > "$SESSION_DIR/last-squash.json" << EOF
{
  "squashedAt": "$(date -Iseconds)",
  "newHead": "$(git rev-parse HEAD)",
  "backupTag": "$BACKUP_TAG",
  "originalHead": "$ORIGINAL_HEAD",
  "bundlePath": "$SESSION_DIR/pre-squash.bundle"
}
EOF

# NOTE: Backup tag and bundle are PRESERVED for /undo-squash
# Clean up manually with /cleanup-squash when no longer needed
```

## Undo Available

After squash completes, inform user:

```
Squash complete! Backups preserved for undo.

To undo this squash:  /undo-squash
To clean up backups:  /cleanup-squash
```

## Commit Message Format

With ticket:
```
feat: Implement user authentication (ref SG-1234)

- Add login/logout functionality
- Add session persistence
- Add auth middleware

Generated with [Claude Code](https://claude.com/claude-code)

Co-Authored-By: Claude Opus 4.5 <noreply@anthropic.com>
```

Without ticket:
```
feat: Implement user authentication

- Add login/logout functionality
- Add session persistence
- Add auth middleware

Generated with [Claude Code](https://claude.com/claude-code)

Co-Authored-By: Claude Opus 4.5 <noreply@anthropic.com>
```

## Recovery

If squash was interrupted, check for `squash-in-progress.json`:

```bash
if [ -f "$SESSION_DIR/squash-in-progress.json" ]; then
  STATUS=$(jq -r .status "$SESSION_DIR/squash-in-progress.json")
  BACKUP=$(jq -r .backupTag "$SESSION_DIR/squash-in-progress.json")

  echo "Previous squash interrupted at: $STATUS"
  echo "Options:"
  echo "  1. Recover original (git reset --hard $BACKUP)"
  echo "  2. Continue from current state"
  echo "  3. Abort and clean up"
fi
```
