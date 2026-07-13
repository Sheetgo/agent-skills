#!/usr/bin/env node
'use strict';
/**
 * gate-gc.cjs — REPORT which gate markers and evidence dirs look stranded. Never deletes.
 *
 * Every squash, amend and rebase abandons a commit. The marker keyed to that sha is an
 * ancestor of nothing, so `pruneStale` can never reach it, and while the marker exists
 * `pruneEvidence` keeps its evidence dir alive too. They accumulate in the git dir.
 *
 * WHY THIS TOOL DOES NOT DELETE
 * -----------------------------
 * Collecting a marker means deciding "this commit is gone" — and git cannot answer that
 * question. Under a store fault it reports a perfectly LIVE commit exactly as it reports
 * an absent one, and it does so through EVERY channel:
 *
 *   signal                       | absent        | present but faulted
 *   -----------------------------|---------------|------------------------------------
 *   cat-file -e                  | 128           | 128
 *   rev-parse --verify -q        | 1, no stderr  | 1, no stderr   (when PACKED)
 *   for-each-ref --contains      | 129 "no such commit" | 129 "no such commit"
 *   cat-file --batch-all-objects | omitted       | rc=0, SILENTLY omitted
 *   merge-base --is-ancestor     | 1             | 1  (a corrupt COMMIT-GRAPH lies here
 *                                |               |     while every object is pristine)
 *
 * Six deleting designs were written and adversarial review reproduced a live deletion —
 * of a real marker and, via the evidence cascade, the stored validation artifacts — in
 * every one of them. Each fix closed one channel and a new one appeared: unreadable loose
 * object, unreadable pack, corrupt-but-readable pack, corrupt commit-graph, and finally a
 * faulted `objects/info/alternates` store, which no check of THIS repo's packs can see.
 *
 * The lesson is that "prove this object is gone" is an unbounded verification burden, and
 * the thing on the other side of a wrong answer is your validation evidence. So this tool
 * reports; a human decides and deletes. The report is ADVISORY, not proof.
 *
 * Usage: gate-gc.cjs [--repo-root <abs-path>] [--json]
 * Exit codes: 0 report produced · 1 nothing looks stranded · 2 refused (store not intact).
 */

const fs = require('node:fs');
const path = require('node:path');
const lib = require('./gate-lib.cjs');

const PREFIXES = ['code-review-passed-', 'validation-passed-'];
const EVIDENCE_PREFIX = 'validation-passed-';

const argv = process.argv.slice(2);
const repoRootIdx = argv.indexOf('--repo-root');
const explicitRoot = repoRootIdx >= 0 ? argv[repoRootIdx + 1] : null;
const asJson = argv.includes('--json');

function out(msg) {
  process.stdout.write(`${msg}\n`);
}

function die(code, msg) {
  out(`[code-review:gate-gc] ${msg}`);
  process.exit(code);
}

let repoRoot;
let gitDirAbs;
try {
  repoRoot = lib.resolveRepoRoot(explicitRoot);
  ({ gitDirAbs } = lib.resolveGit(repoRoot));
} catch (e) {
  die(2, `infra: ${e.message}`);
}

// Refuse to even REPORT on a store we can't read — a misleading list is worse than none.
const intact = lib.objectStoreIntact(repoRoot, gitDirAbs);
if (!intact.ok) {
  out('[code-review:gate-gc] REFUSING TO REPORT — the object store is not provably intact.');
  out('');
  for (const p of intact.problems) out(`  · ${p}`);
  out('');
  out('  git reports an unreadable object exactly like a deleted one, so any');
  out('  "unreachable" verdict computed now would be untrustworthy. Fix the store first.');
  process.exit(2);
}

const roots = lib.reachabilityRoots(repoRoot);
const stranded = [];
const keep = [];

let files;
try {
  files = fs.readdirSync(gitDirAbs);
} catch (e) {
  die(2, `cannot read the git dir: ${e.message}`);
}

for (const f of files.sort()) {
  const prefix = PREFIXES.find((p) => f.startsWith(p));
  if (!prefix) continue;
  const sha = f.slice(prefix.length);
  if (!/^[0-9a-f]{7,64}$/.test(sha)) continue; // junk filename — not ours to judge

  const reachable = lib.isShaReachable(repoRoot, sha, roots);
  if (reachable === false) stranded.push({ file: f, prefix, sha });
  else keep.push({ file: f, why: reachable === null ? 'undetermined (kept)' : 'still reachable' });
}

const evRoot = path.join(gitDirAbs, 'validation-evidence');
const strandedShas = new Set(stranded.filter((e) => e.prefix === EVIDENCE_PREFIX).map((e) => e.sha));
const withMarker = new Set(
  files.filter((f) => f.startsWith(EVIDENCE_PREFIX)).map((f) => f.slice(EVIDENCE_PREFIX.length)),
);
const evStranded = [];
try {
  for (const d of fs.readdirSync(evRoot).sort()) {
    if (strandedShas.has(d) || !withMarker.has(d)) evStranded.push(d);
  }
} catch (_e) {
  /* no evidence store yet */
}

function dirSize(p) {
  let total = 0;
  try {
    for (const f of fs.readdirSync(p)) {
      try {
        total += fs.statSync(path.join(p, f)).size;
      } catch (_e) { /* skip */ }
    }
  } catch (_e) { /* skip */ }
  return total;
}
const bytes = evStranded.reduce((n, d) => n + dirSize(path.join(evRoot, d)), 0);

if (asJson) {
  out(JSON.stringify({
    stranded: stranded.map((e) => e.file),
    evidence: evStranded,
    keep,
    bytes,
    note: 'ADVISORY. This tool never deletes. git cannot distinguish a gone object from an unreadable one.',
  }, null, 2));
  process.exit(stranded.length || evStranded.length ? 0 : 1);
}

if (stranded.length === 0 && evStranded.length === 0) {
  die(1, `nothing looks stranded — ${keep.length} marker(s), all still reachable.`);
}

out('[code-review:gate-gc] REPORT ONLY — this tool never deletes anything.');
out('');
if (stranded.length) {
  out(`  Look stranded (${stranded.length}) — commit not reachable from any ref, worktree HEAD or reflog:`);
  for (const e of stranded) out(`    · ${e.prefix}${e.sha.slice(0, 12)}…`);
  out('');
}
if (evStranded.length) {
  out(`  Evidence dirs with no live marker (${evStranded.length}, ${(bytes / 1024).toFixed(1)} KB):`);
  for (const d of evStranded) out(`    · validation-evidence/${d.slice(0, 12)}…`);
  out('');
}
if (keep.length) {
  out(`  Keeping ${keep.length} marker(s): ${keep.filter((k) => k.why === 'still reachable').length} reachable, `
    + `${keep.filter((k) => k.why !== 'still reachable').length} undetermined.`);
  out('');
}

out('  ⚠ ADVISORY, NOT PROOF. git cannot distinguish an object that is GONE from one it');
out('    merely cannot READ — an unreadable pack, a corrupt commit-graph, or a faulted');
out('    alternate object store all make a LIVE commit look absent. Six attempts to act on');
out('    this automatically each deleted real validation evidence. Sanity-check a sha before');
out('    removing it (`git log -1 <sha>` — if git can show it, it is NOT gone), then:');
out('');
out(`      cd "$(git rev-parse --git-common-dir)"`);
out('      rm <marker-file> && rm -rf validation-evidence/<sha>');
out('');

process.exit(0);
