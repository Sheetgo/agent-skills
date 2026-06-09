---
name: implementation-audit
description: "Dispatch parallel reviewers to validate implementation against the plan. Use for post-implementation verification in a fresh session."
---

# Implementation Audit

## Overview

This skill validates that an implementation matches its plan. It dispatches parallel review agents to examine different dimensions of the code, then consolidates findings into an audit report.

## When to Use

- Starting a fresh session and want to verify previous work
- Before creating a PR, to catch drift and gaps
- After multiple implementation sessions, to check cumulative alignment
- When confidence in the implementation is low

## Flow

### Step 1: Identify the Plan

1. Get the current branch:
   ```bash
   BRANCH=$(git branch --show-current)
   ```

2. Search `docs/plans/*.md` for files matching the branch name or ticket ID

3. If multiple matches, ask using AskUserQuestion:
   ```
   Which plan should I audit against?
     ○ {file 1}
     ○ {file 2}
     ○ {file 3}
   ```

4. If no plan file found:
   ```
   No plan file found for this branch.
     ○ Specify a plan file path — I'll provide the path
     ○ Audit without plan — General code quality review only
     ○ Cancel
   ```

5. Read the plan file and extract all tasks/deliverables

### Step 2: Dispatch Parallel Reviewers

Launch 5 review agents in parallel using the Agent tool. Each agent gets:
- The plan file content (or relevant section)
- The list of changed files on the branch
- Their specific review dimension

**Agent 1: Completeness Reviewer**
```
Review the implementation for COMPLETENESS against the plan.

Plan file: {path}
Branch: {branch}
Changed files: {file list}

For each task/deliverable in the plan:
1. Check if corresponding code exists
2. Verify the implementation is complete, not partial
3. Flag any tasks that are missing or half-done

Output format:
- Task: {name}
  Status: COMPLETE | PARTIAL | MISSING
  Evidence: {file:line or explanation}
  Gap: {what's missing, if any}
```

**Agent 2: Correctness Reviewer**
```
Review the implementation for CORRECTNESS against the plan.

Plan file: {path}
Branch: {branch}
Changed files: {file list}

For each implemented feature:
1. Does it match the plan's INTENT, not just superficially?
2. Are the data flows correct?
3. Do error paths behave as specified?

Output format:
- Feature: {name}
  Correct: YES | PARTIAL | NO
  Issue: {description of incorrectness, if any}
  Evidence: {file:line}
```

**Agent 3: Quality Reviewer**
```
Review the implementation for CODE QUALITY.

Branch: {branch}
Changed files: {file list}

Check for:
1. Bugs and logic errors
2. Unhandled edge cases
3. Code smells and duplicated logic
4. Security concerns (injection, XSS, etc.)
5. Performance issues

Output format:
- File: {path}
  Line: {number}
  Severity: HIGH | MEDIUM | LOW
  Issue: {description}
  Suggestion: {fix}
```

**Agent 4: Drift Reviewer**
```
Review the implementation for DRIFT from the plan.

Plan file: {path}
Branch: {branch}
Changed files: {file list}

For each deviation found:
1. What the plan specified
2. What was actually implemented
3. Whether the deviation was documented (in plan file, session notes, or commit messages)
4. Whether the deviation is an improvement, compromise, or regression

Output format:
- Area: {what diverged}
  Plan said: {original spec}
  Implementation: {what was done}
  Documented: YES | NO
  Assessment: IMPROVEMENT | COMPROMISE | REGRESSION
```

**Agent 5: Loose Ends Reviewer**
```
Review the implementation for LOOSE ENDS.

Branch: {branch}
Changed files: {file list}

Search for:
1. TODO/FIXME/HACK/XXX comments in changed files
2. Commented-out code blocks
3. Placeholder values or hardcoded strings
4. Incomplete error handling (empty catch blocks, generic error messages)
5. Console.log / print statements left for debugging

Output format:
- File: {path}
  Line: {number}
  Type: TODO | COMMENTED_CODE | PLACEHOLDER | INCOMPLETE_ERROR | DEBUG_LOG
  Content: {the line or block}
```

### Step 3: Consolidate Results

After all agents complete, consolidate into an audit report:

```
## Implementation Audit — {branch}

> Audited against: {plan file}
> Files reviewed: {count}
> Findings: {critical} critical · {warning} warnings · {info} informational

### Completeness

{N}/{M} tasks fully implemented

| Task | Status | Gap |
|------|--------|-----|
| ... | COMPLETE/PARTIAL/MISSING | ... |

### Correctness Issues

{list of correctness problems, if any}

### Code Quality

| Severity | Count | Top Issues |
|----------|-------|------------|
| HIGH | {n} | {summary} |
| MEDIUM | {n} | {summary} |
| LOW | {n} | {summary} |

### Plan Drift

{N} deviations found, {documented count} documented, {undocumented count} undocumented

| Area | Assessment | Documented |
|------|------------|------------|
| ... | IMPROVEMENT/COMPROMISE/REGRESSION | YES/NO |

### Loose Ends

{count} items found across {file count} files

| Type | Count |
|------|-------|
| TODO | {n} |
| Commented code | {n} |
| Placeholders | {n} |
| Incomplete error handling | {n} |
| Debug logs | {n} |
```

### Step 4: Create Remediation Tasks

For any HIGH severity findings or MISSING completeness items, create TaskCreate todos:

```
For each critical finding:
  TaskCreate: "Fix: {description}" with details from the audit
```

Ask using AskUserQuestion:
```
Audit complete. {N} issues found. What next?
  ○ Create tasks for all findings — Add todo items for remediation
  ○ Create tasks for critical only — Only HIGH severity and MISSING items
  ○ Review only — I'll handle remediation manually
```
