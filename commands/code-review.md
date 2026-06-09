---
description: "Use before pushing a branch, opening a PR, updating an existing PR, or merging. Verifies AI-found code-review claims through a 4-layer pipeline."
---

Follow the skill at `~/.claude/skills/code-review/SKILL.md` exactly.

Sub-files are in `~/.claude/skills/code-review/`:
- `prompts/` — subagent prompts for Layer 1 reviewer + Layer 3 panel
- `scripts/` — Codex CLI wrapper, claim parser, hook script
- `project-setup/` — per-project install bits (settings fragment, hook)
- `examples/` — worked examples
