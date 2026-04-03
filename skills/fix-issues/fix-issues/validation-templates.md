# fix-issues Validation Templates — Pre-Fix Subagent Prompts

> **Referenced from**: `SKILL.md`
> **When to read**: During Phase 2.4 (Pre-Fix Validation) when dispatching validation subagents. The main skill tells you WHAT to dispatch; this file has the detailed prompt templates.

**IMPORTANT**: Do NOT give subagents specific things to check (e.g., "check for 5K rows",
"check the 6-min limit"). That creates anchoring bias — they'll check YOUR list and stop.
Instead, give them the root cause and fix strategy, and tell them to DISCOVER what matters.
The subagent must read the actual code, docs, and constraints for the affected area and
identify concerns from first principles.

```
LIGHT SCOPE — Dispatch 1 subagent:

SUBAGENT_QUICK_VALIDATOR:
  Input: Root cause (Section 2.6), proposed fix strategy, affected file (Section 2.1)
  Task: "Review this root cause and proposed fix. Read the affected file and its
    callers. Answer: Does this fix address the root cause or just a symptom?
    Is there anything else that consumes this function/value that would break?
    Why didn't existing tests catch this — is there a test gap to fill?"
  Output: GO / CONCERNS with brief explanation

CHECKPOINT: Write result to Section 2 "Pre-Fix Validation".
If CONCERNS → adjust strategy, CHECKPOINT updated strategy to Section 2.6.
```

```
STANDARD SCOPE — Dispatch these subagents in parallel:

SUBAGENT_FIX_VALIDATOR:
  Input: Root cause (Section 2.6), proposed fix strategy, affected files (Section 2.1)
  Task: "You are reviewing a proposed fix BEFORE implementation. Read the root cause,
    the proposed strategy, and ALL affected files. Then answer these questions — but
    do your own investigation, don't assume you know the answers:
    1. Does this fix address the root cause, or just the symptom?
    2. Trace the data flow with the fix applied — what EXACTLY changes in behavior?
    3. Find all callers and consumers of the changed code — will any break?
    4. Read the CLAUDE.md and design docs for this area — is there intended behavior
       we might be overlooking? Could this 'bug' be intentional?
    5. WHY didn't existing tests catch this? Find the test files, read them, and
       identify the specific gap.
    6. Is there logging in this code path for future debugging?"
  Output: Validation report with GO / CONCERNS / BLOCK recommendation

SUBAGENT_SCOPE_CHECKER:
  Input: Proposed fix strategy, all files from Section 2.1
  Task: "Check if this fix is appropriately scoped. Search the codebase for:
    1. Other callers of the function being fixed — do they need the same treatment?
    2. Similar patterns elsewhere that might have the same bug.
    3. Is the fix too narrow (misses cases) or too broad (over-engineers)?
    Report what you FIND, not what you assume."
  Output: Scope validation with MINIMAL / ADEQUATE / EXPAND recommendation

CHECKPOINT: Write validation results to Section 2 under a "Pre-Fix Validation"
sub-heading. Record any concerns or scope adjustments.

If CONCERNS raised:
  → Adjust fix strategy before proceeding to Phase 3
  → CHECKPOINT: Update Section 2.6 with adjusted strategy

If BLOCK raised:
  → Treat as a diagnosis issue — may need to revisit root cause
  → Loop back to Phase 2.1 (counts against the 3-loop limit)
```

```
DEEP SCOPE — All of the above PLUS these additional subagents:

SUBAGENT_EDGE_CASE_ANALYZER:
  Input: Root cause, fix strategy, affected data types and flows
  Task: "Investigate edge cases and cross-feature impact for this fix. Do NOT rely
    on a generic checklist — read the actual code being changed and discover what
    boundary conditions, data variations, and feature interactions are relevant.
    Consider: What are the extreme inputs this code handles? What other features
    share state or data with this code path? Could concurrent execution cause
    problems? Report what you DISCOVER, with evidence from the code."
  Output: Edge case report with specific risks found (or clean bill)

SUBAGENT_SAFETY_REVIEWER:
  Input: Fix strategy, affected files, execution context
  Task: "Review this fix for safety and operational concerns. Read the affected code
    and its runtime environment. Investigate — don't assume:
    - What security boundaries does this code cross? (user input, external data, etc.)
    - What platform limits and quotas apply to this code path? (Read the docs/CLAUDE.md)
    - What are the memory and performance characteristics? Could the fix degrade them?
    - Will existing saved data (automations, configs) still work after this change?
    Report concrete findings with file:line references, not theoretical concerns."
  Output: Safety report with specific findings (or clean bill)

CHECKPOINT: Write all validation results to Section 2 "Pre-Fix Validation".
```
