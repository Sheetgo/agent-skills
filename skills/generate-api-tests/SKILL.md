---
name: generate-api-tests
description: Use when any API project (Flask, FastAPI, Express, NestJS, Django, Go) needs YAML integration tests for go-runner, when test coverage is shallow or missing, or when generating CI/CD pipelines to deploy a temp instance and run those tests
---

# Generate API Tests

## Overview

Framework-agnostic API test generator. Three commands: `init` (analyze project, create `.api-spec.md`), `create` (generate YAML tests in `spec-files/`), and `ci` (generate CI/CD pipeline to deploy a temp instance and run tests).

**Core principle:** Tests generated from route signatures alone miss most bugs. Deep source tracing — through handlers, controllers, services, and exception classes — ensures every code branch has a test.

**Test Runner:** go-runner (Go-based, expr-lang). See project CLAUDE.md for go-runner docs.

**Reference file:** `reference.md` in this skill directory contains expression syntax, templates, format examples, output structure, naming conventions, deep endpoint analysis checklist, and CI pipeline generation details. When dispatching parallel agents, **read `reference.md` first and include the relevant sections** (expression syntax table, YAML template, naming rules, deep endpoint analysis checklist) in each agent's prompt — subagents cannot access it automatically.

## When to Use

- API project needs integration tests for go-runner
- Project uses Flask, FastAPI, Django, Express, NestJS, or Go
- Existing test coverage is shallow (only happy path) or missing entirely
- New endpoints added and need test generation
- Need CI/CD pipeline to deploy a temp instance and run API tests

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
| New / changed / removed endpoints | ADDED, MODIFIED (preserves descriptions), or REMOVED (marked, not deleted) |
| Existing descriptions, env vars, "Tested: Yes" | NEVER overwritten |
| Coverage bar and table | Recalculated from Tested columns. Added after header if missing. |

## Command: `create`

```bash
/generate-api-tests create              # Interactive selection
/generate-api-tests create POST /path   # Specific endpoint
/generate-api-tests create module       # All endpoints in module (matches ### heading in .api-spec.md)
```

Auto-runs `init` if `.api-spec.md` missing.

### Execution Mode

Ask user via AskUserQuestion: **Multi-Agent (Parallel)** (recommended) or **Single Agent (Sequential)**. Sequential mode: main agent generates all test files one at a time following the same rules below, then updates `.api-spec.md` tested status, coverage bar/table, and `spec-files/.env.example`.

### Agent Dispatch (Parallel Mode)

Use a **single message with multiple Agent tool calls**. Each `general-purpose` agent gets:
1. Endpoint details + **exact source file path + line number**
2. **Deep Endpoint Analysis** — tracing checklist from `reference.md` + test ordering from this skill's section below. Agent MUST trace full source before writing YAML
3. Expression syntax, YAML template, and naming conventions from `reference.md` (included in prompt)
4. Test content rules (see below)
5. Output path: `spec-files/{module}/{METHOD_RESOURCE}.yaml`

Subagents write ONLY their YAML test files — do NOT let subagents update `.api-spec.md` (concurrent writes will race and lose data).

Main agent after all agents complete: generates config file, **marks tested status** for all generated endpoints, **updates the coverage bar and coverage table**, and **adds any new env vars** to `spec-files/.env.example`.

### Test Content Rules

These apply to ALL generated tests regardless of execution mode:

- **Test categories and ordering:** Follow Deep Endpoint Analysis section below.
- **Auth:** NEVER add Authorization headers. go-runner handles auth automatically. Use `auth: none` or `skipAuth: true` for unauthorized test scenarios only.
- **Minimum 5 tests** per non-trivial endpoint. Fewer requires a YAML comment explaining why.
- **Env vars:** When tests reference `${{ env.VAR }}$`, ensure the var is in `spec-files/.env.example` with a description.

## Command: `ci`

Generates a CI/CD pipeline file to deploy a temporary instance and run go-runner tests.

```bash
/generate-api-tests ci           # Interactive (detects cloud from deploy files)
/generate-api-tests ci gcp       # Explicit cloud provider
```

Auto-runs `init` if `.api-spec.md` missing.

**Steps:** Detect cloud provider → Analyze existing deploy file → Ask gap-filling questions → Generate pipeline file. Currently supported: **GCP only**.

See `reference.md` → "CI Pipeline Generation Details" for the full step-by-step: file detection patterns, deploy file extraction checklist, gap-filling questions, and pipeline structure.

## Deep Endpoint Analysis (MANDATORY)

**Do NOT generate tests from route signature alone.** Trace full source code first: handler → controller/service → exceptions → response variations. See `reference.md` → "Deep Endpoint Analysis Checklist" for the detailed tracing steps.

After tracing, generate tests in this order:

1. **SETUP** — Create all required fixtures
2. **HAPPY PATH (all variations)** — One test per distinct success branch. Test optional params that trigger different code paths.
3. **PARAM VALIDATION (each individually)** — For every required param: missing, empty `""`, wrong type, null. For constrained params: out of range, invalid enum, exceeds max length.
4. **BUSINESS RULE VIOLATIONS** — One per rule: quota exceeded, wrong plan, wrong state (archived/disabled), duplicate creation, dependency not found.
5. **AUTH FAILURES** — No token (`auth: none`), valid user but wrong owner, insufficient role.
6. **CROSS-PARAM COMBINATIONS** — Conflicting params, mutually exclusive params, params that modify other params' behavior.
7. **TEARDOWN** — Clean up ALL created resources.

**Minimum:** N code branches → N+3 tests. Fewer than 5 on non-trivial endpoint = not deep enough.

**Commented-out tests:** When a scenario needs special setup (second user, quota state), include commented out with `# NOTE:` explaining requirements.

## Quick Reference

**Command progression:** `init` → `create` → `ci`. The `create` and `ci` commands auto-run `init` if `.api-spec.md` is missing.

| Command | Action |
|---------|--------|
| `init` | Analyze project, create `.api-spec.md`, `.env.example`, config |
| `create` | Interactive endpoint selection |
| `create POST /path` | Specific endpoint |
| `create module` | All endpoints in module |
| `ci` | Generate CI/CD pipeline for running tests |
| `ci gcp` | GCP Cloud Build pipeline |

## Common Mistakes

For expression syntax errors (`response.status()`, `process.env`, `!== undefined`), see the Expression Syntax table in `reference.md`.

| Mistake | Fix |
|---------|-----|
| Adding Authorization headers | go-runner handles auth. Use `auth: none` for unauth tests |
| Hardcoding test data | Use `${{ env.VAR }}$` |
| Missing teardown | Always clean up created resources |
| Expecting HTTP error codes | Many APIs return 200; check response body |
| Shallow test generation | Read full handler + controller + service code. Every branch = test case |
| Only testing happy + unauthorized | Each `if/else`, `try/except`, validation = test case |
| Skipping param combinations | Test each required param missing individually + cross-param interactions |
| Ignoring business rules | Quota checks, state validations, feature flags = tests |
| Not documenting untestable paths | Comment out with `# NOTE:` explaining setup needed |
| Forgetting cleanup step in CI | Always include cleanup step. GCP won't run it if tests fail — document this |
| Hardcoding project-specific values in CI | Use substitution variables `${_VAR}` for all project-specific config |
