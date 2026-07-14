#!/usr/bin/env node
'use strict';
/**
 * check-marker.cjs — verify a .git/code-review-passed-<sha> marker exists for HEAD.
 *
 * Usage: check-marker.cjs [--repo-root <abs-path>] [--allow-docs-ancestor]
 *
 * Looks up HEAD SHA, then checks for `<git-common-dir>/code-review-passed-<sha>`.
 * With --allow-docs-ancestor, a marker on a docs-only ANCESTOR of HEAD is also
 * accepted (so a docs/session-persist commit landing after review doesn't stale
 * the marker). Ancestry is proven via `git merge-base --is-ancestor` and an
 * empty/errored diff never counts as docs-only — see gate-lib.findValidMarker.
 *
 * Exit codes:
 *   0 — marker present (allowed)
 *   1 — marker missing OR stale (blocked)
 *   2 — error (not a git repo, can't read HEAD, etc.)
 *
 * Prints a one-line status to stdout for the caller to surface.
 */

const fs = require('node:fs');
const lib = require('./gate-lib.cjs');

const PREFIX = 'code-review-passed-';

const argv = process.argv.slice(2);
const repoRootIdx = argv.indexOf('--repo-root');
const explicitRoot = repoRootIdx >= 0 ? argv[repoRootIdx + 1] : null;
const allowDocsAncestor = argv.includes('--allow-docs-ancestor');

function out(code, msg) {
  process.stdout.write(`[code-review:check-marker] ${msg}\n`);
  process.exit(code);
}

let repoRoot;
let gitDirAbs;
let headSha;
try {
  repoRoot = lib.resolveRepoRoot(explicitRoot);
  ({ gitDirAbs, headSha } = lib.resolveGit(repoRoot));
} catch (e) {
  out(2, e.message);
}

const match = lib.findValidMarker(repoRoot, gitDirAbs, headSha, PREFIX, { allowDocsAncestor });

if (!match) {
  let staleCount = 0;
  try {
    staleCount = fs.readdirSync(gitDirAbs).filter((f) => f.startsWith(PREFIX)).length;
  } catch (_e) {
    /* informational only */
  }
  const tail = staleCount > 0 ? ` (${staleCount} stale marker(s) found)` : '';
  out(1, `no marker for HEAD ${headSha.slice(0, 8)}${tail}`);
}

// Marker present — prune superseded (ancestor) markers, keeping the matched one.
// Markers STRANDED by history rewriting (an abandoned sha is an ancestor of nothing,
// so pruneStale can never reach them) are deliberately NOT collected here: deciding
// "this commit is gone" is unsafe automatically — git reports an unreadable object
// exactly like an absent one, so a transient fault would delete live markers. That
// sweep is a human-invoked maintenance step instead: gate-gc.cjs (/gate-gc).
lib.pruneStale(repoRoot, gitDirAbs, PREFIX, match.sha);

const via = match.exact ? `${headSha.slice(0, 8)}` : `docs-only ancestor ${match.sha.slice(0, 8)}`;
out(0, `ok — marker present for ${via}`);
