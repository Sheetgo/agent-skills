#!/bin/bash
# fix-issues skill uninstaller
#
# Usage:
#   bash uninstall.sh                        # User-level only (remove symlinks)
#   bash uninstall.sh --project /path/to/dir # User-level + clean project settings
#
# Reverses everything setup.sh does. Safe to run multiple times.

set -euo pipefail

PROJECT_DIR=""

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

echo "fix-issues skill uninstaller"
echo "============================"
echo ""

# --- User-level symlinks ---
echo "User-level cleanup"

if [ -L ~/.claude/commands/fix-issues.md ]; then
    rm ~/.claude/commands/fix-issues.md
    echo "  ✓ Removed command symlink"
else
    echo "  - No command symlink found"
fi

if [ -L ~/.claude/skills/fix-issues ]; then
    rm ~/.claude/skills/fix-issues
    echo "  ✓ Removed skill symlink"
else
    echo "  - No skill symlink found"
fi

echo ""

# --- Project-level (optional) ---
if [ -z "$PROJECT_DIR" ]; then
    echo "No project specified. To also clean project settings:"
    echo "  bash $0 --project /path/to/your/project"
    echo ""
    exit 0
fi

echo "Project cleanup → $PROJECT_DIR"

SETTINGS="$PROJECT_DIR/.claude/settings.local.json"

if [ ! -f "$SETTINGS" ]; then
    echo "  - No .claude/settings.local.json found"
    echo ""
    exit 0
fi

if ! command -v python3 >/dev/null 2>&1; then
    echo "  ⚠ python3 not found — edit .claude/settings.local.json manually"
    exit 0
fi

# Remove only fix-issues-specific entries. NOTE: generic permissions like
# Read(~/.claude/skills/**) are intentionally left in place — other installed
# skills may depend on them, so removing them here would break those skills.
# The path is passed via the environment so a quoted project path is safe.
SETTINGS="$SETTINGS" python3 -c "
import json, os

p = os.environ['SETTINGS']
with open(p) as f: d = json.load(f)

# Remove fix-issues-specific permissions only (not shared skills/** rules)
perms = d.get('permissions', {}).get('allow', [])
fix_perms = [x for x in perms if 'fix-issues' in x]
if fix_perms:
    d['permissions']['allow'] = [x for x in perms if x not in fix_perms]
    print(f'  ✓ Removed {len(fix_perms)} fix-issues permission rule(s)')
else:
    print('  - No fix-issues permissions found')

# Remove gate-check hook
hooks = d.get('hooks', {}).get('PostToolUse', [])
before = len(hooks)
d.get('hooks', {})['PostToolUse'] = [
    h for h in hooks
    if not any('gate-check-hook' in hk.get('command', '') for hk in h.get('hooks', []))
]
after = len(d.get('hooks', {}).get('PostToolUse', []))
if before > after:
    print('  ✓ Removed gate-check hook registration')
else:
    print('  - No gate-check hook found')

# Clean up empty structures
if not d.get('hooks', {}).get('PostToolUse'):
    d.get('hooks', {}).pop('PostToolUse', None)
if not d.get('hooks'):
    d.pop('hooks', None)
if not d.get('permissions', {}).get('allow'):
    d.get('permissions', {}).pop('allow', None)
if not d.get('permissions'):
    d.pop('permissions', None)

# Write back or delete if empty
if d:
    with open(p, 'w') as f: json.dump(d, f, indent=2)
else:
    os.remove(p)
    print('  ✓ Deleted empty settings.local.json')
" 2>/dev/null || echo "  ⚠ Could not clean settings — edit .claude/settings.local.json manually"

echo ""
echo "Done. /fix-issues is no longer available."
