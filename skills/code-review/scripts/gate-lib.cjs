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

function git(repoRoot, args, timeoutMs = GIT_TIMEOUT_MS) {
  return execFileSync('git', ['-C', repoRoot, ...args], {
    encoding: 'utf8',
    stdio: ['ignore', 'pipe', 'pipe'],
    timeout: timeoutMs,
  });
}

/**
 * Git's DERIVED CACHES — the commit-graph (`objects/info/commit-graph`) and the
 * multi-pack-index (`objects/pack/*.midx`) — answer reachability questions without
 * walking the real objects. They are written by `git gc` in essentially every repo
 * (`gc.writeCommitGraph` defaults to true), and a single corrupt byte in one makes
 * `for-each-ref --contains` and `merge-base --is-ancestor` report a commit that IS
 * on master as unreachable — while every object and permission is perfectly intact,
 * so no integrity check on the object store can see it.
 *
 * Trying to VALIDATE each cache is a losing game (commit-graph, then midx, then the
 * next one). Instead, do not consult them: every query whose answer could get a
 * marker DELETED runs with the caches off, so it walks real objects. Slower, and
 * irrelevant — only the human-invoked gate-gc pays for it.
 */
const NO_DERIVED_CACHES = ['-c', 'core.commitGraph=false', '-c', 'core.multiPackIndex=false'];

function gitRaw(repoRoot, args, timeoutMs = GIT_TIMEOUT_MS) {
  return git(repoRoot, [...NO_DERIVED_CACHES, ...args], timeoutMs);
}

// Trimmed stdout, or null on any failure. Caches OFF.
function gitRawTry(repoRoot, args) {
  try {
    return gitRaw(repoRoot, args).trim();
  } catch (_e) {
    return null;
  }
}

// True iff the command exits 0. Caches OFF.
function gitRawOk(repoRoot, args) {
  try {
    gitRaw(repoRoot, args);
    return true;
  } catch (_e) {
    return false;
  }
}

// `git verify-pack` reads the whole pack, so it needs far more than the default
// budget. Only the human-invoked gate-gc pays this; nothing on the push path does.
const PACK_VERIFY_TIMEOUT_MS = 120000;

// { ok } | { ok:false, reason } — distinguishes a CORRUPT pack from one we simply
// could not finish checking. Both refuse the sweep, but the human is told which.
function verifyPack(repoRoot, packPath) {
  try {
    execFileSync('git', ['-C', repoRoot, 'verify-pack', packPath], {
      stdio: 'ignore',
      timeout: PACK_VERIFY_TIMEOUT_MS,
    });
    return { ok: true };
  } catch (e) {
    if (e.killed || e.code === 'ETIMEDOUT' || e.signal) {
      return { ok: false, reason: 'could not be verified in time' };
    }
    return { ok: false, reason: 'is corrupt (failed git verify-pack)' };
  }
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

/**
 * Does this commit still exist in the object DB? Returns true / false / null,
 * where null = "git could not tell us".
 *
 * This distinction is load-bearing and easy to get catastrophically wrong.
 * `gitOk()` collapses "the object is gone" and "git failed" into the same `false`,
 * and pruning on a git error DELETES A LIVE MARKER — and, downstream, the stored
 * validation evidence it points at.
 *
 * Exit codes alone cannot separate the two cases (empirically, git 2.52):
 *   absent object     -> `cat-file -e` 128 | `rev-parse --verify -q` 1, stderr EMPTY
 *   unreadable object -> `cat-file -e` 128 | `rev-parse --verify -q` 1, stderr "error: ..."
 * Only `rev-parse --verify --quiet` discriminates, via an empty stderr. A
 * permissions fault, an I/O error, a concurrent `git gc`, or a timeout must all
 * come back as null (keep), never as "gone" (prune).
 */
function commitExists(repoRoot, sha) {
  try {
    // Caches OFF: a corrupt commit-graph can make a live commit look absent.
    execFileSync('git', ['-C', repoRoot, ...NO_DERIVED_CACHES, 'rev-parse', '--verify', '--quiet', `${sha}^{commit}`], {
      encoding: 'utf8',
      stdio: ['ignore', 'pipe', 'pipe'],
      timeout: GIT_TIMEOUT_MS,
    });
    return true;
  } catch (e) {
    // --quiet suppresses output for a genuinely-absent object; anything on stderr
    // means git hit a real problem and we must not conclude "gone".
    if (e.status === 1 && !String(e.stderr || '').trim()) return false;
    return null;
  }
}

/**
 * POSITIVE CONTROL — can this repo read its object store at all?
 *
 * `commitExists` alone is NOT enough to trust an "absent" verdict. For LOOSE objects,
 * unreadable-vs-absent is distinguishable by stderr. For PACKED objects it is NOT:
 * an unreadable pack makes `rev-parse --verify --quiet` exit 1 with EMPTY stderr —
 * byte-for-byte the same answer as a genuinely-absent object. And after any `git gc`
 * (which git runs on its own via gc.auto) essentially all history lives in packs.
 *
 * So before believing any object is "gone", read a commit we KNOW exists: HEAD. If
 * even THAT cannot be read, the store is faulted (unreadable pack, permission fault,
 * concurrent gc, I/O error) and every "absent"/"unreachable" answer is worthless —
 * we must sweep nothing. An unborn HEAD also lands here, which is fine: a repo with
 * no commits has no markers worth collecting.
 */
function objectStoreReadable(repoRoot) {
  return commitExists(repoRoot, 'HEAD') === true;
}

/**
 * Preflight for the ONLY operation that acts on an "this object is gone" verdict —
 * the human-invoked gate-gc sweep. Returns { ok, problems: [] }.
 *
 * Why a filesystem check and not a git one: git cannot be asked "is this object
 * absent, or merely unreadable?". Under a fault it answers IDENTICALLY for both,
 * at every level we probed (git 2.52):
 *
 *   absent               | unreadable
 *   ---------------------|------------------------------------------
 *   cat-file -e     128  | 128
 *   rev-parse -q    1    | 1  (+ EMPTY stderr too, for PACKED objects)
 *   for-each-ref    129  | 129, "error: no such commit <sha>"
 *   batch-all-objects    | rc=0, silently omits the object
 *
 * So "gone" can never be inferred from a git failure. Instead, prove the store is
 * intact FIRST, and refuse to sweep at all if it isn't.
 *
 * READABILITY IS NOT ENOUGH. A pack can keep perfectly good permissions and still be
 * CORRUPT — bit rot, a truncated write, a killed `git gc`, a bad copy. A single
 * flipped byte inside a pack makes git report the live, tag-reachable commits it
 * holds as absent, with the same empty-stderr exit 1 as a deleted object, while
 * `access(R_OK)` happily succeeds. So we run git's own integrity check
 * (`verify-pack`) over every pack. That is expensive — which is precisely why this
 * whole operation is a human-invoked maintenance command and not something on the
 * push path.
 */
function objectStoreIntact(repoRoot, gitDirAbs) {
  const problems = [];

  // Objects can live in ALTERNATE stores (`git clone --reference`, shared CI caches,
  // submodule object sharing). A faulted alternate makes commits that live only there
  // look absent, and no amount of checking THIS repo's packs can see it — so check
  // every store, not just ours. Alternates may chain, so walk them transitively.
  const stores = [];
  const seen = new Set();
  const queue = [path.join(gitDirAbs, 'objects')];
  while (queue.length) {
    const dir = path.resolve(queue.shift());
    if (seen.has(dir)) continue;
    seen.add(dir);
    stores.push(dir);
    const altFile = path.join(dir, 'info', 'alternates');
    let raw = null;
    try {
      raw = fs.readFileSync(altFile, 'utf8');
    } catch (e) {
      if (e.code !== 'ENOENT') problems.push(`unreadable alternates file: ${altFile}`);
      continue;
    }
    for (const line of raw.split('\n').map((l) => l.trim()).filter(Boolean)) {
      if (line.startsWith('#')) continue;
      queue.push(path.isAbsolute(line) ? line : path.resolve(dir, line));
    }
  }

  for (const objects of stores) {
    const label = objects === path.join(gitDirAbs, 'objects') ? 'objects' : objects;
    try {
      fs.accessSync(objects, fs.constants.R_OK | fs.constants.X_OK);
    } catch (_e) {
      problems.push(`object store is not readable: ${objects}`);
      continue;
    }
    const packDir = path.join(objects, 'pack');
    let entries = [];
    try {
      entries = fs.readdirSync(packDir);
    } catch (e) {
      if (e.code !== 'ENOENT') problems.push(`pack directory is not readable: ${packDir}`);
      continue;
    }
    for (const f of entries) {
      if (!/\.(pack|idx)$/.test(f)) continue;
      const p = path.join(packDir, f);
      // (a) permissions — an unreadable pack makes git say "no such commit" for live commits
      try {
        fs.accessSync(p, fs.constants.R_OK);
      } catch (_e) {
        problems.push(`unreadable pack file: ${label}/pack/${f}`);
        continue;
      }
      // (b) integrity — a READABLE but corrupt pack produces the same lie, silently
      if (f.endsWith('.pack')) {
        const v = verifyPack(repoRoot, p);
        if (!v.ok) problems.push(`${label}/pack/${f} ${v.reason}`);
      }
    }
  }

  if (!objectStoreReadable(repoRoot)) {
    problems.push("cannot read HEAD's own commit — the object store is not answering");
  }
  return { ok: problems.length === 0, problems };
}

// The things a commit can still be reached from, plus the positive control. Built
// ONCE per sweep (4 git calls), not per marker. `reflog` is null if it could not be
// enumerated -> unknown.
function reachabilityRoots(repoRoot) {
  const reflogOut = gitRawTry(repoRoot, ['reflog', 'show', '--all', '--format=%H']);
  return {
    heads: worktreeHeads(repoRoot),
    reflog: reflogOut === null ? null : new Set(reflogOut.split('\n').filter(Boolean)),
    storeReadable: objectStoreReadable(repoRoot),
  };
}

/**
 * Is `sha` still reachable from anything that matters? true / false / null.
 *
 * "Reachable" deliberately includes the REFLOG. A marker lives exactly as long as
 * its commit is recoverable: `git reset --hard` and `/undo-squash` are ordinary
 * undo workflows, and a commit one `git reset --hard @{1}` away from being HEAD
 * again must not have its marker (and its evidence) destroyed underneath it. The
 * leak this closes therefore becomes *bounded by git's own gc schedule* rather
 * than eliminated instantly: once the reflog entry expires
 * (`gc.reflogExpireUnreachable`, 30d default) or the object is gc'd, the marker is
 * collected. That is the correct trade — a missed prune costs a few KB; a false
 * prune costs re-running the actual validation.
 */
function isShaReachable(repoRoot, sha, roots) {
  const r = roots || reachabilityRoots(repoRoot);

  // Set membership first — no subprocess. This is the common case by far: a marker
  // is written for a commit that was HEAD, so it is a reflog entry. It keeps the
  // per-invocation cost of the sweep at ~0 for every marker that is obviously live,
  // which matters because this runs on every push and every finish attempt.
  if (r.reflog && r.reflog.has(sha)) return true;
  if (r.heads.has(sha)) return true;

  const exists = commitExists(repoRoot, sha);
  if (exists === null) return null; // git errored -> unknown -> keep
  if (exists === false) {
    // "Absent" is only believable if the store demonstrably reads. An unreadable
    // PACK produces this exact answer for commits that are perfectly fine.
    return r.storeReadable ? false : null;
  }

  // `--contains` covers every ref: branches, tags, remotes, stash, notes. Caches OFF —
  // this answer can get a marker deleted, so it must walk real objects.
  const refs = gitRawTry(repoRoot, ['for-each-ref', '--contains', sha, '--count=1', '--format=%(refname)']);
  if (refs === null) return null; // git error -> unknown -> keep
  if (refs !== '') return true;

  if (r.reflog === null) return null; // couldn't enumerate the reflog -> unknown -> keep
  if (!r.storeReadable) return null; // faulted store -> no negative answer is trustworthy

  // An ANCESTOR of a detached worktree HEAD (which is not a ref) is still needed.
  for (const h of r.heads) {
    if (gitRawOk(repoRoot, ['merge-base', '--is-ancestor', sha, h])) return true;
  }
  return false;
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
  isShaReachable,
  commitExists,
  objectStoreIntact,
  reachabilityRoots,
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
