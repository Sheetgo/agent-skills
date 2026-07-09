#!/usr/bin/env node
'use strict';
/**
 * record-validation.cjs — write a `validation-passed-<sha>` evidence marker.
 *
 * Reads a JSON payload from STDIN:
 *   { "changeClass": "ui|backend|fullstack|other",
 *     "checks": [ { "kind", "command", "exitCode", "artifacts": ["<path>", ...] } ],
 *     "noAutomatableCheck": false, "rationale": "" }
 *
 * `artifacts` are paths to files you actually produced (a Playwright screenshot,
 * a captured test log — wherever your tooling wrote them; relative to the repo
 * root or absolute). This script COPIES each one into the repo's git common-dir:
 *
 *     <git-common-dir>/validation-evidence/<HEAD-sha>/<stored-name>
 *
 * The working tree is never touched. That matters because this gate is installed
 * GLOBALLY (symlinked into ~/.claude) and runs against every repo you work in —
 * evidence must never be `git add`-able, committable, or pushable in any of them,
 * and must not require a per-repo .gitignore entry. The marker records the STORED
 * names, and the checker validates the stored copies.
 *
 * Usage: record-validation.cjs [--repo-root <abs-path>]
 * Exit codes: 0 written · 1 invalid evidence (nothing written) · 2 infra error.
 */

const fs = require('node:fs');
const path = require('node:path');
const lib = require('./gate-lib.cjs');

const PREFIX = 'validation-passed-';
const MAX_STDIN_BYTES = 64 * 1024;
const MAX_ARTIFACT_BYTES = 25 * 1024 * 1024; // don't copy absurd files into .git

const argv = process.argv.slice(2);
const repoRootIdx = argv.indexOf('--repo-root');
const explicitRoot = repoRootIdx >= 0 ? argv[repoRootIdx + 1] : null;

function die(code, msg) {
  if (code !== 0 && typeof cleanupStage === 'function') cleanupStage();
  process.stdout.write(`[code-review:record-validation] ${msg}\n`);
  process.exit(code);
}

function readStdin() {
  let raw;
  try {
    raw = fs.readFileSync(0, 'utf8');
  } catch (e) {
    die(2, `cannot read stdin: ${e.message}`);
  }
  if (raw.length > MAX_STDIN_BYTES) die(1, `payload too large (${raw.length} bytes)`);
  if (!raw.trim()) die(1, 'empty payload on stdin (expected a JSON object)');
  try {
    return JSON.parse(raw);
  } catch (e) {
    die(1, `payload is not valid JSON: ${e.message}`);
  }
}

let repoRoot;
let gitDirAbs;
let headSha;
try {
  repoRoot = lib.resolveRepoRoot(explicitRoot);
  ({ gitDirAbs, headSha } = lib.resolveGit(repoRoot));
} catch (e) {
  die(2, `infra: ${e.message}`);
}

const payload = readStdin();
const evDir = lib.evidenceDir(gitDirAbs, headSha);
// Stage into a sibling temp dir and only swap into place on success — a REJECTED
// recording must never destroy evidence from an earlier successful one at the
// same sha. (Same filesystem as evDir, so the swap is a cheap rename.)
const stageDir = `${evDir}.staging-${process.pid}`;

function cleanupStage() {
  try {
    fs.rmSync(stageDir, { recursive: true, force: true });
  } catch (_e) {
    /* best-effort */
  }
}

// ---- ingest artifacts: validate the SOURCE file, then copy into the store ----
// Stored name = "<checkIndex>-<artIndex>-<sanitized basename>" so two checks can
// ship files with the same basename without colliding.
function ingest(srcPath, checkIndex, artIndex) {
  if (typeof srcPath !== 'string' || srcPath.length === 0) {
    die(1, `checks[${checkIndex}].artifacts[${artIndex}] must be a non-empty string`);
  }
  const abs = path.isAbsolute(srcPath) ? srcPath : path.resolve(repoRoot, srcPath);
  let st;
  try {
    st = fs.statSync(abs); // follows symlinks: we copy the real bytes
  } catch (_e) {
    die(1, `artifact not found: '${srcPath}' (produce it first, then record)`);
  }
  if (!st.isFile()) die(1, `artifact is not a regular file: '${srcPath}'`);
  if (st.size === 0) die(1, `artifact is empty: '${srcPath}' (0 bytes is not evidence)`);
  if (st.size > MAX_ARTIFACT_BYTES) {
    die(1, `artifact too large to store: '${srcPath}' (${st.size} bytes > ${MAX_ARTIFACT_BYTES})`);
  }
  const base = path.basename(abs).replace(/[^\w.\-]/g, '_') || 'artifact';
  const stored = `${checkIndex}-${artIndex}-${base}`;
  if (!lib.safeStoredName(stored)) die(2, `could not derive a safe stored name for '${srcPath}'`);
  try {
    fs.mkdirSync(stageDir, { recursive: true });
    fs.copyFileSync(abs, path.join(stageDir, stored));
  } catch (e) {
    die(2, `cannot store artifact '${srcPath}': ${e.message}`);
  }
  return stored;
}

const checks = Array.isArray(payload.checks) ? payload.checks : [];
const storedChecks = checks.map((c, i) => {
  if (!c || typeof c !== 'object' || Array.isArray(c)) die(1, `checks[${i}] is not an object`);
  const arts = Array.isArray(c.artifacts) ? c.artifacts : [];
  return { ...c, artifacts: arts.map((a, j) => ingest(a, i, j)) };
});

// ---- validate with the SAME rules the checker enforces (parity by construction)
let changedFiles = null;
const base = lib.resolveBase(repoRoot);
if (base) changedFiles = lib.changedSinceBase(repoRoot, base);

const candidate = { ...payload, checks: storedChecks };
// Validate against the STAGED copies; die() cleans up the stage on rejection,
// leaving any previously-recorded evidence for this sha intact.
const verdict = lib.validateEvidence(candidate, { evidenceDir: stageDir, changedFiles });
if (!verdict.ok) die(1, `refusing to record — ${verdict.reason}`);

// Accepted — swap the staged evidence into place, replacing any earlier run for
// this sha. Move the old dir ASIDE first and only delete it once the new one is
// safely installed: deleting before the rename would, on any failure in that
// window (ENOSPC/EACCES/EXDEV/kill), destroy still-valid evidence and leave the
// existing marker dangling — a permanent false-block with no recovery.
const backupDir = `${evDir}.old-${process.pid}`;
let hadOld = false;
try {
  fs.mkdirSync(path.dirname(evDir), { recursive: true });
  hadOld = fs.existsSync(evDir);
  if (hadOld) fs.renameSync(evDir, backupDir);
  try {
    if (fs.existsSync(stageDir)) {
      fs.renameSync(stageDir, evDir);
    } else {
      fs.mkdirSync(evDir, { recursive: true }); // attestation path: no artifacts
    }
  } catch (e) {
    restoreEvidence();
    throw e;
  }
  // NOTE: backupDir is deliberately NOT deleted here. It stays until the marker
  // is durably written, so a failing marker write can still roll the store back
  // (see below) instead of leaving evidence with no marker pointing at it.
} catch (e) {
  die(2, `cannot commit evidence store: ${e.message}`);
}

// Undo the swap: drop whatever is now at evDir and put the previous evidence back
// exactly as it was (or leave no dir at all, if there was none). Best-effort.
function restoreEvidence() {
  try {
    fs.rmSync(evDir, { recursive: true, force: true });
    if (hadOld) fs.renameSync(backupDir, evDir);
  } catch (_e) {
    /* best-effort */
  }
}

// Normalize the marker written to disk (never trust caller-supplied sha/createdAt).
const marker = {
  sha: headSha,
  changeClass: payload.changeClass,
  checks: storedChecks,
  noAutomatableCheck: payload.noAutomatableCheck === true,
  rationale: typeof payload.rationale === 'string' ? payload.rationale : '',
  createdAt: new Date().toISOString(),
};

const markerPath = path.join(gitDirAbs, `${PREFIX}${headSha}`);
try {
  fs.writeFileSync(markerPath, `${JSON.stringify(marker, null, 2)}\n`);
} catch (e) {
  // The evidence is already swapped in, so unwind it — otherwise a failed marker
  // write leaves a populated evidence dir that nothing references.
  restoreEvidence();
  die(2, `cannot write marker: ${e.message}`);
}

// Marker is durable — the pre-swap evidence can finally go.
if (hadOld) {
  try {
    fs.rmSync(backupDir, { recursive: true, force: true });
  } catch (_e) {
    /* best-effort */
  }
}

lib.pruneStale(repoRoot, gitDirAbs, PREFIX, headSha);
// Drop evidence dirs whose marker no longer exists.
lib.pruneEvidence(gitDirAbs, lib.shasWithMarkers(gitDirAbs, PREFIX));

const n = storedChecks.reduce((acc, c) => acc + c.artifacts.length, 0);
die(0, `recorded ${marker.changeClass} validation for HEAD ${headSha.slice(0, 8)} (${n} artifact(s) stored in the git dir — working tree untouched)`);
