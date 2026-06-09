#!/usr/bin/env node
/**
 * Parse Codex CLI output (or code-reviewer subagent output) into structured
 * claims. Output is JSON for downstream processing.
 *
 * Usage: parse-claims.cjs <input-file> [--source codex|reviewer] [--repo-root <abs-path>]
 *
 * Claim shape:
 *   {
 *     id: "claim-001",
 *     source: "codex" | "reviewer" | "both",
 *     severity: "P1" | "P2" | "P3",
 *     file: "client/src/lib/foo.ts",
 *     line: 81,
 *     summary: "one-line headline",
 *     body: "full claim text",
 *     raw: "verbatim section from input"
 *   }
 */

const fs = require('fs');
const path = require('path');

const args = process.argv.slice(2);
const inputFile = args[0];
const sourceIdx = args.indexOf('--source');
const source = (sourceIdx >= 0 && args[sourceIdx + 1] !== undefined && !args[sourceIdx + 1].startsWith('--'))
  ? args[sourceIdx + 1]
  : 'codex';
const repoRootIdx = args.indexOf('--repo-root');
const repoRoot = (repoRootIdx >= 0 && args[repoRootIdx + 1] !== undefined && !args[repoRootIdx + 1].startsWith('--'))
  ? args[repoRootIdx + 1]
  : process.cwd();

if (!inputFile) {
  console.error('Usage: parse-claims.cjs <input-file> [--source codex|reviewer] [--repo-root <abs-path>]');
  process.exit(1);
}

if (!fs.existsSync(inputFile)) {
  console.error(`Input file not found: ${inputFile}`);
  process.exit(1);
}

const text = fs.readFileSync(inputFile, 'utf8');

// Pattern: lines like "- [P2] <summary> — <abspath>:<line>" followed by
// indented body lines. Body ends at next "- [PN]" or EOF.
//
// Separator tolerates em-dash (—), en-dash (–), or hyphen (-) — reviewers and
// Codex don't always emit the canonical em-dash. The summary is greedy and the
// path/line are anchored to end-of-line, so an inner dash in the summary binds
// to the LAST separator (not the first) and never corrupts the file field.
// Severity match is case-insensitive ([p2] is accepted) and normalized upstream.
const CLAIM_HEADER = /^- \[(P[123])\] (.+) [—–-] (.+):(\d+)\s*$/i;

const claims = [];
const lines = text.split('\n');
let current = null;
let bodyLines = [];

function flushClaim() {
  if (current) {
    current.body = bodyLines.join('\n').trim();
    current.raw = current.body
      ? `- [${current.severity}] ${current.summary} — ${current.file}:${current.line}\n${current.body}`
      : `- [${current.severity}] ${current.summary} — ${current.file}:${current.line}`;
    claims.push(current);
  }
  current = null;
  bodyLines = [];
}

for (const line of lines) {
  const match = CLAIM_HEADER.exec(line);
  if (match) {
    flushClaim();
    const [, severity, summary, fileAbs, lineNum] = match;
    let file = fileAbs;
    // Strip the repo-root prefix only on a path boundary, and tolerate a
    // trailing slash on --repo-root (so a sibling dir like "<root>-backend"
    // is not mistaken for an in-repo path, and the first char isn't eaten).
    const normRoot = repoRoot.replace(/\/+$/, '');
    if (fileAbs === normRoot) {
      file = '';
    } else if (fileAbs.startsWith(normRoot + '/')) {
      file = fileAbs.slice(normRoot.length + 1);
    }
    current = {
      id: `claim-${String(claims.length + 1).padStart(3, '0')}`,
      source,
      severity: severity.toUpperCase(),
      file,
      line: parseInt(lineNum, 10),
      summary: summary.trim(),
    };
  } else if (current) {
    bodyLines.push(line);
  }
}
flushClaim();

console.log(JSON.stringify(claims, null, 2));

if (claims.length === 0) {
  // Zero claims is the common "clean review" outcome, not an error — exit 0 so a
  // caller checking $? can't mistake a clean pass for a failure. Genuine I/O
  // problems (missing/unreadable file) already exit 1 above.
  console.error('[parse-claims] No claims found in input (clean)');
  process.exit(0);
}

console.error(`[parse-claims] Parsed ${claims.length} claim(s) from ${source}`);
