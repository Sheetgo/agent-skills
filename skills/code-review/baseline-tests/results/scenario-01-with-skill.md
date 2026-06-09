# Scenario 01 with-skill run — 2026-05-08 (Phase 1 GREEN check)

**Tester:** code-review skill build session
**Skill loaded:** code-review (full SKILL.md content embedded in dispatched subagent prompt — see methodology note below)
**Methodology:** Real fresh general-purpose subagent dispatched from controller layer with the full SKILL.md content embedded as "available skill" context. Same agent class as the baseline runs, with vs. without the skill content in scope.

## Prompt

I just finished work on this feature branch. Local tests pass, tsc is clean. Should we push and open a PR?

## Agent response (verbatim)

> Not quite — the `code-review` skill isn't registered in the available skills list, so I can't invoke it via the Skill tool. But the guidance from both the skill description and CLAUDE.md is clear enough that I know exactly what to say.
>
> ---
>
> Not yet — let's run a quick pre-push review first.
>
> Local tests passing and tsc being clean is a necessary bar, not a sufficient one. Per the project's 4-layer protocol, before pushing any substantive change we want at minimum Layer 1: run the Codex CLI against the branch diff and dispatch a `superpowers:code-reviewer` subagent in parallel. Both targeting the same scope (commits since `origin/master` or wherever the branch diverged), not just the working tree.
>
> The reason to do this before pushing rather than after: each GitHub Codex round-trip on the PR costs 7–10 minutes of wait time, plus if anything surfaces after `release:prod` it's another AS version bump and a partner re-publish. A 5-minute local pre-flight is cheaper than any of that.
>
> What I'd actually do right now:
>
> 1. Run `git log origin/master..HEAD --oneline` to confirm the 5 commits in scope and identify the base.
> 2. Kick off the Codex CLI wrapper (`run-codex.sh`) and a `superpowers:code-reviewer` subagent in parallel, both scoped to that base..HEAD range.
> 3. While those run, check whether the changed code paths have meaningful test coverage — not just that the suite is green.
> 4. Aggregate findings, deduplicate by file:line, and decide: clean → push; findings → triage before pushing.
>
> If both come back clean, I'll say push and open the PR. If either flags something, we look at it together before the branch goes up.
>
> Want me to start that now?

## GREEN verification

- [x] Did the agent invoke or propose to invoke the code-review skill before answering "should we push"?
  — Yes. The agent refused to answer "yes, push" and explicitly proposed running the pre-merge review first ("Not yet — let's run a quick pre-push review first").
- [x] Did the agent surface at least one of the 6 red-flag rationalizations?
  — Yes. Three surfaced: "tests pass + tsc clean is necessary but not sufficient" (Theme 5 — framed as a premise to challenge), the cost of GitHub Codex round-trip including the AS-version-bump + partner-publish overhead (Theme 6), and the implicit pre-push review urge (Theme 1).
- [x] Did the agent ask whether Layer 1 has been run, OR explicitly run through the pre-push checklist?
  — Yes. The agent listed a 4-step checklist that maps to the SKILL.md's Layer 1: scope identification, parallel reviewer dispatch, test-coverage check on changed path, and aggregation/triage. Closed with "Want me to start that now?"

## Comparison to baseline

Baseline `scenario-01-baseline.md` responded with "Yes, you're in a good position to push and open a PR" — accepting "tests pass + tsc clean" as sufficient warrant. The baseline added cosmetic hygiene steps (lint, commit messages, rebase) but never proposed local code review, never mentioned Codex CLI, never asked about test coverage of the changed path, and ended with "GitHub's code review process will catch anything else."

With skill loaded: the agent refused the implicit "yes push" answer in its first sentence, named the 4-layer protocol, proposed the parallel-reviewer dispatch, and surfaced the cost-of-round-trip counter to the PR-as-safety-net rationalization. Specific gap closed: Theme 6 (PR-as-safety-net) is now met with a concrete cost-of-round-trip framing rather than implicit acceptance.

## Verdict

GREEN — agent now proposes the skill's verification path instead of recommending push outright. Clear behavioral inversion from baseline.

## Methodology note (limitation)

The dispatched subagent observed that "the `code-review` skill isn't registered in the available skills list, so I can't invoke it via the Skill tool" — accurate, since this skill is mid-build and not yet registered. The subagent fell back to following the embedded SKILL.md content directly. This is a fair simulation of the post-MVP state where the skill IS registered: the user-visible behavior (refusing to recommend push, proposing Layer 1, surfacing red-flag themes) is what we're measuring, not the literal Skill-tool invocation.

For a fully clean-room test, run scenarios in actual fresh Claude Code sessions after the skill is symlinked into `~/.claude/skills/code-review` per the SETUP.md path documented in the design doc. That's a follow-up validation step in Phase 5 (first-adoption).
