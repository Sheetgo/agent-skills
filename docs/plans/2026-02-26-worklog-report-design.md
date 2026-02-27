# Worklog Report Skill — Design Document

**Date:** 2026-02-26
**Skill name:** `worklog-report`
**Command:** `/worklog`

## Purpose

Generate concise worklog bullet points from git history for Jira (or similar) time reporting. Uses only git commits as data source — no Claude conversation context.

## Invocation

Natural language via `/worklog <args>`:

| Example | Meaning |
|---------|---------|
| `/worklog today` | Today's commits |
| `/worklog yesterday` | Yesterday's commits |
| `/worklog last week` | Last 7 days |
| `/worklog from Feb 1 to Feb 15` | Date range |
| `/worklog this month by week` | Current month, grouped by week |
| `/worklog today from ~/projects/api` | Different repo |
| `/worklog today from ~/projects/api and ~/projects/frontend` | Multiple repos combined |

- Single date = from that date to now
- Omitted end date = until current moment
- Omitted entirely = today

## Data Extraction

1. **Author filter:** `git config user.email` auto-detects current user
2. **Date parsing:** Claude interprets natural language into `--since` / `--until`
3. **Git command:** `git log --author=<email> --since=<X> --until=<Y> --oneline --format="%ad %s" --date=short`
4. **Multi-repo:** If user specifies paths, run `git -C <path> log ...` for each, combine results

## Clustering & Transformation

1. **Group by time period** — default: calendar day. Override: "by hour", "by week", "whole period"
2. **Cluster similar commits** — merge commits touching same feature/area (moderate: same domain → one bullet)
3. **Transform to past tense** — commit type as guideline, not mechanical rule:
   - `feat` → Added, Implemented, Created, Built (pick most natural)
   - `fix` → Fixed, Resolved, Corrected
   - `docs` → Documented, Updated
   - `test` → Tested, Added tests for
   - `chore` → Updated, Configured, Cleaned up
   - `refactor` → Refactored, Restructured
4. **Compress to 5-7 words max** per bullet
5. **Deduplicate** near-identical bullets after clustering

### Clustering Example

```
Raw commits:
  feat: Add quote-aware operator splitting
  feat: Add quote-aware position tracking state machine
  feat: Add pipe and expansion guards

Clustered output:
  - Implemented quote-aware command parsing
```

## Output Format

```markdown
## Feb 24
- Implemented quote-aware command parsing
- Fixed word boundary prefix matching
- Added smart-compose e2e tests

## Feb 25
- Documented smart-compose v2 capabilities
- Added gitignore for pycache
```

### Format Rules

- Day headers: `## Mon DD` (e.g., `## Feb 24`)
- Week headers: `## Week of Mon DD`
- Whole period: no header, flat list
- One `-` bullet per clustered item
- 5-7 words max, past tense
- No metadata (no commit counts, branches, hashes)
- Ready to copy-paste into Jira

## File Structure

```
skills/worklog-report/SKILL.md    # Skill definition
commands/worklog.md               # Command stub pointing to skill
```

## Decisions

| Decision | Choice | Rationale |
|----------|--------|-----------|
| Implementation | Pure skill (no scripts) | Claude handles NLP and summarization natively |
| Date parsing | Natural language | Flexible, no date library dependency |
| Author filter | Auto-detect from git config | Handles shared repos, no manual config |
| Default grouping | By day | Most common for Jira daily worklogs |
| Clustering level | Moderate | Merges same-area commits, keeps distinct work separate |
| Verb style | Past tense, natural | Guidelines not mechanical mapping |
| Repo scope | Current by default, multi-repo via natural language | Simple default, flexible when needed |
| Output extras | None | Clean, paste-ready for Jira |
