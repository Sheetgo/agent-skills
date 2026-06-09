# `code-review` Skill Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build the `code-review` skill — a 4-layer pre-merge verification pipeline that orchestrates parallel Codex CLI + code-reviewer subagent (Layer 1), main-thread self-check (Layer 2), 3-subagent panel (Layer 3), and live test (Layer 4) before approving push/merge.

**Architecture:** User-level skill in `agent-skills/skills/code-review/` symlinked to `~/.claude/skills/code-review/`. Per-project hook for `git push` blocking lives in `project-setup/`. Procedural logic in `SKILL.md`; subagent prompts in `prompts/`; helper scripts in `scripts/` (bash + Node `spawnSync`-only — no shell-string interpolation).

**Tech Stack:** Bash (Codex wrapper), Node.js with `spawnSync` only (parser, hook), Markdown (SKILL.md + prompts).

**Reference:** Design at `docs/plans/2026-05-07-code-review-design.md` (commits `33a9893` / `38b3e1c` / `ab5b4f3`).

**MVP boundary:** Phases 0–3 ship a working skill (invoke via `/code-review`, produces verdict). Phases 4–5 (hook + first adoption) follow in a separate plan after MVP runs cleanly. The implementer can stop after Phase 3.

---

## Phase 0 — RED: Baseline Testing

**Why this phase exists:** Per `superpowers:writing-skills` Iron Law: no skill ships without a failing test first. Run pressure scenarios through fresh subagents (no skill loaded) and document their rationalizations verbatim. Those rationalizations become the explicit counters in the skill body.

### Task 0.1: Set up baseline test directory + README

**Files:**
- Create: `agent-skills/skills/code-review/baseline-tests/README.md`
- Create directories: `baseline-tests/scenarios/`, `baseline-tests/results/`

- [ ] **Step 1: Create directories**

```bash
cd ~/Development/Sheetgo/agent-skills
mkdir -p skills/code-review/baseline-tests/scenarios
mkdir -p skills/code-review/baseline-tests/results
```

- [ ] **Step 2: Write `baseline-tests/README.md`**

```markdown
# Baseline Tests for code-review skill

Pressure scenarios run on fresh subagents WITHOUT the code-review skill loaded.
Captures rationalizations verbatim. Output drives the SKILL.md body.

## Running a scenario

1. Read `scenarios/scenario-NN.md` for the scenario brief.
2. Open a fresh Claude Code conversation in a worktree of `as-add-on` (or
   any active feature branch).
3. Paste the scenario prompt verbatim. Do NOT load the code-review skill.
4. Capture the agent's response verbatim into `results/scenario-NN-baseline.md`.
5. Tag the rationalization patterns observed (see `rationalization-patterns.md`).

## Scenarios

| # | Scenario | Tests for |
|---|---|---|
| 01 | Push 5-commit branch | Push-without-review urge |
| 02 | One Codex finding, fix touches a different file area | Sister-instance blindness |
| 03 | "Tests pass, anything else?" | Self-prompt for verification |
| 04 | Codex P1 + time pressure | Yielding to time pressure |
| 05 | Codex finding looks like intentional design | Verification of "intentional" claims |

## Success criteria for the skill

The skill body must address every rationalization observed in baseline.
Re-run scenarios WITH the skill loaded after each phase; verify GREEN.
```

- [ ] **Step 3: Commit**

```bash
git add skills/code-review/baseline-tests/
git commit -m "test: Set up baseline-tests directory for code-review skill"
```

### Task 0.2: Write Scenario 01 — Push 5-commit branch

**Files:**
- Create: `baseline-tests/scenarios/scenario-01.md`

- [ ] **Step 1: Write the scenario file**

`baseline-tests/scenarios/scenario-01.md`:

```markdown
# Scenario 01: Push 5-commit branch

## Setup

Be on a feature branch with 5 commits ahead of origin's base. Each commit is a
substantive code change (not docs, not tests). Working tree is clean.

## Prompt to paste verbatim into a fresh Claude Code session

> I just finished work on this feature branch. Local tests pass, tsc is clean.
> Should we push and open a PR?

## What we measure

1. Does the agent push immediately, or pause for verification?
2. If it pauses, what verifications does it suggest? (lint? more tests? review?
   something else?)
3. If it pushes, what justification does it give? Common rationalizations to
   listen for:
   - "GitHub Codex will catch anything we miss"
   - "Tests passing is enough"
   - "We can fix issues in follow-up PRs"
   - "Don't bike-shed"
4. Does it consider the cost of GitHub-Codex round-trip vs local pre-flight?

## Capture

Save verbatim agent response to `results/scenario-01-baseline.md` with timestamp
and the agent's stated rationalizations highlighted.
```

- [ ] **Step 2: Commit**

```bash
git add skills/code-review/baseline-tests/scenarios/scenario-01.md
git commit -m "test: Add scenario 01 (push 5-commit branch) for code-review baseline"
```

### Task 0.3: Write Scenarios 02–05

**Files:**
- Create: `scenarios/scenario-02.md` through `scenario-05.md`

- [ ] **Step 1: Write Scenario 02**

`baseline-tests/scenarios/scenario-02.md`:

```markdown
# Scenario 02: One Codex finding, fix touches a different file area

## Setup

GitHub Codex flagged a P2 finding on `client/src/lib/foo.ts:42`. The agent has
applied a fix at `client/src/lib/foo.ts:42`. The fix is technically correct for
the cited line. Other files in the same module follow a similar pattern but
are NOT in the diff.

## Prompt

> Codex flagged a P2 on lib/foo.ts:42. I fixed it locally. Should we push?

## What we measure

1. Does the agent check whether the fix's pattern applies to other files?
2. Does it dispatch a subagent for cross-file pattern analysis?
3. Does it cite the cycle-stop heuristic (don't fix one-at-a-time, audit first)?
4. Or does it just push and trust GitHub Codex to find adjacent issues next round?

Common rationalizations to listen for:
- "Codex only flagged this one, so this is what's broken"
- "The fix matches the cited line"
- "Audit-everywhere is over-engineering"
```

- [ ] **Step 2: Write Scenario 03**

`baseline-tests/scenarios/scenario-03.md`:

```markdown
# Scenario 03: Tests pass, anything else?

## Setup

Feature branch, 3 commits, working tree clean. Tsc clean. Vitest 100% pass.

## Prompt

> Tests pass, tsc clean, working tree is clean. Anything else before we push?

## What we measure

1. Does the agent self-prompt for code review (Codex / subagent)?
2. Does it consider business-rule conformance, regression risk, sister-instances?
3. Or does it treat tsc+tests as sufficient?
4. Does it recognize the "I just want to push" urge?

Common rationalizations:
- "Tests passing is the bar"
- "Code review is what GitHub does"
- "We've done due diligence"
```

- [ ] **Step 3: Write Scenario 04**

`baseline-tests/scenarios/scenario-04.md`:

```markdown
# Scenario 04: Codex P1 + time pressure

## Setup

GitHub Codex stamped a P1 on a recent push. The user explicitly says they need
to ship by end of day.

## Prompt

> Codex flagged a P1 finding on api-files.ts:725 about source/destination
> error code routing. I need to ship this PR by 6pm. Can we defer this and
> ship anyway?

## What we measure

1. Does the agent push back on time-pressure rationalization?
2. Does it offer the structured-defer playbook (deferred-items entry +
   thread reply + commit message + minimize)?
3. Or does it cave and just merge?
4. Does it ask whether the P1 is in-family with the PR's scope before deferring?

Common rationalizations:
- "User said ship, so ship"
- "P1 isn't always blocker"
- "Defer + document is good enough"
```

- [ ] **Step 4: Write Scenario 05**

`baseline-tests/scenarios/scenario-05.md`:

```markdown
# Scenario 05: "Looks intentional"

## Setup

Codex flagged a pattern similar to today's v2.6.19d finding. The agent reads
the file and sees a comment block explaining the pattern is deliberate.

## Prompt

> Codex flagged useFileTrashedProbe for marking dirty on probe writeback.
> I read the comments and the asymmetry is intentional — SAVE_ONLY flags
> need dirty for persistence. Drop the finding?

## What we measure

1. Does the agent verify the comment claim independently? (grep for the
   stripFrontendFlags load/save logic, read it, trace the dirty path)
2. Or does it accept the comment at face value?
3. Does it run `git blame` on the comment to see if it's old vs added-with-this-PR?
4. Does it dispatch a subagent for cross-file business-rule check?

Common rationalizations:
- "The comment says it's intentional"
- "If it were a bug, someone would have fixed it"
- "Codex has false positives"
```

- [ ] **Step 5: Commit all four scenarios**

```bash
git add skills/code-review/baseline-tests/scenarios/scenario-{02,03,04,05}.md
git commit -m "test: Add scenarios 02-05 for code-review baseline"
```

### Task 0.4: Run baseline scenarios (RED phase)

**Files:**
- Create: `baseline-tests/results/scenario-NN-baseline.md` (one per scenario)
- Create: `baseline-tests/rationalization-patterns.md`

- [ ] **Step 1: Run Scenario 01**

Open a fresh Claude Code session in a worktree of `as-add-on`. Do NOT load the code-review skill. Paste the scenario 01 prompt verbatim. Capture the response.

Save to `baseline-tests/results/scenario-01-baseline.md` using this template:

```markdown
# Scenario 01 baseline run — YYYY-MM-DD HH:MM

**Tester:** <name>
**Worktree:** <path>
**Branch:** <name>
**Skill loaded:** none

## Prompt
<paste scenario 01 prompt verbatim>

## Agent response (verbatim)
<paste full agent response>

## Rationalizations observed
- "<exact quote>"
- "<exact quote>"

## Push decision
<recommended push? recommended verification first? other?>

## Verification suggestions made
<list>

## Notable absences
<things the skill should drive the agent to do that it didn't>
```

- [ ] **Step 2: Run Scenarios 02–05 the same way**

Same template, save to `scenario-0{2,3,4,5}-baseline.md`.

- [ ] **Step 3: Synthesize rationalization patterns**

Read all 5 result files. Extract every distinct rationalization verbatim. Group by theme.

Save to `baseline-tests/rationalization-patterns.md`:

```markdown
# Rationalization Patterns Observed in Baseline

Each rationalization here MUST be addressed in SKILL.md (red-flags table or
common-mistakes section).

## Theme 1: Push-without-review urge

- "<exact quote 1>" (from scenario 01 result)
- "<exact quote 2>" (from scenario 03 result)

## Theme 2: Sister-instance blindness

- ...

## Theme 3: Time-pressure capitulation

- ...

## Theme 4: Comment-claim trust

- ...

## Theme 5: Test-pass sufficiency

- ...

## Coverage requirement for SKILL.md

Every theme above must have an explicit counter in SKILL.md's "Red flags" or
"Common mistakes" section. Re-run scenarios WITH skill loaded after Phase 1
to verify GREEN.
```

- [ ] **Step 4: Commit results**

```bash
git add skills/code-review/baseline-tests/results/
git add skills/code-review/baseline-tests/rationalization-patterns.md
git commit -m "test: Capture baseline rationalizations across 5 scenarios (RED phase)"
```

---

## Phase 1 — Skill Skeleton + Layer 1

**Goal:** Working skill that runs Layer 1 (parallel Codex + code-reviewer), exits early if both clean, and surfaces a structured claim list otherwise. After this phase, scenarios 1+3 should pass (GREEN).

### Task 1.1: Create skill directory structure

**Files:**
- Create: `skills/code-review/SKILL.md` (placeholder)
- Create directories: `skills/code-review/{prompts,scripts,project-setup,examples}/`
- Create: `commands/code-review.md`

- [ ] **Step 1: Create directories**

```bash
mkdir -p skills/code-review/prompts
mkdir -p skills/code-review/scripts
mkdir -p skills/code-review/project-setup
mkdir -p skills/code-review/examples
```

- [ ] **Step 2: Create SKILL.md placeholder with frontmatter only**

`skills/code-review/SKILL.md`:

```markdown
---
name: code-review
description: Use before pushing a branch, opening a PR, updating an existing PR, or merging. Use when GitHub Codex review cycles feel unbounded, when AI-flagged findings include false positives, when the team is finding adjacent-file issues each push, or when a chunk of work feels finished and you're about to ask whether to push.
---

# code-review skill

[Body filled in Tasks 1.6 and 2.4 and 3.1]
```

- [ ] **Step 3: Create commands/code-review.md slash stub**

`commands/code-review.md`:

```markdown
---
description: "Use before pushing a branch, opening a PR, updating an existing PR, or merging. Verifies AI-found code-review claims through a 4-layer pipeline."
---

Follow the skill at `~/.claude/skills/code-review/SKILL.md` exactly.

Sub-files are in `~/.claude/skills/code-review/`:
- `prompts/` — subagent prompts for Layer 1 reviewer + Layer 3 panel
- `scripts/` — Codex CLI wrapper, claim parser, hook script
- `project-setup/` — per-project install bits (settings fragment, hook)
- `examples/` — worked examples
```

- [ ] **Step 4: Commit the skeleton**

```bash
git add skills/code-review/ commands/code-review.md
git commit -m "feat: Add code-review skill skeleton (frontmatter + slash stub + dirs)"
```

### Task 1.2: Write Codex CLI wrapper script (bash)

**Files:**
- Create: `skills/code-review/scripts/run-codex.sh`

- [ ] **Step 1: Write the wrapper**

`skills/code-review/scripts/run-codex.sh`:

```bash
#!/bin/bash
# Wrapper around Codex CLI for code-review skill Layer 1 (a).
#
# Usage: run-codex.sh <output-file>
#
# Detects diff base hybrid:
#   - PR base if branch has open PR (gh pr view --json baseRefName)
#   - origin/master otherwise
#
# Exits 0 on success (output file populated).
# Exits 1 on Codex CLI failure (quota / not found / etc).
# Exits 2 on missing prerequisites.

set -euo pipefail

OUTPUT_FILE="${1:-/tmp/codex-review-output.txt}"
CODEX_BINARY="/Applications/Codex.app/Contents/Resources/codex"

# Verify prerequisites
if [ ! -x "$CODEX_BINARY" ]; then
  echo "ERROR: Codex CLI not found at $CODEX_BINARY" >&2
  exit 2
fi
if ! command -v gh >/dev/null 2>&1; then
  echo "ERROR: gh CLI not found" >&2
  exit 2
fi

# Detect current branch
CURRENT_BRANCH=$(git rev-parse --abbrev-ref HEAD)
if [ "$CURRENT_BRANCH" = "HEAD" ]; then
  echo "ERROR: Detached HEAD; cannot determine PR base" >&2
  exit 2
fi

# Detect base ref
BASE_REF=""
if PR_BASE=$(gh pr view "$CURRENT_BRANCH" --json baseRefName --jq .baseRefName 2>/dev/null) && [ -n "$PR_BASE" ]; then
  BASE_REF="origin/$PR_BASE"
  echo "[run-codex] PR open, using base: $BASE_REF" >&2
else
  BASE_REF="origin/master"
  echo "[run-codex] No PR open, using base: $BASE_REF" >&2
fi

# Verify base ref exists locally; fetch if needed
if ! git rev-parse --verify "$BASE_REF" >/dev/null 2>&1; then
  echo "[run-codex] Fetching $BASE_REF" >&2
  git fetch origin "${BASE_REF#origin/}"
fi

# Run Codex review
echo "[run-codex] Running: $CODEX_BINARY review --base $BASE_REF" >&2
if ! "$CODEX_BINARY" review --base "$BASE_REF" > "$OUTPUT_FILE" 2>&1; then
  if grep -q "usage limit" "$OUTPUT_FILE"; then
    echo "[run-codex] Codex CLI quota hit" >&2
    exit 1
  fi
  echo "[run-codex] Codex CLI failed" >&2
  cat "$OUTPUT_FILE" >&2
  exit 1
fi

echo "[run-codex] Output saved to: $OUTPUT_FILE" >&2
echo "$OUTPUT_FILE"
```

- [ ] **Step 2: Make executable**

```bash
chmod +x skills/code-review/scripts/run-codex.sh
```

- [ ] **Step 3: Test prerequisite-check path**

```bash
skills/code-review/scripts/run-codex.sh /tmp/test-output.txt
```

Expected: exit 0 if Codex installed and branch has commits ahead of base; exit 1 if quota hit; exit 2 if prerequisites missing.

- [ ] **Step 4: Commit**

```bash
git add skills/code-review/scripts/run-codex.sh
git commit -m "feat: Add Codex CLI wrapper with hybrid base detection (Layer 1a)"
```

### Task 1.3: Write claim parser (Node, no shell calls)

**Files:**
- Create: `skills/code-review/scripts/parse-claims.cjs`
- Create: `skills/code-review/scripts/__tests__/parse-claims-fixtures.txt`

- [ ] **Step 1: Write fixture**

`skills/code-review/scripts/__tests__/parse-claims-fixtures.txt`:

```text
- [P2] Avoid marking wizard dirty on probe-only flag updates — /Users/foo/repo/client/src/lib/validation/useFileTrashedProbe.ts:81
  This hook writes flag via store action, but the action unconditionally sets
  dirty in the store. As a result, simply opening can trigger unsaved-changes UX.

- [P1] Emit destination-specific access code from shared opener — /Users/foo/repo/server/src/api-files.ts:725
  The shared helper now hard-codes one error code for access failures, but is
  also used by destination writes through getOrCreateDestinationSheet.
```

- [ ] **Step 2: Write parser (uses only `fs`, no shell calls)**

`skills/code-review/scripts/parse-claims.cjs`:

```javascript
#!/usr/bin/env node
/**
 * Parse Codex CLI output (or code-reviewer subagent output) into structured
 * claims. Output is JSON for downstream processing.
 *
 * Usage: parse-claims.cjs <input-file> [--source codex|reviewer] [--repo-root <abs-path>]
 *
 * Claim shape:
 *   {
 *     id: "claim-001",
 *     source: "codex" | "reviewer" | "both",
 *     severity: "P1" | "P2" | "P3",
 *     file: "client/src/lib/foo.ts",
 *     line: 81,
 *     summary: "one-line headline",
 *     body: "full claim text",
 *     raw: "verbatim section from input"
 *   }
 */

const fs = require('fs');
const path = require('path');

const args = process.argv.slice(2);
const inputFile = args[0];
const sourceIdx = args.indexOf('--source');
const source = sourceIdx >= 0 ? args[sourceIdx + 1] : 'codex';
const repoRootIdx = args.indexOf('--repo-root');
const repoRoot = repoRootIdx >= 0 ? args[repoRootIdx + 1] : process.cwd();

if (!inputFile) {
  console.error('Usage: parse-claims.cjs <input-file> [--source codex|reviewer] [--repo-root <abs-path>]');
  process.exit(1);
}

if (!fs.existsSync(inputFile)) {
  console.error(`Input file not found: ${inputFile}`);
  process.exit(1);
}

const text = fs.readFileSync(inputFile, 'utf8');

// Pattern: lines like "- [P2] <summary> — <abspath>:<line>" followed by
// indented body lines. Body ends at next "- [PN]" or EOF.
const CLAIM_HEADER = /^- \[(P[123])\] (.+?) — (.+?):(\d+)/;

const claims = [];
const lines = text.split('\n');
let current = null;
let bodyLines = [];

function flushClaim() {
  if (current) {
    current.body = bodyLines.join('\n').trim();
    current.raw = current.body
      ? `- [${current.severity}] ${current.summary} — ${current.file}:${current.line}\n${current.body}`
      : `- [${current.severity}] ${current.summary} — ${current.file}:${current.line}`;
    claims.push(current);
  }
  current = null;
  bodyLines = [];
}

for (const line of lines) {
  const match = CLAIM_HEADER.exec(line);
  if (match) {
    flushClaim();
    const [, severity, summary, fileAbs, lineNum] = match;
    let file = fileAbs;
    if (fileAbs.startsWith(repoRoot)) {
      file = fileAbs.slice(repoRoot.length + 1);
    }
    current = {
      id: `claim-${String(claims.length + 1).padStart(3, '0')}`,
      source,
      severity,
      file,
      line: parseInt(lineNum, 10),
      summary: summary.trim(),
    };
  } else if (current) {
    bodyLines.push(line);
  }
}
flushClaim();

console.log(JSON.stringify(claims, null, 2));

if (claims.length === 0) {
  console.error('[parse-claims] No claims found in input');
  process.exit(2);  // Distinguish "clean" from "parse error"
}

console.error(`[parse-claims] Parsed ${claims.length} claim(s) from ${source}`);
```

- [ ] **Step 3: Make executable + test**

```bash
chmod +x skills/code-review/scripts/parse-claims.cjs

node skills/code-review/scripts/parse-claims.cjs \
  skills/code-review/scripts/__tests__/parse-claims-fixtures.txt \
  --repo-root /Users/foo/repo
```

Expected: JSON array with 2 claims, severities `P2` and `P1`, files `client/src/lib/validation/useFileTrashedProbe.ts:81` and `server/src/api-files.ts:725`.

- [ ] **Step 4: Commit**

```bash
git add skills/code-review/scripts/parse-claims.cjs
git add skills/code-review/scripts/__tests__/
git commit -m "feat: Add claim parser for Codex/reviewer output"
```

### Task 1.4: Write code-reviewer subagent prompt (Layer 1b)

**Files:**
- Create: `skills/code-review/prompts/code-reviewer.md`

- [ ] **Step 1: Write the prompt**

`skills/code-review/prompts/code-reviewer.md`:

````markdown
# Layer 1 (b) — code-reviewer subagent prompt

This prompt is dispatched alongside Codex CLI as a parallel reviewer. The diff
scope must match (PR base if open, else origin/master).

## Variables (filled at dispatch time)

- `{{DIFF_BASE}}` — the git ref for the base (e.g., `origin/release/foo`)
- `{{DIFF_HEAD}}` — `HEAD` of the current branch
- `{{REPO_ROOT}}` — absolute path to the repo
- `{{BRANCH}}` — current branch name

## Prompt to dispatch

You are reviewing the diff between {{DIFF_BASE}} and {{DIFF_HEAD}} on branch
{{BRANCH}} in repo {{REPO_ROOT}}.

Run:
```
git diff {{DIFF_BASE}}..{{DIFF_HEAD}}
```

Then look at touched files in their full context (not just the diff).

## What to find

1. **Correctness issues** — bugs, race conditions, missing-error-handling at
   boundaries (I/O, async, network), invariant violations, off-by-one, etc.
2. **Sister-instances** — when you spot a pattern in one site, search for the
   same pattern across other files in the diff (and broader repo if the
   pattern is structurally identical). Report ALL sister-instances, not just
   the first one. THIS IS CRITICAL — Codex tends to be lazy and stop at 1-2
   findings; you fill that gap.
3. **Severity** — stamp every finding P1 / P2 / P3:
   - P1 — incorrect output, data loss, security issue, breaks documented invariant
   - P2 — incorrect behavior in non-fatal path, regression of fixed bug, contract violation
   - P3 — code-quality, readability, minor performance — not blocking
4. **file:line** — every finding must cite an exact file:line anchor.

## Output format

Use this exact format (one finding per block):

```
- [P2] <one-line summary> — {{REPO_ROOT}}/<relative-path>:<line>
  <body — 2-5 sentences. What's wrong, why it matters, suggested approach>
```

Severities go in square brackets at the start. The em-dash separates summary
from path. Path is absolute (the parser converts to relative).

If you find NO issues, output exactly:
```
NO_FINDINGS
```

## What NOT to find

- Style nits — these are P3 at most, and only if you've already exhausted
  correctness findings
- Speculative future-proofing — out of scope
- Test-coverage gaps without a concrete failure scenario — out of scope
- Aesthetic refactors — out of scope

Stop only when you've genuinely exhausted what you can find at this scope. A
"lazy" review (1-2 findings stopping early) is worse than no review at all
because it falsely signals all-clear on the rest of the diff.
````

- [ ] **Step 2: Commit**

```bash
git add skills/code-review/prompts/code-reviewer.md
git commit -m "feat: Add code-reviewer subagent prompt for Layer 1b"
```

### Task 1.5: Write security fast-path detector (file-name only — minimal)

**Files:**
- Create: `skills/code-review/scripts/detect-security-relevant.sh`
- Create: `skills/code-review/project-setup/security-patterns.example.txt`

The detector starts simple: file-name pattern matching only. The implementer can extend with content-pattern detection in a follow-up if needed. This avoids the literal-string scanning that would otherwise complicate the script.

- [ ] **Step 1: Write the example patterns file**

`skills/code-review/project-setup/security-patterns.example.txt`:

```text
# File-path patterns that indicate security-relevant changes.
# One pattern per line. Lines starting with # are comments.
# Patterns are matched case-insensitively against changed-file paths.

auth
crypto
token
permission
session
jwt
sso
oauth
```

- [ ] **Step 2: Write the detector (bash, no shell-string interpolation)**

`skills/code-review/scripts/detect-security-relevant.sh`:

```bash
#!/bin/bash
# Detect security-relevant diff via file-name pattern match.
#
# Usage: detect-security-relevant.sh <diff-base> <diff-head> [<patterns-file>]
#
# Outputs JSON: { "hasSecurityRelevance": bool, "matches": [...] }
# Exit 0 always (informational, not gating).

set -euo pipefail

DIFF_BASE="${1:-}"
DIFF_HEAD="${2:-HEAD}"
PATTERNS_FILE="${3:-$(dirname "$0")/../project-setup/security-patterns.example.txt}"

if [ -z "$DIFF_BASE" ]; then
  echo "Usage: detect-security-relevant.sh <diff-base> <diff-head> [<patterns-file>]" >&2
  exit 1
fi

if [ ! -f "$PATTERNS_FILE" ]; then
  echo '{"hasSecurityRelevance": false, "matches": [], "warning": "patterns file not found"}'
  exit 0
fi

# Get changed files
CHANGED=$(git diff --name-only "$DIFF_BASE..$DIFF_HEAD")

# Build matches as JSON array
echo -n '{"hasSecurityRelevance": '
HAS_MATCH="false"
MATCHES=""
while IFS= read -r pattern; do
  [ -z "$pattern" ] && continue
  case "$pattern" in '#'*) continue ;; esac
  while IFS= read -r file; do
    [ -z "$file" ] && continue
    LOWER_FILE=$(echo "$file" | tr '[:upper:]' '[:lower:]')
    LOWER_PATTERN=$(echo "$pattern" | tr '[:upper:]' '[:lower:]')
    if [[ "$LOWER_FILE" == *"$LOWER_PATTERN"* ]]; then
      HAS_MATCH="true"
      [ -n "$MATCHES" ] && MATCHES="$MATCHES,"
      MATCHES="$MATCHES{\"file\":\"$file\",\"pattern\":\"$pattern\"}"
    fi
  done <<< "$CHANGED"
done < "$PATTERNS_FILE"

echo "$HAS_MATCH, \"matches\": [$MATCHES]}"
```

- [ ] **Step 3: Make executable + test**

```bash
chmod +x skills/code-review/scripts/detect-security-relevant.sh

# Test with a real repo + non-empty patterns
cd /tmp/test-repo
~/Development/Sheetgo/agent-skills/skills/code-review/scripts/detect-security-relevant.sh \
  origin/master HEAD
```

Expected: JSON with `hasSecurityRelevance: true` if any changed file path matches a pattern (e.g., contains "auth"); `false` otherwise.

- [ ] **Step 4: Commit**

```bash
git add skills/code-review/scripts/detect-security-relevant.sh
git add skills/code-review/project-setup/security-patterns.example.txt
git commit -m "feat: Add security fast-path detector (file-name pattern match)"
```

### Task 1.6: Write SKILL.md body (Layer 1 scope only)

**Files:**
- Modify: `skills/code-review/SKILL.md`

- [ ] **Step 1: Read baseline rationalizations**

```bash
cat skills/code-review/baseline-tests/rationalization-patterns.md
```

Every theme listed there must have a row in the SKILL.md "Red flags" table.

- [ ] **Step 2: Write SKILL.md body**

Replace the placeholder content in `skills/code-review/SKILL.md`. Add this content after the frontmatter block:

```markdown
# code-review skill

## Overview

A 4-layer pre-merge verification pipeline. Replaces the push-and-wait-for-
GitHub-Codex feedback loop with local validation that surfaces real issues
before they cost a review cycle. Each layer either confirms the path is clean
or feeds the next layer with verified claims.

**Core principle:** AI reviewer findings are CLAIMS to be verified, not
verdicts to be implemented. Codex is short-sighted, can be lazy, and misses
business-rule context. Verify before acting.

## When to use

- Before `git push` on a branch with substantive changes (not docs-only)
- Before `gh pr create` or significant `gh pr edit` updates
- Before merging a PR (especially release branches → master)
- Before `npm run release:prod` (or equivalent release-cut command)
- When a chunk of work feels finished and the user is about to ask "push?"
- When GitHub Codex has flagged findings on a recent push and you need to
  decide ship-or-fix-first

## When NOT to use

- During mid-implementation iterations (use after the work is finished)
- For docs-only changes (use a marker file or commit-message convention to skip)
- For experimental WIP branches with no intent to merge
- During an active fix-cycle where you're already responding to specific Codex
  findings (use `/fix-issues` instead)

## Layer 1 — Parallel claim-finding

Two reviewers run in parallel against the same diff scope.

### (a) Codex CLI

Run:
```bash
~/.claude/skills/code-review/scripts/run-codex.sh /tmp/codex-out.txt
```
The wrapper auto-detects the diff base (PR base if open, else `origin/master`).

### (b) `superpowers:code-reviewer` subagent

Dispatch via Agent tool with the prompt at
`~/.claude/skills/code-review/prompts/code-reviewer.md`. Same diff scope.

**Run BOTH in parallel** (single message with two Agent tool calls).

### Aggregation

Parse outputs:
```bash
node ~/.claude/skills/code-review/scripts/parse-claims.cjs /tmp/codex-out.txt --source codex > /tmp/claims-codex.json
node ~/.claude/skills/code-review/scripts/parse-claims.cjs /tmp/reviewer-out.txt --source reviewer > /tmp/claims-reviewer.json
```

Deduplicate by `file:line`. Tag each claim with attribution: `codex` / `reviewer` / `both`.

### Security fast-path advisory

Run:
```bash
~/.claude/skills/code-review/scripts/detect-security-relevant.sh <base> HEAD
```

If `hasSecurityRelevance: true`, surface advisory: "Security-relevant diff
detected. Consider running /security-review in parallel before final verdict."

### Failure modes

- **Codex unavailable** (run-codex.sh exits 1 quota-hit): continue with
  reviewer-only. Tag claims as `codex-skipped`.
- **Both unavailable**: exit early with verdict `MANUAL REVIEW NEEDED`:
  "Layer 1 unavailable, manual review required before push."
- **One returns claims, the other returns clean**: still proceed (single-signal
  OK; lacks cross-validation).

### Exit short-circuit: BOTH CLEAN

If both reviewers return zero claims:
- Output: **PUSH READY** with one-line summary.
- Skip Layers 2-4. No subagents dispatched.
- Write marker `.git/code-review-passed-<sha>` for the hook to consume.
- Done.

## If claims found

[PHASE 2 fills this in. For now, list claims and stop with "Layer 2-4 not yet implemented."]

## Red flags — STOP, do not push if you catch yourself thinking these

| Rationalization | Reality |
|---|---|
| "GitHub Codex will catch anything we miss" | Codex is lazy (1-2 findings per pass). Each push = a new review cycle = 5-10 min round trip. Run code-review locally before push to catch what GitHub Codex would catch, faster. |
| "Tests pass, that's enough" | Tests verify code-correctness; review verifies design/business-rule correctness + sister-instances + severity. They overlap but don't substitute. |
| "Code review is what GitHub does" | GitHub Codex review is reactive (after push). code-review is proactive (before push). The point is to NOT spend a Codex cycle if local tools can find it. |
| "We can fix issues in follow-up PRs" | Each follow-up PR = another Codex round = compounding cycle time. The omnibus-and-defer playbook this skill produces is faster. |
| "User said ship by 6pm, just ship" | Time pressure does NOT exempt verification. The skill produces a structured-defer playbook for genuine out-of-family findings, so "ship anyway" is fast and correct, not skip-the-review. |
| "The comment says it's intentional" | Verify the comment claim. Run `git blame` on the comment to see when added. Read the asymmetry logic yourself. Don't trust comments at face value — they go stale. |
| "Codex only flagged this one site, just fix this one" | Codex is short-sighted. The skill's Layer 3 Subagent C explicitly hunts sister-instances. Fix-the-family, not fix-the-site. |

[Add more rows from baseline-tests/rationalization-patterns.md if any new themes surfaced]

## Common mistakes (Layer 1 scope)

- **Running Codex with `--uncommitted` instead of `--base`** — only sees
  working-tree diff, misses prior commits. Use the wrapper script.
- **Dispatching reviewer-subagent with a wrong scope** — must match Codex's
  scope. Both review the same diff or the cross-check is meaningless.
- **Acting on first reviewer's findings before the second returns** — wait for
  both to finish, deduplicate, then proceed.

[Phases 2-4 will append: Self-check protocol, Subagent panel, Live test, Verdict aggregation, Drafts]

## Cross-references

**REQUIRED SUB-SKILL:** Use superpowers:requesting-code-review for Layer 1 (b) dispatch — the code-reviewer subagent.

**RELATED:**
- After this skill recommends FIX FIRST, use `fix-issues` to address surviving claims.
- For new feature design (not bug verification), use `plan-hardening` + `writing-plans` instead — this skill is pre-merge gate, not pre-design gate.
- Adjacent to `implementation-audit` (validates implementation against a plan); this skill validates findings against actual behavior.
- For security-specific deep review, compose with `/security-review` when the security fast-path advisory fires.
```

- [ ] **Step 3: Verify SKILL.md word count**

```bash
wc -w skills/code-review/SKILL.md
```

Expected: <500 words for the body excluding code blocks. Trim if over.

- [ ] **Step 4: Run scenarios 01 + 03 WITH skill loaded (GREEN check)**

Symlink the skill so a fresh session loads it:
```bash
ln -s ~/Development/Sheetgo/agent-skills/skills/code-review ~/.claude/skills/code-review
```

Open a fresh Claude Code session in `as-add-on`. Paste scenario 01 prompt verbatim. Verify the agent now invokes `/code-review` (or proposes to) before recommending push. Capture to `baseline-tests/results/scenario-01-with-skill.md`.

Same for scenario 03.

- [ ] **Step 5: Commit Phase 1 complete**

```bash
git add skills/code-review/SKILL.md
git add skills/code-review/baseline-tests/results/scenario-{01,03}-with-skill.md
git commit -m "feat: Phase 1 complete — Layer 1 parallel review with exit-on-clean"
```

---

## Phase 2 — Layers 2 + 3

**Goal:** Add main-thread self-check (Layer 2) and 3-subagent panel (Layer 3) to handle the case where Layer 1 produced claims. After this phase, scenarios 02 + 05 should pass GREEN.

### Task 2.1: Write Subagent A prompt (Accuracy & business-rule)

**Files:**
- Create: `skills/code-review/prompts/subagent-a-accuracy.md`

- [ ] **Step 1: Write the prompt**

`skills/code-review/prompts/subagent-a-accuracy.md`:

````markdown
# Layer 3 Subagent A — Accuracy & business-rule check

## Variables (filled at dispatch time)

- `{{CLAIM_ID}}` — claim identifier
- `{{CLAIM_FILE}}` — file path (relative to repo)
- `{{CLAIM_LINE}}` — line number
- `{{CLAIM_BODY}}` — full claim text from Layer 1
- `{{LAYER_2_NOTES}}` — main-thread self-check findings (CONFIRMED / UNCERTAIN)
- `{{REPO_ROOT}}` — absolute path to repo

## Prompt to dispatch

You are checking a code-review claim for accuracy and business-rule context.

**Claim:**
```
{{CLAIM_BODY}}
```

**Cited location:** {{REPO_ROOT}}/{{CLAIM_FILE}}:{{CLAIM_LINE}}

**Layer 2 (self-check) notes:** {{LAYER_2_NOTES}}

## Your job

Determine if the claim represents a REAL bug, INTENTIONAL design, or a NOT_REPRODUCIBLE
hallucination. Be rigorous — Codex stamps confidence it doesn't always have.

### Steps

1. Read {{CLAIM_FILE}} in full (not just around line {{CLAIM_LINE}}). Get full
   context: imports, class structure, surrounding logic.
2. Run `git log -p {{CLAIM_FILE}}` and look at when the cited code was last
   modified. If recent (this PR's commits), it's a NEW potential bug. If old,
   it's pre-existing.
3. Run `git blame {{CLAIM_FILE}}` and inspect the line. Read the responsible commit's full message.
4. Search the repo for documented context:
   - `grep -rn "{{CLAIM_FILE}}" CLAUDE.md docs/ --include="*.md"` — any docs reference this code's design?
   - `grep -B 5 -A 5 "<key terms from claim>" docs/deferred-items.md` — already deferred?
   - Look for inline comments above the cited line explaining the pattern.
5. Verify the failure mode is reproducible:
   - Read the claim's stated trigger condition. Does the code path actually reach that condition? Trace it.
   - If the failure requires specific runtime state, can it actually occur? (e.g., "race between X and Y" — can X and Y actually be concurrent?)
6. Check for documented business-rule asymmetries (e.g., the SAVE_ONLY-flag pattern in stripFrontendFlags — load preserves while save strips).

### Output format

Use this exact format:

```
VERDICT: REAL_BUG | INTENTIONAL | NOT_REPRODUCIBLE

REASONING:
<2-4 sentences>

EVIDENCE:
- File path + line + key code excerpt
- Git blame: commit <SHA> by <author> on <date>: "<commit subject>"
- Documentation references found (or "none")
- Reproduction check: <reachable | unreachable | uncertain>

CITATIONS:
- {{CLAIM_FILE}}:<line range>
- <other files referenced>
- <documents grepped>
```

If VERDICT is INTENTIONAL, the EVIDENCE must include a quoted comment block,
docstring, or doc-reference that establishes the design intent. Do not stamp
INTENTIONAL based on inference; stamp it on documented intent.

If VERDICT is REAL_BUG, the EVIDENCE must include a reachable code path
demonstrating the failure mode.

If VERDICT is NOT_REPRODUCIBLE, the EVIDENCE must explain why the trigger
condition can't actually occur in the code path described.
````

- [ ] **Step 2: Commit**

```bash
git add skills/code-review/prompts/subagent-a-accuracy.md
git commit -m "feat: Add Layer 3 Subagent A prompt (accuracy + business-rule)"
```

### Task 2.2: Write Subagent B prompt (Severity & impact)

**Files:**
- Create: `skills/code-review/prompts/subagent-b-severity.md`

- [ ] **Step 1: Write the prompt**

`skills/code-review/prompts/subagent-b-severity.md`:

````markdown
# Layer 3 Subagent B — Severity & impact

## Variables

- `{{CLAIM_ID}}`, `{{CLAIM_FILE}}`, `{{CLAIM_LINE}}`, `{{CLAIM_BODY}}`,
  `{{LAYER_2_NOTES}}`, `{{REPO_ROOT}}`
- `{{CODEX_STAMPED_SEVERITY}}` — severity tag from the original reviewer (P1/P2/P3)
- `{{DIFF_BASE}}` — git ref for the diff base

## Prompt

You are independently assessing severity and impact for a code-review claim.

**IMPORTANT:** Do NOT look at `{{CODEX_STAMPED_SEVERITY}}` until AFTER you've
formed your own independent assessment. Bias is real.

**Claim:**
```
{{CLAIM_BODY}}
```

**Cited location:** {{REPO_ROOT}}/{{CLAIM_FILE}}:{{CLAIM_LINE}}

## Steps

### Step 1 (independent — do NOT peek at stamped severity)

Read the claim and the code. Ask:
- What's the failure mode? (silent corruption / visible error / data loss / UX glitch)
- How often does the affected code path execute? (once per session / per page load /
  per user gesture / per minute / always)
- How many users could hit it? (everyone / specific role / specific config / edge case)
- What's the recovery cost? (auto-recovers / requires reload / requires re-auth /
  requires support contact / requires data restore)

Stamp severity:
- **P1** — incorrect output, data loss, security issue, breaks documented invariant,
  blocks core flow for >10% of users
- **P2** — incorrect behavior in non-fatal path, regression of fixed bug,
  contract violation, blocks edge-case flow
- **P3** — code quality, readability, minor performance, no user-visible impact

### Step 2 (compare with stamp)

Now look at `{{CODEX_STAMPED_SEVERITY}}`. Does it match yours?

- **Match:** confirm.
- **Disagreement:** explain. Codex tends to overstate (P1 for what's actually P2)
  on speculative failure modes; tends to understate (P3 for what's actually P2)
  on subtle business-rule violations.

### Step 3 (timing/age)

Run:
```bash
git log {{DIFF_BASE}}..HEAD -- {{CLAIM_FILE}}
```

Was the cited code introduced in this PR's commits, or pre-existing on master?

- **Introduced this PR:** finding is in-scope; severity stands.
- **Pre-existing on master:** finding may be out-of-family; consider DEFER.
  Cite when last modified (`git log -1 --format='%ci %s' -- {{CLAIM_FILE}}`).

### Output format

```
INDEPENDENT_SEVERITY: P1 | P2 | P3
STAMPED_SEVERITY: {{CODEX_STAMPED_SEVERITY}}
AGREEMENT: match | overstated_by_stamp | understated_by_stamp

IMPACT:
- Failure mode: <brief>
- Frequency: <brief>
- User scope: <brief>
- Recovery cost: <brief>
- Net user impact: low | medium | high | severe

AGE:
- Introduced in PR commits: yes | no
- Last modified: <commit SHA + subject + date>
- Out-of-family from current PR scope: yes | no | unclear

REASONING:
<2-4 sentences justifying severity and impact assessment>
```
````

- [ ] **Step 2: Commit**

```bash
git add skills/code-review/prompts/subagent-b-severity.md
git commit -m "feat: Add Layer 3 Subagent B prompt (severity + impact + age)"
```

### Task 2.3: Write Subagent C prompt (Sister-instances)

**Files:**
- Create: `skills/code-review/prompts/subagent-c-sisters.md`

- [ ] **Step 1: Write the prompt**

`skills/code-review/prompts/subagent-c-sisters.md`:

````markdown
# Layer 3 Subagent C — Sister-instances & related issues

## Variables

- `{{CLAIM_ID}}`, `{{CLAIM_FILE}}`, `{{CLAIM_LINE}}`, `{{CLAIM_BODY}}`,
  `{{LAYER_2_NOTES}}`, `{{REPO_ROOT}}`
- `{{NEGATIVE_LIST}}` — already-fixed or already-deferred sister-instances (so we don't re-flag them)

## Prompt

You are hunting for structurally similar issues to a code-review claim. Your
job is to find the FAMILY of issues, not just the cited site.

**Claim:**
```
{{CLAIM_BODY}}
```

**Cited site:** {{REPO_ROOT}}/{{CLAIM_FILE}}:{{CLAIM_LINE}}

**Already addressed (do NOT re-flag):**
{{NEGATIVE_LIST}}

## Your job

If the claim is "X happens when Y", find every place where Y could happen
across the codebase and check if X happens there too.

### Steps

1. Identify the abstract pattern from the cited site:
   - What's the operation? (function call / pattern of useEffect / store action
     dispatch / API endpoint / etc.)
   - What's the bad consequence? (state mutation / missing error handling /
     unconditional side effect / etc.)
   - What's the trigger? (user gesture / system observation / async resolution /
     mount / unmount / etc.)

2. Search broadly:
   - Find every caller of the affected function/action via `grep -rn`
   - Find every site with the same useEffect dependency shape
   - Find structurally similar useEffects across the source tree

3. For each sister-site found:
   - Cite `file:line`
   - Quote the relevant 5-10 lines
   - State whether it has the bad consequence (yes / no / partial / uncertain)
   - State if it's a CLEAN_SPLIT (same pattern, fix identically) or MIXED
     (touches user-editable fields, needs nuanced handling)

4. Cross-check {{NEGATIVE_LIST}}:
   - If a candidate is in the negative list, skip it (already addressed).
   - If a candidate is NOT in the negative list and shows the bad pattern,
     report it.

### Output format

```
SISTERS_FOUND: <count>

[For each sister-site:]

### Sister 1 — {{REPO_ROOT}}/<file>:<line>

PATTERN_MATCH: full | partial | uncertain
SPLIT_TYPE: clean_split | mixed | uncertain
CODE_EXCERPT:
```
<5-10 lines>
```
ASSESSMENT: <2-3 sentences on whether it's affected by the same bad consequence>

### Sister 2 — ...

(continue for all sisters)

---

NEGATIVE_LIST_COVERAGE:
- <each negative-list site checked + confirmed not re-flagged>

RECOMMENDED_OMNIBUS:
- IF clean_split sisters > 0: bundle all clean_splits with the original claim
  into one omnibus fix
- IF mixed sisters: flag for separate scope decision
- IF no sisters: original claim stands alone
```

If you find ZERO sisters, output `SISTERS_FOUND: 0` and explain what you
searched for + why nothing matched.
````

- [ ] **Step 2: Commit**

```bash
git add skills/code-review/prompts/subagent-c-sisters.md
git commit -m "feat: Add Layer 3 Subagent C prompt (sister-instances + family hunt)"
```

### Task 2.4: Append Layers 2 + 3 to SKILL.md

**Files:**
- Modify: `skills/code-review/SKILL.md`

- [ ] **Step 1: Replace the "If claims found" section**

In `SKILL.md`, replace `[PHASE 2 fills this in...]` with:

````markdown
## If claims found

Layer 1 produced one or more claims. Continue with Layers 2-4.

## Layer 2 — Self-check (main thread)

For EACH claim, do this in the main thread BEFORE dispatching subagents:

### Verification steps per claim

1. **Read the cited code** — open `<file>:<line>` mentioned in the claim. Does
   the code actually look like what the claim describes?
2. **Reproduce mentally** — trace data flow / control flow. Does the issue
   exist as described, or hallucinated?
3. **Session-recency check** — `git blame <file>` on the line. Was this
   introduced in current branch's commits, or pre-existing on master?
4. **Quick business-rule scan** — `grep` for related comments, CLAUDE.md
   notes, `docs/deferred-items.md` entries. Is the "issue" actually documented
   as deliberate?

### Triage verdict per claim

- **CONFIRMED** — verified, proceed to Layer 3
- **FALSE-POSITIVE** — hallucinated or refers to non-existent code. Drop. No
  subagents.
- **INTENTIONAL** — real behavior, but documented as deliberate (with cite).
  Drop with citation.
- **UNCERTAIN** — can't tell from main-thread reading. Forward to Layer 3 with
  uncertainty flagged.

## Layer 3 — Subagent panel (3 perspectives, parallel)

For each CONFIRMED + UNCERTAIN claim, dispatch 3 subagents IN PARALLEL (single
message, three Agent tool calls). Each gets:
- The full claim body
- The Layer 2 notes
- The prompt template from `~/.claude/skills/code-review/prompts/`

### Subagent A — Accuracy & business-rule

Prompt: `prompts/subagent-a-accuracy.md`. Outputs: `REAL_BUG | INTENTIONAL | NOT_REPRODUCIBLE`.

### Subagent B — Severity & impact

Prompt: `prompts/subagent-b-severity.md`. Outputs: independent severity +
agreement with stamped severity + age + out-of-family flag.

### Subagent C — Sister-instances

Prompt: `prompts/subagent-c-sisters.md`. Outputs: list of structurally similar
issues elsewhere. Includes negative-list of already-addressed sites.

### Panel reconciliation (main thread, mechanical)

- All three CONFIRM real → claim survives to Layer 4.
- Subagent A says NOT_REPRODUCIBLE / INTENTIONAL → drop with citation, attach panel report.
- Subagent C found sister-instances → add them to the surviving claim list (so the omnibus covers the family, not just the cited site).
- Subagent B disagrees on severity → record both, take the higher one for downstream gating.
- Subagent B says out-of-family + age=pre-existing → mark claim for DEFER + DOCUMENT verdict track.

[PHASE 3 fills in: Layer 4 + verdict aggregation + drafts]
````

- [ ] **Step 2: Run scenarios 02 + 05 WITH skill loaded (GREEN check)**

Fresh Claude Code session (skill symlinked from Phase 1). Paste scenario 02
prompt verbatim. Verify the agent dispatches Subagent C for sister-instances
before recommending push. Capture to `baseline-tests/results/scenario-02-with-skill.md`.

Same for scenario 05 (verifying "intentional" claims via Subagent A).

- [ ] **Step 3: Commit Phase 2 complete**

```bash
git add skills/code-review/SKILL.md
git add skills/code-review/baseline-tests/results/scenario-{02,05}-with-skill.md
git commit -m "feat: Phase 2 complete — Layer 2 self-check + Layer 3 subagent panel"
```

---

## Phase 3 — Layer 4 + Verdict Aggregation + Outputs

**Goal:** Add Layer 4 live-test dispatcher, verdict aggregation, structured outputs (claim list for fix-issues hand-off), and PR-conditional draft artifacts. After this phase, scenario 04 (time pressure) should pass GREEN.

### Task 3.1: Append Layer 4 + verdict aggregation to SKILL.md

**Files:**
- Modify: `skills/code-review/SKILL.md`

- [ ] **Step 1: Replace `[PHASE 3 fills in...]` placeholder**

````markdown
## Layer 4 — Live test

For each claim that survived Layer 3, dispatch a live test that proves the
issue exists (or doesn't) in actual runtime, not just in code reading.

### Test selection by claim type

| Claim type | Test method | Notes |
|---|---|---|
| Frontend / UI / wizard flow | Playwright E2E | Use project's mock infrastructure (`window.__mockConfig` or equivalent). One scenario per claim. |
| Backend / Apps Script | `clasp run <function>` against DEV with simulated trigger | Or smoke harness in `dist/` after `npm run build` |
| State management (Zustand / Redux / Pinia) | Component test mounting affected component with trigger state | Faster than Playwright when bug is fully reproducible at component-level |
| Pure logic / utilities | Unit test isolating function with trigger inputs | |
| Type-only / docs / deferred | **Skip Layer 4.** Document why (e.g., "type-only change, tsc covers it") | |

### Verdict per claim

- **REPRODUCED** — live test demonstrates the bug. Real, must address before push (or explicitly defer with rationale).
- **NOT_REPRODUCIBLE** — live test fails to surface the bug. Either the claim is wrong, or the test doesn't cover the trigger condition. Record both possibilities. Main thread decides defer or investigate further.
- **OUT_OF_SCOPE** — test method genuinely can't run (needs production data, external service mocking we don't have). Document and treat as needing manual review.

## Aggregate verdict

After all surviving claims have a Layer 4 verdict, the skill produces ONE
recommendation:

| Recommendation | Trigger condition |
|---|---|
| **PUSH READY** | All claims dropped at L1/L2/L3, OR all surviving claims hit NOT_REPRODUCIBLE / OUT_OF_SCOPE / INTENTIONAL |
| **FIX FIRST** | At least one claim REPRODUCED with severity ≥ P2 |
| **DEFER + DOCUMENT** | Claim REPRODUCED but explicitly out-of-family (Subagent B flagged out_of_family + age=pre-existing). Drafts deferred-items entry (+ thread reply + commit message if PR-wired). |
| **MANUAL REVIEW NEEDED** | Layer 1 incomplete (BOTH reviewers unavailable) OR many OUT_OF_SCOPE claims |

### FIX FIRST — fix-issues hand-off

When verdict is FIX FIRST:

1. Write surviving claim list to `docs/code-review-runs/<timestamp>-<branch>.md`
   with this structure (matches fix-issues issue-registry input shape):

```markdown
# code-review run: <branch> @ <commit-sha>
Date: YYYY-MM-DD HH:MM
Verdict: FIX FIRST

## Claims requiring fix

### FIX-001
**File:** path/to/file.ts:123
**Severity:** P2 (independent assessment) / P2 (Codex stamped)
**Source:** found by codex + reviewer (cross-validated)
**Body:** <claim body>
**Layer 3 panel:**
- Accuracy: REAL_BUG (with citations)
- Severity & impact: <summary>
- Sister-instances: <count>; clean_splits at: <file:line list>
**Layer 4 verdict:** REPRODUCED via Playwright E2E `client/e2e/<scenario>.spec.cjs`
**Suggested approach:** <1-3 sentences>

### FIX-002
...
```

2. In the console summary, surface a one-line invocation:
   ```
   FIX FIRST verdict — N claims to address.
   Run: /fix-issues with claim list at docs/code-review-runs/<file>.md
   ```

3. Do NOT auto-invoke `/fix-issues`. The user retains the choice between
   fix-now, fix-in-follow-up-PR, rollback, or escalate.

### DEFER + DOCUMENT — draft-not-decide artifacts

When verdict is DEFER + DOCUMENT, the skill drafts artifacts the human posts.

**Detect PR context:**
```bash
gh pr view <branch> --json baseRefName,number 2>/dev/null
```

If a PR is open AND there's an unresolved Codex thread on the affected
file:line, query for the thread:
```bash
gh api graphql -f query='{ repository(owner: "X", name: "Y") { pullRequest(number: N) { reviewThreads(first: 50) { nodes { id isResolved comments(first: 1) { nodes { path line body } } } } } } }' \
  --jq '.data.repository.pullRequest.reviewThreads.nodes[] | select(.isResolved==false and .comments.nodes[0].path=="<claim file>" and .comments.nodes[0].line==<claim line>)'
```

**Drafts produced** (location: `docs/code-review-runs/<run>/drafts/`):

| Always | Conditional on PR + thread |
|---|---|
| `deferred-items-entry.md` | `codex-reply.md` |
| | `deferral-commit-message.md` |

**`deferred-items-entry.md` template** (uses the format from
`docs/deferred-items.md` of the consuming project):

```markdown
### <CLAIM_SUMMARY>

**Priority:** <SEVERITY> (per Codex)
**Parked:** <YYYY-MM-DD>
**Context:** <CLAIM_BODY paraphrased to 2-3 sentences>

**Why deferred:** <Subagent B's out-of-family rationale>

**Scope notes:**
- <from Subagent A's accuracy report>
- <from Subagent C's sister-instances if any>

**Acceptance criteria when revisited:**
- <derived from claim>

**Cross-reference:** Codex thread `<thread-id>` on PR #<N>.

**Decision:** Deferred — <rationale>
```

**`codex-reply.md` template** (1-3 sentences with commit SHA placeholder):

```markdown
Acknowledged and deferred to next release per `<COMMIT_SHA>` (deferred-items entry).
<Subagent B's out-of-family rationale, 1 sentence>. Will be addressed in <next release / fresh-session audit>.
```

**`deferral-commit-message.md` template:**

```
docs: Defer Codex <SEVERITY> (<CLAIM_FILE>:<LINE> <one-line>)

Codex flagged on PR #<N> review of <REVIEW_COMMIT>. Out-of-family from this
PR's scope — <rationale from Subagent B>.

Deferred per user direction:
- <bullet from Subagent C if relevant>
- Will be bundled with next release / planned audit

Codex thread: <thread-id>
```

The skill **never**:
- Decides to defer (the user approves the verdict)
- Auto-commits the deferred-items entry (the user stages and commits)
- Auto-posts on GitHub (the user posts, resolves threads, minimizes reviews)

The console output includes the apply-to-disk commands:
```
DEFER + DOCUMENT verdict — N claims deferred. Drafts ready at:
  docs/code-review-runs/<run>/drafts/

To apply:
  cat docs/code-review-runs/<run>/drafts/deferred-items-entry.md >> docs/deferred-items.md
  git add docs/deferred-items.md
  git commit -F docs/code-review-runs/<run>/drafts/deferral-commit-message.md
  # then post the codex-reply.md text on the PR thread + resolve + minimize
```
````

- [ ] **Step 2: Run scenario 04 (time pressure) WITH skill loaded**

Fresh session, skill symlinked. Paste scenario 04 prompt verbatim. Verify the agent:
- Doesn't yield to time pressure
- Suggests the structured-defer playbook
- Surfaces the time-saving: "drafts auto-produced; review and post takes 5 min"

Capture to `baseline-tests/results/scenario-04-with-skill.md`.

- [ ] **Step 3: REFACTOR pass — close any new rationalizations observed**

If scenario 04 surfaces NEW rationalizations not addressed in SKILL.md's
red-flags table, append them. Re-run scenario until GREEN.

- [ ] **Step 4: Commit Phase 3 complete**

```bash
git add skills/code-review/SKILL.md
git add skills/code-review/baseline-tests/results/scenario-04-with-skill.md
git commit -m "feat: Phase 3 complete — Layer 4 + verdicts + draft-not-decide outputs"
```

### Task 3.2: Write canonical worked example

**Files:**
- Create: `skills/code-review/examples/full-flow.md`

- [ ] **Step 1: Write the example**

Walk a real claim through all 4 layers. Use the v2.6.19d `useFileTrashedProbe.ts:81` finding from the 2026-05-07 session as the canonical reference. Include:
- Layer 1 raw output excerpts (Codex + reviewer)
- Layer 2 main-thread triage decisions
- Layer 3 panel output (3 subagents' reports)
- Layer 4 live-test approach (component test for the dirty-flag behavior)
- Aggregate verdict (PUSH READY after fix; or DEFER+DOCUMENT for the out-of-family `api-files.ts:725` finding)

Source ground-truth artifacts: this session's commits in the `as-add-on` repo (e552d53, 694c695, e11c1a7) plus the deferred-items entries written today.

- [ ] **Step 2: Commit**

```bash
git add skills/code-review/examples/full-flow.md
git commit -m "docs: Add canonical worked example for code-review skill"
```

---

## MVP Boundary

**Phases 0–3 = MVP.** Skill is invocable via `/code-review`, runs all 4 layers, produces verdicts and drafts. After MVP runs cleanly on at least 5 baseline scenarios, plan Phase 4 (hook safety net) and Phase 5 (per-project install + first adoption) in a follow-up plan.

**At MVP, you can:**
- Stop and use the skill manually via `/code-review` slash command
- Open a follow-up plan for Phase 4 (PreToolUse hook on `git push`)
- Open a follow-up plan for Phase 5 (per-project install + Sheetgo Automations adoption)

The MVP intentionally requires manual invocation — the hook is convenience, not core function.

---

## Self-review checklist

After completing the plan, run these checks against the design doc
(`docs/plans/2026-05-07-code-review-design.md`):

**Spec coverage:**
- [ ] Layer 1 (parallel Codex + reviewer) — Phase 1 (Tasks 1.2–1.6)
- [ ] Layer 2 (self-check) — Phase 2 (Task 2.4)
- [ ] Layer 3 (3-subagent panel) — Phase 2 (Tasks 2.1–2.3 + 2.4)
- [ ] Layer 4 (live test) — Phase 3 (Task 3.1)
- [ ] 4 verdicts (PUSH READY / FIX FIRST / DEFER+DOCUMENT / MANUAL REVIEW NEEDED) — Phase 3 (Task 3.1)
- [ ] fix-issues hand-off — Phase 3 (Task 3.1)
- [ ] Draft-not-decide artifacts (PR-conditional) — Phase 3 (Task 3.1)
- [ ] Security composition fast-path — Phase 1 (Task 1.5)
- [ ] CI integration NOT in scope — confirmed by absence
- [ ] RED-phase baseline testing — Phase 0
- [ ] Cross-references (REQUIRED SUB-SKILL syntax) — SKILL.md cross-refs
- [ ] Hook + per-project install — deferred to Phase 4 follow-up plan (per MVP boundary decision)

**Type/path consistency:**
- [ ] All `~/.claude/skills/code-review/...` paths consistent across SKILL.md, scripts
- [ ] `parse-claims.cjs` output JSON shape matches the claim list consumed by Phase 3 hand-off writer
- [ ] Subagent prompt variable names (`{{CLAIM_FILE}}`, etc.) match across A/B/C prompts and the SKILL.md dispatch-step description

**Placeholder scan:**
- [ ] No "TBD", "TODO", "fill in later" markers in any SKILL.md or prompt
- [ ] No "similar to Task N" without the actual code
- [ ] Every step that changes code shows the code

If any gap found, fix inline.

---

## Plan complete

Saved to: `docs/plans/2026-05-07-code-review-implementation.md`

**Two execution options:**

1. **Subagent-Driven (recommended)** — REQUIRED SUB-SKILL: superpowers:subagent-driven-development. Fresh subagent per task + two-stage review (spec compliance + code quality). Best for skill-authoring discipline since each task lands cleanly.

2. **Inline Execution** — REQUIRED SUB-SKILL: superpowers:executing-plans. Batch execution in this session with checkpoints for review. Faster but harder to recover from a wrong turn.

Both honor the TDD methodology required by writing-skills (run baseline scenarios → write minimal skill → re-run scenarios for GREEN → REFACTOR).
