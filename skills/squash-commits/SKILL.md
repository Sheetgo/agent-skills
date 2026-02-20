---
name: squash-commits
description: "Consolidate commits into cohesive logical groups. Use ONLY when all todos are completed and you're ready to push."
---

# Squash Commits

## Overview

This skill analyzes commits since branch creation, groups them by logical boundaries, and consolidates them into clean, meaningful commits with preserved timestamps.

## When to Use

- **ONLY** when all todos are completed and you're ready to push
- Manual invocation via `/squash-commits` when explicitly requested by user

---

## 1. Transparency Requirements

**CRITICAL:** Announce every action, strategy choice, and issue. Never operate silently.

### Required Announcements

| When | Announcement |
|------|--------------|
| Backup created | `"📦 Backup created: _squash-backup-XXX"` |
| Strategy chosen | `"📋 Strategy: [name]. Reason: [why]"` |
| Strategy switch | `"⚠️ Switching from [X] to [Y]. Reason: [why]"` |
| Each commit | `"✅ Creating commit N of M: [message]"` |
| Verification | Run `git diff <backup> HEAD` and SHOW output to user |
| Diff result | `"No output - codebase identical ✅"` or show actual diff |
| On any issue | `"❌ Issue: [what]. Action: [rollback/retry/ask]"` |
| Complete | `"🎉 Squash complete! X commits → Y commits"` |

### Available Strategies

| Strategy | Description |
|----------|-------------|
| Soft Reset | Default. `git reset --soft`, all changes to staging |
| Interactive Rebase | `git rebase -i` with pick/squash/fixup |
| Cherry-pick | Reset to base, cherry-pick specific commits |

Agent may choose any strategy but MUST announce and explain the choice.

---

## 2. Wizard UX

**RULE:** Never ask questions requiring manual text input. Always use multiple choice via AskUserQuestion tool.

### Decision Points

| Decision | Options |
|----------|---------|
| Grouping strategy | Time cluster (default) / Single / Prefix / Logical (not advised) |
| Time cluster granularity | Session gaps (default) / Hour gaps / Day |
| Commit timestamp | Last (default) / First / Middle |
| Confirm preview | Proceed / Adjust / Cancel |
| On failure | Rollback & retry / Rollback & stop / Ask me |
| After success | Delete backup / Keep backup |

### Wizard Flow

**Step 1: Grouping** (skip if simple case - auto-select time clustering)
```
How should I group these N commits?
  ○ By time clustering - Group by work sessions (Recommended)
  ○ Single commit - All N → 1
  ○ By commit prefix - Group feat/fix/test
  ○ By logical change - Split shared files (advanced, not advised)
```

**Step 2: Timestamp** (if multiple groups)
```
What timestamp for each squashed commit?
  ○ Last commit time (Recommended) - When work finished
  ○ First commit time - When work started
  ○ Middle (average) time
```

**Step 3: Preview**
```
Preview: N commits → M groups

1. feat: Add auth and login flow (9:00-10:30, 6 commits) → 10:30
   feat: Add auth, test: Add auth tests, fix: Fix token refresh
2. fix: Fix login validation and update docs (14:00-14:45, 3 commits) → 14:45
   fix: Fix login, docs: Update API docs, chore: Lint cleanup

  ○ Proceed
  ○ Adjust grouping
  ○ Cancel
```

Each group shows: synthesized title, time range, commit count, and the original commit subjects for context.

**Step 3b: Adjust** (if selected — then loop back to Step 3 with new results)
```
What would you like to change?
  ○ Grouping strategy (currently: [current])
  ○ Clustering granularity (currently: [current]) ← only if time clustering
  ○ Timestamp selection (currently: [current])
  ○ Start over from beginning
```

---

## 3. Grouping Strategies

### Simple vs Complex Detection

| Criteria | Simple | Complex |
|----------|--------|---------|
| Commit count | ≤ 10 commits | > 10 commits |
| Time span | Same day | Multiple days |
| Time clusters | 1–3 natural session groups | 4+ session groups |

**Complex if ANY criteria is complex.**

- **Simple case:** Auto-select time clustering (session gaps), default timestamp (last), show preview, confirm
- **Complex case:** Show wizard, ask user to choose strategy (time clustering still recommended)

### Grouping Options

| Option | Description | Risk |
|--------|-------------|------|
| **Time clustering** | Group by work sessions (default) | Low |
| **Single commit** | All commits → 1 | None |
| **Commit prefix** | Group by feat/fix/test | Low |
| **Logical change** | Split files with `git add -p` | High — not advised |

**Why time clustering is the default:** Work sessions naturally group related changes. Commits made close together almost always belong to the same logical unit of work. This avoids the complexity of trying to untangle shared files across prefix groups.

**Why logical change is not advised:** When the same file is modified for different tasks/goals across commits, the orchestration required to split those changes is extremely complex and error-prone. Prefer time clustering and let the commit message explain the mixed concerns.

### Time Clustering Granularity

| Granularity | Logic |
|-------------|-------|
| Hour gaps | New group when gap > 1 hour |
| Session gaps | New group when gap > 4 hours (default — matches typical break between work sessions) |
| Day | New group on different calendar day |

### Clustering Algorithm

**BEFORE any git reset**, compute the time clusters:

```bash
# 1. Get commits with timestamps (epoch seconds), chronological order
git log "$MERGE_BASE"..HEAD --format="%H %at" --reverse
```

2. Walk the sorted list. Compare each commit's timestamp to the previous commit's.
3. If the gap exceeds the threshold (e.g., 4 hours = 14400 seconds), start a new group.
4. For each group, record the commits and the files they touched:
   ```bash
   # For each commit in the group, get its files
   git diff-tree --no-commit-id --name-only -r <commit-hash>
   ```

**Edge case — 1 group:** If all commits fall within a single session, inform the user and proceed as a single commit: `"Time clustering produced 1 group (all commits within same session). Proceeding as single commit."`

**Edge case — file overlap across clusters:** If the same file appears in multiple time clusters, assign it to the **last cluster** that touched it. The earlier cluster's commit message should note that later work continued in that file.

### Prefix Dominance Rules

Applies to ALL grouping strategies when choosing the commit prefix for a squashed commit containing mixed types:

1. Collect commit prefixes within the group: `feat:`, `fix:`, `test:`, `docs:`, `chore:`
2. Determine dominant prefix:
   - `feat` + anything → `feat:` (feature includes its tests/fixes)
   - `fix` + `test` → `fix:` (fix includes its verification)
   - `test` only → `test:`
   - `docs` only → `docs:`
   - `chore` only → `chore:`

---

## 4. Commit Time Preservation

**RULE:** Squashed commits MUST use timestamps from original commits.

### Implementation

```bash
GIT_AUTHOR_DATE="<timestamp>" \
GIT_COMMITTER_DATE="<timestamp>" \
git commit -m "<message>"
```

### Timestamp Options

| Option | Description |
|--------|-------------|
| Last (default) | Latest commit time in group |
| First | Earliest commit time in group |
| Middle | Average of first and last |

### Announcement

```
📅 Preserving commit times (using last commit of each group):
  • Group 1: 2026-01-23 09:30:00
  • Group 2: 2026-01-23 14:15:00
  • Group 3: 2026-01-24 10:20:00
```

---

## 5. Verification

After squash completes, ALWAYS verify AND show the diff to user:

### Checks

1. `git status --porcelain` must be empty (no uncommitted changes)
2. **ALWAYS run and show:** `git diff <backup-tag> HEAD`

### CRITICAL: Always Show Diff Output

**You MUST run `git diff <backup-tag> HEAD` and show the output to the user**, even when expecting it to be empty. This provides:
- Proof that no code was lost during squash
- Transparency for user to verify themselves
- Early detection if something went wrong

```bash
# ALWAYS run this and show output
git diff <backup-tag> HEAD
```

If empty, announce: `"No output - the codebase is identical. ✅"`

### On Success

```
✅ Verification passed

git diff <backup-tag> HEAD
(no output - codebase identical)

The squash preserved all code changes exactly. Only the commit history changed.
```

### On Failure

```
❌ Verification FAILED: [uncommitted changes | codebase differs]

git diff output:
<show the actual diff>

What should I do?
  ○ Rollback and retry with different strategy
  ○ Rollback and stop (investigate manually)
```

---

## 6. Error Handling

### On Any Git Command Failure

1. ANNOUNCE: `"❌ Git error: [error message]"`
2. IF backup exists → attempt rollback: `git reset --hard <backup-tag>`
3. ANNOUNCE: `"🔄 Rolled back to backup"`
4. ASK user:
   ```
   Git failed. What now?
     ○ Retry the squash
     ○ Stop and investigate manually
   ```
5. IF rollback also fails → show manual recovery commands

**Key principle:** Always attempt rollback first, never leave repo in partial state.

---

## 7. Safety Checks (Run First)

Before any squash operation, verify:

### 7.1 Clean Working Tree

```bash
if [ -n "$(git status --porcelain)" ]; then
  echo "Error: Working directory not clean."
  echo "Please commit or stash changes first."
  exit 1
fi
```

### 7.2 Get Current Branch

```bash
BRANCH=$(git branch --show-current)
SANITIZED_BRANCH=$(echo "$BRANCH" | tr '/' '-')

if echo "$BRANCH" | grep -qE "^(main|master)$"; then
  echo "Error: Cannot squash on main/master branch."
  exit 1
fi
```

### 7.3 Find Branch Start Point

```bash
MERGE_BASE=$(git merge-base master HEAD 2>/dev/null)
if [ -z "$MERGE_BASE" ]; then
  echo "Error: Cannot find merge base with master."
  exit 1
fi

COMMIT_COUNT=$(git log "$MERGE_BASE"..HEAD --oneline | wc -l | tr -d " ")
echo "Found $COMMIT_COUNT commits since branching from master."
```

### 7.4 Check for Pushed Commits

```bash
UPSTREAM=$(git rev-parse --abbrev-ref @{u} 2>/dev/null)
if [ -n "$UPSTREAM" ]; then
  REMOTE_HEAD=$(git rev-parse "origin/$BRANCH" 2>/dev/null)
  if [ -n "$REMOTE_HEAD" ] && [ "$REMOTE_HEAD" != "$(git rev-parse HEAD)" ]; then
    # Use wizard to ask
    echo "Warning: Some commits may have been pushed."
    echo "Squashing will require force push."
  fi
fi
```

### 7.5 Check for Merge Commits

```bash
MERGES=$(git log "$MERGE_BASE"..HEAD --merges --oneline | wc -l | tr -d " ")
if [ "$MERGES" -gt 0 ]; then
  echo "Warning: Branch has $MERGES merge commit(s)."
  echo "Squashing may produce unexpected results."
fi
```

### 7.6 Check for Recent Squash

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

---

## 8. Backup Before Squash

**Use simple, single-purpose commands** — avoid chaining with `&&`. Each operation should be a separate Bash call.

```bash
# 1. Create session directory
mkdir -p ".claude/sessions/${SANITIZED_BRANCH}"

# 2. Create backup tag
git tag "_squash-backup-<timestamp>"

# 3. Create bundle for undo
git bundle create ".claude/sessions/${SANITIZED_BRANCH}/pre-squash.bundle" "$MERGE_BASE"..HEAD

# 4. Record in-progress state (use Write tool, not Bash)
# Write squash-in-progress.json with: status, backupTag, originalHead, mergeBase, startTime
```

**ANNOUNCE:** `"📦 Backup created: _squash-backup-XXX"`

---

## 9. Execution

### 9.1 Pre-compute (BEFORE reset)

**CRITICAL:** Collect all grouping data before any destructive operation.

```bash
# ANNOUNCE grouping + git strategy
# "📋 Grouping: time clustering (session gaps). Git strategy: soft reset."

# 1. Compute time clusters (see Clustering Algorithm in Section 3)
git log "$MERGE_BASE"..HEAD --format="%H %at" --reverse
# Record per-group: commit hashes, files touched, timestamps

# 2. For each group, collect its file list
git diff-tree --no-commit-id --name-only -r <commit-hash>

# 3. Resolve file overlaps: if a file appears in multiple groups,
#    assign it to the LAST group that touched it.
#    Remove it from earlier groups' file lists.
```

### 9.2 Reset and Rebuild

**IMPORTANT: Use simple, single-purpose commands** — one git operation per Bash call. This ensures commands match the user's permission allow-list and avoids approval prompts. Do NOT chain multiple git operations with `&&` in a single command.

```bash
# Step 1: Soft reset to merge base
git reset --soft "$MERGE_BASE"

# Step 2: Unstage everything (keep changes in working tree)
git reset HEAD

# Step 3: For each group (in chronological order):

# 3a. Stage only this group's files
git add <file1> <file2> ...

# 3b. Commit with preserved timestamp (separate command)
GIT_AUTHOR_DATE="<timestamp>" GIT_COMMITTER_DATE="<timestamp>" \
git commit -m "<prefix>: <message>"

# Repeat 3a-3b for all groups

# Step 4: Verify no unstaged files remain
git status --porcelain
```

**If single group (or single commit strategy):** Skip the unstage/re-stage dance. After `git reset --soft`, commit everything directly:
```bash
git reset --soft "$MERGE_BASE"
GIT_AUTHOR_DATE="<timestamp>" GIT_COMMITTER_DATE="<timestamp>" \
git commit -m "<prefix>: <message>"
```

### 9.3 Verify and Record

```bash
# 1. Verify and SHOW diff to user
git diff "$BACKUP_TAG" HEAD  # Run and SHOW output (should be empty)
# If diff is empty: "No output - the codebase is identical. ✅"
echo "✅ Verification passed"

# 2. Update squash state
rm "$SESSION_DIR/squash-in-progress.json"

# 3. Record successful squash
cat > "$SESSION_DIR/last-squash.json" << EOF
{
  "squashedAt": "$(date -Iseconds)",
  "newHead": "$(git rev-parse HEAD)",
  "backupTag": "$BACKUP_TAG",
  "originalHead": "$ORIGINAL_HEAD",
  "bundlePath": "$SESSION_DIR/pre-squash.bundle"
}
EOF

# ANNOUNCE completion
echo "🎉 Squash complete! X commits → Y commits"
echo "Backups preserved. To undo: /undo-squash"
```

---

## 10. Commit Message Format

### CRITICAL: Meaningful Summaries, Not Verbose Lists

**Before writing commit messages, you MUST:**

1. Read the full body of each original commit (not just subjects):
   ```bash
   git log <merge-base>..HEAD --format="=== %s ===%n%b" --reverse
   ```

2. Extract and synthesize:
   - Architectural decisions and their rationale
   - Design context (e.g., "3 rounds of plan hardening")
   - Bug fixes with explanations of WHY the code was wrong
   - Important behavioral changes

3. Organize into logical sections with headers (##)

**DO NOT** just list commit subjects as bullet points - that's verbose and loses the narrative.

### Good Example (Synthesized)

```
feat: Add authorization error handling for external files (ref SG-1234)

Design went through 3 rounds of plan hardening (17 issues found: 8 fixed,
1 won't do, 10 deferred to future work).

## Error scenarios handled

- Auth revoked mid-session: Dialog prompts user to re-authorize via OAuth
- File access lost: Pre-run validation detects inaccessible external files
- Token expiration: Retry-once pattern with fresh OAuth token on 401

## Backend changes

- Add drive-error-helpers with standardized error throwing and validation
- Add withApiResilience for exponential backoff on 429 rate limits
- New error codes: AUTH_REVOKED, TOKEN_EXPIRED, SOURCE_ACCESS_LOST

## Frontend changes

- Add AuthRequiredDialog with 3 states: required → waiting → failed
- Add useFileValidation hook for pre-run external file validation
- Wire auth error detection into useAutomationRun with retry callback

Generated with [Claude Code](https://claude.com/claude-code)

Co-Authored-By: Claude Opus 4.5 <noreply@anthropic.com>
```

### Bad Example (Verbose List)

```
feat: Add authorization error handling (ref SG-1234)

- Add authorization error handling design
- Revise authorization error handling design
- Finalize authorization error handling design
- Add drive error helpers
- Add authorization status APIs
- Add file validation API
- Add auth service
- Add AuthRequiredDialog component
- Add useFileValidation hook
...
```

This is just copying commit subjects - it loses context and is hard to understand.

### Structure Guidelines

| Section | Content |
|---------|---------|
| Title line | Concise summary with ticket ref |
| Context paragraph | Design process, scope, key decisions |
| `## Category` sections | Group related changes logically |
| Bullet points | Specific changes with WHY when non-obvious |
| Footer | Claude Code link + Co-Authored-By |

### Commit Messages for Time-Clustered Groups

Time clusters often contain mixed prefixes (e.g., a `feat:` + `fix:` + `test:` in one session). To choose the prefix:

1. Apply the **Prefix Dominance Rules** from Section 3 to the commits within the cluster
2. The commit title should synthesize what the session accomplished, not list individual commits
3. The commit body follows the same narrative structure guidelines above

**Example:** A session with 3 feat commits, 1 fix, and 2 test commits → `feat:` prefix, with the body noting the fix and tests in context.

### Without ticket:

Same format, just omit the `(ref XX-NNNN)` from title.

---

## 11. Recovery

If squash was interrupted, check for `squash-in-progress.json`:

```bash
if [ -f "$SESSION_DIR/squash-in-progress.json" ]; then
  STATUS=$(jq -r .status "$SESSION_DIR/squash-in-progress.json")
  BACKUP=$(jq -r .backupTag "$SESSION_DIR/squash-in-progress.json")

  echo "Previous squash interrupted at: $STATUS"
  # Use wizard:
  #   ○ Recover original (git reset --hard $BACKUP)
  #   ○ Continue from current state
  #   ○ Abort and clean up
fi
```

---

## Undo Available

After squash completes, inform user:

```
🎉 Squash complete! Backups preserved for undo.

To undo this squash:  /undo-squash
To clean up backups:  /squash-cleanup
```
