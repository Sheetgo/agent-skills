# code-review skill — full-flow worked example

## Scenario context

Sheetgo Automations release branch, mid-cycle (v2.6.19c-2 → v2.6.19d
amend window). Mixed-fix branch with 16 lifecycle commits. Open PR #12
on master. GitHub Codex has been review-cycling for ~3 hours (5 cycles
to date, each cycle surfacing 1-2 new findings). Local Codex pre-flight
is being introduced as the structural fix for unbounded review cycles.

This is the case the skill was designed for.

## Walking the v2.6.19d `useFileTrashedProbe.ts:81` finding through the pipeline

The `useFileTrashedProbe` hook writes a "trashed" flag to the source store
via the unconditional `updateStep` action. The action sets the wizard
`dirty` flag. As a result, a probe — which is system-observed, not
user-edited — was incorrectly marking the wizard dirty.

Codex flagged this on the v2.6.19c-2 review pass as P2.

## Layer 1 — Parallel claim-finding

Both reviewers run in parallel against the same diff scope (origin/master..HEAD).

### (a) Codex CLI output (excerpt)

```
- [P2] Avoid marking wizard dirty on probe-only flag updates — /Users/willvargas/Development/Sheetgo/as-add-on/client/src/lib/validation/useFileTrashedProbe.ts:81
  This hook writes the trashed flag via store action, but the action
  unconditionally sets dirty in the store. As a result, simply opening
  a wizard step where a file is trashed can trigger an unsaved-changes UX.
  Suggested approach: gate the dirty flag on whether the write is from
  a user gesture vs system observation, OR use a probe-only action variant.
```

### (b) code-reviewer subagent (general-purpose) output (excerpt)

```
- [P2] Probe write triggers spurious dirty flag — /Users/willvargas/Development/Sheetgo/as-add-on/client/src/lib/validation/useFileTrashedProbe.ts:81
  The probe is observation-only, but the store action it calls is
  user-edit-shaped. Same pattern likely exists in other probe hooks —
  recommend cross-file pattern audit before fix.
- [P2] Sister pattern — probe-marks-dirty in parallel hooks — /Users/willvargas/Development/Sheetgo/as-add-on/client/src/lib/validation/useFileSizeProbe.ts:58
  Similar shape, different probe.
```

The reviewer subagent surfaced one sister-site at the diff stage. Codex
caught the cited site only.

### Aggregation

Two distinct claims, neither overlapping by file:line. Tag attributions:
- claim-001 (useFileTrashedProbe.ts:81): both
- claim-002 (useFileSizeProbe.ts:58): reviewer-only

Security fast-path detector returned `hasSecurityRelevance: false`.

## Layer 2 — Self-check (main thread)

For claim-001:
1. Read cited code: `useFileTrashedProbe.ts:81`. Confirms the hook calls
   `updateStep` with the new flag value. Real.
2. Mental trace: store action `updateStep` sets `state.dirty = true`
   unconditionally. The probe runs on hook mount with no user gesture.
3. `git blame` on line 81: introduced 2026-04-22 in commit `58e1158`
   (current branch). Touched recently.
4. Quick business-rule scan: grep `docs/deferred-items.md` for "probe-marks-dirty"
   — no documented deferral. Grep CLAUDE.md for the pattern — no
   intentional-design note.

Triage verdict: **CONFIRMED**. Forward to Layer 3.

For claim-002 (the reviewer-only sister): also CONFIRMED via same
verification. Forward to Layer 3 with attribution `reviewer-only` (only
single-signal cross-validation).

## Layer 3 — Subagent panel (parallel, 3 perspectives)

Three subagents dispatched in parallel for claim-001. Same 3-fold panel
runs for claim-002.

### Subagent A — Accuracy & business-rule

```
VERDICT: REAL_BUG

REASONING:
The probe is system-observed; the action is user-edit-shaped. The asymmetry
is genuine and reachable on every wizard mount where a file is trashed.
The dirty flag controls unsaved-changes UI; spurious dirty creates a
false-positive "you have unsaved changes" prompt.

EVIDENCE:
- File: client/src/lib/validation/useFileTrashedProbe.ts:81
  Code excerpt: `updateStep(stepId, { trashedFile: file })`
- Git blame: commit 58e1158 by Willian Vargas on 2026-04-22:
  "feat: Stepper touched-processors fix"
- Documentation references found: none
- Reproduction check: reachable on mount when file is trashed

CITATIONS:
- client/src/lib/validation/useFileTrashedProbe.ts:75-90 (probe write site)
- client/src/lib/store/wizardStore.ts:142-158 (updateStep action body)
- client/src/lib/store/types.ts:201 (WizardState.dirty type)
```

### Subagent B — Severity & impact

```
INDEPENDENT_SEVERITY: P2
STAMPED_SEVERITY: P2
AGREEMENT: match

IMPACT:
- Failure mode: spurious unsaved-changes UX
- Frequency: every wizard mount where a file is trashed (~10% of edit sessions)
- User scope: all editing users
- Recovery cost: minor confusion; no data loss
- Net user impact: medium

AGE:
- Introduced in PR commits: yes
- Last modified: 58e1158 "feat: Stepper touched-processors fix" (2026-04-22)
- Out-of-family from current PR scope: no — directly within the stepper-touched-processors scope

REASONING:
P2 is correct. In-family. Severity stands.
```

### Subagent C — Sister-instances

~~~
SISTERS_FOUND: 13

### Sister 1 — /Users/willvargas/Development/Sheetgo/as-add-on/client/src/lib/validation/useFileSizeProbe.ts:58
PATTERN_MATCH: full
SPLIT_TYPE: clean_split
CODE_EXCERPT:
```
useEffect(() => {
  if (file && file.size > MAX_SIZE) {
    updateStep(stepId, { sizeWarning: true });
  }
}, [file, stepId, updateStep]);
```
ASSESSMENT: Same pattern. Probe writes via updateStep, marks dirty.

### Sister 2 — /Users/willvargas/Development/Sheetgo/as-add-on/client/src/lib/validation/useFilePermissionsProbe.ts:42
PATTERN_MATCH: full
SPLIT_TYPE: clean_split
CODE_EXCERPT:
```
useEffect(() => {
  checkPermissions(file).then((result) => {
    updateStep(stepId, { permissionsWarning: result.warning });
  });
}, [file, stepId, updateStep]);
```
ASSESSMENT: Same pattern.

(11 more clean_split sister-sites, all using updateStep for probe-only writes)

NEGATIVE_LIST_COVERAGE: empty (no prior deferrals on this pattern family)

RECOMMENDED_OMNIBUS:
13 clean_splits — bundle all into one omnibus fix using updateStepProbeOnly
action variant.
~~~

### Panel reconciliation

- All three subagents CONFIRMED real for claim-001.
- Subagent A: REAL_BUG. Proceed.
- Subagent B: in-family, P2. Severity stands.
- Subagent C: 13 sister-instances, all clean_split. Add to surviving claim list.

Surviving claim list grows from 2 to 14 (the original two + 12 new sister-sites
not in the original Layer 1 output).

## Layer 4 — Live test

Test method per claim type: state-management → component test.

A new component test mounts each affected hook with a trigger condition
(file trashed for useFileTrashedProbe, etc.) and asserts the wizard
`dirty` flag is NOT set after the probe runs.

Verdict per claim:
- All 14 claims: REPRODUCED via component test (tests fail before fix).

Test count: 4 new regression tests added covering the canonical probe sites.
Existing 2118 tests still pass.

## Aggregate verdict

**FIX FIRST** — 14 REPRODUCED claims, all severity P2, all in-family.

The `omnibus-and-defer` playbook: bundle all 13 clean_splits with the
original claim into one omnibus fix that introduces a new
`updateStepProbeOnly` action variant. Thread the variant through all
14 canonical probe-flag write sites. One commit covers the whole family.

After the omnibus fix lands:
- Re-run Layer 1.
- Codex returns clean. Reviewer subagent returns clean.
- Verdict: PUSH READY.

The skill writes the marker file `.git/code-review-passed-<sha>` for the
hook to consume.

> Note: PUSH READY clears the code-review gate only. The finishing gate
> (`hooks/session-checkpoint.py`) additionally requires executed validation
> evidence — record it with `record-validation.cjs` after the Layer-4 live
> test (see the "Recording validation evidence" note in `../SKILL.md`).

## Outcome

This is exactly what happened in the v2.6.19c-2 → v2.6.19d cycle. The
key win: the `omnibus-and-defer` playbook ended a 5-cycle Codex-cascade
that would otherwise have produced 13+ separate per-finding push cycles.
The skill operationalizes the cycle-stop heuristic from the consuming
project's CLAUDE.md (as documented in the v2.6.19d session memory).

The original Codex finding plus the 13 sister-instances landed as Apps
Script version 492, published via GWM SDK on 2026-05-07. PR #12 closed
with 14 of 17 lifecycle threads resolved (3 minimized after omnibus).
The 2 deferred items (`api-files.ts:725` P1 source/destination error code
+ `useSourcesEmptyCheck.ts:41` P2 named-range gap) are documented in
`docs/deferred-items.md` per the DEFER + DOCUMENT verdict track this skill
formalizes.
