---
name: worklog-report
description: "Use when generating worklog summaries, time reports, or Jira work log entries from git history"
---

# Worklog Report

## Overview

Generate concise worklog bullet points from git history for Jira reporting.

## Process

1. Get author: `git config user.email`
2. Parse date range from natural language. "From X to Y" means through end of Y — use `--until=<Y+1 day>`
3. Run: `git log --all --author=<email> --since=<X>T00:00:00 --until=<Y+1>T00:00:00 --format="%ad %s" --date=short` (--all required; T00:00:00 required for correct midnight boundaries)
4. Multi-repo: use `git -C <path> log ...` when user says "from ~/path"
5. Group by time period (default: day; user can say "by hour", "by week", or "whole period")
6. Cluster similar commits — same feature/area becomes one bullet. Aim for 3-5 bullets per day
7. Transform: past tense verb, 5-7 words max
8. Deduplicate near-identical bullets

## Output Format

```
## Feb 24
- Implemented quote-aware command parsing
- Fixed word boundary prefix matching
- Added smart-compose e2e tests
```

## Format Rules

- Day headers: `## Mon DD` (e.g., `## Feb 24`) — no weekday names
- Week headers: `## Week of Mon DD`
- Whole period: no header, flat bullet list
- One `- ` bullet per clustered item, 5-7 words max, past tense
- Plain text only — no bold, no colons, no backticks, no sub-bullets

## Verb Guidelines

Pick the most natural verb. NEVER use the same verb for every item.

- feat: Added, Implemented, Created, Built
- fix: Fixed, Resolved, Corrected
- docs: Documented, Updated
- test: Tested, Added tests for
- chore: Updated, Configured, Cleaned up
- refactor: Refactored, Restructured

Choose whatever verb fits best.

## What NOT to Include

- No commit hashes, branch names, or commit counts
- No bold, backticks, or inline code formatting in bullets
- No explanatory notes or "how this was produced" section
- No Claude conversation context or metadata
- No weekday names in headers
