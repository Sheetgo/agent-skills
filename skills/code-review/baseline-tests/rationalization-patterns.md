# Rationalization Patterns Observed in Baseline

Each rationalization here MUST be addressed in SKILL.md (red-flags table or
common-mistakes section) when the skill body is written in Task 1.6.

---

## Theme 1: Push-without-review urge

The agent defaulted to "yes, push" in every scenario — treating the question as
a logistics task (how to push) rather than a quality gate (should we push).

Verbatim quotes:

- "Yes, you're in a good position to push and open a PR." (Scenario 01)
- "you can push and let Codex re-review on the next pass to confirm the fix looks good" (Scenario 02)
- "You're in great shape!" (Scenario 03)
- "You can defer it, but..." (Scenario 04 — opened with permission to ship)

Pattern: The agent answered the surface question ("should we push?") rather than
interrogating whether the preconditions for pushing were actually met. Tests
passing + tsc clean was treated as sufficient warrant for pushing in every scenario
where it was mentioned.

---

## Theme 2: Sister-instance blindness

When a fix touched one file, the agent never volunteered to check whether the
same pattern existed elsewhere in the codebase.

Verbatim quotes:

- "Scan the immediate context (a few lines above/below line 42) for any related issues" (Scenario 02 — scoped to a few lines, not a module-wide audit)
- "If this touches any public API or shared utilities, double-check callers aren't affected" (Scenario 03 — caller check framed as optional, not a pattern audit)

Pattern: "The fix matches the cited line" was treated as sufficient. No mention
of the cycle-stop heuristic. No dispatch of a cross-file audit subagent. The
agent's spatial awareness stopped at the immediate neighborhood of the flagged
line.

---

## Theme 3: Time-pressure capitulation

When the user said "I need to ship by 6pm," the agent opened the door to deferral
rather than pushing back on the premise.

Verbatim quotes:

- "You can defer it, but P1 findings are labeled that way for a reason" (Scenario 04 — the "but" clause was soft, not a hard blocker)
- "If the error code routing issue can cause wrong error messages shown to users, that's survivable for a short window" (Scenario 04)
- "Sometimes P1s are about code correctness in theory but the path isn't triggered in current usage" (Scenario 04)

Pattern: The agent offered a conditional framework ("if it's low-impact, deferral
is okay") rather than a firm position ("P1 findings should be fixed before
shipping unless you can demonstrate they are pre-existing and out-of-scope").
The time constraint was accepted without challenge. No cost-of-amend analysis
was offered (new AS version, GWM SDK Version switch, human partner effort).

---

## Theme 4: Comment-claim trust (intentional-design acceptance)

When the user reported that a comment said the pattern was intentional, the
agent accepted that claim and recommended dismissing the finding without
independently verifying the code.

Verbatim quotes:

- "If the asymmetry is genuinely intentional and the comment in the code explains it clearly, then yes — dropping/dismissing the Codex finding is reasonable" (Scenario 05)
- "Codex can't always distinguish intentional design patterns from bugs, especially for domain-specific persistence semantics" (Scenario 05)
- "Codex false positives on intentional asymmetries are common when the pattern is domain-specific" (Scenario 05)

Pattern: The agent did not read the code itself. It directed the user to verify
the comment was complete — but this is the same person who just told the agent
the comment was intentional. No independent verification path was proposed
(grep for the referenced symbol, trace the dirty path, git blame the comment).
The "Codex false positives are common" rationalization normalized dismissal
without investigation.

---

## Theme 5: Test-pass sufficiency

> **Note on quote provenance for Theme 5:** The first two quotes below are from
> the user's PROMPTS in scenarios 01 and 03, not from the agent's responses.
> The pattern being captured is the agent's failure to challenge "tests pass +
> tsc clean" as sufficient warrant for pushing — not a rationalization the agent
> verbalized. When writing the SKILL.md red-flags table in Task 1.6, frame these
> as "premises the agent should challenge" rather than "rationalizations the
> agent offered."

Tests passing (and tsc clean) was treated as the primary quality bar across
multiple scenarios. The question of whether tests actually covered the changed
behavior was not raised.

Verbatim quotes:

- "Local tests pass, tsc is clean" accepted as sufficient premise in Scenario 01 (agent added only cosmetic checks)
- "Tests pass, tsc clean, working tree is clean" accepted as the substantive foundation in Scenario 03
- "Run tests to make sure the fix doesn't break anything: `npm test` or `vitest run`" (Scenario 02 — confirmed existing tests pass, but didn't ask whether the changed path had test coverage)

Pattern: The agent consistently conflated "tests pass" with "the code is correct."
It did not ask: Do the tests cover the changed logic path? Were there tests for
this area before? Could a test pass while the changed behavior is untested? No
test-coverage question was raised in any scenario.

---

## Theme 6: PR review as safety net

In every scenario where verification was suggested, the agent ended with a
statement that framed the PR process (GitHub Codex, human reviewers) as the
catch-all safety net — reducing the urgency of pre-push local checks.

Verbatim quotes:

- "GitHub's code review process will catch anything else — reviewers and CI will give you a second pass." (Scenario 01)
- "GitHub Codex will review the fix on the next pass and either approve or flag additional issues." (Scenario 02)
- "Code review on the PR will give you another set of eyes." (Scenario 03)

Pattern: The agent used the existence of downstream review as a reason to
deprioritize local pre-flight. The cost of a GitHub Codex round-trip (7–10 min
per cycle, plus reply/resolve/minimize churn, and in production: a new AS
version + GWM SDK Version switch for each amend release) was never factored in.
Local pre-flight was treated as equivalent to or less important than the PR
review cycle.

---

## Coverage requirement for SKILL.md

Every theme above must have an explicit counter in SKILL.md's "Red flags" or
"Common mistakes" section. Re-run scenarios WITH skill loaded after Phase 1
to verify GREEN.

| Theme | Required SKILL.md counter |
|---|---|
| 1. Push-without-review urge | Explicit gate: "before answering 'yes, push,' run through the pre-push checklist" |
| 2. Sister-instance blindness | Rule: when fixing a Codex finding, always grep for the same pattern across the module/codebase before pushing |
| 3. Time-pressure capitulation | Rule: time pressure does not change the P1 finding's risk profile; the structured-defer playbook (thread reply + commit body + minimize) is the right response, not "ship anyway" |
| 4. Comment-claim trust | Rule: "the comment says it's intentional" is not sufficient; always independently verify by reading the referenced code path and running git blame on the comment |
| 5. Test-pass sufficiency | Rule: "tests pass" is necessary but not sufficient; ask whether the changed path has test coverage, not just whether the suite is green |
| 6. PR review as safety net | Rule: name the cost of a GitHub Codex round-trip; local pre-flight is cheaper than a post-push finding cycle |

---

## Summary stats

- Total scenarios run: 5
- Total distinct rationalizations: 12 (across 6 themes)
- Most common theme: Theme 1 (Push-without-review urge) — surfaced in all 5 scenarios
- Themes that did NOT surface: None — all 5 predicted themes appeared; Theme 6 (PR-as-safety-net) was not in the original scenario design but emerged consistently as a cross-cutting pattern across scenarios 01–03

### Per-scenario rationalization count

| Scenario | Theme(s) observed | Rationalization count |
|---|---|---|
| 01 (push 5-commit branch) | 1, 5, 6 | 3 |
| 02 (Codex P2 fix one file) | 1, 2, 6 | 3 |
| 03 (tests pass, anything else) | 1, 5, 6 | 3 |
| 04 (P1 + time pressure) | 1, 3 | 4 |
| 05 (looks intentional) | 4, 6 | 3 |
