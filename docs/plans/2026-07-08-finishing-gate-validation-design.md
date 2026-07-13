# Design: Three-Gate Finishing Checkpoint (v2)

Date: 2026-07-08
Status: Approved (brainstorming + adversarial review) — pending implementation
Components:
- `hooks/session-checkpoint.py` (rewritten)
- `skills/code-review/scripts/gate-lib.cjs` (new — shared)
- `skills/code-review/scripts/check-validation.cjs` (new)
- `skills/code-review/scripts/record-validation.cjs` (new)
- `skills/code-review/scripts/check-marker.cjs` (extended: `--allow-docs-ancestor`)
- `skills/code-review/project-setup/git-push-gate-hook.sh` (extended)

> **v2 changelog** — revised after a 4-lens adversarial review (correctness,
> security, workflow, repo-consistency). Major changes from v1: (1) tolerance
> now verifies real ancestry via `git merge-base --is-ancestor` and fails
> **closed** on any git error (v1's bare diff was a false-allow hole); (2)
> `is_docs_only` narrowed to `.claude/sessions/` and made path-component
> anchored; (3) evidence rules hardened (artifact containment/type/size,
> backend now needs a log artifact, `changeClass` cross-checked against the
> diff); (4) **one shared checker module** consumed by both the finishing hook
> and the push-gate — resolves the finish-vs-push double-gating contradiction
> and eliminates dual-language rule drift; (5) bypass is env-var-only + logged;
> (6) added `changeClass: other` for config/infra; (7) expanded fail-open table
> and docs footprint.

## Context & Problem

`hooks/session-checkpoint.py` is a `PreToolUse` hook on the `Skill` tool. It
intercepts `finishing-a-development-branch` and **denies** it unless a docs
marker exists at `.claude/sessions/{sanitized-branch}/session-persist-done`.
That is the only gate today — a branch can be "finished" with no `/code-review`
run and no executed validation of the change.

Goal: finishing requires three things — **documentation updated, code reviewed,
and the change actually validated with real evidence** (Playwright walk +
screenshot for UI, executed tests for backend, e2e for full-stack).

## The Fundamental Constraint (and the honest trust model)

A hook runs in milliseconds and can only **inspect state**. It cannot launch
Playwright, run tests, or drive e2e. "Gate on validation" therefore means: a
skill/step performs the validation and writes an **evidence marker**; the hook
verifies the marker and the evidence it points at (files present, contained,
non-empty; exit codes zero).

The agent has unrestricted filesystem write (no `Write`/`Edit` hook is
registered), so it *could* fabricate any marker. This gate is therefore **not
tamper-proof against the agent** — it makes doing the real work the default path
and makes skipping **conspicuous and logged**. That is the same trust model as
the existing `code-review-passed` marker and the `[skip-review]` push bypass.
We harden the evidence bar enough that a bare `touch`/`echo '{}'` cannot pass,
and we log every bypass — but we do not pretend it is unforgeable.

## Goals

1. Finishing requires three gates; deny with actionable, single-pass feedback if
   any fail.
2. Reuse `/code-review`'s existing `code-review-passed-<sha>` marker for the
   review gate.
3. Add a type-aware validation gate (`ui`/`backend`/`fullstack`/`other`) that
   checks **real, contained, non-empty artifacts** — not just a marker's
   existence.
4. One authoritative implementation of marker/evidence logic, shared by the
   finishing hook and the push-gate, so the two never disagree and rules can't
   drift.
5. Handle sha-staleness so the normal order (review → validate → persist docs →
   finish → push) is not self-defeating.
6. Never block a legitimately docs-only branch.
7. A single, loud, logged bypass for genuinely un-validatable changes.

## Non-Goals

- Making `/code-review` always run Layer 4 (its both-clean short-circuit is a
  deliberate speed optimization). Validation is a separate gate/marker.
- Expanding the finishing-hook matcher beyond `finishing-a-development-branch`.
- Requiring validation evidence at **push** time by default (opt-in only — see
  §Push-gate).

## Architecture Overview

```
                         skills/code-review/scripts/
                         ┌─────────────────────────────────────┐
                         │ gate-lib.cjs  (single source of truth)│
                         │  • resolveGit(repoRoot)               │
                         │  • isDocsOnly(path)                   │
                         │  • findValidMarker(prefix,{ancestor}) │
                         │  • validateEvidence(marker)           │
                         │  • EVIDENCE_RULES table               │
                         └───────────────┬───────────────────────┘
             ┌───────────────────────────┼───────────────────────────┐
             ▼                           ▼                            ▼
   check-marker.cjs           check-validation.cjs          record-validation.cjs
   (code-review-passed)       (validation-passed)           (writes validation-passed)
             ▲                           ▲                            ▲
             │ node subprocess           │ node subprocess            │ node (stdin JSON)
   ┌─────────┴───────────────────────────┴──────────┐        called by the validation step
   │ session-checkpoint.py (finishing gate)          │
   │   Gate 1 docs (Python)  Gate 2 review  Gate 3 val│
   └──────────────────────────────────────────────────┘
   ┌──────────────────────────────────────────────────┐
   │ git-push-gate-hook.sh (push gate)                  │
   │   check-marker --allow-docs-ancestor               │
   │   [+ check-validation if CODE_REVIEW_REQUIRE_VALIDATION=1]
   └──────────────────────────────────────────────────┘
```

`gate-lib.cjs` is the ONLY place the ancestry-tolerance and evidence rules live.
`record-validation.cjs` validates with the same `validateEvidence` it will be
checked by — parity by construction, no dual implementation.

The finishing hook stays Python for Gate 1 (a plain file check) and **shells to
`node`** for Gates 2 & 3. The repo already depends on Node for the code-review
scripts, and the push-gate already shells to `check-marker.cjs`, so this is
consistent. If `node` or a checker script is absent (code-review skill not
installed), the affected gate **fails open with a logged note** (see §Fail-Open)
— mirroring the push-gate's `checker_not_found` behavior.

## The Three Gates

| Gate | Marker | Keyed to | Written by | Checked by |
|---|---|---|---|---|
| 1. Docs | `.claude/sessions/{sanitized-branch}/session-persist-done` | branch | `/session-persist` | Python (in hook) |
| 2. Review | `<git-common-dir>/code-review-passed-<sha>` | sha (+docs-ancestor) | `/code-review` PUSH READY | `check-marker.cjs --allow-docs-ancestor` |
| 3. Validation | `<git-common-dir>/validation-passed-<sha>` (JSON) | sha (+docs-ancestor) | `record-validation.cjs` | `check-validation.cjs --allow-docs-ancestor` |

`{sanitized-branch}` = `branch.replace("/", "%2F")` — same encoding as every
other session-state path (CLAUDE.md Session State; this hook shipped a
`/`→`-` collision bug before, FIX-014 — do not reintroduce it).

## Gate 3: The Validation Marker

### Schema — `validation-passed-<sha>` (JSON, in git-common-dir)

```json
{
  "sha": "<full HEAD sha at record time>",
  "changeClass": "ui | backend | fullstack | other",
  "checks": [
    { "kind": "playwright|screenshot|e2e|test|unit|integration|clasp|smoke|build|lint",
      "command": "npm run test:e2e -- login.spec.ts",
      "exitCode": 0,
      "artifacts": ["docs/validation/<sha>/login-step3.png"] }
  ],
  "noAutomatableCheck": false,
  "rationale": "",
  "createdAt": "<ISO 8601>"
}
```

### Evidence rules (in `gate-lib.validateEvidence`; enforced identically by recorder and checker)

Schema strictness (fail closed on any violation):
- Top-level is an object; `changeClass` ∈ {ui, backend, fullstack, other}.
- `checks` is a **non-empty** array (unless `changeClass: other` + `noAutomatableCheck: true`).
- Each check: object; `kind` ∈ the enum above; `exitCode` is a JSON **number**
  and `=== 0`; `command` a non-empty string; `artifacts` an array of strings.
- The `command` field is **display-only and is NEVER executed** by any component.

Artifact validation (each path in `artifacts`):
- **Reject absolute paths** and any path that, once normalized, escapes the repo
  root (`..` traversal).
- Resolve symlinks (`realpath`) and re-verify the real path is inside repo root.
- Must be a **regular file** (`isFile()`), **non-zero size**, and located under
  `docs/validation/`.

Minimum evidence per `changeClass`:
- `ui` → ≥1 check of kind `playwright`/`screenshot`/`e2e` **with ≥1 valid artifact**.
- `backend` → ≥1 check of kind `test`/`unit`/`integration`/`clasp`/`smoke`,
  `exitCode 0`, **with ≥1 valid artifact** (a captured run-log under
  `docs/validation/<sha>/`). (v1 required no artifact here — closed.)
- `fullstack` → satisfies both `ui` and `backend` minimums (one `e2e` check with
  an artifact counts for both).
- `other` → ≥1 check of kind `smoke`/`build`/`lint`/`test`, `exitCode 0`, with a
  log artifact; **OR** `noAutomatableCheck: true` + a non-empty `rationale`
  (honest attestation for genuinely un-automatable changes — logged, not silent).

`changeClass`-vs-diff cross-check (anti-mislabel):
- Resolve base (see §Docs-only branch skip). If the changed set vs base
  **unambiguously** contains UI files (extensions `.vue/.jsx/.tsx/.svelte/.css/
  .scss` or a path component `components`) but `changeClass` provides no UI
  evidence → **fail** with an explaining reason. Conservative: only the
  clear-cut case is enforced, and if base can't be resolved the cross-check is
  skipped (never a false block).

### Recorder — `record-validation.cjs`

Reads the payload (`changeClass`, `checks`, optional `noAutomatableCheck`/
`rationale`) from **stdin**. Resolves HEAD via `gate-lib`. Runs
`validateEvidence` — on failure prints a one-line reason and exits non-zero with
**no marker written**. On success: stamps `sha` + `createdAt`, writes
`<git-common-dir>/validation-passed-<sha>`, prunes stale `validation-passed-*`.

Documented usage (appears verbatim in the deny message):

```bash
node ~/.claude/skills/code-review/scripts/record-validation.cjs <<'JSON'
{ "changeClass": "ui",
  "checks": [ { "kind": "playwright",
                "command": "npm run test:e2e -- login.spec.ts",
                "exitCode": 0,
                "artifacts": ["docs/validation/login-step3.png"] } ] }
JSON
```

### Checker — `check-validation.cjs [--repo-root X] [--allow-docs-ancestor]`

Uses `gate-lib.findValidMarker('validation-passed-', {allowDocsAncestor})`. If a
marker is found, reads it (size-capped — reject files > 64 KB before parsing),
parses inside a try that catches **all** errors (not just `JSONDecodeError`),
runs `validateEvidence`. Exit `0` valid / `1` missing-or-invalid / `2` infra
error. Prints a one-line reason to stdout.

## Shared Checker & Docs-Only Tolerance (`gate-lib.findValidMarker`)

For prefix `P` (e.g. `code-review-passed-`), and current `headSha`:

1. **Exact:** if `<gitDir>/P<headSha>` exists → return it. (Fast path; also what
   the push-gate needs for the no-docs-commit case.)
2. **Docs-only ancestor** (only if `allowDocsAncestor`): for each file
   `P<sha>` in the git dir:
   - Run `git merge-base --is-ancestor <sha> HEAD`. **Must exit 0** (real
     ancestry). Any non-zero/error → skip this candidate. (v1 omitted this — a
     bare `git diff` between unrelated commits was a false-allow hole.)
   - Run `git diff --name-only <sha> HEAD`. On **any** error, or if the output
     is **empty**, → skip this candidate (never treat "no output" as
     "all docs-only" — that vacuous-truth path was a v1 hole).
   - If every changed path satisfies `isDocsOnly` → return this candidate.
3. Return `null` if none matched.

`isDocsOnly(path)` (path-component anchored, POSIX):
- `parts[0] === 'docs'`, OR
- `parts[0] === '.claude' && parts[1] === 'sessions'` (session-state only — NOT
  all of `.claude/`, which contains `settings.json`/hook registrations), OR
- basename lowercased ends with `.md`.

Substring matching is forbidden (`src/docs/x.ts`, `vendor/adocs/build.js` must
NOT match). `git diff --name-only` reports a rename as its destination path
only, so no two-path parsing is needed.

**2-dot vs 3-dot:** the ancestor tolerance uses **two-dot** `git diff A HEAD`
guarded by `--is-ancestor` (tree diff of a proven ancestor). The docs-only
branch skip below uses **three-dot** `A...HEAD` (changes since divergence).

## Docs-Only Branch Skip

If the whole branch diff vs its base is docs-only, Gates 2 & 3 are skipped (a
docs-only branch must not be blocked demanding Playwright).

Base resolution order: `git merge-base HEAD origin/HEAD` → `origin/main` →
`origin/master` → `main` → `master`; if `origin/HEAD` is unset, also try
`git symbolic-ref --quiet refs/remotes/origin/HEAD` and `git config
init.defaultBranch`. If **no** base resolves → **do not skip** (require the
gates) AND the deny message explicitly points at the bypass, because such a
branch may have no sha to attach markers to (documented escape, not a silent
deadlock). If base resolves: `git diff --name-only base...HEAD`, all
`isDocsOnly` → skip Gates 2 & 3.

## Staleness, Run Order & Adjacent Skills

**Golden order:** `/code-review` (fix-loop to PUSH READY) → validate (write
Gate-3 marker) → `/session-persist` (commits docs under `docs/plans/`, drops the
gitignored Gate-1 marker) → finish → push. The docs commit moves HEAD; the
docs-only ancestor tolerance keeps Gates 2 & 3 valid at the new HEAD, and — via
the shared checker — the **push-gate honors the same tolerance**, so finish and
push agree (this was the v1 contradiction).

**`/squash-commits` interaction (documented):** squash does `git reset --soft`
+ re-commit, which **rewrites SHAs**, staling Gates 2 & 3. Rule: **squash
BEFORE code-review/validation, not after.** Documented in the design, CLAUDE.md,
and a one-line note in `skills/squash-commits/SKILL.md`.

**FIX FIRST cost (documented):** a code-review fix commit correctly re-arms
Gates 2 & 3 — each fix cycle costs a fresh validation pass. This is convergent,
not a loop, but it is real friction on UI-heavy branches; the design flags it as
expected cost.

**Gate-1 staleness (accepted, out of scope):** the docs marker is branch-keyed,
so it does not re-arm when new code commits land. Kept as-is (pre-existing
session-persist contract); noted as a known asymmetry.

**Step-1 overlap (documented):** `finishing-a-development-branch` Step 1 runs the
full test suite itself. To avoid a contradictory second run, guidance: for
`backend`/`fullstack`, the recorded check `command` should be the **same** suite
command Step 1 uses, so passing the gate predicts Step 1 passing. (We can't edit
the plugin skill; this is guidance in the deny message + docs.)

## Deny UX + Bypass

The deny message enumerates **all** failing gates at once with exact remediation
and the golden order. Drafted text:

```
🚫 This branch isn't ready to finish. <N> of 3 gates are not satisfied for HEAD <short-sha>:

  [1] Documentation  — <PASS | MISSING>
      Run /session-persist to capture discoveries/decisions and drop the marker.
  [2] Code review     — <PASS | MISSING/STALE: reason>
      Run /code-review; resolve FIX FIRST / DEFER verdicts until PUSH READY.
  [3] Validation      — <PASS | MISSING/INVALID: reason>
      Validate the change for real, then record evidence:
        • UI        → Playwright walk + screenshot(s) under docs/validation/<sha>/
        • backend   → run the test suite, capture the log under docs/validation/<sha>/
        • fullstack → e2e covering both
        • other/config → a smoke/build/lint run, or attest noAutomatableCheck with a rationale
      node ~/.claude/skills/code-review/scripts/record-validation.cjs <<'JSON' … JSON

Recommended order: /code-review → validate → /session-persist → finish.
(Run /squash-commits BEFORE reviewing/validating — squashing rewrites commits and re-arms gates 2 & 3.)

Bypass (genuinely un-validatable — infra-only, external trigger): set
SKIP_FINISH_GATES=1 for this one invocation. Every use is logged to
$TMPDIR/finish-gate-diag.log. It is intentionally noisy.
```

**Bypass:** env var `SKIP_FINISH_GATES=1` only — **no standing marker file** (a
forgotten override file would silently bypass forever). One-shot by nature.
Every decision (allow/deny/bypass) is timestamped to `$TMPDIR/finish-gate-diag.log`,
mirroring the push-gate's diag log.

## Fail-Open / Safety Behavior (explicit per case)

| Situation | Behavior |
|---|---|
| Tool ≠ Skill, or skill ≠ finishing-a-development-branch | allow (pass-through) |
| Not a git repo (`rev-parse --is-inside-work-tree` fails) | allow (no repo, no gate) |
| Git **transient** error/timeout resolving branch/root | **deny** with diagnostic (fail closed — was allow in v1) |
| Detached HEAD (no branch name) | Gate 1 uncheckable → skip Gate 1; still run sha-keyed Gates 2 & 3 |
| Zero-commit branch (`rev-parse HEAD` fails) | allow (nothing to finish) |
| `SKIP_FINISH_GATES=1` | allow + log bypass |
| Whole branch diff docs-only | skip Gates 2 & 3 (Gate 1 still applies) |
| `node` missing, or checker script absent (code-review not installed) | that gate **fails open** + logged note |
| Checker exits 2 (infra) | that gate fails open + logged |
| Candidate marker: any git error during ancestry/diff eval | that candidate does **not** match (fail closed) |
| Validation marker malformed / > 64 KB / any parse or validate error | treated as missing → Gate 3 fails |

## Push-Gate Changes (`git-push-gate-hook.sh`)

- Call `check-marker.cjs` **with `--allow-docs-ancestor`** — backward-compatible
  (tolerance only ever *allows more*), and resolves the finish-vs-push
  contradiction for the code-review marker.
- **Optionally** (default OFF) also run `check-validation.cjs
  --allow-docs-ancestor` when `CODE_REVIEW_REQUIRE_VALIDATION=1` — lets a project
  require validation at push time too (Security follow-up) without surprising
  existing push-gate users. If the validation checker is absent → skip.
- Existing bypasses (`[skip-review]`, `CODE_REVIEW_BYPASS=1`) unchanged.

## Files

- **Edit** `hooks/session-checkpoint.py` — three-gate logic, Python Gate 1,
  node-subprocess Gates 2/3, docs-only branch skip, fail-open table, env-var
  bypass, diag logging, multi-gate deny message. (Symlinked into `~/.claude/`.)
- **Add** `skills/code-review/scripts/gate-lib.cjs` — shared resolveGit,
  isDocsOnly, findValidMarker, validateEvidence, EVIDENCE_RULES.
- **Add** `skills/code-review/scripts/check-validation.cjs`.
- **Add** `skills/code-review/scripts/record-validation.cjs`.
- **Edit** `skills/code-review/scripts/check-marker.cjs` — refactor onto
  `gate-lib`; add `--allow-docs-ancestor` (default off = current behavior).
- **Edit** `skills/code-review/project-setup/git-push-gate-hook.sh` — tolerance
  flag + optional validation check.
- **Edit** `skills/code-review/SKILL.md` — Layer 4 documents calling
  `record-validation.cjs`; note the finishing gate consumes it.
- **Edit** `skills/code-review/SETUP.md` — add the 3 new scripts to the helper
  list; note the finishing hook's dependency on them.
- **Edit** `README.md` — Hooks table description for `session-checkpoint.py`.
- **Edit** `CLAUDE.md` — new "Gate Markers" subsection (sha-keyed
  git-common-dir markers: `code-review-passed`, `validation-passed`); expand
  "Hook Protocol" to cover `Skill`-matcher hooks (cite `session-checkpoint.py`);
  note the squash-before-gates ordering.
- **Edit** `skills/squash-commits/SKILL.md` — one-line "squash before the gates"
  note.
- **Edit** `skills/session-notes/SKILL.md` — cross-ref that Gate 1 is now one of
  three finishing gates.
- **Add** tests (see below).

## Test Plan

`gate-lib` / `check-validation` / `record-validation` unit + fixture tests:
- `isDocsOnly`: `docs/x.md`✓, `.claude/sessions/y`✓, `README.md`✓, `.md`
  anywhere✓; `src/docs/x.ts`✗, `vendor/adocs/b.js`✗, `.claude/settings.json`✗.
- `findValidMarker`: exact HEAD hit; docs-only ancestor hit; **non-ancestor with
  docs-only content diff → reject**; empty diff → reject; pruned/garbage marker
  sha → reject; unrelated stale marker → reject.
- `validateEvidence`: nonzero exit → reject; absolute artifact → reject; `..`
  traversal → reject; symlink escaping repo → reject; directory artifact →
  reject; zero-byte artifact → reject; artifact outside `docs/validation/` →
  reject; ui with no artifact → reject; backend with no artifact → reject;
  `changeClass:other` + `noAutomatableCheck` + rationale → accept; mislabeled
  (UI diff declared backend) → reject; recorder and checker agree on all above
  (parity).

`session-checkpoint.py` synthetic-stdin cases:
1. All three gates satisfied → allow (exit 0, no output).
2–4. Each gate missing → deny, message names that gate.
5. Docs-only ancestor markers for Gates 2/3 → allow (tolerance).
6. Non-ancestor / code-ancestor markers → deny (stale).
7. Whole branch docs-only → Gates 2/3 skipped; only Gate 1 applies.
8. Detached HEAD → Gate 1 skipped, Gates 2/3 evaluated.
9. `node`/checker absent → Gates 2/3 fail open + logged; Gate 1 still enforced.
10. Transient git error → deny with diagnostic.
11. `SKIP_FINISH_GATES=1` → allow + diag-log entry.
12. Non-finishing skill → pass-through allow.

Push-gate: with `--allow-docs-ancestor`, a docs-only-ancestor code-review marker
allows the push (was blocked in v1); `CODE_REVIEW_REQUIRE_VALIDATION=1` adds the
validation check; absent validation checker → skipped.

## Risks & Residual Gaps

- **Self-attestation is forgeable by the agent** — accepted; mitigated by the
  hardened evidence bar + logging, not prevented (see §Trust model).
- **Validation not enforced at push by default** — opt-in
  (`CODE_REVIEW_REQUIRE_VALIDATION=1`) to avoid surprising existing push-gate
  users; the finishing gate is the primary enforcement point.
- **Provenance:** two branches sharing an ancestor sha can share a Gate-2/3
  marker once a docs commit lands. Content-identical, so byte-safe; documented.
- **Markers for UNREACHABLE shas are never collected** (found while cleaning up
  after the PR-#5 merge, 2026-07-13). `pruneStale` only deletes a marker whose sha
  is an **ancestor of the kept sha** — deliberately, so a divergent branch's marker
  survives. But a sha abandoned by history rewriting (squash, amend, rebase) is an
  ancestor of *nothing*, so it is never pruned, and `pruneEvidence` keeps any
  evidence dir whose marker still exists — so the orphan marker **pins its evidence
  alive too**. Every squash/amend/rebase cycle leaves one behind: this branch alone
  accumulated **21 orphan markers and 4 evidence dirs (~72K)** across its rewrites,
  all of which had to be swept by hand.

  Bounded, `.git`-local, never committable, and it cannot cause a false ALLOW (an
  unreachable marker can never match HEAD) — so it is hygiene, not correctness. But
  it grows without limit in long-lived repos, and it is exactly the "silent
  accumulation in the git dir" class the evidence-store refactor set out to kill.

  **Fix sketch:** sweep markers whose sha is unreachable from *every* ref and every
  live worktree HEAD — e.g. `git merge-base --is-ancestor <sha> <ref>` across
  `git for-each-ref --format='%(objectname)'` plus `worktreeHeads()`, or more
  cheaply `git cat-file -e <sha>` combined with a reachability check (note a
  rewritten commit often still *exists* as a dangling object until gc, so existence
  alone is not reachability). Must keep failing safe: if reachability can't be
  determined, keep the marker. Then call `pruneEvidence` with the surviving set, as
  the checker and recorder already do.
- **Artifacts under `docs/`** deleted by a later docs-only cleanup fail Gate 3
  closed (safe direction) — a UX sharp edge, not a hole.
- **Node dependency** for Gates 2/3 — fails open with a note when absent, so
  users without code-review installed keep today's docs-only-gate behavior.
- **Evidence lives in the git dir, never in the working tree** (revised
  2026-07-11, hardened for the global-install model). `record-validation.cjs`
  **copies** each artifact into `<git-common-dir>/validation-evidence/<sha>/` and
  records the stored names; `artifactValid()` validates those stored copies.
  Rationale: the gate is symlinked into `~/.claude` and runs against **every**
  repo the user works in. An earlier iteration kept artifacts under
  `docs/validation/` and relied on a `.gitignore` entry — but that entry only
  exists in *this* repo, so in any consuming project the evidence was
  untracked-but-committable (a routine `git add docs/` while committing real
  documentation would sweep it in, ready to push). Storing evidence in the git
  dir makes it untrackable **by construction** in every repo, needs no per-repo
  `.gitignore`, has no timing window — and, as a bonus, is shared across linked
  worktrees (dissolving the earlier per-worktree evidence constraint). A rejected
  recording stages to a temp dir and never clobbers a previous successful one.
- **Non-ASCII / special paths** (hardened during dogfooding, 2026-07-08). All
  `git diff --name-only` reads use `-z` (NUL-separated) so `core.quotePath`
  can't wrap a non-ASCII path in quotes and defeat the `isDocsOnly` /
  UI-mislabel path parsing (which would be a wrong ALLOW). Mirrored in the
  Python `branch_is_docs_only`.
- **Prune is now ancestry-scoped** (hardened during dogfooding, 2026-07-08;
  the original inherited-from-`check-marker.cjs` behavior deleted *all* siblings).
  `pruneStale(repoRoot, gitDirAbs, prefix, keepSha)` deletes only markers whose
  sha is an ancestor of `keepSha` (superseded on *this* line of history), so a
  divergent branch's / linked worktree's already-valid marker in the shared
  git-common-dir is preserved. Applies to both `code-review-passed` and
  `validation-passed`.
- **Concurrent linked worktree at an ancestor commit** (IMPLEMENTED 2026-07-11).
  `pruneStale` is now worktree-aware: `worktreeHeads()` reads
  `git worktree list --porcelain`, skips `prunable` (hand-deleted) entries, and
  excludes the current worktree's own HEAD; `pruneStale` then keeps any marker
  reachable from another live worktree's HEAD (`git merge-base --is-ancestor`).
  So recording a gate on one worktree no longer wipes a marker another linked
  worktree (checked out at an ancestor) still relies on, while genuinely-stale
  ancestors are still pruned once no live worktree needs them.
## Session Log — Dogfooding (2026-07-08)

The gate was dogfooded on its own branch: the full loop
`/code-review → validate → /session-persist → finish` was run against this very
change. **Result: the gate caught ~11 real bugs in its own implementation across
6 review rounds** — the strongest possible evidence that the multi-round verify
loop earns its cost.

**Findings by round** (all fixed; commits `9bf02b9`, `484bc64`, `7318675`,
`db82907`, `ca70e64`, `9cf1f3d`):

- **R1** (5 bugs): fullstack e2e didn't satisfy the backend tier; `other`+attestation
  skipped the UI-mislabel guard; Python `git()` timeout in `resolve_base`/
  `branch_is_docs_only` could crash the hook; `is_docs_only_path` didn't strip
  `./`; push-gate emitted the code-review deny text for a validation-only failure.
- **R2** (1): the R1 push-gate fix treated checker exit 2 (infra) as a hard deny,
  breaking the fail-open contract.
- **R3** (2): the UI-mislabel guard flagged docs-only paths (`docs/components/…`,
  `docs/*.tsx`); the exit-2 fix didn't cover other non-0/1 exits.
- **R4** (3): artifacts were accepted uncommitted (now require HEAD); non-ASCII
  paths were quoted by `core.quotePath` and defeated path parsing (now `-z`); a
  test hard-coded `master` (non-portable).
- **R5** (2): `pruneStale` deleted markers across divergent branches (now
  ancestry-scoped); a docs-only commit could swap a committed artifact for junk
  and still pass (now guarded).
- **R6** (2 fixed + 1 deferred): a bogus artifact could ride alongside a valid one
  (now every entry validated); the swap-guard compared un-normalized paths (now
  canonicalized). Deferred: prune can affect a concurrent linked worktree at an
  ancestor commit (safe direction, rare — see §Risks).

**Pattern:** every round surfaced a distinct, narrower class of edge case
(evidence strength → fail-open contracts → path classification → path encoding →
marker lifecycle → normalization). Findings shrank in blast radius each round —
genuine convergence, not oscillation.

**Round 7 (final, after squash to a single commit):** Codex found 2 more real
fail-opens — `artifactValid` verified working-tree bytes while only checking HEAD
*existence* (a 0-byte committed artifact overwritten by an uncommitted real file
faked evidence), and `git diff --name-only` without `--no-renames` let a code→docs
rename look docs-only. Both fixed (committed-blob + clean-worktree check;
`--no-renames` on all diff reads) with regression tests. The independent
reviewer-subagent pass then returned **NO_FINDINGS**, verifying both fixes
end-to-end. Codex was NOT re-run afterward (usage-cap conservation, per user
direction). Verdict: **PUSH READY** — 7 rounds, ~13 bugs fixed total, suites green
(22 JS + 11 Python).

**Validation evidence (Gate 3):** `changeClass: other` (dev-tooling), two `test`
checks — `node --test …gate-lib.test.cjs` and `python3 …session-checkpoint.test.py`
— with committed logs under `docs/validation/`. The `code-review-passed-<sha>`
and `validation-passed-<sha>` markers are re-stamped on the current HEAD after
each history rewrite (squash/amend); the finishing hook was observed flipping
DENY→ALLOW once all three gates were satisfied.

**Status / next steps:** Standalone task — no Jira ticket (branch
`feature/three-gate-finishing-checkpoint`). Held: not pushed, not merged. The
pre-existing uncommitted `skills/code-review/scripts/parse-claims.cjs` change is
unrelated and was deliberately kept out of every commit. All candidate hardenings
surfaced during dogfooding — including the worktree-aware prune — are now
implemented; nothing outstanding blocks a real merge.

## Session Log — Pre-push audit + evidence-store refactor (2026-07-11)

The branch was squashed to **one commit** and then hardened through three
audits and a final review round. Everything below is *shipped* on that commit.

### The big one: evidence must not live in the working tree

The gate is **symlinked into `~/.claude` and runs against every repo the user
works in**. The evidence model at the time kept artifacts under
`docs/validation/` and relied on a `.gitignore` entry — but **that entry only
exists in agent-skills**. An audit reproduced the consequence in a consuming
repo: the artifacts were untracked-but-committable, and a routine `git add docs/`
while committing real documentation **staged the evidence, ready to push**. The
"never committed or pushed" guarantee held only in this repo.

**Fixed architecturally.** `record-validation.cjs` now takes artifact *source*
paths (wherever the tooling wrote them — any relative/absolute path), **copies**
them into `<git-common-dir>/validation-evidence/<sha>/`, and records the stored
names; `check-validation.cjs` validates the stored copies (keyed to the
*marker's* sha, so a docs-only-ancestor marker still resolves its evidence). The
working tree is never written to → evidence is untrackable **by construction** in
any repo, needs **no `.gitignore` anywhere**, and has no timing window. Proven in
a throwaway consuming repo: working tree clean, `git add docs/` stages nothing.

Two things fell out of this: it **dissolved the per-worktree evidence
constraint** (the common-dir is shared), and writing the test exposed a real bug
— a *rejected* recording was deleting the evidence dir, destroying a *previous
successful* recording at the same sha. Recording now stages to a temp dir; the
swap moves the old dir aside, installs the new one, and only then deletes the
backup (with rollback on failure).

### Audits run (all findings fixed)

- **Docs/repo-pattern:** the deny message is the *only* surface a Claude session
  gets when the gate fires in another repo — it now carries the full
  `changeClass` **and** `kind` enums, worked examples for both the artifact and
  the `noAutomatableCheck` shapes, the artifact rules, golden order, and bypass.
  Fixed a CLAUDE.md self-contradiction (hooks documented as Bash-only, though
  this ships a **Skill**-matcher hook) and a deny-message path that only resolved
  inside agent-skills.
- **Env bias:** diagnostic logs now honor `$TMPDIR` (were hardcoded `/tmp`);
  README/SETUP install steps no longer bake in a personal checkout path.
- **Cross-OS:** documented real minimums — Node ≥16 (runtime) / ≥18 (`node:test`
  suite), git ≥2.22 (`branch --show-current`) and ≥2.31 (worktree `prunable`;
  older git only over-retains markers — fail-safe). Install commands cover
  apt/dnf/winget; target is macOS + Linux + WSL (native Windows is not).
- **Global-symlink:** verified Node `require('./gate-lib.cjs')` resolves through
  the symlink, `CHECKER_DIR` finds checkers regardless of cwd, and `--repo-root`
  is always passed explicitly. Documented that the hook only fires on
  `finishing-a-development-branch` (external **superpowers** plugin) — without
  it the hook is a harmless no-op.

### Final review round (full, Codex authorized)

**Codex: clean** — "no discrete correctness, security, or maintainability issues
introduced by the diff." **Reviewer: 2 real findings** — (1) the evidence swap
deleted the old dir *before* the rename that installs the new one, so a failure
in that window destroyed valid evidence and left a dangling marker (permanent
false-block); (2) the push-gate deny message still pointed at `docs/validation/`,
which would have reintroduced the working-tree leak. Both fixed + regression
test; confirm pass returned **NO_FINDINGS** (verified two-worktree prune,
attestation path, crashed-run self-healing, shellcheck).

### Where it stands

- **One clean commit** on `origin/master` (SG-13911 merged upstream in the
  interim, so a PR shows **only this commit** — no rebase needed).
- **22 JS + 13 Python** suites green. Finish gate and push gate both **ALLOW**.
- Zero `docs/validation` references remain anywhere.

### Open / next

> **Superseded by the 2026-07-13 log below.** Items 1–2 are done (the dogfood ran,
> and it found three real bugs before the PR was opened). Items 3–4 still stand.

1. **Dogfood the current local build first** — the evidence-store refactor is
   new; exercise the real flow end-to-end (`/code-review` → validate →
   `/session-persist` → finish) to confirm it functions before opening the PR.
2. **Then open the PR** against `master`.
3. `skills/code-review/scripts/parse-claims.cjs` still has an **unrelated,
   uncommitted** change (adds an SG-13996 comment). It has been deliberately kept
   out of every commit — decide separately whether to keep, commit, or discard.
4. Codex CLI has a usage cap the user guards — **ask before invoking it**.

## Session Log — Dogfood: the gate caught three bugs in itself (2026-07-13)

The plan was "dogfood the build, then push." The dogfood ran the real flow against
the **globally-symlinked local build** (`~/.claude/skills/code-review` and
`~/.claude/hooks/session-checkpoint.py` both resolve into this working tree, so the
gate under test *is* the gate that runs). It did not come back clean: `/code-review`
returned **FIX FIRST** and surfaced **three real bugs in the gate's own code** —
on the exact commit whose previous review round had come back Codex-clean and
reviewer-`NO_FINDINGS`. The commit was amended (`a43b763` → `b1028be`); nothing was
ever pushed.

### What the dogfood proved (before it found anything)

- With all three markers cleared, the hook **DENIED** with `3 of 3 gates not
  satisfied` and the full self-sufficient remediation text. The gate blocks.
- After review + validation, it denied with **`1 of 3`** (documentation only) —
  it discriminates per-gate rather than blanket-blocking.
- **The working tree stayed pristine throughout.** `git status` never showed
  anything but the unrelated `parse-claims.cjs` edit. Evidence artifacts were
  deliberately captured *outside the repo* (in a scratch dir) and the recorder
  copied them into `.git/validation-evidence/<sha>/`. The evidence-store refactor's
  central promise holds under a real run.

### The three bugs

**1. A marker and its evidence could drift apart (P2 — reproduced live).**
`check-validation.cjs` called `pruneStale()` but never `pruneEvidence()`, so
pruning a superseded marker **orphaned its `validation-evidence/<sha>/` directory
in the git common-dir**. The root cause was structural, not an oversight in
passing: `shasWithMarkers()` was a *private local function inside*
`record-validation.cjs`, never exported — so the checker **could not** have called
it. Only the recorder ever pruned evidence, and the checker runs far more often
(every finish attempt, every push).

Reachable via a first-class workflow, and reproduced end-to-end in a throwaway
repo: record at sha A → a linked worktree pinned at A protects marker A from the
recorder's prune → record at B → remove the worktree → the next gate check prunes
marker A and **leaves its evidence behind**. This directly falsified the invariant
this repo had already written down at `SKILL.md:240` — *"Stored evidence is pruned
automatically when its marker goes stale."* The orphan is only reclaimed by some
*later* `record-validation` run, which may never come.

**Fix:** `shasWithMarkers(gitDirAbs, prefix)` is now a shared `gate-lib` export
used by **both** callers, so the pair can't drift again; `check-validation.cjs`
calls `pruneEvidence` after `pruneStale`. `pruneEvidence` also now **no-ops on an
indeterminate keep-set** (`null`) instead of treating it as "keep nothing" — the
old private helper fell back to `[headSha]` on a readdir error, which would have
deleted every *other* live evidence dir on a transient failure. The fix is strictly
safer than the code it replaced.

**2. SHA-256 repos silently lost the tolerance (P3).** The object-id regexes were
bounded at SHA-1's 40 hex chars (`/^[0-9a-f]{7,40}$/`, `/^HEAD ([0-9a-f]{40})$/`).
In a `--object-format=sha256` repo every id is 64 chars, so **every marker filename
would be skipped as junk** — silently disabling the docs-only-ancestor tolerance
*and* all marker pruning, and returning an empty set from `worktreeHeads()` (killing
cross-worktree marker protection). No error, no log line; the gate just quietly
stopped tolerating. Fails closed, never false-allow — which is why it's P3 and not
worse. Fixed by hoisting `HEX_SHA_RE = /^[0-9a-f]{7,64}$/` and
`WORKTREE_HEAD_RE = /^HEAD ([0-9a-f]{40,64})$/` to shared constants. The exact-HEAD
lookup was always safe (a direct `fs.existsSync`, no regex).

**3. A crash window between the evidence swap and the marker write (P3).**
`record-validation.cjs` committed the evidence dir — deleting its backup — *before*
writing the marker. A failed marker write (ENOSPC/EACCES/kill) therefore left
**evidence with no marker pointing at it**. Fixed by retaining the backup until the
marker is durably written, with a `restoreEvidence()` helper that unwinds the swap
on marker-write failure.

### Regression tests (25 JS + 13 Python, all green)

Three new tests, each **verified to fail against the pre-fix build and pass after**
— the check that separates a regression test from decoration:

- `check-validation.cjs: pruning a stale marker also drops its evidence` — replays
  the worktree-protection scenario above.
- `record-validation.cjs: a failed marker write rolls the evidence swap back` —
  `chmod 0444` on the marker forces the write to fail *after* the swap; asserts the
  **original** evidence is restored, no `.staging-*`/`.old-*` strays, gate still passes.
- `gate-lib: markers, tolerance and pruning work in a SHA-256 repo` — builds a real
  `--object-format=sha256` repo (git 2.52 supports it; skips if unavailable).

A confirm-pass re-review of the fixes returned **NO_FINDINGS**.

### Lesson worth keeping

The previous round's "Codex clean + reviewer NO_FINDINGS" was **not** evidence of
correctness — the same diff, reviewed again, yielded a reproduced P2. A single clean
review pass is one sample, not a proof. This is the skill's own "AI reviewers are
lazy and short-sighted" premise landing on the skill itself, and it's the argument
for the Layer-3 panel + Layer-4 live test rather than trusting a Layer-1 all-clear.

Second, smaller lesson: the bug existed because a helper was **private to one of two
callers that both needed it**. Where an invariant must hold at every call site, the
enforcement belongs in the shared library — otherwise "call these two together" is a
convention, and conventions drift.

### Where it stands

- **One clean commit** (`b1028be`), 1 ahead of `origin/master`, never pushed. The
  commit body's stale *"artifacts must be committed … under `docs/validation/`"*
  sentence — a leftover contradicting the evidence-store refactor described lower in
  the same message — was corrected in the amend.
- **25 JS + 13 Python** green. Gates 2 & 3 **PASS** for `b1028be`.
- Codex CLI was **deliberately skipped** this round (the user declined; usage cap).
  Layer 1 ran reviewer-only — single-signal, no cross-validation.

### Wrap-up — PR #5, rebase, and the SG-13996 fold-in (2026-07-13)

**PR #5** is open against `master`. GitHub reported it out-of-date (master requires
`strict: true` — branches must be current at merge time). `origin/master` was one
merge commit ahead (PR #4) whose *content* we already had, so the rebase was a clean
replay: `git diff origin/master...HEAD` was **byte-identical** before and after
(same SHA-256). Only the commit SHAs moved — which, correctly, **staled both gates**
and forced a re-arm. That is the sha-keyed design doing its job on a real rebase.

**The `parse-claims.cjs` change was never "just a comment."** It had been carried
uncommitted across several sessions on that description. It is a **functional fix to
a silent-failure bug in the Layer-1 parser this whole gate depends on**: the
`CLAIM_HEADER` line anchor was a bare `:(\d+)$`, which does not match the RANGE form
the Codex CLI routinely emits (`file.ts:860-860`). A real Codex review of ranged
findings therefore parsed as **ZERO claims** — reported as a clean pass, exit 0, no
warning. Folded into this PR.

**Reviewing that fix found a P1 in the fix**, which is the whole point of doing it:
the range delimiter accepted only an **ASCII hyphen**, while the summary separator
had already been widened to `[—–-]` precisely because Codex doesn't reliably emit
ASCII. An en-dash is the *typographically correct* character for a numeric range
("120–145"). And the failure is worse than a bare miss — an unmatched header isn't
dropped, it's **absorbed into the previous claim's `body`**, so the tool reports a
plausible non-zero count (2 of 3) while a real finding is invisible. Reproduced,
then fixed. A confirm-pass (adversarial verifier, mutation-tested) then found one
more realistic swallow — a header ending in ordinary sentence punctuation
(`b.ts:81.`), which LLM-written bullet lines produce constantly. Also fixed.

The anchor is now **deliberately permissive** (dash class + spaces + trailing
punctuation). The asymmetry is the reason: over-matching a header is recoverable;
silently losing a review finding is not.

`parse-claims` **had no test at all** — its fixtures file was checked in but never
read by anything. It now has 9, pinning the header grammar. Every range/punctuation
case fails against the regex it replaces.

### The pattern, stated plainly

Three times now, on three different files, the same shape: **a silent failure in the
thing that is supposed to catch failures.** The gate that pruned markers without
their evidence. The regex that dropped claims without saying so. Both were found only
by *actually running the tool against adversarial input* — never by reading it. And
each fix, when reviewed, contained another bug of the same class.

The operational lesson is not "review more." It is that a **clean result from a
verifier is only evidence if the verifier was exercised against a case that could
have failed.** A review that returns NO_FINDINGS on a diff it never ran is worth
approximately nothing — which is exactly what a parser silently reporting zero claims
had been producing.

### Where it stands

- **2 commits**, rebased onto `origin/master` (0 behind), pushed. PR #5 `MERGEABLE`,
  blocked only on **2 required approvals** (no CI checks configured on this repo).
- **25 + 9 JS, 13 + 242 Python** — all green. All three gates pass for HEAD.
- Working tree clean. Nothing left uncommitted.

### Open / next

1. **Await 2 approvals on PR #5**, then merge. If anything else lands on `master`
   first, the branch goes out-of-date again (`strict: true`) → rebase → the gates
   re-arm and must be re-earned. That is intended, not friction.
2. After merge: delete the remote branch, and run `/squash-cleanup` to drop the
   `pre-squash.bundle` / `last-squash.json` backups under
   `.claude/sessions/feature%2Fthree-gate-finishing-checkpoint/`.
3. Codex CLI has a usage cap the user guards — **ask before invoking it**. Note that
   this branch's final review rounds ran **reviewer-only** (Codex declined), so the
   cross-validation Layer 1 is designed around did not happen on this diff.
4. Residual, knowingly unfixed in `parse-claims` (documented, not silent): a
   `file.ts:12:34` column suffix mis-splits the file field, and exotic Unicode dashes
   (U+2011/2012/2212) are still unmatched. No evidence Codex emits either shape.
