// Copied from tenutaroveglia-testing (tools/severity-gate.cjs); keep the two in step.
// Decides whether a finished test run should count as failed, so the nightly "Run failed" email means
// the site needs attention now. Reads the run's issues.json (written by reporters/issues-reporter.ts).
//
// Exits 1 (run fails) when:
//  - a @critical or @high check failed (this includes "site became unreachable"), or
//  - the run did not finish normally: no results, interrupted, timed out, or an error outside the tests, or
//  - MANY_FAILURES or more checks failed at once, whatever their severity (likely something bigger).
// Otherwise exits 0, and failed @medium/@low checks and flaky checks are reported as warnings only.
//
// Writes gate.md next to issues.json for the run page, and prints GitHub annotations when GITHUB_ACTIONS is set.
// Run in Docker:  docker compose run --rm --entrypoint node tests tools/severity-gate.cjs [run folder name]
// With no name it checks the latest run. PLAYWRIGHT_EXIT, if set, is the exit code of `playwright test`.
const fs = require('fs');
const path = require('path');

const root = path.resolve(__dirname, '..');
const BLOCKING = ['critical', 'high'];
const MANY_FAILURES = 5;
const runDir = path.join(root, 'reports', process.argv[2] ? path.join('runs', process.argv[2]) : 'latest');
const onGitHub = !!process.env.GITHUB_ACTIONS;
const playwrightExit = process.env.PLAYWRIGHT_EXIT;

const oneLine = s => String(s ?? '').replace(/\s+/g, ' ').trim().replace(/%/g, '%25');
const annotate = (level, title, msg) => {
  if (onGitHub) console.log(`::${level} title=${oneLine(title).replace(/[:,]/g, ' ')}::${oneLine(msg)}`);
  else console.log(`${level.toUpperCase()}: ${oneLine(title)} — ${oneLine(msg)}`);
};

function finish(blocking, reasons, warnings) {
  const lines = ['## Nightly verdict', ''];
  if (blocking) {
    lines.push('**❌ FAILED: needs attention.**', '');
    for (const r of reasons) lines.push(`- ${r}`);
  } else if (warnings.length) {
    lines.push(`**✅ Site healthy: no critical or high checks failed.** ${warnings.length} warning(s), not urgent:`, '');
  } else {
    lines.push('**✅ Site healthy: all checks passed.**');
  }
  if (warnings.length) {
    if (blocking) lines.push('', 'Also failing (not urgent):', '');
    for (const w of warnings) lines.push(`- ⚠️ ${w}`);
  }
  try { fs.writeFileSync(path.join(runDir, 'gate.md'), lines.join('\n') + '\n\n'); } catch { /* no run folder */ }
  console.log(lines.join('\n'));
  process.exit(blocking ? 1 : 0);
}

const file = path.join(runDir, 'issues.json');
if (!fs.existsSync(file)) {
  annotate('error', 'No test results', `${path.relative(root, file)} is missing, so the tests did not finish.`);
  finish(true, ['No test results: the test run did not finish (see the "Run tests" step log).'], []);
}
const run = JSON.parse(fs.readFileSync(file, 'utf8'));
const reasons = [];
const warnings = [];

if (playwrightExit && playwrightExit !== '0' && playwrightExit !== '1') {
  reasons.push(`The test run ended abnormally (exit code ${playwrightExit}).`);
}
if (run.status === 'interrupted' || run.status === 'timedout') {
  reasons.push(`The test run was ${run.status === 'timedout' ? 'stopped by the global time limit' : 'interrupted'}, so some checks did not run.`);
}
if (run.status === 'failed' && run.counts.failed === 0) {
  reasons.push('The test run failed outside the checks themselves (for example in global setup). See the "Run tests" step log.');
}
if (run.counts.passed + run.counts.failed + run.counts.flaky === 0) {
  reasons.push('No checks ran.');
}
if (run.counts.failed >= MANY_FAILURES) {
  reasons.push(`${run.counts.failed} checks failed at once, which usually means something bigger is wrong.`);
}

for (const i of run.issues.filter(i => i.kind === 'failure')) {
  const where = `${i.title} [${i.severity}] (${i.projects.join(', ')}) — ${i.location}`;
  const firstLine = (i.detail || '').split('\n').find(l => l.trim()) ?? '';
  if (BLOCKING.includes(i.severity)) {
    reasons.push(where);
    annotate('error', i.title, `${i.severity}: ${firstLine} ${i.fix ? `Fix: ${i.fix}` : ''}`);
  } else {
    warnings.push(where);
    annotate('warning', i.title, `${i.severity}, not urgent: ${firstLine} ${i.fix ? `Fix: ${i.fix}` : ''}`);
  }
}

finish(reasons.length > 0, reasons, warnings);
