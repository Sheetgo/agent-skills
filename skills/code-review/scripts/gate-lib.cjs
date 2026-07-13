'use strict';
/**
 * gate-lib.cjs — single source of truth for the finishing/push gate markers.
 *
 * Consumed by check-marker.cjs, check-validation.cjs, record-validation.cjs and
 * (indirectly, via subprocess) hooks/session-checkpoint.py + git-push-gate-hook.sh.
 *
 * Responsibilities:
 *   - resolve git common-dir + HEAD (worktree-safe)
 *   - isDocsOnly(path)          — path-component-anchored docs/session-state test
 *   - findValidMarker(...)      — exact-HEAD or docs-only-ANCESTOR marker lookup
 *   - resolveBase / changedSinceBase — for the branch-skip + changeClass cross-check
 *   - validateEvidence(marker)  — the ONE authoritative validation-marker rule set
 *
 * Design notes:
 *   - All git calls go through execFileSync (array args, no shell) with a timeout.
 *   - The docs-only ancestor tolerance MUST prove real ancestry via
 *     `git merge-base --is-ancestor` before diffing, and treats any git error or
 *     an EMPTY diff as "does not match" (never as vacuously docs-only).
 *   - Evidence rules live here and ONLY here so the recorder and the checker
 *     cannot drift.
 */

const fs = require('node:fs');
const path = require('node:path');
const { execFileSync } = require('node:child_process');

const GIT_TIMEOUT_MS = 5000;

// A git object id: 40 hex chars under SHA-1, 64 under SHA-256
// (`git init --object-format=sha256`). Bounding these at 40 would silently skip
// every marker filename in a SHA-256 repo — disabling the docs-only-ancestor
// tolerance and stale-marker pruning with no error. Used to reject junk
// filenames, not to prove the sha exists; git itself rejects unresolvable ones.
const HEX_SHA_RE = /^[0-9a-f]{7,64}$/;
const WORKTREE_HEAD_RE = /^HEAD ([0-9a-f]{40,64})$/;

function git(repoRoot, args) {
  return execFileSync('git', ['-C', repoRoot, ...args], {
    encoding: 'utf8',
    stdio: ['ignore', 'pipe', 'pipe'],
    timeout: GIT_TIMEOUT_MS,
  });
}

// Returns trimmed stdout or null on any failure (never throws).
function gitTry(repoRoot, args) {
  try {
    return git(repoRoot, args).trim();
  } catch (_e) {
    return null;
  }
}

// Returns true iff the git command exits 0.
function gitOk(repoRoot, args) {
  try {
    git(repoRoot, args);
    return true;
  } catch (_e) {
    return false;
  }
}

function resolveRepoRoot(explicit) {
  if (explicit) return explicit;
  const root = gitTry(process.cwd(), ['rev-parse', '--show-toplevel']);
  if (!root) throw new Error('not a git repo');
  return root;
}

// Resolve the shared git dir (common-dir, so markers are visible across linked
// worktrees) and the current HEAD sha. Throws on failure (caller maps to exit 2).
function resolveGit(repoRoot) {
  const gitDir = gitTry(repoRoot, ['rev-parse', '--git-common-dir']);
  if (!gitDir) throw new Error(`not a git repo at ${repoRoot}`);
  const gitDirAbs = path.isAbsolute(gitDir) ? gitDir : path.join(repoRoot, gitDir);
  const headSha = gitTry(repoRoot, ['rev-parse', 'HEAD']);
  if (!headSha) throw new Error('cannot resolve HEAD');
  return { gitDirAbs, headSha };
}

// Path-component-anchored. Mirrors the Python is_docs_only_path() in
// hooks/session-checkpoint.py — keep the two in lockstep (parity test covers it).
function isDocsOnly(p) {
  if (typeof p !== 'string') return false;
  const norm = p.replace(/\\/g, '/').replace(/^\.\//, '');
  const parts = norm.split('/').filter(Boolean);
  if (parts.length === 0) return false;
  if (parts[0] === 'docs') return true;
  if (parts[0] === '.claude' && parts[1] === 'sessions') return true;
  return parts[parts.length - 1].toLowerCase().endsWith('.md');
}

/**
 * Find a valid marker file for `prefix` (e.g. 'code-review-passed-').
 * Returns { sha, path, exact } or null.
 *
 *   1. Exact: <gitDir>/<prefix><headSha> present  -> match.
 *   2. If allowDocsAncestor: for each <prefix><sha> in the git dir, accept iff
 *      <sha> is a REAL ancestor of HEAD (merge-base --is-ancestor exits 0) AND
 *      the two-dot `git diff --name-only <sha> HEAD` is NON-EMPTY and every
 *      changed path isDocsOnly. Any git error on a candidate -> skip it.
 */
function findValidMarker(repoRoot, gitDirAbs, headSha, prefix, opts = {}) {
  const exactPath = path.join(gitDirAbs, `${prefix}${headSha}`);
  if (fs.existsSync(exactPath)) return { sha: headSha, path: exactPath, exact: true };
  if (!opts.allowDocsAncestor) return null;

  let files;
  try {
    files = fs.readdirSync(gitDirAbs).filter((f) => f.startsWith(prefix));
  } catch (_e) {
    return null;
  }

  for (const f of files) {
    const sha = f.slice(prefix.length);
    if (!HEX_SHA_RE.test(sha)) continue; // guard against junk filenames
    if (sha === headSha) continue; // exact case already handled (and was absent)
    if (!gitOk(repoRoot, ['merge-base', '--is-ancestor', sha, 'HEAD'])) continue;
    const lines = diffNamesZ(repoRoot, [sha, 'HEAD']);
    if (lines === null) continue; // git error -> not a match (fail closed)
    if (lines.length === 0) continue; // empty diff is NOT "all docs-only"
    if (lines.every(isDocsOnly)) {
      return { sha, path: path.join(gitDirAbs, f), exact: false };
    }
  }
  return null;
}

// Delete SUPERSEDED sibling markers, keeping keepSha's. Only removes markers
// whose sha is an ANCESTOR of keepSha (i.e. superseded on this line of history),
// so markers belonging to divergent branches / linked worktrees that share the
// git-common-dir are preserved (recording on branch B must not invalidate an
// unchanged, already-validated branch A). Best-effort.
// Collect the HEAD sha of every LIVE linked worktree of this repo (full-length).
// `git worktree list --porcelain` emits one block per worktree; a stale entry
// (e.g. its directory was `rm -rf`'d instead of `git worktree remove`d) carries a
// `prunable` line. Skip those, else their HEAD would protect markers forever.
function worktreeHeads(repoRoot) {
  const heads = new Set();
  const out = gitTry(repoRoot, ['worktree', 'list', '--porcelain']);
  if (!out) return heads;
  let head = null;
  let prunable = false;
  const flush = () => {
    if (head && !prunable) heads.add(head);
    head = null;
    prunable = false;
  };
  for (const line of out.split('\n')) {
    if (line === '') {
      flush(); // blank line = end of a worktree block
      continue;
    }
    const m = line.match(WORKTREE_HEAD_RE);
    if (m) head = m[1];
    else if (line.startsWith('prunable')) prunable = true;
  }
  flush(); // final block (output may not end in a blank line)
  return heads;
}

function pruneStale(repoRoot, gitDirAbs, prefix, keepSha) {
  // The common-dir is shared across linked worktrees, so another worktree may
  // still rely on an ancestor marker (as its exact HEAD, or via the docs-only
  // tolerance). Never prune a marker reachable from another worktree's HEAD.
  // Exclude THIS worktree's HEAD, otherwise our own line's ancestors would all
  // be protected and nothing would ever be pruned.
  const currentHead = gitTry(repoRoot, ['rev-parse', 'HEAD']);
  const otherHeads = [...worktreeHeads(repoRoot)].filter((h) => h !== currentHead);
  try {
    for (const f of fs.readdirSync(gitDirAbs)) {
      if (!f.startsWith(prefix) || f === `${prefix}${keepSha}`) continue;
      const sha = f.slice(prefix.length);
      if (!HEX_SHA_RE.test(sha)) continue;
      // Only prune a sibling that is an ancestor of the kept sha; divergent
      // (other-branch) markers are left intact.
      if (!gitOk(repoRoot, ['merge-base', '--is-ancestor', sha, keepSha])) continue;
      // ...but keep it if it's reachable from another worktree's HEAD.
      if (otherHeads.some((h) => gitOk(repoRoot, ['merge-base', '--is-ancestor', sha, h]))) continue;
      try {
        fs.unlinkSync(path.join(gitDirAbs, f));
      } catch (_e) {
        /* best-effort */
      }
    }
  } catch (_e) {
    /* best-effort */
  }
}

// Resolve the branch's base commit for three-dot diffs. Returns sha or null.
function resolveBase(repoRoot) {
  const candidates = ['origin/HEAD', 'origin/main', 'origin/master', 'main', 'master'];
  for (const c of candidates) {
    const mb = gitTry(repoRoot, ['merge-base', 'HEAD', c]);
    if (mb) return mb;
  }
  const sym = gitTry(repoRoot, ['symbolic-ref', '--quiet', 'refs/remotes/origin/HEAD']);
  if (sym) {
    const mb = gitTry(repoRoot, ['merge-base', 'HEAD', sym]);
    if (mb) return mb;
  }
  const def = gitTry(repoRoot, ['config', 'init.defaultBranch']);
  if (def) {
    const mb = gitTry(repoRoot, ['merge-base', 'HEAD', def]);
    if (mb) return mb;
  }
  return null;
}

// Run `git diff --name-only -z <args...>` and return the paths as an array, or
// null on git error. The `-z` is essential: without it git applies core.quotePath
// (wrapping non-ASCII/special paths in quotes with octal escapes), which would
// corrupt path-component parsing in isDocsOnly()/uiMislabelReason() and let a UI
// file with a non-ASCII path slip past the mislabel guard (wrong ALLOW).
function diffNamesZ(repoRoot, args) {
  try {
    // --no-renames: with rename detection on, `git diff --name-only` reports only
    // the rename DESTINATION, so `git mv src/app.ts docs/app.md` would look
    // docs-only and hide the code removal. --no-renames emits both the deleted
    // source and the added destination, so the source (non-docs) is seen.
    const out = git(repoRoot, ['diff', '--name-only', '-z', '--no-renames', ...args]);
    return out.split('\0').filter(Boolean);
  } catch (_e) {
    return null;
  }
}

// Three-dot: files changed since the branch diverged from base. null on error.
function changedSinceBase(repoRoot, base) {
  return diffNamesZ(repoRoot, [`${base}...HEAD`]);
}

// ---------------------------------------------------------------------------
// Evidence rules (validation-passed-<sha> marker). THE authoritative copy.
// ---------------------------------------------------------------------------

const CLASSES = new Set(['ui', 'backend', 'fullstack', 'other']);
const KINDS = new Set([
  'playwright', 'screenshot', 'e2e', 'test', 'unit', 'integration', 'clasp', 'smoke', 'build', 'lint',
]);
const UI_KINDS = new Set(['playwright', 'screenshot', 'e2e']);
const BACKEND_KINDS = new Set(['test', 'unit', 'integration', 'clasp', 'smoke']);
const OTHER_KINDS = new Set(['smoke', 'build', 'lint', 'test']);
const UI_EXT = /\.(vue|jsx|tsx|svelte|css|scss)$/i;
const EVIDENCE_SUBDIR = 'validation-evidence';

// Evidence lives in the git COMMON-DIR, never in the working tree:
//   <git-common-dir>/validation-evidence/<sha>/<stored-name>
// This is the key property for a globally-installed gate: the working tree of
// EVERY consuming repo stays untouched, so evidence can never be `git add`-ed,
// committed, or pushed anywhere — no per-repo .gitignore entry required. It is
// also shared across linked worktrees (same common-dir), so validating in one
// worktree and finishing from another works.
function evidenceDir(gitDirAbs, sha) {
  return path.join(gitDirAbs, EVIDENCE_SUBDIR, sha);
}

// Stored artifact names are plain basenames inside the evidence dir — reject
// anything with a path separator or traversal so a marker can't point outside it.
function safeStoredName(name) {
  if (typeof name !== 'string' || name.length === 0) return null;
  if (name.includes('/') || name.includes('\\') || name === '.' || name === '..') return null;
  return name;
}

// A valid stored artifact is a regular, non-empty file inside the evidence dir.
function artifactValid(evDir, name) {
  const safe = safeStoredName(name);
  if (!safe) return false;
  const p = path.join(evDir, safe);
  let st;
  try {
    st = fs.lstatSync(p); // lstat: a symlink is not a real artifact
  } catch (_e) {
    return false;
  }
  return st.isFile() && st.size > 0;
}

// Every sha that currently has a marker with this prefix — i.e. the set of
// evidence dirs still referenced by something. Returns null if the git dir can't
// be read, so callers can tell "no markers" (prune everything) apart from "don't
// know" (prune nothing). Pass the result straight to pruneEvidence.
function shasWithMarkers(gitDirAbs, prefix) {
  try {
    return fs
      .readdirSync(gitDirAbs)
      .filter((f) => f.startsWith(prefix))
      .map((f) => f.slice(prefix.length))
      .filter((sha) => HEX_SHA_RE.test(sha));
  } catch (_e) {
    return null; // unreadable -> caller must not prune
  }
}

// Remove evidence dirs whose marker is gone. MUST be called after every
// pruneStale() on the validation prefix, or a pruned marker orphans its evidence
// dir in the git common-dir forever (the checker and the recorder both do this).
// A null/non-array keepShas means "couldn't determine what's referenced" -> no-op,
// because pruning against an empty keep-set would delete every stored artifact.
function pruneEvidence(gitDirAbs, keepShas) {
  if (!Array.isArray(keepShas)) return;
  const root = path.join(gitDirAbs, EVIDENCE_SUBDIR);
  const keep = new Set(keepShas);
  let entries;
  try {
    entries = fs.readdirSync(root);
  } catch (_e) {
    return; // nothing stored yet
  }
  for (const sha of entries) {
    if (keep.has(sha)) continue;
    try {
      fs.rmSync(path.join(root, sha), { recursive: true, force: true });
    } catch (_e) {
      /* best-effort */
    }
  }
}

function fail(reason) {
  return { ok: false, reason };
}

/**
 * validateEvidence(marker, ctx) -> { ok, reason }
 * ctx: { evidenceDir, changedFiles?:string[]|null }
 *   evidenceDir — <git-common-dir>/validation-evidence/<sha>; artifacts are
 *   STORED names (basenames) inside it, never working-tree paths.
 * Enforced identically by record-validation.cjs (write time) and
 * check-validation.cjs (gate time).
 */
function validateEvidence(marker, ctx) {
  if (!marker || typeof marker !== 'object' || Array.isArray(marker)) {
    return fail('marker is not a JSON object');
  }
  const cls = marker.changeClass;
  if (!CLASSES.has(cls)) return fail(`invalid changeClass '${cls}' (expected ui|backend|fullstack|other)`);

  const checks = marker.checks;
  const noAuto = marker.noAutomatableCheck === true;
  const rationale = typeof marker.rationale === 'string' ? marker.rationale.trim() : '';
  const attested = noAuto && rationale.length > 0;

  // UI-mislabel guard, shared by the attestation path and the post-checks path
  // (so an "other" attestation can't skip it): a backend/other class whose diff
  // clearly contains UI files, with no UI evidence recorded, is mislabeled.
  const uiMislabelReason = () => {
    if (!Array.isArray(ctx.changedFiles)) return null;
    if (cls !== 'backend' && cls !== 'other') return null;
    // Exempt docs-only paths first — the rest of the gate treats docs as
    // non-code, so a doc under docs/components/ or a docs/*.tsx must not be
    // misread as UI source and wrongly block a backend/other change.
    const uiFiles = ctx.changedFiles.filter(
      (p) => !isDocsOnly(p) && (UI_EXT.test(p) || p.split('/').includes('components')),
    );
    if (uiFiles.length === 0) return null;
    return `changeClass "${cls}" but the diff contains UI files (${uiFiles.slice(0, 3).join(', ')}) with no UI evidence — reclassify as ui/fullstack and add a Playwright walk`;
  };

  if (!Array.isArray(checks) || checks.length === 0) {
    if (cls === 'other' && attested) {
      const m = uiMislabelReason();
      return m ? fail(m) : { ok: true, reason: 'attested (no automatable check)' };
    }
    return fail('"checks" must be a non-empty array (or changeClass:other with noAutomatableCheck+rationale)');
  }

  for (let i = 0; i < checks.length; i++) {
    const c = checks[i];
    if (!c || typeof c !== 'object' || Array.isArray(c)) return fail(`checks[${i}] is not an object`);
    if (!KINDS.has(c.kind)) {
      return fail(`checks[${i}].kind '${c.kind}' is not a recognized kind (expected ${[...KINDS].join('|')})`);
    }
    if (typeof c.exitCode !== 'number' || c.exitCode !== 0) {
      return fail(`checks[${i}].exitCode must be the number 0 (got ${JSON.stringify(c.exitCode)})`);
    }
    if (typeof c.command !== 'string' || c.command.trim() === '') return fail(`checks[${i}].command is required`);
    if (!Array.isArray(c.artifacts)) return fail(`checks[${i}].artifacts must be an array`);
    // EVERY listed artifact must be valid — not just one (a `.some()` minimum
    // below would otherwise let bogus absolute/traversal/missing entries ride
    // alongside a single real one).
    for (let j = 0; j < c.artifacts.length; j++) {
      const a = c.artifacts[j];
      if (typeof a !== 'string' || a.length === 0) return fail(`checks[${i}].artifacts[${j}] must be a non-empty string`);
      if (!artifactValid(ctx.evidenceDir, a)) {
        return fail(`checks[${i}].artifacts[${j}] '${a}' is not a stored non-empty evidence file`);
      }
    }
  }

  const hasKindWithArtifact = (kindSet) =>
    checks.some(
      (c) => kindSet.has(c.kind) && c.exitCode === 0 && c.artifacts.some((a) => artifactValid(ctx.evidenceDir, a)),
    );
  const uiOk = hasKindWithArtifact(UI_KINDS);
  const backendOk = hasKindWithArtifact(BACKEND_KINDS);
  const otherOk = hasKindWithArtifact(OTHER_KINDS);
  const e2eOk = hasKindWithArtifact(new Set(['e2e'])); // an e2e run exercises both UI and backend

  if (cls === 'ui' && !uiOk) {
    return fail('changeClass "ui" requires a playwright/screenshot/e2e check with a recorded artifact (screenshot)');
  }
  if (cls === 'backend' && !backendOk) {
    return fail('changeClass "backend" requires a test/unit/integration/clasp/smoke check (exit 0) with a recorded log artifact');
  }
  if (cls === 'fullstack' && !((uiOk || e2eOk) && (backendOk || e2eOk))) {
    return fail('changeClass "fullstack" requires BOTH UI and backend evidence (a single artifacted e2e check satisfies both)');
  }
  if (cls === 'other' && !(otherOk || attested)) {
    return fail('changeClass "other" requires a smoke/build/lint/test check with a recorded log artifact, or noAutomatableCheck:true + rationale');
  }

  // changeClass-vs-diff cross-check (conservative; only the clear-cut mislabel).
  if (!uiOk) {
    const m = uiMislabelReason();
    if (m) return fail(m);
  }

  return { ok: true, reason: 'evidence valid' };
}

module.exports = {
  git,
  gitTry,
  gitOk,
  resolveRepoRoot,
  resolveGit,
  isDocsOnly,
  findValidMarker,
  pruneStale,
  worktreeHeads,
  evidenceDir,
  shasWithMarkers,
  pruneEvidence,
  safeStoredName,
  diffNamesZ,
  resolveBase,
  changedSinceBase,
  validateEvidence,
  artifactValid,
  // exported for tests
  _internals: { CLASSES, KINDS, UI_KINDS, BACKEND_KINDS, OTHER_KINDS, EVIDENCE_SUBDIR },
};
