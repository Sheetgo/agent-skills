# Worklog Report Skill — Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Create a skill that generates concise worklog bullet points from git history for Jira reporting.

**Architecture:** Pure skill (SKILL.md) + command stub. Claude interprets natural language dates, runs git log, clusters commits, and formats output. No helper scripts.

**Tech Stack:** Git CLI, Claude natural language processing, Markdown output

---

## Task 1: RED — Baseline Test (No Skill)

Test what Claude does WITHOUT the skill to identify gaps and rationalizations.

**Step 1: Run baseline pressure scenario**

Use a subagent (Task tool, subagent_type: general-purpose) with this prompt — do NOT include any skill content:

```
You are working in the repo at /Users/willvargas/Development/Sheetgo/agent-skills.

The user says: "Give me a summary of our work from Feb 20 to Feb 26 for my Jira worklog. Brief bullet points, max 5-7 words each. Group by day. Cluster similar items."

Do this using only git log data. Output the worklog report.
```

**Step 2: Document baseline behavior**

Record verbatim:
- Did it auto-filter by author?
- Did it group by day?
- Were bullets 5-7 words or verbose?
- Did it cluster similar commits?
- Did it use past tense?
- Did it add unwanted metadata (hashes, branches)?
- What rationalizations or shortcuts did it take?

**Step 3: Identify gaps**

List every behavior that deviated from the design. These become the specific things the skill must address.

---

## Task 2: GREEN — Write SKILL.md

**Files:**
- Create: `skills/worklog-report/SKILL.md`

**Step 1: Write the skill**

The SKILL.md must address every gap identified in Task 1. Core structure:

```yaml
---
name: worklog-report
description: "Use when generating worklog summaries, time reports, or Jira work log entries from git history"
---
```

Sections to include:
1. **Overview** — one-line purpose
2. **Invocation** — natural language date examples, repo path examples
3. **Process** — numbered steps:
   - Get author via `git config user.email`
   - Parse date range from natural language
   - Run `git log --author=<email> --since=<X> --until=<Y> --format="%ad %s" --date=short`
   - For multi-repo: `git -C <path> log ...`
   - Group by time period (default: day)
   - Cluster similar commits (moderate level)
   - Transform to past tense (natural, not mechanical)
   - Compress to 5-7 words per bullet
   - Deduplicate
4. **Output format** — exact template with day headers, bullet format
5. **Verb guidelines** — type-to-verb mapping as guidelines, explicit "pick most natural" instruction
6. **Grouping options** — day (default), hour, week, whole period
7. **Multi-repo** — how to handle `from <path>` and `and <path>`
8. **What NOT to include** — no hashes, no branches, no commit counts, no Claude context

Keep under 300 words. Reference the design doc format rules exactly.

**Step 2: Commit**

```bash
git add skills/worklog-report/SKILL.md
git commit -m "feat: Add worklog-report skill"
```

---

## Task 3: GREEN — Write command stub

**Files:**
- Create: `commands/worklog.md`

**Step 1: Write the command stub**

Follow existing pattern (see `commands/squash-commits.md` or `commands/start-work.md`):

```markdown
---
description: "Generate worklog summary from git history for Jira reporting."
---

Invoke the worklog-report skill at ~/.claude/skills/worklog-report/SKILL.md and follow it exactly. Arguments: {ARGUMENTS}
```

**Step 2: Commit**

```bash
git add commands/worklog.md
git commit -m "feat: Add /worklog command stub"
```

---

## Task 4: GREEN — Verify With Skill

**Step 1: Run same scenario WITH skill**

Use a subagent (Task tool, subagent_type: general-purpose) with this prompt, this time including the full SKILL.md content:

```
You have the following skill loaded:

<skill>
[paste full SKILL.md content here]
</skill>

You are working in the repo at /Users/willvargas/Development/Sheetgo/agent-skills.

The user says: "/worklog from Feb 20 to Feb 26"

Follow the skill exactly and produce the worklog report.
```

**Step 2: Compare against baseline**

Verify every gap from Task 1 is now addressed:
- [ ] Auto-filters by author
- [ ] Groups by day with `## Mon DD` headers
- [ ] Bullets are 5-7 words max
- [ ] Past tense, natural verbs
- [ ] Similar commits clustered
- [ ] No metadata (hashes, branches, counts)
- [ ] Clean, paste-ready output

**Step 3: Test edge cases**

Run additional subagent scenarios:
- `/worklog today` — single day
- `/worklog last week by week` — week grouping
- `/worklog from Feb 1 to Feb 26 whole period` — flat list

---

## Task 5: REFACTOR — Close Loopholes

**Step 1: Identify new rationalizations**

From Task 4 testing, document any:
- Verbosity beyond 7 words
- Mechanical verb mapping (always "Added" for feat)
- Metadata leaking through
- Poor clustering (too aggressive or too light)
- Missing author filter

**Step 2: Update SKILL.md**

Add explicit counters for each rationalization found. Examples:
- If verbose: add "STRICT: 5-7 words. Count them."
- If mechanical: add "NEVER use the same verb for every feat commit"
- If metadata leaks: add to "What NOT to include" section

**Step 3: Re-test**

Run Task 4 scenarios again. Repeat until no new issues.

**Step 4: Commit**

```bash
git add skills/worklog-report/SKILL.md
git commit -m "fix: Close loopholes in worklog-report skill"
```

---

## Task 6: Final Verification & Cleanup

**Step 1: Run full end-to-end test**

Invoke `/worklog from Feb 20 to Feb 26` as a real user would (not subagent). Verify output matches design spec.

**Step 2: Verify file structure**

```
skills/worklog-report/SKILL.md    ✓
commands/worklog.md               ✓
```

**Step 3: Update CLAUDE.md if needed**

If any repo-wide documentation needs updating (e.g., adding worklog-report to a skill listing), do it now.

**Step 4: Final commit if changes made**

```bash
git add -A
git commit -m "docs: Finalize worklog-report skill"
```
