# Agent Skills

Personal collection of AI agent skills for coding assistants.

## Structure

```
agent-skills/
├── skills/           # Skill definitions (SKILL.md files)
│   └── plan-hardening/
└── commands/         # Command stubs for explicit invocation
    └── plan-hardening.md
```

## Skills

| Skill | Description |
|-------|-------------|
| `plan-hardening` | Systematically validate draft designs until convergence (0 must-fix, 0 should-fix). Use after brainstorming when discovery is done but confidence is low. |

## Setup

Symlink to your agent's skill directory:

```bash
# For Claude Code
ln -sf ~/Development/agent-skills/skills/* ~/.claude/skills/
ln -sf ~/Development/agent-skills/commands/* ~/.claude/commands/
```

## Adding New Skills

1. Create `skills/{skill-name}/SKILL.md`
2. Create `commands/{skill-name}.md` (optional, for explicit invocation)
3. Re-run symlink commands above
