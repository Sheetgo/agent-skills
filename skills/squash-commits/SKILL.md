---
name: squash-commits
description: "Consolidate commits into cohesive logical groups. Use ONLY when all todos are completed and you're ready to push."
---

# Squash Commits

## Overview

This skill analyzes commits since session start, groups them by logical boundaries (todo items + commit prefixes), and consolidates them into clean, meaningful commits.

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

### 3. Find Session Tag

```bash
SESSION_TAG=$(git tag -l "_session-start-${SANITIZED_BRANCH}-*" | sort | tail -1)

if [ -z "$SESSION_TAG" ]; then
  # No session - offer retroactive creation
  MERGE_BASE=$(git merge-base main HEAD 2>/dev/null)
  if [ -z "$MERGE_BASE" ]; then
    echo "Error: Cannot find merge base with main."
    exit 1
  fi

  COMMIT_COUNT=$(git log "$MERGE_BASE"..HEAD --oneline | wc -l | tr -d " ")
  echo "No session found. Found $COMMIT_COUNT commits since branching from main."
  echo "Create session from branch point and continue? [y/n]"

  # If user confirms, create tag at merge-base
  # SESSION_TAG="_session-start-${SANITIZED_BRANCH}-$(date +%s)"
  # git tag "$SESSION_TAG" "$MERGE_BASE"
fi
```

### 4. Check for Pushed Commits

```bash
UPSTREAM=$(git rev-parse --abbrev-ref @{u} 2>/dev/null)
if [ -n "$UPSTREAM" ]; then
  if git branch -r --contains "$SESSION_TAG" 2>/dev/null | grep -q "origin/"; then
    echo "Error: Commits since session start have been pushed."
    echo "Cannot safely squash without force push."
    exit 1
  fi
fi
```

### 5. Check for Merge Commits

```bash
MERGES=$(git log "$SESSION_TAG"..HEAD --merges --oneline | wc -l | tr -d " ")
if [ "$MERGES" -gt 0 ]; then
  echo "Warning: Branch has $MERGES merge commit(s)."
  echo "Squashing may produce unexpected results. Continue? [y/n]"
fi
```

### 6. Check for Recent Squash

```bash
SESSION_DIR=".claude/sessions/${SANITIZED_BRANCH}"
if [ -f "$SESSION_DIR/last-squash" ]; then
  LAST_SHA=$(cat "$SESSION_DIR/last-squash")
  if [ "$LAST_SHA" = "$(git rev-parse HEAD)" ]; then
    echo "Already squashed at current HEAD."
    echo "Use --force to re-squash, or make more commits first."
    exit 0
  fi
fi
```

## Analysis Phase

### Get Commits to Analyze

```bash
git log "$SESSION_TAG"..HEAD --oneline --format="%H|%s|%aI"
```

### Grouping Algorithm

1. **Map commits to todo items** (if TodoWrite history available):
   - Correlate commit timestamps with todo `in_progress` times
   - Commits during a todo's active period belong to that todo

2. **Fallback: Group by commit prefix**:
   - Extract prefix: `feat:`, `fix:`, `test:`, `refactor:`, `chore:`, `wip:`
   - Group consecutive commits with same prefix family

3. **Determine dominant prefix per group**:
   - `feat` + anything → `feat:` (feature includes its tests/fixes)
   - `fix` + `test` → `fix:` (fix includes its verification)
   - `test` only → `test:`
   - `refactor` only → `refactor:`
   - `chore`/`wip` only → `chore:`

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

3. refactor: Clean up legacy auth code
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
git bundle create "$SESSION_DIR/pre-squash.bundle" "$SESSION_TAG"..HEAD

# Record in-progress state
cat > "$SESSION_DIR/squash-in-progress.json" << EOF
{
  "status": "started",
  "backupTag": "$BACKUP_TAG",
  "originalHead": "$(git rev-parse HEAD)",
  "sessionTag": "$SESSION_TAG",
  "startTime": "$(date -Iseconds)"
}
EOF

echo "Backup created: $BACKUP_TAG"
```

## Execution

```bash
# 1. Soft reset to session start
git reset --soft "$SESSION_TAG"

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

# 5. Delete session tag (no longer needed)
git tag -d "$SESSION_TAG"

# NOTE: Backup tag and bundle are PRESERVED for /undo-squash
# They will be cleaned up by:
#   - /undo-squash (after restore)
#   - /start-work (when starting new work)
#   - Explicit cleanup command
```

## Undo Available

After squash completes, inform user:

```
Squash complete! Backups preserved for undo.

To undo this squash:  /undo-squash
To clean up backups:  /cleanup-squash-backups

Backups auto-cleanup when you run /start-work for new work.
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
