---
description: "Report gate markers and validation evidence stranded by squash/amend/rebase. Reports only — never deletes."
---

# Report Stranded Gate Markers

Every squash, amend and rebase abandons a commit. The `code-review-passed-<sha>` /
`validation-passed-<sha>` marker keyed to that sha becomes an ancestor of nothing, so the
gate's `pruneStale` can never reach it — and while the marker exists, its
`validation-evidence/<sha>/` dir is kept alive too. They accumulate in the git dir.

**This command reports. It never deletes, and there is no `--force`.** Collecting a marker
means deciding "this commit is gone", and git cannot answer that: under a store fault
(unreadable pack, corrupt-but-readable pack, corrupt commit-graph, faulted alternate object
store) it reports a perfectly live commit *identically* to an absent one. Six deleting
designs were each shown to destroy real validation evidence. So a human reads the list and
decides.

## Flow

1. Run it:
   ```bash
   node ~/.claude/skills/code-review/scripts/gate-gc.cjs
   ```
   - exit 1 → nothing looks stranded. Tell the user and stop.
   - exit 2 → it REFUSED, because the object store is not provably intact. Do not work
     around this. Surface the problems it printed and stop.

2. Show the user the report. Note what it is KEEPING and why — a marker stays if its commit
   is reachable from any ref, any worktree HEAD, **or the reflog** (a commit one
   `git reset --hard @{1}` from being HEAD again must not lose its evidence).

3. **The list is advisory, not proof.** Before removing anything, sanity-check each sha:
   ```bash
   git log -1 --oneline <sha>     # if git can show it, the commit is NOT gone
   ```

4. Ask the user for confirmation with `AskUserQuestion`, then delete only what they approve.
   The marker is a single file in the git common-dir; the evidence is a directory beside it:
   ```bash
   cd "$(git rev-parse --git-common-dir)"
   rm code-review-passed-<sha>
   rm -r validation-evidence/<sha>
   ```

## When to use

- After a branch merges and you have run `/squash-cleanup`.
- When `.git` has grown noticeably.
- Never as part of an automated flow, and never wired into the gate checkers.
