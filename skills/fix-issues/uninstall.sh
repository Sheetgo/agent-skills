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
        --project) PROJECT_DIR="$(cd "$2" && pwd)"; shift 2 ;;
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

# Remove fix-issues permissions
python3 -c "
import json, sys

with open('$SETTINGS') as f: d = json.load(f)

# Remove fix-issues specific permissions
perms = d.get('permissions', {}).get('allow', [])
fix_perms = [p for p in perms if 'fix-issues' in p or 'skills/**' in p]
if fix_perms:
    d['permissions']['allow'] = [p for p in perms if p not in fix_perms]
    print(f'  ✓ Removed {len(fix_perms)} fix-issues permission rules')
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
    with open('$SETTINGS', 'w') as f: json.dump(d, f, indent=2)
else:
    import os
    os.remove('$SETTINGS')
    print('  ✓ Deleted empty settings.local.json')
" 2>/dev/null || echo "  ⚠ Could not clean settings — edit .claude/settings.local.json manually"

echo ""
echo "Done. /fix-issues is no longer available."
