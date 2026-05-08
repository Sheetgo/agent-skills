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
  gitDir = execFileSync('git', ['-C', repoRoot, 'rev-parse', '--git-dir'], {
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

process.stdout.write(`[code-review:check-marker] ok — marker present for ${headSha.slice(0, 8)}\n`);
process.exit(0);
