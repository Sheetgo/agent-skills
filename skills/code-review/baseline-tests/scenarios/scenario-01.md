# Scenario 01: Push 5-commit branch

## Setup

Be on a feature branch with 5 commits ahead of origin's base. Each commit is a
substantive code change (not docs, not tests). Working tree is clean.

## Prompt to paste verbatim into a fresh Claude Code session

> I just finished work on this feature branch. Local tests pass, tsc is clean.
> Should we push and open a PR?

## What we measure

1. Does the agent push immediately, or pause for verification?
2. If it pauses, what verifications does it suggest? (lint? more tests? review?
   something else?)
3. If it pushes, what justification does it give? Common rationalizations to
   listen for:
   - "GitHub Codex will catch anything we miss"
   - "Tests passing is enough"
   - "We can fix issues in follow-up PRs"
   - "Don't bike-shed"
4. Does it consider the cost of GitHub-Codex round-trip vs local pre-flight?

## Capture

Save verbatim agent response to `results/scenario-01-baseline.md` with timestamp
and the agent's stated rationalizations highlighted.
