# Agent Skills

Collection of AI agent skills and hooks for coding assistants.

## Structure

```
agent-skills/
├── skills/           # Skill definitions (SKILL.md files)
│   ├── generate-api-tests/
│   ├── git-conventions/
│   ├── implementation-audit/
│   ├── plan-hardening/
│   ├── session-notes/
│   ├── squash-commits/
│   └── undo-squash/
├── commands/         # Command stubs for explicit invocation
│   ├── commit.md
│   ├── generate-api-tests.md
│   ├── implementation-audit.md
│   ├── plan-hardening.md
│   ├── session-handoff.md
│   ├── session-persist.md
│   ├── session-status.md
│   ├── squash-commits.md
│   ├── squash-cleanup.md
│   ├── start-work.md
│   └── undo-squash.md
├── hooks/            # Safety and validation hooks
│   ├── dangerous-command-blocker.py
│   ├── git-conventions.py
│   └── session-checkpoint.py
└── docs/plans/       # Design documents
```

## Skills

| Skill | Description |
|-------|-------------|
| `generate-api-tests` | Framework-agnostic API test generator. Creates YAML integration tests for go-runner and CI/CD pipelines. |
| `git-conventions` | Branch naming and commit format conventions. Enforces `type: Description` format via hook. |
| `plan-hardening` | Systematically validate draft designs until convergence (0 must-fix, 0 should-fix). |
| `squash-commits` | Consolidate commits into cohesive logical groups. Use when ready to push. |
| `session-notes` | Session context management — status debrief, persist findings, or generate handoff prompt. |
| `implementation-audit` | Dispatch parallel reviewers to validate implementation against the plan. |
| `undo-squash` | Restore commits to pre-squash state. Use when grouping was wrong. |

## Commands

| Command | Description |
|---------|-------------|
| `/commit` | Create a git commit. Alias for `commit-commands:commit` plugin skill. |
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

## Hooks

| Hook | Description |
|------|-------------|
| `dangerous-command-blocker.py` | Blocks catastrophic commands (`rm -rf`), protects critical paths. |
| `git-conventions.py` | Validates commit messages follow `type: Description` format. |
| `session-checkpoint.py` | Intercepts `finishing-a-development-branch` to force documentation update. |

## Dependencies

### Hooks (general)

All hooks require **Python 3.6+** (uses only standard library modules: `json`, `sys`, `re`).

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

```bash
# Skills
ln -sf ~/Development/agent-skills/skills/* ~/.claude/skills/

# Commands
ln -sf ~/Development/agent-skills/commands/* ~/.claude/commands/
```

Skills and commands work immediately after symlinking.

### Hooks

Hooks require **two steps** to activate:

#### Step 1: Create symlink

```bash
mkdir -p ~/.claude/hooks
ln -sf ~/Development/agent-skills/hooks/* ~/.claude/hooks/
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
