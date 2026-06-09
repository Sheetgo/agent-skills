# Project Profile — fix-issues Skill

> **Generated**: [WILL BE AUTO-FILLED]
> **Schema version**: 1.1
> **Last verified**: [WILL BE AUTO-FILLED]
> **Profile integrity**: [VERIFIED | UNVERIFIED — sections marked stale]
> **Lives at**: `<project-root>/.claude/PROJECT_PROFILE.md` (per-project artifact)

This file is the bridge between the universal `fix-issues` skill and project-specific surfaces. Read at every session start; integrity-checked; auto-rebuilt on drift.

## Top-level configuration

```yaml
# Locations Phase 5.0.5 PROVISIONAL_PROPER_FIX_REQUIRED scan should accept as
# tracking destinations for deferred follow-up work. Paths relative to project root.
# Default if absent: [".claude/DEFERRED_FIXES.md"].
# Configure ALTERNATIVE locations here when project convention puts deferred work
# elsewhere — e.g., a pre-existing docs/deferred-items.md file.
deferred_fixes_locations:
  - .claude/DEFERRED_FIXES.md
```

## How this file is used by the skill

| Phase | Sections read | Purpose |
|-------|--------------|---------|
| 0 (Init) | All | Verify integrity hashes; trigger rediscovery for stale sections |
| 1 (Investigate) | A, B, C, D | Map changed files to properties, journeys, consumers, rules |
| 2 (Diagnose) | F, G | Pre-fix scope check (fixture surfaces, business-rule docs) |
| 3 (Fix) | E | Mock-surface asymmetry detection (P12) |
| 4 (Verify) | H, I | Validator agent picks tools; checks capability boundary |
| 5 (Wrap up) | J | PROVISIONAL token scan + integrity refresh |

When a section is marked `UNVERIFIED` (hash mismatch), the validator that depends on it must re-discover the relevant subsection before proceeding. Do NOT assume; re-read.

---

## Section A — Languages & Runtimes

```yaml
languages:
  # Example: typescript: 5.4
  - name: ""
    version: ""
runtimes:
  # Example: apps_script (V8 engine), node 20, browser (chromium)
  - name: ""
    version: ""
test_framework:
  # Example: vitest 1.6, playwright 1.48
  - name: ""
    version: ""
build_tool:
  # Example: vite 5
  - name: ""
deploy_mechanism:
  # Example: npm run deploy (clasp push to AS), npm run release:prod
  command: ""
  target_envs:
    - dev: ""
    - staging: ""
    - prod: ""
```

---

## Section B — Universal Properties × Project Surfaces

For each universal property (P1–P13), list project-specific surfaces, detection patterns, and verification approach. Empty `surfaces` = property does not apply to this project.

### P1 — Boundary Crossing (I/O, network, DB, FS, external service)

```yaml
boundaries:
  # Each entry: a function or family of calls that crosses a process boundary
  - name: ""                  # human-readable label
    surface: []               # file paths or function names
    detection_pattern: ""     # regex or grep pattern to match in diff
    verification_method: ""   # how to observe real behavior across the boundary
```

### P2a — Code-Level Async (Promise/await/futures/coroutines)

```yaml
async_primitives:
  - name: ""                  # e.g., "Promise", "async/await", "asyncio.gather"
    detection_pattern: ""     # regex
    completion_inspection: "" # how to verify operation completed
```

### P2b — Platform-Deferred Mutation (batching, lazy eval, transaction commit)

```yaml
deferred_mutation_apis:
  # APIs whose return value does NOT prove the mutation reached external state
  - name: ""                  # e.g., "SpreadsheetApp.range.setValues", "Django ORM .save()"
    platform_doc: ""          # URL to platform docs describing flush semantics
    flush_call: ""            # explicit flush/commit invocation pattern
    side_channel_check: ""    # how to verify post-write external state
```

### P3 — Externally-Visible State Mutation

```yaml
state_mutation_surfaces:
  - name: ""
    storage_layer: ""         # DB, cache, file system, external API, persistent properties
    detection_pattern: ""
    inspection_method: ""     # how to read post-mutation state
```

### P4 — Authorization-Dependent

```yaml
auth_surfaces:
  - name: ""                  # e.g., "session.user", "request.identity"
    identity_types: []        # e.g., ["owner", "editor", "viewer", "service_account"]
    detection_pattern: ""
    identity_switching: ""    # how to test as different identity types
```

### P5 — Error Classification or Routing

```yaml
error_routing_surfaces:
  - name: ""
    files: []                 # patterns matching error/normalize/handler files
    error_codes: []           # known error codes/types in the project
    detection_pattern: ""
    deletion_detection: true  # P5 also fires on net-negative LOC in these files
```

### P6 — Cross-Layer Signaling

(see Section C — Cross-Layer Pairs)

### P7 — Single-Observation Diagnosis

(no project-specific surface; mechanism is investigation-output-driven)

### P8 — Journey Continuity

(see Section D — User Journeys)

### P9 — Component Ripple

```yaml
ripple_analysis:
  usage_analyzer:
    command: ""               # e.g., "npx ts-prune", "rust-analyzer references", "pyright references"
    threshold_n: 1            # N consumers ≥ this count → P9 yes
  pure_refactor_check: ""     # how to confirm refactored branch is reached in ≥1 consumer
```

### P10 — Business-Rule Semantics

(see Section G — Business Rule Documentation)

### P11 — Visual/Render Dependency

```yaml
visual_surfaces:
  - css_files: []
  - layout_props: []          # e.g., position, z-index, transform, display, visibility
  - dom_structure_props: []   # e.g., className changes, role changes
  visual_inspection_tool: ""  # e.g., Playwright screenshot + AX tree
```

### P12 — Mock-Surface Asymmetry

(see Section E — Mock Surface)

### P13 — Configuration-Only Change

```yaml
config_surfaces:
  env_files: []               # e.g., .env, .env.production
  build_config: []            # e.g., vite.config.ts, webpack.config.js
  ci_config: []               # e.g., .github/workflows/*
  infra_config: []            # e.g., Dockerfile, terraform/
  build_artifact_inspection: "" # how to verify config baked into output
```

---

## Section C — Cross-Layer Pairs

```yaml
layer_pairs:
  - emitter: ""               # e.g., "server", "backend"
    consumer: ""               # e.g., "client", "frontend"
    signal_types: []          # e.g., ["error_codes", "events", "state_updates"]
    emission_locations: []    # files/functions in emitter that produce signals
    consumption_locations: [] # files/functions in consumer that handle signals
    trace_check: ""           # how to verify a signal reaches and renders correctly
```

---

## Section D — User Journeys

```yaml
journeys:
  - name: ""                  # e.g., "wizard-create-automation", "checkout-purchase"
    description: ""           # short prose
    steps:
      - step_name: ""
        files: []
    alt_modes:
      - mode_name: ""         # e.g., "edit-mode", "draft-resume", "back-navigation"
        trigger: ""           # how user enters this mode
        files: []
    walk_command: ""          # how to replay journey end-to-end (e.g., specific Playwright spec)
    state_matrix:             # cross-state cells that must be verified per fix
      - state_name: ""
        observable_check: ""
```

---

## Section E — Mock Surface

```yaml
mock_surfaces:
  - file: ""                  # e.g., "client/src/lib/api/mocks/handlers.ts"
    handlers: []              # function names registered as mocks
    real_server_function: "" # corresponding production function
    routing_contract: ""      # description of how real server branches based on input
    asymmetry_risks: []       # known patterns where mock differs from real (catch P12)
honesty_test_file: ""         # e.g., handlers.honesty.test.ts that locks routing parity
```

---

## Section F — Test Fixture Surface

```yaml
fixtures:
  - file: ""
    helpers: []               # function names exported as fixture helpers
    api_calls: []             # external APIs called directly by these fixtures
    co_update_required_when: "" # when production change must propagate to fixture
```

---

## Section G — Business Rule Documentation

```yaml
rule_locations:
  claude_md_files: []         # CLAUDE.md files with documented behavior
  design_docs: []             # paths under docs/, design-docs/, etc.
  spec_files: []              # explicit specification files
  tagged_invariants:
    convention: ""            # e.g., "@invariant", "@business-rule" JSDoc tags
    files_using: []
known_invariants:
  # Quick-reference list of high-impact rules that easily drift
  - rule: ""                  # e.g., "filter_rows.condition.column stores letters not headers"
    location: ""              # where documented
    why_easy_to_drift: ""     # what makes this rule fragile
```

---

## Section H — Available Validation Tools

For each property, list tools from strongest (top) to fallback (bottom). Empty list = no tool available; falls back to `LIMITED-VERIFIED` for that property.

The validator dispatches the **strongest available** AND **all other available tools in parallel** for cross-checking. Disagreement between tools is itself a finding.

```yaml
tools:
  P1_boundary:
    - tool: ""                # e.g., "HAR_capture"
      command: ""
      output_format: ""
    - tool: ""
      command: ""
  P2a_code_async:
    - tool: ""
  P2b_platform_deferred:
    - tool: ""                # e.g., "Drive.Files.get_modifiedTime"
      command: ""
  P3_state_mutation:
    - tool: ""                # e.g., "store_snapshot_diff", "DB_query"
  P4_authorization:
    - tool: ""                # e.g., "persona_matrix_runner"
  P5_error_classification:
    - tool: ""                # e.g., "structured_log_assertion"
  P6_cross_layer:
    - tool: ""                # e.g., "contract_test_pact"
  P7_single_observation:
    - tool: ""                # e.g., "scenario_permutation_runner"
  P8_journey_continuity:
    - tool: ""                # e.g., "playwright_journey_walk"
  P9_component_ripple:
    - tool: ""                # e.g., "differential_test", "tsc_strict"
  P10_business_rule:
    - tool: ""                # e.g., "fast-check_property_test"
  P11_visual_render:
    - tool: ""                # e.g., "ax_tree_snapshot", "screenshot_reasoning"
  P12_mock_asymmetry:
    - tool: ""                # e.g., "honesty_test_runner"
  P13_config_only:
    - tool: ""                # e.g., "build_artifact_inspector"

cross_check_pairs:
  # Tools that complement each other when both available — agreement raises confidence,
  # disagreement is a finding.
  P1: [HAR_capture, log_inspection]
  P2a: [code_execution, state_snapshot_diff]
  P2b: [platform_docs_consultation, side_channel_check]
  P3: [state_diff, persistence_layer_query]
  P5: [error_log_assertion, ax_tree_snapshot]
  P6: [client_request_capture, server_log_assertion]
  P8: [journey_walk, ax_tree_snapshot]
  P9: [differential_testing, type_checker]
  P10: [property_based_test, business_rule_documentation]
  P11: [screenshot_reasoning, ax_tree_snapshot]
  P12: [real_server_invocation, mock_invocation]
  P13: [build_artifact_inspection, runtime_behavior_check]
```

---

## Section I — Capability Boundary

Issue categories that walk+observe+reason genuinely cannot verify. The skill emits `OUT_OF_BAND_VERIFICATION_REQUIRED` for these — never silently marks them VERIFIED.

```yaml
out_of_band_categories:
  security_vulnerability:
    applies_to_this_project: false
    designated_workflow: ""   # external security review process or tool
  supply_chain_audit:
    applies_to_this_project: false
    tool: ""                  # e.g., "npm audit", "pip-audit", "cargo-audit"
  performance_under_load:
    applies_to_this_project: false
    tool: ""                  # e.g., "k6 run", "locust"
  memory_leak_long_running:
    applies_to_this_project: false
    tool: ""                  # e.g., chrome heap snapshot diff over time
  concurrency_race_at_scale:
    applies_to_this_project: false
    tool: ""                  # e.g., stress test, jepsen-style harness
  crypto_token_expiry:
    applies_to_this_project: false
    tool: ""                  # e.g., time-jump fixture
  disaster_recovery_fault_tolerance:
    applies_to_this_project: false
    tool: ""                  # e.g., chaos engineering harness
  email_notification_side_effects:
    applies_to_this_project: false
    tool: ""                  # e.g., MailHog, captured webhook fixtures
  regulatory_compliance:
    applies_to_this_project: false
    workflow: ""              # GDPR/HIPAA/PCI/SOC2 review checklist
  third_party_api_drift:
    applies_to_this_project: false
    tool: ""                  # contract test, schema validation against live endpoint
```

When a fix's investigation indicates it falls into one of these categories, the skill writes
`OUT_OF_BAND_VERIFICATION_REQUIRED: <category>` to FIX-XXX.md Section 4 and advances to the next issue. Phase 5 surfaces all OUT_OF_BAND items in the executive summary for human follow-up.

---

## Section J — Profile Integrity

Hashes of files referenced by the profile. Verified at every session start; mismatch triggers re-discovery of the dependent section.

```yaml
integrity_hashes:
  - path: ""                  # file path referenced from sections B/C/D/E/F/G
    sha: ""                   # git blob SHA at last verification
    role: ""                  # which section depends on this file
    last_verified: ""         # ISO 8601 timestamp
```

Mismatch handling:
1. Mark dependent section `UNVERIFIED` in profile header.
2. Validator dispatched against an UNVERIFIED section runs in re-discovery mode (re-reads the file, updates the section, refreshes the hash) before proceeding.
3. If re-discovery fails (file deleted, unparseable), file an `OUT_OF_BAND` issue for human triage and degrade the section to `MISSING`.

---

## Auto-discovery

This profile is auto-generated on first use of the fix-issues skill in a project. When it
is missing, the skill dispatches a profiler subagent (see SKILL.md Phase 0.4) that:
- Reads `package.json` / `pyproject.toml` / `Cargo.toml` / `go.mod` to populate Section A
- Reads `CLAUDE.md` files and design docs to populate Section G
- Greps for known async primitives, error patterns, mock files to populate Section B/E/F
- Asks the agent to enumerate user journeys (interactive prompt or read from an existing journeys.md)
- Probes for installed validation tools (Playwright, vitest, fast-check, semgrep, etc.) to populate Section H
- Computes integrity hashes for all referenced files (Section J)

Empty sections are valid — they mean "this property/category does not apply to this project." The validator agent treats empty sections as no-op, not as missing data.
