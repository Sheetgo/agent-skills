# Session Context Management Design

**Date:** 2026-02-16
**Status:** DRAFT
**Components:** session-status, session-persist, session-handoff (commands/skill), session-checkpoint (hook), implementation-audit (skill)

## Problem

Context loss is the single biggest productivity drain across sessions. It happens at three points:

1. **Within-session discoveries never reach files.** Edge cases, design changes, deferred work — all live only in conversation. If the session compacts or closes, they're gone.
2. **Plan files drift from reality.** After writing-plans creates the implementation plan, actual implementation diverges. Nobody updates the plan doc. Same after plan-hardening — resolved issues and deferred work stay in conversation instead of making it back to the design doc.
3. **Finishing skips documentation.** finishing-a-development-branch offers merge/PR/cleanup options but never checks whether docs are current. Branches get merged with stale plans.

## Goals

1. **Context preservation** - Every piece of knowledge acquired during a session can be persisted to files on demand
2. **Automatic safety net** - Documentation is always updated before a branch is finished, without manual intervention
3. **Session continuity** - A developer can close a session and resume in a fresh one without information loss
4. **Post-implementation validation** - Code can be audited against the plan to catch drift, gaps, and quality issues

## Non-Goals

- Changing the native Claude Code compaction behavior
- Modifying superpowers skills (finishing-a-development-branch, writing-plans, etc.)
- Automatic session-notes on every commit or at timed intervals
- Replacing the existing requesting-code-review or receiving-code-review skills

---

## Design

### Architecture Overview

Five components, two families:

**Session family (context management):**

| Component | Type | Purpose |
|-----------|------|---------|
| `/session-status` | Command | Read-only debrief — display catch-up summary, no file writes |
| `/session-persist` | Command | Write findings to plan files, commit, display summary |
| `/session-handoff` | Command | Generate a resumption prompt for the next session |
| `session-checkpoint` | Hook | Intercept finishing-a-development-branch, force session-persist |

**Standalone:**

| Component | Type | Purpose |
|-----------|------|---------|
| `/implementation-audit` | Skill | Dispatch parallel reviewers to validate code against plan |

All three session commands invoke a single skill (`session-notes`) with a mode parameter. The commands are thin stubs.

---

### 1. Session-Notes Skill

**File:** `skills/session-notes/SKILL.md`

The core engine shared by all three session commands and the hook. Three modes:

| Mode | Trigger | Writes files | Shows summary | Asks permission |
|------|---------|-------------|---------------|-----------------|
| `status` | `/session-status` | No | Yes | No |
| `persist` | `/session-persist` or hook | Yes | Yes | Yes (manual) / No (hook) |
| `handoff` | `/session-handoff` | No | No (outputs prompt instead) | No |

#### What It Captures

The skill performs deep analysis of the current session by scanning conversation context, git state, task lists, and plan files. It extracts:

| Category | Source |
|----------|--------|
| Progress / accomplishments | Commits on branch, completed tasks |
| Discoveries & insights | Conversation context — edge cases, surprises, learnings |
| Design changes / deviations | Differences between plan file and actual implementation |
| Gaps & open issues | Unresolved questions, untested paths, inconsistencies |
| Assumptions made | Decisions without verified basis |
| Pattern observations | Recurring themes in fixes/changes (e.g., "4 of 6 fixes were null guards") |
| Edges left open | Known unhandled scenarios in "completed" work |
| Future work | Deferred items, out-of-scope parking lot |
| Next steps | Ordered todo for continuing the current work |

**The rule:** Don't rely on Claude memory. Don't summarize lightly. Dump every piece of relevant knowledge into the files. If in doubt, include it.

#### Mode: `status` (read-only)

Deep analysis of conversation + git state + loose comparison to plan. Produces the catch-up summary and displays it. No file I/O beyond reading.

Faster than `persist` because it skips the file-handling leg: no need to read existing plan file structure, determine update strategy, compose edits, or commit.

#### Mode: `persist` (write to files)

Same deep analysis as `status`, plus an extra leg:

1. Find `docs/plans/*.md` files matching current branch name or ticket ID
2. Read their current content and structure
3. Determine what sections need updating vs. appending
4. Compose edits that fit coherently into the existing document
5. Write updates
6. Commit with a contextual message generated from the content (e.g., `docs: Document backoff strategy change and 3 deferred items`)
7. Display the catch-up summary

**When invoked manually (`/session-persist`):** Shows what it found and asks:
- `[Append to plan]` — add to existing plan file
- `[New note]` — create `docs/plans/YYYY-MM-DD-session-notes-{branch}.md`
- `[Skip]` — cancel without writing

**When invoked by hook (automatic):** Writes directly, no wizard. Appends to existing plan file if found, creates new note if not.

#### Mode: `handoff` (generate resumption prompt)

Uses the same analysis to generate a ready-to-paste prompt for starting a fresh session. The prompt includes:

- Branch name and what it's for
- Pointer to the plan file (especially if just updated by session-persist)
- Status: what's done, what remains
- Key context: deviations from plan, important decisions, blockers
- Concrete starting point: file path and command to run

Example output:

```
I'm continuing work on feature/SG-4521-oauth2-sso.

Read the implementation plan at docs/plans/2026-02-10-oauth2-sso.md
— it was updated with session notes from the last session.

Status: Tasks 1-7 complete, Task 8 (Redis session adapter) is next.

Key context:
- Token refresh uses exponential backoff with jitter (was linear in plan)
- Cookie signing migrated to RS256 (deviation from plan, documented)
- SAML flow blocked on IdP sandbox credentials

Start with: src/session/redis-adapter.ts — implement SessionStore
interface with TTL config. Run: npm test -- --grep "session"
```

#### Catch-Up Summary Format

Displayed by both `status` and `persist` modes. Designed for terminal markdown rendering, fits one screen (~35 lines).

```
## Session Debrief — {branch}

> {N}/{M} tasks done · {X} queued · {Y} blocked · Plan drift: {none|minor|significant}

### Plan vs Reality

| Task | Plan | Actual | Δ |
|------|------|--------|---|
| ... | ... | ... | ✓/~/✗ |

### What actually happened

**{Key change}** — {tight prose explaining why, not just what}

### Edges left open

- {concrete unhandled scenario in "completed" work}

### Assumptions made

1. {assumption} — **{verified|not verified}**

### Pattern noticed

{observation about recurring themes, if any}

### Future work

- {deferred items, out-of-scope parking lot}

### Next steps

1. {ordered todo for continuing}

### Resume here

→ `{file path}` — {what to do}. Run: `{command}`
```

Symbol legend for Plan vs Reality: `✓ done` · `~ adapted` · `✗ deferred` · `· queued`

---

### 2. Session-Checkpoint Hook

**File:** `hooks/session-checkpoint.py`
**Event:** PreToolUse on Skill tool

#### Behavior

Intercepts the `finishing-a-development-branch` skill. Before the finishing wizard runs, it denies and instructs Claude to run the session-persist workflow first. This fires whether the skill is invoked manually or called by another skill (subagent-driven-development, executing-plans, etc.).

**Detection:** `tool_name == "Skill"` and tool_input references `finishing-a-development-branch`.

**Response:** Deny with feedback (same pattern as git-conventions.py):

```
Before finishing this branch, you must update documentation.
Run the full session-persist workflow:
1. Scan conversation for discoveries, decisions, deferred work, assumptions, edge cases
2. Find and read the plan file(s) for this branch
3. Write updates to plan files
4. Commit with a descriptive message
5. Display the catch-up summary
Then retry finishing the branch.
```

**Always fires** — no staleness detection. Every branch gets documented before finishing.

#### Re-entry

After Claude completes the session-persist workflow and retries finishing-a-development-branch, the hook must allow it through. The skill creates a marker file at `.claude/sessions/{sanitized-branch}/session-persist-done` upon completion. The hook checks for this marker before denying. If the marker exists, the hook allows the skill through (exit 0).

The marker is branch-scoped and gets cleaned up with other session state.

---

### 3. Command Stubs

Three thin command files that invoke the session-notes skill:

**`commands/session-status.md`:**
Invoke the session-notes skill in `status` mode — read-only debrief, no file writes.

**`commands/session-persist.md`:**
Invoke the session-notes skill in `persist` mode — write findings to plan files, commit, display summary.

**`commands/session-handoff.md`:**
Invoke the session-notes skill in `handoff` mode — generate a resumption prompt for the next session.

---

### 4. Implementation-Audit Skill

**File:** `skills/implementation-audit/SKILL.md`
**Command:** `/implementation-audit` (`commands/implementation-audit.md`)

A separate skill for post-implementation validation. Used when starting a fresh session to verify previous work.

#### Flow

1. Identify the plan file for the current branch
2. Read the plan and map out expected tasks/deliverables
3. Dispatch parallel review agents, each examining a different dimension:

| Agent | Checks |
|-------|--------|
| **Completeness** | Every task in the plan has corresponding code. Nothing skipped or half-done. |
| **Correctness** | Implementation matches the plan's intent, not just superficially. |
| **Quality** | Bugs, edge cases, code smells, duplicated logic. |
| **Drift** | Where implementation diverged from plan — documented or not. |
| **Loose ends** | TODOs in code, commented-out blocks, placeholder values, unfinished error handling. |

4. Collect results from all agents
5. Present consolidated audit report with findings per dimension
6. For any issues found, create TaskCreate items for remediation

#### Relationship to Existing Skills

- Does NOT replace `requesting-code-review` (which is about general code quality)
- Does NOT replace `verification-before-completion` (which is about running tests before claiming done)
- Specifically focused on **plan-to-implementation alignment** — a concern neither existing skill covers

---

## File Inventory

| File | Type | New/Modify |
|------|------|------------|
| `skills/session-notes/SKILL.md` | Skill | New |
| `commands/session-status.md` | Command | New |
| `commands/session-persist.md` | Command | New |
| `commands/session-handoff.md` | Command | New |
| `hooks/session-checkpoint.py` | Hook | New |
| `skills/implementation-audit/SKILL.md` | Skill | New |
| `commands/implementation-audit.md` | Command | New |

No existing files are modified.

---

## Open Questions

None — all decisions resolved during brainstorming.
