# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## What This Repo Is

A collection of Claude Code skills, commands, and hooks that extend the AI agent's git workflow capabilities. These are installed by symlinking into `~/.claude/` and are used across other repositories.

## Getting Started

1. Clone the repo to a directory of your preference
2. Open Claude Code in the cloned directory
3. Browse the available skills, commands, and hooks — cherry-pick what you want
4. Ask Claude to help you create the symlinks to your global Claude settings (`~/.claude/`). Skills go in `~/.claude/skills/`, commands in `~/.claude/commands/`, hooks in `~/.claude/hooks/`
5. For hooks only: Claude will also help you register them in `~/.claude/settings.json` under `hooks.PreToolUse` (hooks require both the symlink and the registration to work)

## Repository Structure

```
skills/{name}/SKILL.md              # Skill definitions (loaded by Claude Code automatically)
skills/{name}/project-setup/        # Project-level files to copy (scripts, templates, hooks)
skills/{name}/SETUP.md              # Installation guide for project-level dependencies
commands/{name}.md                  # Command stubs (thin wrappers that invoke skills)
hooks/{name}.py                     # PreToolUse hooks (Python, read JSON from stdin)
docs/plans/                         # Design documents (YYYY-MM-DD-{name}-design.md)
```

## Architecture Patterns

### Skills vs Commands vs Hooks

- **Skills** (`SKILL.md`): Full behavioral specifications with YAML frontmatter (`name`, `description`). They define *how* Claude should behave — wizard flows, safety checks, verification steps. Skills are the source of truth.
- **Commands** (`.md`): Thin stubs that point to a skill and say "follow it exactly." They exist only to provide `/command-name` invocation. Never duplicate skill logic in commands. Commands can also alias external plugin skills (e.g., `commit.md` aliases `commit-commands:commit` to provide `/commit`).
- **Hooks** (`.py`): Python scripts that run as `PreToolUse` handlers on `Bash` **or `Skill`** tool calls (see Hook Protocol below for the two matcher variants). They read tool input JSON from stdin and either `sys.exit(0)` (allow), `sys.exit(2)` (block), or print a JSON `permissionDecision` object to deny with a reason.

### Subagent Dispatch Terminology

Skills dispatch subagents with the **Agent tool** (using `subagent_type`, e.g. `Explore` or `general-purpose`). "Agent tool" is the canonical name across all skills — some older drafts said "Task tool"; prefer "Agent tool" in new and edited skills.

### Hook Protocol

Hooks receive JSON on stdin with `tool_name` and `tool_input`. For **Bash**-matcher hooks the relevant field is `tool_input.command`; for **Skill**-matcher hooks it is `tool_input.skill` (the skill name being invoked). To block a command, exit with code 2 and print to stderr. To deny with feedback (so the agent can self-correct), print a JSON object with `hookSpecificOutput.permissionDecision: "deny"` and exit 0. See `git-conventions.py` (Bash matcher) and `session-checkpoint.py` (Skill matcher) for the deny-with-feedback pattern.

### Smart Compose Hook

The `smart-compose` hook (`hooks/smart-compose.py`) auto-approves composed Bash commands where every sub-command individually matches an existing allow rule. It splits on `&&`, `||`, `;` outside quotes, checks each part against prefix/glob/exact rules and builtins, and passes through to the normal permission system if any part is unrecognized.

- Installed to: `~/.claude/hooks/smart-compose.py` (symlink)
- Registered in: `~/.claude/settings.json` under `hooks.PreToolUse`
- **Must be last in the array** — if other deny-capable hooks exist (e.g., `dangerous-command-blocker`, `git-conventions`), they must appear earlier so they can block before smart-compose approves
- Reads allow rules from: project `.claude/settings.local.json` and `.claude/settings.json` + global `~/.claude/settings.local.json` and `~/.claude/settings.json`
- **Variable assignments** (`VAR=value`) are recognized and checked against prefix rules ending with `=` (e.g., `Bash(MERGE_BASE=:*)`)
- **Command substitution** (`$(cmd)`) inside variable values and builtin arguments is recursively checked — the inner command must also match an allow rule
- **28 trusted builtins** are auto-allowed in composed commands: `cd`, `echo`, `printf`, `true`, `false`, `test`, `[`, `[[`, `cp`, `mv`, `mkdir`, `touch`, `cat`, `head`, `tail`, `wc`, `less`, `awk`, `sed`, `grep`, `sort`, `uniq`, `tee`, `basename`, `dirname`, `realpath`, `date`, `sleep`

### Command Composition

- Prefer separate parallel Bash calls for independent commands
- Use `&&` only for genuinely dependent operations (cd+command, git add+commit)
- Use Glob instead of `ls`, Grep instead of `grep`, Read instead of `cat`
- The `smart-compose` hook auto-approves composed commands where every sub-command is individually allowed

### Session State

Squash operations store state in `.claude/sessions/{sanitized-branch}/` (branch name with `/` percent-encoded as `%2F` — e.g. `feat/x` → `feat%2Fx` — so it can't collide with a literal `feat-x`). Files: `last-squash.json`, `squash-in-progress.json`, `pre-squash.bundle`, and the `session-persist-done` finishing-gate marker. This directory is gitignored. Any new per-branch file **must** use the same `%2F` encoding.

### Gate Markers

Two sha-keyed markers live in the **git common-dir** (`git rev-parse --git-common-dir`, so they're shared across linked worktrees), written on a passing verdict and consumed by the finishing gate (`session-checkpoint.py`) and the push gate (`git-push-gate-hook.sh`):

- `code-review-passed-<sha>` — written by `/code-review` on a PUSH READY verdict.
- `validation-passed-<sha>` — JSON evidence marker written by `record-validation.cjs` (change class + executed checks + stored artifacts). The recorder **copies** artifacts into `<git-common-dir>/validation-evidence/<sha>/` — the working tree is never touched, so evidence can't be committed or pushed in *any* repo, and no per-repo `.gitignore` is needed.

Both gates share one checker library (`skills/code-review/scripts/gate-lib.cjs`). A marker is valid for HEAD, or — with `--allow-docs-ancestor` — for a **proven docs-only ancestor** of HEAD (so a `/session-persist` docs commit landing after review/validation doesn't stale them). Because these are sha-keyed, **run `/squash-commits` BEFORE `/code-review` and validation** — squashing rewrites SHAs and re-arms both gates.

**Stranded markers (`/gate-gc`).** Every squash/amend/rebase abandons a commit, and its marker becomes an ancestor of nothing — so `pruneStale` can never collect it, and the marker keeps its evidence dir alive. **`/gate-gc` REPORTS these; it never deletes.** That is deliberate and must stay that way: collecting a marker means deciding "this commit is gone", and git reports a *present-but-unreadable* object **identically** to an absent one through every channel (`cat-file -e`; `rev-parse --verify -q`, even for packed objects; `for-each-ref --contains`; `cat-file --batch-all-objects`, which silently omits it and exits 0; and `merge-base --is-ancestor`, which a corrupt **commit-graph** makes lie while every object is pristine). Six deleting designs were each shown to destroy a live marker *and its validation evidence* — via an unreadable loose object, an unreadable pack, a corrupt-but-readable pack, a corrupt commit-graph, and a faulted `objects/info/alternates` store. There is no deletion primitive left in `gate-lib.cjs`. **Do not add one.**

### Finishing Gate

`session-checkpoint.py` (Skill-matcher `PreToolUse` hook) blocks `finishing-a-development-branch` until three gates pass for HEAD: **documentation** (`session-persist-done`), **code review** (`code-review-passed-<sha>`), and **validation** (`validation-passed-<sha>`).

**Golden order:** `/squash-commits` → `/code-review` → validate (`record-validation.cjs`) → `/session-persist` → finish. Squash first (it rewrites SHAs and re-arms gates 2 & 3); the docs commit lands last and is tolerated by the docs-only-ancestor rule.

**Validation evidence** is recorded with `record-validation.cjs` (stdin JSON: `changeClass` = `ui|backend|fullstack|other`, `checks[]` with `kind`/`command`/`exitCode`/`artifacts`). Point `artifacts` at the real files your tooling produced (any path); the recorder copies them into the git dir. The working tree stays pristine — evidence is never committed or pushed. See `skills/code-review/SKILL.md` → "Recording validation evidence".

It fails open for gates 2 & 3 when the code-review skill's Node checkers aren't installed, and skips them for docs-only branches. Bypass: `SKIP_FINISH_GATES=1` (one invocation, checked before any git call so it works even if git is wedged; logged to `$TMPDIR/finish-gate-diag.log`). Design: `docs/plans/2026-07-08-finishing-gate-validation-design.md`.

Verify the gate is actually enforcing (not silently failing open):

```bash
echo '{"tool_name":"Skill","tool_input":{"skill":"finishing-a-development-branch"},"cwd":"'"$(pwd)"'"}' \
  | python3 ~/.claude/hooks/session-checkpoint.py
```

Empty output = gates pass (allow). A `permissionDecision: "deny"` JSON = it's gating, with the reason.

### Wizard UX Convention

All user-facing decisions use `AskUserQuestion` with multiple-choice options. Skills never ask for free text input — always provide selectable options.

## Git Conventions (Enforced by Hook)

Commit format: `type: Description` where type is `feat|fix|docs|chore|test` and description starts with a capital letter. Passthrough: `Merge`, `Revert "..."`, `Initial commit`.

Branch naming: `{feature|fix|chore}/{optional-ticket-id-}kebab-description` (e.g., `feature/SG-1234-user-auth`).

## Design Document Workflow

Design docs live in `docs/plans/` with naming `YYYY-MM-DD-{topic}-design.md`. They go through plan-hardening (systematic review across 10 core + 8 optional categories) until convergence (0 must-fix, 0 should-fix issues). A temporary tracker file (`{plan-name}-tracker.md`) is used during hardening and deleted at finalization.

## Adding New Components

- **New skill**: Create `skills/{name}/SKILL.md` with YAML frontmatter
- **New skill with runtime deps**: Add `skills/{name}/project-setup/` with scripts, templates, hooks referenced at runtime from `~/.claude/skills/`. Add `skills/{name}/SETUP.md` with installation instructions and `setup.sh` for one-command install. See `fix-issues` for the reference pattern.
- **New command**: Create `commands/{name}.md` pointing to the skill
- **New hook**: Create `hooks/{name}.py` following the stdin JSON protocol, then register in `~/.claude/settings.json` under `hooks.PreToolUse`
- After adding, re-run symlink commands from README setup section
