---
name: code-review
description: Use before pushing a branch, opening a PR, updating an existing PR, or merging. Use when GitHub Codex review cycles feel unbounded, when AI-flagged findings include false positives, when the team is finding adjacent-file issues each push, or when a chunk of work feels finished and you're about to ask whether to push.
---

# code-review skill

## Overview

> **This is a Skill, not an agent.** Invoke it with the Skill tool (or `/code-review`)
> — never as an Agent-tool `subagent_type`. There is no agent named `code-review` or
> `code-reviewer`. The reviewers this skill dispatches are plain `general-purpose`
> Agent-tool invocations driven by the bundled prompt files in `prompts/`.

A 4-layer pre-merge verification pipeline. Replaces the push-and-wait-for-
GitHub-Codex feedback loop with local validation that surfaces real issues
before they cost a review cycle. Each layer either confirms the path is clean
or feeds the next layer with verified claims.

**Core principle:** AI reviewer findings are CLAIMS to be verified, not
verdicts to be implemented. AI reviewers are short-sighted, can be lazy, and
miss business-rule context (the Codex CLI included). Verify before acting.

**Two different "Codex"es — don't conflate them:**
- **Codex CLI** — a *local* reviewer this skill *runs* as Layer 1(a) (`run-codex.sh`). One of two parallel Layer-1 reviewers; optional (falls back to the reviewer subagent alone if absent).
- **GitHub Codex** — the *remote* PR-review bot this skill exists to *pre-empt*. It is **not a component** of this skill; where this doc names it, that's the slow post-push loop the skill makes unnecessary — motivation, not mechanism.

This skill's scope is the **local 4-layer review** only. Throughout: "Codex CLI" = the local Layer-1 reviewer; "GitHub Codex" = the remote bot (context, never a step).

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
- During an active fix-cycle where you're already responding to specific review
  findings (use `/fix-issues` instead)

## Layer 1 — Parallel claim-finding

Two reviewers run in parallel against the same diff scope.

### (a) Codex CLI

Run:
```bash
~/.claude/skills/code-review/scripts/run-codex.sh /tmp/codex-out.txt
```
The wrapper auto-detects the diff base (PR base if open, else the remote's default branch — `origin/HEAD`, falling back to `origin/main` then `origin/master`).

### (b) code-reviewer subagent

Dispatch via the Agent tool with **`subagent_type: general-purpose`**, passing the
prompt at `~/.claude/skills/code-review/prompts/code-reviewer.md`. There is **no**
dedicated agent type for this — `code-reviewer` / `superpowers:code-reviewer` are NOT
registered agents; the reviewer role lives entirely in that prompt file, which a
`general-purpose` agent executes. Same diff scope.
Substitute the prompt's `{{VARIABLE}}` placeholders (`{{DIFF_BASE}}`, `{{DIFF_HEAD}}`,
`{{REPO_ROOT}}`, `{{BRANCH}}` — see its Variables section) with actual values before dispatch.

**After the subagent returns**, save its full response to
`/tmp/reviewer-out.txt` (e.g., via `Write` tool) so the parser in the
Aggregation step can read it. The Codex side handles this automatically
via `run-codex.sh`; the reviewer side requires explicit file write because
subagent responses come back to the main thread, not to a file. (The "Codex
side" = the Codex CLI from Layer 1(a).)

**Run BOTH in parallel** — a single message containing the Layer 1(a) Bash call
(`run-codex.sh`) and the Layer 1(b) Agent call (`subagent_type: general-purpose`).

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

- **Codex CLI unavailable** (run-codex.sh exits non-zero — not installed, not
  authenticated, or quota-hit): continue with reviewer-only. Tag claims as `codex-skipped`.
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
  touch "$(git rev-parse --git-common-dir)/code-review-passed-$(git rev-parse HEAD)"
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

For each CONFIRMED + UNCERTAIN claim, dispatch 3 subagents IN PARALLEL via the Agent
tool (single message, three calls, each `subagent_type: general-purpose`). Each gets:
- The full claim body
- The Layer 2 notes
- The prompt template from `~/.claude/skills/code-review/prompts/`, with every
  `{{VARIABLE}}` placeholder (see each prompt's Variables section) substituted
  with its actual value before dispatch — never pass raw `{{…}}` template text.

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

### Recording validation evidence (for the finishing gate)

The finishing gate (`hooks/session-checkpoint.py`) requires a
`validation-passed-<sha>` marker separate from the code-review marker — because
the BOTH-CLEAN short-circuit skips Layer 4, a PUSH READY alone does **not** prove
the change was exercised. When you run a Layer-4 live test (or the change's real
validation more broadly), stamp the evidence so finishing is unblocked.

Point the recorder at the artifacts you actually produced — a Playwright
screenshot, a captured test log — **wherever your tooling wrote them** (relative
to the repo root, or absolute):

```bash
npm run test:e2e -- login.spec.ts | tee /tmp/e2e.log     # produce evidence
node ~/.claude/skills/code-review/scripts/record-validation.cjs <<'JSON'
{ "changeClass": "ui",
  "checks": [ { "kind": "playwright", "command": "npm run test:e2e -- login.spec.ts",
               "exitCode": 0, "artifacts": ["test-results/login.png", "/tmp/e2e.log"] } ] }
JSON
```

**Where the evidence goes.** The recorder **copies** each artifact into the
repo's git dir — `<git-common-dir>/validation-evidence/<sha>/` — and records the
stored names. **Your working tree is never touched.** That's deliberate: this
gate is installed globally and runs against every repo you work in, so evidence
must never be `git add`-able, committable, or pushable in any of them — and no
per-repo `.gitignore` entry is required. (It's also shared across linked
worktrees, since the common-dir is.) Stored evidence is pruned automatically when
its marker goes stale.

The recorder validates with the **same `gate-lib.cjs` rules the checker
enforces** — a source artifact that's missing, empty, or not a regular file is
rejected, exit codes must be `0`, and the declared `changeClass` must have its
minimum evidence — so it refuses to write a marker that wouldn't pass the gate.

- `changeClass`: `ui` | `backend` | `fullstack` | `other`
  (`other` = config/infra/tooling — there is no `config` value)
- `kind`: `playwright` | `screenshot` | `e2e` | `test` | `unit` | `integration` |
  `clasp` | `smoke` | `build` | `lint`
- `other` also accepts `noAutomatableCheck: true` + a non-empty `rationale` for
  genuinely un-automatable changes (logged, not silent).

### Reporting stranded markers (`/gate-gc`)

Every squash, amend and rebase abandons a commit. The marker keyed to that sha is an
ancestor of nothing, so `pruneStale` can never reach it — and while the marker exists, its
`validation-evidence/<sha>/` dir is pinned alive too.

```bash
node ~/.claude/skills/code-review/scripts/gate-gc.cjs      # reports; never deletes
```

**It reports. It does not delete, and it has no `--force`.** Collecting a marker means
deciding "this commit is gone" — and git cannot answer that. Under a store fault it reports
a perfectly LIVE commit exactly as it reports an absent one, through every channel:

| signal | absent | present but faulted |
|---|---|---|
| `cat-file -e` | 128 | 128 |
| `rev-parse --verify -q` | 1, empty stderr | 1, empty stderr *(when packed)* |
| `for-each-ref --contains` | 129 `no such commit` | 129 `no such commit` |
| `cat-file --batch-all-objects` | omitted | rc=0, **silently** omitted |
| `merge-base --is-ancestor` | 1 | 1 *(a corrupt **commit-graph** lies here while every object is pristine)* |

Six deleting designs were written, and adversarial review reproduced a live deletion — of a
real marker and, through the evidence cascade, the stored validation artifacts — in every
one: unreadable loose object, unreadable pack, corrupt-but-readable pack, corrupt
commit-graph, faulted `objects/info/alternates`. Each fix closed one channel and another
appeared. "Prove this object is gone" is an unbounded verification burden, and what sits on
the other side of a wrong answer is your validation evidence.

So the tool reports and a human deletes. It refuses to print at all unless the object store
is provably intact (every pack — **including alternates** — readable and passing `git
verify-pack`), and every reachability query runs with git's derived caches disabled
(`core.commitGraph=false core.multiPackIndex=false`) so a corrupt cache cannot lie to it. A
marker is kept if its commit is reachable from any ref, any worktree HEAD, or the
**reflog** — a commit one `git reset --hard @{1}` from being HEAD again must not lose its
evidence. The report is **advisory, not proof**: sanity-check a sha (`git log -1 <sha>`)
before removing anything.

## Aggregate verdict

After all surviving claims have a Layer 4 verdict, the skill produces ONE
recommendation:

| Recommendation | Trigger condition |
|---|---|
| **PUSH READY** | All claims dropped at L1/L2/L3, OR all surviving claims hit NOT_REPRODUCIBLE / OUT_OF_SCOPE / INTENTIONAL |
| **FIX FIRST** | At least one claim REPRODUCED with severity ≥ P2 |
| **DEFER + DOCUMENT** | Claim REPRODUCED but explicitly out-of-family (Subagent B flagged out_of_family + age=pre-existing). Drafts a deferred-items entry + a deferral commit message. |
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
**Severity:** P2 (independent assessment) / P2 (Codex CLI stamped)
**Source:** found by Codex CLI + reviewer (cross-validated)
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

When verdict is DEFER + DOCUMENT, the skill drafts artifacts the human applies — it never defers, commits, or posts on its own.

**Drafts produced** (location: `docs/code-review-runs/<run>/drafts/`):
- `deferred-items-entry.md`
- `deferral-commit-message.md`

**`deferred-items-entry.md` template** (uses the format from
`docs/deferred-items.md` of the consuming project):

~~~markdown
### <CLAIM_SUMMARY>

**Priority:** <SEVERITY> (independent assessment / Codex CLI stamp)
**Parked:** <YYYY-MM-DD>
**Context:** <CLAIM_BODY paraphrased to 2-3 sentences>

**Why deferred:** <Subagent B's out-of-family rationale>

**Scope notes:**
- <from Subagent A's accuracy report>
- <from Subagent C's sister-instances if any>

**Acceptance criteria when revisited:**
- <derived from claim>

**Cross-reference:** code-review run `<timestamp>-<branch>`.

**Decision:** Deferred — <rationale>
~~~

**`deferral-commit-message.md` template:**

~~~
docs: Defer <SEVERITY> (<CLAIM_FILE>:<LINE> <one-line>)

Flagged by local code-review (Layer 1: Codex CLI + reviewer subagent), out-of-family
from this branch's scope — <rationale from Subagent B>.

Deferred per user direction:
- <bullet from Subagent C if relevant>
- Will be bundled with next release / planned audit
~~~

The skill **never**:
- Decides to defer (the user approves the verdict)
- Auto-commits the deferred-items entry (the user stages and commits)

The console output includes the apply-to-disk commands:
```
DEFER + DOCUMENT verdict — N claims deferred. Drafts ready at:
  docs/code-review-runs/<run>/drafts/

To apply:
  cat docs/code-review-runs/<run>/drafts/deferred-items-entry.md >> docs/deferred-items.md
  git add docs/deferred-items.md
  git commit -F docs/code-review-runs/<run>/drafts/deferral-commit-message.md
```

> **Out of scope:** responding to a **GitHub Codex** PR review (querying the PR thread, drafting a reply, resolving/minimizing) is a separate post-push concern, not part of this local skill. This skill stops at the deferred-items entry + commit message; posting on a PR is the human's call with their own tooling.

## Red flags — STOP, do not push if you catch yourself thinking these

| Rationalization | Reality |
|---|---|
| "GitHub Codex will catch anything we miss" | GitHub Codex is lazy (1-2 findings per pass). Each push = a new review cycle = 5-10 min round trip. Run code-review locally before push to catch what GitHub Codex would catch, faster. |
| "Tests pass, that's enough" | Tests pass is necessary but not sufficient. Ask whether the CHANGED path has test coverage, not just whether the suite is green. The changed lines you just wrote may have zero coverage even when the suite is 100% green. |
| "Code review is what GitHub does" | GitHub Codex review is reactive (after push). code-review is proactive (before push). The point is to NOT spend a Codex cycle if local tools can find it. |
| "We can fix issues in follow-up PRs" | Each follow-up PR = another GitHub Codex round = compounding cycle time. The omnibus-and-defer playbook this skill produces is faster. |
| "User said ship by 6pm, just ship" | Time pressure does NOT exempt verification. The skill produces a structured-defer playbook for genuine out-of-family findings, so "ship anyway" is fast and correct, not skip-the-review. P1 findings keep their risk profile regardless of clock. |
| "The comment says it's intentional" | Verify the comment claim. Run `git blame` on the comment to see when it was added. Read the asymmetry logic yourself. Don't trust comments at face value — they go stale. |
| "The reviewer only flagged this one site, just fix this one" | AI reviewers are short-sighted. The skill's Layer 3 Subagent C explicitly hunts sister-instances. Fix-the-family, not fix-the-site. When fixing any finding, always grep for the same pattern across the module/codebase before pushing. |
| "GitHub will give us a second pass anyway" | A GitHub Codex round-trip costs 7-10 min plus reply/resolve/minimize churn. In production releases it costs an additional Apps-Script-version-bump and a partner-publish. Local pre-flight is cheaper than a post-push finding cycle. |

## Common mistakes (Layer 1 scope)

- **Running the Codex CLI with `--uncommitted` instead of `--base`** — only sees
  working-tree diff, misses prior commits. Use the wrapper script.
- **Dispatching reviewer-subagent with a wrong scope** — must match the Codex CLI's
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
