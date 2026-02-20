---
description: "Remove squash backup tags and bundle files. Use after confirming squash is good."
---

# Cleanup Squash Backups

Clean up backup tags and files created by `/squash-commits`.

## Flow

1. List what will be cleaned:
   ```bash
   git tag -l "_squash-backup-*"
   find .claude/sessions -name "pre-squash.bundle" 2>/dev/null
   find .claude/sessions -name "last-squash.json" 2>/dev/null
   ```

2. If nothing to clean, inform user and exit.

3. Show preview of what will be removed.

4. Ask user for confirmation using AskUserQuestion.

5. If confirmed, clean:
   ```bash
   # Remove backup tags
   for tag in $(git tag -l "_squash-backup-*"); do
     git tag -d "$tag"
   done

   # Remove bundle files
   find .claude/sessions -name "pre-squash.bundle" -delete 2>/dev/null

   # Remove last-squash.json files
   find .claude/sessions -name "last-squash.json" -delete 2>/dev/null
   ```

6. Confirm cleanup complete.
