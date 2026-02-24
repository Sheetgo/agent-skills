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
import re

DEBUG = os.environ.get("SMART_COMPOSE_DEBUG") == "1"

TRUSTED_BUILTINS = frozenset({
    "cd", "echo", "printf", "true", "false", "test", "[", "[[",
    # v2: coreutils
    "cp", "mv", "mkdir", "touch",
    "cat", "head", "tail", "wc", "less",
    "awk", "sed", "grep", "sort", "uniq", "tee",
    "basename", "dirname", "realpath",
    "date", "sleep",
})

MAX_COMMAND_SIZE = 65536    # 64KB
MAX_SETTINGS_SIZE = 1048576  # 1MB
MAX_EXPANSION_DEPTH = 3

_VAR_ASSIGN_RE = re.compile(r'^[A-Za-z_][A-Za-z0-9_]*=')


def _debug(msg):
    if DEBUG:
        print(f"[smart-compose:debug] {msg}", file=sys.stderr)


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
            if len(cmd) == len(prefix) or cmd[len(prefix)] in (" ", "\t") or prefix.endswith("="):
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
        # Fallback: blanket block on command expansions (no rules available)
        # ${VAR} is safe (variable expansion), only block $(cmd), `cmd`, <(cmd), >(cmd)
        if any(t == "cmd" for t, _ in extract_expansions(args)):
            _debug(f'sub-cmd: "{cmd}" -> builtin "{name}" blocked by expansion guard')
            return False

    _debug(f'sub-cmd: "{cmd}" -> builtin:"{name}"')
    return True


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


if __name__ == "__main__":
    main()
