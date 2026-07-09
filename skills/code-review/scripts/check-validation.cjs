#!/usr/bin/env node
'use strict';
/**
 * check-validation.cjs — verify a valid `validation-passed-<sha>` marker exists
 * for HEAD (or a docs-only ancestor of HEAD with --allow-docs-ancestor).
 *
 * Usage: check-validation.cjs [--repo-root <abs-path>] [--allow-docs-ancestor]
 *
 * Exit codes (mirrors check-marker.cjs):
 *   0 — a valid, evidence-checked marker is present
 *   1 — marker missing, stale, malformed, or evidence insufficient (gate blocks)
 *   2 — infrastructure error (not a git repo, can't read HEAD)
 *
 * Prints a one-line status to stdout for the caller (hook) to surface.
 */

const fs = require('node:fs');
const lib = require('./gate-lib.cjs');

const PREFIX = 'validation-passed-';
const MAX_MARKER_BYTES = 64 * 1024;

const argv = process.argv.slice(2);
const repoRootIdx = argv.indexOf('--repo-root');
const explicitRoot = repoRootIdx >= 0 ? argv[repoRootIdx + 1] : null;
const allowDocsAncestor = argv.includes('--allow-docs-ancestor');

function out(code, msg) {
  process.stdout.write(`[code-review:check-validation] ${msg}\n`);
  process.exit(code);
}

let repoRoot;
let gitDirAbs;
let headSha;
try {
  repoRoot = lib.resolveRepoRoot(explicitRoot);
  ({ gitDirAbs, headSha } = lib.resolveGit(repoRoot));
} catch (e) {
  out(2, `infra: ${e.message}`);
}

const match = lib.findValidMarker(repoRoot, gitDirAbs, headSha, PREFIX, { allowDocsAncestor });
if (!match) {
  let stale = 0;
  try {
    stale = fs.readdirSync(gitDirAbs).filter((f) => f.startsWith(PREFIX)).length;
  } catch (_e) {
    /* informational */
  }
  const tail = stale > 0 ? ` (${stale} marker(s) exist but none valid for HEAD ${headSha.slice(0, 8)})` : '';
  out(1, `no validation marker for HEAD ${headSha.slice(0, 8)}${tail}`);
}

// Read + parse defensively: size-cap, catch ALL errors (not just JSON).
let marker;
try {
  const st = fs.statSync(match.path);
  if (st.size > MAX_MARKER_BYTES) out(1, `validation marker too large (${st.size} bytes) — treated as invalid`);
  marker = JSON.parse(fs.readFileSync(match.path, 'utf8'));
} catch (e) {
  out(1, `validation marker unreadable/malformed — treated as invalid (${e.message})`);
}

// Base + changed files for the changeClass cross-check (best-effort; null skips it).
let changedFiles = null;
const base = lib.resolveBase(repoRoot);
if (base) changedFiles = lib.changedSinceBase(repoRoot, base);

// Artifacts are STORED copies in the git common-dir, keyed by the marker's own
// sha (not HEAD) — so a docs-only-ancestor marker still resolves its evidence.
// Nothing is read from the working tree, so nothing here can be committed/pushed.
const evDir = lib.evidenceDir(gitDirAbs, match.sha);
const verdict = lib.validateEvidence(marker, { evidenceDir: evDir, changedFiles });
if (!verdict.ok) out(1, `evidence check failed: ${verdict.reason}`);

// Valid — prune superseded (ancestor) markers, keeping the matched one, then drop
// the evidence dirs those markers referenced. pruneStale WITHOUT pruneEvidence
// orphans the artifacts in the git common-dir: this checker runs on every finish
// attempt and every push, far more often than the recorder, so the orphans would
// accumulate unreclaimed until the next record-validation happened to sweep them.
lib.pruneStale(repoRoot, gitDirAbs, PREFIX, match.sha);
lib.pruneEvidence(gitDirAbs, lib.shasWithMarkers(gitDirAbs, PREFIX));

const via = match.exact ? `HEAD ${headSha.slice(0, 8)}` : `docs-only ancestor ${match.sha.slice(0, 8)}`;
out(0, `ok — valid ${marker.changeClass} validation for ${via}`);
