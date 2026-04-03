# Fix Session - Issue Resolution

<!--
  TEMPLATE FILE - DO NOT EDIT DIRECTLY
  Location: ~/.claude/skills/fix-issues/project-setup/templates/SESSION.md

  Usage: Claude creates docs/fix-sessions/YYYY-MM-DD_HH-MM/ directory,
  copies this file into it, and creates FIX-XXX.md files on demand
  from FIX_ISSUE.md template as issues enter Phase 1.
-->

> **Session Type**: Fix Session
> **Session Started**: [WILL BE AUTO-UPDATED]
> **Current Issue**: -
> **Overall Status**: In Progress
> **Session Dir**: [PATH WILL BE SET BY CLAUDE]
> **Source Audit**: None | [PATH TO AUDIT FILE IF IMPORTED]
> **Imported Issues**: None | [AUDIT-ID → FIX-ID mapping]

---

## Executive Summary

| Metric | Count |
|--------|-------|
| Total issues registered | 0 |
| Issues investigated | 0 |
| Issues diagnosed | 0 |
| Issues fixed & verified | 0 |
| Issues partially verified | 0 |
| Issues deferred/blocked | 0 |
| Commits made | 0 |

---

## 1. Issue Registry

| ID | Category | Description | Status | Root Cause | Fix Commit |
|----|----------|-------------|--------|------------|------------|
| | | | | | |

**Status values**: QUEUED | INVESTIGATING | DIAGNOSED | FIXING | FIXED | VERIFIED | PARTIALLY_VERIFIED | NEEDS_REWORK | BLOCKED | AWAITING_DECISION | DEFERRED

**Processing Order**: [Set after scope assessment]

---

## 5. Commits Made

| # | Hash | Message | Files Changed |
|---|------|---------|---------------|
| | | | |

---

## 6. Audit Sync Log

> Used when issues were imported from a test-audit session.

### 6.1 Import Mapping

| FIX ID | Source Audit ID | Source File | Status |
|--------|----------------|-------------|--------|
| | | | |

### 6.2 Write-Back Log

| Timestamp | Audit Section Updated | Change Description | FIX ID |
|-----------|----------------------|-------------------|--------|
| | | | |

---

## 7. Recommendations

| # | Finding | Recommended Action | Priority |
|---|---------|-------------------|----------|
| | | | |

---

## Sign-off

- [ ] All issues investigated (Phase 1 complete for each)
- [ ] All issues diagnosed with confirmed root cause (Phase 2)
- [ ] All fixes applied with minimal changes (Phase 3)
- [ ] All fixes verified with passing tests (Phase 4)
- [ ] Cross-issue regression check passed (Phase 4.5)
- [ ] If imported: source audit file updated with fix details
- [ ] Session directory complete and accurate
- [ ] All commits LOCAL (NEVER PUSHED)
- [ ] Ready for human review

---

## REMOTE PUSH PROHIBITION

```
THIS SESSION AND ALL RELATED COMMITS MUST STAY LOCAL.
NEVER EXECUTE: git push, git push origin, git push --force, or any push variant.
HUMAN REVIEW IS MANDATORY BEFORE ANY REMOTE SYNCHRONIZATION.
```
