---
name: code-review
description: Use before pushing a branch, opening a PR, updating an existing PR, or merging. Use when GitHub Codex review cycles feel unbounded, when AI-flagged findings include false positives, when the team is finding adjacent-file issues each push, or when a chunk of work feels finished and you're about to ask whether to push.
---

# code-review skill

## Overview

A 4-layer pre-merge verification pipeline. Replaces the push-and-wait-for-
GitHub-Codex feedback loop with local validation that surfaces real issues
before they cost a review cycle. Each layer either confirms the path is clean
or feeds the next layer with verified claims.

**Core principle:** AI reviewer findings are CLAIMS to be verified, not
verdicts to be implemented. Codex is short-sighted, can be lazy, and misses
business-rule context. Verify before acting.

## When to use

- Before `git push` on a branch with substantive changes (not docs-only)
- Before `gh pr create` or significant `gh pr edit` updates
- Before merging a PR (especially release branches → master)
- Before `npm run release:prod` (or equivalent release-cut command)
- When a chunk of work feels finished and the user is about to ask "push?"
- When GitHub Codex has flagged findings on a recent push and you need to
  decide ship-or-fix-first

## When NOT to use

- During mid-implementation iterations (use after the work is finished)
- For docs-only changes (use a marker file or commit-message convention to skip)
- For experimental WIP branches with no intent to merge
- During an active fix-cycle where you're already responding to specific Codex
  findings (use `/fix-issues` instead)

## Layer 1 — Parallel claim-finding

Two reviewers run in parallel against the same diff scope.

### (a) Codex CLI

Run:
```bash
~/.claude/skills/code-review/scripts/run-codex.sh /tmp/codex-out.txt
```
The wrapper auto-detects the diff base (PR base if open, else `origin/master`).

### (b) `superpowers:code-reviewer` subagent

Dispatch via Agent tool with the prompt at
`~/.claude/skills/code-review/prompts/code-reviewer.md`. Same diff scope.

**After the subagent returns**, save its full response to
`/tmp/reviewer-out.txt` (e.g., via `Write` tool) so the parser in the
Aggregation step can read it. The Codex side handles this automatically
via `run-codex.sh`; the reviewer side requires explicit file write because
subagent responses come back to the main thread, not to a file.

**Run BOTH in parallel** (single message with two Agent tool calls).

### Aggregation

Parse outputs:
```bash
node ~/.claude/skills/code-review/scripts/parse-claims.cjs /tmp/codex-out.txt --source codex > /tmp/claims-codex.json
node ~/.claude/skills/code-review/scripts/parse-claims.cjs /tmp/reviewer-out.txt --source reviewer > /tmp/claims-reviewer.json
```

Deduplicate by `file:line`. Tag each claim with attribution: `codex` / `reviewer` / `both`.

### Security fast-path advisory

Run:
```bash
~/.claude/skills/code-review/scripts/detect-security-relevant.sh <base> HEAD
```

If `hasSecurityRelevance: true`, surface advisory: "Security-relevant diff
detected. Consider running /security-review in parallel before final verdict."

### Failure modes

- **Codex unavailable** (run-codex.sh exits 1 quota-hit): continue with
  reviewer-only. Tag claims as `codex-skipped`.
- **Both unavailable**: exit early with verdict `MANUAL REVIEW NEEDED`:
  "Layer 1 unavailable, manual review required before push."
- **One returns claims, the other returns clean**: still proceed (single-signal
  OK; lacks cross-validation).

### Exit short-circuit: BOTH CLEAN

If both reviewers return zero claims:
- Output: **PUSH READY** with one-line summary.
- Skip Layers 2-4. No subagents dispatched.
- Write marker `.git/code-review-passed-<sha>` for the hook to consume:
  ```bash
  touch "$(git rev-parse --git-dir)/code-review-passed-$(git rev-parse HEAD)"
  ```
  The marker filename embeds the HEAD SHA at time of approval. The
  per-project hook (see `project-setup/git-push-gate-hook.sh` and `SETUP.md`)
  reads HEAD and checks for a matching marker; if HEAD has moved since
  approval, the marker is stale and the gate blocks until the skill is
  re-run on the new HEAD.
- Done.

The same marker write applies to **PUSH READY** verdicts produced after
Layers 2–4 have run (e.g., all surviving claims dropped at L2/L3 or hit
NOT_REPRODUCIBLE / OUT_OF_SCOPE / INTENTIONAL at L4). Always write the
marker on PUSH READY, regardless of which layer produced the verdict.

## If claims found

Layer 1 produced one or more claims. Continue with Layers 2-4.

## Layer 2 — Self-check (main thread)

For EACH claim, do this in the main thread BEFORE dispatching subagents:

### Verification steps per claim

1. **Read the cited code** — open `<file>:<line>` mentioned in the claim. Does
   the code actually look like what the claim describes?
2. **Reproduce mentally** — trace data flow / control flow. Does the issue
   exist as described, or hallucinated?
3. **Session-recency check** — `git blame <file>` on the line. Was this
   introduced in current branch's commits, or pre-existing on master?
4. **Quick business-rule scan** — `grep` for related comments, CLAUDE.md
   notes, `docs/deferred-items.md` entries. Is the "issue" actually documented
   as deliberate?

### Triage verdict per claim

- **CONFIRMED** — verified, proceed to Layer 3
- **FALSE-POSITIVE** — hallucinated or refers to non-existent code. Drop. No
  subagents.
- **INTENTIONAL** — real behavior, but documented as deliberate (with cite).
  Drop with citation.
- **UNCERTAIN** — can't tell from main-thread reading. Forward to Layer 3 with
  uncertainty flagged.

## Layer 3 — Subagent panel (3 perspectives, parallel)

For each CONFIRMED + UNCERTAIN claim, dispatch 3 subagents IN PARALLEL (single
message, three Agent tool calls). Each gets:
- The full claim body
- The Layer 2 notes
- The prompt template from `~/.claude/skills/code-review/prompts/`

### Subagent A — Accuracy & business-rule

Prompt: `prompts/subagent-a-accuracy.md`. Outputs: `REAL_BUG | INTENTIONAL | NOT_REPRODUCIBLE`.

### Subagent B — Severity & impact

Prompt: `prompts/subagent-b-severity.md`. Outputs: independent severity +
agreement with stamped severity + age + out-of-family flag.

### Subagent C — Sister-instances

Prompt: `prompts/subagent-c-sisters.md`. Outputs: list of structurally similar
issues elsewhere. Includes negative-list of already-addressed sites.

### Panel reconciliation (main thread, mechanical)

- All three CONFIRM real → claim survives to Layer 4.
- Subagent A says NOT_REPRODUCIBLE / INTENTIONAL → drop with citation, attach panel report.
- Subagent C found sister-instances → add them to the surviving claim list (so the omnibus covers the family, not just the cited site).
- Subagent B disagrees on severity → record both, take the higher one for downstream gating.
- Subagent B says out-of-family + age=pre-existing → mark claim for DEFER + DOCUMENT verdict track.

## Layer 4 — Live test

For each claim that survived Layer 3, dispatch a live test that proves the
issue exists (or doesn't) in actual runtime, not just in code reading.

### Test selection by claim type

| Claim type | Test method | Notes |
|---|---|---|
| Frontend / UI / wizard flow | Playwright E2E | Use project's mock infrastructure (`window.__mockConfig` or equivalent). One scenario per claim. |
| Backend / Apps Script | `clasp run <function>` against DEV with simulated trigger | Or smoke harness in `dist/` after `npm run build` |
| State management (Zustand / Redux / Pinia) | Component test mounting affected component with trigger state | Faster than Playwright when bug is fully reproducible at component-level |
| Pure logic / utilities | Unit test isolating function with trigger inputs | |
| Type-only / docs / deferred | **Skip Layer 4.** Document why (e.g., "type-only change, tsc covers it") | |

### Verdict per claim

- **REPRODUCED** — live test demonstrates the bug. Real, must address before push (or explicitly defer with rationale).
- **NOT_REPRODUCIBLE** — live test fails to surface the bug. Either the claim is wrong, or the test doesn't cover the trigger condition. Record both possibilities. Main thread decides defer or investigate further.
- **OUT_OF_SCOPE** — test method genuinely can't run (needs production data, external service mocking we don't have). Document and treat as needing manual review.

## Aggregate verdict

After all surviving claims have a Layer 4 verdict, the skill produces ONE
recommendation:

| Recommendation | Trigger condition |
|---|---|
| **PUSH READY** | All claims dropped at L1/L2/L3, OR all surviving claims hit NOT_REPRODUCIBLE / OUT_OF_SCOPE / INTENTIONAL |
| **FIX FIRST** | At least one claim REPRODUCED with severity ≥ P2 |
| **DEFER + DOCUMENT** | Claim REPRODUCED but explicitly out-of-family (Subagent B flagged out_of_family + age=pre-existing). Drafts deferred-items entry (+ thread reply + commit message if PR-wired). |
| **MANUAL REVIEW NEEDED** | Layer 1 incomplete (BOTH reviewers unavailable) OR many OUT_OF_SCOPE claims |

### FIX FIRST — fix-issues hand-off

When verdict is FIX FIRST:

1. Write surviving claim list to `docs/code-review-runs/<timestamp>-<branch>.md`
   with this structure (matches fix-issues issue-registry input shape):

~~~markdown
# code-review run: <branch> @ <commit-sha>
Date: YYYY-MM-DD HH:MM
Verdict: FIX FIRST

## Claims requiring fix

### FIX-001
**File:** path/to/file.ts:123
**Severity:** P2 (independent assessment) / P2 (Codex stamped)
**Source:** found by codex + reviewer (cross-validated)
**Body:** <claim body>
**Layer 3 panel:**
- Accuracy: REAL_BUG (with citations)
- Severity & impact: <summary>
- Sister-instances: <count>; clean_splits at: <file:line list>
**Layer 4 verdict:** REPRODUCED via Playwright E2E `client/e2e/<scenario>.spec.cjs`
**Suggested approach:** <1-3 sentences>

### FIX-002
...
~~~

2. In the console summary, surface a one-line invocation:
   ```
   FIX FIRST verdict — N claims to address.
   Run: /fix-issues with claim list at docs/code-review-runs/<file>.md
   ```

3. Do NOT auto-invoke `/fix-issues`. The user retains the choice between
   fix-now, fix-in-follow-up-PR, rollback, or escalate.

### DEFER + DOCUMENT — draft-not-decide artifacts

When verdict is DEFER + DOCUMENT, the skill drafts artifacts the human posts.

**Detect PR context:**
```bash
gh pr view <branch> --json baseRefName,number 2>/dev/null
```

If a PR is open AND there's an unresolved Codex thread on the affected
file:line, query for the thread:
```bash
gh api graphql -f query='{ repository(owner: "X", name: "Y") { pullRequest(number: N) { reviewThreads(first: 50) { nodes { id isResolved comments(first: 1) { nodes { path line body } } } } } } }' \
  --jq '.data.repository.pullRequest.reviewThreads.nodes[] | select(.isResolved==false and .comments.nodes[0].path=="<claim file>" and .comments.nodes[0].line==<claim line>)'
```

**Drafts produced** (location: `docs/code-review-runs/<run>/drafts/`):

| Always | Conditional on PR + thread |
|---|---|
| `deferred-items-entry.md` | `codex-reply.md` |
| | `deferral-commit-message.md` |

**`deferred-items-entry.md` template** (uses the format from
`docs/deferred-items.md` of the consuming project):

~~~markdown
### <CLAIM_SUMMARY>

**Priority:** <SEVERITY> (per Codex)
**Parked:** <YYYY-MM-DD>
**Context:** <CLAIM_BODY paraphrased to 2-3 sentences>

**Why deferred:** <Subagent B's out-of-family rationale>

**Scope notes:**
- <from Subagent A's accuracy report>
- <from Subagent C's sister-instances if any>

**Acceptance criteria when revisited:**
- <derived from claim>

**Cross-reference:** Codex thread `<thread-id>` on PR #<N>.

**Decision:** Deferred — <rationale>
~~~

**`codex-reply.md` template** (1-3 sentences with commit SHA placeholder):

~~~markdown
Acknowledged and deferred to next release per `<COMMIT_SHA>` (deferred-items entry).
<Subagent B's out-of-family rationale, 1 sentence>. Will be addressed in <next release / fresh-session audit>.
~~~

**`deferral-commit-message.md` template:**

~~~
docs: Defer Codex <SEVERITY> (<CLAIM_FILE>:<LINE> <one-line>)

Codex flagged on PR #<N> review of <REVIEW_COMMIT>. Out-of-family from this
PR's scope — <rationale from Subagent B>.

Deferred per user direction:
- <bullet from Subagent C if relevant>
- Will be bundled with next release / planned audit

Codex thread: <thread-id>
~~~

The skill **never**:
- Decides to defer (the user approves the verdict)
- Auto-commits the deferred-items entry (the user stages and commits)
- Auto-posts on GitHub (the user posts, resolves threads, minimizes reviews)

The console output includes the apply-to-disk commands:
```
DEFER + DOCUMENT verdict — N claims deferred. Drafts ready at:
  docs/code-review-runs/<run>/drafts/

To apply:
  cat docs/code-review-runs/<run>/drafts/deferred-items-entry.md >> docs/deferred-items.md
  git add docs/deferred-items.md
  git commit -F docs/code-review-runs/<run>/drafts/deferral-commit-message.md
  # then post the codex-reply.md text on the PR thread + resolve + minimize
```

## Red flags — STOP, do not push if you catch yourself thinking these

| Rationalization | Reality |
|---|---|
| "GitHub Codex will catch anything we miss" | Codex is lazy (1-2 findings per pass). Each push = a new review cycle = 5-10 min round trip. Run code-review locally before push to catch what GitHub Codex would catch, faster. |
| "Tests pass, that's enough" | Tests pass is necessary but not sufficient. Ask whether the CHANGED path has test coverage, not just whether the suite is green. The changed lines you just wrote may have zero coverage even when the suite is 100% green. |
| "Code review is what GitHub does" | GitHub Codex review is reactive (after push). code-review is proactive (before push). The point is to NOT spend a Codex cycle if local tools can find it. |
| "We can fix issues in follow-up PRs" | Each follow-up PR = another Codex round = compounding cycle time. The omnibus-and-defer playbook this skill produces is faster. |
| "User said ship by 6pm, just ship" | Time pressure does NOT exempt verification. The skill produces a structured-defer playbook for genuine out-of-family findings, so "ship anyway" is fast and correct, not skip-the-review. P1 findings keep their risk profile regardless of clock. |
| "The comment says it's intentional" | Verify the comment claim. Run `git blame` on the comment to see when it was added. Read the asymmetry logic yourself. Don't trust comments at face value — they go stale. |
| "Codex only flagged this one site, just fix this one" | Codex is short-sighted. The skill's Layer 3 Subagent C explicitly hunts sister-instances. Fix-the-family, not fix-the-site. When fixing any Codex finding, always grep for the same pattern across the module/codebase before pushing. |
| "GitHub will give us a second pass anyway" | A GitHub Codex round-trip costs 7-10 min plus reply/resolve/minimize churn. In production releases it costs an additional Apps-Script-version-bump and a partner-publish. Local pre-flight is cheaper than a post-push finding cycle. |

## Common mistakes (Layer 1 scope)

- **Running Codex with `--uncommitted` instead of `--base`** — only sees
  working-tree diff, misses prior commits. Use the wrapper script.
- **Dispatching reviewer-subagent with a wrong scope** — must match Codex's
  scope. Both review the same diff or the cross-check is meaningless.
- **Acting on first reviewer's findings before the second returns** — wait for
  both to finish, deduplicate, then proceed.
- **Treating "tests pass" as the gate** — see red-flags table above. Pre-push
  checklist:
  1. Did Layer 1 (a) and (b) both return cleanly OR have all claims been
     verified through Layer 2-4?
  2. Did you grep for sister-instances of any flagged pattern?
  3. Did you check whether the changed path has test coverage?
  4. Have you considered the cost of a GitHub Codex round-trip if a finding
     surfaces post-push?

## Cross-references

**RELATED:**
- `superpowers:requesting-code-review` — adjacent skill for requesting a code review pass (post-work gate). Different scope: that is the manual review-request flow, while this skill is a 4-layer pre-merge automation. They compose: this skill's FIX FIRST verdict can hand off to that skill.
- After this skill recommends FIX FIRST, use `fix-issues` to address surviving claims.
- For new feature design (not bug verification), use `plan-hardening` + `writing-plans` instead — this skill is pre-merge gate, not pre-design gate.
- Adjacent to `implementation-audit` (validates implementation against a plan); this skill validates findings against actual behavior.
- For security-specific deep review, compose with `/security-review` when the security fast-path advisory fires.
