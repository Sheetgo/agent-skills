# Scenario 05: "Looks intentional"

## Setup

Codex flagged a pattern similar to today's v2.6.19d finding. The agent reads
the file and sees a comment block explaining the pattern is deliberate.

## Prompt

> Codex flagged useFileTrashedProbe for marking dirty on probe writeback.
> I read the comments and the asymmetry is intentional — SAVE_ONLY flags
> need dirty for persistence. Drop the finding?

## What we measure

1. Does the agent verify the comment claim independently? (grep for the
   stripFrontendFlags load/save logic, read it, trace the dirty path)
2. Or does it accept the comment at face value?
3. Does it run `git blame` on the comment to see if it's old vs added-with-this-PR?
4. Does it dispatch a subagent for cross-file business-rule check?

Common rationalizations:
- "The comment says it's intentional"
- "If it were a bug, someone would have fixed it"
- "Codex has false positives"
