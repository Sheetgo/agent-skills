#!/usr/bin/env node
/**
 * check-fix-gate.cjs — Mechanical gate validation for fix-issues skill
 *
 * Validates that a fix-issues session directory meets gate requirements by
 * parsing structured markdown and checking filesystem evidence.
 *
 * Usage:
 *   node scripts/check-fix-gate.cjs <session-dir> <gate> <fix-id> [--scope=LIGHT|STANDARD|DEEP]
 *
 * Exit codes: 0 = PASS, 1 = FAIL, 2 = ERROR
 */

const fs = require('node:fs');
const path = require('node:path');
const { execFileSync } = require('node:child_process');

// UI-change detection keywords (narrowed per design review)
const UI_KEYWORDS = [
  'visual', 'cosmetic', 'CSS', 'style', 'appearance',
  'screenshot', 'layout', 'hover', 'icon', 'UI'
];

// ---------------------------------------------------------------------------
// Session directory parser
// ---------------------------------------------------------------------------

/**
 * Parse a session directory's SESSION.md into structured data.
 * @param {string} dirPath - Absolute path to the session directory
 * @returns {object} { summary, registry }
 */
function parseSessionDir(dirPath) {
  const sessionFile = path.join(dirPath, 'SESSION.md');
  const content = fs.readFileSync(sessionFile, 'utf8');
  return {
    summary: parseExecutiveSummary(content),
    registry: parseIssueRegistry(content),
  };
}

/**
 * Parse a per-issue file (FIX-XXX.md) into structured data.
 * @param {string} filePath - Absolute path to the issue markdown file
 * @returns {object} { section2, section3, section4 }
 */
function parseIssueFile(filePath) {
  const content = fs.readFileSync(filePath, 'utf8');

  const scope = (extractField(content, 'Scope') || '').toUpperCase();
  const status = extractField(content, 'Status') || '';

  const s2Block = extractSectionContent(content, '## 2. Investigation & Diagnosis') || '';
  const s3Block = extractSectionContent(content, '## 3. Fix Applied') || '';
  const s4Block = extractSectionContent(content, '## 4. Verification Results') || '';

  return {
    section2: {
      scope,
      status,
      hypothesis: extractSubsectionText(s2Block, '2.6'),
      affectedFiles: extractSubsectionTableFiles(s2Block, '2.1'),
      diagnosticResults: extractSubsectionTableRows(s2Block, '2.7'),
      preFixValidation: extractSubsectionTableRows(s2Block, '2.8'),
      universalProperties: extractUniversalPropertiesTable(s2Block),
      hasGatePassage: /GATE 1 PASSED/i.test(s2Block),
      isBatched: /GATE 1 PASSED.*\[batch\]/i.test(s2Block),
      raw: s2Block,
    },
    section3: {
      commitHash: (s3Block.match(/`([0-9a-f]{7,40})`/) || [])[1] || null,
      testsAdded: extractTestsAdded(s3Block),
      hasGatePassage: /GATE 2 PASSED/i.test(s3Block),
      hasImplementerEvidence: /Task tool|subagent|dispatched/i.test(s3Block),
      hasSpecReview: /[Ss]pec [Cc]omplian|review/i.test(s3Block),
      hasCodeReview: /[Cc]ode [Qq]uality|requesting-code-review/i.test(s3Block) || /LIGHT skip/i.test(s3Block),
      codeReviewSkipped: /LIGHT skip/i.test(s3Block),
      provisionalToken: /PROVISIONAL_PROPER_FIX_REQUIRED:/i.test(s3Block),
      raw: s3Block,
    },
    section4: {
      verificationRows: extractTableRows(s4Block)
        .filter(row => row.length >= 3 && row[0].trim() !== 'Check'),
      perPropertyVerdicts: extractPerPropertyVerdicts(s4Block),
      composedVerdict: extractComposedVerdict(s4Block),
      finalStatus: (s4Block.match(/\*\*Final Status\*\*:\s*(.+)/) || [])[1]?.trim() || '',
      hasGatePassage: /GATE 3 PASSED/i.test(s4Block),
      screenshotPaths: [...s4Block.matchAll(/([^\s]+\.png)/g)].map(m => m[1]),
      raw: s4Block,
    },
  };
}

// ---------------------------------------------------------------------------
// Helpers — universal-properties parsing (v2 — Property-Verdict Assertion)
// ---------------------------------------------------------------------------

/**
 * Normalize a property name from "P1 boundary crossing" → "P1", "P2a code-level async" → "P2A", etc.
 * Returns uppercase canonical form (P1, P2A, P2B, P3, ...).
 */
function normalizePropertyName(raw) {
  if (!raw) return '';
  const m = String(raw).trim().match(/^(P\d+[a-zA-Z]?)/);
  return m ? m[1].toUpperCase() : String(raw).trim().toUpperCase();
}

/**
 * Extract the universal-properties table from Section 2.5.
 * Handles both #### 2.5 and ##### 2.5 heading depths (mid-session vs post-merge SESSION.md).
 * Returns array of { property: 'P1', yes: bool, justification: string }.
 */
function extractUniversalPropertiesTable(s2Block) {
  if (!s2Block) return [];
  // Match #### 2.5 OR ##### 2.5 (post-merge depth) — stop at next heading of any depth
  const m = s2Block.match(/#{4,5}\s*2\.5[^\n]*\n([\s\S]*?)(?=#{2,5}\s|\n---|\n##|$)/);
  if (!m) return [];
  const rows = extractTableRows(m[1]);
  return rows
    .filter(row => row.length >= 2 && /^P\d/i.test(row[0].trim()))
    .map(row => ({
      property: normalizePropertyName(row[0]),
      yes: /\byes\b/i.test(row[1] || ''),
      justification: (row[2] || row.slice(2).join(' | ') || '').trim(),
    }));
}

/**
 * Extract the per-property verdicts table from Section 4.
 * Looks for the first table with a Property + Verdict column header.
 * Returns array of { property, verdict, tools, evidence }.
 */
function extractPerPropertyVerdicts(s4Block) {
  if (!s4Block) return [];
  const lines = s4Block.split('\n');
  const result = [];
  let inTable = false;
  let headers = null;
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i].trim();
    if (line.startsWith('|') && !line.match(/^\|[\s-|]+\|$/)) {
      const cells = line.split('|').slice(1, -1).map(c => c.trim());
      if (!inTable) {
        const lower = cells.map(c => c.toLowerCase());
        if (lower.includes('property') && lower.some(c => c === 'verdict')) {
          inTable = true;
          headers = lower;
          continue;
        }
      } else if (cells.length >= 2 && /^P\d/i.test(cells[0])) {
        result.push({
          property: normalizePropertyName(cells[0]),
          verdict: (cells[1] || '').replace(/\*\*/g, '').trim().toUpperCase(),
          tools: cells[2] || '',
          evidence: cells[3] || cells.slice(3).join(' | ') || '',
        });
      } else if (inTable && !/^\|[\s-|]+\|?$/.test(line)) {
        // Non-data row encountered — stop (table ended)
        if (cells.length > 0 && cells[0] && !/^P\d/i.test(cells[0])) {
          inTable = false;
        }
      }
    } else if (inTable && line === '') {
      inTable = false;
    }
  }
  return result;
}

/**
 * Extract the composed verdict declaration from Section 4.
 * Matches "Composed verdict: <X>" or "**Composed verdict**: <X>" with optional bold/asterisks.
 * Returns the verdict label (e.g., "LIVE-VERIFIED", "MOCK-VERIFIED + DEFERRED-PROPER") or null.
 */
function extractComposedVerdict(s4Block) {
  if (!s4Block) return null;
  // Match the LAST occurrence (in case initial verdict is mentioned then upgraded)
  const matches = [...s4Block.matchAll(
    /\*?\*?[Cc]omposed [Vv]erdict\*?\*?\s*:?\s*\*?\*?([A-Z_][A-Z_ -]*(?:\s*\+\s*[A-Z_][A-Z_ -]*)?)/g
  )];
  if (matches.length === 0) return null;
  const last = matches[matches.length - 1];
  return last[1].trim().replace(/\s+/g, ' ').toUpperCase();
}

/**
 * Decide if a per-property verdict's evidence cites a LIVE tool.
 * Used to detect mock-only rationalization (the FIX-001 failure mode).
 */
function evidenceCitesLiveTool(toolsAndEvidence) {
  if (!toolsAndEvidence) return false;
  const text = String(toolsAndEvidence).toLowerCase();
  // Live-tool keywords from PROJECT_PROFILE.md §H tool catalog (project-agnostic)
  const liveKeywords = [
    'playwright', 'clasp run', 'gcp log', 'cloud logging', 'bigquery', 'bq query',
    'live walk', 'live dev', 'real dev', 'real drive', 'real server',
    'screenshot', 'har capture', 'side-channel', 'side channel',
    'persistence query', 'persistence-layer query', 'integration test',
    'tier1', 'tier2', 'tier3', 'tier4', 'fault injection', 'chaos',
    'modifiedtime', 'modified time', 'log assertion', 'walk via',
    'deploy', 'browser_evaluate', 'page.evaluate', 'dom assertion',
  ];
  return liveKeywords.some(kw => text.includes(kw));
}

// ---------------------------------------------------------------------------
// Helpers — shared parsers (used by parseSessionDir)
// ---------------------------------------------------------------------------

/**
 * Parse Executive Summary table.
 */
function parseExecutiveSummary(content) {
  const summaryMatch = content.match(/## Executive Summary[\s\S]*?(?=\n---|\n## )/);
  if (!summaryMatch) return {};

  const result = {};
  const rows = extractTableRows(summaryMatch[0]);
  for (const row of rows) {
    if (row.length >= 2) {
      const key = row[0].trim();
      const val = parseInt(row[1].trim(), 10);
      if (!isNaN(val)) result[key] = val;
    }
  }
  return result;
}

/**
 * Parse Issue Registry table.
 */
function parseIssueRegistry(content) {
  const registrySection = extractSectionContent(content, '## 1. Issue Registry');
  if (!registrySection) return [];

  const rows = extractTableRows(registrySection);
  return rows
    .filter(row => row.length >= 6 && row[0].trim().startsWith('FIX-'))
    .map(row => ({
      id: row[0].trim(),
      category: row[1].trim(),
      description: row[2].trim(),
      status: row[3].trim(),
      rootCause: row[4].trim(),
      fixCommit: row[5].trim().replace(/`/g, ''),
    }));
}

// ---------------------------------------------------------------------------
// Helpers — markdown parsing
// ---------------------------------------------------------------------------

/**
 * Extract content between a ## heading and the next ## heading.
 */
function extractSectionContent(content, heading) {
  const escapedHeading = heading.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  const regex = new RegExp(`${escapedHeading}[\\s\\S]*?(?=\\n## [^#]|$)`);
  const match = content.match(regex);
  return match ? match[0] : null;
}

/**
 * Extract table rows from markdown. Returns array of arrays (cells).
 */
function extractTableRows(text) {
  const lines = text.split('\n');
  const rows = [];
  for (const line of lines) {
    if (line.trim().startsWith('|') && !line.trim().match(/^\|[\s-|]+\|$/)) {
      const cells = line.split('|').slice(1, -1); // trim outer pipes
      if (cells.length > 0) {
        rows.push(cells.map(c => c.trim()));
      }
    }
  }
  // Skip header row (first row)
  return rows.slice(1);
}

/**
 * Extract a **Field**: value from a block.
 */
function extractField(block, fieldName) {
  const regex = new RegExp(`\\*\\*${fieldName}\\*\\*:\\s*(.+)`, 'i');
  const match = block.match(regex);
  return match ? match[1].trim() : null;
}

/**
 * Extract text content from a #### 2.N subsection.
 */
function extractSubsectionText(block, subsectionNum) {
  const regex = new RegExp(
    `#### ${subsectionNum.replace('.', '\\.')}[\\s\\S]*?(?=####|$)`
  );
  const match = block.match(regex);
  if (!match) return '';

  const text = match[0]
    .replace(/^####[^\n]*\n/, '') // remove heading
    .replace(/\*\*[^*]+\*\*:\s*/g, '') // remove field labels
    .trim();

  return text;
}

/**
 * Extract file paths from a subsection's table (e.g., 2.1 Affected Files).
 */
function extractSubsectionTableFiles(block, subsectionNum) {
  const regex = new RegExp(
    `#### ${subsectionNum.replace('.', '\\.')}[\\s\\S]*?(?=####|$)`
  );
  const match = block.match(regex);
  if (!match) return [];

  const rows = extractTableRows(match[0]);
  return rows
    .filter(row => row.length >= 1 && row[0].trim() !== '' && row[0].trim() !== '|')
    .map(row => row[0].trim().replace(/`/g, ''));
}

/**
 * Extract non-empty rows from a subsection's table.
 */
function extractSubsectionTableRows(block, subsectionNum) {
  const regex = new RegExp(
    `#### ${subsectionNum.replace('.', '\\.')}[\\s\\S]*?(?=####|$)`
  );
  const match = block.match(regex);
  if (!match) return [];

  const rows = extractTableRows(match[0]);
  return rows.filter(row =>
    row.some(cell => cell.trim() !== '' && cell.trim() !== '|')
  );
}

/**
 * Extract tests from the Tests Added/Modified table in Section 3.
 */
function extractTestsAdded(block) {
  // Use \n---\n (section divider) not bare --- (would match table separator lines)
  const tableMatch = block.match(/#### Tests Added\/Modified[\s\S]*?(?=\n\*\*Commit|####|\n---\n|$)/);
  if (!tableMatch) {
    const altMatch = block.match(/Tests Added\/Modified[\s\S]*?(?=\n\*\*Commit|####|\n---\n|$)/);
    if (!altMatch) return [];
    const rows = extractTableRows(altMatch[0]);
    return rows
      .filter(row => row.length >= 1)
      .map(row => ({ file: row[0].trim().replace(/`/g, ''), description: row[1]?.trim() || '', type: row[2]?.trim() || '' }));
  }

  const rows = extractTableRows(tableMatch[0]);
  return rows
    .filter(row => row.length >= 1)
    .map(row => ({ file: row[0].trim().replace(/`/g, ''), description: row[1]?.trim() || '', type: row[2]?.trim() || '' }));
}

// ---------------------------------------------------------------------------
// Gate checks
// ---------------------------------------------------------------------------

/**
 * Run gate validation checks.
 * @param {string} sessionDir - Path to session directory
 * @param {number} gate - Gate number (1, 2, or 3)
 * @param {string} fixId - Issue ID (e.g., "FIX-001")
 * @param {object} [options] - Optional: { scope: 'LIGHT'|'STANDARD'|'DEEP' }
 * @returns {object} { result: 'PASS'|'FAIL'|'ERROR', checks: [], warnings: [], scope: string }
 */
function checkGate(sessionDir, gate, fixId, options = {}) {
  // Validate inputs
  if (!fixId || !/^FIX-\d{3}$/.test(fixId)) {
    return { result: 'ERROR', checks: [], warnings: [], scope: null, message: `Invalid FIX-ID: ${fixId}` };
  }
  if (![1, 2, 3].includes(gate)) {
    return { result: 'ERROR', checks: [], warnings: [], scope: null, message: `Invalid gate: ${gate}` };
  }

  const sessionFile = path.join(sessionDir, 'SESSION.md');
  if (!fs.existsSync(sessionFile)) {
    return { result: 'ERROR', checks: [], warnings: [], scope: null, message: `SESSION.md not found in: ${sessionDir}` };
  }

  const issueFile = path.join(sessionDir, `${fixId}.md`);
  if (!fs.existsSync(issueFile)) {
    return { result: 'ERROR', checks: [], warnings: [], scope: null, message: `${fixId}.md not found in: ${sessionDir}` };
  }

  let sessionData;
  try {
    sessionData = parseSessionDir(sessionDir);
  } catch (err) {
    return { result: 'ERROR', checks: [], warnings: [], scope: null, message: `Parse error: ${err.message}` };
  }

  let issueData;
  try {
    issueData = parseIssueFile(issueFile);
  } catch (err) {
    return { result: 'ERROR', checks: [], warnings: [], scope: null, message: `Parse error: ${err.message}` };
  }

  // Compose into shape checkGate1/2/3 expect
  const session = {
    summary: sessionData.summary,
    registry: sessionData.registry,
    section2: { [fixId]: issueData.section2 },
    section3: { [fixId]: issueData.section3 },
    section4: { [fixId]: issueData.section4 },
  };

  // For batch validation (GATE 1): load other issue files
  if (gate === 1 && issueData.section2?.isBatched) {
    const otherFiles = fs.readdirSync(sessionDir)
      .filter(f => /^FIX-\d{3}\.md$/.test(f) && f !== `${fixId}.md`);
    for (const f of otherFiles) {
      const id = f.replace('.md', '');
      try {
        const other = parseIssueFile(path.join(sessionDir, f));
        session.section2[id] = other.section2;
      } catch { /* skip unparseable files */ }
    }
  }

  // Resolve scope
  const warnings = [];
  const fileScope = session.section2[fixId]?.scope || null;
  let scope = fileScope;

  if (options.scope) {
    scope = options.scope.toUpperCase();
    if (fileScope && scope !== fileScope) {
      warnings.push(`CLI scope (${scope}) differs from issue file scope (${fileScope}) — using CLI override`);
    }
  }

  // Check that the fix exists in the session
  const registryEntry = session.registry.find(r => r.id === fixId);
  if (!registryEntry && !session.section2[fixId]) {
    return { result: 'ERROR', checks: [], warnings, scope, message: `${fixId} not found in session` };
  }

  // Dispatch to gate-specific checks
  let checks;
  switch (gate) {
    case 1: checks = checkGate1(session, fixId, scope); break;
    case 2: checks = checkGate2(session, fixId, scope); break;
    case 3: checks = checkGate3(session, fixId, scope, issueFile, options); break;
    default: return { result: 'ERROR', checks: [], warnings, scope, message: `Invalid gate: ${gate}` };
  }

  const failed = checks.filter(c => c.status === 'FAIL');
  const result = failed.length > 0 ? 'FAIL' : 'PASS';

  return { result, checks, warnings, scope };
}

/**
 * GATE 1: Investigation -> Fix
 */
function checkGate1(session, fixId, scope) {
  const s2 = session.section2[fixId];
  const registry = session.registry.find(r => r.id === fixId);
  const checks = [];
  const isStandardPlus = scope === 'STANDARD' || scope === 'DEEP';

  // 0. Section 2 heading must exist
  if (!s2) {
    checks.push({
      name: `Section 2 heading for ${fixId} exists`,
      status: 'FAIL',
      detail: `Section 2 heading not found in ${fixId}.md — cannot validate investigation`,
    });
    return checks;
  }

  // 1. Section 2.1 has at least 1 file path
  checks.push({
    name: 'Section 2.1 (Affected Files) has file paths',
    status: s2 && s2.affectedFiles.length > 0 ? 'PASS' : 'FAIL',
    detail: s2 ? `Found ${s2.affectedFiles.length} file(s)` : 'Section 2 missing',
  });

  // 2. Section 2.6 hypothesis is not TBD/empty
  const hypOk = s2 && s2.hypothesis && !isOnlyTBD(s2.hypothesis);
  checks.push({
    name: 'Section 2.6 (Hypothesis) has confirmed root cause',
    status: hypOk ? 'PASS' : 'FAIL',
    detail: hypOk ? 'Root cause documented' : 'Hypothesis is empty or TBD',
  });

  // 3. Section 2.7 populated for STANDARD/DEEP
  if (isStandardPlus) {
    const diagOk = s2 && s2.diagnosticResults.length > 0;
    checks.push({
      name: 'Section 2.7 (Diagnostic Results) populated — STANDARD/DEEP required',
      status: diagOk ? 'PASS' : 'FAIL',
      detail: diagOk ? `${s2.diagnosticResults.length} diagnostic result(s)` : 'Empty — STANDARD/DEEP requires diagnostics',
    });
  } else {
    checks.push({
      name: 'Section 2.7 (Diagnostic Results) — LIGHT scope, optional',
      status: 'PASS',
      detail: 'Diagnostic tooling optional for LIGHT scope',
    });
  }

  // 4. Section 2.8 pre-fix validation populated
  const preFixOk = s2 && s2.preFixValidation.length > 0;
  checks.push({
    name: 'Section 2.8 (Pre-Fix Validation) has subagent results',
    status: preFixOk ? 'PASS' : 'FAIL',
    detail: preFixOk ? `${s2.preFixValidation.length} validation result(s)` : 'No pre-fix validation results',
  });

  // 5. Issue Registry status = DIAGNOSED (or later)
  const validStatuses = ['DIAGNOSED', 'FIXING', 'FIXED', 'VERIFIED', 'PARTIALLY_VERIFIED'];
  const statusOk = registry && validStatuses.includes(registry.status);
  checks.push({
    name: 'Issue Registry status = DIAGNOSED (or later)',
    status: statusOk ? 'PASS' : 'FAIL',
    detail: registry ? `Status: ${registry.status}` : 'Not found in registry',
  });

  // 6. GATE 1 PASSAGE marker
  checks.push({
    name: 'GATE 1 PASSAGE marker present',
    status: s2 && s2.hasGatePassage ? 'PASS' : 'FAIL',
    detail: s2?.hasGatePassage ? 'Found' : 'Missing — write "GATE 1 PASSED [timestamp]"',
  });

  // 7. Batch validation (v3.1.5) — only when [batch] marker present
  if (s2 && s2.isBatched) {
    // 7a. Scope must be LIGHT for batching
    checks.push({
      name: 'Batch scope: only LIGHT can batch',
      status: scope === 'LIGHT' ? 'PASS' : 'FAIL',
      detail: scope === 'LIGHT'
        ? 'LIGHT scope — batching allowed'
        : `Scope is ${scope} — batching not allowed for STANDARD/DEEP`,
    });

    // 7b. Max 3 LIGHT issues per batch (count others with [batch])
    //     Exclude already-completed issues (VERIFIED/DEFERRED) from prior batches
    if (scope === 'LIGHT') {
      const terminalStatuses = ['VERIFIED', 'DEFERRED', 'BLOCKED'];
      const otherBatched = Object.entries(session.section2)
        .filter(([id, data]) => {
          if (id === fixId || !data.isBatched || data.scope !== 'LIGHT') return false;
          const reg = session.registry.find(r => r.id === id);
          return !reg || !terminalStatuses.includes(reg.status);
        })
        .length;
      checks.push({
        name: 'Batch size: max 3 LIGHT issues',
        status: otherBatched < 3 ? 'PASS' : 'FAIL',
        detail: otherBatched < 3
          ? `${otherBatched + 1} LIGHT issues in batch (max 3)`
          : `${otherBatched + 1} LIGHT issues in batch — exceeds max 3`,
      });
    }
  }

  return checks;
}

/**
 * GATE 2: Fix -> Verify
 */
function checkGate2(session, fixId, scope) {
  const s3 = session.section3[fixId];
  const registry = session.registry.find(r => r.id === fixId);
  const checks = [];
  const isStandardPlus = scope === 'STANDARD' || scope === 'DEEP';

  // 0. Section 3 heading must exist
  if (!s3) {
    checks.push({
      name: `Section 3 heading for ${fixId} exists`,
      status: 'FAIL',
      detail: `Section 3 heading not found in ${fixId}.md — cannot validate fix`,
    });
    return checks;
  }

  // 1. Section 3 has commit hash
  checks.push({
    name: 'Section 3 has commit hash',
    status: s3 && s3.commitHash ? 'PASS' : 'FAIL',
    detail: s3?.commitHash ? `Commit: ${s3.commitHash}` : 'No commit hash found',
  });

  // 2. Implementer dispatch evidence
  checks.push({
    name: 'Section 3 has implementer dispatch evidence',
    status: s3 && s3.hasImplementerEvidence ? 'PASS' : 'FAIL',
    detail: s3?.hasImplementerEvidence ? 'Found Task/subagent reference' : 'No implementer dispatch evidence',
  });

  // 3. Spec compliance review evidence
  checks.push({
    name: 'Section 3 has spec compliance review evidence',
    status: s3 && s3.hasSpecReview ? 'PASS' : 'FAIL',
    detail: s3?.hasSpecReview ? 'Found spec review reference' : 'No spec compliance review evidence',
  });

  // 4. Code quality review (STANDARD+) or skip documented
  if (isStandardPlus) {
    const codeOk = s3 && s3.hasCodeReview && !s3.codeReviewSkipped;
    checks.push({
      name: 'Code quality review done (STANDARD/DEEP scope required)',
      status: codeOk ? 'PASS' : 'FAIL',
      detail: codeOk ? 'Code review documented' : s3?.codeReviewSkipped
        ? 'LIGHT skip claimed for STANDARD/DEEP scope — scope mismatch'
        : 'No code review evidence',
    });
  } else {
    checks.push({
      name: 'Code quality review — LIGHT scope, skip documented',
      status: s3 && s3.codeReviewSkipped ? 'PASS' : (s3 && s3.hasCodeReview ? 'PASS' : 'FAIL'),
      detail: s3?.codeReviewSkipped ? 'LIGHT skip documented' : (s3?.hasCodeReview ? 'Review done' : 'No skip documentation'),
    });
  }

  // 5. Commit in registry
  const registryOk = registry && registry.fixCommit && registry.fixCommit !== '';
  checks.push({
    name: 'Fix commit in Issue Registry',
    status: registryOk ? 'PASS' : 'FAIL',
    detail: registryOk ? `Registry commit: ${registry.fixCommit}` : 'No commit in registry',
  });

  // 6. Issue Registry status = FIXED or later
  const validStatuses = ['FIXED', 'VERIFIED', 'PARTIALLY_VERIFIED'];
  const statusOk = registry && validStatuses.includes(registry.status);
  checks.push({
    name: 'Issue Registry status = FIXED (or later)',
    status: statusOk ? 'PASS' : 'FAIL',
    detail: registry ? `Status: ${registry.status}` : 'Not found in registry',
  });

  // 7. Scope consistency (Section 2 vs Section 3)
  const s2Scope = session.section2[fixId]?.scope;
  if (s2Scope && s3) {
    const s3ClaimsLight = s3.codeReviewSkipped;
    const scopeMismatch = (s2Scope === 'STANDARD' || s2Scope === 'DEEP') && s3ClaimsLight;
    checks.push({
      name: 'Section 3 scope matches Section 2 scope',
      status: scopeMismatch ? 'FAIL' : 'PASS',
      detail: scopeMismatch
        ? `Section 2 says ${s2Scope} but Section 3 claims LIGHT skip`
        : 'Scope consistent',
    });
  }

  // 8. GATE 2 PASSAGE marker
  checks.push({
    name: 'GATE 2 PASSAGE marker present',
    status: s3 && s3.hasGatePassage ? 'PASS' : 'FAIL',
    detail: s3?.hasGatePassage ? 'Found' : 'Missing — write "GATE 2 PASSED [timestamp]"',
  });

  return checks;
}

/**
 * GATE 3: Verify -> VERIFIED
 */
function checkGate3(session, fixId, scope, issueFilePath, options = {}) {
  const s3 = session.section3[fixId];
  const s4 = session.section4[fixId];
  const s2 = session.section2[fixId];
  const checks = [];

  // 0. Section 4 heading must exist
  if (!s4) {
    checks.push({
      name: `Section 4 heading for ${fixId} exists`,
      status: 'FAIL',
      detail: `Section 4 heading not found in ${fixId}.md — cannot validate verification`,
    });
    return checks;
  }

  // 1. Section 4 has at least 1 test command + result
  const hasVerification = s4 && s4.verificationRows.length > 0;
  checks.push({
    name: 'Section 4 has test command + result',
    status: hasVerification ? 'PASS' : 'FAIL',
    detail: hasVerification ? `${s4.verificationRows.length} verification row(s)` : 'No verification results',
  });

  // 2. Regression test — Section 3 "Tests Added/Modified" has a non-N/A file path
  const testsAdded = s3?.testsAdded || [];
  const hasRealTest = testsAdded.some(t =>
    t.file && t.file !== 'N/A' && t.file !== '' && t.type !== 'N/A'
  );
  checks.push({
    name: 'Regression test file referenced (not N/A)',
    status: hasRealTest ? 'PASS' : 'FAIL',
    detail: hasRealTest
      ? `Test file: ${testsAdded.find(t => t.file !== 'N/A')?.file}`
      : 'Tests Added shows N/A — every fix needs a regression test file path',
  });

  // 2b. Verify referenced test file actually exists on disk
  if (hasRealTest) {
    const testFileExists = testsAdded.some(t => {
      if (!t.file || t.file === 'N/A' || t.file === '') return false;
      return fs.existsSync(t.file) || fs.existsSync(path.resolve(t.file));
    });
    checks.push({
      name: 'Regression test file exists on disk',
      status: testFileExists ? 'PASS' : 'FAIL',
      detail: testFileExists
        ? 'Test file verified on disk'
        : `Test file NOT found: ${testsAdded.find(t => t.file !== 'N/A')?.file} — verify the file was actually created`,
    });

    // v3.1.5: Test file commit membership — WARN if not in commit diff
    const commitHash = s3?.commitHash;
    if (commitHash && testFileExists) {
      const mockGitDiff = options._mockGitDiff;
      let diffOutput = '';
      if (mockGitDiff !== undefined) {
        // Test injection: use provided mock output
        diffOutput = mockGitDiff;
      } else {
        try {
          diffOutput = execFileSync('git', ['diff', '--name-only', `${commitHash}^..${commitHash}`], {
            encoding: 'utf8', timeout: 5000,
          });
        } catch { /* git command failed — skip check */ }
      }

      if (diffOutput) {
        const diffFiles = diffOutput.trim().split('\n').map(f => f.trim());
        const missingFromCommit = testsAdded.filter(t => {
          if (!t.file || t.file === 'N/A' || t.file === '') return false;
          return !diffFiles.some(df => t.file.includes(df) || df.includes(t.file));
        });
        if (missingFromCommit.length > 0) {
          checks.push({
            name: 'Regression test file commit membership',
            status: 'WARN',
            detail: `Test file '${missingFromCommit[0].file}' exists but NOT in commit ${commitHash}. Either commit the test changes or update Tests Added/Modified.`,
          });
        }
      }
    }
  }

  // 3. UI change -> screenshot check
  const isUIChange = detectUIChange(s2, session.registry.find(r => r.id === fixId));
  if (isUIChange) {
    // Screenshot dir = parent dir of issue file = session dir
    const screenshotDir = issueFilePath ? path.dirname(issueFilePath) : null;
    const hasScreenshotRef = s4 && s4.screenshotPaths.length > 0;
    let screenshotExists = false;

    if (hasScreenshotRef && screenshotDir) {
      // Check if any referenced .png exists
      screenshotExists = s4.screenshotPaths.some(p => {
        const fullPath = path.isAbsolute(p) ? p : path.join(screenshotDir, p);
        return fs.existsSync(fullPath);
      });
    }

    checks.push({
      name: 'UI change: screenshot files exist on disk',
      status: hasScreenshotRef && screenshotExists ? 'PASS' : 'FAIL',
      detail: !hasScreenshotRef
        ? 'UI change detected but no .png files referenced in Section 4'
        : !screenshotExists
          ? `Screenshot referenced but NOT found on disk: ${s4.screenshotPaths.join(', ')}`
          : `Screenshot(s) verified: ${s4.screenshotPaths.join(', ')}`,
    });

    // v3.1.5: Screenshot recency check — WARN if mtime > 24h from issue file
    if (hasScreenshotRef && screenshotExists && issueFilePath) {
      const issueMtime = fs.statSync(issueFilePath).mtime;
      const staleScreenshots = s4.screenshotPaths.filter(p => {
        const fullPath = path.isAbsolute(p) ? p : path.join(screenshotDir, p);
        try {
          const shotMtime = fs.statSync(fullPath).mtime;
          const diffMs = Math.abs(issueMtime.getTime() - shotMtime.getTime());
          return diffMs > 24 * 60 * 60 * 1000; // > 24 hours
        } catch { return false; }
      });
      if (staleScreenshots.length > 0) {
        const diffDays = staleScreenshots.map(p => {
          const fullPath = path.isAbsolute(p) ? p : path.join(screenshotDir, p);
          const shotMtime = fs.statSync(fullPath).mtime;
          return Math.round(Math.abs(issueMtime.getTime() - shotMtime.getTime()) / (24 * 60 * 60 * 1000));
        });
        checks.push({
          name: 'UI change: screenshot recency',
          status: 'WARN',
          detail: `Screenshot exists but is stale (modified ${diffDays[0]} day(s) before/after session). Re-run visual tests or take a fresh screenshot.`,
        });
      }
    }
  }

  // 4. Final Status is not TBD
  const finalOk = s4 && s4.finalStatus && s4.finalStatus !== 'TBD' && s4.finalStatus !== '';
  checks.push({
    name: 'Section 4 Final Status is populated',
    status: finalOk ? 'PASS' : 'FAIL',
    detail: finalOk ? `Final Status: ${s4.finalStatus}` : 'Final Status is empty or TBD',
  });

  // 5. Executive Summary counts non-zero
  const summaryOk = session.summary['Total issues registered'] > 0 &&
    session.summary['Issues fixed & verified'] > 0;
  checks.push({
    name: 'Executive Summary counts are non-zero',
    status: summaryOk ? 'PASS' : 'FAIL',
    detail: summaryOk
      ? `Registered: ${session.summary['Total issues registered']}, Verified: ${session.summary['Issues fixed & verified']}`
      : 'Executive Summary has zero counts',
  });

  // 5b. Registry status matches Section 4 Final Status
  const registryEntry = session.registry.find(r => r.id === fixId);
  const registryStatus = (registryEntry?.status || '').replace(/\*\*/g, '').trim().toUpperCase();
  const finalStatusVal = (s4?.finalStatus || '').replace(/\*\*/g, '').trim().toUpperCase();
  if (registryStatus && finalStatusVal) {
    checks.push({
      name: 'Registry status matches Section 4 Final Status',
      status: registryStatus === finalStatusVal ? 'PASS' : 'FAIL',
      detail: registryStatus === finalStatusVal
        ? `Both: ${registryStatus}`
        : `Registry says "${registryEntry?.status}" but Section 4 Final Status says "${s4?.finalStatus}" — update Issue Registry in SESSION.md to match`,
    });
  }

  // 6. GATE 3 PASSAGE marker
  checks.push({
    name: 'GATE 3 PASSAGE marker present',
    status: s4 && s4.hasGatePassage ? 'PASS' : 'FAIL',
    detail: s4?.hasGatePassage ? 'Found' : 'Missing — write "GATE 3 PASSED [timestamp]"',
  });

  // ---------------------------------------------------------------------------
  // 7. PROPERTY-VERDICT ASSERTION (v2 — closes the rationalization loophole)
  // ---------------------------------------------------------------------------
  // Reference: SKILL.md Gate 3 Step 3. Cross-references Section 2.5 yes properties
  // to Section 4 per-property verdicts to catch the FIX-001 failure mode where an
  // agent stamps MOCK-VERIFIED with code-reading evidence despite LIVE-required
  // properties firing yes.

  const yesProperties = (s2?.universalProperties || []).filter(p => p.yes);
  const perPropertyVerdicts = s4?.perPropertyVerdicts || [];
  const composedVerdict = s4?.composedVerdict || '';
  const LIVE_REQUIRED = ['P1', 'P2A', 'P2B', 'P3', 'P5'];
  const liveTriggeredYes = yesProperties
    .map(p => p.property.toUpperCase())
    .filter(p => LIVE_REQUIRED.includes(p));

  // 7a. Section 2.5 must be present when fix is non-trivial
  // (Skip if Section 2.5 has no rows at all — the agent may not have populated it
  // yet at gate-1 time. At gate-3 time, an empty Section 2.5 is itself a violation.)
  if (s2?.universalProperties && s2.universalProperties.length === 0) {
    checks.push({
      name: 'Section 2.5 Universal Properties table populated',
      status: 'FAIL',
      detail: 'Section 2.5 has no property rows. Every fix must answer P1–P13 yes/no with one-line justification per Phase 1.4.',
    });
  }

  // 7b. Each yes property has a per-property verdict in Section 4
  if (yesProperties.length > 0) {
    const perPropertyMap = new Map(
      perPropertyVerdicts.map(v => [v.property.toUpperCase(), v])
    );
    const missingVerdicts = yesProperties.filter(p =>
      !perPropertyMap.has(p.property.toUpperCase())
    );
    checks.push({
      name: 'Section 4 has per-property verdict for each yes property',
      status: missingVerdicts.length === 0 ? 'PASS' : 'FAIL',
      detail: missingVerdicts.length === 0
        ? `${perPropertyVerdicts.length} per-property verdict(s) cover ${yesProperties.length} yes propert${yesProperties.length === 1 ? 'y' : 'ies'}`
        : `Missing per-property verdict for: ${missingVerdicts.map(p => p.property).join(', ')}. Section 2.5 fired yes; Section 4 must have a verdict row citing tools + evidence for each.`,
    });
  }

  // 7c. Composed verdict reflects LIVE-required properties
  if (liveTriggeredYes.length > 0) {
    const composed = composedVerdict || '';
    // Acceptable composed verdicts when LIVE-required fired:
    //   LIVE-VERIFIED [+ DEFERRED-PROPER]
    //   LIMITED-VERIFIED [+ DEFERRED-PROPER]   (only if §H is empty for the property)
    //   OUT_OF_BAND_VERIFICATION_REQUIRED      (capability-boundary category fired)
    const acceptable = /LIVE-VERIFIED|LIMITED-VERIFIED|OUT_OF_BAND/.test(composed);
    const isMockOnly = /^MOCK-VERIFIED(\s*\+|$)/.test(composed) || composed === 'MOCK-VERIFIED';
    checks.push({
      name: `Composed verdict reflects LIVE-required properties (${liveTriggeredYes.join(', ')} fired)`,
      status: acceptable ? 'PASS' : 'FAIL',
      detail: acceptable
        ? `Composed verdict: ${composed}`
        : isMockOnly
          ? `Composed = ${composed} but ${liveTriggeredYes.join('/')} fired yes in Section 2.5. Each LIVE-required property needs live-tool evidence. Either: (a) run a §H live tool, (b) demote to LIMITED-VERIFIED with §H-empty justification per property, or (c) stamp OUT_OF_BAND if a §I capability-boundary category applies. "Existing boundaries are live-covered by the wider integration suite" is a forbidden rationalization (Red Flag).`
          : composed
            ? `Unrecognized composed verdict: "${composed}"`
            : 'Composed verdict line missing from Section 4. Write "Composed verdict: LIVE-VERIFIED" (or LIMITED/OUT_OF_BAND/MOCK-VERIFIED + DEFERRED-PROPER as appropriate).',
    });
  }

  // 7d. Per-property evidence for each LIVE-required PASS verdict cites a live tool
  // (otherwise LIMITED-VERIFIED is the correct verdict, not PASS)
  for (const v of perPropertyVerdicts) {
    if (!LIVE_REQUIRED.includes(v.property.toUpperCase())) continue;
    if (v.verdict !== 'PASS') continue; // FAIL/LIMITED-VERIFIED are honest already
    const combined = `${v.tools} ${v.evidence}`;
    if (!evidenceCitesLiveTool(combined)) {
      checks.push({
        name: `Per-property evidence for ${v.property} is not mock-only`,
        status: 'FAIL',
        detail: `${v.property} verdict=PASS but evidence cites only mock-tier tools: tools="${v.tools.slice(0, 80)}", evidence="${v.evidence.slice(0, 80)}". For LIVE-required properties, PASS requires at least one of: Playwright, clasp run, GCP log, BigQuery, live walk, screenshot, side-channel check, integration test (tier1+). If §H has no live tool for ${v.property} in this project, demote verdict to LIMITED-VERIFIED instead of PASS.`,
      });
    }
  }

  // 7e. PROVISIONAL fix-type sanity: if Section 3 has the literal token,
  // composed verdict must end in DEFERRED-PROPER (not plain LIVE-VERIFIED)
  if (s3?.provisionalToken && composedVerdict) {
    if (!/DEFERRED-PROPER/.test(composedVerdict)) {
      checks.push({
        name: 'PROVISIONAL fix has DEFERRED-PROPER composed verdict',
        status: 'FAIL',
        detail: `Section 3 has PROVISIONAL_PROPER_FIX_REQUIRED token but composed verdict is "${composedVerdict}" without "+ DEFERRED-PROPER" suffix. Update to "${composedVerdict} + DEFERRED-PROPER".`,
      });
    }
  }

  return checks;
}

// ---------------------------------------------------------------------------
// Helpers — gate logic
// ---------------------------------------------------------------------------

/**
 * Check if text is only "TBD" (with optional whitespace/formatting).
 */
function isOnlyTBD(text) {
  const cleaned = text
    .replace(/\*\*/g, '') // remove bold markers
    .replace(/^(Initial|After Diagnosis):\s*/gm, '') // remove field labels
    .replace(/\[TBD\]/g, 'TBD')
    .trim();
  return cleaned === 'TBD' || cleaned === 'TBD\n\nTBD' || cleaned === '';
}

/**
 * Detect if an issue involves UI changes based on Section 2 content and category.
 */
function detectUIChange(section2, registryEntry) {
  const texts = [
    section2?.raw || '',
    registryEntry?.category || '',
    registryEntry?.description || '',
  ].join(' ');

  // Check for explicit override
  if (/\*\*UI Change\*\*:\s*No/i.test(texts)) return false;

  return UI_KEYWORDS.some(keyword => {
    const regex = new RegExp(`\\b${keyword}\\b`, 'i');
    return regex.test(texts);
  });
}

// ---------------------------------------------------------------------------
// CLI
// ---------------------------------------------------------------------------

function formatOutput(result) {
  // Compact 1-line output for PASS
  if (result.result === 'PASS') {
    const warnCount = result.checks.filter(c => c.status === 'WARN').length;
    const warnSuffix = warnCount > 0 ? `, ${warnCount} warning(s)` : '';
    return `\u2713 GATE ${result.gate} PASS (${result.fixId}, scope: ${result.scope || 'unknown'}, ${result.checks.length}/${result.checks.length} checks${warnSuffix})`;
  }

  // Verbose output for FAIL/ERROR (unchanged logic)
  const lines = [];
  lines.push(`GATE ${result.gate} CHECK for ${result.fixId} (scope: ${result.scope || 'unknown'}):`);

  for (const check of result.checks) {
    const icon = check.status === 'PASS' ? '  [PASS]'
      : check.status === 'WARN' ? '  [WARN]'
      : '  [FAIL]';
    lines.push(`${icon} ${check.name}`);
    if ((check.status === 'FAIL' || check.status === 'WARN') && check.detail) {
      lines.push(`         ${check.detail}`);
    }
  }

  for (const w of result.warnings) {
    lines.push(`  [WARN] ${w}`);
  }

  lines.push('');
  const failCount = result.checks.filter(c => c.status === 'FAIL').length;
  const warnCount = result.checks.filter(c => c.status === 'WARN').length;
  const totalCount = result.checks.length;
  const warnSuffix = warnCount > 0 ? `, ${warnCount} warning(s)` : '';

  if (result.result === 'FAIL') {
    lines.push(`RESULT: FAIL (${failCount} of ${totalCount} checks failed${warnSuffix})`);
    lines.push('ACTION: Fix the failing checks, then re-run this command.');
  } else {
    lines.push(`RESULT: ERROR — ${result.message}`);
  }

  return lines.join('\n');
}

// Main CLI entry point
if (require.main === module) {
  const args = process.argv.slice(2);
  const flags = {};
  const positional = [];

  for (const arg of args) {
    if (arg.startsWith('--')) {
      const [key, val] = arg.slice(2).split('=');
      flags[key] = val;
    } else {
      positional.push(arg);
    }
  }

  if (positional.length < 3) {
    console.error('Usage: node check-fix-gate.cjs <session-dir> <gate> <fix-id> [--scope=LIGHT|STANDARD|DEEP]');
    process.exit(2);
  }

  const [sessionDir, gateStr, fixId] = positional;
  const gate = parseInt(gateStr, 10);
  const options = {};
  if (flags.scope) options.scope = flags.scope;

  const result = checkGate(sessionDir, gate, fixId, options);
  result.gate = gate;
  result.fixId = fixId;
  console.log(formatOutput(result));
  process.exit(result.result === 'PASS' ? 0 : result.result === 'FAIL' ? 1 : 2);
}

// ---------------------------------------------------------------------------
// Exports for testing
// ---------------------------------------------------------------------------

module.exports = { checkGate, parseSessionDir, parseIssueFile, formatOutput };
