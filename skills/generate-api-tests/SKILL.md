---
name: generate-api-tests
description: Use when creating API tests for any API project (Flask, FastAPI, Express, NestJS, Django, Go) needing YAML integration tests for go-runner
---

# Generate API Tests

Framework-agnostic API test generator. Two commands: `init` (analyze project, create `.api-spec.md`) and `create` (generate YAML tests in `spec-files/`).

**Core principle:** Tests generated from route signatures alone miss most bugs. Deep source tracing — through handlers, controllers, services, and exception classes — ensures every code branch has a test.

**Test Runner:** go-runner (Go-based, expr-lang). See project CLAUDE.md for go-runner docs.

**Reference file:** `reference.md` in this skill directory contains expression syntax, templates, and format examples. When dispatching parallel agents, **read `reference.md` first and include the relevant sections** (expression syntax table, YAML template) in each agent's prompt — subagents cannot access it automatically.

## When to Use

- API project needs integration tests for go-runner
- Project uses Flask, FastAPI, Django, Express, NestJS, or Go
- Existing test coverage is shallow (only happy path) or missing entirely
- New endpoints added and need test generation

**When NOT to use:** Unit tests, non-HTTP services, projects not using go-runner as test runner.

## Command: `init`

1. Scan project and detect framework
2. Find all endpoints and extract parameters
3. Ask gap-filling questions (see below)
4. Generate `.api-spec.md` (with coverage bar at 0%) + `spec-files/.env.example` + `spec-files/{{project-name}}-config.yaml`

**Framework detection:** Scan `package.json`, `go.mod`, `requirements.txt`, or source imports for Flask/FastAPI/Django/Express/NestJS/Go patterns.

**Gap-filling questions** (ask one at a time): auth method, base URL, error response format, endpoints to exclude.

**Config file rules:** Always use folder includes (`!include module/`). See `reference.md` for format.

**Re-running init:** Merges with existing `.api-spec.md` and shows a diff summary.

| Action | Behavior |
|--------|----------|
| New endpoint found | ADDED — appended to module table |
| Endpoint signature changed | MODIFIED — path/method updated, description preserved |
| Endpoint removed from code | REMOVED — marked but not deleted (may be intentional) |
| Existing descriptions/notes | NEVER overwritten |
| Custom env vars | NEVER overwritten |
| "Tested: Yes" markers | NEVER overwritten |
| Coverage bar and table | Recalculated from current Tested columns. Added if missing. |

**Existing projects without Coverage section:** Re-run `init`. It will scan the Tested columns across all endpoint tables, calculate the percentages, and insert the Coverage section after the header. No other content is modified.

## Command: `create`

```bash
/generate-api-tests create              # Interactive selection
/generate-api-tests create POST /path   # Specific endpoint
/generate-api-tests create module       # All endpoints in module
```

Auto-runs `init` if `.api-spec.md` missing.

### Execution Mode

Ask user via AskUserQuestion: **Multi-Agent (Parallel)** (recommended) or **Single Agent (Sequential)**.

### Agent Dispatch (Parallel Mode)

Use a **single message with multiple Task tool calls**. Each `general-purpose` agent gets:
1. Endpoint details + **exact source file path + line number**
2. **Deep Endpoint Analysis instructions** (see below) — agent MUST trace full source before writing YAML
3. Expression syntax and YAML template from `reference.md` (included in prompt)
4. Test content rules (see below)
5. Output path: `spec-files/{module}/{METHOD_RESOURCE}.yaml`
6. Update `.api-spec.md` tested status for its endpoints

Main agent generates config file and **updates the coverage bar and coverage table** in `.api-spec.md` after all agents complete.

### Test Content Rules

These apply to ALL generated tests regardless of execution mode:

- **Test categories (in order):** SETUP → HAPPY PATH (all variations) → PARAM VALIDATION → BUSINESS RULES → AUTH FAILURES → CROSS-PARAM COMBINATIONS → TEARDOWN
- **Auth:** NEVER add Authorization headers. go-runner handles auth automatically. Use `auth: none` or `skipAuth: true` for unauthorized test scenarios only.
- **Minimum 5 tests** per non-trivial endpoint. Fewer requires a YAML comment explaining why.
- **Minimum:** N code branches → N+3 tests.

## Deep Endpoint Analysis (MANDATORY)

**Do NOT generate tests from route signature alone.** Read and trace full source code first.

### Step 1: Read View/Route Handler
Identify: all params (path, query, body, headers), required vs optional, early returns, controller calls, data transformations.

### Step 2: Read Controller/Service Layer
Follow every function call. For each: trace `if/else` branches (each = test case), `try/except` blocks (each exception = test case), validation logic, authorization checks, business rules (quotas, limits, flags), database lookups that can fail.

### Step 3: Map All Exceptions
Read imports, find every exception class. For each: what triggers it, what response it produces. Create at least one test per exception.

### Step 4: Map Response Variations
Document every distinct response shape: different success responses, different error codes, edge cases (empty lists, null fields).

### Step 5: Generate Exhaustive Tests

1. **SETUP** — Create all required fixtures
2. **HAPPY PATH (all variations)** — One test per distinct success branch. Test optional params that trigger different code paths.
3. **PARAM VALIDATION (each individually)** — For every required param: missing, empty `""`, wrong type, null. For constrained params: out of range, invalid enum, exceeds max length.
4. **BUSINESS RULE VIOLATIONS** — One per rule: quota exceeded, wrong plan, wrong state (archived/disabled), duplicate creation, dependency not found.
5. **AUTH FAILURES** — No token (`auth: none`), valid user but wrong owner, insufficient role.
6. **CROSS-PARAM COMBINATIONS** — Conflicting params, mutually exclusive params, params that modify other params' behavior.
7. **TEARDOWN** — Clean up ALL created resources.

**Minimum:** N code branches → N+3 tests. Fewer than 5 on non-trivial endpoint = not deep enough.

**Commented-out tests:** When a scenario needs special setup (second user, quota state), include commented out with `# NOTE:` explaining requirements.

## Output Structure

```
spec-files/
  {{module}}/{{METHOD}}_{{RESOURCE}}.yaml
  {{project-name}}-config.yaml
```

POST /connections → `spec-files/connection/CREATE_CONNECTION.yaml`

## Naming

- **File:** `METHOD_RESOURCE.yaml` (uppercase, underscores). POST=CREATE, PUT=UPDATE, PATCH=PATCH, DELETE=DELETE.
- **Test name:** `ENDPOINT_NAME - SCENARIO`
- **Scenarios:** SETUP, HAPPY PATH, MISSING X, EMPTY X, INVALID TYPE X, RESOURCE NOT FOUND, QUOTA EXCEEDED, UNAUTHORIZED, FORBIDDEN WRONG OWNER, CONFLICTING PARAMS, TEARDOWN

## Quick Reference

| Command | Action |
|---------|--------|
| `init` | Analyze project, create `.api-spec.md`, `.env.example`, config |
| `create` | Interactive endpoint selection |
| `create POST /path` | Specific endpoint |
| `create module` | All endpoints in module |

## Common Mistakes

| Mistake | Fix |
|---------|-----|
| Adding Authorization headers | go-runner handles auth. Use `auth: none` for unauth tests |
| Using `response.status()` | `response.Status` (Go struct, capitalized) |
| Using `process.env.VAR` | `env.VAR` (go-runner syntax) |
| Using `!== undefined` | `!= nil` or `!= ""` (expr-lang) |
| Hardcoding test data | Use `${{ env.VAR }}$` |
| Missing teardown | Always clean up created resources |
| Expecting HTTP error codes | Many APIs return 200; check response body |
| Shallow test generation | Read full handler + controller + service code. Every branch = test case |
| Only testing happy + unauthorized | Each `if/else`, `try/except`, validation = test case |
| Skipping param combinations | Test each required param missing individually + cross-param interactions |
| Ignoring business rules | Quota checks, state validations, feature flags = tests |
| Not documenting untestable paths | Comment out with `# NOTE:` explaining setup needed |
