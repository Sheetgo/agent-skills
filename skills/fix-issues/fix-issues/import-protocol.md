# fix-issues Import Protocol — Test-Audit Integration

> **Referenced from**: `SKILL.md`
> **When to read**: Only when importing issues from a test-audit session. If the user says "fix issues from test-audit" or references a `docs/test-audits/` file, read this document.

### 0.3 Import from Test-Audit

**Trigger detection** — activate import mode when user message contains:

```
DETECTION RULE:
  (fix|address|resolve|continue|pick up) AND (test-audit|test audit|audit)
  OR mentions docs/test-audits/ path or audit session file
  OR says "fix everything from the audit" / "fix the open issues"
  OR names a specific ISSUE-XXX from an audit

EXAMPLES:
  "fix issues from test-audit"           → import ALL open issues
  "let's address the open audit issues"  → import ALL open issues
  "the test audit found ISSUE-004"       → import ONLY ISSUE-004
  "fix ISSUE-004 from the audit"         → import ONLY ISSUE-004
  "fix some bugs"                        → NOT import mode (no audit ref)

SELECTIVE IMPORT:
  If the user names specific issue IDs → import ONLY those IDs
  Otherwise → import ALL open issues (Status = "Open")
```

**Import Protocol:**

The fix-session uses the SAME template (`SESSION.md`) and SAME directory
(`docs/fix-sessions/`) as any other fix session. The only difference is WHERE
the issues come from.

```
STEP 1 - FIND THE AUDIT SESSION:
  If user specifies a file → use that file
  Otherwise → find the .md in docs/test-audits/ with the most recent
  creation timestamp (from filename YYYY-MM-DD_HH-MM.md)

STEP 2 - SCAN FOR IMPORTABLE ISSUES:
  Read the audit session file using targeted reading:
    1. Read header + Executive Summary (first 50 lines) for orientation
    2. Use Grep to find "Active Issues" and "Issue Details" section locations
    3. Read only those sections with offset/limit — do NOT read entire file

  IMPORTANT: Locate sections by HEADING TEXT, not section number.
  Audit files may have bonus sections that shift numbering. Search for:
    - "Active Issues" (typically Section 5.1)
    - "Issue Details" (typically Section 5.3)
    - "Resolved Issues" (typically Section 5.2)
    - "Missing Telemetry" (typically Section 7.3)
    - "Recommendations for Future" (typically Section 8.4 or 8.5)
    - "Sign-off" (typically Section 8.5 or 8.6)

  Extract:

  AUTO-IMPORT (always, unless selective import specified):
    a) Active Issues table → any row with Status = "Open"
       (If selective import: only rows matching user-specified IDs)
    b) Issue Details → blocks where "Fix Applied: NOT YET IMPLEMENTED"
       (or any variation: "TODO", "Not fixed", "pending")

  OPT-IN (only if user explicitly mentions telemetry or recommendations):
    c) Missing Telemetry table → present count and ask:
       "The audit has N high-priority and M medium-priority telemetry gaps.
        Include high-priority? Also include medium-priority?"
    d) Recommendations section → present list and ask:
       "The audit has N recommendations. Which ones to address?"

  EMPTY AUDIT (0 importable issues found):
    If Active Issues has 0 Open issues (or none match selective filter):
      1. Check if user mentioned telemetry/recommendations → offer OPT-IN
      2. Otherwise inform: "Audit [filename] has no open issues.
         Would you like to address telemetry gaps (N) or recommendations (M)?"
      3. If user declines → exit cleanly: "No issues to process."

  MISSING DETAIL BLOCK:
    If an open issue in Active Issues has no corresponding Issue Details block:
      → Import with only the Active Issues fields (ID, Category, Test File)
      → Mark source as "thin import" — MUST run full STANDARD investigation

  After scope is set, proceed autonomously. No further questions.

STEP 3 - REGISTER IN FIX-SESSION:
  Write issues into the session document using the SESSION.md template:
    - Section 1 (Issue Registry): One row per imported issue
    - Sections 2, 3, and 4: Clone the FIX-001 block for each additional issue

  FIELD MAPPING (audit → fix-session):
    audit Active Issues: ID          → Section 1: ID (renumber to FIX-XXX)
    audit Active Issues: Category    → Section 1: Category column
    audit Active Issues: Status      → Section 1: Status = "QUEUED"
    audit Active Issues: Test File   → Section 1: Description (include scope)
    audit Issue Details: Error Msgs  → Section 2.7: Diagnostic Results
                                       (Tool/Command = "Imported from audit",
                                        Result = error pattern + count)
    audit Issue Details: Root Cause  → Section 2.6: "Imported from audit" field
    audit Issue Details: Reco. fixes → Section 2: Description (as fix strategy)
    audit Active Issues: Test File   → Section 2.1: Affected Files table

  For each imported issue:
    1. Assign FIX-XXX ID
    2. Copy ALL fields using mapping above
    3. Record source: "Imported from [audit-filename] ISSUE-XXX"
    4. Set status to QUEUED

STEP 4 - RECORD LINK IN SESSION HEADER:
  Update the session file header fields:
    > **Source Audit**: docs/test-audits/YYYY-MM-DD_HH-MM.md
    > **Imported Issues**: ISSUE-004 → FIX-001, ISSUE-005 → FIX-002, etc.

  Also add a row to the Import Mapping table (Section 6.1) for each issue.

STEP 5 - PRESENT SUMMARY AND PROCEED:
  Show what was imported (no confirmation needed, just inform):
    "Imported N issues from audit [filename]:
     - FIX-001: [description] (from ISSUE-XXX)
     Starting Phase 1 for FIX-001..."
  Then proceed directly to Phase 1.
```

**Bidirectional Update Protocol:**

When fixing issues imported from a test-audit, BOTH documents must stay in sync:

```
AFTER EACH FIX IS VERIFIED (or PARTIALLY_VERIFIED):
  1. Update the FIX-SESSION (as normal, Sections 3 + 4)

  2. Update the SOURCE AUDIT file (locate sections by heading text, not number):

     a) Active Issues table → Change Status from "Open" to:
        - "Fixed in fix-session [session-filename]" (if fully verified)
        - "Partially fixed in fix-session [session-filename]" (if partial)

     b) Issue Details block → Update "Fix Applied:" and "Commit:" fields
        with actual values. If partial fix, list what was fixed and what remains.

     c) Resolved Issues table → Add row using audit format:
        ID | Category | Test File | Resolution | Commit Hash
        (Use the ORIGINAL audit ID, Category, and Test File)
        NOTE: Only add to Resolved if fully fixed. Partial fixes stay in Active.

     d) Sign-off section (search for heading "Sign-off") →
        Check the box if this fix unblocks sign-off

  3. Record the write-back in FIX-SESSION Section 6 (Audit Sync Log):
     Timestamp | Audit Section Updated | Change Description | FIX ID

  4. Append timestamp to the audit's Issue Details block:
     "Updated [YYYY-MM-DD] via fix-session [session-filename]"

TELEMETRY GAPS (section titled "Missing Telemetry"):
  The audit's telemetry table schema varies. Handle both cases:
    - If table has a "Status" column → update Status to "DONE"
    - If table has NO Status column → append " — DONE: [commit-hash] ([date])"
      to the last text column (typically "Recommendation")
  Then update:
    → Coverage numbers in the section titled "Interaction Types Coverage"
      (increment "With Telemetry" by 1, recalculate percentage)
    → Executive Summary telemetry row (update gap count)

RECOMMENDATIONS (section titled "Recommendations for Future"):
  If addressing a recommendation:
    → Append "DONE — [commit-hash] [date]" to the recommendation text
```

### 0.4 Dependency Detection

After all issues are registered (Phase 0.2 or 0.3), check for dependencies:

```
DEPENDENCY CHECK:
  1. For each pair of registered issues, check if they share:
     - Same affected files
     - Same logical flow or feature area
     - Fix for one would change code the other touches
  2. If dependencies found:
     - Add to Session File Section 1 with a "Depends On" note in Description
     - Reorder processing: fix dependencies first
     - Document reasoning for the order
  3. If no dependencies found → process in registration order
```
