# Layer 3 Subagent A — Accuracy & business-rule check

## Variables (filled at dispatch time)

- `{{CLAIM_ID}}` — claim identifier
- `{{CLAIM_FILE}}` — file path (relative to repo)
- `{{CLAIM_LINE}}` — line number
- `{{CLAIM_BODY}}` — full claim text from Layer 1
- `{{LAYER_2_NOTES}}` — main-thread self-check findings (CONFIRMED / UNCERTAIN)
- `{{REPO_ROOT}}` — absolute path to repo

## Prompt to dispatch

You are checking a code-review claim for accuracy and business-rule context.

**Claim:**
```
{{CLAIM_BODY}}
```

**Cited location:** {{REPO_ROOT}}/{{CLAIM_FILE}}:{{CLAIM_LINE}}

**Layer 2 (self-check) notes:** {{LAYER_2_NOTES}}

## Your job

Determine if the claim represents a REAL bug, INTENTIONAL design, or a NOT_REPRODUCIBLE
hallucination. Be rigorous — Codex stamps confidence it doesn't always have.

### Steps

1. Read {{CLAIM_FILE}} in full (not just around line {{CLAIM_LINE}}). Get full
   context: imports, class structure, surrounding logic.
2. Run `git log -p {{CLAIM_FILE}}` and look at when the cited code was last
   modified. If recent (this PR's commits), it's a NEW potential bug. If old,
   it's pre-existing.
3. Run `git blame {{CLAIM_FILE}}` and inspect the line. Read the responsible commit's full message.
4. Search the repo for documented context:
   - `grep -rn "{{CLAIM_FILE}}" CLAUDE.md docs/ --include="*.md"` — any docs reference this code's design?
   - `grep -B 5 -A 5 "<key terms from claim>" docs/deferred-items.md` — already deferred?
   - Look for inline comments above the cited line explaining the pattern.
5. Verify the failure mode is reproducible:
   - Read the claim's stated trigger condition. Does the code path actually reach that condition? Trace it.
   - If the failure requires specific runtime state, can it actually occur? (e.g., "race between X and Y" — can X and Y actually be concurrent?)
6. Check for documented business-rule asymmetries (e.g., the SAVE_ONLY-flag pattern in stripFrontendFlags — load preserves while save strips).

### Output format

Use this exact format:

```
VERDICT: REAL_BUG | INTENTIONAL | NOT_REPRODUCIBLE

REASONING:
<2-4 sentences>

EVIDENCE:
- File path + line + key code excerpt
- Git blame: commit <SHA> by <author> on <date>: "<commit subject>"
- Documentation references found (or "none")
- Reproduction check: <reachable | unreachable | uncertain>

CITATIONS:
- {{CLAIM_FILE}}:<line range>
- <other files referenced>
- <documents grepped>
```

If VERDICT is INTENTIONAL, the EVIDENCE must include a quoted comment block,
docstring, or doc-reference that establishes the design intent. Do not stamp
INTENTIONAL based on inference; stamp it on documented intent.

If VERDICT is REAL_BUG, the EVIDENCE must include a reachable code path
demonstrating the failure mode.

If VERDICT is NOT_REPRODUCIBLE, the EVIDENCE must explain why the trigger
condition can't actually occur in the code path described.
