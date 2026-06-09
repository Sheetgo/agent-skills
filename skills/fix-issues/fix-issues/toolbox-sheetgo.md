# fix-issues Toolbox — Available Capabilities

> **Referenced from**: `SKILL.md` (Sheetgo-specific version — see `toolbox.md` for generic template)
> **When to read**: During Phase 1 (Investigation) and Phase 4 (Verification) when you need specific tool commands.

Use these actively. Don't just read code — interact with the system.

### Playwright (UI Investigation & Verification)

```
WHEN: Frontend bugs, visual issues, component behavior, user flow testing

HOW:
  1. Inject mock data to reproduce the bug:
     - Use injectMockScenario() in E2E tests
     - OR use Playwright MCP tools (browser_navigate, browser_snapshot)

  2. Pull real automation data from DEV/PROD for realistic testing:
     a) clasp run getAutomation -p '["automation-id"]'
     b) Copy the JSON output
     c) Inject into local mock: injectMockScenario(page, { automations: [realData] })
     d) Navigate and inspect with Playwright

  3. Visual verification:
     - browser_snapshot → accessibility tree (best for UI state)
     - browser_take_screenshot → pixel comparison
     - browser_console_messages → catch JS errors

  4. Before/after comparison:
     a) Reproduce bug state → screenshot "before"
     b) Apply fix
     c) Same setup → screenshot "after"
     d) Include both in Section 4 verification

VIEWPORT: 300x600 (Google Sheets sidebar)
E2E COMMANDS:
  cd client && npx playwright test e2e/<file>.spec.ts
  npm run test:e2e:summary  (reliable counts)
```

### Clasp API (Backend Investigation & Verification)

```
WHEN: Backend bugs, data issues, execution problems, server-side logic

HOW:
  1. Run existing functions:
     clasp run functionName -p '["arg1", "arg2"]'
     clasp run runSmokeTests
     clasp run getAutomation -p '["id"]'

  2. Create temporary debug functions:
     - Write a function in server/src/ for investigation
     - npm run deploy (builds + pushes to DEV)
     - clasp run yourDebugFunction
     - Remove function after investigation

  3. Pull real data for analysis:
     clasp run getAutomations  (list all user automations)
     clasp run getSheetData -p '["fileId", "sheetId"]'
     clasp run getColumnHeaders -p '["fileId", "sheetId"]'

  4. Test fixes in real environment:
     npm run deploy  (deploy to DEV)
     clasp run functionThatWasFixed -p '[args]'
     Check output for expected behavior

IMPORTANT:
  - clasp run logs appear INLINE in the response, NOT in GCP
  - Read the FULL clasp output — don't skip/truncate
  - If clasp run times out, check npm run logs:recent for server-side logs
  - Always npm run deploy before clasp run to get latest code
```

### GCP Logs (Production/Dev Log Analysis)

```
WHEN: Investigating production issues, checking error patterns, verifying deployed fixes

HOW:
  # Recent logs (last 15 min, DEV deployment)
  npm run logs:recent

  # Errors only (last hour)
  npm run logs:errors

  # Custom time range — LOCAL TIME (Sao Paulo, no Z suffix)
  node scripts/fetch-logs.js --start="2026-01-24T01:46:00" --end="2026-01-24T02:00:00"

  # Custom time range — UTC (with Z suffix)
  node scripts/fetch-logs.js --start="2026-01-24T04:46:00Z" --end="2026-01-24T05:00:00Z"

  # With filters
  node scripts/fetch-logs.js --last=1h --severity=ERROR --search="abort"

CRITICAL SAFETY RULES:
  - Start with 5min windows ONLY for PROD logs — volume is massive
  - ALWAYS use --search filters with PROD logs to avoid terminal overflow
  - DEV logs are safer (lower volume), but still start conservative
  - Default deployment is HEAD on DEV; specify --deployment for PROD
  - clasp run logs do NOT go to GCP — they're inline in the clasp output
  - Use Read tool on saved log output, never tail/grep

ENVIRONMENT AWARENESS:
  - User says "production issue" → check PROD logs (carefully!)
  - User says "bug in DEV" → check DEV logs (default)
  - If unsure which env → ASK before pulling PROD logs
```

### Local Mock System (Fast UI Prototyping & Bug Reproduction)

```
WHEN: Reproducing UI bugs, testing new UI behavior, simulating edge cases

HOW:
  1. Create a mock scenario matching the bug conditions:
     - Use factories: createSimpleAutomation(), etc.
     - Override specific fields to match the bug

  2. Inject into test:
     await injectMockScenario(page, {
       automations: [automation],
       user: { isProUser: false },
       limits: { maxAutomations: 5 },
     });

  3. Simulate connection issues:
     await page.evaluate(() => window.__connectionStore?.getState().markApiFailure());

  4. Simulate execution states:
     await injectMockConfig(page, {
       hardFailure: true,          // Execution never completes
       timeoutOverride: 5000,      // Fast timeout for testing
       delay: 2000,                // Slow network
     });

  5. Pull real automation from server and use as mock:
     a) clasp run getAutomation -p '["real-id"]'  → get real JSON
     b) Paste into mock scenario → reproduce exact user state
     c) Run Playwright test → see exact bug conditions

MOCK FILES:
  client/e2e/fixtures/mockData.cjs    — Mock fixture
  client/e2e/scenarios/factories.cjs  — Scenario builders
  client/e2e/helpers.cjs              — Injection helpers
```

### Integration Tests (Backend Verification)

```
WHEN: Backend logic changes, processor fixes, destination fixes, execution flow changes

HOW:
  npm run test:tier1 -- --skip-build --skip-push    # Core
  npm run test:tier2 -- --skip-build --skip-push    # Features
  npm run test:tier3 -- --skip-build --skip-push    # Edge cases
  npm run test:tier4 -- --skip-build --skip-push    # Heavy (5K rows)
  npm run test:all-tiers                            # Everything

  # After deploying a fix:
  npm run deploy                                     # Build + push to DEV
  npm run test:tier1                                 # Full build + test

TIER SELECTION (by change type, not severity):
  Source loading    → T1
  Processor logic   → T1 + T2
  Destination write → T1
  Formatting        → T3
  Scale issues      → T4

OUTPUT: Always save with tee, read with Read tool. See Section 5.4.
```
