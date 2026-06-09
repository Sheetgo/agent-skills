# fix-issues Skill — Setup & Usage

Autonomous bug fixing pipeline for Claude Code. Give it a list of bugs, it investigates, diagnoses, fixes, and verifies each one with 3 mandatory gate checks, regression tests, and full session persistence.

## Prerequisites

- **Claude Code** 2.1+
- **Node.js** 18+ (gate-check and merge scripts are `.cjs`)
- **Python 3.6+** (setup/uninstall scripts use Python for JSON manipulation)
- **jq** (required by `gate-check-hook.sh` to read tool input — `brew install jq` / `apt install jq`)
- **smart-compose hook** (recommended) — auto-approves `git add && git commit` heredocs. See `hooks/smart-compose.py` in this repo.

## File Structure

```
skills/fix-issues/
├── SKILL.md                          # Main skill (v3.1.14, ~1100 lines)
├── SETUP.md                          # This file
├── setup.sh                          # Installer (global + per-project)
├── uninstall.sh                      # Uninstaller (reverses setup.sh)
├── fix-issues/                       # Sub-files referenced by SKILL.md
│   ├── import-protocol.md            #   Test-audit integration
│   ├── session-template-guide.md     #   Checkpoint/recovery protocol
│   ├── toolbox.md                    #   Generic tools (vitest, Playwright)
│   ├── toolbox-sheetgo.md            #   Project-specific example (clasp, GCP)
│   ├── toolbox-strategies.md         #   Validation-strategy catalog
│   └── validation-templates.md       #   Pre-fix subagent prompts
└── project-setup/                    # Runtime artifacts (used in-place, not copied)
    ├── hooks/gate-check-hook.sh      #   PostToolUse auto-validation
    ├── scripts/check-fix-gate.cjs    #   Gate validation script (~1060 lines)
    ├── scripts/merge-fix-session.cjs #   Session merge at wrap-up
    ├── settings-permissions.json     #   Permissions template
    └── templates/
        ├── SESSION.md                #   Session registry template
        ├── FIX_ISSUE.md              #   Per-issue tracking template
        └── PROJECT_PROFILE.md        #   Project profile template (Phase 0.4)
```

## Install

### Step 1: Global (one-time)

Creates user-level symlinks. After this, `/fix-issues` works in every project.

```bash
bash <repo>/skills/fix-issues/setup.sh
```

### Step 2: Per-Project (optional, per repo)

Adds permissions and gate-check hook to `.claude/settings.local.json` (gitignored). This enables zero-auth sessions — without it the skill works but prompts for some operations.

```bash
bash <repo>/skills/fix-issues/setup.sh --project /path/to/your/project
```

Replace `<repo>` with the path to your agent-skills clone.

## Uninstall

```bash
bash <repo>/skills/fix-issues/uninstall.sh                        # Global only
bash <repo>/skills/fix-issues/uninstall.sh --project /path/to/dir # Global + project
```

Removes symlinks and cleans fix-issues entries from `settings.local.json`. Safe to run multiple times. Does not touch committed project files.

## E2E Testing

To verify the full lifecycle works in a project:

```bash
# 1. Clean slate
bash <repo>/skills/fix-issues/uninstall.sh --project /path/to/project

# 2. Fresh install
bash <repo>/skills/fix-issues/setup.sh --project /path/to/project

# 3. Open Claude Code in the project and run:
#    /fix-issues
#    <paste your issue list>
#
#    Expected: zero auth prompts, all gates pass, session completes autonomously

# 4. Verify results
#    - Check docs/fix-sessions/ for session output
#    - Check git log for fix commits
#    - Run tests to confirm fixes work
```

## Manual Per-Project Setup

If you prefer not to use the script, add this to `.claude/settings.local.json` in your project:

```json
{
  "permissions": {
    "allow": [
      "Read(.claude/**)",
      "Grep(.claude/**)",
      "Read(/tmp/**)",
      "Grep(/tmp/**)",
      "Read(~/.claude/skills/**)",
      "Grep(~/.claude/skills/**)",
      "Bash(node ~/.claude/skills/fix-issues/*)",
      "Bash(npx vitest:*)",
      "Bash(git add:*)",
      "Bash(git commit:*)",
      "Bash(git log:*)",
      "Bash(git status:*)",
      "Bash(git diff:*)",
      "Bash(git show:*)",
      "Bash(git rev-parse:*)",
      "Bash(mkdir:*)",
      "Bash(cp:*)",
      "Bash(sed:*)"
    ]
  },
  "hooks": {
    "PostToolUse": [
      {
        "matcher": "Edit|Write",
        "hooks": [
          {
            "type": "command",
            "command": "bash ~/.claude/skills/fix-issues/project-setup/hooks/gate-check-hook.sh"
          }
        ]
      }
    ]
  }
}
```

Adjust `Bash(npx vitest:*)` to match your test runner if not using vitest.

## What Lives Where

| Component | Location | Scope |
|-----------|----------|-------|
| Skill + sub-files | `~/.claude/skills/fix-issues/` | User (all projects) |
| Command `/fix-issues` | `~/.claude/commands/fix-issues.md` | User (all projects) |
| Templates, scripts, hook | `~/.claude/skills/fix-issues/project-setup/` | User (all projects) |
| Permissions + hook registration | `.claude/settings.local.json` (gitignored) | Per project |

## Customization

### Toolbox

The default `toolbox.md` covers vitest and Playwright basics. For project-specific tools (API clients, deploy scripts, log fetchers), create a project-local override or see `toolbox-sheetgo.md` for a complete example with Apps Script, GCP logging, and integration test tiers.

### Permissions

The default permissions cover vitest, git, and common Bash operations. If your project uses a different test runner or build tool, add those to `settings.local.json`:

```json
"Bash(npx jest:*)",
"Bash(npm test:*)",
"Bash(cargo test:*)"
```

## Verification

```bash
# Symlinks exist
ls -la ~/.claude/commands/fix-issues.md
ls -la ~/.claude/skills/fix-issues

# Skill loads (in Claude Code, type /fix-issues — should autocomplete)

# Project setup applied
cat .claude/settings.local.json | python3 -m json.tool
```
