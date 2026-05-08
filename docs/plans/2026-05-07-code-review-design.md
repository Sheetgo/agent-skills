# `code-review` skill — design

> **Status**: Draft, pending user approval
> **Author**: Willian Vargas (with Claude Opus 4.7)
> **Date**: 2026-05-07

## Problem

The 2026-05-07 v2.6.19c-2 → v2.6.19d release cycle on the Sheetgo Automations add-on hit a fundamental scaling failure with the existing 4-layer Codex protocol: the local Codex pre-flight (`codex review --uncommitted`) only sees the working-tree diff. On a multi-commit feature branch, GitHub Codex reviews against the PR base — a much wider scope — and surfaces adjacent-file findings that local pre-flight misses. Each push surfaced a new finding in a new file. The cycle was unbounded.

Two compounding issues:

1. **Lazy reviewer**: GitHub Codex stops at 1–2 issues per pass. Even with the broader scope, it doesn't enumerate everything; we cycle through reviews to surface more.
2. **Slow feedback loop**: pushing to GitHub, waiting 5–10 min for review, reading findings, fixing, pushing again — the whole loop runs over hours, not minutes.

The fix is to move the reviewer locally AND verify its findings before acting on them. Codex (and its peers) are valuable but not authoritative — they're short-sighted, miss business-rule context, and sometimes confidently flag intentional design as bugs. We need a layered verification pipeline that treats reviewer output as **claims to be vetted**, not **verdicts to be implemented**.

## Community vocabulary research

- **"Second opinion"** — Claude Code's own published vocabulary for one-off reviews ([Claude Code docs](https://code.claude.com/docs/en/code-review))
- **"LLM-as-a-Judge" / "Agent-as-a-Judge"** — academic term ([arxiv 2508.02994](https://arxiv.org/html/2508.02994v1)) for using LLMs to evaluate other LLM outputs
- **"Scorer–Critic–Commander"** — 3-agent pattern where a Critic plays devil's advocate against a Scorer, with a Commander coordinating ([AIBuddy](https://aibuddy.software/how-llms-judge-4-essential-patterns-for-smarter-agent-workflows/))
- **"Review Coordinator"** — Claude Code's term for the high-tier model handling review-of-reviews ([Cloudflare AI Code Review](https://blog.cloudflare.com/ai-code-review/))
- **"Confidence-based gating / triage"** — HITL workflow pattern: low-confidence → human; medium → revision; high → ship ([AllDaysTech](https://alldaystech.com/guides/artificial-intelligence/human-in-the-loop-ai-review-queue-workflows))
- **Marketplace analogues**: `pr-review-expert` (alirezarezvani/claude-skills), `peer-qa-review` (netresearch), `improvement-loop` (aaddrick/claude-pipeline)

The skill is named **`code-review`** despite its multi-layer mechanic, because that's what teams actually call this in conversation. The mechanism (LLM-as-Judge panel + verification pipeline) is internal complexity; the user-facing slash command should match natural vocabulary.

## Architecture

### Layer 1 — Parallel claim-finding

Two reviewers run **in parallel**, both against the same diff scope:

- **(a) Codex CLI**: `codex review --base <base-ref>` (Codex CLI from `/Applications/Codex.app/Contents/Resources/codex`). Returns markdown with severity tags (P1/P2/P3) and `file:line` anchors.
- **(b) `superpowers:code-reviewer` subagent**: dispatched via Agent tool with the same diff. Prompted to (1) find correctness issues, (2) hunt for sister-instances of any anti-pattern, (3) stamp severity, (4) cite `file:line` per finding.

**Diff base (hybrid)**: if `gh pr view <branch>` returns an open PR → use its base. Else → `origin/master`. Pre-PR development uses master; in-PR development matches GitHub Codex's scope exactly.

**Aggregation**: deduplicate by file+line, retain attribution per claim ("found by Codex / code-reviewer / both"). Both-found = stronger signal heading into Layer 2.

**Failure modes**:
- Codex unavailable (quota / down) → continue with code-reviewer only. Tag claims as `codex-skipped` for downstream awareness.
- Both unavailable → skill exits early with: "Layer 1 unavailable, manual review required before push." No false-safety claim.
- One returns claims, the other returns clean → still proceed (single-signal is OK; we just lack cross-validation).

**Exit short-circuit**: if both reviewers return clean → skill exits at Layer 1 with **PUSH READY** verdict. Layers 2–4 only run when there's at least one claim to verify. This is the optimization that makes the skill cheap on green-path pushes.

### Layer 2 — Self-check (main thread)

For each claim, Claude in the main thread verifies before paying for subagent time:

1. **Read the cited code** — open `file:line`. Does the code actually look like what the claim describes?
2. **Reproduce mentally** — trace data flow / control flow. Does the issue exist as described, or is it hallucinated?
3. **Session-recency check** — `git blame` on cited lines. Was this introduced in current branch's commits, or is it pre-existing on master?
4. **Quick business-rule scan** — `grep` for related comments, CLAUDE.md notes, deferred-items entries. Is the "issue" actually intentional design?

**Triage verdict per claim**:
- **CONFIRMED** — verified, proceed to Layer 3.
- **FALSE-POSITIVE** — hallucinated or refers to non-existent code. Drop. No subagents spent.
- **INTENTIONAL** — real behavior, but documented as deliberate. Drop with citation.
- **UNCERTAIN** — can't tell from main-thread reading. Forward to Layer 3 with the uncertainty flagged.

**Output**: filtered claim list (CONFIRMED + UNCERTAIN only).

**Why main-thread, not a subagent**: I have full conversation context, can quickly grep CLAUDE.md and recent commits, and false-positive triage is fast. Subagent dispatch is reserved for the deeper analysis in Layer 3.

### Layer 3 — Subagent panel (3 perspectives, parallel)

For each surviving claim, dispatch 3 subagents **in parallel** (single message, three Agent tool calls). Each gets the claim + Layer 2 notes + a focused brief.

**Subagent A — Accuracy & business-rule check**
*Brief*: "Is this a real issue or intentional design? Read cited code in full context. Check `git log` and `git blame` for the touched lines. Search CLAUDE.md, comments in the file, and `docs/deferred-items.md` for documented rationale. Verify the described failure mode reproduces under stated conditions. Output: REAL_BUG / INTENTIONAL / NOT_REPRODUCIBLE with citations."

**Subagent B — Severity & impact**
*Brief*: "Independently assess severity (P1/P2/P3) without seeing the original reviewer's stamped severity first. Then compare to the stamp and explain disagreement. Estimate user-impact: how often does the affected path execute, how bad is the failure (silent vs visible vs data loss), how many users hit it. Note timing: was this introduced in the current branch's commits (`git log <base>..HEAD -- <path>`) or pre-existing on master? Output: severity + impact + age, with reasoning."

**Subagent C — Sister-instances & related issues**
*Brief*: "Find structurally similar issues elsewhere in the codebase. If the claim is 'X happens when Y', search for every other place Y could happen and check if X happens there too. Use the project's full source tree, not just the diff. Negative-list anything already documented as resolved or deferred (cite `docs/deferred-items.md`). Output: list of sister-sites with `file:line` + assessment of whether they share the pattern."

**Panel reconciliation** (main thread, mechanical):
- All three CONFIRM real → claim survives to Layer 4.
- One says NOT_REPRODUCIBLE / INTENTIONAL → drop with citation, attach panel report.
- Sister-instances found → add them to the surviving claim list (so we don't end up cycling on them later).
- Panel disagreement on severity → record both severities, take the higher one for downstream gating.

**Output to Layer 4**: surviving claims with full panel report (severity, impact, age, sisters).

### Layer 4 — Live test

For each claim that survived Layer 3, dispatch a live test. The test method depends on the claim type:

| Claim type | Test method |
|---|---|
| Frontend / UI / wizard flow | Playwright E2E — simulate the user flow that hits the bug |
| Backend / Apps Script | `clasp run <function>` against DEV with the trigger condition simulated |
| State management / Zustand | Component test mounting the affected component with the trigger state |
| Pure logic / utilities | Unit test isolating the function with trigger inputs |
| Type-only / docs / deferred | Skip Layer 4. Document why ("type-only change, tsc covers it" / "doc clarification, no runtime") |

**Verdict per claim**:
- **REPRODUCED** — live test demonstrates the bug. Real, must be addressed before push (or explicitly deferred).
- **NOT_REPRODUCIBLE** — live test fails to surface the bug. Either the claim is wrong, or our test doesn't cover the trigger. Record both possibilities.
- **OUT_OF_SCOPE** — test method genuinely can't run (needs production data / external service). Document and treat as needing manual review.

## Aggregation & overall verdict

The skill produces a single recommendation per invocation:

| Recommendation | Trigger condition |
|---|---|
| **PUSH READY** | All claims dropped at Layer 1/2/3, OR all surviving claims hit NOT_REPRODUCIBLE / OUT_OF_SCOPE / INTENTIONAL. |
| **FIX FIRST** | At least one claim REPRODUCED with severity ≥ P2. |
| **DEFER + DOCUMENT** | Claim REPRODUCED but explicitly out-of-family from current PR scope. Matches today's playbook for `api-files.ts:725` and `useSourcesEmptyCheck.ts:41` deferrals. |
| **MANUAL REVIEW NEEDED** | Layer 1 incomplete (Codex unavailable AND code-reviewer unavailable) OR many OUT_OF_SCOPE claims. |

## Triggers

Three trigger pathways, all leading to the same flow:

1. **On-demand** — `/code-review` slash command. Manual invocation any time.
2. **Me-detecting (primary auto)** — Claude in the main thread invokes the skill when about to ask "should we push / open PR / merge?". Judgment-based; no rigid heuristic.
3. **Git hook (safety net)** — PreToolUse on Bash `git push` blocks if `code-review` hasn't been invoked since the last meaningful code change on the branch. Configurable to skip for docs-only branches.

The skill records a marker file (`.git/code-review-passed-<sha>`) on PUSH READY verdict. The hook reads this marker. Marker expires when HEAD changes.

## Skill structure (agent-skills repo)

```
agent-skills/
├── skills/code-review/
│   ├── SKILL.md                         # YAML frontmatter + procedural spec
│   ├── prompts/
│   │   ├── code-reviewer.md             # Layer 1 (b) prompt
│   │   ├── subagent-a-accuracy.md       # Layer 3 A
│   │   ├── subagent-b-severity.md       # Layer 3 B
│   │   └── subagent-c-sisters.md        # Layer 3 C
│   ├── scripts/
│   │   ├── run-codex.sh                 # Layer 1 (a) wrapper with --base detection
│   │   ├── parse-claims.cjs             # Output parser → structured claim list
│   │   └── check-marker.cjs             # Hook script for git push
│   ├── project-setup/
│   │   ├── settings-fragment.json       # Hook registration template
│   │   └── README.md                    # Per-project install steps
│   └── SETUP.md                         # User-level install + per-project setup
├── commands/code-review.md              # Slash command stub
└── docs/plans/2026-05-07-code-review-design.md  # This document
```

**User-level install**: symlink `~/.claude/skills/code-review` → `agent-skills/skills/code-review`. Matches the existing pattern for `fix-issues`, `git-conventions`, etc.

**Per-project install**: `SETUP.md` documents copying `project-setup/settings-fragment.json` into target project's `.claude/settings.local.json` and installing the hook script. Sheetgo Automations adopts as first user.

## Outputs

**Per-invocation report** (saved to `docs/code-review-runs/YYYY-MM-DD_HH-MM-<branch>.md`):
- Branch + diff base + commit SHA at invocation
- Layer 1 raw output from Codex + code-reviewer (truncated; full output in `/tmp/code-review-<run-id>/`)
- Per-claim trace through all 4 layers with verdicts
- Aggregate recommendation
- Time + token cost summary

**Console summary** (what Claude shows in the conversation):
- One-line headline: `code-review on <branch> @ <sha>: <recommendation>`
- Compact per-claim table: `file:line, severity, panel verdict, live test verdict, action`
- Pointer to the report file

**On-disk artifacts**:
- Report file (committed if claims found, untracked if PUSH READY since it's noise)
- Marker file `.git/code-review-passed-<sha>` (created on PUSH READY, expires when HEAD changes)

## Scope adjustments — partial integration with adjacent concerns

After review, four "out of scope" items adopted as **partial integrations** rather than pure exclusions. Each is small in surface area but addresses real toil today.

### Adopted: fix-issues hand-off (was "fully out")

When verdict is **FIX FIRST**, the skill produces a structured claim list (panel-validated severity, sister-instances, file:line) at `docs/code-review-runs/<run>.md` and surfaces a one-line copy-paste invocation: `Run /fix-issues with the claim list at <path>`.

**Does not auto-invoke** `/fix-issues`. The user retains the choice between:
- Fix in current branch (run `/fix-issues`)
- Fix in a follow-up PR (close current branch, branch off master)
- Rollback the offending commit
- Ask the team owner for guidance

**Implementation surface**: one structured-output writer in the skill's verdict-aggregation step. fix-issues already accepts an issue-registry input shape; just match it.

### Adopted (PR-context conditional): draft-not-decide artifacts (was "fully out")

When verdict is **DEFER + DOCUMENT**, the skill drafts artifacts the human posts. The set produced depends on context:

| Context | Drafts produced |
|---|---|
| **Local check (no PR open)** | `docs/deferred-items.md` entry only |
| **PR-wired check (PR open + Codex thread on the affected file:line)** | All three: `deferred-items.md` entry + Codex thread reply + deferral commit message |

The skill detects PR context via `gh pr view <branch>` + `gh api graphql` thread query for the file:line.

The skill **never**:
- Decides to defer (the human approves the verdict)
- Auto-commits the deferred-items entry (the human stages and commits)
- Auto-posts on GitHub (the human posts, resolves threads, minimizes reviews)

**Templates**: pinned to the `docs/deferred-items.md` format established during the v2.6.19c-2 → v2.6.19d cycle (priority, parked date, context, why deferred, scope notes, acceptance criteria, cross-reference, decision). Drafts must include claim body + age + sister-instances from the panel report; if any are missing, skill warns rather than producing a thin draft.

**Concrete value**: replaces ~30 min of manual drafting per multi-deferral cycle (today's session: 3 deferrals × 10 min each).

### Adopted: security-review composition fast-path (was "fully out")

The existing `/security-review` skill ("Complete a security review of the pending changes on the current branch") has security-specific scope. The skill detects security-relevant diffs and surfaces a parallel-run suggestion:

**Auto-detection patterns** (configurable per project via `project-setup/security-patterns.json`):
- File paths matching auth/crypto/token/permission/session/jwt/sso conventions
- Imports of common crypto/auth libraries (bcrypt, argon2, passport, oauth, etc.)
- Files containing dangerous-execution patterns (dynamic-eval calls, unsafe innerHTML React patterns, shell-out invocations)
- Database query construction with string-concatenation patterns near query / sql call sites

**On match**: skill emits a Layer 1 advisory (alongside Codex + code-reviewer claims): `"Security-relevant diff detected. Consider running /security-review in parallel before final verdict."` Optionally: Layer 3 Subagent A appends a security-mindset prompt to its accuracy check for matched claims.

**Does not replace** `/security-review` — it has deeper specialty. The skill flags that the other tool likely applies.

### Stays out of scope

- **CI integration**: GitHub Codex already runs in CI. Duplicating Layer 1 in CI buys nothing. Skill remains local-first.
- **Replacing human PR review**: human still owns merge approval. The skill produces evidence; humans decide.
- **Static analysis tooling integration**: linters, type checkers, SAST tools run separately. The skill orchestrates AI reviewers, not toolchains.
- **Auto-applying fixes**: per #1 above, the skill hands off claims to `/fix-issues`; it does not modify code itself.

## Open questions / decisions

None blocking. Decisions made during brainstorming:

| Question | Decision |
|---|---|
| Codex-clean case | Skip Layers 2–4. Trust the clean signal. |
| Diff base | Hybrid: PR base if open, else `origin/master`. |
| Trigger mechanism | Both me-detecting (primary) + git hook (safety net) + slash command. |
| Codex unavailable | Fail-soft: continue with code-reviewer subagent only. |
| Layer 1 reviewers | Both Codex AND code-reviewer subagent in parallel. |

## Skill-authoring considerations (writing-skills compliance)

Reviewed against `superpowers:writing-skills` best practices on 2026-05-07. Applies to the SKILL.md authoring phase.

### YAML `description` — triggers only, no workflow summary

Per writing-skills: summarizing the workflow in the description causes Claude to follow the *description* and skip reading the full skill body. For a 4-layer skill this is fatal — Claude would shortcut to running just one layer.

**Draft frontmatter** (triggers-only, third person, "Use when..."):

```yaml
---
name: code-review
description: Use before pushing a branch, opening a PR, updating an existing PR, or merging. Use when GitHub Codex review cycles feel unbounded, when AI-flagged findings include false positives, when the team is finding adjacent-file issues each push, or when a chunk of work feels finished and you're about to ask whether to push.
---
```

What's deliberately omitted: any mention of Codex, subagent panel, 4 layers, live test. The skill body explains the mechanism; the description only triggers it.

### TDD methodology — Phase 0: RED-phase baseline testing

Writing-skills' Iron Law: **no skill without a failing test first**. Before writing SKILL.md, run pressure scenarios on subagents WITHOUT the skill loaded. Document their rationalizations verbatim. The skill body's "Common mistakes" / "Red flags" sections must address those specific rationalizations.

Specific baseline scenarios:

| # | Scenario | What we measure |
|---|---|---|
| 1 | "You just finished a feature branch with 5 commits. Should we push?" | Does agent push without invoking review? Does it cite "GitHub Codex will catch it" as justification? |
| 2 | "Codex found 1 P2 finding. The fix touches a different file from the finding's adjacent area. Push?" | Does agent miss the sister-instance? |
| 3 | "Local tests pass, tsc clean, you're about to ask the user to push. Anything else?" | Does agent self-prompt for verification, or just push? |
| 4 | "GitHub Codex reviewed and stamped a P1 on a file. The user is in a hurry. Skip it?" | Does agent yield to time pressure or hold the line? |
| 5 | "Codex finding looks like it's about intentional design (commented in the file). Drop it?" | Does agent verify the comment claim, or take Codex's word? |

After the skill is drafted, re-run the scenarios WITH the skill present (GREEN). REFACTOR until the skill closes every loophole the baseline revealed.

### Word budget + structure

- **SKILL.md**: target <500 words. The design doc's ~2000 words are background, not the skill body. SKILL.md is procedural reference, scannable.
- **Heavy material → separate files**:
  - 4 subagent prompts (Layer 1 code-reviewer + Layer 3 A/B/C) → `prompts/*.md` (one file per role)
  - Codex CLI wrapper + claim parser → `scripts/*.{sh,cjs}`
  - One canonical end-to-end example → `examples/full-flow.md` (walks the v2.6.19d `useFileTrashedProbe.ts:81` claim through all 4 layers as a worked example)

### Cross-references to existing skills (no @ syntax)

The skill orchestrates and adjoins existing skills. Use explicit-required-marker style with skill name only — never `@` (force-loads on session start, burns context).

```markdown
**REQUIRED SUB-SKILL:** Use superpowers:requesting-code-review for Layer 1 (b) dispatch.
**RELATED:**
- After this skill recommends FIX FIRST, use fix-issues to address the surviving claims.
- For new feature design (not bug verification), use plan-hardening + writing-plans instead — this skill is pre-merge gate, not pre-design gate.
- Adjacent to implementation-audit (which validates implementation against a plan); this skill validates findings against actual behavior.
```

### Anti-patterns to avoid in the SKILL.md

- ❌ **Narrative storytelling** about the v2.6.19 cycle. Use this design doc for history; SKILL.md is reusable technique.
- ❌ **Flowcharts for the 4-layer linear process**. Use numbered lists. Flowcharts are reserved for non-obvious decision points (e.g., "claim type → which test method").
- ❌ **Multi-language examples**. Pick TypeScript/JavaScript (matches the Sheetgo Automations stack and most agent-skills users). Port to other languages only when adopted.
- ❌ **Generic descriptions**. Every section in SKILL.md must address a specific rationalization captured during RED-phase testing.

## Implementation phases (suggested)

The implementation plan (separate document via writing-plans skill) should phase as:

0. **Phase 0 — RED: Baseline testing (writing-skills Iron Law)**: dispatch fresh subagents (no skill loaded) through the 5 baseline scenarios above. Capture rationalizations verbatim. Output: baseline-rationalizations.md. This is the test-first phase; everything downstream addresses the documented failures.
1. **Phase 1 — Skill skeleton + Layer 1**: SKILL.md (frontmatter + body addressing baseline rationalizations), slash command stub at `commands/code-review.md`, Codex wrapper script with --base detection, code-reviewer subagent dispatch prompt, claim parser, exit-on-clean. Get the green-path working first. Re-run baseline scenarios WITH the skill (GREEN).
2. **Phase 2 — Layers 2 + 3**: self-check protocol documented in SKILL.md + 3-subagent panel prompts in `prompts/`. The most expensive logic. REFACTOR-pass against any new rationalizations surfaced.
3. **Phase 3 — Layer 4 + verdict aggregation**: live-test dispatchers per claim type, recommendation logic, marker-file management. Add `examples/full-flow.md` worked example.
4. **Phase 4 — Hook + per-project install**: PreToolUse hook script + project-setup template + SETUP.md. Final REFACTOR-pass.
5. **Phase 5 — First adoption (Sheetgo Automations)**: install per-project, symlink user-level, run on the next feature branch, iterate based on real usage. Adoption findings feed back into the skill via PR.

Each phase should land as its own commit on a feature branch in the agent-skills repo.
