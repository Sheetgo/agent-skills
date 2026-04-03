---
name: fix-issues
description: Use when fixing bugs, resolving issues, or addressing small improvements found in testing, user reports, or code audits
---

# Issue Fixing & Bug Resolution Workflow

> **Version**: 3.1.14
> **Updated**: 2026-04-03
> **Purpose**: Autonomous issue investigation, diagnosis, and resolution with live verification
> **Setup**: User-level skill (works in any project). Optional per-project `.claude/settings.local.json` for permissions + hook — see `SETUP.md`.
> **Skill home**: `~/.claude/skills/fix-issues/` — templates, scripts, and sub-files live here
> **Critical**: The session directory (SESSION.md + FIX-XXX.md files) is the ONLY thing that survives compaction. If it's not in the files, it didn't happen.

---

## When to Use This vs Other Skills

```
Is it a bug, issue, or small improvement?
├─ Yes → Use THIS skill (/fix-issues)
│   ├─ Single issue → Process it through the full pipeline
│   └─ Multiple issues → Process each through the pipeline sequentially
├─ Is it a new feature? → Use /brainstorming + /writing-plans
├─ Is it a test suite problem? → Use /test-audit
└─ Unsure → Default to THIS skill (cheaper to escalate than over-plan)
```

## Definitions

**Subagent**: A Task tool invocation (subagent_type=Explore or general-purpose) with a named role, defined task, and structured output.

**Session directory**: The timestamped directory at `docs/fix-sessions/YYYY-MM-DD_HH-MM/` containing SESSION.md (registry, summary) and per-issue FIX-XXX.md files. Survives compaction. At wrap-up, FIX files are merged into SESSION.md for archival (single file per session).

**Issue file**: A FIX-XXX.md file within the session directory — contains investigation, fix, and verification for one issue. GATE markers are written here.

**Checkpoint**: A mandatory Edit to SESSION.md or FIX-XXX.md + TaskUpdate at every status transition. If you don't write it, it didn't happen.

## ABSOLUTE RULES

1. **NEVER PUSH TO REMOTE** — all commits stay LOCAL
2. **NEVER CHANGE BUSINESS INTENT** — preserve existing rules
3. **NEVER SKIP INVESTIGATION** — understand before fixing
4. **ASK HUMAN** only for business rule conflicts
5. **CHECKPOINT EVERY STATUS CHANGE** to the session file
6. **NEVER FIX WITHOUT A REGRESSION TEST**
7. **PROVE IT WORKS** — external evidence, not code reading
8. **READ TEST OUTPUT WITH Read TOOL** — never pipe through `tail`, `head`, `grep`, or `awk`. Truncated output hides failures.
9. **DUAL-TRACK** — session file AND TaskUpdate must agree

### Red Flags — STOP If You Catch Yourself Doing These

| Rationalization | Reality |
|----------------|---------|
| "This bug is obvious, I can skip investigation" | Obvious bugs have hidden causes. Investigate. |
| "Session document is overhead for a simple fix" | Simple fixes become complex 60% of the time. Track from the start. |
| "I'll add tests later" | You won't. Add the test NOW as part of the fix. |
| "I already know where the code is" | You know WHERE, not WHY. Investigation reveals WHY. |
| "This doesn't need subagents" | Even LIGHT scope uses at least 1 subagent. |
| "Let me just fix it first, then document" | If you fix first, you won't document. Checkpoint AS you go. |
| "I'll update the session file at the end" | **NO.** You will forget. Update IMMEDIATELY at every status change. |
| "I can tell this works by reading the code" | Code reading is hypothesis, not proof. Run it. Test it. Screenshot it. |
| "Local tests pass, skip integration" | For backend changes, integration tests catch what local tests miss. |
| "I'll update the task status later" | Task and session file updates are ONE atomic action. No exceptions. |
| "Cosmetic fix, no test needed" | Cosmetic fixes regress too. Document visual verification or add a snapshot test. |
| "A unit test assertion isn't practical" | If unit test is impractical, use E2E or Playwright snapshot. Some verification is mandatory. |
| "Let me commit and mark complete" | You haven't verified. GATE 3 requires test evidence before VERIFIED. |
| Goes straight from "I understand" to Edit | You skipped investigation, diagnosis, and pre-fix validation. Go back to Phase 1. |
| Types "VERIFIED" without running anything | GATE 3 blocks this. At least one test command must run with recorded output. |
| "The fix is simple, reviews are overkill" | Simple fixes have hidden issues. Spec compliance review is always mandatory. |
| "Backend changes don't need business rule checks" | Backend controls timeouts, retries, state cascades — all are business rules. |
| "High severity = run T1 only" | Tier selection is by CHANGE TYPE, not severity. See CLAUDE.md test tier guide. |
| "Code quality review skipped (LIGHT scope)" for STANDARD/DEEP | Section 2 scope is authoritative. If it says STANDARD/DEEP, Step C is MANDATORY. You cannot claim LIGHT in Section 3. |
| "I'll batch more than 3 LIGHT issues for efficiency" | Max 3 per batch. The gate-check hook will FAIL if you exceed this. Split into multiple batches. |
| "STANDARD issue is simple enough to batch" | Scope determines batching, not your judgment. Only LIGHT can batch. |
| Writes "GATE N PASSED" without running `check-fix-gate.cjs` | ALL gates (1, 2, 3) require the script. Hook output is NOT sufficient. Writing the marker is Step 1. Running the script is Step 2. Step 1 without Step 2 is a pipeline violation. |
| "The hook already validated this gate" | Hook output is informational. The script is the authoritative check. Run it every time, for every issue. |
| Pipes test command through `tail`/`head`/`grep` | `tail` hides errors before the summary. Redirect to file, then use Grep tool. See Phase 4.1 OUTPUT RULE. |
| Includes `tail`/`head` in subagent prompts | Subagent instructions must follow the same rules. Use file redirect + Grep pattern. |
| Skips Final Review in Phase 5 | "I already verified each issue" — per-issue gates check individual correctness. Final Review reasons about the full picture: do fixes conflict? Are there missing edge cases? Does the combined change set make sense for the project? |

## CHECKPOINT PROTOCOL (MANDATORY)

The session directory is the single artifact that survives compaction. If you don't write to it, your work is invisible.

**Rule**: Write to SESSION.md or FIX-XXX.md at EVERY status transition + call TaskUpdate. No exceptions.

| Trigger | Session File Action | TaskUpdate |
|---------|-------------------|------------|
| Issue registered | Write to SESSION.md Section 1 | TaskCreate |
| Investigation started | Status → INVESTIGATING in FIX-XXX.md header | activeForm: "Investigating FIX-XXX" |
| Subagent completes | Append to FIX-XXX.md Section 2 | (none — too granular) |
| Root cause confirmed | Status → DIAGNOSED in FIX-XXX.md header | activeForm: "Diagnosed FIX-XXX" |
| Fix strategy decided | Write to FIX-XXX.md Section 3 | activeForm: "Fixing FIX-XXX" |
| Fix committed | Update SESSION.md Section 1 + FIX-XXX.md Section 3 | activeForm: "FIX-XXX fixed, verifying" |
| Verification run | Append to FIX-XXX.md Section 4 | (none — too granular) |
| Final status set | Update SESSION.md Section 1 + FIX-XXX.md Section 4 + FIX-XXX.md header | status: completed (if VERIFIED) |
| Issue deferred/blocked | FIX-XXX.md header Status → DEFERRED/BLOCKED + fill Sections 3-4 stub | status: completed |
| Session complete | SESSION.md Executive Summary | (none) |

**Header Status**: The `> **Status**: X` line in each FIX-XXX.md header MUST stay current. Update it at EVERY transition — it is the primary indicator read after compaction. Stale headers cause incorrect resumption.

**Batching**: Adjacent triggers in the same phase step may batch into one Edit. Never leave a phase boundary without checkpointing all pending updates.

**After compaction**: Read SESSION.md (~100 lines) → read current FIX-XXX.md (~150 lines) → check git status/log for drift → reconcile → call TaskList to reconnect with existing todos and resume DUAL-TRACK updates → resume. Do NOT read prior FIX files — only SESSION.md + current FIX-XXX.md (see Between-Issue Context Hygiene). Total recovery: ~250 lines (fixed) regardless of issue count.

## PHASE 0: Initialize Session

### 0.0 Enable Auto-Continue (optional)

If the `ralph-loop` skill is available, activate it to survive platform turn-limit interruptions:

```
Skill tool: ralph-loop:ralph-loop
Args: "Continue the fix-issues session. Read SESSION.md to find current state and resume." --completion-promise "FIX-SESSION COMPLETE" --max-iterations 5
```

This makes the Stop hook re-feed the prompt if the platform cuts the turn mid-pipeline. The agent will read SESSION.md (compaction recovery protocol) and resume from the current issue. Skip this step if ralph-loop is not installed.

### 0.1 Create Session Directory

```bash
SKILL_HOME=~/.claude/skills/fix-issues/project-setup
mkdir -p docs/fix-sessions
SESSION_DIR="docs/fix-sessions/$(date +%Y-%m-%d_%H-%M)"
mkdir -p "$SESSION_DIR"
cp "$SKILL_HOME/templates/SESSION.md" "$SESSION_DIR/SESSION.md"
sed -i '' "s/\[WILL BE AUTO-UPDATED\]/$(date '+%Y-%m-%dT%H:%M:%S')/" "$SESSION_DIR/SESSION.md"
echo "Session directory: $SESSION_DIR"
```

After creating:
- Update `**Session Dir**` header with actual path
- Update `**Current Issue**` to `-`
- If NOT audit-import: delete Section 6 (Audit Sync Log)
- Verify gate-check hook: The PostToolUse hook auto-runs gate validation when you write GATE markers to FIX-XXX.md files.
  Verify the hook is registered: check `.claude/settings.local.json` or `.claude/settings.json` has `gate-check-hook` in PostToolUse.
  Diagnostic log: `/tmp/gate-hook-diag.log` — check if hook fires silently.
  **Fallback**: If hooks don't produce visible output, run gate checks manually:
  `node ~/.claude/skills/fix-issues/project-setup/scripts/check-fix-gate.cjs <session-dir> <gate-num> <FIX-ID>`

### 0.2 Register Issues

```
For each issue:
  1. Assign sequential ID (FIX-001, FIX-002, ...)
  2. Write initial description, set status to QUEUED
  3. Add to Issue Registry in SESSION.md (Section 1)
  4. TaskCreate({ subject: "FIX-XXX: [description]", activeForm: "Queued: FIX-XXX" })
  5. Issue files (FIX-XXX.md) are created ON DEMAND when the issue enters Phase 1
CHECKPOINT: Update Executive Summary "Total issues registered" count in SESSION.md.
```

For audit import: Read [import-protocol.md](fix-issues/import-protocol.md).

After all issues registered, check for inter-issue dependencies: see [import-protocol.md](fix-issues/import-protocol.md) Section 0.4.

### 0.3 Scope Assessment

Before Phase 1, classify each issue:

```
Single-file, single-function (UI color, typo, selector)?
  → LIGHT: 1 subagent, fast diagnosis
Multi-file, cross-component (state flow, shared logic)?
  → STANDARD: 3 subagents, full diagnosis
Cross-layer (frontend + backend), timing, execution?
  → DEEP: All subagents + deploy + integration tests

Unclear? → Start LIGHT. Upgrade if investigation reveals wider impact.
Scope can only UPGRADE, never downgrade.
```

Record scope in FIX-XXX.md when the issue file is created in Phase 1.

---

## PHASE 1: Investigate (Per Issue)

**Goal**: Understand the problem deeply before touching any code.

Before starting: Create FIX-XXX.md from template:
```bash
cp "$SKILL_HOME/templates/FIX_ISSUE.md" "$SESSION_DIR/FIX-XXX.md"
# Replace XXX with actual issue number, fill in description/source/scope
```
Update session header `**Current Issue**` in SESSION.md to `FIX-XXX`.
**CHECKPOINT: Set status to INVESTIGATING** in SESSION.md Issue Registry.

Write findings incrementally — after each subagent or major finding, CHECKPOINT Section 2 immediately.

### 1.1 Dispatch Investigation Subagents

For tool commands, see [toolbox.md](fix-issues/toolbox.md).

```
SUBAGENT_CODEBASE_EXPLORER (all scopes):
  Task: Find all code related to the issue — files, functions, data flow
  Output: List of relevant files with line numbers and their roles

SUBAGENT_CONTEXT_READER (STANDARD+ only):
  Task: Read CLAUDE.md files, design docs, existing tests, business rules
  Output: Business rules list, test coverage status, design constraints

SUBAGENT_HISTORY_ANALYZER (STANDARD+ only):
  Task: Check git history for impacted files — regressions, related fixes
  Output: Timeline of changes, potential regression commit
```

**CHECKPOINT: After each subagent returns**, update Section 2.

### 1.2 Consolidate + Hypothesis

Merge findings, write hypothesis to Section 2.6. Status remains INVESTIGATING.

### 1.3 Reproduce the Bug

LIGHT: reproduction optional if root cause confirmed by code analysis (document skip reason).
STANDARD/DEEP: reproduction mandatory. Use Playwright (frontend) or clasp (backend).

**CHECKPOINT**: Record reproduction result in Section 2.7.

**Imported from audit?** Check freshness — if audit is current AND thorough, skip to Phase 2 with audit hypothesis. If stale/thin, run LIGHT investigation. See [import-protocol.md](fix-issues/import-protocol.md).

---

## PHASE 2: Diagnose (Per Issue)

**Goal**: Confirm hypothesis using live tools. Be autonomous — use everything available.

**Entry**: Issue status should be INVESTIGATING.

### 2.1 Diagnostic Toolbox

Use live tools based on issue type. **Actively prefer live tools over code reading.**

LIGHT: diagnostic tooling optional if root cause already confirmed (document skip reason).
STANDARD/DEEP: mandatory. For tool commands, see [toolbox.md](fix-issues/toolbox.md).

**CHECKPOINT: After EACH diagnostic run**, append to Section 2.7.

### 2.2 Diagnosis Decision Tree

```
Hypothesis confirmed?
├─ Yes → CHECKPOINT: Set status to DIAGNOSED. Proceed to GATE 1.
├─ Partially → Refine hypothesis, run more diagnostics (max 3 loops)
└─ No → Reformulate hypothesis (max 3 loops)
    └─ Exhausted → ESCALATE: set BLOCKED, present evidence to human,
       continue other QUEUED issues while waiting
```

### 2.3 Update Session File

CHECKPOINT: Update Section 2 with confirmed root cause, Section 1 Root Cause column. Set status to DIAGNOSED.

### 2.4 Pre-Fix Validation

Before writing code, validate the fix strategy with fresh subagents.

LIGHT: 1 validator subagent. STANDARD: 2 subagents. DEEP: 4 subagents.
For subagent prompt templates, see [validation-templates.md](fix-issues/validation-templates.md).

CHECKPOINT: Write results to Section 2.8 "Pre-Fix Validation".
If CONCERNS → adjust strategy, CHECKPOINT updated strategy to Section 2.6.

---

## GATE 1: Investigation → Fix

**Step 1**: Write `GATE 1 PASSED` to FIX-XXX.md Section 2 for this issue.

**Step 2**: Run the gate-check script via Bash. This is MANDATORY — hook output alone is NOT sufficient.
```
node ~/.claude/skills/fix-issues/project-setup/scripts/check-fix-gate.cjs <session-dir> 1 <FIX-ID>
```
**If FAIL** → fix every failing check, re-run until PASS.
**If PASS** → proceed to Phase 3.

---

## LIGHT Scope — What Changes, What Doesn't

LIGHT CHANGES (fewer subagents):
- Phase 1: Only SUBAGENT_CODEBASE_EXPLORER (skip CONTEXT_READER + HISTORY_ANALYZER)
- Phase 1.3: Reproduction optional (document skip reason)
- Phase 2.1: Diagnostic tooling optional (document skip reason)
- Phase 2.4: 1 validator subagent instead of 2-4
- Phase 3.3 Step C: SKIP code quality review

LIGHT DOES NOT CHANGE (still mandatory):
- FIX-XXX.md Sections 2, 3, 4 MUST be populated; SESSION.md Section 5 MUST be populated
- Phase 3.3 Step A: Implementer subagent MUST be dispatched
- Phase 3.3 Step B: Spec compliance review MUST run
- Phase 4: Tests MUST run OR visual verification documented
- GATE 1, GATE 2, GATE 3 are MANDATORY for all scopes
- Regression test MUST exist (or documented visual verification for cosmetic fixes)

## PHASE 3: Fix (Per Issue)

**Goal**: Apply the minimal correct fix. Never over-engineer.

### 3.1 Business Rule Impact Check

Before writing code, check Section 2.2 (Business Rules):

```
□ Does this fix change any existing behavior? → If YES, identify what changes
□ Does the change conflict with a documented business rule? → If YES, STOP (see below)
□ Does the fix affect other features? → If YES, list and verify
□ Is this a regression fix? → If YES, simpler — restore the intent
□ Is the documented rule itself the bug? → If YES, prepare decision package

WHAT COUNTS AS BEHAVIOR CHANGE:
  YES (ASK): User-visible output changes, timing/threshold changes, default values
  NO (AUTONOMOUS): Regression fix, restoring documented value, error messages, logging, tests
```

If conflict found → prepare decision package: current state, problem, options A/B, recommendation. Set status to AWAITING_DECISION. Continue other issues while waiting.

### 3.2 Implementer Constraints

These rules are passed to the implementer subagent:

1. Minimal fix — change only what's necessary
2. Follow existing patterns — match surrounding code style
3. Never add features while fixing bugs
4. Never refactor while fixing (unless refactor IS the fix)
5. Add regression test (MANDATORY — absolute rule #6)
6. Commit after each logical fix (use git conventions)
7. NEVER push to remote
8. If git commit fails (pre-commit hook), fix issue, re-stage, NEW commit
9. If fix changes a value in CLAUDE.md, update CLAUDE.md in same commit
10. One commit per issue — never bundle multiple FIX issues in a single commit, even in LIGHT batches
11. Never instruct subagents to pipe test output through `tail`/`head`/`grep` — use file redirect + Grep tool pattern from Phase 4.1

### 3.3 Implement the Fix

**Step A — Dispatch implementer subagent:**

Invoke: Task tool, subagent_type=general-purpose
Description: "Fix FIX-XXX: [brief description]"
Prompt: Include ALL of: fix strategy from Section 3 + root cause from Section 2.6 +
  affected files from Section 2.1 + implementer constraints from 3.2 +
  pre-fix validation concerns from Section 2.8

The implementer MUST: apply changes, write regression test, run tests, commit, report back.
Do NOT edit files yourself. The subagent implements, tests, and commits.

CHECKPOINT: After implementer reports → update Section 3 with files changed + tests added + **"Implementer: Dispatched subagent..."** line (GATE 2 checks for dispatch evidence). Status → FIXING.

**Step B — Dispatch spec compliance reviewer (SEPARATE subagent, NOT self-assessed):**

Invoke: Task tool, subagent_type=general-purpose
Description: "Review spec compliance for FIX-XXX"
Prompt: Include fix strategy + implementer's report + "Check: regression test added? Root cause fixed (not symptom)? Business rules followed?"

Output: ✅ Spec compliant OR ❌ Issues found with file:line references
If ❌ → resume implementer. Max 2 cycles. Writing "Verified" yourself is NOT Step B.

**Step C — Code quality review (STANDARD+ only):**

Invoke: Skill tool, skill="superpowers:requesting-code-review"

Get BASE_SHA (before fix) and HEAD_SHA (after fix).
Dispatch superpowers:code-reviewer subagent with BASE_SHA, HEAD_SHA, fix description.
Act on feedback: Critical/Important → implementer fixes. Minor → note in Section 3. Max 2 cycles.

LIGHT scope: Document skip in Section 3: "Code quality review skipped (LIGHT scope)."

### 3.4 Update Session File

CHECKPOINT after implementation + review:
1. Section 3: files changed, tests added, spec review result, code review result, commit hash
2. Section 1: Fix Commit column
3. Status → FIXED
4. TaskUpdate({ activeForm: "FIX-XXX fixed, verifying" })

---

## GATE 2: Fix → Verify

**Step 1**: Write `GATE 2 PASSED` to FIX-XXX.md Section 3 for this issue.

**Step 2**: Run the gate-check script via Bash. This is MANDATORY — hook output alone is NOT sufficient.
```
node ~/.claude/skills/fix-issues/project-setup/scripts/check-fix-gate.cjs <session-dir> 2 <FIX-ID>
```
**If FAIL** → fix every failing check, re-run until PASS.
**If PASS** → proceed to Phase 4.

---

## PROVE IT WORKS (MANDATORY)

Code reading is hypothesis, not proof. Every fix needs EXTERNAL EVIDENCE.

| Evidence Type | Strength | When to Use |
|---------------|----------|-------------|
| Integration test pass | Strongest | Backend logic changes |
| E2E test pass | Strong | UI behavior changes |
| Playwright screenshot | Strong | Visual/cosmetic changes |
| Unit test pass | Good | Isolated logic changes |
| GCP log / clasp output | Good | Runtime verification |
| Code reading alone | INSUFFICIENT | Never sufficient as sole proof |

NEVER SAY: "I can see from the code that this works" / "The logic is correct"
ALWAYS SAY: "Tests pass: [command] → [result]" / "Screenshot confirms: [what]"

## PHASE 4: Verify (Per Issue)

**Goal**: PROVE the fix works with external evidence.

**Entry**: Issue status should be FIXED.

### 4.1 Verification Checklist

```
MANDATORY:
  □ Unit tests pass for changed files
  □ E2E tests pass for affected flows
  □ New regression test covers the bug scenario
  □ Integration tests pass (if backend change)

OUTPUT RULE (applies to ALL test runs, including batches and late-session):
  □ NEVER pipe test commands through tail/head/grep
  □ Redirect output to file, then use Grep tool to check results:
    Bash: npx vitest run --reporter verbose 2>&1 > /tmp/claude/vitest-output.txt
    Grep: pattern="FAIL|Error|✗" path="/tmp/claude/vitest-output.txt"
    Grep: pattern="Tests.*passed|Test Files" path="/tmp/claude/vitest-output.txt"
  □ This applies even when "just checking if tests pass" — tail hides failures

CONDITIONAL:
  □ If UI change: Playwright screenshot BEFORE and AFTER
  □ If NOT a UI change but gate-check flags it: add `**UI Change**: No` to Section 2
    (keywords like "cosmetic", "visual", "UI" in investigation text trigger false positives)
  □ If backend: clasp run verification on DEV (deploy first)
  □ If cross-cutting: full E2E + integration test
  □ If transient/race: run test suite twice — both must pass

For verification commands, see [toolbox.md](fix-issues/toolbox.md).
```

### 4.2 Verification Results

All pass → VERIFIED. Partial → PARTIALLY_VERIFIED. Fail → loop Phase 3 (max 3). Infrastructure → BLOCKED.

### 4.3 Cross-Issue Regression + Next Issue

Re-run tests from ALL previously VERIFIED issues. Regression → add FIX-XXX. Check if current fix resolved next QUEUED issue.

### 4.4 Update Session File

CHECKPOINT: Section 4 (commands + results + final status), Section 1 (status + Root Cause/Fix Commit), Executive Summary counts. IF IMPORTED: Bidirectional Update Protocol — see [import-protocol.md](fix-issues/import-protocol.md).

---

## GATE 3: Verify → VERIFIED

**Step 1**: Write verification results to FIX-XXX.md Section 4 (commands, results, final status). Write `GATE 3 PASSED` as the last line.

**Step 2**: Run the gate-check script via Bash. This is MANDATORY — writing the marker (Step 1) without running the script (Step 2) is a pipeline violation.
```
node ~/.claude/skills/fix-issues/project-setup/scripts/check-fix-gate.cjs <session-dir> 3 <FIX-ID>
```
**If FAIL** → fix every failing check, re-run until PASS.
**If PASS** → continue to Step 3.

**For batched issues**: Run the script SEPARATELY for EACH issue in the batch. One batch-wide test run does not substitute for per-issue gate checks. Example for a 3-issue batch:
```
node ~/.claude/skills/fix-issues/project-setup/scripts/check-fix-gate.cjs <session-dir> 3 FIX-001
node ~/.claude/skills/fix-issues/project-setup/scripts/check-fix-gate.cjs <session-dir> 3 FIX-002
node ~/.claude/skills/fix-issues/project-setup/scripts/check-fix-gate.cjs <session-dir> 3 FIX-003
```

**Step 3**: Update FIX-XXX.md header `> **Status**: VERIFIED`

**Step 4**: Update SESSION.md — issue row status → VERIFIED, Executive Summary counts, Current Issue → next QUEUED issue.

**Step 5**: Apply context hygiene (see Between-Issue Context Hygiene section), then start Phase 1 for the next QUEUED issue. If no QUEUED issues remain, proceed to Phase 5 wrap-up.

### Script Says FAIL — What You MUST Do

The gate-check script is non-negotiable. If it says FAIL:
1. Read EVERY failing check in the output
2. Fix EACH one by updating the session file or adding missing artifacts
3. Re-run the script until it says PASS
4. Do NOT proceed to the next phase while any gate shows FAIL

**You cannot rationalize past a FAIL.** "The script is wrong" is not a valid reason to skip — if you believe a check is incorrect, fix the session file to make the check pass, not the other way around.

### Deferring or Blocking an Issue

When an issue cannot be completed (infrastructure dependency, out-of-scope, needs human decision):

1. **Header**: Update `> **Status**: DEFERRED` or `> **Status**: BLOCKED` in FIX-XXX.md
2. **Section 3 (Fix Applied)**: Write `DEFERRED — [reason]` or `BLOCKED — [reason]` (e.g., "DEFERRED — requires backend API change outside add-on scope")
3. **Section 4 (Verification)**: Write `N/A — issue deferred` or `N/A — issue blocked`
4. **SESSION.md**: Update issue row status and Executive Summary counts
5. **Move on**: Start next QUEUED issue (Phase 1). Do NOT wait for user input.

Do NOT leave Sections 3-4 empty — empty sections cause gate-check failures on future resumption and make session state ambiguous after context compaction.

---

## Between-Issue Context Hygiene

After completing a DEEP or STANDARD issue — or after context compaction — your context window carries investigation details, code snippets, and subagent outputs that are now redundant — all persisted to FIX files and SESSION.md.

**Rules for starting the next issue:**
1. Re-read SESSION.md registry (root causes, affected files) to spot cross-issue overlaps with the next issue
2. If the next issue touches files modified by a prior fix, re-read that FIX file's Section 2.1 (Affected Files) and Section 3 (Fix Applied)
3. Do NOT re-read prior FIX files "just in case" — only when the registry shows a file overlap
4. Do NOT reference prior issue investigation details in subsequent messages — if you need them, read the file

**Why this matters**: Carrying stale context wastes tokens, accelerates compaction, and increases the chance of compaction hitting mid-investigation on the next issue. The files are your memory, not the context window.

---

## PHASE 5: Wrap Up (After All Issues)

If ALL issues are BLOCKED/AWAITING_DECISION → present consolidated status, wait for human.

Otherwise:

### 5.0 Final Review (MANDATORY)

Per-issue gates verify individual correctness. This step verifies the **full set of changes works together** and makes sense for the project. It is a senior-level review, not a mechanical diff check.

**Step A — Build the review context**:

Get the combined diff of all fix commits against the session baseline:
```bash
git diff <first-fix-commit>~1..HEAD --stat
git diff <first-fix-commit>~1..HEAD
```

**Step B — Dispatch reviewer subagent**:

Agent tool, subagent_type=general-purpose
Description: "Final review: validate all session fixes for correctness, conflicts, and project impact"
Prompt must include: the full commit list (SESSION.md Section 5), the combined diff stat, and the issue registry (Section 1). Instruct:

```
You are reviewing the COMPLETE set of fixes from a bug-fixing session.
Read each commit diff with `git show <hash>`. Then evaluate:

PER-ISSUE VALIDATION (for each FIX):
1. Does the fix actually solve the stated problem? Read the root cause
   and the diff — does the code change address that root cause, or just
   mask the symptom?
2. Is the fix minimal and complete? Any missing edge cases, missing
   cleanup (e.g., timers not cleared on unmount, listeners not removed),
   or unnecessary additions?
3. Are changes in the right commit? Flag any code that belongs to a
   different FIX issue (misplaced during batch processing).

CROSS-ISSUE ANALYSIS:
4. Do any fixes conflict with each other? (e.g., two fixes changing the
   same component behavior in contradictory ways, competing state updates,
   overlapping CSS selectors)
5. Do the fixes create unintended interactions? (e.g., fix A adds a
   debounce that breaks fix B's immediate state update assumption)
6. Are there shared files modified by multiple fixes? Read the final
   state of those files — does the combined result make sense?

PROJECT IMPACT:
7. Do these fixes change any documented behavior or business rules?
   Check against CLAUDE.md and any referenced design docs.
8. Are there performance implications? (new timers, new queries,
   new event listeners multiplied across components)
9. Could any fix cause regressions in areas NOT covered by the
   regression tests added? What would you test manually?

Report:
- For each issue: PASS or ISSUE with description + suggested fix
- Cross-issue: CLEAN or CONFLICT with description
- Project impact: NONE or CONCERN with description
```

**Step C — Act on findings**:

| Finding | Action |
|---------|--------|
| PASS / CLEAN / NONE | Note "Final review: CLEAN" in SESSION.md Section 7 |
| ISSUE (code quality) | Fix with additional commit, update Section 5 + 7 |
| CONFLICT (cross-issue) | Resolve the conflict, test both fixes together |
| CONCERN (project impact) | Document in Section 7 as recommendation for human review |

### 5.1 Finalize Session

```
CHECKPOINT (final):
  1. Update Executive Summary (all metric counts)
  2. Overall Status → "Complete" (or "Partial — N deferred/blocked")
  3. Current Issue → "-"
  4. SESSION.md Section 5 (Commits Made): all commits with hash, message, files
  5. SESSION.md Section 7 (Recommendations): any systemic issues found + final review results
  6. Check Sign-off boxes
  7. Merge FIX files into SESSION.md (see Section 5.2 below)
  8. Stage the ENTIRE session directory: `git add <session-dir>/` (captures both updated SESSION.md AND deleted FIX files)
  9. Final commit (single SESSION.md, no FIX-XXX.md files)
  10. Output: <promise>FIX-SESSION COMPLETE</promise> (signals Ralph Loop to stop, if active)
```

### 5.2 Merge FIX Files into SESSION.md

After sign-off, merge all FIX-XXX.md content into SESSION.md for archival. This reduces the session from N+1 files to 1 file with zero data loss.

```bash
node ~/.claude/skills/fix-issues/project-setup/scripts/merge-fix-session.cjs <session-dir>
```

The script:
- Reads all FIX-XXX.md files in order
- Appends them as an "Issue Details" section in SESSION.md (headings demoted)
- Removes the individual FIX files

Options: `--dry-run` (preview), `--keep` (don't delete FIX files)

**IMPORTANT**: Run this AFTER all gates pass and sign-off is complete. During the session, FIX files must remain separate (gate-check reads them individually).

---

## Start Command

1. Create session directory from template
2. Register issues (from user input or test-audit import)
3. Pick first QUEUED issue → Scope → Phase 1 → 2 → GATE 1 → 3 → GATE 2 → 4 → GATE 3
4. Pick next QUEUED issue → repeat step 3
5. Phase 5: Final Review (audit all commits holistically) → Finalize → Merge → Commit

**SEQUENTIAL PIPELINE**: Process ONE issue through ALL phases before touching the next.
Do NOT investigate multiple issues before fixing any — "investigate all, then fix all" is PROHIBITED.
Current issue must reach VERIFIED, DEFERRED, or BLOCKED before starting the next.

### LIGHT Batching
LIGHT-scope issues may be processed in batches of up to 3:
- Stage-by-stage: investigate all in batch → GATE 1 each → fix all → GATE 2 each → verify all → GATE 3 each.
- Never skip stages: investigating and fixing in one pass is still prohibited.
- Max 3 per batch: split larger groups. The gate-check script enforces this.
- STANDARD/DEEP: always sequential (no batching).
- Processing order: STANDARD/DEEP first (sequential), then LIGHT in batches.
- Write `GATE N PASSED [batch]` (not plain `GATE N PASSED`) for batched issues so the hook validates batch rules.
- Mixing LIGHT with STANDARD/DEEP in a batch is a pipeline violation.
- **Commits must be serialized**: after all batch implementers return, commit each issue's changes ONE AT A TIME. If two issues modify the same file, stage only that issue's specific changes per commit. Never let parallel subagent edits produce a shared commit.

**Read each phase section for instructions. Do NOT improvise from this summary.**

BEGIN EXECUTION

---

## Critical Reminders

1. **CHECKPOINT EVERY STATUS CHANGE** — session file + TaskUpdate at every transition
2. **INVESTIGATE FIRST** — never fix without understanding
3. **PROVE IT WORKS** — external evidence, not code reading. Screenshots for UI changes.
4. **PRESERVE INTENT** — never change what a feature does, only fix HOW
5. **MINIMAL CHANGES** — fix the bug, nothing more. NEVER PUSH.
6. **RE-READ AFTER COMPACTION** — SESSION.md + current FIX-XXX.md are your memory, trust only the files
7. **DISPATCH SUBAGENTS** — Phase 3 Steps A+B+C use Task tool. Do NOT edit files yourself.
8. **READ TEST OUTPUT** — use Read tool, never `tail`/`head`/`grep` on test commands. Truncated output hides failures.
9. **PASS THE GATES** — all 3 gates mandatory. GATE 1/2: hook auto-validates on Edit. GATE 3: run check-fix-gate.cjs via Bash for EACH issue (mandatory). FAIL = fix before proceeding.
