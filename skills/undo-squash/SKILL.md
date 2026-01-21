---
name: undo-squash
description: "Restore commits to their pre-squash state. Use when: squash grouping was wrong, need original commit history back, or want to try different grouping."
---

# Undo Squash

## Overview

Restores the original commits from before the last squash operation. Works as long as backups exist (preserved until next `/start-work` or explicit cleanup).

## Prerequisites

- Must have backup from recent squash (backup tag or bundle)
- Cannot undo if squashed commits were already pushed (without force push)

## Finding Undo Data

Check in order of preference:

### 1. Check last-squash.json (preferred)

```bash
BRANCH=$(git branch --show-current)
SANITIZED_BRANCH=$(echo "$BRANCH" | tr '/' '-')
SESSION_DIR=".claude/sessions/${SANITIZED_BRANCH}"

if [ -f "$SESSION_DIR/last-squash.json" ]; then
  BACKUP_TAG=$(jq -r .backupTag "$SESSION_DIR/last-squash.json")
  ORIGINAL_HEAD=$(jq -r .originalHead "$SESSION_DIR/last-squash.json")
  BUNDLE_PATH=$(jq -r .bundlePath "$SESSION_DIR/last-squash.json")
  SQUASH_TIME=$(jq -r .squashedAt "$SESSION_DIR/last-squash.json")

  echo "Found squash from: $SQUASH_TIME"
  echo "Original HEAD: $ORIGINAL_HEAD"
fi
```

### 2. Check for backup tag (fallback)

```bash
BACKUP_TAG=$(git tag -l "_squash-backup-*" | sort | tail -1)
if [ -n "$BACKUP_TAG" ]; then
  echo "Found backup tag: $BACKUP_TAG"
fi
```

### 3. Check for bundle file (last resort)

```bash
if [ -f "$SESSION_DIR/pre-squash.bundle" ]; then
  echo "Found backup bundle"
fi
```

### 4. Git reflog (emergency)

```bash
# If all else fails, check reflog
git reflog | grep -E "reset.*moving to" | head -5
echo "Manual recovery possible via reflog"
```

## Safety Checks

### Check if Already Pushed

```bash
UPSTREAM=$(git rev-parse --abbrev-ref @{u} 2>/dev/null)
if [ -n "$UPSTREAM" ]; then
  # Check if current HEAD matches remote
  LOCAL_HEAD=$(git rev-parse HEAD)
  REMOTE_HEAD=$(git rev-parse "$UPSTREAM" 2>/dev/null)

  if [ "$LOCAL_HEAD" = "$REMOTE_HEAD" ]; then
    echo "Warning: Squashed commits already pushed."
    echo "Undo would require force push."
    echo "Continue anyway? [y/n]"
    # Only proceed if user explicitly confirms
  fi
fi
```

## Execution

### Option A: Restore from Backup Tag (preferred)

```bash
if [ -n "$BACKUP_TAG" ] && git rev-parse "$BACKUP_TAG" >/dev/null 2>&1; then
  echo "Restoring from backup tag: $BACKUP_TAG"

  # Get the SHA before reset for confirmation
  RESTORE_SHA=$(git rev-parse "$BACKUP_TAG")
  COMMIT_COUNT=$(git log HEAD.."$BACKUP_TAG" --oneline | wc -l | tr -d " ")

  echo "Will restore $COMMIT_COUNT commits"
  echo "Target: $RESTORE_SHA"

  git reset --hard "$BACKUP_TAG"
  echo "Restored to: $(git log -1 --oneline)"
fi
```

### Option B: Restore from Bundle

```bash
if [ -f "$BUNDLE_PATH" ] && [ -n "$ORIGINAL_HEAD" ]; then
  echo "Restoring from bundle..."

  # Unbundle to make commits available
  git bundle unbundle "$BUNDLE_PATH"

  # Reset to original HEAD
  git reset --hard "$ORIGINAL_HEAD"
  echo "Restored to: $(git log -1 --oneline)"
fi
```

### Option C: Restore from Reflog (emergency)

```bash
# Show reflog entries for user to choose
git reflog | head -20

echo "Enter the SHA or reflog entry to restore to:"
# User provides SHA like "HEAD@{2}" or "abc123"
# git reset --hard <user-provided-sha>
```

## Cleanup After Undo

```bash
# Remove backup tag (used)
if [ -n "$BACKUP_TAG" ]; then
  git tag -d "$BACKUP_TAG" 2>/dev/null
fi

# Remove backup files
rm -f "$SESSION_DIR/pre-squash.bundle"
rm -f "$SESSION_DIR/last-squash.json"
rm -f "$SESSION_DIR/squash-in-progress.json"

echo "Undo complete. Backup artifacts cleaned up."
```

## Confirmation Output

```
Squash undone successfully!

Restored: 15 original commits
HEAD now at: abc123 "feat: original commit message"
Backup artifacts: cleaned up

You can now:
- Run /squash-commits again with different grouping
- Continue working and make more commits
- Push the original commits as-is
```

## Troubleshooting

### "No backup found"

If no backup tag or bundle exists:

1. Check git reflog: `git reflog | head -20`
2. Look for entries like `reset: moving to _session-start-*`
3. The entry just before that is your original HEAD
4. Restore manually: `git reset --hard <sha>`

### "Backup tag exists but can't resolve"

The tag might point to a garbage-collected commit:

1. Check if bundle exists: `ls -la $SESSION_DIR/*.bundle`
2. If bundle exists, unbundle first: `git bundle unbundle <bundle>`
3. Then reset to the commit

### "Already pushed, need force push"

If you really need to undo after pushing:

1. Confirm with team (you'll rewrite shared history)
2. Undo locally: `/undo-squash`
3. Force push: `git push --force-with-lease`
