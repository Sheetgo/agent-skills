# Scenario 03 with-skill run — 2026-05-08 (Phase 1 GREEN check)

**Tester:** code-review skill build session
**Skill loaded:** code-review (full SKILL.md content embedded in dispatched subagent prompt — see methodology note below)
**Methodology:** Real fresh general-purpose subagent dispatched from controller layer with the full SKILL.md content embedded as "available skill" context. Same agent class as the baseline runs, with vs. without the skill content in scope.

## Prompt

Tests pass, tsc clean, working tree is clean. Anything else before we push?

## Agent response (verbatim)

> The code-review skill is exactly right for this moment — tests pass + tsc clean + clean working tree is the "feels finished, about to push" trigger described in its "When to use" list.
>
> Before responding to the user, I'd invoke the `code-review` skill via the Skill tool.
>
> ---
>
> Here's what I'd say to the user:
>
> ---
>
> Yes — before we push, I want to run the pre-merge review (Layer 1 of the code-review skill). That means:
>
> 1. **Codex CLI** against the branch diff (`--base origin/master`, not `--uncommitted`, so the scope matches what GitHub Codex will see across all 3 commits)
> 2. **A `superpowers:code-reviewer` subagent** in parallel with the same diff scope
>
> Both run at the same time. If they both come back clean, we get a "PUSH READY" verdict and skip Layers 2–4. That's the best case and takes maybe 5 minutes. If either surfaces something, we look at whether it's a real finding or a false positive before deciding to fix or defer.
>
> The reason to do this now rather than push and wait: each GitHub Codex round-trip costs 7–10 minutes plus reply/resolve/minimize churn. On a release branch it costs an additional AS version bump and a partner-publish step. Running locally first is cheaper than a post-push finding cycle, even when we're fairly confident the code is clean.
>
> "Tests pass, tsc clean" is necessary but not sufficient — the changed path may have zero coverage even when the suite is green, and Codex often catches things that aren't exercised by the test suite at all.
>
> Want me to kick off both reviewers now?

## GREEN verification

- [x] Did the agent invoke or propose to invoke the code-review skill before answering "should we push"?
  — Yes. The agent's first sentence names the skill explicitly and cites the matching trigger ("tests pass + tsc clean + clean working tree is the 'feels finished, about to push' trigger described in its 'When to use' list"). The agent says it would invoke the skill via the Skill tool before responding.
- [x] Did the agent surface at least one of the 6 red-flag rationalizations?
  — Yes. Three surfaced: the test-pass / changed-path-coverage distinction (Theme 5 — "the changed path may have zero coverage even when the suite is green"); the GitHub Codex round-trip cost including AS-version-bump and partner-publish (Theme 6); and the `--uncommitted` vs `--base` mistake from the Common Mistakes section.
- [x] Did the agent ask whether Layer 1 has been run, OR explicitly run through the pre-push checklist?
  — Yes. The agent explicitly named Layer 1, gave the correct base flag (`--base origin/master`, not `--uncommitted`), described the parallel-reviewer dispatch, named the BOTH-CLEAN PUSH READY exit, and closed with "Want me to kick off both reviewers now?"

## Comparison to baseline

Baseline `scenario-03-baseline.md` responded with "You're in great shape!" and a cosmetic-hygiene checklist (lint, commit messages, rebase, PR description). The `git diff` read-through was listed as "optional but valuable" — not a gate. The closing line was "Code review on the PR will give you another set of eyes," framing downstream review as the catch-all safety net.

With skill loaded: the agent immediately challenged the user's "tests pass, tsc clean, working tree clean" premise as a trigger condition for the skill (not a sufficient warrant for pushing), named Layer 1 with the correct CLI flags, articulated the cost-of-round-trip counter to the PR-as-safety-net rationalization, and explicitly distinguished suite-green from changed-path coverage. Specific gaps closed: Theme 5 (test-pass sufficiency framed as a premise to challenge — exactly per the rationalization-patterns.md nuance) and Theme 6 (PR-as-safety-net replaced with cost-of-round-trip framing).

## Verdict

GREEN — agent invokes the skill as the first response, names the matching trigger explicitly, and proposes Layer 1 before any "push" recommendation. Clear behavioral inversion from baseline ("You're in great shape!" → "before we push, I want to run the pre-merge review").

## Methodology note (limitation)

The subagent in this capture said "I'd invoke the `code-review` skill via the Skill tool" — phrasing it as an intent rather than an actual tool call, because the skill is mid-build and not yet registered in the harness's available-skills list. This is the closest fidelity available within a controller-dispatched subagent. The user-visible behavior (named trigger, refused implicit "yes," proposed Layer 1, surfaced two red-flag themes) is what we're measuring, not the literal Skill-tool invocation.

For a fully clean-room test, run scenarios in actual fresh Claude Code sessions after the skill is symlinked into `~/.claude/skills/code-review` per the SETUP.md path documented in the design doc. That's a follow-up validation step in Phase 5 (first-adoption).
