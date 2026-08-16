'use strict';

/**
 * CI summary generator.
 *
 * Parses Bruno JUnit XML reports and writes a GitHub Actions step summary
 * ($GITHUB_STEP_SUMMARY) with a pass/fail table. Falls back to console
 * output when run outside CI.
 *
 * Usage: node scripts/ci-summary.js [junit.xml ...]
 */

import { readFileSync, appendFileSync, existsSync } from 'node:fs';
import { basename } from 'node:path';

const files = process.argv.slice(2).filter((f) => existsSync(f));

if (files.length === 0) {
  console.log('No JUnit reports found — skipping summary.');
  process.exit(0);
}

const parseJUnit = (xml) => {
  const suites = [];
  const suiteRe = /<testsuite\s[^>]*>/g;
  let m;
  while ((m = suiteRe.exec(xml)) !== null) {
    const tag = m[0];
    const attr = (name) => {
      const a = tag.match(new RegExp(`${name}="([^"]*)"`));
      return a ? a[1] : '0';
    };
    suites.push({
      name: attr('name'),
      tests: parseInt(attr('tests'), 10) || 0,
      failures: parseInt(attr('failures'), 10) || 0,
      errors: parseInt(attr('errors'), 10) || 0,
      skipped: parseInt(attr('skipped'), 10) || 0,
      time: parseFloat(attr('time')) || 0
    });
  }
  return suites;
};

const lines = [];
lines.push('## 🧪 API Test Results\n');
lines.push('| Suite | Tests | ✅ Passed | ❌ Failed | ⏭️ Skipped | Time |');
lines.push('|-------|-------|----------|----------|-----------|------|');

let totalTests = 0;
let totalFailures = 0;
let totalErrors = 0;
let totalSkipped = 0;
let totalTime = 0;

for (const file of files) {
  const xml = readFileSync(file, 'utf8');
  const suites = parseJUnit(xml);
  const suiteName = basename(file.replace('/junit.xml', ''));

  if (suites.length === 0) {
    lines.push(`| ${suiteName} | — | — | — | — | — |`);
    continue;
  }

  for (const s of suites) {
    const passed = s.tests - s.failures - s.errors - s.skipped;
    totalTests += s.tests;
    totalFailures += s.failures;
    totalErrors += s.errors;
    totalSkipped += s.skipped;
    totalTime += s.time;
    const status = s.failures + s.errors > 0 ? '❌' : '✅';
    lines.push(
      `| ${status} ${s.name || suiteName} | ${s.tests} | ${passed} | ${s.failures + s.errors} | ${s.skipped} | ${s.time.toFixed(1)}s |`
    );
  }
}

const totalPassed = totalTests - totalFailures - totalErrors - totalSkipped;
const overall = totalFailures + totalErrors > 0 ? '❌ FAILED' : '✅ PASSED';

lines.push('');
lines.push(`**Overall: ${overall}** — ${totalPassed}/${totalTests} passed in ${totalTime.toFixed(1)}s`);
lines.push('');

const summary = lines.join('\n');

if (process.env.GITHUB_STEP_SUMMARY) {
  appendFileSync(process.env.GITHUB_STEP_SUMMARY, summary + '\n');
  console.log('Step summary written.');
} else {
  console.log(summary);
}
