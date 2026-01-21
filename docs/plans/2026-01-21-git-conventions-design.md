# Git Conventions Skill Design

## Status: FINAL

## Overview

A combined skill + hook that:
1. **Guides** branch creation (absorbs `/start-work`) - interactive wizard
2. **Enforces** commit message format - PreToolUse hook blocks invalid commits

## File Structure

```
agent-skills/
├── skills/
│   ├── git-conventions/
│   │   └── SKILL.md           # Conventions reference + start-work workflow
│   ├── squash-commits/
│   │   └── SKILL.md           # Update: remove session tag references
│   └── undo-squash/
│       └── SKILL.md           # Keep as-is
├── hooks/
│   ├── dangerous-command-blocker.py
│   └── git-conventions.py     # NEW: commit message validator
├── commands/
│   ├── start-work.md          # Points to git-conventions skill
│   ├── cleanup-squash.md      # NEW: manual backup cleanup
│   ├── squash-commits.md
│   └── undo-squash.md
└── README.md                  # Update with new skill/hook
```

## Commit Message Format

### Valid Formats

| Pattern | Example |
|---------|---------|
| `type: Description` | `feat: Add user authentication` |
| `Merge ...` | `Merge branch 'master' of https://...` |
| `Revert "..."` | `Revert "feat: Add broken feature"` |
| `Initial commit` | `Initial commit` |

### Rules

- **Allowed types:** `feat`, `fix`, `docs`, `chore`, `test`
- **Description:** Must start with capital letter (team convention, differs from standard conventional commits which uses lowercase)
- **Space required** after colon
- **Validation scope:** First line only (subject/title)
- **Passthrough:** Merge/Revert/Initial commits skip validation

### Regex Patterns

```python
# Standard commits - requires capital letter followed by at least one more character
standard_pattern = r'^(feat|fix|docs|chore|test): [A-Z].+'

# Passthrough patterns (no validation)
passthrough_patterns = [
    r'^Merge ',           # Merge commits
    r'^Revert "',         # Revert commits
    r'^Initial commit',   # Initial commit
]
```

### Error Message

```
❌ Invalid commit message format

Your message: added new feature

Commit messages must follow: type: Description

Types: feat, fix, docs, chore, test

Examples:
  ✅ feat: Add user authentication
  ✅ fix: Resolve memory leak in parser
  ✅ test: Add unit tests for auth module

Invalid:
  ❌ added new feature (no type)
  ❌ feat:Add feature (missing space)
  ❌ feat: add feature (lowercase description)
```

## Branch Creation Workflow

### Wizard Flow

1. **Work type?** → `feature` or `fix` (or "other" for custom prefix)
2. **Ticket ID?** → e.g., `SG-1234` (optional, Enter to skip)
3. **Short description?** → e.g., `user-authentication` (kebab-case)

### Branch Naming

| Type | With Ticket | Without Ticket |
|------|-------------|----------------|
| Feature | `feature/SG-1234-user-auth` | `feature/user-auth` |
| Fix | `fix/SG-1234-login-bug` | `fix/login-bug` |
| Other | `{custom}/...` | `{custom}/...` |

### Worktree-Safe Branch Creation

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
  echo "Options: continue from here, or switch to master first"
  # Ask user to confirm or abort
fi

# 3. Validate branch name (for "other" option)
if ! git check-ref-format --branch "$BRANCH_NAME" 2>/dev/null; then
  echo "Error: Invalid branch name '$BRANCH_NAME'"
  exit 1
fi

# 4. Fetch latest from origin (continue if offline)
if ! git fetch origin master 2>/dev/null; then
  echo "Warning: Could not fetch from origin. Using local references."
fi

# 5. Find most up-to-date base (no checkout needed)
ORIGIN_MASTER=$(git rev-parse origin/master 2>/dev/null)
LOCAL_MASTER=$(git rev-parse master 2>/dev/null)

# Determine BASE with proper error handling
if [ -n "$ORIGIN_MASTER" ] && [ -n "$LOCAL_MASTER" ]; then
  if git merge-base --is-ancestor "$ORIGIN_MASTER" "$LOCAL_MASTER"; then
    BASE="$LOCAL_MASTER"    # Local is ahead or equal
  elif git merge-base --is-ancestor "$LOCAL_MASTER" "$ORIGIN_MASTER"; then
    BASE="$ORIGIN_MASTER"   # Origin is ahead
  else
    echo "Warning: local and origin/master have diverged."
    echo "Using origin/master as base."
    BASE="$ORIGIN_MASTER"
  fi
elif [ -n "$LOCAL_MASTER" ]; then
  BASE="$LOCAL_MASTER"
elif [ -n "$ORIGIN_MASTER" ]; then
  BASE="$ORIGIN_MASTER"
else
  echo "Error: Cannot determine base. Neither master nor origin/master found."
  exit 1
fi

# 6. Create branch from best base (no merge commit)
git checkout -b "$BRANCH_NAME" "$BASE"
```

**Key improvement:** No `git checkout master` needed - works safely in worktrees where master may be checked out elsewhere.

## Cleanup Command

### `/cleanup-squash` Command

For manually cleaning up squash backup tags. This is a **skill** (Claude executes interactively), not a standalone script.

**When to use:**
- After confirming a squash is good and you don't need undo
- Before pushing (optional tidiness)
- When backup tags accumulate

**What it cleans:**
- `_squash-backup-*` tags
- `.claude/sessions/*/pre-squash.bundle` files
- `.claude/sessions/*/last-squash.json` files

**Flow:**

```bash
# 1. List what will be cleaned
BACKUP_TAGS=$(git tag -l "_squash-backup-*")
BUNDLE_FILES=$(find .claude/sessions -name "pre-squash.bundle" 2>/dev/null)

if [ -z "$BACKUP_TAGS" ] && [ -z "$BUNDLE_FILES" ]; then
  echo "Nothing to clean up."
  exit 0
fi

# 2. Show preview
echo "Will remove:"
for tag in $BACKUP_TAGS; do echo "  tag: $tag"; done
for file in $BUNDLE_FILES; do echo "  file: $file"; done

# 3. Claude asks user for confirmation (AskUserQuestion tool)

# 4. If confirmed, clean
for tag in $BACKUP_TAGS; do git tag -d "$tag"; done
for file in $BUNDLE_FILES; do rm "$file"; done
find .claude/sessions -name "last-squash.json" -delete 2>/dev/null
```

## Changes to Existing Files

| File | Change |
|------|--------|
| `skills/start-work/` | **Delete** - absorbed into git-conventions |
| `skills/squash-commits/SKILL.md` | Update to use `git merge-base master HEAD` only, remove session tag logic |
| `commands/start-work.md` | Update to point to git-conventions skill |
| `README.md` | Add git-conventions skill and hook documentation |

## Removed Features

Features removed from original `/start-work`:

| Feature | Reason |
|---------|--------|
| Session tag creation (`_session-start-*`) | Not being used; squash-commits uses merge-base fallback |
| Session tag cleanup | No longer needed |
| Auto squash backup cleanup | Moved to manual `/cleanup-squash` command |
| `session.json` creation | Not being used |

## Hook Registration

### New Installation

Add to `~/.claude/settings.json`:

```json
{
  "hooks": {
    "PreToolUse": [
      {
        "matcher": "Bash",
        "hooks": [
          {
            "type": "command",
            "command": "python3 ~/.claude/hooks/git-conventions.py"
          }
        ]
      }
    ]
  }
}
```

### Merging with Existing Hooks

If you already have PreToolUse hooks (e.g., dangerous-command-blocker), add to the existing array:

```json
{
  "hooks": {
    "PreToolUse": [
      {
        "matcher": "Bash",
        "hooks": [
          {
            "type": "command",
            "command": "python3 ~/.claude/hooks/dangerous-command-blocker.py"
          },
          {
            "type": "command",
            "command": "python3 ~/.claude/hooks/git-conventions.py"
          }
        ]
      }
    ]
  }
}
```

Both hooks run on every Bash command. Each hook independently decides whether to block.

## Migration Guide

### For Existing `/start-work` Users

1. **Update symlink:**
   ```bash
   # Remove old symlink
   rm ~/.claude/skills/start-work

   # Create new symlink to git-conventions
   ln -sf ~/Development/agent-skills/skills/git-conventions ~/.claude/skills/git-conventions
   ```

2. **Add hook symlink:**
   ```bash
   ln -sf ~/Development/agent-skills/hooks/git-conventions.py ~/.claude/hooks/
   ```

3. **Update settings.json** - Add git-conventions.py to PreToolUse hooks (see Hook Registration above)

4. **Restart Claude Code** for hooks to take effect

5. **Optional cleanup:**
   - Existing `.claude/sessions/*/session.json` files can be left (harmless) or deleted
   - Run `/cleanup-squash` if you have old backup tags

### Existing SessionStart Hook

The SessionStart hook in your settings.json that suggests `/start-work` continues to work - the command still exists, pointing to the new git-conventions skill.

## User-Facing Commands

| Command | Purpose |
|---------|---------|
| `/start-work` | Guided branch creation (worktree-safe) |
| `/cleanup-squash` | Manual backup cleanup |
| `/squash-commits` | Consolidate commits (existing) |
| `/undo-squash` | Restore pre-squash state (existing) |

## Test Cases

### Hook Validation Tests

| Input | Expected | Reason |
|-------|----------|--------|
| `feat: Add feature` | ✅ Pass | Valid format |
| `fix: Resolve bug` | ✅ Pass | Valid format |
| `test: Add unit tests` | ✅ Pass | Valid format |
| `docs: Update README` | ✅ Pass | Valid format |
| `chore: Update deps` | ✅ Pass | Valid format |
| `feat: a` | ❌ Reject | Lowercase description |
| `feat:Add feature` | ❌ Reject | Missing space |
| `feat: ` | ❌ Reject | Empty description |
| `feature: Add` | ❌ Reject | Invalid type |
| `add feature` | ❌ Reject | No type |
| `Merge branch 'master'` | ✅ Pass | Passthrough |
| `Revert "feat: Add"` | ✅ Pass | Passthrough |
| `Initial commit` | ✅ Pass | Passthrough |

### Worktree Branch Creation Test

1. Set up: main worktree on `master`, create second worktree
2. From second worktree, run `/start-work`
3. Verify: branch created from latest of origin/master or local master
4. Verify: no `git checkout master` attempted (would fail in worktree)

## Implementation Tasks

1. Create `skills/git-conventions/SKILL.md`
2. Create `hooks/git-conventions.py`
3. Create `commands/cleanup-squash.md`
4. Update `commands/start-work.md` to point to git-conventions
5. Update `skills/squash-commits/SKILL.md` - remove session tag logic
6. Delete `skills/start-work/` directory
7. Update `README.md` with new skill/hook documentation
8. Test hook with valid/invalid commit messages
9. Test branch creation in worktree scenario

## Key Decisions

| Decision | Choice | Rationale |
|----------|--------|-----------|
| Commit format | `type: Description` (no scope) | Simpler than conventional commits, team preference |
| Capital letter | Required in description | Team convention, differs from standard lowercase |
| Allowed types | feat, fix, docs, chore, test | Minimal set covering actual usage |
| Session tags | Removed | Not being used; merge-base fallback sufficient |
| Squash backup cleanup | Manual command | User controls when to delete undo capability |
| Branch base | Most recent of origin/master or local master | Ensures new branches are up-to-date |

## Future Work

| Item | Description |
|------|-------------|
| Unicode capitals | Support non-ASCII capitals (Ñ, Ö) in descriptions |
| Emoji support | Allow emoji after type (e.g., `feat: 🎉 Add celebration`) |
| Session cleanup | Auto-cleanup orphaned session directories |
