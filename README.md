# Agent Skills

Collection of AI agent skills and hooks for coding assistants.

## Structure

```
agent-skills/
├── skills/           # Skill definitions (SKILL.md files)
│   ├── code-review/          # 4-layer pre-merge verification pipeline
│   ├── fix-issues/           # Bug fixing pipeline (v3.1.14)
│   ├── generate-api-tests/
│   ├── git-conventions/
│   ├── implementation-audit/
│   ├── plan-hardening/
│   ├── session-notes/
│   ├── squash-commits/
│   ├── undo-squash/
│   └── worklog/
├── commands/         # Command stubs for explicit invocation
│   ├── code-review.md
│   ├── commit.md
│   ├── fix-issues.md
│   ├── generate-api-tests.md
│   ├── implementation-audit.md
│   ├── plan-hardening.md
│   ├── session-handoff.md
│   ├── session-persist.md
│   ├── session-status.md
│   ├── squash-commits.md
│   ├── squash-cleanup.md
│   ├── start-work.md
│   ├── undo-squash.md
│   └── worklog.md
├── hooks/            # Safety and validation hooks
│   ├── dangerous-command-blocker.py
│   ├── git-conventions.py
│   ├── session-checkpoint.py
│   └── smart-compose.py
└── docs/plans/       # Design documents
```

## Skills

| Skill | Description |
|-------|-------------|
| `code-review` | 4-layer pre-merge verification pipeline. Treats AI-reviewer findings as claims to verify before pushing. Optional per-project git-push gate (see `SETUP.md`). |
| `fix-issues` | Autonomous bug fixing pipeline with 3-gate verification. Investigates, diagnoses, fixes, and proves fixes work. User-level install; optional per-project settings (see `SETUP.md`). |
| `generate-api-tests` | Framework-agnostic API test generator. Creates YAML integration tests for go-runner and CI/CD pipelines. |
| `git-conventions` | Branch naming and commit format conventions. Enforces `type: Description` format via hook. |
| `plan-hardening` | Systematically validate draft designs until convergence (0 must-fix, 0 should-fix). |
| `squash-commits` | Consolidate commits into cohesive logical groups. Use when ready to push. |
| `session-notes` | Session context management — status debrief, persist findings, or generate handoff prompt. |
| `implementation-audit` | Dispatch parallel reviewers to validate implementation against the plan. |
| `undo-squash` | Restore commits to pre-squash state. Use when grouping was wrong. |
| `worklog` | Generate deliverable-focused worklogs for Jira from git history + Claude Code session logs, grouped by ticket. |

## Commands

| Command | Description |
|---------|-------------|
| `/code-review` | Run the 4-layer pre-merge verification pipeline before pushing or opening a PR. |
| `/commit` | Create a git commit. Alias for `commit-commands:commit` plugin skill. |
| `/fix-issues` | Autonomous bug fixing. Investigate → diagnose → fix → verify with gate checks. |
| `/start-work` | Initialize a feature or fix branch. Invokes git-conventions skill. |
| `/generate-api-tests` | Generate YAML integration tests for go-runner. Works with Flask, FastAPI, Express, NestJS, Django, Go. |
| `/squash-cleanup` | Remove squash backup tags and bundle files. |
| `/squash-commits` | Consolidate commits before push. |
| `/undo-squash` | Restore pre-squash state. |
| `/session-status` | Read-only session debrief. Shows catch-up summary without writing files. |
| `/session-persist` | Persist session findings to plan files. Captures discoveries and commits. |
| `/session-handoff` | Generate a resumption prompt for starting a fresh session. |
| `/implementation-audit` | Audit implementation against the plan. Dispatches parallel reviewers. |
| `/plan-hardening` | Validate a design document. |
| `/worklog` | Generate a ticket-grouped worklog from git history + session logs for Jira reporting. |

## Hooks

| Hook | Description |
|------|-------------|
| `dangerous-command-blocker.py` | Blocks catastrophic commands (`rm -rf`), protects critical paths. |
| `git-conventions.py` | Validates commit messages follow `type: Description` format. |
| `session-checkpoint.py` | Three-gate finishing checkpoint. Blocks `finishing-a-development-branch` until docs (`/session-persist`), code review (`/code-review`), and real validation (`record-validation.cjs`) all pass for HEAD. Gates 2 & 3 reuse the code-review skill's Node checkers (fail open if not installed). |
| `smart-compose.py` | Auto-approves composed Bash commands where every sub-command matches an allow rule. Includes heredoc safe-path for git commits. |

### Finishing gate (`session-checkpoint.py`) — extra setup

Gates 2 & 3 shell out to the `code-review` skill's Node checkers. **If the `code-review` skill isn't symlinked into `~/.claude/skills/`, those two gates silently fail open** (only the docs gate is enforced) — so install it too: see `skills/code-review/SETUP.md`.

The hook only fires on the `finishing-a-development-branch` skill, which ships in the external **`superpowers` plugin** — without that plugin installed, the hook is a harmless no-op.

**Validation evidence never enters your repo.** `record-validation.cjs` copies the artifacts you point it at into `<git-common-dir>/validation-evidence/<sha>/`, so the working tree of every repo you use this in stays pristine — nothing to accidentally `git add`, commit, or push, and no per-repo `.gitignore` entry needed.

Confirm the gate is actually enforcing, not quietly passing:

```bash
echo '{"tool_name":"Skill","tool_input":{"skill":"finishing-a-development-branch"},"cwd":"'"$(pwd)"'"}' \
  | python3 ~/.claude/hooks/session-checkpoint.py
```

Empty output = all gates pass. A `"permissionDecision": "deny"` JSON = the gate is working and tells you which gate failed and how to satisfy it. Decisions are logged to `$TMPDIR/finish-gate-diag.log`. Golden order: `/squash-commits` → `/code-review` → validate → `/session-persist` → finish.

## Dependencies

### Hooks (general)

All hooks require **Python 3.6+** (standard library only). The finishing gate additionally needs **Node ≥16** and **git ≥2.22** (see `skills/code-review/SETUP.md` for the full prerequisite table). Targets macOS and Linux; on Windows use WSL.

### dangerous-command-blocker.py

This hook blocks `rm -rf` and suggests using `trash` instead. Install the `trash` command:

**macOS:**
```bash
brew install trash
```

**Linux (Debian/Ubuntu):**
```bash
sudo apt install trash-cli
# Command is `trash-put` on Linux, may need alias:
alias trash='trash-put'
```

## Setup

### Skills & Commands

Symlink to your Claude Code config directory:

Run these from your `agent-skills` checkout (macOS/Linux; on Windows use WSL):

```bash
REPO="$(pwd)"                     # or: REPO=/path/to/your/agent-skills
mkdir -p ~/.claude/skills ~/.claude/commands

ln -sf "$REPO"/skills/*   ~/.claude/skills/
ln -sf "$REPO"/commands/* ~/.claude/commands/
```

Skills and commands work immediately after symlinking.

### Hooks

Hooks require **two steps** to activate:

#### Step 1: Create symlink

```bash
REPO="$(pwd)"                     # your agent-skills checkout
mkdir -p ~/.claude/hooks
ln -sf "$REPO"/hooks/* ~/.claude/hooks/
```

#### Step 2: Register in settings.json

Add the hook configuration to `~/.claude/settings.json`:

```json
{
  "hooks": {
    "PreToolUse": [
      {
        "matcher": "Bash",
        "hooks": [
          {
            "type": "command",
            "command": "python3 ~/.claude/hooks/dangerous-command-blocker.py"
          },
          {
            "type": "command",
            "command": "python3 ~/.claude/hooks/git-conventions.py"
          },
          {
            "type": "command",
            "command": "python3 ~/.claude/hooks/smart-compose.py"
          }
        ]
      },
      {
        "matcher": "Skill",
        "hooks": [
          {
            "type": "command",
            "command": "python3 ~/.claude/hooks/session-checkpoint.py"
          }
        ]
      }
    ]
  }
}
```

If you already have content in `settings.json`, merge the `hooks` object with existing content.

> **Ordering matters:** `smart-compose.py` must be **last** in the `Bash` hooks array. It auto-approves composed commands, so any deny-capable hook (e.g., `dangerous-command-blocker.py`, `git-conventions.py`) must run before it to retain the ability to block.

**Restart Claude Code** for hooks to take effect.

## Adding New Components

1. **New skill**: Create `skills/{name}/SKILL.md` with YAML frontmatter
2. **New command**: Create `commands/{name}.md` pointing to the skill
3. **New hook**: Create `hooks/{name}.py`, then register in `~/.claude/settings.json`
4. Re-run symlink commands above

### Aliasing Plugin Skills

Commands can also create short `/name` aliases for verbose plugin skill names. For example, `/commit` is an alias for the `commit-commands:commit` plugin skill:

```markdown
---
description: Create a git commit
---

Invoke the commit-commands:commit skill and follow it exactly.
```

This avoids typing `/commit-commands:commit` every time. Any plugin skill can be aliased this way — just create a command stub that references the fully-qualified skill name.
