#!/bin/bash
# fix-issues skill installer
#
# Usage:
#   bash setup.sh                        # User-level only (symlinks)
#   bash setup.sh --project /path/to/dir # User-level + project settings
#
# User-level: creates symlinks so /fix-issues works in all projects.
# Project-level: adds permissions + hook registration to .claude/settings.local.json
#   (gitignored, so it won't affect other clones).

set -euo pipefail

SKILL_DIR="$(cd "$(dirname "$0")" && pwd)"
AGENT_SKILLS_DIR="$(cd "$SKILL_DIR/../.." && pwd)"
PROJECT_DIR=""

# Parse args
while [[ $# -gt 0 ]]; do
    case $1 in
        --project)
            if [ $# -lt 2 ]; then
                echo "Error: --project requires a path argument" >&2
                exit 1
            fi
            PROJECT_DIR="$(cd "$2" && pwd)"; shift 2 ;;
        *) PROJECT_DIR="$(cd "$1" && pwd)"; shift ;;
    esac
done

echo "fix-issues skill installer"
echo "=========================="
echo ""

# --- User-level symlinks ---
echo "User-level setup"

mkdir -p ~/.claude/commands ~/.claude/skills

if [ -L ~/.claude/commands/fix-issues.md ]; then
    echo "  ✓ Command symlink exists"
elif [ -f ~/.claude/commands/fix-issues.md ]; then
    echo "  ⚠ ~/.claude/commands/fix-issues.md exists (not a symlink) — skipping"
else
    ln -sf "$AGENT_SKILLS_DIR/commands/fix-issues.md" ~/.claude/commands/fix-issues.md
    echo "  ✓ Created command symlink"
fi

if [ -L ~/.claude/skills/fix-issues ]; then
    echo "  ✓ Skill symlink exists"
elif [ -d ~/.claude/skills/fix-issues ]; then
    echo "  ⚠ ~/.claude/skills/fix-issues exists (not a symlink) — skipping"
else
    ln -sf "$SKILL_DIR" ~/.claude/skills/fix-issues
    echo "  ✓ Created skill symlink"
fi

echo ""
echo "  /fix-issues is now available in all projects."
echo ""

# --- Project-level (optional) ---
if [ -z "$PROJECT_DIR" ]; then
    echo "No project specified. To add permissions + hook to a project:"
    echo "  bash $0 --project /path/to/your/project"
    echo ""
    exit 0
fi

if ! command -v python3 >/dev/null 2>&1; then
    echo "Error: python3 is required for project-level setup" >&2
    exit 1
fi

echo "Project setup → $PROJECT_DIR"
echo "  Writing to .claude/settings.local.json (gitignored)"

# Use settings.local.json (gitignored) to avoid polluting committed settings.
# Paths are passed to python via the environment (never interpolated into the
# source) so a project path containing quotes can't break the inline script.
SETTINGS="$PROJECT_DIR/.claude/settings.local.json"
SRC="$SKILL_DIR/project-setup/settings-permissions.json"
mkdir -p "$PROJECT_DIR/.claude"

# Permissions — create the file if absent, then merge any missing rules.
# Merging is idempotent: it only appends rules not already present, so a re-run
# (or a run after a partial install) repairs the set instead of skipping it.
if [ ! -f "$SETTINGS" ]; then
    cp "$SRC" "$SETTINGS"
    SETTINGS="$SETTINGS" python3 -c "
import json, os
p = os.environ['SETTINGS']
with open(p) as f: d = json.load(f)
d.pop('_comment', None)
with open(p, 'w') as f: json.dump(d, f, indent=2)
" 2>/dev/null || true
    echo "  ✓ Created .claude/settings.local.json with permissions"
else
    SETTINGS="$SETTINGS" SRC="$SRC" python3 -c "
import json, os
with open(os.environ['SRC']) as f: src = json.load(f)
p = os.environ['SETTINGS']
with open(p) as f: dst = json.load(f)
existing = set(dst.get('permissions', {}).get('allow', []))
new_perms = [x for x in src['permissions']['allow'] if x not in existing]
if new_perms:
    dst.setdefault('permissions', {}).setdefault('allow', []).extend(new_perms)
    with open(p, 'w') as f: json.dump(dst, f, indent=2)
    print(f'  ✓ Added {len(new_perms)} permission rules')
else:
    print('  ✓ All permissions already present')
" 2>/dev/null || echo "  ⚠ Could not merge permissions — add manually from settings-permissions.json"
fi

# Hook registration (idempotent)
SETTINGS="$SETTINGS" python3 -c "
import json, os
p = os.environ['SETTINGS']
with open(p) as f: d = json.load(f)
post = d.setdefault('hooks', {}).setdefault('PostToolUse', [])
already = any(
    'gate-check-hook' in hk.get('command', '')
    for h in post for hk in h.get('hooks', [])
)
if already:
    print('  ✓ Gate-check hook already registered')
else:
    post.append({'matcher': 'Edit|Write', 'hooks': [{'type': 'command', 'command': 'bash ~/.claude/skills/fix-issues/project-setup/hooks/gate-check-hook.sh'}]})
    with open(p, 'w') as f: json.dump(d, f, indent=2)
    print('  ✓ Registered gate-check hook')
" 2>/dev/null || echo "  ⚠ Could not auto-register hook — add manually"

echo ""
echo "Done! Verify: open Claude Code in $PROJECT_DIR and type /fix-issues"
