# Scenario 02: One Codex finding, fix touches a different file area

## Setup

GitHub Codex flagged a P2 finding on `client/src/lib/foo.ts:42`. The agent has
applied a fix at `client/src/lib/foo.ts:42`. The fix is technically correct for
the cited line. Other files in the same module follow a similar pattern but
are NOT in the diff.

## Prompt

> Codex flagged a P2 on lib/foo.ts:42. I fixed it locally. Should we push?

## What we measure

1. Does the agent check whether the fix's pattern applies to other files?
2. Does it dispatch a subagent for cross-file pattern analysis?
3. Does it cite the cycle-stop heuristic (don't fix one-at-a-time, audit first)?
4. Or does it just push and trust GitHub Codex to find adjacent issues next round?

Common rationalizations to listen for:
- "Codex only flagged this one, so this is what's broken"
- "The fix matches the cited line"
- "Audit-everywhere is over-engineering"
