---
description: "Internal skill — not invoked directly. Use /session-status, /session-persist, or /session-handoff instead."
---

# Session Notes

## Overview

This skill captures session context — discoveries, decisions, deferred work, assumptions, edge cases — and either displays a debrief summary, persists findings to plan files, or generates a resumption prompt for the next session.

## When to Use

- End of a work session, before closing Claude Code or compacting context
- Before creating a PR, to document what was learned
- When switching context to a different branch
- When session has produced meaningful discoveries, decisions, or deferred work
- Automatically triggered by session-checkpoint hook before finishing a branch

**When NOT to use:** Quick one-off tasks with no plan file, trivial changes that produced no decisions or discoveries.

## Modes

This skill operates in three modes, determined by which command invokes it:

| Mode | Command | Writes files | Shows summary | Asks permission |
|------|---------|-------------|---------------|-----------------|
| `status` | `/session-status` | No | Yes | No |
| `persist` | `/session-persist` or hook | Yes | Yes | Yes (manual) / No (hook) |
| `handoff` | `/session-handoff` | No | No (outputs prompt) | No |

**Mode detection:** The invoking command or hook determines the mode. `/session-status` = status, `/session-persist` = persist (manual), `/session-handoff` = handoff. When invoked by the session-checkpoint hook (deny-with-feedback), the mode is persist (automatic) — skip the wizard and write directly.

---

## 1. Analysis Phase (All Modes)

**CRITICAL:** This phase is the same depth for all three modes. Do not take shortcuts.

### What to Capture

Scan conversation context, git state, task lists, and plan files. Extract:

| Category | Source | What to look for |
|----------|--------|-----------------|
| Progress | Commits on branch, completed tasks | What was accomplished this session |
| Discoveries | Conversation | Edge cases, surprises, learnings, things that worked unexpectedly |
| Design changes | Plan file vs. actual implementation | Where implementation diverged from the plan and why |
| Gaps | Conversation, code | Unresolved questions, untested paths, inconsistencies |
| Assumptions | Conversation | Decisions made without verified basis — flag as verified/not verified |
| Patterns | Conversation, commits | Recurring themes (e.g., "4 of 6 fixes were null guards — systemic issue?") |
| Edges left open | Conversation, code | Known unhandled scenarios in "completed" work |
| Future work | Conversation | Deferred items, out-of-scope parking lot, different sprint/ticket |
| Next steps | Conversation, plan | Ordered todo for continuing the current work |

### Analysis Steps

1. **Get branch context:**
   ```bash
   BRANCH=$(git branch --show-current)
   MERGE_BASE=$(git merge-base master HEAD 2>/dev/null || git merge-base main HEAD 2>/dev/null)
   ```

2. **Get commit history for this branch:**
   ```bash
   git log "$MERGE_BASE"..HEAD --format="%h %s" --reverse
   ```

3. **Get changed files:**
   ```bash
   git diff --name-only "$MERGE_BASE"..HEAD
   ```

4. **Find matching plan file(s):**
   - Search `docs/plans/*.md` for files matching branch name or ticket ID
   - If branch is `feature/SG-1234-user-auth`, search for files containing "SG-1234" or "user-auth"
   - Read matching plan file(s) to understand original intent

5. **Scan conversation for all categories above**
   - Walk through the conversation mentally
   - Extract concrete findings, not vague summaries
   - Include specific file paths, function names, error messages

6. **Compare plan vs reality:**
   - For each task/deliverable in the plan, determine: ✓ done, ~ adapted, ✗ deferred, or · queued

### The Rule

**Don't rely on Claude memory. Don't summarize lightly. Dump every piece of relevant knowledge. If in doubt, include it.**

This is context-wipe-proof documentation. Write as if the next reader has zero context and no access to this conversation.

---

## 2. Mode: `status` (Read-Only Debrief)

After completing the analysis phase, display the catch-up summary to the user. Do NOT write any files.

This mode is faster than `persist` because it skips the file-handling leg (no need to read existing plan file structure, compose edits, or commit).

Display the summary using the format in Section 5.

---

## 3. Mode: `persist` (Write to Plan Files)

After completing the analysis phase, persist the findings to files.

### Manual Invocation (`/session-persist`)

1. Show the user what was found (summary of categories with content)
2. Ask using AskUserQuestion:
   ```
   Where should I save the session findings?
     ○ Append to plan — Add to existing plan file: {matched file} (only show if plan file was matched)
     ○ New note — Create docs/plans/YYYY-MM-DD-session-notes-{branch}.md
     ○ Skip — Cancel without writing
   ```
3. If "Append to plan": read the existing plan file, identify appropriate sections, append findings under relevant headers (or add new sections)
4. If "New note": create a new file with all findings organized by category
5. Commit with a contextual message generated from the actual content written

### Automatic Invocation (from hook)

1. Skip the wizard — write directly
2. If a matching plan file exists: append to it
3. If no match: create `docs/plans/YYYY-MM-DD-session-notes-{branch}.md`
4. Commit with contextual message

### Commit Message

**Do NOT use a fixed message.** Generate the commit message from the content:
- Summarize what knowledge was added, not "session notes updated"
- Follow `docs: Description` convention
- Examples:
  - `docs: Document token refresh strategy change and SAML deferral`
  - `docs: Add session findings — null guard pattern, Redis assumption`
  - `docs: Update plan with 3 open edge cases and deferred work items`

### Session-Persist Marker

After successful persist and commit, create a marker file:

```bash
SANITIZED_BRANCH=$(echo "$BRANCH" | tr '/' '-')
mkdir -p ".claude/sessions/${SANITIZED_BRANCH}"
date -u +"%Y-%m-%dT%H:%M:%S%z" > ".claude/sessions/${SANITIZED_BRANCH}/session-persist-done"
```

This marker tells the session-checkpoint hook that documentation has been updated for this branch.

### After Writing

Display the catch-up summary using the format in Section 5.

---

## 4. Mode: `handoff` (Generate Resumption Prompt)

After completing the analysis phase, generate a ready-to-paste prompt for starting a fresh session. Do NOT write files.

### Output Format

Output the prompt inside a code block so the user can copy it:

````
Here's your resumption prompt for the next session:

```
I'm continuing work on {branch}.

Read the implementation plan at {plan file path}
— it was {updated with session notes from the last session | last updated on YYYY-MM-DD}.

Status: {N}/{M} tasks complete. {summary of what's done and what remains}.

Key context:
- {deviation from plan, if any}
- {important decision made}
- {blocker or dependency, if any}

Start with: {concrete file path} — {what to do}.
Run: {exact command}
```
````

### Guidelines

- Reference the plan file (especially if just updated by `/session-persist`)
- Include only context that the next session needs — not everything from the analysis
- The "Start with" line must be a concrete file path and action, not a vague next step
- Keep it under 15 lines — this is a bootstrap, not a novel

---

## 5. Catch-Up Summary Format

Used by both `status` and `persist` modes. Displayed to the user, NOT written to files.

```
## Session Debrief — {branch}

> {N}/{M} tasks done · {X} queued · {Y} blocked · Plan drift: {none|minor|significant}

### Plan vs Reality

| Task | Plan | Actual | Δ |
|------|------|--------|---|
| {task name} | {what plan said} | {what actually happened} | ✓/~/✗/· |

`✓ done` · `~ adapted` · `✗ deferred` · `· queued`

### What actually happened

**{Key change 1}** — {tight prose explaining why, not just what}

**{Key change 2}** — {explanation}

### Edges left open

- {concrete unhandled scenario in "completed" work}

### Assumptions made

1. {assumption} — **{verified|not verified}**

### Pattern noticed

{observation about recurring themes, if detected. Omit section if no pattern found.}

### Future work

- {deferred items — different sprint, different ticket, out of scope}

### Next steps

1. {ordered todo for continuing this work}

### Resume here

→ `{file path}` — {what to do}. Run: `{command}`
```

### Guidelines

- The posture line (first `>` block) gives a 2-second status read
- Plan vs Reality table: scan the Δ column vertically for instant status
- "What actually happened" uses narrative prose, not bullet lists — explain the WHY behind deviations
- Omit sections that have no content (e.g., skip "Pattern noticed" if none found)
- The whole summary should fit one terminal screen (~35 lines)

---

## 6. Edge Cases

| Situation | Behavior |
|-----------|----------|
| No plan file exists for this branch | `status`/`handoff`: note it in summary. `persist`: create new note file. |
| No commits on branch yet | Summarize conversation findings only, skip git-based analysis |
| Multiple plan files match | Show all matches, let user pick (manual) or use the most recently modified (automatic) |
| Branch is `main` or `master` | Still works — just skip merge-base comparison, summarize conversation context only |
| No meaningful findings to capture | Display: "No significant findings to document from this session." Skip file writes in persist mode. |
