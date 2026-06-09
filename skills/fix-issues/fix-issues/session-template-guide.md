# fix-issues Session Template Guide

> **Referenced from**: `SKILL.md`
> **When to read**: When you need checkpoint timing details, compaction recovery steps, or session file section format reference.

## Checkpoint Triggers (detailed)

```
CHECKPOINT TRIGGERS (each one = immediate Edit to session file + TaskUpdate):

  1. Issue registered         → Write to Section 1 (Issue Registry)
                              → TaskCreate({ subject: "FIX-XXX: [description]", activeForm: "Queued" })
  2. Investigation started    → Update status to INVESTIGATING in Sections 1 + 2
                              → TaskUpdate({ status: in_progress, activeForm: "Investigating FIX-XXX" })
  3. Each subagent completes  → Append findings to Section 2 (incrementally)
                              → (no TaskUpdate — too granular)
  4. Hypothesis formed        → Write to Section 2.6
                              → (no TaskUpdate — covered by phase boundary)
  5. Diagnostic tool run      → Append result to Section 2.7
                              → (no TaskUpdate — too granular)
  6. Root cause confirmed     → Update status to DIAGNOSED in Sections 1 + 2
                              → TaskUpdate({ activeForm: "Diagnosed FIX-XXX, preparing fix" })
  7. Fix strategy decided     → Write to Section 3
                              → TaskUpdate({ activeForm: "Fixing FIX-XXX" })
  8. Fix applied + committed  → Update Sections 1 + 3 with commit hash
                              → TaskUpdate({ activeForm: "FIX-XXX fixed, verifying" })
  9. Each verification run    → Append to Section 4 with command + result
                              → (no TaskUpdate — too granular)
  10. Final status set        → Update Section 1 status + Section 4 final status
                              → TaskUpdate({ status: completed }) if VERIFIED
                              → TaskUpdate({ activeForm: "FIX-XXX: [status reason]" }) otherwise
  11. Moving to next issue    → Update Current Issue header
                              → (no TaskUpdate — next issue's task gets updated)
  12. Session complete        → Update Executive Summary + Overall Status
                              → (no TaskUpdate — all tasks already completed/blocked)

  BLOCKED/AWAITING_DECISION:
    → TaskUpdate({ activeForm: "FIX-XXX blocked: [reason]" })
    On unblock: → TaskUpdate({ activeForm: "Resuming FIX-XXX" })

EXECUTIVE SUMMARY TIMING:
  Update counts at phase boundaries, not at every micro-transition:
    - "Issues investigated" → increment after Phase 1 completes (hypothesis formed)
    - "Issues diagnosed"    → increment after Phase 2 completes (status = DIAGNOSED)
    - "Issues fixed & verified" → increment after Phase 4 completes (status = VERIFIED)
    - All other counts      → update at session wrap-up (Phase 5)
  This avoids noisy intermediate edits while keeping the summary reasonably current.
```

## Checkpoint Format

Each checkpoint is an Edit tool call that updates the specific section. Keep updates
surgical — update only the relevant cells/rows, don't rewrite entire sections.

**Batching**: Adjacent triggers that fire within the same phase step (e.g., hypothesis
formed + status set to DIAGNOSED) may be batched into a single Edit for efficiency.
The rule is: never leave a phase boundary without having checkpointed all pending updates.

**Dual tracking**: Every checkpoint that changes issue status in the session file MUST
also call TaskUpdate. The session file is authoritative (survives compaction); TaskUpdate
is the real-time UI layer. Both must agree at every phase boundary.

## Compaction Recovery Protocol

**CRITICAL:** After any context compaction event, your FIRST action MUST be:

```
COMPACTION RECOVERY (automatic, every time):

  STEP 1 — READ THE FILE (authoritative state):
    1. Read the session file header (first 50 lines)
    2. Read the Issue Registry (Section 1)
    3. Identify Current Issue from header
    4. Read the current issue's Section 2/3/4 blocks

  STEP 1.5 — CHECK TASK STATE:
    4.5 Run TaskList → compare task statuses with session file Issue Registry
    4.6 If any task status lags behind session file status:
        → TaskUpdate to match session file (session file is authoritative)
    4.7 If any task exists that isn't in the session file:
        → Investigate — may be from a pre-compaction registration

  STEP 2 — CHECK FOR DRIFT (work done but not yet checkpointed):
    5. Run git status → uncommitted changes suggest a fix was applied but
       not committed or checkpointed
    6. Run git log --oneline -10 → commits not listed in Section 5 (Commits Made)
       suggest a fix was committed but the session file wasn't updated
    7. Check your compressed context for any findings, results, or conclusions
       that are NOT yet reflected in the session file sections you just read

  STEP 3 — RECONCILE (flush pending state to file):
    8. If drift detected (git has work the file doesn't reflect):
       → CHECKPOINT NOW: write the missing information to the session file
         before resuming any other work
       → Update status if evidence shows the issue progressed further than
         the file indicates (e.g., file says INVESTIGATING but git log shows
         a fix commit → update to FIXED)
    9. If compressed context has findings not in the file:
       → CHECKPOINT NOW: write those findings to the appropriate section
       → This is the "leftover pending update" — flush it immediately

  STEP 4 — RESUME:
    10. Determine resume point from the NOW-UPDATED status:
        - QUEUED → start Phase 1
        - INVESTIGATING → read Section 2, resume where findings end
        - DIAGNOSED → start Phase 3
        - FIXING → check git log for commit, if found → Phase 4
        - FIXED → start Phase 4
        - VERIFIED → move to next QUEUED issue
        - BLOCKED/AWAITING_DECISION → check for human response
    11. Resume from determined point — DO NOT restart from scratch
```

**Key principle:** The session file is the source of truth for status and milestones,
but it may lag behind reality if compaction interrupted a checkpoint. The compressed
context and git state are EVIDENCE that helps you catch up the file. After reconciliation,
the file is again authoritative and work continues from there.

## Session File Sections Reference

The session file (`docs/fix-sessions/YYYY-MM-DD_HH-MM.md`) is created from
`~/.claude/skills/fix-issues/project-setup/templates/SESSION.md`. Here's what each section contains:

| Section | Purpose | When Updated |
|---------|---------|--------------|
| Header | Session metadata, current issue | Phase 0, every issue transition |
| Executive Summary | Metric counts | Phase boundaries (see timing rules above) |
| 1. Issue Registry | Status tracking table | Every status change |
| 2. Investigation & Diagnosis | Per-issue findings, hypothesis, diagnostics | Phase 1-2 |
| 2.8 Pre-Fix Validation | Validation subagent results | Phase 2.4 |
| 3. Fixes Applied | Files changed, tests added, commit hash | Phase 3 |
| 4. Verification Results | Test commands + results, final status | Phase 4 |
| 5. Commits Made | All commit hashes and messages | Phase 3 (incremental), Phase 5 (final) |
| 6. Audit Sync Log | Import mapping + write-back log | Only for audit-import sessions |
| 7. Recommendations | Follow-up findings | Phase 4 (pre-existing failures), Phase 5 |
| Sign-off | Completion checklist | Phase 5 |
