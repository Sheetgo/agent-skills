# Session Context Management Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Build a session context management system — three commands (`/session-status`, `/session-persist`, `/session-handoff`), one hook (`session-checkpoint`), and one standalone skill (`/implementation-audit`) — that prevent context loss across session boundaries.

**Architecture:** A single skill (`session-notes`) powers the three session commands via a mode parameter. A PreToolUse hook intercepts `finishing-a-development-branch` and forces documentation before finishing. A separate skill (`implementation-audit`) dispatches parallel reviewers for plan-vs-code validation.

**Tech Stack:** Markdown skills (SKILL.md), markdown command stubs, Python hook (stdin JSON protocol)

---

### Task 1: Create the session-notes skill

The core engine. This is the largest file and everything else depends on it.

**Files:**
- Create: `skills/session-notes/SKILL.md`

**Step 1: Write the skill file**

```markdown
---
name: session-notes
description: "Session context management — status debrief, persist findings to plan files, or generate handoff prompt. Use via /session-status, /session-persist, or /session-handoff."
---

# Session Notes

## Overview

This skill captures session context — discoveries, decisions, deferred work, assumptions, edge cases — and either displays a debrief summary, persists findings to plan files, or generates a resumption prompt for the next session.

## Modes

This skill operates in three modes, determined by which command invokes it:

| Mode | Command | Writes files | Shows summary | Asks permission |
|------|---------|-------------|---------------|-----------------|
| `status` | `/session-status` | No | Yes | No |
| `persist` | `/session-persist` or hook | Yes | Yes | Yes (manual) / No (hook) |
| `handoff` | `/session-handoff` | No | No (outputs prompt) | No |

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
   - For each task/deliverable in the plan, determine: done (✓), adapted (~), deferred (✗), or queued (·)

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
     ○ Append to plan — Add to existing plan file: {matched file}
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
date -Iseconds > ".claude/sessions/${SANITIZED_BRANCH}/session-persist-done"
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
```

**Step 2: Verify the file was created correctly**

```bash
ls -la skills/session-notes/SKILL.md
head -5 skills/session-notes/SKILL.md
```

Expected: File exists with YAML frontmatter starting with `---`

**Step 3: Commit**

```bash
git add skills/session-notes/SKILL.md
git commit -m "feat: Add session-notes skill for context management"
```

---

### Task 2: Create the three session command stubs

Thin command files that invoke the session-notes skill in different modes.

**Files:**
- Create: `commands/session-status.md`
- Create: `commands/session-persist.md`
- Create: `commands/session-handoff.md`

**Step 1: Write session-status.md**

```markdown
---
description: "Read-only session debrief. Shows catch-up summary without writing files."
---

Invoke the session-notes skill in **status** mode.

Follow the skill at `~/.claude/skills/session-notes/SKILL.md`:
1. Run the full Analysis Phase (Section 1)
2. Display the Catch-Up Summary (Section 5)
3. Do NOT write any files or create commits
```

**Step 2: Write session-persist.md**

```markdown
---
description: "Persist session findings to plan files. Captures discoveries, decisions, deferred work, and commits."
---

Invoke the session-notes skill in **persist** mode.

Follow the skill at `~/.claude/skills/session-notes/SKILL.md`:
1. Run the full Analysis Phase (Section 1)
2. Follow the Persist workflow (Section 3)
3. Display the Catch-Up Summary (Section 5) after writing
```

**Step 3: Write session-handoff.md**

```markdown
---
description: "Generate a resumption prompt for starting a fresh session. No file writes."
---

Invoke the session-notes skill in **handoff** mode.

Follow the skill at `~/.claude/skills/session-notes/SKILL.md`:
1. Run the full Analysis Phase (Section 1)
2. Generate the Resumption Prompt (Section 4)
3. Do NOT write any files or create commits
```

**Step 4: Verify all three files exist**

```bash
ls -la commands/session-*.md
```

Expected: Three files listed

**Step 5: Commit**

```bash
git add commands/session-status.md commands/session-persist.md commands/session-handoff.md
git commit -m "feat: Add session-status, session-persist, session-handoff commands"
```

---

### Task 3: Create the session-checkpoint hook

Python hook that intercepts `finishing-a-development-branch` and forces documentation.

**Files:**
- Create: `hooks/session-checkpoint.py`

**Step 1: Write the hook**

```python
#!/usr/bin/env python3
"""
Session Checkpoint Hook
Intercepts finishing-a-development-branch skill to force documentation update.
Denies with instructions to run session-persist workflow before finishing.
"""

import json
import os
import subprocess
import sys

try:
    input_data = json.load(sys.stdin)
except json.JSONDecodeError:
    sys.exit(0)

tool_name = input_data.get("tool_name", "")
tool_input = input_data.get("tool_input", {})

# Only intercept Skill tool calls
if tool_name != "Skill":
    sys.exit(0)

# Check if the skill being invoked is finishing-a-development-branch
skill_name = tool_input.get("skill", "")
if "finishing-a-development-branch" not in skill_name:
    sys.exit(0)

# Check for session-persist marker
try:
    branch = subprocess.check_output(
        ["git", "branch", "--show-current"],
        text=True, stderr=subprocess.DEVNULL
    ).strip()
except (subprocess.CalledProcessError, FileNotFoundError):
    # Can't determine branch, allow through
    sys.exit(0)

if not branch:
    sys.exit(0)

sanitized_branch = branch.replace("/", "-")
marker_path = f".claude/sessions/{sanitized_branch}/session-persist-done"

if os.path.exists(marker_path):
    # Documentation already updated, allow finishing
    sys.exit(0)

# Deny with instructions to run session-persist first
reason = """Before finishing this branch, you must update documentation.

Run the full session-persist workflow NOW (do not ask for permission):

1. Scan conversation for discoveries, decisions, deferred work, assumptions, patterns, and edge cases
2. Find and read the plan file(s) for this branch in docs/plans/
3. Write updates to plan files — append to existing or create new session notes file
4. Commit with a descriptive message summarizing what knowledge was added
5. Create the marker file: .claude/sessions/{branch}/session-persist-done
6. Display the catch-up summary to the user

After completing all steps, retry finishing the branch.""".format(branch=sanitized_branch)

output = {
    "hookSpecificOutput": {
        "hookEventName": "PreToolUse",
        "permissionDecision": "deny",
        "permissionDecisionReason": reason
    }
}
print(json.dumps(output))
sys.exit(0)
```

**Step 2: Make the hook executable**

```bash
chmod +x hooks/session-checkpoint.py
```

**Step 3: Verify the hook runs without errors on empty input**

```bash
echo '{"tool_name": "Bash", "tool_input": {"command": "ls"}}' | python3 hooks/session-checkpoint.py
echo $?
```

Expected: Exit code 0 (non-Skill tool calls pass through)

**Step 4: Verify the hook denies finishing-a-development-branch without marker**

```bash
echo '{"tool_name": "Skill", "tool_input": {"skill": "finishing-a-development-branch"}}' | python3 hooks/session-checkpoint.py
echo $?
```

Expected: Exit code 0, JSON output with `permissionDecision: "deny"`

**Step 5: Commit**

```bash
git add hooks/session-checkpoint.py
git commit -m "feat: Add session-checkpoint hook to guard branch finishing"
```

---

### Task 4: Create the implementation-audit skill

Standalone skill for post-implementation validation against the plan.

**Files:**
- Create: `skills/implementation-audit/SKILL.md`

**Step 1: Write the skill file**

```markdown
---
name: implementation-audit
description: "Dispatch parallel reviewers to validate implementation against the plan. Use for post-implementation verification in a fresh session."
---

# Implementation Audit

## Overview

This skill validates that an implementation matches its plan. It dispatches parallel review agents to examine different dimensions of the code, then consolidates findings into an audit report.

## When to Use

- Starting a fresh session and want to verify previous work
- Before creating a PR, to catch drift and gaps
- After multiple implementation sessions, to check cumulative alignment
- When confidence in the implementation is low

## Flow

### Step 1: Identify the Plan

1. Get the current branch:
   ```bash
   BRANCH=$(git branch --show-current)
   ```

2. Search `docs/plans/*.md` for files matching the branch name or ticket ID

3. If multiple matches, ask using AskUserQuestion:
   ```
   Which plan should I audit against?
     ○ {file 1}
     ○ {file 2}
     ○ {file 3}
   ```

4. If no plan file found:
   ```
   No plan file found for this branch.
     ○ Specify a plan file path — I'll provide the path
     ○ Audit without plan — General code quality review only
     ○ Cancel
   ```

5. Read the plan file and extract all tasks/deliverables

### Step 2: Dispatch Parallel Reviewers

Launch 5 review agents in parallel using the Task tool. Each agent gets:
- The plan file content (or relevant section)
- The list of changed files on the branch
- Their specific review dimension

**Agent 1: Completeness Reviewer**
```
Review the implementation for COMPLETENESS against the plan.

Plan file: {path}
Branch: {branch}
Changed files: {file list}

For each task/deliverable in the plan:
1. Check if corresponding code exists
2. Verify the implementation is complete, not partial
3. Flag any tasks that are missing or half-done

Output format:
- Task: {name}
  Status: COMPLETE | PARTIAL | MISSING
  Evidence: {file:line or explanation}
  Gap: {what's missing, if any}
```

**Agent 2: Correctness Reviewer**
```
Review the implementation for CORRECTNESS against the plan.

Plan file: {path}
Branch: {branch}
Changed files: {file list}

For each implemented feature:
1. Does it match the plan's INTENT, not just superficially?
2. Are the data flows correct?
3. Do error paths behave as specified?

Output format:
- Feature: {name}
  Correct: YES | PARTIAL | NO
  Issue: {description of incorrectness, if any}
  Evidence: {file:line}
```

**Agent 3: Quality Reviewer**
```
Review the implementation for CODE QUALITY.

Branch: {branch}
Changed files: {file list}

Check for:
1. Bugs and logic errors
2. Unhandled edge cases
3. Code smells and duplicated logic
4. Security concerns (injection, XSS, etc.)
5. Performance issues

Output format:
- File: {path}
  Line: {number}
  Severity: HIGH | MEDIUM | LOW
  Issue: {description}
  Suggestion: {fix}
```

**Agent 4: Drift Reviewer**
```
Review the implementation for DRIFT from the plan.

Plan file: {path}
Branch: {branch}
Changed files: {file list}

For each deviation found:
1. What the plan specified
2. What was actually implemented
3. Whether the deviation was documented (in plan file, session notes, or commit messages)
4. Whether the deviation is an improvement, compromise, or regression

Output format:
- Area: {what diverged}
  Plan said: {original spec}
  Implementation: {what was done}
  Documented: YES | NO
  Assessment: IMPROVEMENT | COMPROMISE | REGRESSION
```

**Agent 5: Loose Ends Reviewer**
```
Review the implementation for LOOSE ENDS.

Branch: {branch}
Changed files: {file list}

Search for:
1. TODO/FIXME/HACK/XXX comments in changed files
2. Commented-out code blocks
3. Placeholder values or hardcoded strings
4. Incomplete error handling (empty catch blocks, generic error messages)
5. Console.log / print statements left for debugging

Output format:
- File: {path}
  Line: {number}
  Type: TODO | COMMENTED_CODE | PLACEHOLDER | INCOMPLETE_ERROR | DEBUG_LOG
  Content: {the line or block}
```

### Step 3: Consolidate Results

After all agents complete, consolidate into an audit report:

```
## Implementation Audit — {branch}

> Audited against: {plan file}
> Files reviewed: {count}
> Findings: {critical} critical · {warning} warnings · {info} informational

### Completeness

{N}/{M} tasks fully implemented

| Task | Status | Gap |
|------|--------|-----|
| ... | COMPLETE/PARTIAL/MISSING | ... |

### Correctness Issues

{list of correctness problems, if any}

### Code Quality

| Severity | Count | Top Issues |
|----------|-------|------------|
| HIGH | {n} | {summary} |
| MEDIUM | {n} | {summary} |
| LOW | {n} | {summary} |

### Plan Drift

{N} deviations found, {documented count} documented, {undocumented count} undocumented

| Area | Assessment | Documented |
|------|------------|------------|
| ... | IMPROVEMENT/COMPROMISE/REGRESSION | YES/NO |

### Loose Ends

{count} items found across {file count} files

| Type | Count |
|------|-------|
| TODO | {n} |
| Commented code | {n} |
| Placeholders | {n} |
| Incomplete error handling | {n} |
| Debug logs | {n} |
```

### Step 4: Create Remediation Tasks

For any HIGH severity findings or MISSING completeness items, create TaskCreate todos:

```
For each critical finding:
  TaskCreate: "Fix: {description}" with details from the audit
```

Ask using AskUserQuestion:
```
Audit complete. {N} issues found. What next?
  ○ Create tasks for all findings — Add todo items for remediation
  ○ Create tasks for critical only — Only HIGH severity and MISSING items
  ○ Review only — I'll handle remediation manually
```
```

**Step 2: Verify the file was created correctly**

```bash
ls -la skills/implementation-audit/SKILL.md
head -5 skills/implementation-audit/SKILL.md
```

Expected: File exists with YAML frontmatter

**Step 3: Commit**

```bash
git add skills/implementation-audit/SKILL.md
git commit -m "feat: Add implementation-audit skill for plan-vs-code validation"
```

---

### Task 5: Create the implementation-audit command stub

**Files:**
- Create: `commands/implementation-audit.md`

**Step 1: Write the command stub**

```markdown
---
description: "Audit implementation against the plan. Dispatches parallel reviewers to check completeness, correctness, quality, drift, and loose ends."
---

Invoke the implementation-audit skill at `~/.claude/skills/implementation-audit/SKILL.md` and follow it exactly.
```

**Step 2: Commit**

```bash
git add commands/implementation-audit.md
git commit -m "feat: Add implementation-audit command"
```

---

### Task 6: Register the hook and verify symlinks

The hook needs to be registered in `~/.claude/settings.json` and all new files need symlinks.

**Step 1: Check current hook registrations**

```bash
cat ~/.claude/settings.json | python3 -c "import sys,json; d=json.load(sys.stdin); print(json.dumps(d.get('hooks',{}), indent=2))"
```

**Step 2: Register session-checkpoint hook**

Add to `~/.claude/settings.json` under `hooks.PreToolUse`:

```json
{
  "type": "command",
  "command": "python3 ~/.claude/hooks/session-checkpoint.py"
}
```

**Step 3: Create symlinks for new files**

```bash
# Skill symlinks
ln -sf "$(pwd)/skills/session-notes" ~/.claude/skills/session-notes
ln -sf "$(pwd)/skills/implementation-audit" ~/.claude/skills/implementation-audit

# Command symlinks
ln -sf "$(pwd)/commands/session-status.md" ~/.claude/commands/session-status.md
ln -sf "$(pwd)/commands/session-persist.md" ~/.claude/commands/session-persist.md
ln -sf "$(pwd)/commands/session-handoff.md" ~/.claude/commands/session-handoff.md
ln -sf "$(pwd)/commands/implementation-audit.md" ~/.claude/commands/implementation-audit.md

# Hook symlink
ln -sf "$(pwd)/hooks/session-checkpoint.py" ~/.claude/hooks/session-checkpoint.py
```

**Step 4: Verify symlinks**

```bash
ls -la ~/.claude/skills/session-notes
ls -la ~/.claude/skills/implementation-audit
ls -la ~/.claude/commands/session-*.md
ls -la ~/.claude/commands/implementation-audit.md
ls -la ~/.claude/hooks/session-checkpoint.py
```

Expected: All symlinks point to the correct files

**Step 5: Commit any remaining changes**

```bash
git status
# If .gitignore or other files changed, commit them
```

---

### Task 7: Update README with new components

**Files:**
- Modify: `README.md`

**Step 1: Read the current README**

```bash
head -100 README.md
```

**Step 2: Add new components to the skills/commands/hooks listings**

Add to the appropriate sections:
- Skills: `session-notes`, `implementation-audit`
- Commands: `/session-status`, `/session-persist`, `/session-handoff`, `/implementation-audit`
- Hooks: `session-checkpoint`

**Step 3: Commit**

```bash
git add README.md
git commit -m "docs: Add session management and implementation-audit to README"
```
