# Agent Skills

Personal collection of AI agent skills and hooks for coding assistants.

## Structure

```
agent-skills/
├── skills/           # Skill definitions (SKILL.md files)
│   ├── plan-hardening/
│   ├── squash-commits/
│   └── undo-squash/
├── commands/         # Command stubs for explicit invocation
│   ├── plan-hardening.md
│   ├── squash-commits.md
│   └── undo-squash.md
└── hooks/            # Safety hooks
    └── dangerous-command-blocker.py
```

## Skills

| Skill | Description |
|-------|-------------|
| `plan-hardening` | Systematically validate draft designs until convergence (0 must-fix, 0 should-fix). Use after brainstorming when discovery is done but confidence is low. |
| `squash-commits` | Consolidate commits into cohesive logical groups. Use when all todos are completed and ready to push. |
| `undo-squash` | Restore commits to pre-squash state. Use when grouping was wrong or need original history back. |

## Hooks

| Hook | Description |
|------|-------------|
| `dangerous-command-blocker.py` | Multi-level security: blocks catastrophic commands (`rm -rf`), protects critical paths (`.git`, `.env`), warns on suspicious patterns. |

## Dependencies

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
          }
        ]
      }
    ]
  }
}
```

If you already have content in `settings.json`, merge the `hooks` object with existing content.

**Restart Claude Code** for hooks to take effect.

## Adding New Skills

1. Create `skills/{skill-name}/SKILL.md`
2. Create `commands/{skill-name}.md` (optional, for explicit invocation)
3. Re-run symlink commands above
