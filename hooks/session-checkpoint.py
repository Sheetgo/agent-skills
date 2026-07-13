#!/usr/bin/env python3
"""
Session Checkpoint Hook — three-gate finishing checkpoint.

PreToolUse hook on the `Skill` tool. Intercepts `finishing-a-development-branch`
and DENIES it unless three gates are satisfied for the current HEAD:

  1. Documentation — `.claude/sessions/{%2F-branch}/session-persist-done` (branch)
  2. Code review   — `code-review-passed-<sha>`   (via check-marker.cjs)
  3. Validation    — `validation-passed-<sha>`     (via check-validation.cjs)

Gates 2 & 3 reuse the code-review skill's Node checkers (shared gate-lib.cjs), so
this hook and the git-push gate agree on marker validity (incl. the docs-only
ancestor tolerance). Design: docs/plans/2026-07-08-finishing-gate-validation-design.md

Trust model: the agent can write files freely (no Write/Edit hook), so this gate
is NOT tamper-proof — it makes doing the real work the default and makes skipping
loud + logged. Bypass: SKIP_FINISH_GATES=1 (one invocation), logged.

Hook protocol: read tool JSON on stdin; allow silently with exit 0; deny by
printing a hookSpecificOutput.permissionDecision=deny object and exit 0.
"""

import json
import os
import re
import shutil
import subprocess
import sys
import tempfile
import time

# Honor TMPDIR (tempfile.gettempdir()) rather than hardcoding /tmp, so the diag
# log works wherever the platform puts temp files.
DIAG_LOG = os.path.join(tempfile.gettempdir(), "finish-gate-diag.log")
# FINISH_GATE_CHECKER_DIR overrides the checker location for testing/development
# (mirrors the push-gate's CODE_REVIEW_CHECKER override).
CHECKER_DIR = os.environ.get("FINISH_GATE_CHECKER_DIR") or os.path.expanduser(
    "~/.claude/skills/code-review/scripts"
)


def log(msg):
    try:
        with open(DIAG_LOG, "a") as fh:
            fh.write(f"{time.strftime('%H:%M:%S')} [finish-gate] {msg}\n")
    except Exception:
        pass


def sanitize(text):
    # Strip control chars (except newline/tab) so agent-controlled strings can't
    # inject terminal escapes into the deny message.
    return re.sub(r"[\x00-\x08\x0b\x0c\x0e-\x1f\x7f]", "", str(text))


def allow():
    sys.exit(0)


def deny(reason):
    print(json.dumps({
        "hookSpecificOutput": {
            "hookEventName": "PreToolUse",
            "permissionDecision": "deny",
            "permissionDecisionReason": sanitize(reason),
        }
    }))
    sys.exit(0)


# ---- parse input -----------------------------------------------------------
try:
    input_data = json.load(sys.stdin)
except json.JSONDecodeError:
    allow()

if input_data.get("tool_name", "") != "Skill":
    allow()

skill_name = input_data.get("tool_input", {}).get("skill", "")
if "finishing-a-development-branch" not in skill_name:
    allow()

cwd = input_data.get("cwd") or os.getcwd()


def git(*args, timeout=5):
    return subprocess.run(
        ["git", "-C", cwd, *args],
        capture_output=True, text=True, timeout=timeout,
    )


# ---- bypass (env only, one-shot, logged) -----------------------------------
# Checked BEFORE any git call, so the documented escape hatch still works when
# git itself is hanging or broken (otherwise the git-timeout deny below would
# fire first and leave no way out). Mirrors the push-gate, which checks
# CODE_REVIEW_BYPASS before touching git.
if os.environ.get("SKIP_FINISH_GATES") == "1":
    log(f"BYPASS env cwd={cwd}")
    allow()

# ---- resolve git state -----------------------------------------------------
try:
    inside = git("rev-parse", "--is-inside-work-tree")
    if inside.returncode != 0:
        allow()  # not a git repo -> no gate
    branch = git("branch", "--show-current").stdout.strip()  # "" when detached
    repo_root = git("rev-parse", "--show-toplevel").stdout.strip()
    head_res = git("rev-parse", "HEAD")
    head = head_res.stdout.strip()
except FileNotFoundError:
    allow()  # git not installed -> no gate
except subprocess.TimeoutExpired:
    # Transient error — fail CLOSED (v1 failed open here, waiving all gates).
    # SKIP_FINISH_GATES=1 (checked above) is the escape hatch if git is wedged.
    log("DENY git-timeout")
    deny(
        "Could not determine git state (git timed out) — refusing to finish "
        "until the repository is responsive. Re-try; if it persists, investigate "
        "the working tree, then re-attempt finishing.\n\n"
        "If git is genuinely wedged and you must finish anyway, set "
        "SKIP_FINISH_GATES=1 for this one invocation (logged)."
    )

if not repo_root:
    allow()  # can't locate repo root -> no gate
if head_res.returncode != 0 or not head:
    allow()  # zero-commit branch -> nothing to finish

short = head[:8]


# ---- helpers ---------------------------------------------------------------
def git_safe(*args, timeout=5):
    # Like git() but never raises — a timeout/failure returns a non-zero result.
    # Used for non-critical resolution (base / docs-only) where a transient error
    # should mean "can't determine" (require gates), NOT crash the hook. The
    # initial branch/root resolution deliberately uses git() so a timeout there
    # fails closed with a diagnostic (see the try/except above).
    try:
        return git(*args, timeout=timeout)
    except (subprocess.TimeoutExpired, FileNotFoundError, OSError):
        return subprocess.CompletedProcess(args=args, returncode=124, stdout="", stderr="")


def is_docs_only_path(p):
    # Mirror of gate-lib.cjs isDocsOnly(). Keep the two in lockstep (parity test).
    norm = p.replace("\\", "/")
    if norm.startswith("./"):
        norm = norm[2:]
    parts = [x for x in norm.split("/") if x]
    if not parts:
        return False
    if parts[0] == "docs":
        return True
    if parts[0] == ".claude" and len(parts) > 1 and parts[1] == "sessions":
        return True
    return parts[-1].lower().endswith(".md")


def resolve_base():
    for c in ["origin/HEAD", "origin/main", "origin/master", "main", "master"]:
        mb = git_safe("merge-base", "HEAD", c)
        if mb.returncode == 0 and mb.stdout.strip():
            return mb.stdout.strip()
    sym = git_safe("symbolic-ref", "--quiet", "refs/remotes/origin/HEAD")
    if sym.returncode == 0 and sym.stdout.strip():
        mb = git_safe("merge-base", "HEAD", sym.stdout.strip())
        if mb.returncode == 0 and mb.stdout.strip():
            return mb.stdout.strip()
    conf = git_safe("config", "init.defaultBranch")
    if conf.returncode == 0 and conf.stdout.strip():
        mb = git_safe("merge-base", "HEAD", conf.stdout.strip())
        if mb.returncode == 0 and mb.stdout.strip():
            return mb.stdout.strip()
    return None


def branch_is_docs_only():
    base = resolve_base()
    if not base:
        return False  # can't resolve base -> do NOT skip (require gates)
    # -z (NUL-separated) so core.quotePath can't wrap non-ASCII paths in quotes
    # and corrupt is_docs_only_path() parsing; --no-renames so a rename into docs/
    # shows its (non-docs) source too. Mirrors gate-lib.cjs diffNamesZ().
    d = git_safe("diff", "--name-only", "-z", "--no-renames", f"{base}...HEAD")
    if d.returncode != 0:
        return False
    files = [x for x in d.stdout.split("\0") if x]
    return len(files) > 0 and all(is_docs_only_path(f) for f in files)


def run_checker(script_name):
    """Return (status, message): status in {'pass','fail','open'}.
    'open' = fail-open (node/script missing or infra error) — gate not enforced."""
    node = shutil.which("node")
    if not node:
        return ("open", "node not found")
    script = os.path.join(CHECKER_DIR, script_name)
    if not os.path.exists(script):
        return ("open", f"{script_name} not installed")
    try:
        r = subprocess.run(
            [node, script, "--repo-root", repo_root, "--allow-docs-ancestor"],
            capture_output=True, text=True, timeout=30, cwd=repo_root,
        )
    except subprocess.TimeoutExpired:
        return ("open", f"{script_name} timed out")
    msg = (r.stdout or "").strip()
    if r.stderr and r.stderr.strip():
        msg = f"{msg} {r.stderr.strip()}".strip()
    if r.returncode == 0:
        return ("pass", msg)
    if r.returncode == 1:
        return ("fail", msg)
    return ("open", f"infra error: {msg}")  # exit 2 / unexpected -> fail open


# ---- Gate 1: documentation -------------------------------------------------
gate1 = "pass"
gate1_detail = ""
if branch:
    sanitized_branch = branch.replace("/", "%2F")
    marker_path = os.path.join(
        repo_root, ".claude", "sessions", sanitized_branch, "session-persist-done"
    )
    if not os.path.exists(marker_path):
        gate1 = "fail"
        gate1_detail = "run /session-persist to capture discoveries/decisions and drop the marker"
else:
    gate1 = "skip"
    gate1_detail = "detached HEAD — cannot locate the branch session marker"
    log("GATE1 skip detached-HEAD")

# ---- Gates 2 & 3: review + validation --------------------------------------
gate2 = "skip"
gate2_detail = ""
gate3 = "skip"
gate3_detail = ""

if branch_is_docs_only():
    log(f"branch docs-only head={short} -> gates 2 & 3 skipped")
else:
    s2, m2 = run_checker("check-marker.cjs")
    if s2 == "pass":
        gate2 = "pass"
    elif s2 == "fail":
        gate2 = "fail"
        gate2_detail = m2 or "no code-review PUSH READY marker for HEAD"
    else:  # open
        gate2 = "open"
        log(f"GATE2 open: {m2}")

    s3, m3 = run_checker("check-validation.cjs")
    if s3 == "pass":
        gate3 = "pass"
    elif s3 == "fail":
        gate3 = "fail"
        gate3_detail = m3 or "no valid validation evidence for HEAD"
    else:  # open
        gate3 = "open"
        log(f"GATE3 open: {m3}")

# ---- verdict ---------------------------------------------------------------
failing = [g for g in (gate1, gate2, gate3) if g == "fail"]
if not failing:
    log(f"ALLOW branch={branch or '(detached)'} head={short} "
        f"g1={gate1} g2={gate2} g3={gate3}")
    allow()


def line(num, name, status, detail, remediation):
    label = {
        "pass": "PASS",
        "fail": "MISSING/INVALID",
        "skip": "n/a",
        "open": "SKIPPED (checker unavailable)",
    }[status]
    txt = f"  [{num}] {name:<13} — {label}"
    if status == "fail":
        if detail:
            txt += f"\n      why: {detail}"
        txt += f"\n      → {remediation}"
    return txt


# The deny text is the ONLY surface a Claude session gets when this gate fires in
# a repo that doesn't vendor these docs — so it must be self-sufficient: the full
# changeClass + kind enums, a worked example per shape, and the artifact rules.
VALIDATION_HOWTO = (
    "validate the change for real, then record the evidence.\n"
    "      changeClass: ui | backend | fullstack | other\n"
    "        • ui        → Playwright/browser walk + screenshot(s)\n"
    "        • backend   → run the test suite, capture the log\n"
    "        • fullstack → an e2e run covering both (one e2e check satisfies both)\n"
    "        • other     → config/infra/tooling: a smoke/build/lint/test run,\n"
    "                      or attest noAutomatableCheck + rationale (no enum value\n"
    "                      named 'config' — use 'other')\n"
    "      kind: playwright | screenshot | e2e | test | unit | integration |\n"
    "            clasp | smoke | build | lint\n"
    "      artifacts: paths to real, non-empty files you actually produced (a\n"
    "            screenshot, a captured test log) — wherever your tooling wrote\n"
    "            them, relative to the repo root or absolute. The recorder COPIES\n"
    "            them into this repo's git dir; your working tree is never touched,\n"
    "            so evidence can't be committed or pushed. exitCode must be 0.\n"
    "\n"
    "      node ~/.claude/skills/code-review/scripts/record-validation.cjs <<'JSON'\n"
    '      { "changeClass": "ui",\n'
    '        "checks": [ { "kind": "playwright",\n'
    '                      "command": "npm run test:e2e -- <spec>",\n'
    '                      "exitCode": 0,\n'
    '                      "artifacts": ["<path/to/screenshot.png>"] } ] }\n'
    "      JSON\n"
    "\n"
    "      Nothing automatable to run? Attest it instead:\n"
    "      node ~/.claude/skills/code-review/scripts/record-validation.cjs <<'JSON'\n"
    '      { "changeClass": "other", "checks": [],\n'
    '        "noAutomatableCheck": true,\n'
    '        "rationale": "<why no check exists — be specific>" }\n'
    "      JSON\n"
    "\n"
    "      Full reference: ~/.claude/skills/code-review/SKILL.md\n"
    "                      → \"Recording validation evidence\"."
)

n_fail = len(failing)
reason = (
    f"🚫 This branch isn't ready to finish. {n_fail} of 3 gates are not satisfied "
    f"for HEAD {short}:\n\n"
    + line(1, "Documentation", gate1, gate1_detail,
           "/session-persist") + "\n"
    + line(2, "Code review", gate2, gate2_detail,
           "/code-review — resolve FIX FIRST / DEFER verdicts until PUSH READY") + "\n"
    + line(3, "Validation", gate3, gate3_detail, VALIDATION_HOWTO) + "\n\n"
    "Recommended order: /code-review → validate → /session-persist → finish.\n"
    "(Run /squash-commits BEFORE reviewing/validating — squashing rewrites "
    "commits and re-arms gates 2 & 3.)\n\n"
    "Bypass (genuinely un-validatable — infra-only / external trigger): set "
    "SKIP_FINISH_GATES=1 for this one invocation. Every use is logged to "
    f"{DIAG_LOG}. It is intentionally noisy.\n\n"
    "After satisfying the gates, retry finishing the branch."
)

log(f"DENY branch={branch or '(detached)'} head={short} "
    f"g1={gate1} g2={gate2} g3={gate3} failing={n_fail}")
deny(reason)
