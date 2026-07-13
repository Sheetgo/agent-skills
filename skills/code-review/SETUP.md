# code-review skill — install

End-to-end setup. Two layers: user-level (the skill itself) and per-project (the optional `git push` hook).

## 1. User-level install (required)

Symlink the skill into Claude Code's user-level skills directory. Run this from
your `agent-skills` checkout (works on macOS and Linux; on Windows use WSL):

```bash
REPO="$(pwd)"                      # or: REPO=/path/to/your/agent-skills
mkdir -p ~/.claude/skills ~/.claude/commands
ln -s "$REPO/skills/code-review"      ~/.claude/skills/code-review
ln -s "$REPO/commands/code-review.md" ~/.claude/commands/code-review.md
```

After this, a fresh Claude Code session has access to:

- The `code-review` skill (invoked automatically when the YAML description triggers fire, or manually with `/code-review`)
- All four subagent prompts at `~/.claude/skills/code-review/prompts/`
- Seven helper scripts at `~/.claude/skills/code-review/scripts/` (`run-codex.sh`, `parse-claims.cjs`, `detect-security-relevant.sh`, `check-marker.cjs`, plus the gate library `gate-lib.cjs` and the validation-evidence pair `record-validation.cjs` / `check-validation.cjs`, which the finishing gate in `hooks/session-checkpoint.py` also consumes)
- The worked example at `~/.claude/skills/code-review/examples/full-flow.md`

### Prerequisites for full functionality

| Prerequisite | Why | Where to get it |
|---|---|---|
| OpenAI Codex CLI (any OS), authenticated | Layer 1 (a) parallel reviewer | See "Installing the Codex CLI" below |
| `gh` CLI (GitHub CLI) authenticated to the relevant org | Layer 1 base detection (PR base lookup) and DEFER + DOCUMENT thread queries | macOS `brew install gh` · Debian/Ubuntu `sudo apt install gh` · Fedora/RHEL `sudo dnf install gh` · Windows `winget install GitHub.cli` — then `gh auth login` |
| Node.js **≥ 16** (runtime) | The checker/recorder scripts (`parse-claims.cjs`, `check-marker.cjs`, `gate-lib.cjs`, `check-validation.cjs`, `record-validation.cjs`) — need only `fs` / `path` / `child_process` | Already required by most projects |
| Node.js **≥ 18** (contributors only) | The test suite uses the built-in `node:test` runner (`node --test`), which doesn't exist before Node 18. Not needed to *use* the skill — only to run its tests. | nvm / nodesource / `brew install node` |
| Git **≥ 2.22** (runtime), **≥ 2.31** recommended | `git branch --show-current` needs 2.22. `git worktree list --porcelain`'s `prunable` annotation needs 2.31 — on older git, marker pruning simply over-retains markers for deleted worktrees (fail-safe: no wrong allow/deny, just `.git` clutter). | System package manager |

> **OS note:** everything here targets macOS and Linux (and Windows via **WSL**). The hooks are POSIX shell + Python and write their diagnostic logs to `$TMPDIR` (falling back to `/tmp`). Native (non-WSL) Windows is not a supported target — the shell hooks and the symlink-based install both assume a POSIX environment.

If the Codex CLI is unavailable, the skill falls back to reviewer-only Layer 1 (single-signal) — Layer 1(b), the `code-reviewer` subagent, still runs, so the pipeline works without Codex (just no cross-validation). If `gh` is unavailable or unauthenticated, the diff base falls back to the remote's default branch (`origin/main`/`origin/master`) and PR-context drafts are skipped.

### Installing the Codex CLI

The Codex CLI is cross-platform (macOS / Linux / Windows-WSL). Install it whichever way you prefer:

```bash
npm install -g @openai/codex     # any OS with Node
# or, on macOS:
brew install --cask codex
```

Then authenticate once (Layer 1(a) can't run unauthenticated):

```bash
codex login        # opens a browser; or `codex login --help` for API-key auth
codex doctor       # verifies install + auth + runtime health
```

**How the skill finds the binary** — `run-codex.sh` resolves it in this order, so it works regardless of where Codex lives:

1. `$CODEX_BIN` — set this to an explicit path if your `codex` is somewhere unusual: `export CODEX_BIN=/path/to/codex`.
2. `codex` on your `PATH` (the normal result of the installs above).
3. Known fallback locations — the macOS desktop app (`/Applications/Codex.app/Contents/Resources/codex`), `~/.codex/bin/codex`, `/opt/homebrew/bin/codex`, `/usr/local/bin/codex`.

The wrapper runs `codex review --base <ref>`. If a future Codex version changes the review flags, check `codex review --help` and set `CODEX_BIN` to the matching build (or open a PR adjusting the wrapper).

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

Both bypasses log to `$TMPDIR/code-review-hook-diag.log` for auditing.

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
| Codex CLI "not found" → Layer 1 runs reviewer-only | `codex` not installed or not discoverable | Install it (`npm i -g @openai/codex` / `brew install --cask codex`) and run `codex login`; or `export CODEX_BIN=/path/to/codex`. See "Installing the Codex CLI" above. |
| Codex found but the review errors / quota hit | Not authenticated, or version flag drift | Run `codex login` + `codex doctor`; confirm the review flags with `codex review --help`. The skill degrades to reviewer-only on any Codex failure. |
| `parse-claims.cjs: command not found` | `chmod +x` not applied | `chmod +x ~/.claude/skills/code-review/scripts/*.{sh,cjs}` |
| Skill triggers don't fire automatically | YAML description not matching the user's prompt | Manual invocation via `/code-review` always works. The auto-trigger is best-effort; manual is the fallback. |

## Next steps after install

- Run the skill on a real branch to validate the full pipeline (the GREEN baselines in `baseline-tests/results/` are simulated; the first cleanroom run is the real test).
- If anything in the flow breaks, file findings against the agent-skills repo with the relevant `$TMPDIR/code-review-hook-diag.log` excerpt and the SKILL.md section that misled.
- For ongoing tuning: the rationalization patterns the skill counters live in `~/.claude/skills/code-review/baseline-tests/rationalization-patterns.md` — new themes observed in the wild can be added there + cross-referenced into the SKILL.md red-flags table.
