# Squash Commits Improvements Design

**Date:** 2026-01-23
**Status:** FINAL
**Skill:** squash-commits

## Summary

Improve the squash-commits skill with better transparency, wizard-based UX, flexible grouping strategies, and commit time preservation.

## Goals

1. **Transparency** - Agent announces every action, strategy choice, and issue
2. **Wizard UX** - All decisions via multiple choice, no free text input
3. **Grouping flexibility** - Multiple strategies including time-based clustering
4. **Time preservation** - Squashed commits maintain original timestamps

## Non-Goals

- Restricting which git strategies the agent can use
- Automatic squashing without user confirmation
- Changing backup/recovery mechanisms (already working well)

---

## Design

### 1. Strategy Transparency

The agent is free to choose any git strategy but MUST announce and explain.

**Available strategies:**

| Strategy | Description |
|----------|-------------|
| Soft Reset | Default. `git reset --soft`, all changes to staging |
| Interactive Rebase | `git rebase -i` with pick/squash/fixup |
| Cherry-pick | Reset to base, cherry-pick specific commits |

**Required announcements:**

| When | Announcement |
|------|--------------|
| Before starting | `"Strategy: [name]. Reason: [why]"` |
| If switching | `"Switching from [X] to [Y]. Reason: [why]"` |
| On any issue | `"Issue: [what]. Action: [rollback/retry/ask]"` |
| Each step | `"Creating commit N of M: [message]"` |
| Verification | `"Verification passed"` or `"Issue found: [what]"` |

### 2. Grouping Strategies

**Decision flow:**

1. Analyze commits (count, files, timestamps)
2. Detect complexity
3. Simple case → auto-select **commit prefix**, show preview, confirm
4. Complex case → wizard asks user

**Simple vs Complex detection:**

| Criteria | Simple | Complex |
|----------|--------|---------|
| File overlap | Each file in exactly 1 prefix group | Same file in 2+ prefix groups |
| Commit count | ≤ 10 commits | > 10 commits |
| Time span | Same day | Multiple days |

**Complex if ANY criteria is complex.** Default strategy for simple = commit prefix (respects user's original intent).

**Grouping options:**

| Option | Description | Risk |
|--------|-------------|------|
| **Single commit** | All commits → 1 | None |
| **Time clustering** | Group by work sessions | Low |
| **Commit prefix** | Group by feat/fix/test | Low |
| **Logical change** | Split files with `git add -p` | Medium |

**Time clustering granularity (sub-options):**

| Granularity | Logic |
|-------------|-------|
| Hour gaps | New group when gap > 1 hour |
| Session gaps | New group when gap > 4 hours |
| Day | New group on different calendar day |

### 3. Wizard UX

**Rule:** Never ask questions requiring manual text input.

**Decision points:**

| Decision | Options |
|----------|---------|
| Grouping strategy | Single / Time cluster / Prefix / Logical |
| Time cluster granularity | Hour gaps / Session gaps / Day |
| Commit timestamp | Last (default) / First / Middle |
| Confirm preview | Proceed / Adjust / Cancel |
| On failure | Rollback & retry / Rollback & stop / Ask me |
| After success | Delete backup / Keep backup |

**Example flow:**

```
Step 1: How should I group these 8 commits?
  ○ Single commit - All 8 → 1
  ○ By time clustering - Based on when committed
  ○ By commit prefix - Group feat/fix/test
  ○ By logical change - Split shared files

Step 2: What timestamp for each squashed commit?
  ○ Last commit time (Recommended)
  ○ First commit time
  ○ Middle (average) time

Step 3: Preview (8 → 3 groups)
  1. feat: Add auth (9:00-9:30, 4 commits) → 9:30
  2. fix: Fix login (14:00-14:15, 2 commits) → 14:15
  3. test: Add tests (10:00-10:20, 2 commits) → 10:20

  ○ Proceed
  ○ Adjust grouping
  ○ Cancel

Step 3b: Adjust grouping (if selected)
  What would you like to change?
  ○ Grouping strategy (currently: time clustering)
  ○ Clustering granularity (currently: hour gaps)
  ○ Timestamp selection (currently: last)
  ○ Start over from beginning
```

### 4. Commit Time Preservation

**Rule:** Squashed commits use timestamps from original commits.

**Implementation:**

```bash
GIT_AUTHOR_DATE="<timestamp>" \
GIT_COMMITTER_DATE="<timestamp>" \
git commit -m "<message>"
```

**Timestamp options:**

| Option | Description |
|--------|-------------|
| Last (default) | Latest commit time in group |
| First | Earliest commit time in group |
| Middle | Average of first and last |

**Preview shows selected times:**

```
Preserving commit times (using last):
  • Group 1: 2026-01-23 09:30:00
  • Group 2: 2026-01-23 14:15:00
  • Group 3: 2026-01-24 10:20:00
```

### 5. Verification

After squash completes, verify:

1. `git status --porcelain` must be empty (no uncommitted changes)
2. `git diff <backup-tag> HEAD` must be empty (codebase unchanged)

**On verification failure:**

```
Verification FAILED: [uncommitted changes | codebase differs]

What should I do?
  ○ Rollback and retry with different strategy
  ○ Rollback and stop (investigate manually)
  ○ Show me the diff
```

### 6. Error Handling

**On any git command failure:**

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

## Files to Change

| File | Change |
|------|--------|
| `skills/squash-commits/SKILL.md` | Add all new requirements (transparency, wizard, grouping, time preservation, verification, error handling) |

**Note:** undo-squash skill remains compatible - backup format unchanged.

---

## Key Decisions Made

| Decision | Choice | Rationale |
|----------|--------|-----------|
| Strategy restriction | None - all strategies allowed | Flexibility over safety; transparency compensates |
| Default grouping | Commit prefix | Respects user's original intent |
| Complex detection | File overlap OR >10 commits OR multi-day | Covers ambiguous cases |
| Time preservation | Last commit time (default) | Most natural - represents when work finished |
| Adjust flow | Sub-menu | Efficient - user targets specific change |
| Git failures | Rollback first, then ask | Never leave repo in partial state |

---

## Test Scenarios

| # | Scenario | Expected Behavior |
|---|----------|-------------------|
| 1 | Simple case (3 commits, same prefix) | Auto-selects prefix grouping, shows preview |
| 2 | Complex case (file overlap) | Triggers wizard, asks user |
| 3 | Time clustering | Groups by hour/session/day correctly |
| 4 | Single commit | Handles gracefully |
| 5 | Cancel mid-flow | Returns to clean state |
| 6 | Verification failure | Rolls back, asks user |
| 7 | Undo after squash | /undo-squash restores original |
| 8 | Time preservation | Squashed commits have correct timestamps |

**Testing method:** Manual - run skill in real repos with these scenarios.

---

## Future Work

| Item | Description | Prerequisites |
|------|-------------|---------------|
| Single commit edge case | Skip skill entirely when only 1 commit? | None |
| Time clustering → 1 group | Auto-proceed as single commit? | None |
| Cancel mid-squash state | Document exact state left behind | None |
| Verification loop prevention | Max retry count to prevent infinite rollback | None |
| Backup creation failure | Handle case where backup itself fails | None |
| Worktree compatibility | Explicit testing/documentation for worktrees | None |

---

## Implementation Plan

1. Update `skills/squash-commits/SKILL.md` with new requirements
2. Add transparency announcement requirements
3. Add wizard question templates
4. Add grouping strategy logic
5. Add time clustering algorithm
6. Add commit time preservation commands
7. Add verification step
8. Test with various scenarios

---

## Appendix: Announcement Templates

```
BACKUP:
  "Backup created: _squash-backup-XXX"

STRATEGY:
  "Strategy: soft reset. Reason: default, all changes preserved in staging"
  "Strategy: interactive rebase. Reason: preserving original commit boundaries"

PROGRESS:
  "Reset to merge base, all changes staged"
  "Creating commit 1 of 3: feat: Add authentication"
  "Creating commit 2 of 3: fix: Fix login validation"
  "Creating commit 3 of 3: test: Add auth tests"

TIME:
  "Preserving commit times (using last commit of each group)"

VERIFICATION:
  "Verification passed: codebase matches pre-squash state"
  "Verification FAILED: uncommitted changes remain"

SWITCH:
  "Switching from soft reset to interactive rebase"
  "Reason: complex file overlap requires preserving boundaries"

ISSUE:
  "Issue: merge conflict during rebase"
  "Action: rolling back to backup, will ask for guidance"

COMPLETE:
  "Squash complete! 8 commits → 3 commits"
  "Backups preserved. To undo: /undo-squash"
```
