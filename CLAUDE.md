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
- **Hooks** (`.py`): Python scripts that run as `PreToolUse` handlers on `Bash` tool calls. They read tool input JSON from stdin and either `sys.exit(0)` (allow), `sys.exit(2)` (block), or print a JSON `permissionDecision` object to deny with a reason.

### Subagent Dispatch Terminology

Skills dispatch subagents with the **Agent tool** (using `subagent_type`, e.g. `Explore` or `general-purpose`). "Agent tool" is the canonical name across all skills — some older drafts said "Task tool"; prefer "Agent tool" in new and edited skills.

### Hook Protocol

Hooks receive JSON on stdin with `tool_name` and `tool_input.command`. To block a command, exit with code 2 and print to stderr. To deny with feedback (so the agent can self-correct), print a JSON object with `hookSpecificOutput.permissionDecision: "deny"` and exit 0. See `git-conventions.py` for the deny-with-feedback pattern.

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

Squash operations store state in `.claude/sessions/{sanitized-branch}/` (branch name with `/` percent-encoded as `%2F` — e.g. `feat/x` → `feat%2Fx` — so it can't collide with a literal `feat-x`). Files: `last-squash.json`, `squash-in-progress.json`, `pre-squash.bundle`. This directory is gitignored.

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
