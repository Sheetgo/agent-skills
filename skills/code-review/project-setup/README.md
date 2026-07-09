# code-review per-project install

Wires the `code-review` skill's git-push gate into a consuming project. After install, `git push` is blocked unless `/code-review` has approved the current HEAD.

**Prerequisite:** The skill must be installed at the user level. See `../SETUP.md` for the symlink instructions.

## What this directory contains

| File | Purpose |
|---|---|
| `git-push-gate-hook.sh` | PreToolUse bash hook. Reads stdin JSON from Claude Code, intercepts `git push` commands, runs the marker check, emits structured deny JSON when the marker is missing. |
| `settings-fragment.json` | Hook-registration snippet to merge into the consuming project's `.claude/settings.local.json`. |
| `README.md` | This doc. |

## Install steps

1. **Open the consuming project's `.claude/settings.local.json`.** Create it if missing:

   ```bash
   mkdir -p .claude
   touch .claude/settings.local.json
   ```

   If the file is empty, seed it with `{}`.

2. **Merge `settings-fragment.json` into the file.** The fragment is additive — if `hooks.PreToolUse[matcher=Bash]` already exists in the project's settings, append the new `command` entry to the existing `hooks` array. Otherwise paste the entire `hooks` block.

   Minimal new file:
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

   Existing hooks → append the `command` to the existing array.

3. **Verify.** Open a fresh Claude Code session in the project and try a dry-run push:

   ```bash
   git push --dry-run
   ```

   Expected behavior on a branch without a `/code-review` approval marker: Claude Code surfaces the deny message ("code-review hasn't approved this commit yet") with bypass instructions. The actual `git` process is never invoked.

   On a branch with the marker (`.git/code-review-passed-<HEAD-sha>` present): silent allow.

   The gate also accepts a marker on a **docs-only ancestor** of HEAD (ancestry proven via `git merge-base --is-ancestor`), so a `/session-persist` documentation commit landing after review doesn't re-block the push. This keeps the push gate consistent with the finishing gate (`hooks/session-checkpoint.py`), which shares the same checker library (`gate-lib.cjs`).

## Validation gate (opt-in)

By default the push gate only checks the code-review marker. To also require executed **validation evidence** at push time (a `validation-passed-<sha>` marker written by `record-validation.cjs`, whose Playwright/test/e2e artifacts are stored in `<git-common-dir>/validation-evidence/<sha>/` — never in the working tree, so nothing is committable or pushable), set `CODE_REVIEW_REQUIRE_VALIDATION=1` in the project's hook environment. Off by default so existing installs aren't newly blocked; skipped automatically if the validation checker isn't installed at the user level. The finishing gate enforces validation regardless — this switch only extends it to `git push`.

## Bypass paths

The hook is gating, not enforcing — there are two documented escapes:

| Bypass | When to use | How |
|---|---|---|
| `[skip-review]` in latest commit message | Docs-only commits, scripted automation, urgent reverts where reviewing post-hoc is fine | Add the literal substring `[skip-review]` to the latest commit message body. The hook greps the body and silently allows the push. |
| `CODE_REVIEW_BYPASS=1` env var | One-off pushes where you've already manually verified the diff | `CODE_REVIEW_BYPASS=1 git push` |

Both bypasses log to `$TMPDIR/code-review-hook-diag.log` so you can audit the rate at which the gate is being skipped.

## Uninstall

Remove the `command` entry you added in step 2, OR delete the entire `hooks.PreToolUse[matcher=Bash]` array if you didn't have other hooks there. The hook is per-project; removing it doesn't affect other projects.

## Troubleshooting

| Symptom | Cause | Fix |
|---|---|---|
| `git push` works without ever hitting the gate | Hook not registered, or matcher mismatch | Verify `.claude/settings.local.json` has the entry with `matcher: "Bash"` (case-sensitive). Open a fresh session — settings are loaded at session start. |
| Hook fires on every Bash command, not just push | Matcher too broad | The hook itself filters internally to `git push` only — if you see it on other commands, check the `tail` of `$TMPDIR/code-review-hook-diag.log` and report. |
| Deny message doesn't render in the UI | JSON output malformed | Run the hook with synthetic stdin: `echo '{"tool_name":"Bash","tool_input":{"command":"git push"}}' \| bash ~/.claude/skills/code-review/project-setup/git-push-gate-hook.sh`. The output should be valid JSON starting with `{"hookSpecificOutput":...`. |
| Hook never blocks even with no marker | `~/.claude/skills/code-review/scripts/check-marker.cjs` doesn't exist (user-level skill not installed) | The hook fails open in this case — see `../SETUP.md` for the user-level symlink. |
