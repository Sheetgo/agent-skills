'use strict';
/**
 * Tests for the finishing/push gate library and checkers.
 * Run: node --test skills/code-review/scripts/__tests__/gate-lib.test.cjs
 *
 * Unit tests exercise pure logic; integration tests build throwaway git repos
 * and run the real check/record scripts end-to-end.
 */

const test = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { execFileSync } = require('node:child_process');

const SCRIPTS = path.resolve(__dirname, '..');
const lib = require(path.join(SCRIPTS, 'gate-lib.cjs'));

// ---- helpers ---------------------------------------------------------------

function mkTmp(prefix) {
  return fs.mkdtempSync(path.join(os.tmpdir(), prefix));
}

function git(repo, args, opts = {}) {
  return execFileSync('git', ['-C', repo, ...args], {
    encoding: 'utf8',
    env: {
      ...process.env,
      GIT_AUTHOR_NAME: 'T', GIT_AUTHOR_EMAIL: 't@t',
      GIT_COMMITTER_NAME: 'T', GIT_COMMITTER_EMAIL: 't@t',
    },
    ...opts,
  }).trim();
}

function initRepo() {
  const repo = mkTmp('gate-repo-');
  git(repo, ['init', '-q']);
  git(repo, ['config', 'commit.gpgsign', 'false']);
  return repo;
}

function writeFile(repo, rel, content = 'x') {
  const p = path.join(repo, rel);
  fs.mkdirSync(path.dirname(p), { recursive: true });
  fs.writeFileSync(p, content);
  return p;
}

function commitAll(repo, msg) {
  git(repo, ['add', '-A']);
  git(repo, ['commit', '-q', '-m', msg]);
  return git(repo, ['rev-parse', 'HEAD']);
}

function commonDir(repo) {
  const d = git(repo, ['rev-parse', '--git-common-dir']);
  return path.isAbsolute(d) ? d : path.join(repo, d);
}

function runScript(name, repo, extraArgs = [], input) {
  const args = [path.join(SCRIPTS, name), '--repo-root', repo, ...extraArgs];
  try {
    const stdout = execFileSync('node', args, { encoding: 'utf8', input });
    return { code: 0, out: stdout.trim() };
  } catch (e) {
    return { code: e.status, out: (e.stdout || '').toString().trim() };
  }
}

// ---- isDocsOnly ------------------------------------------------------------

test('isDocsOnly: docs/session-state/.md are docs; code is not', () => {
  const yes = ['docs/x.md', 'docs/validation/a.png', '.claude/sessions/feat%2Fx/m',
    'README.md', 'a/b/NOTES.MD'];
  const no = ['.claude/settings.json', '.claude/hooks/x.py', 'src/docs/x.ts',
    'vendor/adocs/build.js', 'src/app.js', 'docsy/x.js', 'x.mdx'];
  for (const p of yes) assert.ok(lib.isDocsOnly(p), `expected docs: ${p}`);
  for (const p of no) assert.ok(!lib.isDocsOnly(p), `expected NOT docs: ${p}`);
});

// ---- artifactValid ---------------------------------------------------------

test('artifactValid: stored evidence files in the git-dir store', () => {
  const evDir = mkTmp('gate-ev-store-');
  fs.writeFileSync(path.join(evDir, 'good.png'), 'PNGDATA');
  fs.writeFileSync(path.join(evDir, 'empty.png'), '');
  fs.mkdirSync(path.join(evDir, 'adir'), { recursive: true });
  const outside = mkTmp('gate-out-');
  fs.writeFileSync(path.join(outside, 'secret.txt'), 'S');
  fs.symlinkSync(path.join(outside, 'secret.txt'), path.join(evDir, 'link.png'));

  assert.ok(lib.artifactValid(evDir, 'good.png'), 'stored non-empty file');
  assert.ok(!lib.artifactValid(evDir, 'empty.png'), 'empty file');
  assert.ok(!lib.artifactValid(evDir, 'adir'), 'directory');
  assert.ok(!lib.artifactValid(evDir, 'link.png'), 'symlink is not a real artifact');
  assert.ok(!lib.artifactValid(evDir, 'missing.png'), 'nonexistent');
  // Stored names are basenames only — no escaping the store.
  assert.ok(!lib.artifactValid(evDir, '../secret.txt'), 'traversal name');
  assert.ok(!lib.artifactValid(evDir, 'sub/x.png'), 'name with separator');
  assert.ok(!lib.artifactValid(evDir, '/etc/hosts'), 'absolute name');
  assert.strictEqual(lib.safeStoredName('../x'), null, 'safeStoredName rejects traversal');
  assert.strictEqual(lib.safeStoredName('ok.png'), 'ok.png', 'safeStoredName accepts a basename');
});

test('changedSinceBase: a code→docs rename is not misread as docs-only (regression final)', () => {
  const repo = initRepo();
  writeFile(repo, 'src/app.ts', 'code');
  const BASE = commitAll(repo, 'base with code');
  git(repo, ['checkout', '-q', '-b', 'feat', BASE]);
  fs.mkdirSync(path.join(repo, 'docs'), { recursive: true }); // git mv needs the dest dir
  git(repo, ['mv', 'src/app.ts', 'docs/app.md']); // rename code file into docs/
  commitAll(repo, 'move code into docs');
  const changed = lib.changedSinceBase(repo, BASE);
  assert.ok(changed.includes('src/app.ts'), `--no-renames must surface the deleted source, got ${JSON.stringify(changed)}`);
  assert.ok(!changed.every(lib.isDocsOnly), 'a code-file rename into docs must NOT classify as docs-only');
});

// ---- validateEvidence ------------------------------------------------------

// A git repo plus a populated evidence store in its git-dir (what record-validation
// would have created). Evidence never touches the working tree.
function evidenceRepo() {
  const repo = initRepo();
  writeFile(repo, 'base.txt', 'base');
  const sha = commitAll(repo, 'base');
  const evDir = lib.evidenceDir(commonDir(repo), sha);
  fs.mkdirSync(evDir, { recursive: true });
  fs.writeFileSync(path.join(evDir, 'shot.png'), 'PNG');
  fs.writeFileSync(path.join(evDir, 'test.log'), 'ok');
  return { repo, evDir, sha };
}

test('validateEvidence: ui requires an artifacted UI check', () => {
  const { evDir } = evidenceRepo();
  const ok = lib.validateEvidence(
    { changeClass: 'ui', checks: [{ kind: 'playwright', command: 'x', exitCode: 0, artifacts: ['shot.png'] }] },
    { evidenceDir: evDir });
  assert.ok(ok.ok, ok.reason);
  const noArt = lib.validateEvidence(
    { changeClass: 'ui', checks: [{ kind: 'playwright', command: 'x', exitCode: 0, artifacts: [] }] },
    { evidenceDir: evDir });
  assert.ok(!noArt.ok, 'ui with no artifact must fail');
});

test('validateEvidence: backend now needs a log artifact', () => {
  const { evDir } = evidenceRepo();
  const noArt = lib.validateEvidence(
    { changeClass: 'backend', checks: [{ kind: 'test', command: 'npm test', exitCode: 0, artifacts: [] }] },
    { evidenceDir: evDir });
  assert.ok(!noArt.ok, 'backend with no artifact must fail (v1 hole)');
  const withArt = lib.validateEvidence(
    { changeClass: 'backend', checks: [{ kind: 'test', command: 'npm test', exitCode: 0, artifacts: ['test.log'] }] },
    { evidenceDir: evDir });
  assert.ok(withArt.ok, withArt.reason);
});

test('validateEvidence: nonzero exit, bad types, empty checks rejected', () => {
  const { evDir } = evidenceRepo();
  const bad = [
    { changeClass: 'backend', checks: [{ kind: 'test', command: 'x', exitCode: 1, artifacts: ['test.log'] }] },
    { changeClass: 'backend', checks: [{ kind: 'test', command: 'x', exitCode: '0', artifacts: ['test.log'] }] },
    { changeClass: 'ui', checks: [] },
    { changeClass: 'nope', checks: [{ kind: 'test', command: 'x', exitCode: 0, artifacts: [] }] },
    { changeClass: 'ui', checks: [{ kind: 'frobnicate', command: 'x', exitCode: 0, artifacts: ['shot.png'] }] },
  ];
  for (const m of bad) assert.ok(!lib.validateEvidence(m, { evidenceDir: evDir }).ok, JSON.stringify(m));
});

test('validateEvidence: other allows attestation, and smoke+log', () => {
  const { evDir } = evidenceRepo();
  const attested = lib.validateEvidence(
    { changeClass: 'other', checks: [], noAutomatableCheck: true, rationale: 'infra-only settings change' },
    { evidenceDir: evDir });
  assert.ok(attested.ok, attested.reason);
  const attestedNoReason = lib.validateEvidence(
    { changeClass: 'other', checks: [], noAutomatableCheck: true, rationale: '' },
    { evidenceDir: evDir });
  assert.ok(!attestedNoReason.ok, 'attestation needs a rationale');
  const smoke = lib.validateEvidence(
    { changeClass: 'other', checks: [{ kind: 'build', command: 'npm run build', exitCode: 0, artifacts: ['test.log'] }] },
    { evidenceDir: evDir });
  assert.ok(smoke.ok, smoke.reason);
});

test('validateEvidence: fullstack satisfied by a single artifacted e2e check (regression C1)', () => {
  const { evDir } = evidenceRepo();
  const res = lib.validateEvidence(
    { changeClass: 'fullstack', checks: [{ kind: 'e2e', command: 'npm run e2e', exitCode: 0, artifacts: ['shot.png'] }] },
    { evidenceDir: evDir });
  assert.ok(res.ok, `e2e should satisfy both tiers of fullstack: ${res.reason}`);
});

test('validateEvidence: other+attestation cannot skip UI-mislabel guard (regression C2)', () => {
  const { evDir } = evidenceRepo();
  const mislabeled = lib.validateEvidence(
    { changeClass: 'other', checks: [], noAutomatableCheck: true, rationale: 'infra' },
    { evidenceDir: evDir, changedFiles: ['src/LoginForm.tsx'] });
  assert.ok(!mislabeled.ok, 'other+attestation with UI files in diff must fail');
  const clean = lib.validateEvidence(
    { changeClass: 'other', checks: [], noAutomatableCheck: true, rationale: 'infra' },
    { evidenceDir: evDir, changedFiles: ['hooks/x.py', 'docs/y.md'] });
  assert.ok(clean.ok, `other+attestation with no UI files should pass: ${clean.reason}`);
});

test('validateEvidence: UI-mislabel guard exempts docs-only paths (regression round3)', () => {
  const { evDir } = evidenceRepo();
  // A backend change that also touches docs under a "components" dir / docs *.tsx
  // must NOT be misread as UI and blocked.
  const res = lib.validateEvidence(
    { changeClass: 'backend', checks: [{ kind: 'test', command: 'x', exitCode: 0, artifacts: ['test.log'] }] },
    { evidenceDir: evDir, changedFiles: ['server/api.ts', 'docs/components/guide.md', 'docs/mock.tsx'] });
  assert.ok(res.ok, `docs-only UI-looking paths must not trip the guard: ${res.reason}`);
  // But a REAL source UI file still trips it:
  const trips = lib.validateEvidence(
    { changeClass: 'backend', checks: [{ kind: 'test', command: 'x', exitCode: 0, artifacts: ['test.log'] }] },
    { evidenceDir: evDir, changedFiles: ['server/api.ts', 'src/components/Widget.vue'] });
  assert.ok(!trips.ok, 'real src UI file must still trip the guard');
});

test('isDocsOnly: strips leading ./ (regression R3 parity)', () => {
  assert.ok(lib.isDocsOnly('./docs/x.md'), './docs/x.md should be docs-only');
  assert.ok(!lib.isDocsOnly('./src/app.js'), './src/app.js should not be docs-only');
});

test('validateEvidence: mislabel cross-check (UI diff declared backend) fails', () => {
  const { evDir } = evidenceRepo();
  const res = lib.validateEvidence(
    { changeClass: 'backend', checks: [{ kind: 'test', command: 'x', exitCode: 0, artifacts: ['test.log'] }] },
    { evidenceDir: evDir, changedFiles: ['src/LoginForm.tsx', 'server/api.ts'] });
  assert.ok(!res.ok, 'UI file in diff + backend class must fail');
  // But with no changedFiles context, cross-check is skipped:
  const skip = lib.validateEvidence(
    { changeClass: 'backend', checks: [{ kind: 'test', command: 'x', exitCode: 0, artifacts: ['test.log'] }] },
    { evidenceDir: evDir, changedFiles: null });
  assert.ok(skip.ok, skip.reason);
});

// ---- findValidMarker (real git) --------------------------------------------

test('findValidMarker: exact HEAD, docs-only ancestor, and rejections', () => {
  const repo = initRepo();
  writeFile(repo, 'src/app.js', 'v1');
  const A = commitAll(repo, 'code');
  const gd = commonDir(repo);
  const PREFIX = 'code-review-passed-';
  fs.writeFileSync(path.join(gd, `${PREFIX}${A}`), '');

  let g = lib.resolveGit(repo);
  // exact
  let m = lib.findValidMarker(repo, g.gitDirAbs, g.headSha, PREFIX, { allowDocsAncestor: true });
  assert.ok(m && m.exact && m.sha === A, 'exact HEAD match');

  // docs-only commit on top -> ancestor tolerance accepts A's marker
  writeFile(repo, 'docs/plans/notes.md', 'notes');
  const B = commitAll(repo, 'docs: notes');
  g = lib.resolveGit(repo);
  assert.strictEqual(g.headSha, B);
  m = lib.findValidMarker(repo, g.gitDirAbs, g.headSha, PREFIX, { allowDocsAncestor: true });
  assert.ok(m && !m.exact && m.sha === A, 'docs-only ancestor accepted');
  // without the flag -> no tolerance
  m = lib.findValidMarker(repo, g.gitDirAbs, g.headSha, PREFIX, { allowDocsAncestor: false });
  assert.strictEqual(m, null, 'no tolerance without flag');

  // a CODE commit on top -> A no longer docs-only-reachable -> reject
  writeFile(repo, 'src/app.js', 'v2');
  commitAll(repo, 'more code');
  g = lib.resolveGit(repo);
  m = lib.findValidMarker(repo, g.gitDirAbs, g.headSha, PREFIX, { allowDocsAncestor: true });
  assert.strictEqual(m, null, 'code ancestor must be rejected');
});

test('findValidMarker: NON-ancestor marker with docs-only content diff is rejected', () => {
  const repo = initRepo();
  writeFile(repo, 'base.txt', 'base');
  const BASE = commitAll(repo, 'base'); // branch off this sha, not a hard-coded branch name
  const gd = commonDir(repo);
  const PREFIX = 'code-review-passed-';

  // branch X off base: add a doc, write a marker for its sha
  git(repo, ['checkout', '-q', '-b', 'x', BASE]);
  writeFile(repo, 'docs/x.md', 'x');
  const X = commitAll(repo, 'docs on x');
  fs.writeFileSync(path.join(gd, `${PREFIX}${X}`), '');

  // branch Y off the SAME base (X is NOT an ancestor of Y). Add an unrelated doc.
  git(repo, ['checkout', '-q', '-b', 'y', BASE]);
  writeFile(repo, 'docs/y.md', 'y');
  commitAll(repo, 'docs on y');

  const g = lib.resolveGit(repo);
  const m = lib.findValidMarker(repo, g.gitDirAbs, g.headSha, PREFIX, { allowDocsAncestor: true });
  // X's content diff vs Y HEAD is docs-only, but X is NOT an ancestor of Y.
  assert.strictEqual(m, null, 'non-ancestor marker must be rejected even if content diff is docs-only');
});

test('changedSinceBase: non-ASCII UI path is not quoted-away, still trips guard (regression P1)', () => {
  const repo = initRepo();
  writeFile(repo, 'base.txt', 'base');
  const BASE = commitAll(repo, 'base');
  git(repo, ['checkout', '-q', '-b', 'feat', BASE]);
  writeFile(repo, 'src/Ünïcode.vue', '<template/>'); // non-ASCII .vue (would be quoted without -z)
  const HEAD = commitAll(repo, 'unicode vue');
  const evDir = lib.evidenceDir(commonDir(repo), HEAD);
  fs.mkdirSync(evDir, { recursive: true });
  fs.writeFileSync(path.join(evDir, 'test.log'), 'ok');
  const changed = lib.changedSinceBase(repo, BASE);
  assert.ok(
    changed.includes('src/Ünïcode.vue'),
    `diffNamesZ must return the unquoted non-ASCII path, got ${JSON.stringify(changed)}`,
  );
  const res = lib.validateEvidence(
    { changeClass: 'backend', checks: [{ kind: 'test', command: 'x', exitCode: 0, artifacts: ['test.log'] }] },
    { evidenceDir: evDir, changedFiles: changed });
  assert.ok(!res.ok, 'non-ASCII .vue in diff must trip the UI-mislabel guard (not slip past quoting)');
});

test('validateEvidence: rejects a check with ANY invalid artifact entry (regression round6 #1)', () => {
  const { evDir } = evidenceRepo();
  const res = lib.validateEvidence(
    { changeClass: 'ui', checks: [{ kind: 'playwright', command: 'x', exitCode: 0,
      artifacts: ['shot.png', 'sub/escape.png'] }] },
    { evidenceDir: evDir });
  assert.ok(!res.ok, 'a bogus absolute artifact alongside a valid one must reject the marker');
});

test('pruneStale: keeps divergent-branch markers, deletes only ancestors (regression CC2)', () => {
  const repo = initRepo();
  writeFile(repo, 'base.txt', 'base');
  const BASE = commitAll(repo, 'base');
  const gd = commonDir(repo);
  const P = 'code-review-passed-';
  fs.writeFileSync(path.join(gd, `${P}${BASE}`), ''); // ancestor of everything

  git(repo, ['checkout', '-q', '-b', 'other', BASE]);
  writeFile(repo, 'o.txt', 'o');
  const OTHER = commitAll(repo, 'other-branch work');
  fs.writeFileSync(path.join(gd, `${P}${OTHER}`), ''); // divergent branch's marker

  git(repo, ['checkout', '-q', '-b', 'mine', BASE]);
  writeFile(repo, 'm.txt', 'm');
  const KEEP = commitAll(repo, 'my work');
  fs.writeFileSync(path.join(gd, `${P}${KEEP}`), '');

  lib.pruneStale(repo, gd, P, KEEP);
  assert.ok(!fs.existsSync(path.join(gd, `${P}${BASE}`)), 'ancestor marker should be pruned');
  assert.ok(fs.existsSync(path.join(gd, `${P}${OTHER}`)), "divergent branch's marker must be kept");
  assert.ok(fs.existsSync(path.join(gd, `${P}${KEEP}`)), 'kept marker must remain');
});

test('pruneStale: keeps a marker a linked worktree is checked out at (worktree-aware)', () => {
  const repo = initRepo();
  writeFile(repo, 'base.txt', 'base');
  const X = commitAll(repo, 'commit X');
  const gd = commonDir(repo);
  const P = 'code-review-passed-';
  fs.writeFileSync(path.join(gd, `${P}${X}`), '');

  // Linked worktree A checked out at X (on its own branch).
  git(repo, ['branch', 'wt-a', X]);
  const wtA = path.join(mkTmp('gate-wtbase-'), 'A'); // must not exist; git creates it
  git(repo, ['worktree', 'add', '-q', wtA, 'wt-a']);

  // Main repo advances to Y (descendant of X), records Y, prunes.
  writeFile(repo, 'more.txt', 'm');
  const Y = commitAll(repo, 'commit Y');
  fs.writeFileSync(path.join(gd, `${P}${Y}`), '');
  lib.pruneStale(repo, gd, P, Y);

  assert.ok(fs.existsSync(path.join(gd, `${P}${X}`)), 'marker X kept — linked worktree A is at X');
  assert.ok(fs.existsSync(path.join(gd, `${P}${Y}`)), 'kept marker Y remains');

  // Control: remove worktree A, then the now-truly-stale X ancestor IS pruned.
  git(repo, ['worktree', 'remove', '--force', wtA]);
  lib.pruneStale(repo, gd, P, Y);
  assert.ok(!fs.existsSync(path.join(gd, `${P}${X}`)), 'once no worktree needs it, stale X is pruned');
});

test('worktreeHeads: ignores a hand-deleted (prunable) worktree (regression)', () => {
  const repo = initRepo();
  writeFile(repo, 'base.txt', 'base');
  const X = commitAll(repo, 'commit X');
  git(repo, ['branch', 'wt-c', X]);
  const wtC = path.join(mkTmp('gate-wtbase2-'), 'C');
  git(repo, ['worktree', 'add', '-q', wtC, 'wt-c']);
  // Advance MAIN to Y so sha X is held ONLY by worktree C (not by the main worktree).
  writeFile(repo, 'more.txt', 'm');
  commitAll(repo, 'commit Y');
  assert.ok(lib.worktreeHeads(repo).has(X), 'live worktree C HEAD (X) is collected');
  // Hand-delete C's working directory (NOT `git worktree remove`) → entry goes prunable.
  fs.rmSync(wtC, { recursive: true, force: true });
  assert.ok(!lib.worktreeHeads(repo).has(X), 'prunable (hand-deleted) worktree HEAD is ignored');
});

// ---- record + check end-to-end ---------------------------------------------

test('record-validation.cjs + check-validation.cjs end-to-end (evidence never touches the working tree)', () => {
  const repo = initRepo();
  writeFile(repo, 'src/app.js', 'v1');
  commitAll(repo, 'code');

  // The SOURCE artifact lives wherever the tooling wrote it — here, outside the
  // repo entirely (a Playwright/report temp dir). The recorder copies it into
  // the git dir; the repo working tree must stay pristine.
  const outDir = mkTmp('gate-src-');
  const srcShot = path.join(outDir, 'shot.png');
  fs.writeFileSync(srcShot, 'PNG');

  // Missing marker -> check fails (exit 1)
  let r = runScript('check-validation.cjs', repo, ['--allow-docs-ancestor']);
  assert.strictEqual(r.code, 1, `expected 1, got ${r.code}: ${r.out}`);

  // Record valid UI evidence from the absolute source path
  r = runScript('record-validation.cjs', repo, [], JSON.stringify({
    changeClass: 'ui',
    checks: [{ kind: 'playwright', command: 'x', exitCode: 0, artifacts: [srcShot] }],
  }));
  assert.strictEqual(r.code, 0, `record should succeed: ${r.out}`);

  // THE POINT: nothing was added to the working tree — no untracked files at all.
  assert.strictEqual(git(repo, ['status', '--porcelain']), '',
    'recording evidence must leave the working tree pristine (nothing to git add/commit/push)');
  // ...and the evidence really is stored in the git dir.
  const evDir = lib.evidenceDir(commonDir(repo), git(repo, ['rev-parse', 'HEAD']));
  assert.ok(fs.readdirSync(evDir).length > 0, 'evidence stored in <git-common-dir>/validation-evidence/<sha>/');

  // Now check passes
  r = runScript('check-validation.cjs', repo, ['--allow-docs-ancestor']);
  assert.strictEqual(r.code, 0, `check should pass: ${r.out}`);

  // Recorder refuses bad evidence (nonzero exit)
  r = runScript('record-validation.cjs', repo, [], JSON.stringify({
    changeClass: 'backend',
    checks: [{ kind: 'test', command: 'x', exitCode: 2, artifacts: [srcShot] }],
  }));
  assert.strictEqual(r.code, 1, `recorder must reject nonzero exit: ${r.out}`);

  // Recorder refuses a missing source artifact
  r = runScript('record-validation.cjs', repo, [], JSON.stringify({
    changeClass: 'ui',
    checks: [{ kind: 'playwright', command: 'x', exitCode: 0, artifacts: [path.join(outDir, 'nope.png')] }],
  }));
  assert.strictEqual(r.code, 1, `recorder must reject a missing artifact: ${r.out}`);

  // Docs commit on top -> tolerance keeps validation valid (evidence keyed to the marker sha)
  writeFile(repo, 'docs/plans/x.md', 'notes');
  commitAll(repo, 'docs');
  r = runScript('check-validation.cjs', repo, ['--allow-docs-ancestor']);
  assert.strictEqual(r.code, 0, `tolerance should keep it valid: ${r.out}`);

  // Code commit on top -> stale -> fail
  writeFile(repo, 'src/app.js', 'v2');
  commitAll(repo, 'more code');
  r = runScript('check-validation.cjs', repo, ['--allow-docs-ancestor']);
  assert.strictEqual(r.code, 1, `code commit must stale validation: ${r.out}`);
});

test('record-validation.cjs: a rejected re-record must not destroy prior evidence', () => {
  const repo = initRepo();
  writeFile(repo, 'src/app.js', 'v1');
  commitAll(repo, 'code');
  const outDir = mkTmp('gate-src2-');
  const src = path.join(outDir, 'shot.png');
  fs.writeFileSync(src, 'GOODPNG');

  // First recording succeeds.
  let r = runScript('record-validation.cjs', repo, [], JSON.stringify({
    changeClass: 'ui',
    checks: [{ kind: 'playwright', command: 'x', exitCode: 0, artifacts: [src] }],
  }));
  assert.strictEqual(r.code, 0, `first record should succeed: ${r.out}`);
  assert.strictEqual(runScript('check-validation.cjs', repo, ['--allow-docs-ancestor']).code, 0, 'valid after first record');

  // A second recording at the SAME sha is REJECTED (nonzero exit code in payload).
  r = runScript('record-validation.cjs', repo, [], JSON.stringify({
    changeClass: 'ui',
    checks: [{ kind: 'playwright', command: 'x', exitCode: 3, artifacts: [src] }],
  }));
  assert.strictEqual(r.code, 1, `second record must be rejected: ${r.out}`);

  // The earlier, still-valid evidence must survive the rejection.
  const r2 = runScript('check-validation.cjs', repo, ['--allow-docs-ancestor']);
  assert.strictEqual(r2.code, 0, `prior evidence must survive a rejected re-record: ${r2.out}`);

  // No staging/backup leftovers in the evidence root.
  const evRoot = path.join(commonDir(repo), 'validation-evidence');
  const strays = fs.readdirSync(evRoot).filter((f) => f.includes('.staging-') || f.includes('.old-'));
  assert.deepStrictEqual(strays, [], `no staging/backup leftovers, got ${JSON.stringify(strays)}`);
});

test('check-validation.cjs: malformed marker treated as invalid', () => {
  const repo = initRepo();
  writeFile(repo, 'a.txt', 'x');
  const A = commitAll(repo, 'a');
  const gd = commonDir(repo);
  fs.writeFileSync(path.join(gd, `validation-passed-${A}`), 'not json {{{');
  const r = runScript('check-validation.cjs', repo, ['--allow-docs-ancestor']);
  assert.strictEqual(r.code, 1, `malformed -> invalid: ${r.out}`);
});

// ---- evidence/marker must never drift apart ---------------------------------

test('check-validation.cjs: pruning a stale marker also drops its evidence (regression CLAIM-001)', () => {
  const repo = initRepo();
  const outDir = mkTmp('gate-src3-');
  const logA = path.join(outDir, 'a.log');
  const logB = path.join(outDir, 'b.log');
  fs.writeFileSync(logA, 'run A');
  fs.writeFileSync(logB, 'run B');
  const payload = (art) => JSON.stringify({
    changeClass: 'backend',
    checks: [{ kind: 'test', command: 'npm test', exitCode: 0, artifacts: [art] }],
  });

  writeFile(repo, 'src/app.js', 'v1');
  const A = commitAll(repo, 'code A');
  assert.strictEqual(runScript('record-validation.cjs', repo, [], payload(logA)).code, 0, 'record A');

  // A linked worktree pinned at A protects marker A from the recorder's prune —
  // so it (and its evidence) survives into the next recording.
  git(repo, ['branch', 'wt-a', A]);
  const wtA = path.join(mkTmp('gate-wtbase3-'), 'A');
  git(repo, ['worktree', 'add', '-q', wtA, 'wt-a']);

  writeFile(repo, 'src/app.js', 'v2');
  const B = commitAll(repo, 'code B');
  assert.strictEqual(runScript('record-validation.cjs', repo, [], payload(logB)).code, 0, 'record B');

  const gd = commonDir(repo);
  const evRoot = path.join(gd, 'validation-evidence');
  assert.ok(fs.existsSync(path.join(gd, `validation-passed-${A}`)), 'marker A protected by the worktree');
  assert.ok(fs.existsSync(path.join(evRoot, A)), 'evidence A protected too');

  // The worktree goes away, so marker A is now genuinely stale. The next gate
  // check prunes it — and must take its evidence with it.
  git(repo, ['worktree', 'remove', '--force', wtA]);
  assert.strictEqual(runScript('check-validation.cjs', repo, ['--allow-docs-ancestor']).code, 0, 'HEAD B still valid');

  assert.ok(!fs.existsSync(path.join(gd, `validation-passed-${A}`)), 'stale marker A pruned');
  assert.ok(!fs.existsSync(path.join(evRoot, A)),
    'evidence A must be pruned with its marker — a checker that prunes markers but not evidence orphans artifacts in the git dir forever');
  assert.ok(fs.existsSync(path.join(gd, `validation-passed-${B}`)), 'live marker B kept');
  assert.ok(fs.existsSync(path.join(evRoot, B)), 'live evidence B kept');
});

test('record-validation.cjs: a failed marker write rolls the evidence swap back (regression CLAIM-003)', (t) => {
  if (typeof process.getuid === 'function' && process.getuid() === 0) {
    return t.skip('running as root — file permissions would not block the write');
  }
  const repo = initRepo();
  const outDir = mkTmp('gate-src4-');
  const good = path.join(outDir, 'good.log');
  const next = path.join(outDir, 'next.log');
  fs.writeFileSync(good, 'GOOD-EVIDENCE');
  fs.writeFileSync(next, 'NEXT-EVIDENCE');
  const payload = (art) => JSON.stringify({
    changeClass: 'backend',
    checks: [{ kind: 'test', command: 'npm test', exitCode: 0, artifacts: [art] }],
  });

  writeFile(repo, 'src/app.js', 'v1');
  const A = commitAll(repo, 'code');
  assert.strictEqual(runScript('record-validation.cjs', repo, [], payload(good)).code, 0, 'first record');

  const gd = commonDir(repo);
  const markerPath = path.join(gd, `validation-passed-${A}`);
  const evDir = path.join(gd, 'validation-evidence', A);

  // Make the marker unwritable so the re-record passes validation, swaps the new
  // evidence in, and THEN fails on the marker write — the exact crash window.
  fs.chmodSync(markerPath, 0o444);
  const r = runScript('record-validation.cjs', repo, [], payload(next));
  fs.chmodSync(markerPath, 0o644);

  assert.strictEqual(r.code, 2, `marker write must fail with an infra error: ${r.out}`);

  // The store must be back to its pre-swap state: the ORIGINAL evidence, intact.
  const stored = fs.readdirSync(evDir);
  assert.strictEqual(stored.length, 1, `exactly one stored artifact, got ${JSON.stringify(stored)}`);
  assert.strictEqual(fs.readFileSync(path.join(evDir, stored[0]), 'utf8'), 'GOOD-EVIDENCE',
    'a failed marker write must not leave the new evidence in place — roll back to what the live marker describes');

  const evRoot = path.join(gd, 'validation-evidence');
  const strays = fs.readdirSync(evRoot).filter((f) => f.includes('.staging-') || f.includes('.old-'));
  assert.deepStrictEqual(strays, [], `no staging/backup leftovers, got ${JSON.stringify(strays)}`);

  // ...and the still-valid original marker still passes the gate.
  assert.strictEqual(runScript('check-validation.cjs', repo, ['--allow-docs-ancestor']).code, 0,
    'the surviving marker + rolled-back evidence must still satisfy the gate');
});

test('gate-lib: markers, tolerance and pruning work in a SHA-256 repo (regression CLAIM-002)', (t) => {
  const repo = mkTmp('gate-repo256-');
  try {
    git(repo, ['init', '-q', '--object-format=sha256']);
  } catch (_e) {
    return t.skip('git does not support --object-format=sha256');
  }
  git(repo, ['config', 'commit.gpgsign', 'false']);

  const outDir = mkTmp('gate-src5-');
  const log = path.join(outDir, 'run.log');
  fs.writeFileSync(log, 'suite green');
  const payload = JSON.stringify({
    changeClass: 'backend',
    checks: [{ kind: 'test', command: 'npm test', exitCode: 0, artifacts: [log] }],
  });

  writeFile(repo, 'src/app.js', 'v1');
  const A = commitAll(repo, 'code A');
  assert.strictEqual(A.length, 64, 'sanity: sha256 object ids are 64 hex chars');
  assert.strictEqual(runScript('record-validation.cjs', repo, [], payload).code, 0, 'record on sha256');

  // worktreeHeads must parse a 64-char HEAD (a 40-char-only regex silently
  // returns an empty set, disabling cross-worktree marker protection).
  assert.ok(lib.worktreeHeads(repo).has(A), 'worktreeHeads parses a 64-char HEAD');

  // Docs-only-ancestor tolerance must survive a 64-char marker filename.
  writeFile(repo, 'docs/notes.md', 'notes');
  commitAll(repo, 'docs');
  assert.strictEqual(runScript('check-validation.cjs', repo, ['--allow-docs-ancestor']).code, 0,
    'docs-only-ancestor tolerance must work on sha256 (a {7,40} sha regex skips every marker here)');

  // ...and pruning must still recognise the 64-char ancestor as superseded.
  writeFile(repo, 'src/app.js', 'v2');
  const C = commitAll(repo, 'code C');
  assert.strictEqual(runScript('record-validation.cjs', repo, [], payload).code, 0, 'record on sha256 HEAD C');
  const gd = commonDir(repo);
  assert.ok(!fs.existsSync(path.join(gd, `validation-passed-${A}`)), 'superseded 64-char marker A pruned');
  assert.ok(fs.existsSync(path.join(gd, `validation-passed-${C}`)), 'current marker C kept');
});

// ---- unreachable-sha sweep (markers stranded by history rewriting) ----------
//
// This code DELETES markers (and, downstream, the evidence they point at), so the
// tests below weight false-prune far more heavily than missed-prune. A marker is
// swept only when its commit is unrecoverable: no ref, no worktree HEAD, no reflog
// entry — or gone from the object DB.

const P_CR = 'code-review-passed-';

function expireReflog(repo) {
  git(repo, ['reflog', 'expire', '--expire-unreachable=now', '--expire=now', '--all']);
}


// ---- isShaReachable: what gate-gc's REPORT is built on -----------------------
// It no longer deletes anything, but a wrong verdict still misleads a human into
// deleting evidence by hand. Everything here is weighted toward "never call a live
// commit unreachable".

test('isShaReachable: reflog-recoverable, divergent-branch, tag-only and detached-worktree commits are all REACHABLE', () => {
  const repo = initRepo();
  writeFile(repo, 'a.txt', 'v1');
  const AMENDED_AWAY = commitAll(repo, 'v1');
  writeFile(repo, 'a.txt', 'v2');
  git(repo, ['add', '-A']);
  git(repo, ['commit', '-q', '--amend', '-m', 'v1 (amended)']);
  // Still one `git reset --hard @{1}` away from being HEAD — must NOT look gone.
  assert.strictEqual(lib.isShaReachable(repo, AMENDED_AWAY), true, 'reflog-recoverable');

  git(repo, ['checkout', '-q', '-b', 'other']);
  writeFile(repo, 'o.txt', 'o');
  const ON_BRANCH = commitAll(repo, 'other');
  git(repo, ['checkout', '-q', '-']);

  git(repo, ['checkout', '-q', '-b', 'tagme']);
  writeFile(repo, 't.txt', 't');
  const ON_TAG = commitAll(repo, 'tagged');
  git(repo, ['tag', 'keepme']);
  git(repo, ['checkout', '-q', '-']);
  git(repo, ['branch', '-q', '-D', 'tagme']);

  writeFile(repo, 'w.txt', 'w');
  const PINNED = commitAll(repo, 'pinned');
  const wt = path.join(mkTmp('gate-wt-'), 'W');
  git(repo, ['worktree', 'add', '-q', '--detach', wt, PINNED]);
  git(repo, ['reset', '-q', '--hard', 'HEAD~1']);

  expireReflog(repo); // strip the reflog so only ref/worktree reachability can save them
  assert.strictEqual(lib.isShaReachable(repo, ON_BRANCH), true, 'divergent branch');
  assert.strictEqual(lib.isShaReachable(repo, ON_TAG), true, 'tag only');
  assert.strictEqual(lib.isShaReachable(repo, PINNED), true, 'detached worktree HEAD');
  git(repo, ['worktree', 'remove', '--force', wt]);
});

test('isShaReachable: a git fault yields null (unknown), never false', (t) => {
  if (typeof process.getuid === 'function' && process.getuid() === 0) {
    return t.skip('running as root — chmod would not block the read');
  }
  const repo = initRepo();
  const gd = commonDir(repo);
  writeFile(repo, 'a.txt', 'v1');
  const PARENT = commitAll(repo, 'v1');
  writeFile(repo, 'b.txt', 'v2');
  commitAll(repo, 'v2');
  expireReflog(repo);

  const obj = path.join(gd, 'objects', PARENT.slice(0, 2), PARENT.slice(2));
  fs.chmodSync(obj, 0o000);
  let verdict;
  try {
    verdict = lib.isShaReachable(repo, PARENT);
  } finally {
    fs.chmodSync(obj, 0o444);
  }
  assert.strictEqual(verdict, null, 'git could not tell us -> unknown, NOT unreachable');
});

test('isShaReachable: a LYING commit-graph cannot make a live commit look unreachable', () => {
  // git's commit-graph answers reachability without walking objects and `git gc` writes it
  // in essentially every repo. One corrupt byte and `merge-base --is-ancestor` reports a
  // commit that IS on master as unreachable — while every object, pack and permission is
  // pristine, so NO integrity check can see it. We simply do not consult the caches.
  const repo = initRepo();
  const gd = commonDir(repo);
  for (let i = 0; i < 6; i += 1) {
    writeFile(repo, 'a.txt', `v${i}`);
    commitAll(repo, `feat: Commit ${i}`);
  }
  const OLDEST = git(repo, ['rev-parse', 'HEAD~5']);
  git(repo, ['commit-graph', 'write', '--reachable']);
  expireReflog(repo);

  const cg = path.join(gd, 'objects', 'info', 'commit-graph');
  if (!fs.existsSync(cg)) return; // git too old — nothing to defend against
  const orig = fs.readFileSync(cg);
  const mode = fs.statSync(cg).mode;
  const corrupt = (off) => {
    fs.chmodSync(cg, 0o644);
    const b = Buffer.from(orig);
    b[off] ^= 0xff;
    fs.writeFileSync(cg, b);
    fs.chmodSync(cg, mode);
  };
  const isAncestor = (extra) => {
    try {
      execFileSync('git', ['-C', repo, ...extra, 'merge-base', '--is-ancestor', OLDEST, 'HEAD'], { stdio: 'ignore' });
      return true;
    } catch (_e) { return false; }
  };

  // The graph's bytes depend on the commit shas, so hunt for an offset that actually lies.
  let lying = false;
  for (let off = 8; off < orig.length && !lying; off += 1) {
    corrupt(off);
    if (isAncestor(['-c', 'core.commitGraph=false']) && !isAncestor([])) lying = true;
  }
  assert.ok(lying, 'sanity: could not get the commit-graph to lie — test would be vacuous');

  assert.strictEqual(lib.isShaReachable(repo, OLDEST), true,
    'a lying commit-graph must not make a master-reachable commit look gone');
});

test('objectStoreIntact: ok on a healthy repo; flags a CORRUPT-but-readable pack', () => {
  const repo = initRepo();
  const gd = commonDir(repo);
  writeFile(repo, 'a.txt', 'x');
  commitAll(repo, 'a');
  assert.strictEqual(lib.objectStoreIntact(repo, gd).ok, true, 'loose repo intact');
  git(repo, ['gc', '-q']);
  assert.strictEqual(lib.objectStoreIntact(repo, gd).ok, true, 'packed repo intact');

  // Bit rot: permissions stay perfect, contents do not. access(R_OK) cannot see this.
  const packDir = path.join(gd, 'objects', 'pack');
  const victim = path.join(packDir, fs.readdirSync(packDir).find((f) => f.endsWith('.pack')));
  const mode = fs.statSync(victim).mode;
  fs.chmodSync(victim, 0o644);
  const fd = fs.openSync(victim, 'r+');
  const buf = Buffer.alloc(1);
  fs.readSync(fd, buf, 0, 1, 200);
  fs.writeSync(fd, Buffer.from([buf[0] ^ 0xff]), 0, 1, 200);
  fs.closeSync(fd);
  fs.chmodSync(victim, mode);

  const verdict = lib.objectStoreIntact(repo, gd);
  assert.strictEqual(verdict.ok, false, 'a corrupt-but-readable pack must be caught');
  assert.match(verdict.problems.join(' '), /corrupt/i);
});

// gate-gc is REPORT-ONLY. Six deleting designs were each shown to destroy a live marker
// and its validation evidence, every one via a different way git can report a present
// object as absent. "This tool cannot delete" is an invariant we can actually verify;
// "this tool can always tell gone from unreadable" was false six times.

test('gate-gc: contains NO deletion code at all (the invariant)', () => {
  const src = fs.readFileSync(path.join(SCRIPTS, 'gate-gc.cjs'), 'utf8');
  for (const forbidden of ['unlinkSync', 'rmSync', 'rmdirSync', 'renameSync', 'writeFileSync']) {
    assert.ok(!src.includes(forbidden),
      `gate-gc must not mutate the filesystem, found ${forbidden}()`);
  }
  assert.ok(!/--force/.test(src), 'gate-gc must not offer a --force flag');
});

test('gate-gc: reports stranded markers and evidence, and deletes nothing', () => {
  const repo = initRepo();
  const outDir = mkTmp('gate-src9-');
  const log = path.join(outDir, 'run.log');
  fs.writeFileSync(log, 'suite green');
  const payload = JSON.stringify({
    changeClass: 'backend',
    checks: [{ kind: 'test', command: 'npm test', exitCode: 0, artifacts: [log] }],
  });

  writeFile(repo, 'src/app.js', 'v1');
  const ABANDONED = commitAll(repo, 'code v1');
  assert.strictEqual(runScript('record-validation.cjs', repo, [], payload).code, 0, 'record at v1');
  writeFile(repo, 'src/app.js', 'v2');
  git(repo, ['add', '-A']);
  git(repo, ['commit', '-q', '--amend', '-m', 'code v1 (amended)']);
  assert.strictEqual(runScript('record-validation.cjs', repo, [], payload).code, 0, 'record at amended head');
  const LIVE = git(repo, ['rev-parse', 'HEAD']);
  expireReflog(repo);

  const gd = commonDir(repo);
  const evRoot = path.join(gd, 'validation-evidence');

  const res = runScript('gate-gc.cjs', repo, ['--json']);
  assert.strictEqual(res.code, 0, `should report: ${res.out}`);
  const report = JSON.parse(res.out);
  assert.ok(report.stranded.some((f) => f.includes(ABANDONED)), 'the stranded marker is reported');
  assert.ok(report.evidence.includes(ABANDONED), 'its evidence dir is reported');
  assert.ok(!report.stranded.some((f) => f.includes(LIVE)), 'the live marker is NOT reported as stranded');

  // ...and NOTHING was touched.
  assert.ok(fs.existsSync(path.join(gd, `validation-passed-${ABANDONED}`)), 'stranded marker still on disk');
  assert.ok(fs.existsSync(path.join(evRoot, ABANDONED)), 'stranded evidence still on disk');
  assert.ok(fs.existsSync(path.join(gd, `validation-passed-${LIVE}`)), 'live marker untouched');
  assert.ok(fs.existsSync(path.join(evRoot, LIVE)), 'live evidence untouched');
});

test('gate-gc: REFUSES to even report when a pack is unreadable or corrupt', (t) => {
  if (typeof process.getuid === 'function' && process.getuid() === 0) {
    return t.skip('running as root — chmod would not block the read');
  }
  const repo = initRepo();
  const gd = commonDir(repo);
  writeFile(repo, 'a.txt', 'x');
  const SHA = commitAll(repo, 'a');
  git(repo, ['gc', '-q']);
  fs.writeFileSync(path.join(gd, `${P_CR}${SHA}`), '');

  const packDir = path.join(gd, 'objects', 'pack');
  const victim = path.join(packDir, fs.readdirSync(packDir).find((f) => f.endsWith('.pack')));
  fs.chmodSync(victim, 0o000);
  let res;
  try {
    res = runScript('gate-gc.cjs', repo);
  } finally {
    fs.chmodSync(victim, 0o444);
  }
  assert.strictEqual(res.code, 2, `must refuse, got ${res.code}: ${res.out}`);
  assert.match(res.out, /REFUSING TO REPORT/, 'a misleading report is worse than none');
});

test('objectStoreIntact: a faulted ALTERNATE object store is detected (regression: alternates blind spot)', (t) => {
  if (typeof process.getuid === 'function' && process.getuid() === 0) {
    return t.skip('running as root — chmod would not block the read');
  }
  // Objects can live in an alternate store (`clone --reference`, shared CI caches).
  // A faulted alternate makes commits that live ONLY there look absent, and no check of
  // THIS repo's own packs can see it — the sixth and final refutation of the deleting
  // designs. Preflight must now walk alternates too.
  const base = initRepo();
  writeFile(base, 'a.txt', 'a');
  commitAll(base, 'A');
  git(base, ['repack', '-a', '-d', '-q']);
  const baseObjects = path.join(commonDir(base), 'objects');

  const main = initRepo();
  const mainGd = commonDir(main);
  fs.mkdirSync(path.join(mainGd, 'objects', 'info'), { recursive: true });
  fs.writeFileSync(path.join(mainGd, 'objects', 'info', 'alternates'), `${baseObjects}\n`);
  writeFile(main, 'b.txt', 'b');
  commitAll(main, 'B');

  assert.strictEqual(lib.objectStoreIntact(main, mainGd).ok, true, 'healthy alternate -> intact');

  const altPackDir = path.join(baseObjects, 'pack');
  const victim = path.join(altPackDir, fs.readdirSync(altPackDir).find((f) => f.endsWith('.pack')));
  fs.chmodSync(victim, 0o000);
  let verdict;
  try {
    verdict = lib.objectStoreIntact(main, mainGd);
  } finally {
    fs.chmodSync(victim, 0o444);
  }
  assert.strictEqual(verdict.ok, false, 'a faulted ALTERNATE store must be caught, not just our own packs');
  assert.match(verdict.problems.join(' '), /unreadable pack/i);
});
