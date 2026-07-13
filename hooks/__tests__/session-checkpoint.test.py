#!/usr/bin/env python3
"""
Integration tests for hooks/session-checkpoint.py (three-gate finishing gate).

Builds throwaway git repos, drives the hook with synthetic stdin, and asserts
allow (empty stdout) vs deny (permissionDecision=deny JSON). Uses the real
check-marker.cjs / check-validation.cjs via FINISH_GATE_CHECKER_DIR.

Run: python3 hooks/__tests__/session-checkpoint.test.py
"""

import json
import os
import shutil
import subprocess
import sys
import tempfile

HERE = os.path.dirname(os.path.abspath(__file__))
REPO = os.path.abspath(os.path.join(HERE, "..", ".."))
HOOK = os.path.join(REPO, "hooks", "session-checkpoint.py")
SCRIPTS = os.path.join(REPO, "skills", "code-review", "scripts")

GIT_ENV = {
    "GIT_AUTHOR_NAME": "T", "GIT_AUTHOR_EMAIL": "t@t",
    "GIT_COMMITTER_NAME": "T", "GIT_COMMITTER_EMAIL": "t@t",
}

results = {"pass": 0, "fail": 0}


def git(repo, *args):
    return subprocess.run(
        ["git", "-C", repo, *args], capture_output=True, text=True,
        env={**os.environ, **GIT_ENV},
    ).stdout.strip()


def init_repo():
    repo = tempfile.mkdtemp(prefix="fg-hook-")
    git(repo, "init", "-q")
    git(repo, "config", "commit.gpgsign", "false")
    return repo


def write(repo, rel, content="x"):
    p = os.path.join(repo, rel)
    os.makedirs(os.path.dirname(p), exist_ok=True)
    with open(p, "w") as fh:
        fh.write(content)


def commit(repo, msg):
    git(repo, "add", "-A")
    git(repo, "commit", "-q", "-m", msg)
    return git(repo, "rev-parse", "HEAD")


def common_dir(repo):
    d = git(repo, "rev-parse", "--git-common-dir")
    return d if os.path.isabs(d) else os.path.join(repo, d)


def run_hook(repo, branch_for_marker=None, extra_env=None, skill="finishing-a-development-branch"):
    stdin = json.dumps({
        "tool_name": "Skill",
        "tool_input": {"skill": skill},
        "cwd": repo,
    })
    env = {**os.environ, **GIT_ENV, "FINISH_GATE_CHECKER_DIR": SCRIPTS}
    if extra_env:
        env.update(extra_env)
    r = subprocess.run([sys.executable, HOOK], input=stdin, capture_output=True, text=True, env=env)
    denied = False
    reason = ""
    if r.stdout.strip():
        try:
            obj = json.loads(r.stdout)
            denied = obj.get("hookSpecificOutput", {}).get("permissionDecision") == "deny"
            reason = obj.get("hookSpecificOutput", {}).get("permissionDecisionReason", "")
        except json.JSONDecodeError:
            pass
    return {"denied": denied, "reason": reason, "raw": r.stdout, "code": r.returncode}


def persist_docs_marker(repo, branch):
    sanitized = branch.replace("/", "%2F")
    d = os.path.join(repo, ".claude", "sessions", sanitized)
    os.makedirs(d, exist_ok=True)
    open(os.path.join(d, "session-persist-done"), "w").close()


def record_validation(repo, payload):
    r = subprocess.run(
        ["node", os.path.join(SCRIPTS, "record-validation.cjs"), "--repo-root", repo],
        input=json.dumps(payload), capture_output=True, text=True, env={**os.environ, **GIT_ENV},
    )
    assert r.returncode == 0, f"record failed: {r.stdout}{r.stderr}"


def code_review_marker(repo, sha=None):
    sha = sha or git(repo, "rev-parse", "HEAD")
    open(os.path.join(common_dir(repo), f"code-review-passed-{sha}"), "w").close()


def check(name, cond, detail=""):
    if cond:
        results["pass"] += 1
        print(f"  ok   {name}")
    else:
        results["fail"] += 1
        print(f"  FAIL {name}  {detail}")


def ui_payload():
    return {"changeClass": "ui", "checks": [
        {"kind": "playwright", "command": "x", "exitCode": 0, "artifacts": ["docs/validation/shot.png"]}]}


# --- scenarios --------------------------------------------------------------

def scenario_all_pass():
    repo = init_repo()
    git(repo, "checkout", "-q", "-b", "feat/x")
    write(repo, "src/app.js", "v1")
    write(repo, "docs/validation/shot.png", "PNG")
    commit(repo, "code")
    persist_docs_marker(repo, "feat/x")
    code_review_marker(repo)
    record_validation(repo, ui_payload())
    r = run_hook(repo)
    check("all gates satisfied -> allow", not r["denied"] and not r["raw"].strip(), r["raw"])


def scenario_missing_each():
    repo = init_repo()
    git(repo, "checkout", "-q", "-b", "feat/x")
    write(repo, "src/app.js", "v1")
    write(repo, "docs/validation/shot.png", "PNG")
    commit(repo, "code")
    # nothing set -> all three fail
    r = run_hook(repo)
    check("no markers -> deny naming all 3", r["denied"] and "3 of 3" in r["reason"], r["reason"][:80])

    persist_docs_marker(repo, "feat/x")
    r = run_hook(repo)
    check("docs only -> still deny (review+validation)", r["denied"] and "2 of 3" in r["reason"], r["reason"][:80])

    code_review_marker(repo)
    r = run_hook(repo)
    check("docs+review -> deny (validation)", r["denied"] and "1 of 3" in r["reason"], r["reason"][:80])

    record_validation(repo, ui_payload())
    r = run_hook(repo)
    check("all set -> allow", not r["denied"], r["raw"])


def scenario_docs_only_branch_skip():
    repo = init_repo()
    write(repo, "base.txt", "base")
    commit(repo, "base")
    git(repo, "branch", "-M", "main")
    git(repo, "checkout", "-q", "-b", "docs/only")
    write(repo, "docs/plans/thing.md", "notes")
    commit(repo, "docs only")
    persist_docs_marker(repo, "docs/only")
    # No review/validation markers, but branch is docs-only vs main -> gates 2&3 skipped
    r = run_hook(repo)
    check("docs-only branch -> gates 2&3 skipped, allow", not r["denied"], r["raw"] or r["reason"][:80])


def scenario_tolerance_after_persist_commit():
    repo = init_repo()
    write(repo, "base.txt", "base")
    commit(repo, "base")
    git(repo, "branch", "-M", "main")
    git(repo, "checkout", "-q", "-b", "feat/y")
    write(repo, "src/app.js", "v1")
    write(repo, "docs/validation/shot.png", "PNG")
    commit(repo, "code + artifact")
    code_review_marker(repo)          # markers stamped at code HEAD
    record_validation(repo, ui_payload())
    # session-persist commits docs afterwards (moves HEAD)
    write(repo, "docs/plans/y.md", "notes")
    commit(repo, "docs: persist")
    persist_docs_marker(repo, "feat/y")
    r = run_hook(repo)
    check("docs commit after markers -> tolerance allows", not r["denied"], r["raw"] or r["reason"][:120])


def scenario_stale_after_code_commit():
    repo = init_repo()
    git(repo, "checkout", "-q", "-b", "feat/z")
    write(repo, "src/app.js", "v1")
    write(repo, "docs/validation/shot.png", "PNG")
    commit(repo, "code")
    persist_docs_marker(repo, "feat/z")
    code_review_marker(repo)
    record_validation(repo, ui_payload())
    # A NEW code commit lands -> review + validation go stale
    write(repo, "src/app.js", "v2")
    commit(repo, "more code")
    r = run_hook(repo)
    check("new code commit -> deny (stale review+validation)", r["denied"] and "2 of 3" in r["reason"], r["reason"][:80])


def scenario_bypass():
    repo = init_repo()
    git(repo, "checkout", "-q", "-b", "feat/b")
    write(repo, "src/app.js", "v1")
    commit(repo, "code")
    r = run_hook(repo, extra_env={"SKIP_FINISH_GATES": "1"})
    check("SKIP_FINISH_GATES=1 -> allow", not r["denied"] and not r["raw"].strip(), r["raw"])


def scenario_bypass_beats_hanging_git():
    """A wedged git must not trap the user: the git-timeout deny is fail-closed,
    but SKIP_FINISH_GATES=1 (checked before any git call) must still let them out."""
    repo = init_repo()
    git(repo, "checkout", "-q", "-b", "feat/hang")
    write(repo, "src/app.js", "v1")
    commit(repo, "code")
    # Shim a `git` that outlives the hook's 5s per-call timeout.
    shim_dir = tempfile.mkdtemp(prefix="fg-shim-")
    shim = os.path.join(shim_dir, "git")
    with open(shim, "w") as fh:
        fh.write("#!/bin/sh\nsleep 30\n")
    os.chmod(shim, 0o755)
    slow = {"PATH": shim_dir + os.pathsep + os.environ.get("PATH", "")}

    r = run_hook(repo, extra_env=slow)
    check("hanging git, no bypass -> deny (fail closed)", r["denied"], r["raw"][:80])

    r = run_hook(repo, extra_env={**slow, "SKIP_FINISH_GATES": "1"})
    check("hanging git + SKIP_FINISH_GATES=1 -> allow (escape hatch works)",
          not r["denied"] and not r["raw"].strip(), r["raw"][:120])


def scenario_non_finishing_skill():
    repo = init_repo()
    git(repo, "checkout", "-q", "-b", "feat/c")
    write(repo, "src/app.js", "v1")
    commit(repo, "code")
    r = run_hook(repo, skill="commit")
    check("non-finishing skill -> pass-through allow", not r["denied"] and not r["raw"].strip(), r["raw"])


def scenario_checker_absent_fail_open():
    repo = init_repo()
    git(repo, "checkout", "-q", "-b", "feat/d")
    write(repo, "src/app.js", "v1")
    commit(repo, "code")
    persist_docs_marker(repo, "feat/d")
    # Point checker dir at an empty tmp dir -> gates 2&3 fail open; only docs enforced
    empty = tempfile.mkdtemp(prefix="fg-empty-")
    r = run_hook(repo, extra_env={"FINISH_GATE_CHECKER_DIR": empty})
    check("checkers absent -> gates 2&3 fail open, docs present -> allow", not r["denied"], r["raw"] or r["reason"][:80])


def main():
    for fn in [
        scenario_all_pass, scenario_missing_each, scenario_docs_only_branch_skip,
        scenario_tolerance_after_persist_commit, scenario_stale_after_code_commit,
        scenario_bypass, scenario_bypass_beats_hanging_git,
        scenario_non_finishing_skill, scenario_checker_absent_fail_open,
    ]:
        print(f"# {fn.__name__}")
        try:
            fn()
        except Exception as e:
            results["fail"] += 1
            print(f"  FAIL {fn.__name__} raised: {e}")
    print(f"\n{results['pass']} passed, {results['fail']} failed")
    sys.exit(1 if results["fail"] else 0)


if __name__ == "__main__":
    main()
