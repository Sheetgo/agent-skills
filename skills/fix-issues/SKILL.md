---
name: fix-issues
description: Use when fixing bugs, resolving issues, or addressing small improvements found in testing, user reports, or code audits
---

# Issue Fixing & Bug Resolution Workflow

> **Version**: 3.1.14
> **Updated**: 2026-04-03
> **Purpose**: Autonomous issue investigation, diagnosis, and resolution with live verification
> **Setup**: User-level skill (works in any project). Optional per-project `.claude/settings.local.json` for permissions + hook — see `SETUP.md`.
> **Skill home**: `~/.claude/skills/fix-issues/` — templates, scripts, and sub-files live here
> **Critical**: The session directory (SESSION.md + FIX-XXX.md files) is the ONLY thing that survives compaction. If it's not in the files, it didn't happen.

---

## When to Use This vs Other Skills

```
Is it a bug, issue, or small improvement?
├─ Yes → Use THIS skill (/fix-issues)
│   ├─ Single issue → Process it through the full pipeline
│   └─ Multiple issues → Process each through the pipeline sequentially
├─ Is it a new feature? → Use /brainstorming + /writing-plans
├─ Is it a broad test-suite failure (infra, many tests)? → Investigate with superpowers:systematic-debugging first, then fix here
└─ Unsure → Default to THIS skill (cheaper to escalate than over-plan)
```

## Definitions

**Subagent**: An Agent tool invocation (subagent_type=Explore or general-purpose) with a named role, defined task, and structured output.

**Session directory**: The timestamped directory at `docs/fix-sessions/YYYY-MM-DD_HH-MM/` containing SESSION.md (registry, summary) and per-issue FIX-XXX.md files. Survives compaction. At wrap-up, FIX files are merged into SESSION.md for archival (single file per session).

**Issue file**: A FIX-XXX.md file within the session directory — contains investigation, fix, and verification for one issue. GATE markers are written here.

**Checkpoint**: A mandatory Edit to SESSION.md or FIX-XXX.md + TaskUpdate at every status transition. If you don't write it, it didn't happen.

**Universal property**: A language- and framework-agnostic characteristic of a fix that determines what kind of validation it requires. Detected from diff content + investigation outputs. See [Universal Properties](#universal-properties-p1p13).

**Project profile**: A per-project markdown file at `<project-root>/.claude/PROJECT_PROFILE.md` that maps universal properties to project-specific surfaces (file paths, function names, validation tools, business-rule documentation locations). Auto-discovered on first use; integrity-hashed and re-verified at every session start. Template at `~/.claude/skills/fix-issues/project-setup/templates/PROJECT_PROFILE.md`.

**Validator agent**: A subagent dispatched at Phase 4 to verify a fix by walking its specific scenario, observing the result, and reasoning against the fix's stated intent — bounded by fix blast radius, not by codebase size. Selects tools from the project profile's available set per property; runs available tools in parallel for cross-checking when more than one applies.

## Universal Properties (P1–P13)

The skill validates fixes by detecting which universal properties apply, then dispatching property-specific validation. Properties are language-agnostic; project specifics live in `PROJECT_PROFILE.md` Section B. At Phase 1, every fix gets a yes/no answer for each property. The set of `yes` answers determines the validation verdict required at Gate 3.

The full strategy catalog (S1–S14) and cross-check pairs are documented at [`fix-issues/toolbox-strategies.md`](fix-issues/toolbox-strategies.md).

For each property: detection rule (when it fires) and pointer to validation strategy. The full validation strategy per property is in `toolbox-strategies.md`.

| # | Property | Triggers when |
|---|---|---|
| **P1** | Boundary crossing — I/O, network, DB, FS, external service, OS API | Diff includes calls listed in profile §B `boundaries`; investigation identifies a process-boundary crossing |
| **P2a** | Code-level async — Promise/await/futures/coroutines/threads/callbacks | Diff contains language-level async primitives from profile §B `async_primitives`; investigation describes ordering/timing dependence |
| **P2b** | Platform-deferred mutation — APIs that queue and flush at end-of-script/transaction/frame | Diff touches APIs in profile §B `deferred_mutation_apis`; investigation references "batched", "deferred", "flush", or "lazy" semantics |
| **P3** | Externally-visible state mutation — writes to shared/persisted state | Diff writes to surfaces in profile §B `state_mutation_surfaces`; investigation describes state transitions |
| **P4** | Authorization-dependent — interacts with identity, permissions, sessions, tokens | Diff touches auth surfaces in profile §B `auth_surfaces`; investigation references identity-conditional behavior |
| **P5** | Error classification or routing — error paths, codes, propagation, recovery | Diff touches files matching profile §B `error_routing_surfaces` patterns; **OR** net-negative LOC in those files (deletion of error handling); **OR** investigation explicitly references error routing |
| **P6** | Cross-layer signaling — change emits a signal another layer consumes | Diff emits new error code/event/state-update; profile §C lists matching emitter/consumer pair |
| **P7** | Single-observation diagnosis — bug seen once, no reproduction attempt | Phase 1 investigation indicates `observation_count == 1` AND no repro attempted |
| **P8** | Journey continuity — multi-step user flow, edit/resume modes, navigation | Diff touches files in any profile §D `journeys` step or alt-mode |
| **P9** | Component ripple — change touches export with N consumers | Static usage analysis (profile §B `usage_analyzer`) returns N≥1 consumers for any changed export |
| **P10** | Business-rule semantics — change alters WHAT, not HOW | Investigation references a documented rule from profile §G; OR diff changes return shape/validation/defaults/computed values |
| **P11** | Visual/render dependency — styling, layout, focus, z-stacking, DOM structure | Diff touches files/props listed in profile §B `visual_surfaces` |
| **P12** | Mock-surface asymmetry — server adds branch with no mock counterpart | Diff adds branch in non-mock file; profile §E mock files have no corresponding update |
| **P13** | Configuration-only change — config/env/build files, no application code | Diff touches only files in profile §B `config_surfaces`; no application code modified |

For validation strategy per property, see `toolbox-strategies.md`.

### Property detection algorithm

After Phase 1 investigation subagents return, the agent answers each property yes/no:

```
For P1..P13:
  Read PROJECT_PROFILE.md Section B (universal properties × project surfaces).
  Examine: (a) diff lines, (b) investigation outputs, (c) file paths touched, (d) deletion patterns.
  Answer yes if detection criteria match.
  If criteria are partially met or borderline → answer YES (conservative bias).
  Only answer no when no detection criterion fits AT ALL.
  Every "no" answer for a LIVE-required property (P1, P2a, P2b, P3, P5) requires
    a one-sentence justification recorded in FIX-XXX.md Section 2.5 (e.g.,
    "P2b no: this fix touches no API in profile §B deferred_mutation_apis").
  Record yes/no answers in FIX-XXX.md Section 2.5 "Universal Properties".
```

**Why conservative bias on borderline cases**: a false positive on a property costs one extra validator run (cheap). A false negative silently skips LIVE-VERIFIED for a fix that needed it (expensive — that's exactly the failure mode the redesign exists to prevent).

When the profile is missing or its referenced sections are stale (integrity hash mismatch), the validator runs in re-discovery mode: re-reads the affected files, updates the profile section, refreshes hashes — before answering the property.

### Verdict required at Gate 3

| Property `yes` count / which | Required verdict |
|---|---|
| 0 (no `yes` from any property) | `MOCK-VERIFIED` allowed |
| Any P1, P2a, P2b, P3, P5 yes | `LIVE-VERIFIED` required |
| P4 yes | `LIVE-VERIFIED` with identity-switching matrix per profile §B |
| P6 yes | Cross-layer trace at Gate 2 + LIVE-VERIFIED |
| P7 yes | ≥3 scenario permutations at Phase 4 + LIVE-VERIFIED |
| P8 yes | Journey walk + alt-mode walks (per profile §D) |
| P9 yes | Per-consumer walk (consumers from diagnosis, not exhaustive) |
| P10 yes | Rule conformance assertion against profile §G documented invariant |
| P11 yes | Visual reasoning at component + parent context |
| P12 yes | Mock + real-server cross-check; honesty test extension |
| P13 yes | Built-artifact inspection + runtime behavior check |

Multiple `yes` answers compose: a fix can require LIVE-VERIFIED (P2b) AND journey walk (P8) AND consumer walk (P9). Validator dispatches all required validations in parallel where independent, sequentially where one's output gates the next.

When the validator cannot achieve the required verdict, the verdict is honestly stamped — never silently downgraded to a green checkmark:

- **`LIMITED-VERIFIED`** — at least one required property has no tool listed in profile §H. The skill stamps this verdict, files a `FIX-VALIDATION-GAP-XXX` issue describing the missing tool (e.g., "no fast-check available for P10 rule conformance"), and continues. The validation gap issue enters the same pipeline (its own investigate → fix → verify cycle).
- **`OUT_OF_BAND_VERIFICATION_REQUIRED`** — the fix falls into a category in profile §I that walk+observe+reason genuinely cannot verify (security audit, p99 load, memory leak over time, concurrency race at scale, crypto/token expiry, disaster recovery, regulatory compliance, third-party API drift, email/notification side effects). The skill stamps this verdict and surfaces the deferral in Phase 5; never claims VERIFIED.

## Capability Boundary

Walk-and-observe by a validator agent has fundamental limits. The skill declares these honestly rather than stamping fake VERIFIED for issues it cannot really verify. When a fix's investigation indicates one of these categories, the skill emits `OUT_OF_BAND_VERIFICATION_REQUIRED: <category>` and surfaces it at Phase 5 for human follow-up.

### Out-of-band categories — auto-detection patterns

Scan Section 2.6 (investigation output) and the bug description for these signals:

| Category | Signals in investigation/diff | Project tool location |
|---|---|---|
| Security vulnerability | "XSS", "CSRF", "injection", "privilege escalation", "auth bypass", "secret leak", "unsafe deserialization", "sandbox escape" | §I.security_vulnerability |
| Supply chain audit | "dependency vulnerability", "compromised package", "malicious build artifact", "typosquatted dep" | §I.supply_chain_audit |
| Performance under load | "p99 latency", "throughput regression", "load test", "stress test", "N concurrent users" | §I.performance_under_load |
| Memory leak (long-running) | "heap growth", "memory leak", "eventual exhaustion", "long-running session" | §I.memory_leak_long_running |
| Concurrency race at scale | "race condition", "thread contention", "deadlock", "thundering herd", "lock contention" | §I.concurrency_race_at_scale |
| Crypto / token expiry | "key rotation", "JWT expiry", "signature mismatch", "token refresh", "TLS handshake" | §I.crypto_token_expiry |
| Disaster recovery / fault tolerance | "failover", "DR", "system down", "fault injection", "kill -9", "circuit breaker" | §I.disaster_recovery_fault_tolerance |
| Email / notification side effects | "send email", "notification", "webhook", "Slack alert", "SMS" without dry-run mode | §I.email_notification_side_effects |
| Regulatory / compliance | "GDPR", "HIPAA", "PCI", "SOC2", "data residency", "consent record", "retention policy" | §I.regulatory_compliance |
| Third-party API contract drift | "external API change", "vendor breaking change", "schema drift" without proactive contract test | §I.third_party_api_drift |

### Detection step (after Phase 1.4)

```
For each category in the table:
  Examine bug description + Section 2.6 investigation outputs.
  If any signal matches:
    Check PROJECT_PROFILE.md §I.<category>.applies_to_this_project:
      true + tool listed → use the listed tool/workflow; issue proceeds through Phase 4
        with that evidence (composed verdict can still be LIVE-VERIFIED if validators run).
      true + tool empty → write OUT_OF_BAND_VERIFICATION_REQUIRED: <category> in
        FIX-XXX.md Section 2.6; defer issue at Phase 4 with this verdict; surface at Phase 5.
      false → not relevant to this project; continue.
```

The skill never silently downgrades OUT_OF_BAND to MOCK-VERIFIED or LIVE-VERIFIED. These categories are structurally beyond walk-and-observe — adding more tools won't help.

### LIMITED-VERIFIED vs OUT_OF_BAND_VERIFICATION_REQUIRED

| Scenario | Verdict | Resolution path |
|---|---|---|
| Project profile §H lists no tool for property | LIMITED-VERIFIED + FIX-VALIDATION-GAP issue | Fixable: install the tool, configure it, the gap issue closes |
| Bug description matches §I out-of-band category | OUT_OF_BAND_VERIFICATION_REQUIRED | Genuine capability boundary; not solvable by adding more tools |

The first is a project tooling gap (resolvable). The second is a fundamental limit of walk-and-observe (must be addressed by a different workflow — security audit, load test, compliance review, etc., per profile §I).

### Worked example — applying the framework to a representative bug

Bug: a wizard's destination step shows a stale `isPermissionDenied` alert after re-entering edit mode, even though the permission was fixed upstream. Fix clears the flag on re-pick.

Property detection (after Phase 1):

| Property | Yes/No | Why |
|---|---|---|
| P3 | yes | Fix writes to wizard state — clearing `isPermissionDenied` |
| P8 | yes | Wizard journey's edit-mode alt-mode is the bug surface |
| P9 | yes | The flag setter has multiple consumers (each step reads it) |
| P11 | yes (weak) | Alert is rendered UI; visible state changes |
| P1, P2a, P2b, P4, P5, P6, P7, P10, P12, P13 | no | No I/O, async, auth, error routing, single-obs, business rule, mock asymmetry, or config change |

Required verdict (composing): LIVE-VERIFIED + journey walk including edit-mode alt-mode + per-consumer walk + visual reasoning at parent context.

Validator dispatch: in parallel — S2 (state snapshot diff) + S13 (storage diff) for P3; journey walk + S9 (AX tree) for P8 and P11; S12 (`tsc --noEmit`) for P9. Cross-check pairs flag any disagreement (e.g., screenshot says alert hidden, AX tree says alert role still present → finding).

This pattern — detect, compose verdict, dispatch tools, cross-check — is the same for every fix. Sections vary in `yes` count and tool selection.

## ABSOLUTE RULES

1. **NEVER PUSH TO REMOTE** — all commits stay LOCAL
2. **NEVER CHANGE BUSINESS INTENT** — preserve existing rules
3. **NEVER SKIP INVESTIGATION** — understand before fixing
4. **ASK HUMAN** only for business rule conflicts
5. **CHECKPOINT EVERY STATUS CHANGE** to the session file
6. **NEVER FIX WITHOUT A REGRESSION TEST**
7. **PROVE IT WORKS** — external evidence, not code reading
8. **READ TEST OUTPUT WITH Read TOOL** — never pipe through `tail`, `head`, `grep`, or `awk`. Truncated output hides failures.
9. **DUAL-TRACK** — session file AND TaskUpdate must agree

### Red Flags — STOP If You Catch Yourself Doing These

| Rationalization | Reality |
|----------------|---------|
| "This bug is obvious, I can skip investigation" | Obvious bugs have hidden causes. Investigate. |
| "Session document is overhead for a simple fix" | Simple fixes become complex 60% of the time. Track from the start. |
| "I'll add tests later" | You won't. Add the test NOW as part of the fix. |
| "I already know where the code is" | You know WHERE, not WHY. Investigation reveals WHY. |
| "This doesn't need subagents" | Even LIGHT scope uses at least 1 subagent. |
| "Let me just fix it first, then document" | If you fix first, you won't document. Checkpoint AS you go. |
| "I'll update the session file at the end" | **NO.** You will forget. Update IMMEDIATELY at every status change. |
| "I can tell this works by reading the code" | Code reading is hypothesis, not proof. Run it. Test it. Screenshot it. |
| "Local tests pass, skip integration" | For backend changes, integration tests catch what local tests miss. |
| "I'll update the task status later" | Task and session file updates are ONE atomic action. No exceptions. |
| "Cosmetic fix, no test needed" | Cosmetic fixes regress too. Document visual verification or add a snapshot test. |
| "A unit test assertion isn't practical" | If unit test is impractical, use E2E or Playwright snapshot. Some verification is mandatory. |
| "Let me commit and mark complete" | You haven't verified. GATE 3 requires test evidence before VERIFIED. |
| Goes straight from "I understand" to Edit | You skipped investigation, diagnosis, and pre-fix validation. Go back to Phase 1. |
| Types "VERIFIED" without running anything | GATE 3 blocks this. At least one test command must run with recorded output. |
| "The fix is simple, reviews are overkill" | Simple fixes have hidden issues. Spec compliance review is always mandatory. |
| "Backend changes don't need business rule checks" | Backend controls timeouts, retries, state cascades — all are business rules. |
| "High severity = run T1 only" | Tier selection is by CHANGE TYPE, not severity. See CLAUDE.md test tier guide. |
| "Code quality review skipped (LIGHT scope)" for STANDARD/DEEP | Section 2 scope is authoritative. If it says STANDARD/DEEP, Step C is MANDATORY. You cannot claim LIGHT in Section 3. |
| "I'll batch more than 3 LIGHT issues for efficiency" | Max 3 per batch. The gate-check hook will FAIL if you exceed this. Split into multiple batches. |
| "STANDARD issue is simple enough to batch" | Scope determines batching, not your judgment. Only LIGHT can batch. |
| Writes "GATE N PASSED" without running `check-fix-gate.cjs` | ALL gates (1, 2, 3) require the script. Hook output is NOT sufficient. Writing the marker is Step 1. Running the script is Step 2. Step 1 without Step 2 is a pipeline violation. |
| "The hook already validated this gate" | Hook output is informational. The script is the authoritative check. Run it every time, for every issue. |
| Pipes test command through `tail`/`head`/`grep` | `tail` hides errors before the summary. Redirect to file, then use Grep tool. See Phase 4.1 OUTPUT RULE. |
| Includes `tail`/`head` in subagent prompts | Subagent instructions must follow the same rules. Use file redirect + Grep pattern. |
| Skips Final Review in Phase 5 | "I already verified each issue" — per-issue gates check individual correctness. Final Review reasons about the full picture: do fixes conflict? Are there missing edge cases? Does the combined change set make sense for the project? |
| "Tool A passed and tool B failed, so I used A" | INCONSISTENCY is mandatory at Phase 4.1. Feed the disagreement to Phase 3 as new diagnostic input. You cannot pick a winner. The disagreement IS the finding. |
| "Tool B is known to be flaky / lag / be wrong" | Disagreement between independent tools is the strongest signal a fix is incomplete. If tool B is genuinely defective, fix tool B as a separate issue. Until then, treat the disagreement as a real finding. |
| "Property is borderline, marking no" | Conservative bias: when criteria are partially met, answer YES. False positive costs one validator run; false negative ships a bug. See Phase 1.4 detection algorithm. |
| Skips Phase 2.0 baseline for "simple LIGHT issue" | Phase 2.0 is regression-attribution infrastructure, mandatory for ALL scopes including LIGHT and single-issue sessions. PRE-EXISTING attribution at 4.3 self-seals without it. |
| Demotes verdict to LIMITED-VERIFIED to skip running an available tool | LIMITED-VERIFIED is permitted ONLY when PROJECT_PROFILE §H lists no tool for the property. If §H has a tool, running it is mandatory. Demoting because running is inconvenient is a pipeline violation. |
| "I think the tool would say PASS" | Predicting tool output is not running the tool. Run it. Read the actual output. Cite it in Section 4. |
| "VERIFIED-BY-PRECEDING-FIX, skip Phase 4" | Phase 4.1 still runs. VERIFIED-BY-PRECEDING-FIX still requires Section 2.5 + Section 4 per-property verdicts citing the preceding fix's commit hash. Inheriting verification without re-running is not allowed. |
| Describes the fix as "a band-aid" or "temporary" in prose without writing the literal `PROVISIONAL_PROPER_FIX_REQUIRED:` token | Phase 5.0.5 grep's for the LITERAL token. Paraphrase bypasses the scan silently. If fix_type is PROVISIONAL, write the EXACT string `PROVISIONAL_PROPER_FIX_REQUIRED: <description>` to Section 3. No paraphrase, no synonym, no narrative substitute. |
| "Fix consumes existing boundaries already exercised by other code" / "the integration suite covers it" / "the boundaries themselves are live-covered by the wider integration suite" | This is the **inheritance rationalization** — the FIX-001 (2026-05-04) failure mode. P1/P2a/P3/P5 evidence must come from THIS fix's verification, not from "code elsewhere uses these surfaces". A new consumer of an existing boundary still introduces new behavior at that consumer; live-tool evidence at the new consumer is non-negotiable. If §H lists a tool, run it. If §H is empty, demote the property's verdict to LIMITED-VERIFIED. Do not stamp PASS on inherited coverage. Script v2 (Gate 3) blocks this mechanically. |

## CHECKPOINT PROTOCOL (MANDATORY)

The session directory is the single artifact that survives compaction. If you don't write to it, your work is invisible.

**Rule**: Write to SESSION.md or FIX-XXX.md at EVERY status transition + call TaskUpdate. No exceptions.

| Trigger | Session File Action | TaskUpdate |
|---------|-------------------|------------|
| Issue registered | Write to SESSION.md Section 1 | TaskCreate |
| Investigation started | Status → INVESTIGATING in FIX-XXX.md header | activeForm: "Investigating FIX-XXX" |
| Subagent completes | Append to FIX-XXX.md Section 2 | (none — too granular) |
| Root cause confirmed | Status → DIAGNOSED in FIX-XXX.md header | activeForm: "Diagnosed FIX-XXX" |
| Fix strategy decided | Write to FIX-XXX.md Section 3 | activeForm: "Fixing FIX-XXX" |
| Fix committed | Update SESSION.md Section 1 + FIX-XXX.md Section 3 | activeForm: "FIX-XXX fixed, verifying" |
| Verification run | Append to FIX-XXX.md Section 4 | (none — too granular) |
| Final status set | Update SESSION.md Section 1 + FIX-XXX.md Section 4 + FIX-XXX.md header | status: completed (if VERIFIED) |
| Issue deferred/blocked | FIX-XXX.md header Status → DEFERRED/BLOCKED + fill Sections 3-4 stub | status: completed |
| Session complete | SESSION.md Executive Summary | (none) |

**Header Status**: The `> **Status**: X` line in each FIX-XXX.md header MUST stay current. Update it at EVERY transition — it is the primary indicator read after compaction. Stale headers cause incorrect resumption.

**Batching**: Adjacent triggers in the same phase step may batch into one Edit. Never leave a phase boundary without checkpointing all pending updates.

**After compaction**: Read SESSION.md (~100 lines) → read current FIX-XXX.md (~150 lines) → check git status/log for drift → reconcile → call TaskList to reconnect with existing todos and resume DUAL-TRACK updates → resume. Do NOT read prior FIX files — only SESSION.md + current FIX-XXX.md (see Between-Issue Context Hygiene). Total recovery: ~250 lines (fixed) regardless of issue count.

## PHASE 0: Initialize Session

### 0.0 Enable Auto-Continue (optional)

If the `ralph-loop` skill is available, activate it to survive platform turn-limit interruptions:

```
Skill tool: ralph-loop:ralph-loop
Args: "Continue the fix-issues session. Read SESSION.md to find current state and resume." --completion-promise "FIX-SESSION COMPLETE" --max-iterations 5
```

This makes the Stop hook re-feed the prompt if the platform cuts the turn mid-pipeline. The agent will read SESSION.md (compaction recovery protocol) and resume from the current issue. Skip this step if ralph-loop is not installed.

### 0.1 Create Session Directory

```bash
SKILL_HOME=~/.claude/skills/fix-issues/project-setup
mkdir -p docs/fix-sessions
SESSION_DIR="docs/fix-sessions/$(date +%Y-%m-%d_%H-%M)"
mkdir -p "$SESSION_DIR"
cp "$SKILL_HOME/templates/SESSION.md" "$SESSION_DIR/SESSION.md"
sed -i '' "s/\[WILL BE AUTO-UPDATED\]/$(date '+%Y-%m-%dT%H:%M:%S')/" "$SESSION_DIR/SESSION.md"
echo "Session directory: $SESSION_DIR"
```

After creating:
- Update `**Session Dir**` header with actual path
- Update `**Current Issue**` to `-`
- If NOT audit-import: delete Section 6 (Audit Sync Log)
- Verify gate-check hook: The PostToolUse hook auto-runs gate validation when you write GATE markers to FIX-XXX.md files.
  Verify the hook is registered: check `.claude/settings.local.json` or `.claude/settings.json` has `gate-check-hook` in PostToolUse.
  Diagnostic log: `/tmp/gate-hook-diag.log` — check if hook fires silently.
  **Fallback**: If hooks don't produce visible output, run gate checks manually:
  `node ~/.claude/skills/fix-issues/project-setup/scripts/check-fix-gate.cjs <session-dir> <gate-num> <FIX-ID>`

### 0.2 Register Issues

```
For each issue:
  1. Assign sequential ID (FIX-001, FIX-002, ...)
  2. Write initial description, set status to QUEUED
  3. Add to Issue Registry in SESSION.md (Section 1)
  4. TaskCreate({ subject: "FIX-XXX: [description]", activeForm: "Queued: FIX-XXX" })
  5. Issue files (FIX-XXX.md) are created ON DEMAND when the issue enters Phase 1
CHECKPOINT: Update Executive Summary "Total issues registered" count in SESSION.md.
```

For audit import: Read [import-protocol.md](fix-issues/import-protocol.md).

After all issues registered, check for inter-issue dependencies: see [import-protocol.md](fix-issues/import-protocol.md) Section 0.4.

### 0.3 Scope Assessment

Before Phase 1, classify each issue:

```
Single-file, single-function (UI color, typo, selector)?
  → LIGHT: 1 subagent, fast diagnosis
Multi-file, cross-component (state flow, shared logic)?
  → STANDARD: 3 subagents, full diagnosis
Cross-layer (frontend + backend), timing, execution?
  → DEEP: All subagents + deploy + integration tests

Unclear? → Start LIGHT. Upgrade if investigation reveals wider impact.
Scope can only UPGRADE, never downgrade.
```

Record scope in FIX-XXX.md when the issue file is created in Phase 1.

### 0.4 Load Project Profile + Verify Integrity

The project profile (`<project-root>/.claude/PROJECT_PROFILE.md`) maps the universal property framework to project-specific surfaces. It is required for Phase 1.4 (property detection) and Phase 4 (validator dispatch).

```
1. Read <project-root>/.claude/PROJECT_PROFILE.md.

2. If missing:
   → Run profile auto-discovery by dispatching a profiler subagent that:
     - Reads CLAUDE.md, package.json/pyproject.toml/Cargo.toml/go.mod
     - Greps for known async primitives, error patterns, mock files
     - Identifies user journeys, cross-layer pairs, validation tools
     - Computes integrity hashes for referenced files
     - Writes the profile from the template at
       ~/.claude/skills/fix-issues/project-setup/templates/PROJECT_PROFILE.md
   → Continue with the freshly-discovered profile.

3. If present, verify integrity:
   For each `path` in profile §J integrity_hashes:
     compare current `git rev-parse HEAD:<path>` to stored sha
     if `git rev-parse HEAD:<path>` errors (e.g., file untracked):
       fall back to sha256sum <path> compared to a last-known sha in the profile header
       if no last-known sha exists → mark UNVERIFIED, require re-discovery before use
     if mismatch → mark dependent profile section as UNVERIFIED (note in profile header)

4. Verify §H population is sufficient for autonomous operation:
   For each LIVE-required property (P1, P2a, P2b, P3, P5):
     verify §H lists at least one tool for that property
     if §H is empty for any LIVE-required property:
       write to SESSION.md header:
         "PROFILE-INCOMPLETE: §H missing entries for [list of properties] —
          fixes touching these properties cannot achieve LIVE-VERIFIED in this project"
       Continue, but every fix that fires one of these properties will be
       blocked from LIVE-VERIFIED at Phase 4 and emit a FIX-VALIDATION-GAP-XXX
       to add the missing tool to the project (e.g., install Playwright,
       configure fast-check, add semgrep rules).

5. Load profile §I (Capability Boundary) into session context. Issues whose
   investigation indicates a category in §I (security audit, p99 load, memory
   leak, concurrency race at scale, crypto/token expiry, disaster recovery,
   regulatory compliance, third-party API drift, email/notification side effects)
   will receive `OUT_OF_BAND_VERIFICATION_REQUIRED` instead of `VERIFIED`.

CHECKPOINT: Note in SESSION.md header one of:
  - PROFILE-VERIFIED (loaded; all hashes match; §H sufficient for LIVE-required properties)
  - PROFILE-AUTO-DISCOVERED (newly created this session)
  - PROFILE-WITH-STALE-SECTIONS (some hash mismatches; affected sections marked UNVERIFIED)
  - PROFILE-INCOMPLETE (loaded but §H missing entries for at least one LIVE-required property)
```

Stale-section handling: any property whose `yes` answer depends on an UNVERIFIED profile subsection triggers re-discovery mode in Phase 1.4 (re-reads the affected files, refreshes the profile section, updates the hash) before the property answer is recorded.

---

## PHASE 1: Investigate (Per Issue)

**Goal**: Understand the problem deeply before touching any code.

Before starting: Create FIX-XXX.md from template:
```bash
cp "$SKILL_HOME/templates/FIX_ISSUE.md" "$SESSION_DIR/FIX-XXX.md"
# Replace XXX with actual issue number, fill in description/source/scope
```
Update session header `**Current Issue**` in SESSION.md to `FIX-XXX`.
**CHECKPOINT: Set status to INVESTIGATING** in SESSION.md Issue Registry.

Write findings incrementally — after each subagent or major finding, CHECKPOINT Section 2 immediately.

### 1.1 Dispatch Investigation Subagents

For tool commands, see [toolbox.md](fix-issues/toolbox.md).

```
SUBAGENT_CODEBASE_EXPLORER (all scopes):
  Task: Find all code related to the issue — files, functions, data flow
  Output: List of relevant files with line numbers and their roles

SUBAGENT_CONTEXT_READER (STANDARD+ only):
  Task: Read CLAUDE.md files, design docs, existing tests, business rules
  Output: Business rules list, test coverage status, design constraints

SUBAGENT_HISTORY_ANALYZER (STANDARD+ only):
  Task: Check git history for impacted files — regressions, related fixes
  Output: Timeline of changes, potential regression commit
```

**CHECKPOINT: After each subagent returns**, update Section 2.

### 1.2 Consolidate + Hypothesis

Merge findings, write hypothesis to Section 2.6. Status remains INVESTIGATING.

### 1.3 Reproduce the Bug

LIGHT: reproduction optional if root cause confirmed by code analysis (document skip reason).
STANDARD/DEEP: reproduction mandatory. Use Playwright (frontend) or clasp (backend).

**CHECKPOINT**: Record reproduction result in Section 2.7.

**Imported from audit?** Check freshness — if audit is current AND thorough, skip to Phase 2 with audit hypothesis. If stale/thin, run LIGHT investigation. See [import-protocol.md](fix-issues/import-protocol.md).

### 1.4 Detect Universal Properties

After 1.1–1.3, run the [Property detection algorithm](#property-detection-algorithm). Read PROJECT_PROFILE.md Section B; for each property P1–P13, examine diff lines, investigation outputs, file paths touched, and deletion patterns; answer yes/no.

**CHECKPOINT**: Record yes/no answers in FIX-XXX.md Section 2.5 "Universal Properties" with one-sentence justification per `yes` answer. The set of `yes` properties determines the [Verdict required at Gate 3](#verdict-required-at-gate-3).

If PROJECT_PROFILE.md is missing → trigger profile auto-discovery (see Phase 0; runs once per project, then re-uses).
If a referenced section in the profile shows integrity hash mismatch → run that subsection in re-discovery mode before answering the dependent property.

---

## PHASE 2: Diagnose (Per Issue)

**Goal**: Confirm hypothesis using live tools. Be autonomous — use everything available.

**Entry**: Issue status should be INVESTIGATING.

### 2.0 Capture Baseline (MANDATORY — All Scopes, All Sessions)

Before applying ANY diagnostic that changes state — and before any prior issue's fix has its effect verified — capture a baseline snapshot. This is the reference point that lets later phases distinguish "this fix's regression" from "prior fix's residual effect" or "pre-existing failure."

**Phase 2.0 is MANDATORY for all scopes (including LIGHT) and all session sizes (including single-issue sessions).** The "LIGHT: diagnostic tooling optional" exemption in Phase 2.1 does NOT apply to Phase 2.0 — this is regression-attribution infrastructure, not a diagnostic tool. Without a baseline, the PRE-EXISTING attribution at Phase 4.3 has no anchor and self-seals.

```
1. Capture full test suite count (project-specific command from PROJECT_PROFILE §H):
   - vitest: npx vitest run --reporter verbose 2>&1 > /tmp/baseline-N.txt
   - pytest: pytest --tb=no -q 2>&1 > /tmp/baseline-N.txt
   - cargo: cargo test 2>&1 > /tmp/baseline-N.txt
   Read the file and record: passed/failed/skipped counts in FIX-XXX.md Section 2.0.

2. Capture environment state hash:
   - Deployed code SHA (e.g., git rev-parse HEAD; or for cloud-deployed projects,
     the version stamp of the running deployment)
   - Test fixture state hash (sha256 of fixture data files, if applicable)
   - Config snapshot (hash of effective env vars + .env files)
   Record in FIX-XXX.md Section 2.0 as "baseline_hash: <combined sha>".

CHECKPOINT: FIX-XXX.md Section 2.0 = "Baseline at issue start: <test counts> + <hash>"
```

For the first issue in a session, this is the session's reference baseline.
For subsequent issues, also note the delta from the previous issue's start baseline — that delta is attributable to the previous issue's fix and any cleanup, not to the current issue.

At Phase 4, the validator references Section 2.0: any test count regression must be attributable to *this* fix (issue N) or, if attributable to issue N-1, becomes its own follow-up issue.

### 2.1 Diagnostic Toolbox

Use live tools based on issue type. **Actively prefer live tools over code reading.**

LIGHT: diagnostic tooling optional if root cause already confirmed (document skip reason).
STANDARD/DEEP: mandatory. For tool commands, see [toolbox.md](fix-issues/toolbox.md).

**CHECKPOINT: After EACH diagnostic run**, append to Section 2.7.

### 2.2 Diagnosis Decision Tree

```
Hypothesis confirmed?
├─ Yes → CHECKPOINT: Set status to DIAGNOSED. Proceed to GATE 1.
├─ Partially → Refine hypothesis, run more diagnostics (max 3 loops)
└─ No → Reformulate hypothesis (max 3 loops)
    └─ Exhausted → ESCALATE: set BLOCKED, present evidence to human,
       continue other QUEUED issues while waiting
```

### 2.3 Update Session File

CHECKPOINT: Update Section 2 with confirmed root cause, Section 1 Root Cause column. Set status to DIAGNOSED.

### 2.4 Pre-Fix Validation

Before writing code, validate the fix strategy with fresh subagents.

LIGHT: 1 validator subagent. STANDARD: 2 subagents. DEEP: 4 subagents.
For subagent prompt templates, see [validation-templates.md](fix-issues/validation-templates.md).

CHECKPOINT: Write results to Section 2.8 "Pre-Fix Validation".
If CONCERNS → adjust strategy, CHECKPOINT updated strategy to Section 2.6.

---

## GATE 1: Investigation → Fix

**Step 1**: Write `GATE 1 PASSED` to FIX-XXX.md Section 2 for this issue.

**Step 2**: Run the gate-check script via Bash. This is MANDATORY — hook output alone is NOT sufficient.
```
node ~/.claude/skills/fix-issues/project-setup/scripts/check-fix-gate.cjs <session-dir> 1 <FIX-ID>
```
**If FAIL** → fix every failing check, re-run until PASS.
**If PASS** → proceed to Phase 3.

---

## LIGHT Scope — What Changes, What Doesn't

LIGHT CHANGES (fewer subagents):
- Phase 1: Only SUBAGENT_CODEBASE_EXPLORER (skip CONTEXT_READER + HISTORY_ANALYZER)
- Phase 1.3: Reproduction optional (document skip reason)
- Phase 2.1: Diagnostic tooling optional (document skip reason)
- Phase 2.4: 1 validator subagent instead of 2-4
- Phase 3.3 Step C: SKIP code quality review

LIGHT DOES NOT CHANGE (still mandatory):
- FIX-XXX.md Sections 2, 3, 4 MUST be populated; SESSION.md Section 5 MUST be populated
- Phase 3.3 Step A: Implementer subagent MUST be dispatched
- Phase 3.3 Step B: Spec compliance review MUST run
- Phase 4: Tests MUST run OR visual verification documented
- GATE 1, GATE 2, GATE 3 are MANDATORY for all scopes
- Regression test MUST exist (or documented visual verification for cosmetic fixes)

## PHASE 3: Fix (Per Issue)

**Goal**: Apply the minimal correct fix. Never over-engineer.

### 3.1 Business Rule Impact Check

Before writing code, check Section 2.2 (Business Rules):

```
□ Does this fix change any existing behavior? → If YES, identify what changes
□ Does the change conflict with a documented business rule? → If YES, STOP (see below)
□ Does the fix affect other features? → If YES, list and verify
□ Is this a regression fix? → If YES, simpler — restore the intent
□ Is the documented rule itself the bug? → If YES, prepare decision package

WHAT COUNTS AS BEHAVIOR CHANGE:
  YES (ASK): User-visible output changes, timing/threshold changes, default values
  NO (AUTONOMOUS): Regression fix, restoring documented value, error messages, logging, tests
```

If conflict found → prepare decision package: current state, problem, options A/B, recommendation. Set status to AWAITING_DECISION. Continue other issues while waiting.

### 3.2 Implementer Constraints

These rules are passed to the implementer subagent:

1. Minimal fix — change only what's necessary
2. Follow existing patterns — match surrounding code style
3. Never add features while fixing bugs
4. Never refactor while fixing (unless refactor IS the fix)
5. Add regression test (MANDATORY — absolute rule #6)
6. Commit after each logical fix (use git conventions)
7. NEVER push to remote
8. If git commit fails (pre-commit hook), fix issue, re-stage, NEW commit
9. If fix changes a value in CLAUDE.md, update CLAUDE.md in same commit
10. One commit per issue — never bundle multiple FIX issues in a single commit, even in LIGHT batches
11. Never instruct subagents to pipe test output through `tail`/`head`/`grep` — use file redirect + Grep tool pattern from Phase 4.1

### 3.2.1 Fix Type — PROPER vs PROVISIONAL

Some fixes are deliberate workarounds, not root-cause solutions. Mark these explicitly so the framework can track the proper-fix follow-up:

```
fix_type: PROPER (default)
  Addresses the root cause from Section 2.6 directly. No follow-up issue required.

fix_type: PROVISIONAL
  Deliberate band-aid that unblocks the user but does NOT address the root cause.
  The proper fix is deferred to a future session.
  Examples: excluding a file type from a code path because the path doesn't yet
  handle it; suppressing an error to unblock; hard-coding a value pending a
  proper config mechanism.

  When marking fix_type: PROVISIONAL at Phase 3, the implementer MUST also write
  to FIX-XXX.md Section 3 (in addition to fix description):

    PROVISIONAL_PROPER_FIX_REQUIRED: <one-sentence description of what the proper fix entails>

  This is a literal token. Phase 5 grep's for it; presence blocks the session
  from "Complete" status until either:
    (a) a follow-up FIX-XXX-PROPER issue is registered in this same session, OR
    (b) an entry exists in <project-root>/.claude/DEFERRED_FIXES.md describing
        the proper fix scope and acceptance criteria.

  PROVISIONAL fixes pass Gate 3 with status DEFERRED-PROPER (not VERIFIED).
  The user/team must take action; the skill cannot self-resolve a band-aid into
  a proper fix.
```

**Why this matters**: a band-aid VERIFIED with the same gates as a root-cause fix is the FM-6 failure mode (V-007 9-hour band-aid → proper fix cycle in the forensic record). The token + Phase 5 scan + DEFERRED_FIXES.md persistence prevents the band-aid from silently shipping as if it were the proper fix.

### 3.3 Implement the Fix

**Step A — Dispatch implementer subagent:**

Invoke: Agent tool, subagent_type=general-purpose
Description: "Fix FIX-XXX: [brief description]"
Prompt: Include ALL of: fix strategy from Section 3 + root cause from Section 2.6 +
  affected files from Section 2.1 + implementer constraints from 3.2 +
  pre-fix validation concerns from Section 2.8

If the fix is intended as a band-aid (fix_type: PROVISIONAL), the implementer prompt
MUST also include this verbatim instruction:
  "This fix is PROVISIONAL. Write the literal string
   `PROVISIONAL_PROPER_FIX_REQUIRED: <one-sentence description of the proper fix>`
   on its own line in Section 3 of FIX-XXX.md. Do not paraphrase. Do not use synonyms.
   The grep at Phase 5.0.5 matches the exact token; paraphrase bypasses it silently."

The implementer MUST: apply changes, write regression test, run tests, commit, report back.
Do NOT edit files yourself. The subagent implements, tests, and commits.

CHECKPOINT: After implementer reports → update Section 3 with files changed + tests added + **"Implementer: Dispatched subagent..."** line (GATE 2 checks for dispatch evidence). Status → FIXING.

**Step B — Dispatch spec compliance reviewer (SEPARATE subagent, NOT self-assessed):**

Invoke: Agent tool, subagent_type=general-purpose
Description: "Review spec compliance for FIX-XXX"
Prompt: Include fix strategy + implementer's report + "Check: regression test added? Root cause fixed (not symptom)? Business rules followed?"

Output: ✅ Spec compliant OR ❌ Issues found with file:line references
If ❌ → resume implementer. Max 2 cycles. Writing "Verified" yourself is NOT Step B.

**Step C — Code quality review (STANDARD+ only):**

Invoke: Skill tool, skill="superpowers:requesting-code-review"

Get BASE_SHA (before fix) and HEAD_SHA (after fix).
Follow that skill — it dispatches a code-reviewer subagent (Agent tool,
subagent_type=general-purpose, filling its bundled `code-reviewer.md` template).
There is no `superpowers:code-reviewer` agent type; the role is the prompt template,
run by a general-purpose agent. Pass BASE_SHA, HEAD_SHA, and the fix description.
Act on feedback: Critical/Important → implementer fixes. Minor → note in Section 3. Max 2 cycles.

LIGHT scope: Document skip in Section 3: "Code quality review skipped (LIGHT scope)."

### 3.4 Update Session File

CHECKPOINT after implementation + review:
1. Section 3: files changed, tests added, spec review result, code review result, commit hash
2. Section 1: Fix Commit column
3. Status → FIXED
4. TaskUpdate({ activeForm: "FIX-XXX fixed, verifying" })

---

## GATE 2: Fix → Verify

**Step 1**: Write `GATE 2 PASSED` to FIX-XXX.md Section 3 for this issue.

**Step 2**: Run the gate-check script via Bash. This is MANDATORY — hook output alone is NOT sufficient.
```
node ~/.claude/skills/fix-issues/project-setup/scripts/check-fix-gate.cjs <session-dir> 2 <FIX-ID>
```
**If FAIL** → fix every failing check, re-run until PASS.
**If PASS** → proceed to Phase 4.

---

## PHASE 4: Verify (Per Issue)

**Goal**: PROVE the fix works with external evidence appropriate to the universal properties detected at Phase 1.4. Code reading is hypothesis, not proof.

**Entry**: Issue status should be FIXED. FIX-XXX.md Section 2.5 (Universal Properties) is populated.

### 4.1 Property-Driven Validator Dispatch

The validator dispatched here is bounded by the FIX'S blast radius (which properties fired yes), not by codebase size. No baseline-and-diff against captured snapshots — instead, observation + reasoning by a subagent against Phase 1's stated intent.

```
1. Read FIX-XXX.md Section 2.5 → collect the set of yes properties.

2. Look up required verdicts in #verdict-required-at-gate-3 (compose all that apply).

3. For each yes property:
   a. Read PROJECT_PROFILE.md Section H to find available tools mapped to this property.
   b. Identify the strongest available tool (top of list) AND all other available tools.
   c. Dispatch a validator subagent with:
      - The fix's INTENT (from Phase 1 Section 2.6: what should happen now)
      - The bug's SYMPTOM (from Phase 1 Section 2.6: what was wrong before)
      - The SPECIFIC scope (changed files from 2.1, ripple targets from 2.5/P9)
      - The selected tools and their commands
      - INSTRUCTION: walk the fix's specific scenario; observe; reason against intent;
        report PASS or specific concrete contradictions.

4. Run validators in parallel where independent, sequentially where one's output gates the next.
   Multiple tools per property → cross-check (see toolbox-strategies.md "Cross-check pairs").

5. Reconcile per property (mechanical, not by judgment):
   - All tools agree PASS for property → property verdict PASS.
   - Any tool reports contradiction → property verdict FAIL with specific contradiction.
   - Tools disagree (one PASS, one FAIL) → INCONSISTENCY finding (treat as FAIL).
     Do NOT reason about which tool is "correct". Do NOT dismiss tool B as flaky/wrong.
     The disagreement IS the finding. Feed it to Phase 3 as new diagnostic input.
   - No tool available for the property → LIMITED-VERIFIED for that property
     (auto-create FIX-VALIDATION-GAP-XXX issue describing the missing tool).

6. Run validators in parallel where independent. Two tools are independent if they
   observe DIFFERENT evidence channels (e.g., S2 observes in-memory state; S13 observes
   persisted state — different channels). Sequential dispatch is permitted ONLY when
   tool B genuinely requires tool A's output as input (e.g., a HAR trace drives a log
   assertion query). "Tool A's output makes tool B's output predictable" is NOT a
   dependency — tool B must still run.

7. Compose overall verdict from per-property verdicts:
   - All PASS → VERIFIED with evidence type per profile §H
     (tag as MOCK-VERIFIED if no live-required property fired; otherwise LIVE-VERIFIED)
   - Any FAIL → auto-loop to Phase 3 with the failure as new diagnostic input (max 3 loops)
   - Any LIMITED-VERIFIED → overall LIMITED-VERIFIED with property gaps listed
   - Investigation indicated a profile §I capability-boundary category → OUT_OF_BAND_VERIFICATION_REQUIRED
     (skill never silently downgrades to VERIFIED for these — see the Capability Boundary section)

OUTPUT RULE (applies to all subagent + test invocations):
  □ NEVER pipe test commands through tail/head/grep — truncated output hides failures.
  □ Redirect to file, then read with Read tool or Grep tool with explicit patterns.
    Example: npx vitest run --reporter verbose 2>&1 > /tmp/claude/vitest-out.txt
             Grep: pattern="FAIL|Error|✗" path="/tmp/claude/vitest-out.txt"
```

CHECKPOINT: After validator subagent(s) return, append to FIX-XXX.md Section 4 a
per-property verdict TABLE (Gate 3 parses this table, not a bullet list — it must
have `Property` and `Verdict` column headers and one row per `yes` property):
```
| Property | Verdict | Tools | Evidence |
|----------|---------|-------|----------|
| P{X} | PASS / FAIL / LIMITED-VERIFIED | <tools> | <evidence summary or contradiction> |

**Composed verdict**: MOCK-VERIFIED | LIVE-VERIFIED | LIMITED-VERIFIED | OUT_OF_BAND_VERIFICATION_REQUIRED
Tools used: <list>
Cross-check disagreements: <list or "none">
```

### 4.2 Verification Results

| Composed verdict | Action |
|---|---|
| MOCK-VERIFIED or LIVE-VERIFIED, all PASS, fix_type=PROPER | Proceed to Phase 4.3 |
| MOCK-VERIFIED or LIVE-VERIFIED, all PASS, fix_type=PROVISIONAL | Composed verdict is `LIVE-VERIFIED + DEFERRED-PROPER` (or `MOCK-VERIFIED + DEFERRED-PROPER`). Proceed to Phase 4.3, but Gate 3 stamps DEFERRED-PROPER instead of VERIFIED. Phase 5.0.5 PROVISIONAL token scan must find a follow-up registration |
| Any FAIL | Auto-loop to Phase 3 with the contradiction as new diagnosis input. Max 3 loops; if still failing, status → BLOCKED-NEEDS-DESIGN, continue next issue |
| LIMITED-VERIFIED | Proceed; FIX-VALIDATION-GAP-XXX is in the queue |
| OUT_OF_BAND_VERIFICATION_REQUIRED | Status → DEFERRED with reason; surface in Phase 5 executive summary; continue next issue |

Multiple `yes` properties compose. The composed verdict is the **most conservative** across all per-property verdicts:

- LIMITED-VERIFIED for any property → composed = LIMITED-VERIFIED.
- OUT_OF_BAND_VERIFICATION_REQUIRED for any property → composed = OUT_OF_BAND.
- All per-property verdicts PASS, AND any of P1/P2a/P2b/P3/P5 fired yes → composed = LIVE-VERIFIED. Each LIVE-required property must have at least one live-tool invocation evidenced in Section 4.
- All per-property verdicts PASS, AND no LIVE-required property fired → composed = MOCK-VERIFIED.

"LIVE-VERIFIED" is a CLAIM about evidence, not a STATUS earned by passing other tools — i.e., a P9 PASS via type checker does NOT inherit the LIVE-VERIFIED stamp from a P3 PASS via persistence-layer query. Each property's evidence must independently satisfy the verdict it requires.

### 4.3 Cross-Issue Regression Attribution + Next Issue

Re-run the full test suite. Compare to FIX-XXX.md Section 2.0 (baseline captured at this issue's start):

```
Delta = post_fix_counts − baseline_counts (Section 2.0)

If Delta is favorable (more passing, no new failures) → no regression; proceed.

If Delta shows new failures:
  For each new failure, attribute to:
    - THIS fix (issue N): the failure is in a file/area touched by this fix's diff,
      OR is in a test that exercises the property the fix changed.
      → Loop back to Phase 3 (counts against the 3-loop limit).
    - PRIOR fix (issue N-1, N-2, ...): the failure is in a file touched by an earlier
      fix in this session AND not by this fix.
      → File a new issue (FIX-XXX with reference to the responsible prior fix).
        Continue this issue's verdict; the new issue enters the pipeline.
    - PRE-EXISTING: the failure was already failing in baseline_N (Section 2.0
      shows the same failure) AND Section 2.0's `baseline_hash` matches
      `git rev-parse HEAD~<n>` where n = number of fixes applied in this session.
      The hash check is required — without it, the baseline could have been
      captured AFTER an earlier fix was applied and the regression would
      self-seal as PRE-EXISTING.
      → Note in Section 4 with explicit hash citation; not a regression of
        this fix; not a new issue unless Phase 5 final review decides otherwise.
      → If `baseline_hash` does NOT match the session-start commit, treat the
        baseline as TAINTED and re-attribute the failure to the most recent fix.
  
  Record attribution in FIX-XXX.md Section 4 with one-line justification per failure.
```

After regression attribution: check if THIS fix incidentally resolved the next QUEUED issue (re-read its description against the diff). If yes, mark the next issue VERIFIED-BY-PRECEDING-FIX with cross-reference; skip its Phase 1-3 (Phase 4.1 still runs to confirm via property-driven validator).

### 4.4 Update Session File

CHECKPOINT: Section 4 (commands + results + final status), Section 1 (status + Root Cause/Fix Commit), Executive Summary counts. IF IMPORTED: Bidirectional Update Protocol — see [import-protocol.md](fix-issues/import-protocol.md).

---

## GATE 3: Verify → VERIFIED

**Step 1**: Write verification results to FIX-XXX.md Section 4 (per-property verdicts + composed verdict + tools used + cross-check disagreements per Phase 4.1 CHECKPOINT format). Write `GATE 3 PASSED` as the last line.

**Step 2**: Run the gate-check script via Bash. This is MANDATORY — writing the marker (Step 1) without running the script (Step 2) is a pipeline violation.
```
node ~/.claude/skills/fix-issues/project-setup/scripts/check-fix-gate.cjs <session-dir> 3 <FIX-ID>
```
**If FAIL** → fix every failing check, re-run until PASS.
**If PASS** → continue to Step 3.

**Step 3 — Property-verdict assertion** (MANDATORY — enforced by script v2):

The `check-fix-gate.cjs` script (v2+) parses Section 2.5 yes properties and Section 4 per-property verdicts mechanically and FAILs Gate 3 when any of the assertions below are violated. The agent MUST also walk through them manually before invoking the script — the script catches the gross violations but the agent's read confirms evidence quality.

Read FIX-XXX.md Section 2.5 (yes properties) and Section 4 (composed verdict + per-property verdicts). Verify mechanically (not by judgment):

```
For each yes property in Section 2.5:
  Verify Section 4 records a per-property verdict (PASS / FAIL / LIMITED-VERIFIED).
  If a property fired yes at Phase 1.4 but has NO entry in Section 4 → ASSERTION FAIL.

Verify the composed verdict matches what's required by the verdict table:
  If any of P1, P2a, P2b, P3, P5 was yes → composed verdict must be LIVE-VERIFIED or stronger.
  If P4 was yes → composed verdict must include identity-switching evidence in Section 4.
  If P12 was yes → composed verdict must include real-server invocation evidence (not mock-only).
  Etc. per the full verdict table.

If composed verdict is LIMITED-VERIFIED → verify FIX-VALIDATION-GAP-XXX exists in the issue registry.
If composed verdict is OUT_OF_BAND_VERIFICATION_REQUIRED → verify the §I capability-boundary
  category is named explicitly in Section 4.
If FIX-XXX.md Section 3 contains `PROVISIONAL_PROPER_FIX_REQUIRED:` → verify composed
  verdict ends in `+ DEFERRED-PROPER` (e.g., `LIVE-VERIFIED + DEFERRED-PROPER`), NOT
  plain `LIVE-VERIFIED`. The DEFERRED-PROPER suffix is mandatory for PROVISIONAL fixes.
```

**If any assertion fails — what you MUST do:**

1. Identify the missing per-property evidence. The per-property entry MUST cite an actual tool invocation that produced output (a `Bash` call, a subagent dispatch, an MCP tool call). "Code reading" or "I reasoned about it" is not evidence.

2. Run the missing validators. Fetch the tools listed for that property in PROJECT_PROFILE §H. Dispatch them. Append their outputs to FIX-XXX.md Section 4 with the actual command and observed output.

3. Verdict demotion to LIMITED-VERIFIED is permitted ONLY when PROJECT_PROFILE §H is empty for that property (no tool exists in this project). If §H lists a tool and it was not run, you MUST run it. "I think the tool would say PASS" is not running it. Demoting the verdict because running the tool is inconvenient is a pipeline violation — log the violation and run the tool.

4. Once Section 4 has actual tool outputs for every yes property, re-run the assertion. If now passing → continue to Step 4.

**Script v2 enforcement** (active as of skill v4.1): `check-fix-gate.cjs` now performs five mechanical assertions:

1. **Section 2.5 populated**: every fix has a Universal Properties table with P1–P13 answered yes/no. Empty table → FAIL.
2. **Per-property verdict coverage**: every yes property in Section 2.5 has a corresponding row in Section 4's per-property verdicts table. Missing → FAIL.
3. **Composed verdict matches yes properties**: if P1/P2a/P2b/P3/P5 fired yes, composed verdict must be `LIVE-VERIFIED`, `LIMITED-VERIFIED`, or `OUT_OF_BAND_VERIFICATION_REQUIRED`. `MOCK-VERIFIED` → FAIL with the rationalization warning.
4. **Live-tool evidence per LIVE-required PASS**: for each LIVE-required property whose verdict = PASS, `tools used` or `evidence` must cite at least one live keyword (Playwright, clasp run, GCP log, BigQuery, live walk, screenshot, side-channel, integration test, etc.). Mock-only evidence → FAIL with explicit "demote to LIMITED-VERIFIED" guidance.
5. **PROVISIONAL DEFERRED-PROPER suffix**: if Section 3 contains the literal `PROVISIONAL_PROPER_FIX_REQUIRED:` token, composed verdict must end in `+ DEFERRED-PROPER`. Missing → FAIL.

These five assertions close the gap that allowed the FIX-001 session (2026-05-04 in the as-add-on repo) to stamp MOCK-VERIFIED with code-reading evidence despite P1/P2a/P3/P5 firing yes. The script will now block that path mechanically.

**For batched issues**: Run the script AND the property-verdict assertion SEPARATELY for EACH issue. One batch-wide test run does not substitute for per-issue gate checks. Example for a 3-issue batch:
```
node ~/.claude/skills/fix-issues/project-setup/scripts/check-fix-gate.cjs <session-dir> 3 FIX-001
# (then property-verdict assertion for FIX-001 manually)
node ~/.claude/skills/fix-issues/project-setup/scripts/check-fix-gate.cjs <session-dir> 3 FIX-002
# (then property-verdict assertion for FIX-002 manually)
...
```

**Step 4**: Update FIX-XXX.md header `> **Status**: VERIFIED` — OR `DEFERRED-PROPER` if the issue had `PROVISIONAL_PROPER_FIX_REQUIRED` in Section 3.

**Step 5**: Update SESSION.md — issue row status → VERIFIED (or DEFERRED-PROPER), Executive Summary counts, Current Issue → next QUEUED issue.

**Step 6**: Apply context hygiene (see Between-Issue Context Hygiene section), then start Phase 1 for the next QUEUED issue. If no QUEUED issues remain, proceed to Phase 5 wrap-up.

### Script Says FAIL — What You MUST Do

The gate-check script is non-negotiable. If it says FAIL:
1. Read EVERY failing check in the output
2. Fix EACH one by updating the session file or adding missing artifacts
3. Re-run the script until it says PASS
4. Do NOT proceed to the next phase while any gate shows FAIL

**You cannot rationalize past a FAIL.** "The script is wrong" is not a valid reason to skip — if you believe a check is incorrect, fix the session file to make the check pass, not the other way around.

### Deferring or Blocking an Issue

When an issue cannot be completed (infrastructure dependency, out-of-scope, needs human decision):

1. **Header**: Update `> **Status**: DEFERRED` or `> **Status**: BLOCKED` in FIX-XXX.md
2. **Section 3 (Fix Applied)**: Write `DEFERRED — [reason]` or `BLOCKED — [reason]` (e.g., "DEFERRED — requires backend API change outside add-on scope")
3. **Section 4 (Verification)**: Write `N/A — issue deferred` or `N/A — issue blocked`
4. **SESSION.md**: Update issue row status and Executive Summary counts
5. **Move on**: Start next QUEUED issue (Phase 1). Do NOT wait for user input.

Do NOT leave Sections 3-4 empty — empty sections cause gate-check failures on future resumption and make session state ambiguous after context compaction.

---

## Between-Issue Context Hygiene

After completing a DEEP or STANDARD issue — or after context compaction — your context window carries investigation details, code snippets, and subagent outputs that are now redundant — all persisted to FIX files and SESSION.md.

**Rules for starting the next issue:**
1. Re-read SESSION.md registry (root causes, affected files) to spot cross-issue overlaps with the next issue
2. If the next issue touches files modified by a prior fix, re-read that FIX file's Section 2.1 (Affected Files) and Section 3 (Fix Applied)
3. Do NOT re-read prior FIX files "just in case" — only when the registry shows a file overlap
4. Do NOT reference prior issue investigation details in subsequent messages — if you need them, read the file

**Why this matters**: Carrying stale context wastes tokens, accelerates compaction, and increases the chance of compaction hitting mid-investigation on the next issue. The files are your memory, not the context window.

---

## PHASE 5: Wrap Up (After All Issues)

If ALL issues are BLOCKED/AWAITING_DECISION → present consolidated status, wait for human.

Otherwise:

### 5.0 Final Review (MANDATORY)

Per-issue gates verify individual correctness. This step verifies the **full set of changes works together** and makes sense for the project. It is a senior-level review, not a mechanical diff check.

**Step A — Build the review context**:

Get the combined diff of all fix commits against the session baseline:
```bash
git diff <first-fix-commit>~1..HEAD --stat
git diff <first-fix-commit>~1..HEAD
```

**Step B — Dispatch reviewer subagent**:

Agent tool, subagent_type=general-purpose
Description: "Final review: validate all session fixes for correctness, conflicts, and project impact"
Prompt must include: the full commit list (SESSION.md Section 5), the combined diff stat, and the issue registry (Section 1). Instruct:

```
You are reviewing the COMPLETE set of fixes from a bug-fixing session.
Read each commit diff with `git show <hash>`. Then evaluate:

PER-ISSUE VALIDATION (for each FIX):
1. Does the fix actually solve the stated problem? Read the root cause
   and the diff — does the code change address that root cause, or just
   mask the symptom?
2. Is the fix minimal and complete? Any missing edge cases, missing
   cleanup (e.g., timers not cleared on unmount, listeners not removed),
   or unnecessary additions?
3. Are changes in the right commit? Flag any code that belongs to a
   different FIX issue (misplaced during batch processing).

CROSS-ISSUE ANALYSIS:
4. Do any fixes conflict with each other? (e.g., two fixes changing the
   same component behavior in contradictory ways, competing state updates,
   overlapping CSS selectors)
5. Do the fixes create unintended interactions? (e.g., fix A adds a
   debounce that breaks fix B's immediate state update assumption)
6. Are there shared files modified by multiple fixes? Read the final
   state of those files — does the combined result make sense?

PROJECT IMPACT:
7. Do these fixes change any documented behavior or business rules?
   Check against CLAUDE.md and any referenced design docs.
8. Are there performance implications? (new timers, new queries,
   new event listeners multiplied across components)
9. Could any fix cause regressions in areas NOT covered by the
   regression tests added? What would you test manually?

Report:
- For each issue: PASS or ISSUE with description + suggested fix
- Cross-issue: CLEAN or CONFLICT with description
- Project impact: NONE or CONCERN with description
```

**Step C — Act on findings**:

| Finding | Action |
|---------|--------|
| PASS / CLEAN / NONE | Note "Final review: CLEAN" in SESSION.md Section 7 |
| ISSUE (code quality) | Fix with additional commit, update Section 5 + 7 |
| CONFLICT (cross-issue) | Resolve the conflict, test both fixes together |
| CONCERN (project impact) | Document in Section 7 as recommendation for human review |

### 5.0.5 Token Scan — PROVISIONAL + OUT_OF_BAND deferrals

Before finalizing, scan the session directory for two machine-readable tokens that block "Complete" status:

```
1. PROVISIONAL_PROPER_FIX_REQUIRED:
   grep -rn "PROVISIONAL_PROPER_FIX_REQUIRED" <session-dir>/

   Read deferred-tracking locations from PROJECT_PROFILE.md `deferred_fixes_locations`
   (top-level YAML list of paths relative to project root). If the profile is missing
   or doesn't define this field, default to `[".claude/DEFERRED_FIXES.md"]`.

   For each PROVISIONAL_PROPER_FIX_REQUIRED match in the session:
     Verify EITHER:
       (a) A follow-up FIX-XXX-PROPER issue exists in this session's registry, OR
       (b) An entry exists in ANY of the configured deferred-tracking locations
           with all of:
           - issue_id (the original FIX-XXX)
           - description matching the PROVISIONAL_PROPER_FIX_REQUIRED text
           - acceptance_criteria
           - target_session (when proper fix should land)

   If NEITHER (a) NOR (b) exists for any match → BLOCK finalization.
   Either register the follow-up issue OR add an entry to one of the configured
   locations before continuing. The session cannot finalize as "Complete" with
   a band-aid that has no follow-up tracking.

   Common project conventions:
   - Default: `.claude/DEFERRED_FIXES.md`
   - Sheetgo projects: `docs/deferred-items.md` (canonical "Future Improvements"
     file; pre-existing convention)
   - Linear/Jira-integrated projects: tracker-issue link in `.claude/DEFERRED_FIXES.md`
     pointing at an external issue, with the four required fields embedded

2. OUT_OF_BAND_VERIFICATION_REQUIRED:
   grep -rn "OUT_OF_BAND_VERIFICATION_REQUIRED" <session-dir>/

   For each match, surface in SESSION.md Section 7 with:
     - The issue ID
     - The category (security, supply chain, p99 load, memory, concurrency, crypto,
       DR, email, regulatory, third-party-API)
     - The recommended workflow per PROJECT_PROFILE.md §I.<category>

   These do NOT block finalization (they were correctly classified as out of scope),
   but the executive summary MUST list them so a human takes action.
```

CHECKPOINT: SESSION.md header includes a "Deferrals scan: <N> PROVISIONAL with follow-up registered, <M> OUT_OF_BAND surfaced for human review" line.

### 5.1 Finalize Session

```
CHECKPOINT (final):
  1. Update Executive Summary (all metric counts; including separate counts for
     VERIFIED, DEFERRED-PROPER, OUT_OF_BAND, BLOCKED-NEEDS-DESIGN)
  2. Overall Status → "Complete" (or "Partial — N deferred/blocked")
     "Complete" requires zero unresolved PROVISIONAL_PROPER_FIX_REQUIRED tokens
     (per Section 5.0.5 above).
  3. Current Issue → "-"
  4. SESSION.md Section 5 (Commits Made): all commits with hash, message, files
  5. SESSION.md Section 7 (Recommendations): final review results + OUT_OF_BAND
     items surfaced from token scan + tooling-gap issues opened
  6. Check Sign-off boxes
  7. Merge FIX files into SESSION.md (see Section 5.2 below)
  8. Stage the ENTIRE session directory: `git add <session-dir>/` (captures both updated SESSION.md AND deleted FIX files)
  9. Final commit (single SESSION.md, no FIX-XXX.md files)
  10. Output: <promise>FIX-SESSION COMPLETE</promise> (signals Ralph Loop to stop, if active)
```

### 5.2 Merge FIX Files into SESSION.md

After sign-off, merge all FIX-XXX.md content into SESSION.md for archival. This reduces the session from N+1 files to 1 file with zero data loss.

```bash
node ~/.claude/skills/fix-issues/project-setup/scripts/merge-fix-session.cjs <session-dir>
```

The script:
- Reads all FIX-XXX.md files in order
- Appends them as an "Issue Details" section in SESSION.md (headings demoted)
- Removes the individual FIX files

Options: `--dry-run` (preview), `--keep` (don't delete FIX files)

**IMPORTANT**: Run this AFTER all gates pass and sign-off is complete. During the session, FIX files must remain separate (gate-check reads them individually).

---

## Start Command

1. Create session directory from template
2. Register issues (from user input or test-audit import)
3. Pick first QUEUED issue → Scope → Phase 1 → 2 → GATE 1 → 3 → GATE 2 → 4 → GATE 3
4. Pick next QUEUED issue → repeat step 3
5. Phase 5: Final Review (audit all commits holistically) → Finalize → Merge → Commit

**SEQUENTIAL PIPELINE**: Process ONE issue through ALL phases before touching the next.
Do NOT investigate multiple issues before fixing any — "investigate all, then fix all" is PROHIBITED.
Current issue must reach VERIFIED, DEFERRED, or BLOCKED before starting the next.

### LIGHT Batching
LIGHT-scope issues may be processed in batches of up to 3:
- Stage-by-stage: investigate all in batch → GATE 1 each → fix all → GATE 2 each → verify all → GATE 3 each.
- Never skip stages: investigating and fixing in one pass is still prohibited.
- Max 3 per batch: split larger groups. The gate-check script enforces this.
- STANDARD/DEEP: always sequential (no batching).
- Processing order: STANDARD/DEEP first (sequential), then LIGHT in batches.
- Write `GATE N PASSED [batch]` (not plain `GATE N PASSED`) for batched issues so the hook validates batch rules.
- Mixing LIGHT with STANDARD/DEEP in a batch is a pipeline violation.
- **Commits must be serialized**: after all batch implementers return, commit each issue's changes ONE AT A TIME. If two issues modify the same file, stage only that issue's specific changes per commit. Never let parallel subagent edits produce a shared commit.

**Read each phase section for instructions. Do NOT improvise from this summary.**

BEGIN EXECUTION

---

## Critical Reminders

1. **CHECKPOINT EVERY STATUS CHANGE** — session file + TaskUpdate at every transition
2. **INVESTIGATE FIRST** — never fix without understanding
3. **PROVE IT WORKS** — external evidence, not code reading. Screenshots for UI changes.
4. **PRESERVE INTENT** — never change what a feature does, only fix HOW
5. **MINIMAL CHANGES** — fix the bug, nothing more. NEVER PUSH.
6. **RE-READ AFTER COMPACTION** — SESSION.md + current FIX-XXX.md are your memory, trust only the files
7. **DISPATCH SUBAGENTS** — Phase 3 Steps A+B+C use the Agent tool. Do NOT edit files yourself.
8. **READ TEST OUTPUT** — use Read tool, never `tail`/`head`/`grep` on test commands. Truncated output hides failures.
9. **PASS THE GATES** — all 3 gates mandatory. For EACH gate, run check-fix-gate.cjs via Bash (the Edit hook also fires, but hook output alone is NOT sufficient — run the script per the gate procedure). FAIL = fix before proceeding.
