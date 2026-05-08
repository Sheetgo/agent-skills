# code-review skill — install

End-to-end setup. Two layers: user-level (the skill itself) and per-project (the optional `git push` hook).

## 1. User-level install (required)

Symlink the skill into Claude Code's user-level skills directory:

```bash
ln -s ~/Development/Sheetgo/agent-skills/skills/code-review ~/.claude/skills/code-review
ln -s ~/Development/Sheetgo/agent-skills/commands/code-review.md ~/.claude/commands/code-review.md
```

Adjust the source path if your `agent-skills` checkout lives elsewhere. After this, a fresh Claude Code session has access to:

- The `code-review` skill (invoked automatically when the YAML description triggers fire, or manually with `/code-review`)
- All four subagent prompts at `~/.claude/skills/code-review/prompts/`
- Three helper scripts at `~/.claude/skills/code-review/scripts/`
- The worked example at `~/.claude/skills/code-review/examples/full-flow.md`

### Prerequisites for full functionality

| Prerequisite | Why | Where to get it |
|---|---|---|
| OpenAI Codex CLI installed at `/Applications/Codex.app/Contents/Resources/codex` | Layer 1 (a) parallel reviewer | Standard macOS install of the Codex desktop app |
| `gh` CLI (GitHub CLI) authenticated to the relevant org | Layer 1 base detection (PR base lookup) and DEFER + DOCUMENT thread queries | `brew install gh && gh auth login` |
| Node.js (any version with `fs` + `child_process`) | `parse-claims.cjs` and `check-marker.cjs` | Already required by most projects |

If the Codex CLI is unavailable, the skill falls back to reviewer-only Layer 1 (single-signal). If `gh` is unavailable or unauthenticated, the diff base falls back to `origin/master` and PR-context drafts are skipped.

### Verify user-level install

Open a fresh Claude Code session and run:

```
/code-review
```

The skill should announce itself and offer to run Layer 1. If the slash command isn't recognized, the symlinks above are likely missing or in the wrong location.

## 2. Per-project install (optional but recommended)

The `git push` gate auto-blocks pushes when the current HEAD hasn't been approved by the skill. To install in a consuming project:

```bash
cd <consuming-project>
mkdir -p .claude
```

Open `.claude/settings.local.json` and merge in the hook registration from `~/.claude/skills/code-review/project-setup/settings-fragment.json`:

```json
{
  "hooks": {
    "PreToolUse": [
      {
        "matcher": "Bash",
        "hooks": [
          {
            "type": "command",
            "command": "bash ~/.claude/skills/code-review/project-setup/git-push-gate-hook.sh"
          }
        ]
      }
    ]
  }
}
```

If the project already has hooks configured, append the `command` to the existing `PreToolUse[matcher=Bash].hooks` array — see `~/.claude/skills/code-review/project-setup/README.md` for merge guidance.

### Verify per-project install

Open a fresh Claude Code session in the project and try a no-op push:

```bash
git push --dry-run
```

Expected: Claude Code surfaces "🚫 code-review hasn't approved this commit yet." with bypass instructions. The actual `git` command never runs.

To validate the allow path: invoke `/code-review`, let it produce a PUSH READY verdict (which writes `.git/code-review-passed-<HEAD-sha>`), then re-attempt the push. The hook should silently allow.

### Bypass paths

The hook is gating, not enforcing. Two documented bypasses:

- `[skip-review]` in the latest commit message body
- `CODE_REVIEW_BYPASS=1 git push`

Both bypasses log to `/tmp/code-review-hook-diag.log` for auditing.

## Uninstall

User-level:
```bash
rm ~/.claude/skills/code-review ~/.claude/commands/code-review.md
```

Per-project: remove the `command` entry from `.claude/settings.local.json`.

## Troubleshooting

See `~/.claude/skills/code-review/project-setup/README.md` for hook-specific issues. For skill-level issues:

| Symptom | Likely cause | Fix |
|---|---|---|
| `/code-review` not recognized in fresh session | Symlinks missing | Re-run the `ln -s` commands above |
| Codex CLI fails with "binary not found" | Path mismatch | The wrapper hard-codes `/Applications/Codex.app/Contents/Resources/codex` per design. Adjust if your install path differs and open a PR for the change. |
| `parse-claims.cjs: command not found` | `chmod +x` not applied | `chmod +x ~/.claude/skills/code-review/scripts/*.{sh,cjs}` |
| Skill triggers don't fire automatically | YAML description not matching the user's prompt | Manual invocation via `/code-review` always works. The auto-trigger is best-effort; manual is the fallback. |

## Next steps after install

- Run the skill on a real branch to validate the full pipeline (the GREEN baselines in `baseline-tests/results/` are simulated; the first cleanroom run is the real test).
- If anything in the flow breaks, file findings against the agent-skills repo with the relevant `/tmp/code-review-hook-diag.log` excerpt and the SKILL.md section that misled.
- For ongoing tuning: the rationalization patterns the skill counters live in `~/.claude/skills/code-review/baseline-tests/rationalization-patterns.md` — new themes observed in the wild can be added there + cross-referenced into the SKILL.md red-flags table.
