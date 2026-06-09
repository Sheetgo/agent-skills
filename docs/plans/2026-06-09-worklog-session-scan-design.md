# Worklog v2 — Session-Aware, Task-Centric Worklog — Design

> **Status**: Approved (brainstorming complete) — pending implementation plan
> **Author**: Willian Vargas (with Claude Opus 4.8)
> **Date**: 2026-06-09

## Context & Problem

The current `worklog` skill builds a Jira-oriented worklog from **git history only**, grouped by **day**, in a voice that is **too tooling-centric and technical**. Two gaps:

1. **Missing non-commit work.** Brainstorming, debugging, planning, end-to-end validation, and code review leave little or no commit trace, yet they are real logged work. That context lives in Claude Code **session transcripts**.
2. **Wrong organizing axis and voice.** The primary purpose is **logging work on Jira cards**, so work should be grouped by **task/ticket**, and bullets should read as **deliverables** — concise, outcome-led — not as tool invocations or long business-speak sentences.

## Goals

- Add **session-log scanning** as a second, always-on source for the chosen timespan, surfacing non-commit work.
- Organize output around **tasks (Jira tickets)** nested under days.
- Support **optional cross-repo** gathering — a card's work can span repositories.
- Adopt a **deliverable-led, terse voice** ("Tight + brief why").
- Keep `worklog` a **zero-dependency, single-`SKILL.md`** skill (no committed script, no `project-setup/`).

## Non-Goals

- No committed helper script or `project-setup/` directory.
- No quoting of raw transcript/conversation content in the output.
- No change to the 6 AM day boundary or the existing multi-repo `git -C` commit capability.

## Data Model — where session logs live

Claude Code stores transcripts **globally, partitioned per working directory**:

```
~/.claude/projects/<sanitized-cwd>/<session-uuid>.jsonl
```

`<sanitized-cwd>` is the project's absolute path with every `/` replaced by `-` (e.g. `-Users-willvargas-Development-Sheetgo-agent-skills`). Each `.jsonl` is NDJSON (one JSON object per line). Relevant fields observed on entries:

- `type` — `user`, `assistant`, plus meta (`attachment`, `file-history-snapshot`, `system`, `mode`, …).
- `timestamp` — ISO-8601 UTC (`2026-06-09T12:36:16.945Z`).
- `gitBranch` — e.g. `feat/SG-13911-fix-issues-v4-universal-properties` (present on ~72% of entries; the rest are meta/sidechain).
- `cwd` — the repo path.
- `message.content` — for `type:user`, either a text string (a human prompt) or a list of blocks; **tool-result and sidechain entries must be skipped**.

**Ticket extraction:** `gitBranch` → `SG-\d+` regex → ticket (e.g. `SG-13911`).

This global-but-partitioned layout is exactly what enables both the **default this-repo** scan and the **optional cross-repo** scan.

## Sources (both default-on for the chosen timespan)

- **Commits** (existing): `git log --all --author=<email> --since=<X>T06:00:00 --until=<Y>T06:00:00`, 6 AM boundary, multi-repo via `git -C`.
- **Session logs** (new): scan the current repo's `~/.claude/projects/<dir>/*.jsonl`, filter entries to the timespan, extract human prompts + `gitBranch`. This captures non-commit work.

The two sources are **merged** into one bullet stream per (day, ticket), then deduplicated.

## Ticket mapping — branch → text → cluster

1. **Branch (preferred).**
   - *Sessions:* per-entry `gitBranch` → `SG-####`.
   - *Commits:* attribute to the ticket of their **owning branch** — for each local branch carrying a ticket ID, commits in `<base>..<branch>` (base = the repo's default branch, `master` or `main`) map to that ticket. Commits only on the base branch fall through.
2. **Text fallback.** Scan commit subjects and session prompts for an explicit `SG-####`.
3. **Cluster fallback.** No ticket → cluster by topic/feature into a labeled bucket rendered as `### <Topic>` (e.g. `### Tooling cleanup`).

## Output structure

**Default — day primary, ticket nested:**

```
## Feb 24
### SG-13911 — fix-issues v4
- Closed a bypass that auto-approved unsafe commands.
- Aligned the fix-issues gate with its template so sessions stop failing.
### Tooling cleanup
- Tidied repo docs and ignore rules.

## Feb 25
### SG-13911 — fix-issues v4
- Hardened gate parsing against malformed input.
```

- Day header: `## Mon DD` (existing format; no weekday names).
- Ticket sub-header: `### SG-XXXX — <short title>` (title derived from the branch slug; bare ID if none). No-ticket clusters use `### <Topic>`.

**Override — "by task" / "flat by task" — ticket primary, days collapsed:**

```
## SG-13911 — fix-issues v4
- Closed a bypass that auto-approved unsafe commands.
- Aligned the fix-issues gate with its template so sessions stop failing.
- Hardened gate parsing against malformed input.
```

The existing "whole period" and "by week" modes still apply; "by task" is the new override that ignores day boundaries.

## Cross-repo mechanism (the optional second mechanism)

- **Default scope:** the current repo only — its session dir + its commits.
- **Discovery:** while scanning sessions, do a *cheap* `mtime` sweep of the other `~/.claude/projects/*` dirs for any `.jsonl` modified within the timespan.
- **Prompt only when another repo shows activity** (`AskUserQuestion`): *"Include all your work this timespan across repos, or only this one?"*
  - **Only this repo** → ignore the others.
  - **All** → for each active repo, scan its sessions **and** pull its commits (`git -C <repo-path>`), folding everything into the **same ticket blocks**. A card spanning `web-app` + `core-api` becomes one block.
- **Worktrees collapse automatically** — work is keyed by ticket, not directory, so `as-add-on`, `as-add-on-bugfixes`, etc. merge by their ticket.
- The repo is **never** an output grouping axis; it is only used to *find* work.

## Extraction mechanics (pure SKILL.md, token-safe)

No committed script. The `SKILL.md` instructs the agent to:

1. Resolve the timespan to ISO bounds with the 6 AM boundary.
2. List candidate session dirs (this repo by default; others only if cross-repo accepted).
3. **`mtime`-prefilter** `.jsonl` files — skip any not modified in the window.
4. Extract a **compact digest** with `python3` (preferred for portability; `jq` acceptable): for entries whose `timestamp` is in-bounds **and** `type == "user"` **and** `message.content` is human text (skip tool-results, sidechains, meta), emit `{date, gitBranch, prompt}`; optionally include a per-branch count of assistant tool actions as a signal of effort.
5. **Filter injected scaffolding (refinement).** Some `type:user` entries are command/skill-injected prompts, not human intent — e.g. slash-command templates (`Review this change for security vulnerabilities…`), skill-load banners (`Base directory for this skill: …`), continuation/caveat boilerplate. Drop entries matching known injected prefixes, and **collapse exact/near-duplicate** prompt texts (a repeated command fires many identical lines). In a Jun-08 dry run this removed 9 injected + 6 duplicate prompts out of 53.
6. **Never read whole transcripts into context** — only the digest.

The skill ships the exact `python3` recipe so extraction is deterministic, not freeform.

## Privacy

Output contains only **derived bullets** — no transcript quotes, no conversation metadata, no "how this was produced" notes (consistent with the existing "What NOT to include").

## Voice & Tone spec — "Tight + brief why"

**Register.** Plain, factual, past tense, no subject pronoun ("I"/"we"). Changelog / demo-caption voice. No hedging ("helped", "contributed to"), no business-speak ("leveraged", "drove alignment", "delivered value", "robust", "seamless").

**Core rule.** Lead with the **deliverable/outcome**; suppress the tool, file, and command. Pattern: `[tool/activity] → [capability/fix that now exists]`.

- **Altitude.** Report at product-manager level — a few outcome bullets per ticket that roll up the individual commits/fixes, not a fix-by-fix diary. Target 2–5 bullets per ticket per day; cluster harder if more.

**Length.** Main clause **≤ ~10 words**; an optional `so/that <effect>` tail **only when the value isn't obvious**. **Hard ceiling ~14 words.** One idea per bullet — if it needs more, split into two bullets, never one long sentence.

**Abstraction line.** Name the capability or effect ("a command-approval bypass"), not the mechanism (`smart-compose.py`, `||` heredoc, `check-fix-gate.cjs`). Don't float up into vague value-speak. A Jira ID is context, not the outcome — still state what was done.

**Verb palette (avoid `ran`/`used`/`edited`/`worked on`):**

| Work kind | Verbs |
|---|---|
| Shipped feature | Added, Introduced, Implemented, Enabled |
| Fixed defect | Fixed, Resolved, Corrected, Eliminated |
| Hardened / secured | Closed, Tightened, Hardened, Enforced |
| Investigated | Identified, Traced, Root-caused, Isolated |
| Designed / planned | Defined, Designed, Scoped, Drafted |
| Verified | Validated, Verified, Confirmed |
| Documented | Documented, Reconciled, Aligned |

**Non-commit work reads as deliverables**, e.g.:
- `Designed worklog to group work by ticket from session history.`
- `Identified root cause of the heredoc command-approval bypass.`
- `Validated the full bug-fix gate flow end to end.`
- `Reviewed code-review scripts; surfaced three correctness defects.`

**Litmus test (apply before emitting any bullet):** *Does it name a tool/file/action instead of what was delivered? Is it >~12 words with no concrete noun, or full of value-speak?* → rewrite.

**Before → after (real work):**

| Raw / tooling-centric | Over-long fluffy | IDEAL |
|---|---|---|
| ran smart-compose tests; fixed `||` heredoc bypass | Addressed a significant security vulnerability in the command-composition approval logic to improve overall safety | Closed a bypass that auto-approved unsafe commands. |
| edited check-fix-gate.cjs for markdown edge cases | Drove improvements to the markdown parsing layer to enhance robustness across scenarios | Hardened gate parsing against malformed input. |
| reconciled SKILL.md docs after refactor | Performed a thorough reconciliation of documentation assets to reflect current state | Reconciled skill docs with shipped behavior. |

## Edge cases

- **Boundary-spanning sessions / branch switches:** attribute each entry by its own `timestamp` (day) and `gitBranch` (ticket).
- **Detached HEAD / no branch:** text → cluster fallback.
- **Entries without `gitBranch`:** meta/sidechain — skipped for mapping.
- **No sessions / empty span:** degrade gracefully to commits-only.
- **Large spans:** the `mtime` prefilter bounds cost; note scope if very large.
- **Dedup by outcome (refinement):** commit work and the session prompts that *drove* it are the same deliverable — collapse them to one bullet per outcome within a (day, ticket), rather than emitting both a commit-derived and a prompt-derived line. Dedup on the outcome, not the source.
- **Release/umbrella branches carry multiple tickets:** a `release/*` (or long-lived) branch bundles work for several tickets, so branch-first yields no ID — rely on the text fallback (commit/prompt `SG-####`) per cluster, and topic-cluster the remainder. (Observed in the `sheetgo-automations` dry run: pricing work resolved to SG-13200 via commit text; the HubSpot/Okta automations work had no ID and became a topic cluster.)

## What changes in `SKILL.md`

Single file, still zero-dependency. Update the `description` frontmatter to mention session logs; rewrite **Process** and **Output Format**; add **Session Scanning**, **Ticket Mapping**, **Cross-repo**, and **Voice & Tone** sections; replace the day-only grouping with day → ticket (+ "by task" override).

## Validation

This is a prose skill (no code), so validation is **dogfood**: run `worklog` over a recent span on this repo and confirm (a) day → ticket grouping, (b) the "Tight + brief why" voice, (c) session-derived non-commit work appears, (d) the "by task" override flattens correctly, and (e) the cross-repo prompt fires when another repo has timespan activity.
