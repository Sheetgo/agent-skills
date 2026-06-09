---
name: git-conventions
description: "Use when starting new work (feature or fix branch), or when commit message validation fails. Provides branch creation wizard and commit format reference."
---

# Git Conventions

## Overview

Team conventions for git workflow: branch naming and commit message format. Commit validation is enforced automatically via PreToolUse hook.

## Commit Message Format

### Valid Patterns

| Pattern | Example |
|---------|---------|
| `type: Description` | `feat: Add user authentication` |
| `Merge ...` | `Merge branch 'master' of ...` |
| `Revert "..."` | `Revert "feat: Add feature"` |
| `Initial commit` | `Initial commit` |

### Rules

- **Types:** `feat`, `fix`, `docs`, `chore`, `test`
- **Description:** Capital letter, then at least one more character
- **Format:** `type: Description` (space after colon required)
- **Passthrough:** Merge/Revert/Initial commits skip validation

### Quick Reference

```
✅ feat: Add user authentication
✅ fix: Resolve memory leak
✅ test: Add unit tests for auth
✅ docs: Update README
✅ chore: Update dependencies

❌ added new feature     (no type)
❌ feat:Add feature      (missing space)
❌ feat: add feature     (lowercase)
❌ feature: Add          (invalid type)
```

## Branch Creation (/start-work)

### Wizard Flow

Use `AskUserQuestion` for each step:

1. **Work type?** → Options: `feature`, `fix`, `chore`
2. **Ticket ID?** → Text input (optional, format: `SG-1234`)
3. **Short description?** → Text input (kebab-case, e.g., `user-auth`)

### Branch Naming

| Type | With Ticket | Without Ticket |
|------|-------------|----------------|
| Feature | `feature/SG-1234-user-auth` | `feature/user-auth` |
| Fix | `fix/SG-1234-login-bug` | `fix/login-bug` |
| Chore | `chore/SG-1234-cleanup` | `chore/cleanup` |

### Worktree-Safe Creation

```bash
# 1. Safety check - uncommitted changes
if [ -n "$(git status --porcelain)" ]; then
  echo "Uncommitted changes. Commit or stash first."
  exit 1
fi

# 2. Safety check - already on feature/fix branch
CURRENT_BRANCH=$(git branch --show-current)
if echo "$CURRENT_BRANCH" | grep -qE "^(feature|fix)/"; then
  echo "Warning: Already on $CURRENT_BRANCH"
  # Ask user to confirm or abort
fi

# 3. Validate branch name
if ! git check-ref-format --branch "$BRANCH_NAME" 2>/dev/null; then
  echo "Error: Invalid branch name"
  exit 1
fi

# 4. Fetch latest (continue if offline)
git fetch origin master 2>/dev/null || echo "Warning: Using local refs"

# 5. Find best base (no checkout needed)
ORIGIN_MASTER=$(git rev-parse origin/master 2>/dev/null)
LOCAL_MASTER=$(git rev-parse master 2>/dev/null)

if [ -n "$ORIGIN_MASTER" ] && [ -n "$LOCAL_MASTER" ]; then
  if git merge-base --is-ancestor "$ORIGIN_MASTER" "$LOCAL_MASTER"; then
    BASE="$LOCAL_MASTER"
  else
    BASE="$ORIGIN_MASTER"
  fi
elif [ -n "$LOCAL_MASTER" ]; then
  BASE="$LOCAL_MASTER"
elif [ -n "$ORIGIN_MASTER" ]; then
  BASE="$ORIGIN_MASTER"
else
  echo "Error: Cannot find master branch"
  exit 1
fi

# 6. Create branch
git checkout -b "$BRANCH_NAME" "$BASE"
```

**Key:** No `git checkout master` - works in worktrees where master is checked out elsewhere.

## Related Commands

| Command | Purpose |
|---------|---------|
| `/start-work` | Branch creation wizard (this skill) |
| `/squash-cleanup` | Remove squash backup tags |
| `/squash-commits` | Consolidate commits before push |
| `/undo-squash` | Restore pre-squash state |
