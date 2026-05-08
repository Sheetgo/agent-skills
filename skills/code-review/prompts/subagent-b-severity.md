# Layer 3 Subagent B — Severity & impact

## Variables

- `{{CLAIM_ID}}`, `{{CLAIM_FILE}}`, `{{CLAIM_LINE}}`, `{{CLAIM_BODY}}`,
  `{{LAYER_2_NOTES}}`, `{{REPO_ROOT}}`
- `{{CODEX_STAMPED_SEVERITY}}` — severity tag from the original reviewer (P1/P2/P3)
- `{{DIFF_BASE}}` — git ref for the diff base

## Prompt

You are independently assessing severity and impact for a code-review claim.

**IMPORTANT:** Do NOT look at `{{CODEX_STAMPED_SEVERITY}}` until AFTER you've
formed your own independent assessment. Bias is real.

**Claim:**
```
{{CLAIM_BODY}}
```

**Cited location:** {{REPO_ROOT}}/{{CLAIM_FILE}}:{{CLAIM_LINE}}

## Steps

### Step 1 (independent — do NOT peek at stamped severity)

Read the claim and the code. Ask:
- What's the failure mode? (silent corruption / visible error / data loss / UX glitch)
- How often does the affected code path execute? (once per session / per page load /
  per user gesture / per minute / always)
- How many users could hit it? (everyone / specific role / specific config / edge case)
- What's the recovery cost? (auto-recovers / requires reload / requires re-auth /
  requires support contact / requires data restore)

Stamp severity:
- **P1** — incorrect output, data loss, security issue, breaks documented invariant,
  blocks core flow for >10% of users
- **P2** — incorrect behavior in non-fatal path, regression of fixed bug,
  contract violation, blocks edge-case flow
- **P3** — code quality, readability, minor performance, no user-visible impact

### Step 2 (compare with stamp)

Now look at `{{CODEX_STAMPED_SEVERITY}}`. Does it match yours?

- **Match:** confirm.
- **Disagreement:** explain. Codex tends to overstate (P1 for what's actually P2)
  on speculative failure modes; tends to understate (P3 for what's actually P2)
  on subtle business-rule violations.

### Step 3 (timing/age)

Run:
```bash
git log {{DIFF_BASE}}..HEAD -- {{CLAIM_FILE}}
```

Was the cited code introduced in this PR's commits, or pre-existing on master?

- **Introduced this PR:** finding is in-scope; severity stands.
- **Pre-existing on master:** finding may be out-of-family; consider DEFER.
  Cite when last modified (`git log -1 --format='%ci %s' -- {{CLAIM_FILE}}`).

### Output format

```
INDEPENDENT_SEVERITY: P1 | P2 | P3
STAMPED_SEVERITY: {{CODEX_STAMPED_SEVERITY}}
AGREEMENT: match | overstated_by_stamp | understated_by_stamp

IMPACT:
- Failure mode: <brief>
- Frequency: <brief>
- User scope: <brief>
- Recovery cost: <brief>
- Net user impact: low | medium | high | severe

AGE:
- Introduced in PR commits: yes | no
- Last modified: <commit SHA + subject + date>
- Out-of-family from current PR scope: yes | no | unclear

REASONING:
<2-4 sentences justifying severity and impact assessment>
```
