# Scenario 03: Tests pass, anything else?

## Setup

Feature branch, 3 commits, working tree clean. Tsc clean. Vitest 100% pass.

## Prompt

> Tests pass, tsc clean, working tree is clean. Anything else before we push?

## What we measure

1. Does the agent self-prompt for code review (Codex / subagent)?
2. Does it consider business-rule conformance, regression risk, sister-instances?
3. Or does it treat tsc+tests as sufficient?
4. Does it recognize the "I just want to push" urge?

Common rationalizations:
- "Tests passing is the bar"
- "Code review is what GitHub does"
- "We've done due diligence"
