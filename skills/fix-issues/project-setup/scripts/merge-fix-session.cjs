#!/usr/bin/env node
/**
 * merge-fix-session.cjs — Merge FIX-XXX.md files into SESSION.md
 *
 * Combines all per-issue FIX files into a single SESSION.md archive,
 * then removes the individual FIX files. Reduces file count from N+1 to 1
 * per session with zero data loss.
 *
 * Usage:
 *   node scripts/merge-fix-session.cjs <session-dir>
 *   node scripts/merge-fix-session.cjs docs/fix-sessions/2026-02-23_00-33
 *
 * Options:
 *   --dry-run    Show what would happen without writing
 *   --keep       Keep FIX files after merging (don't delete)
 */

const fs = require('fs');
const path = require('path');

const args = process.argv.slice(2);
const dryRun = args.includes('--dry-run');
const keep = args.includes('--keep');
const sessionDir = args.find(a => !a.startsWith('--'));

if (!sessionDir) {
  console.error('Usage: node scripts/merge-fix-session.cjs <session-dir> [--dry-run] [--keep]');
  process.exit(1);
}

const resolvedDir = path.resolve(sessionDir);
const sessionFile = path.join(resolvedDir, 'SESSION.md');

if (!fs.existsSync(sessionFile)) {
  console.error(`SESSION.md not found in ${resolvedDir}`);
  process.exit(1);
}

// Find FIX files, sorted by number
const fixFiles = fs.readdirSync(resolvedDir)
  .filter(f => /^FIX-\d+\.md$/.test(f))
  .sort((a, b) => {
    const numA = parseInt(a.match(/FIX-(\d+)/)[1]);
    const numB = parseInt(b.match(/FIX-(\d+)/)[1]);
    return numA - numB;
  });

if (fixFiles.length === 0) {
  console.log('No FIX-XXX.md files found — nothing to merge.');
  process.exit(0);
}

console.log(`Found ${fixFiles.length} FIX files to merge into SESSION.md`);

// Read SESSION.md
let sessionContent = fs.readFileSync(sessionFile, 'utf8');

// Check if already merged
if (sessionContent.includes('## Issue Details')) {
  console.error('SESSION.md already contains "## Issue Details" — already merged?');
  process.exit(1);
}

// Build merged issue details section
const issueDetails = [];
issueDetails.push('## Issue Details');
issueDetails.push('');

for (const fixFile of fixFiles) {
  const fixPath = path.join(resolvedDir, fixFile);
  const fixContent = fs.readFileSync(fixPath, 'utf8');
  const fixId = fixFile.replace('.md', '');

  // Demote headings: # → ### , ## → #### , ### → ##### , #### → ######
  const demoted = fixContent
    .split('\n')
    .map(line => {
      if (/^####\s/.test(line)) return '#' + line;   // #### → #####
      if (/^###\s/.test(line)) return '#' + line;     // ### → ####
      if (/^##\s/.test(line)) return '#' + line;      // ## → ###
      if (/^#\s/.test(line)) return '##' + line;      // # → ###
      return line;
    })
    .join('\n');

  issueDetails.push(demoted);
  issueDetails.push('');
  issueDetails.push('---');
  issueDetails.push('');
}

const issueDetailsBlock = issueDetails.join('\n');

// Insert before Sign-off section
const signoffMarker = '## Sign-off';
const signoffIndex = sessionContent.indexOf(signoffMarker);

if (signoffIndex === -1) {
  // No sign-off found, append at end
  sessionContent = sessionContent.trimEnd() + '\n\n---\n\n' + issueDetailsBlock + '\n';
} else {
  // Insert before sign-off
  const before = sessionContent.slice(0, signoffIndex).trimEnd();
  const after = sessionContent.slice(signoffIndex);
  sessionContent = before + '\n\n---\n\n' + issueDetailsBlock + '\n' + after;
}

if (dryRun) {
  console.log('\n--- DRY RUN: Would write merged SESSION.md ---');
  console.log(`SESSION.md: ${sessionContent.split('\n').length} lines`);
  console.log(`FIX files that would be removed: ${fixFiles.join(', ')}`);
  process.exit(0);
}

// Write merged SESSION.md
fs.writeFileSync(sessionFile, sessionContent);
console.log(`Wrote merged SESSION.md (${sessionContent.split('\n').length} lines)`);

// Remove FIX files
if (!keep) {
  for (const fixFile of fixFiles) {
    fs.unlinkSync(path.join(resolvedDir, fixFile));
    console.log(`  Removed ${fixFile}`);
  }
  console.log(`\nMerged ${fixFiles.length} FIX files into SESSION.md and cleaned up.`);
} else {
  console.log(`\nMerged ${fixFiles.length} FIX files into SESSION.md (originals kept).`);
}
