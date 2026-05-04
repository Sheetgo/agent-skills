# fix-issues Toolbox — Universal Validation Strategies

> **Referenced from**: SKILL.md (Phase 4 validator agent dispatch)
> **When to read**: At Phase 4, when validator agent selects tools for each `yes` property
> **Project specifics**: see `<project-root>/.claude/PROJECT_PROFILE.md` Section H for which tools are available in THIS project

This file catalogs validation strategy CATEGORIES. Each strategy describes a kind of observation that is universal across languages and frameworks. The project profile maps each strategy to a concrete tool/command available locally.

---

## Selection rule

For each `yes` property, the validator agent:

1. Reads `PROJECT_PROFILE.md` Section H to find available tools mapped to the property.
2. Identifies the **strongest available tool** (top of list = strongest).
3. Identifies **all other available tools** for that property.
4. Dispatches the strongest + all others **in parallel**.
5. Reconciles outputs:
   - **Agreement** → high confidence; verdict PASS for that property.
   - **Disagreement** → automatic `INCONSISTENCY` finding; fed to Phase 3 as new diagnostic input. The disagreement itself is the signal.
6. If only one tool is available → stamp `LIMITED-VERIFIED` for that property and file a tooling-gap issue (see [When no tool is available](#when-no-tool-is-available) below).

Treat tool disagreement as a finding, not noise. Never suppress it. Example: screenshot reasoning "looks fine" while AX tree reports `role=alert` is missing → real bug, not false positive. Feed the disagreement back to Phase 3 as new diagnostic input.

---

## Strategy catalog

### S1 — HAR Network Capture + Contract Diff

| | |
|---|---|
| Observation | Full HTTP request/response waterfall: timing, headers, payloads |
| Triggers | P1 (boundary crossing), P5 (error classification), P6 (cross-layer) — fixes touching client→server contract |
| Autonomous invocation | `page.on('request'/'response', ...)` in Playwright; or `playwright --save-har=trace.har`; diff response shapes against expected schema |
| Catches | Response envelope drift (success status but payload schema changed); error code emitted at server but consumed wrongly by client |
| Caveats | HAR files large in multi-step flows; auth tokens must be scrubbed; non-HTTP IPC (postMessage, IPC sockets, GAS RPC) needs different capture |

### S2 — State Snapshot Diff (store/Redux/Zustand/in-memory)

| | |
|---|---|
| Observation | Serialized state tree before and after a user action, line-diffed |
| Triggers | P3 (state mutation), P9 (component ripple) — fixes that change derived values or write paths |
| Autonomous invocation | `page.evaluate(() => useStore.getState())` at before/after checkpoints; diff JSON programmatically |
| Catches | Stale derived state in sibling slices; correctly-updated primary slice with stale cache downstream |
| Caveats | Requires exposing store on `window` in test builds; non-serializable values (Promises, functions) must be stripped |

### S3 — Mutation Testing (Stryker/mutmut)

| | |
|---|---|
| Observation | Whether the regression test would have caught the original bug if applied to slightly mutated code |
| Triggers | P7 (single observation) — verify the new regression test is meaningful |
| Autonomous invocation | `npx stryker run --mutate <changed-file>` scoped to the fixed file; survivor count must be zero for mutants matching the original defect shape |
| Catches | Regression tests that assert `toBeDefined()` instead of specific values — pass before AND after fix |
| Caveats | Slow when scope is large; doesn't apply to platform-only languages (Apps Script server, etc.) |

### S4 — Clock Manipulation / Time-Freeze

| | |
|---|---|
| Observation | Behavior at time boundaries: midnight, DST transitions, week rollover, expiry |
| Triggers | P10 (business-rule semantics) when fix touches scheduling, TTL, expiry, version stamps |
| Autonomous invocation | `vi.useFakeTimers()` + `vi.setSystemTime()` in unit tests; `page.clock.setFixedTime()` in Playwright (1.45+) |
| Catches | Timezone-dependent bugs that pass in dev's locale; DST gap/duplication; cache TTL math errors |
| Caveats | Real `setTimeout`/`setInterval` break under faked clocks unless explicitly advanced; must reset between tests |

### S5 — Structured Log Assertion

| | |
|---|---|
| Observation | Whether expected log events fire with correct severity, fields, and frequency |
| Triggers | P5 (error classification), P6 (cross-layer signaling) |
| Autonomous invocation | After triggering scenario, fetch logs via project's log mechanism; assert specific events appear with expected fields |
| Catches | UI handles error correctly but server logs at wrong severity (silent SLO drift); log message differs from spec |
| Caveats | Log ingestion latency; requires stable filter (run ID, automation ID); format changes break assertions |

### S6 — Property-Based / Fuzz Testing (fast-check, hypothesis)

| | |
|---|---|
| Observation | Whether fix holds across a generated input space, not just the regression-test example |
| Triggers | P1 (boundary inputs), P10 (business-rule semantics) — guard conditions, parsers, range validators |
| Autonomous invocation | Define generator matching realistic input shape; assert invariant property over generated inputs |
| Catches | Off-by-one, edge cases the human tester didn't enumerate, exotic input shapes that break parsers |
| Caveats | Generator quality determines coverage; shrinking can produce verbose output; not E2E-driving |

### S7 — Differential / Shadow Testing

| | |
|---|---|
| Observation | Whether fixed version produces identical outputs to known-good version for shared inputs |
| Triggers | P9 (component ripple) for refactors; P3 for "should not change behavior" fixes |
| Autonomous invocation | Run fixed code AND prior version side-by-side; diff outputs |
| Catches | Refactor that produces same count but different ordering; "no-op" refactor that subtly changes behavior |
| Caveats | Requires reachable prior version; only works for pure or near-pure functions; stateful ops need state reset |

### S8 — Semgrep / AST Pattern Matching

| | |
|---|---|
| Observation | Class-of-bug presence elsewhere in codebase; structural-not-textual matches |
| Triggers | P9 (component ripple), P3 — after fixing one site, find analogous sites |
| Autonomous invocation | `semgrep --pattern '<structural_pattern>' <scope>`; rules checked into `scripts/semgrep/` |
| Catches | Same bug at sites the diagnosis didn't enumerate; missing required argument at dynamic call sites that escape type-checker |
| Caveats | Rules need tuning to avoid false positives; type system already catches most cases in strongly-typed languages |

### S9 — Accessibility Tree Snapshot (DOM Mutation Observer)

| | |
|---|---|
| Observation | ARIA roles, labels, focus order, live regions — not just visual appearance |
| Triggers | P11 (visual/render dependency) for any UI fix; P8 if assistive-technology users impacted |
| Autonomous invocation | `page.accessibility.snapshot()` in Playwright; diff against expected structure or assert presence of specific roles |
| Catches | Visual error banner with no `role="alert"` (screen reader silent); focus order broken by Portal; ARIA label drift |
| Caveats | AX trees brittle to copy changes; Chromium AX differs from Firefox; needs explicit role assertions, not full snapshot diff |

### S10 — Chaos / Fault Injection

| | |
|---|---|
| Observation | Resilience when dependency degrades (slow, partial, wrong status) |
| Triggers | P2a (async), P5 (error handling) — fixes that add error-handling paths |
| Autonomous invocation | `page.route(url, route => route.abort('timedout'))` in Playwright; MSW handlers rotating through failure modes |
| Catches | Fix handles primary error but recovery path makes second call that also fails (nested unhandled rejection) |
| Caveats | Requires knowing affected network boundaries; project-specific RPC channels (e.g., GAS `google.script.run`) need bespoke fault injection |

### S11 — Telemetry / Usage Log Assertion

| | |
|---|---|
| Observation | Whether telemetry events reach the analytics pipeline with correct fields |
| Triggers | P6 (cross-layer signaling), P3 (externally-visible state) — fixes that add/change `logUsage`-equivalent calls |
| Autonomous invocation | Project-specific query: `bq query`, `cloudwatch logs`, `datadog query`; assert event appears with correct fields |
| Catches | Schema-rejected telemetry silently dropped; event-rate gap that looks like zero-user activity |
| Caveats | Ingestion latency (minutes); requires real-user-equivalent exercise, not unit test; not pre-commit gating-suitable |

### S12 — Strict Type Checking as Validation Gate

| | |
|---|---|
| Observation | Type unsoundness at call sites NOT in the changed files |
| Triggers | P9 (component ripple) for any signature/type change |
| Autonomous invocation | `tsc --noEmit --strict` (or `mypy --strict`, `pyright`, `cargo check`) project-wide; compare error count before/after; fail if increased |
| Catches | Optional-field change ripples to a 5-files-away consumer that doesn't null-check |
| Caveats | Already part of build; must run project-wide, not per-file; slow on large repos (use incremental cache) |

### S13 — Persistence-Layer Diff (storage, cookies, DB rows)

| | |
|---|---|
| Observation | What persistent state was created/changed/orphaned by the fix |
| Triggers | P3 (state mutation), P8 (journey continuity for cross-session state) |
| Autonomous invocation | Capture localStorage/sessionStorage/cookies before+after; query DB rows; inspect external persistence; diff |
| Catches | Fix writes new key but old key still read on reload; orphaned cache entries; cross-session state leaks |
| Caveats | Sensitive values must be excluded; project-specific storage mechanisms (Apps Script User Properties, IndexedDB) need bespoke inspectors |

### S14 — Performance Budget / Bundle Size Regression

| | |
|---|---|
| Observation | Whether fix increases bundle size or runtime metrics beyond budgets |
| Triggers | P11 (visual/render) for fixes adding imports/components; P1 for fixes adding network calls |
| Autonomous invocation | `npm run size-check --strict` post-build; capture FCP/LCP via `performance.getEntriesByType('paint')`; compare to baseline |
| Catches | Fix adds utility library, pushes bundle over threshold; new imports degrade load time |
| Caveats | Bundle checks are usually in CI hooks already; runtime timing varies by machine, use relative thresholds |

---

## Cross-check pairs

When multiple tools are available for a property, dispatch in parallel. These pairs are particularly useful because each catches what the other misses:

| Property | Cross-check pair | What disagreement reveals |
|---|---|---|
| P1 | S1 (HAR capture) + S5 (server log) | Network call made but not received (firewall, retry storm); received but not logged (logging gap) |
| P2a | code execution + S2 (state snapshot) | Operation completed but state not mutated correctly (P3 leakage) |
| P2b | platform docs consultation + side-channel check | Flush semantics misunderstood; mutation acknowledged but not persisted |
| P3 | S2 (state diff) + S13 (persistence diff) | In-memory state correct but persisted form wrong; persistence works but cache stale |
| P5 | S5 (log assertion) + S9 (AX tree) | Error logged but not rendered; rendered but logged at wrong level |
| P6 | S1 (client capture) + S5 (server log) | Signal sent but not received; received but routed to wrong consumer |
| P8 | journey walk + S9 (AX tree) | Visual flow works but assistive-tech navigation broken; flow broken but visuals look OK |
| P9 | S7 (differential) + S12 (type checker) | Behavioral diff exists but types unchanged (semantic drift); types changed but behavior identical (refactor success) |
| P10 | S6 (property-based) + business-rule docs | Property holds but contradicts documented invariant; rule documented but property violates it (rule needs update) |
| P11 | screenshot reasoning + S9 (AX tree) | Pixels match but DOM semantics drifted; semantics correct but visual regression |
| P12 | real-server invocation + mock invocation | Mock path passes but real fails (mock dishonesty); both pass but semantic divergence |
| P13 | build artifact inspection + runtime behavior | Config baked but runtime ignores; runtime reads but config not embedded |

---

## When no tool is available

If a property has zero tools listed in `PROJECT_PROFILE.md` Section H:

1. Stamp `LIMITED-VERIFIED (<property>)` in FIX-XXX.md Section 4.
2. Auto-create a tooling-gap issue: `FIX-VALIDATION-GAP-XXX` with description "no tool available for <property> validation in this project."
3. The validation gap issue enters the same pipeline as a regular issue — investigated, fixed (e.g., add Playwright to project, install fast-check, configure semgrep).
4. The current issue is NOT marked `OUT_OF_BAND` (that is reserved for genuine capability boundary categories). It is marked `LIMITED-VERIFIED` with explicit note about which property's tool is missing.

This is the difference between "the project doesn't have the tool yet" (fixable, gets its own issue) and "no tool can verify this category" (genuine capability boundary, deferred to human follow-up).
