'use strict';
/**
 * Tests for parse-claims.cjs — the Layer-1 output parser.
 * Run: node --test skills/code-review/scripts/__tests__/parse-claims.test.cjs
 *
 * The parser is the narrowest waist in the whole review pipeline: if a claim
 * header fails to match, the claim vanishes SILENTLY and a real review is
 * reported as "clean" (exit 0, zero claims). These tests pin the header grammar.
 */

const test = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { execFileSync } = require('node:child_process');

const SCRIPT = path.resolve(__dirname, '..', 'parse-claims.cjs');
const FIXTURES = path.join(__dirname, 'parse-claims-fixtures.txt');

function parse(text, extraArgs = []) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'parse-claims-'));
  const f = path.join(dir, 'in.txt');
  fs.writeFileSync(f, text);
  return parseFile(f, extraArgs);
}

function parseFile(file, extraArgs = []) {
  const out = execFileSync('node', [SCRIPT, file, ...extraArgs], { encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] });
  return JSON.parse(out);
}

test('parses the checked-in fixtures (bare file:line headers)', () => {
  const claims = parseFile(FIXTURES, ['--repo-root', '/Users/foo/repo']);
  assert.strictEqual(claims.length, 2, 'both fixture claims parse');
  assert.strictEqual(claims[0].severity, 'P2');
  assert.strictEqual(claims[0].file, 'client/src/lib/validation/useFileTrashedProbe.ts');
  assert.strictEqual(claims[0].line, 81);
  assert.strictEqual(claims[1].severity, 'P1');
  assert.strictEqual(claims[1].file, 'server/src/api-files.ts');
  assert.strictEqual(claims[1].line, 725);
  assert.ok(claims[0].body.includes('unconditionally sets'), 'body captured');
});

test('parses a RANGE line anchor, capturing the START line (regression SG-13996)', () => {
  // The Codex CLI routinely emits ranges. A bare `:(\d+)$` anchor does not match
  // them, so a real review parsed as ZERO claims — silently, with exit 0.
  const claims = parse([
    '- [P1] Same-line range — /repo/src/a.ts:860-860',
    '  body a',
    '',
    '- [P2] Multi-line range — /repo/src/b.ts:120-145',
    '  body b',
  ].join('\n'), ['--repo-root', '/repo']);

  assert.strictEqual(claims.length, 2, 'range headers must not vanish');
  assert.strictEqual(claims[0].file, 'src/a.ts');
  assert.strictEqual(claims[0].line, 860, 'same-line range captures the start line');
  assert.strictEqual(claims[1].file, 'src/b.ts');
  assert.strictEqual(claims[1].line, 120, 'multi-line range captures the start line');
});

test('bare and range headers coexist in one review', () => {
  const claims = parse([
    '- [P1] Bare — /repo/a.ts:10',
    '- [P2] Range — /repo/b.ts:20-30',
    '- [p3] Lowercase severity, en-dash – /repo/c.ts:40',
  ].join('\n'), ['--repo-root', '/repo']);

  assert.deepStrictEqual(claims.map((c) => [c.severity, c.file, c.line]), [
    ['P1', 'a.ts', 10],
    ['P2', 'b.ts', 20],
    ['P3', 'c.ts', 40],
  ]);
});

test('a hyphen inside the summary still binds to the LAST separator', () => {
  // The range suffix must not make the file field greedier: the separator is
  // space-delimited, a range's inner hyphen is not.
  const claims = parse('- [P2] Fix the drag-and-drop off-by-one — /repo/src/dnd.ts:55-60', ['--repo-root', '/repo']);
  assert.strictEqual(claims.length, 1);
  assert.strictEqual(claims[0].summary, 'Fix the drag-and-drop off-by-one');
  assert.strictEqual(claims[0].file, 'src/dnd.ts');
  assert.strictEqual(claims[0].line, 55);
});

test('a RANGE may use an en-dash or em-dash delimiter (regression: swallowed claim)', () => {
  // An en-dash is the typographically correct character for a numeric range, and
  // Codex does not reliably emit ASCII. A range delimiter the regex can't match is
  // worse than a bare miss: the header is absorbed into the PREVIOUS claim's body,
  // so the count looks plausible (2 of 3) while a real finding is hidden.
  const claims = parse([
    '- [P1] Bug one — /repo/a.ts:10',
    '  body one',
    '',
    '- [P2] En-dash range — /repo/b.ts:120–145',
    '  DO NOT SWALLOW ME',
    '',
    '- [P3] Em-dash range — /repo/c.ts:30—Bug', // not a range: non-numeric after the dash
  ].join('\n'), ['--repo-root', '/repo']);

  const ranged = claims.filter((c) => c.file === 'b.ts');
  assert.strictEqual(ranged.length, 1, 'the en-dash-ranged claim must parse as its own claim');
  assert.strictEqual(ranged[0].line, 120, 'start line captured from an en-dash range');
  assert.strictEqual(ranged[0].severity, 'P2');
  assert.ok(
    claims.every((c) => c.file === 'b.ts' || !c.body.includes('DO NOT SWALLOW ME')),
    'a ranged finding must never be absorbed into another claim\'s body',
  );

  const emdash = parse('- [P1] X — /repo/d.ts:5—10', ['--repo-root', '/repo']);
  assert.strictEqual(emdash[0].line, 5, 'em-dash range also captures the start line');
});

test('trailing sentence punctuation does not swallow the claim (regression)', () => {
  // These headers are LLM-written bullet lines; they routinely end in a period or
  // comma. A header the anchor rejects is absorbed into the previous claim's body.
  const claims = parse([
    '- [P1] First — /repo/a.ts:10',
    '  body one',
    '',
    '- [P2] Ends with a period — /repo/b.ts:81.',
    '  DO NOT SWALLOW ME',
    '',
    '- [P3] Range then comma — /repo/c.ts:20-30,',
    '  body three',
  ].join('\n'), ['--repo-root', '/repo']);

  assert.strictEqual(claims.length, 3, 'punctuation-terminated headers must still parse');
  assert.deepStrictEqual(claims.map((c) => [c.file, c.line]), [['a.ts', 10], ['b.ts', 81], ['c.ts', 20]]);
  assert.ok(
    claims.find((c) => c.file === 'b.ts').body.includes('DO NOT SWALLOW ME'),
    'the finding stays with its own claim',
  );
});

test('a range with spaces around the dash still parses', () => {
  const claims = parse('- [P2] Spaced range — /repo/a.ts:10 - 20', ['--repo-root', '/repo']);
  assert.strictEqual(claims.length, 1);
  assert.strictEqual(claims[0].file, 'a.ts');
  assert.strictEqual(claims[0].line, 10);
  assert.strictEqual(claims[0].summary, 'Spaced range', 'the spaced range must not be mistaken for the separator');
});

test('raw echoes the header verbatim, preserving the range suffix', () => {
  const header = '- [P2] Ranged — /repo/src/a.ts:120-145';
  const claims = parse(`${header}\n  the body`, ['--repo-root', '/repo']);
  assert.strictEqual(claims.length, 1);
  assert.ok(
    claims[0].raw.startsWith(header),
    `raw must be verbatim (documented contract), got: ${JSON.stringify(claims[0].raw)}`,
  );
  assert.ok(claims[0].raw.includes('120-145'), 'the range suffix must survive into raw');
  assert.ok(claims[0].raw.includes('the body'), 'body still appended to raw');
});

test('a clean review yields zero claims and exit 0 (not an error)', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'parse-claims-'));
  const f = path.join(dir, 'clean.txt');
  fs.writeFileSync(f, 'NO_FINDINGS\n');
  const res = execFileSync('node', [SCRIPT, f], { encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] });
  assert.deepStrictEqual(JSON.parse(res), [], 'clean review parses to zero claims');
});
