# FIX-XXX

<!--
  TEMPLATE FILE - DO NOT EDIT DIRECTLY
  Location: ~/.claude/skills/fix-issues/project-setup/templates/FIX_ISSUE.md

  Usage: Claude copies this to docs/fix-sessions/YYYY-MM-DD_HH-MM/FIX-001.md
  (renaming XXX to the issue number) when an issue enters Phase 1.
  One file per issue. GATE markers are written within this file.
-->

> **Description**: [From user input or imported from audit]
> **Source**: [Direct | Imported from audit-filename ISSUE-XXX]
> **Scope**: [LIGHT | STANDARD | DEEP]
> **Status**: QUEUED

---

## 2. Investigation & Diagnosis

#### 2.1 Affected Files

| File | Role | Lines of Interest |
|------|------|-------------------|
| | | |

#### 2.2 Business Rules

| Rule | Source | Impact |
|------|--------|--------|
| | | |

#### 2.3 Data Flow

```
[Text-based data flow diagram]
```

#### 2.4 Related History

| Commit | Date | Author | Relevance |
|--------|------|--------|-----------|
| | | | |

#### 2.5 Test Coverage

| Test File | Type | Covers This Area | Status |
|-----------|------|------------------|--------|
| | | | |

#### 2.6 Hypothesis

**Imported from audit** (if applicable): [Pre-filled from audit Issue Details root cause]

**Initial**: [What you think is wrong]

**After Diagnosis**: [Confirmed root cause with evidence]

#### 2.7 Diagnostic Results

| Tool/Command | Result (Summary) |
|--------------|------------------|
| | |

#### 2.8 Pre-Fix Validation

| Subagent | Recommendation | Key Findings |
|----------|---------------|--------------|
| | | |

**Strategy Adjustments** (if any): None

---

## 3. Fix Applied

**Root Cause**: [Confirmed from Phase 2]

**Fix Strategy**: [What you're changing and why]

**Business Rule Impact**: None | [Describe if any]

#### Files Changed

| File | Change Description | Lines |
|------|-------------------|-------|
| | | |

#### Tests Added/Modified

| Test File | What It Tests | Type |
|-----------|---------------|------|
| | | |

**Commit**: [hash] - [message]

#### Review Results

**Spec Compliance**: TBD
**Code Quality** (STANDARD+ only): TBD | LIGHT skip documented

---

## 4. Verification Results

| Check | Command | Result | Notes |
|-------|---------|--------|-------|
| Unit tests | | | |
| E2E tests | | | |
| Regression check | | | |
| Cross-issue regression | | | |
| Integration (if applicable) | | | |

**Final Status**: VERIFIED | PARTIALLY_VERIFIED | NEEDS_REWORK
