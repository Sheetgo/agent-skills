#!/usr/bin/env node
/**
 * check-marker.cjs — verify a .git/code-review-passed-<sha> marker exists for HEAD.
 *
 * Usage: check-marker.cjs [--repo-root <abs-path>]
 *
 * Looks up HEAD SHA, then checks for `<repo-root>/.git/code-review-passed-<sha>`.
 *
 * Exit codes:
 *   0 — marker present (push is allowed)
 *   1 — marker missing OR stale (HEAD moved since approval; push should be blocked)
 *   2 — error (not in a git repo, can't read HEAD, etc.)
 *
 * Prints a one-line status to stdout for the caller (hook wrapper) to surface.
 */

const fs = require('node:fs');
const path = require('node:path');
const { execFileSync } = require('node:child_process');

const args = process.argv.slice(2);
const repoRootIdx = args.indexOf('--repo-root');
const repoRoot = repoRootIdx >= 0 ? args[repoRootIdx + 1] : process.cwd();

function fail(code, message) {
  process.stdout.write(message + '\n');
  process.exit(code);
}

let gitDir;
try {
  // --git-common-dir (not --git-dir) so markers are shared across linked
  // worktrees: --git-dir returns .git/worktrees/<name> in a linked worktree,
  // which would hide a marker written from the main worktree (or vice versa).
  gitDir = execFileSync('git', ['-C', repoRoot, 'rev-parse', '--git-common-dir'], {
    encoding: 'utf8',
    stdio: ['ignore', 'pipe', 'pipe'],
  }).trim();
} catch (err) {
  fail(2, `[code-review:check-marker] not a git repo at ${repoRoot}`);
}

const gitDirAbs = path.isAbsolute(gitDir) ? gitDir : path.join(repoRoot, gitDir);

let headSha;
try {
  headSha = execFileSync('git', ['-C', repoRoot, 'rev-parse', 'HEAD'], {
    encoding: 'utf8',
    stdio: ['ignore', 'pipe', 'pipe'],
  }).trim();
} catch (err) {
  fail(2, '[code-review:check-marker] cannot resolve HEAD');
}

const markerPath = path.join(gitDirAbs, `code-review-passed-${headSha}`);

if (!fs.existsSync(markerPath)) {
  // Surface any other markers in the dir to indicate "approved earlier, but HEAD moved"
  let staleCount = 0;
  try {
    staleCount = fs
      .readdirSync(gitDirAbs)
      .filter((f) => f.startsWith('code-review-passed-')).length;
  } catch (_err) {
    // ignore — informational only
  }
  const tail = staleCount > 0 ? ` (${staleCount} stale marker(s) found)` : '';
  fail(1, `[code-review:check-marker] no marker for HEAD ${headSha.slice(0, 8)}${tail}`);
}

// Marker for current HEAD is present — clean up any stale markers from earlier
// approvals so they don't accumulate in the git dir.
try {
  for (const f of fs.readdirSync(gitDirAbs)) {
    if (f.startsWith('code-review-passed-') && f !== `code-review-passed-${headSha}`) {
      try { fs.unlinkSync(path.join(gitDirAbs, f)); } catch (_e) { /* best-effort */ }
    }
  }
} catch (_e) { /* best-effort */ }

process.stdout.write(`[code-review:check-marker] ok — marker present for ${headSha.slice(0, 8)}\n`);
process.exit(0);
