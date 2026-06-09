# Layer 3 Subagent C — Sister-instances & related issues

## Variables

- `{{CLAIM_ID}}`, `{{CLAIM_FILE}}`, `{{CLAIM_LINE}}`, `{{CLAIM_BODY}}`,
  `{{LAYER_2_NOTES}}`, `{{REPO_ROOT}}`
- `{{NEGATIVE_LIST}}` — already-fixed or already-deferred sister-instances (so we don't re-flag them)

## Prompt

You are hunting for structurally similar issues to a code-review claim. Your
job is to find the FAMILY of issues, not just the cited site.

**Claim:**
```
{{CLAIM_BODY}}
```

**Cited site:** {{REPO_ROOT}}/{{CLAIM_FILE}}:{{CLAIM_LINE}}

**Layer 2 notes (use as context, do not re-investigate what Layer 2 confirmed safe):**
{{LAYER_2_NOTES}}

**Already addressed (do NOT re-flag):**
{{NEGATIVE_LIST}}

## Your job

If the claim is "X happens when Y", find every place where Y could happen
across the codebase and check if X happens there too.

### Steps

1. Identify the abstract pattern from the cited site:
   - What's the operation? (function call / pattern of useEffect / store action
     dispatch / API endpoint / etc.)
   - What's the bad consequence? (state mutation / missing error handling /
     unconditional side effect / etc.)
   - What's the trigger? (user gesture / system observation / async resolution /
     mount / unmount / etc.)

2. Search broadly:
   - Find every caller of the affected function/action via `grep -rn`
   - Find every site with the same useEffect dependency shape
   - Find structurally similar useEffects across the source tree

3. For each sister-site found:
   - Cite `file:line`
   - Quote the relevant 5-10 lines
   - State whether it has the bad consequence (yes / no / partial / uncertain)
   - State if it's a CLEAN_SPLIT (same pattern, fix identically) or MIXED
     (touches user-editable fields, needs nuanced handling)

4. Cross-check {{NEGATIVE_LIST}}:
   - If a candidate is in the negative list, skip it (already addressed).
   - If a candidate is NOT in the negative list and shows the bad pattern,
     report it.

### Output format

```
SISTERS_FOUND: <count>

[For each sister-site:]

### Sister 1 — {{REPO_ROOT}}/<file>:<line>

PATTERN_MATCH: full | partial | uncertain
SPLIT_TYPE: clean_split | mixed | uncertain
CODE_EXCERPT:
```
<5-10 lines>
```
ASSESSMENT: <2-3 sentences on whether it's affected by the same bad consequence>

### Sister 2 — ...

(continue for all sisters)

---

NEGATIVE_LIST_COVERAGE:
- <each negative-list site checked + confirmed not re-flagged>

RECOMMENDED_OMNIBUS:
- IF clean_split sisters > 0: bundle all clean_splits with the original claim
  into one omnibus fix
- IF mixed sisters: flag for separate scope decision
- IF no sisters: original claim stands alone
```

If you find ZERO sisters, output `SISTERS_FOUND: 0` and explain what you
searched for + why nothing matched.
