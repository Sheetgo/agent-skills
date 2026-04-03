# fix-issues Toolbox — Available Capabilities

> **Referenced from**: SKILL.md
> **When to read**: During Phase 1 (Investigation) and Phase 4 (Verification) when you need specific tool commands.
> **Customization**: Copy this file and adapt commands to your project. See `toolbox-sheetgo.md` for a complete example.

Use these actively. Don't just read code — interact with the system.

### Unit Tests (All Projects)

```
WHEN: Logic changes, state management, utility functions, validation

HOW:
  # Run all tests (redirect output, read with Grep — NEVER pipe through tail)
  npx vitest run --reporter verbose 2>&1 > /tmp/claude/vitest-output.txt
  Grep: pattern="Tests.*passed|FAIL|Error" path="/tmp/claude/vitest-output.txt"

  # Run specific test file
  npx vitest run path/to/file.test.ts --reporter verbose 2>&1 > /tmp/claude/vitest-specific.txt

  # Run tests matching pattern
  npx vitest run -t "test description" --reporter verbose 2>&1 > /tmp/claude/vitest-match.txt

OUTPUT RULE: Always redirect to file, read with Grep tool. Never pipe through tail/head/grep.
```

### Playwright E2E (Frontend Projects)

```
WHEN: Frontend bugs, visual issues, component behavior, user flow testing

HOW:
  1. Visual verification:
     - browser_snapshot → accessibility tree (best for UI state)
     - browser_take_screenshot → pixel comparison
     - browser_console_messages → catch JS errors

  2. Before/after comparison:
     a) Reproduce bug state → screenshot "before"
     b) Apply fix
     c) Same setup → screenshot "after"
     d) Include both in Section 4 verification

  3. Run E2E tests:
     npx playwright test e2e/<file>.spec.ts

VIEWPORT: Set to match your application's target viewport.
```

### Project-Specific Tools

Each project should add its own tool sections below. Examples:

- **API testing**: curl, httpie, or dedicated test runners
- **Backend debugging**: REPL commands, log fetchers, database queries
- **Deployment**: deploy scripts, smoke test commands
- **Log analysis**: log fetcher commands with time range filters

See `toolbox-sheetgo.md` for a full example with clasp (Apps Script), GCP logs, mock system, and integration test tiers.
