# Worklog v2 (Session-Aware, Task-Centric) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Rewrite `skills/worklog/SKILL.md` to draw from both git history and Claude Code session logs, group work by Jira ticket under each day, optionally span repos, and emit deliverable-led terse bullets.

**Architecture:** A single zero-dependency `SKILL.md` (no committed script, no `project-setup/`). It ships an inline `python3` digest recipe the agent runs to extract human prompts from session transcripts, maps work to tickets (branch → text → cluster), and renders day → ticket bullets in a "Tight + brief why" voice. Validation is dogfood (the recipe is runnable; the prose is reviewed against the spec).

**Tech Stack:** Markdown (skill spec), `git log`, `python3` (stdlib only) for transcript scanning.

**Spec:** `docs/plans/2026-06-09-worklog-session-scan-design.md`

---

### Task 1: Rewrite `skills/worklog/SKILL.md` to v2

**Files:**
- Modify (full rewrite): `skills/worklog/SKILL.md`

- [ ] **Step 1: Overwrite the file with the complete v2 content below**

Write `skills/worklog/SKILL.md` with EXACTLY this content (the inner ```python fence is part of the file):

`````markdown
---
name: worklog
description: "Use when generating worklog summaries, time reports, or Jira work log entries from git history and Claude Code session logs"
---

# Worklog Report

## Overview

Generate concise, deliverable-oriented worklog bullets for Jira reporting, drawn from two sources for the chosen timespan: **git history** and **Claude Code session logs**. Work is grouped by **task (Jira ticket)** under each day. Session logs surface work that leaves little commit trace — planning, debugging, end-to-end validation, code review.

## Day Boundary

A "day" starts at 6AM, not midnight. All date ranges use 06:00:00 as the boundary:
- "Today" = today 6AM → now
- "Yesterday" = yesterday 6AM → today 6AM
- "This week" = Monday 6AM → now
- "From X to Y" = X at 6AM → Y+1 at 6AM

Day *grouping* uses this boundary too: work (commit or session) timestamped before 6AM counts as the previous day.

## Sources

Both are scanned by default for the timespan:
1. **Commits** — `git log` (see Process).
2. **Session logs** — Claude Code transcripts at `~/.claude/projects/<sanitized-cwd>/*.jsonl`, where `<sanitized-cwd>` is the repo's absolute path with every `/` replaced by `-` (e.g. `-Users-willvargas-Development-Sheetgo-agent-skills`). See Session Log Scanning.

## Process

1. Author: `git config user.email`.
2. If no date range given, ask with AskUserQuestion: Today, Yesterday, This week, Last 7 days, This month, Custom range.
3. Parse the range; apply the 6AM boundary to all dates.
4. **Commits:** `git log --all --author=<email> --since=<X>T06:00:00 --until=<Y>T06:00:00 --format="%ad %s" --date=short` (`--all` required). `<X>` and `<Y>` are the 6AM range bounds from Day Boundary, with `<Y>` EXCLUSIVE — e.g. "yesterday" → `<X>`=yesterday, `<Y>`=today; "from A to B" → `<X>`=A, `<Y>`=B+1. Multi-repo: `git -C <path> log ...`.
5. **Sessions:** run the digest recipe (Session Log Scanning) for the current repo's session dir over the timespan. If it yields nothing (e.g. no session dir), continue with commits only.
6. **Cross-repo:** detect other repos with activity in the window; if any, prompt (Cross-Repo).
7. **Map** every commit and session item to a ticket (Ticket Mapping).
8. **Cluster to reporting altitude:** roll related commits and session prompts up to the *outcome a product manager would track* — never one bullet per commit or micro-fix. Merge many small changes in one area into a single deliverable bullet. Target 2–5 bullets per ticket per day; if a ticket has more, the altitude is too low — cluster harder. Dedup near-identical items.
9. **Render** grouped by day → ticket (default), or ticket-flat when the user asks for "by task", "flat", or "group by ticket". See Output Format.
10. **Transform** each item into the Voice & Tone register.

## Session Log Scanning

Run this `python3` digest (portable; no `jq` dependency). It filters to the timespan, drops injected/duplicate prompts, and emits one compact JSON line per human prompt with its branch — **never read whole transcripts into context**:

```python
import json, sys, glob, os
from datetime import datetime
root, lo, hi = sys.argv[1], sys.argv[2], sys.argv[3]   # <session-dir> <lo-iso-local> <hi-iso-local>
lo_epoch = datetime.fromisoformat(lo).timestamp()
hi_epoch = datetime.fromisoformat(hi).timestamp()
INJECTED = ("Review this change for security vulnerabilities",
            "Base directory for this skill:", "Caveat:",
            "This session is being continued")
def epoch(ts):
    try: return datetime.fromisoformat(ts.replace('Z', '+00:00')).timestamp()
    except Exception: return None
seen, rows = set(), []
if os.path.isdir(root):
    for fp in sorted(glob.glob(os.path.join(root, '*.jsonl'))):
        if os.path.getmtime(fp) < lo_epoch: continue           # mtime prefilter (speed)
        with open(fp, encoding='utf-8') as fh:
            for line in fh:
                try:
                    d = json.loads(line)
                    if not isinstance(d, dict) or d.get('type') != 'user': continue
                except Exception: continue
                e = epoch(d.get('timestamp', ''))
                if e is None or not (lo_epoch <= e < hi_epoch): continue
                c = d.get('message', {}).get('content')
                txt = c if isinstance(c, str) else ' '.join(
                    b.get('text', '') for b in c
                    if isinstance(b, dict) and b.get('type') == 'text') if isinstance(c, list) else ''
                txt = txt.strip()
                if not txt or txt.startswith('<') or 'tool_result' in str(c)[:40]: continue
                if any(txt.startswith(p) for p in INJECTED): continue   # drop injected scaffolding
                key = txt[:80].lower()
                if key in seen: continue                                # collapse duplicates
                seen.add(key)
                day = datetime.fromtimestamp(e - 6*3600).strftime('%Y-%m-%d')  # 6AM-boundary worklog day (pre-6AM counts as previous day)
                rows.append((e, day, d.get('gitBranch', '') or '', txt.replace('\n', ' ')))
rows.sort()
for e, day, br, txt in rows:
    print(json.dumps({"date": day, "branch": br, "prompt": txt[:200]}))
```

Invoke per session dir, e.g.:
`python3 <recipe.py> ~/.claude/projects/-Users-willvargas-Development-Sheetgo-agent-skills 2026-06-08T06:00:00 2026-06-09T06:00:00`

Each digest line gives the work intent (`prompt`), the day (`date`), and the branch (→ ticket). Infer non-commit deliverables (planning, debugging, e2e walks, review) from the prompts. Output only derived bullets — never quote transcript text.

## Ticket Mapping

Map every commit and session item to a ticket, in this order:
1. **Branch:** extract `SG-\d+` from the branch — session entries use their per-line `gitBranch`; commits use their owning branch (commits in `<base>..<branch>`, base = `master`/`main`).
2. **Text:** if the branch has no ID (e.g. `release/*` bundles many tickets), scan commit subjects and prompts for an `SG-\d+`.
3. **Cluster:** no ID → group by topic/feature into a labeled bucket, rendered as `### <Topic>`.

## Cross-Repo

- **Default scope:** the current repo only (its sessions + its commits).
- While scanning, do a cheap `mtime` sweep of the other `~/.claude/projects/*` dirs for any `.jsonl` modified within the window.
- **Only if another repo shows activity**, ask with AskUserQuestion: "Include all your work this timespan across repos, or only <this repo>?"
  - Only this repo → ignore others.
  - All → for each active repo, run the session digest **and** `git -C <repo-path> log ...`, folding everything into the **same ticket blocks** (a card spanning repos = one block). Worktrees of one repo collapse automatically (work is keyed by ticket, not directory).
- The repo is never an output grouping axis — only used to find work.

## Output Format

**Default — day primary, task nested:**

```
## Jun 08
### SG-13200 — pricing & analytics
- Fixed /pricing so trialing PRO users convert via the billing portal, not a dead tile.
- Coerced empty plan fields to null in BigQuery logging, so analytics reads "unknown".
### Automations production setup
- Set up the production HubSpot and Okta apps for automations.
```

- Day header: `## MMM DD` (3-letter month + day, e.g. `Jun 08`; no weekday names). Week mode: `## Week of MMM DD`.
- Task sub-header: `### SG-XXXX — <short title>` (title from the branch slug; bare ID if none). No-ticket clusters: `### <Topic>`.

**Override — "by task" / "flat by task" (days collapsed, ticket primary):**

```
## SG-13200 — pricing & analytics
- Fixed /pricing so trialing PRO users convert via the billing portal.
- Coerced empty plan fields to null in BigQuery logging.
```

**Reporting altitude:** the bullets above are summaries, not a fix-by-fix log — a few outcome bullets per ticket. Default to this rolled-up level. Only if the user explicitly asks for "detailed" / "by item" / "full" should you drop to finer, one-bullet-per-change granularity.

## Voice & Tone

Register: plain, factual, past tense, no "I"/"we" — changelog/demo-caption voice. Lead with the **deliverable/outcome**, suppress the tool/file/command.

- **Altitude — report to a product manager, not a personal diary.** Each bullet is one meaningful unit of progress (a capability shipped, a problem solved, a milestone), absorbing the individual fixes beneath it — e.g. "Made trial→paid conversion work across the pricing funnel", not five separate tile/routing/logging fixes. If a reader can't see why it mattered, it's too low.
- **Length:** main clause ≤ ~10 words; an optional `so/that <effect>` tail only when the value isn't obvious; hard ceiling ~14 words. One idea per bullet — split rather than run long.
- **Abstraction:** name the capability or effect ("a command-approval bypass"), not the mechanism (`smart-compose.py`, `||` heredoc). Don't drift into value-speak.
- **Verbs** (never `ran`/`used`/`edited`/`worked on`): Added, Implemented, Enabled · Fixed, Resolved, Eliminated · Closed, Hardened, Enforced · Identified, Traced, Root-caused · Defined, Designed, Scoped · Validated, Verified, Confirmed · Documented, Reconciled, Aligned.
- **Non-commit work reads as deliverables**, e.g. "Designed the task-aware worklog.", "Identified the root cause of the heredoc bypass.", "Validated the full gate flow end to end."
- **Litmus (before emitting):** does it name a tool/file/action instead of what was delivered? Is it >~12 words with no concrete noun, or full of value-speak? → rewrite.

## Edge Cases

- **No branch / detached HEAD:** no `SG-` to extract → text fallback, then topic cluster.
- **No sessions or empty span:** the recipe yields nothing → continue with commits only.
- **Prompts with no `gitBranch`:** non-`user`/meta lines are already skipped; any remaining no-branch prompt clusters by topic.
- **Large spans:** the `mtime` prefilter skips untouched transcript files, so cost scales with active days, not full history.

## What NOT to Include

- No commit hashes, branch names, file names, tool/CLI names, or commit counts.
- No raw transcript text, conversation quotes, or session metadata — only derived bullets.
- No bold/backticks/inline code in bullets; no sub-bullets.
- No hedging ("helped", "contributed to") or business-speak ("leveraged", "drove alignment", "delivered value", "robust", "seamless").
- No "how this was produced" notes; no weekday names in headers.
`````

- [ ] **Step 2: Verify structure is intact**

Run: `grep -nE '^(name:|description:|## )' skills/worklog/SKILL.md`
Expected: `name:` + `description:` frontmatter, and these `## ` headers in order — Overview, Day Boundary, Sources, Process, Session Log Scanning, Ticket Mapping, Cross-Repo, Output Format, Voice & Tone, What NOT to Include.

- [ ] **Step 3: Commit**

```bash
git add skills/worklog/SKILL.md
git commit -m "feat: Rewrite worklog to scan session logs and group by ticket"
```

---

### Task 2: Validate the embedded recipe + dogfood dry run

This is the test: the recipe must run clean and produce a usable digest, and the rendered worklog must follow the day→ticket structure and voice.

**Files:**
- Test (scratch): `/tmp/wl-recipe.py` (copy of the recipe block from the SKILL.md)

- [ ] **Step 1: Extract the recipe to a scratch file**

Copy the `python3` block from `skills/worklog/SKILL.md`'s "Session Log Scanning" section into `/tmp/wl-recipe.py`.

- [ ] **Step 2: Run it on this repo (today) — expect a non-empty JSON digest, exit 0**

Run: `python3 /tmp/wl-recipe.py ~/.claude/projects/-Users-willvargas-Development-Sheetgo-agent-skills 2026-06-09T06:00:00 2026-06-10T06:00:00`
Expected: one JSON object per line, each with `date`, `branch`, `prompt`; injected/duplicate prompts absent; exit 0.

- [ ] **Step 3: Run it on `sheetgo-automations` (yesterday) — expect SG-13200-era prompts**

Run: `python3 /tmp/wl-recipe.py ~/.claude/projects/-Users-willvargas-Development-Sheetgo-sheetgo-automations 2026-06-08T06:00:00 2026-06-09T06:00:00`
Expected: digest lines on branch `release/penguin-mafia-update`; no `Review this change for security vulnerabilities` or `Base directory for this skill:` lines (filtered).

- [ ] **Step 4: Manually render and eyeball**

Following the SKILL.md Process, render the `sheetgo-automations` digest + `git -C ../sheetgo-automations log` for the same window into the Output Format. Confirm: day header `## Jun 08`; ticket sub-headers (`### SG-13200 …` via commit-text fallback, plus a `### <Topic>` cluster for the no-ID automations work); bullets follow the Voice & Tone rules (≤~10-word clause, deliverable-led, no tool/file names). No commit required (validation only).

---

### Task 3: Refresh the README worklog descriptions

**Files:**
- Modify: `README.md` (Skills table row and Commands table row for worklog)

- [ ] **Step 1: Update the Skills-table row**

Replace:
`| \`worklog\` | Generate worklog summaries / time reports from git history for Jira reporting. |`
With:
`| \`worklog\` | Generate deliverable-focused worklogs for Jira from git history + Claude Code session logs, grouped by ticket. |`

- [ ] **Step 2: Update the Commands-table row**

Replace:
`| \`/worklog\` | Generate a worklog summary from git history for Jira reporting. |`
With:
`| \`/worklog\` | Generate a ticket-grouped worklog from git history + session logs for Jira reporting. |`

- [ ] **Step 3: Verify both rows changed**

Run: `grep -n "worklog" README.md`
Expected: both rows now mention session logs / ticket grouping.

- [ ] **Step 4: Commit**

```bash
git add README.md
git commit -m "docs: Update worklog README entries for v2 session scanning"
```

---

## Self-Review

**Spec coverage:** Sources (Task 1 §Sources/Process) ✓ · session extraction + refinements (§Session Log Scanning + recipe filters injected/dup) ✓ · ticket mapping branch→text→cluster (§Ticket Mapping) ✓ · cross-repo default+prompt+fold (§Cross-Repo) ✓ · output day→ticket + by-task override (§Output Format) ✓ · voice "Tight + brief why" (§Voice & Tone) ✓ · privacy/no-transcript (§What NOT to Include) ✓ · dogfood validation (Task 2) ✓ · README (Task 3) ✓. No gaps.

**Placeholder scan:** Recipe is complete and runnable; all section content is literal; no TBD/TODO. The `<short title>` / `<Topic>` / `<this repo>` tokens are intentional output templates, not plan gaps.

**Type/name consistency:** session dir path form (`~/.claude/projects/<sanitized-cwd>`), ticket regex (`SG-\d+`), recipe arg order (`<session-dir> <lo-iso> <hi-iso>`), and header levels (`##` day / `###` ticket) are consistent across all sections and tasks.
