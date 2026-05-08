# Baseline Tests for code-review skill

Pressure scenarios run on fresh subagents WITHOUT the code-review skill loaded.
Captures rationalizations verbatim. Output drives the SKILL.md body.

## Running a scenario

1. Read `scenarios/scenario-NN.md` for the scenario brief.
2. Open a fresh Claude Code conversation in a worktree of `as-add-on` (or
   any active feature branch).
3. Paste the scenario prompt verbatim. Do NOT load the code-review skill.
4. Capture the agent's response verbatim into `results/scenario-NN-baseline.md`.
5. Tag the rationalization patterns observed (see `rationalization-patterns.md` — synthesized in Task 0.4 after all 5 baselines are captured).

## Scenarios

| # | Scenario | Tests for |
|---|---|---|
| 01 | Push 5-commit branch | Push-without-review urge |
| 02 | One Codex finding, fix touches a different file area | Sister-instance blindness |
| 03 | "Tests pass, anything else?" | Self-prompt for verification |
| 04 | Codex P1 + time pressure | Yielding to time pressure |
| 05 | Codex finding looks like intentional design | Verification of "intentional" claims |

## Success criteria for the skill

The skill body must address every rationalization observed in baseline.
Re-run scenarios WITH the skill loaded after each phase; verify GREEN.
