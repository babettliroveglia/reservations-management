// Copied from tenutaroveglia-testing (reporters/issues-reporter.ts); keep the two in step.
/**
 * Issues reporter: turns test results into an actionable, prioritised issue list.
 *
 * Inputs (set inside tests):
 *  - Severity tag on the test:   { tag: ['@high'] }   (@critical | @high | @medium | @low)
 *  - Suggested fix annotation:   { type: 'fix', description: '...' }
 *  - Owner/area annotation:      { type: 'area', description: 'Shop' }
 *  - Non-failing findings:       test.info().annotations.push({ type: 'finding', description: 'sev|title|detail|fix' })
 *    (use the `finding()` helper in tests/helpers.ts)
 *
 * Outputs, in the run's folder (reports/runs/<start time>/): issues.md, issues.html, issues.json
 * issues.json is the run's record; tools/publish-report.cjs turns it into the committed report.
 */
import type { FullResult, Reporter, TestCase, TestResult } from '@playwright/test/reporter';
import * as fs from 'fs';
import * as path from 'path';

type Severity = 'critical' | 'high' | 'medium' | 'low';
const ORDER: Severity[] = ['critical', 'high', 'medium', 'low'];

interface Issue {
  key: string;
  severity: Severity;
  kind: 'failure' | 'finding';
  area: string;
  title: string;
  detail: string;
  fix: string;
  projects: Set<string>;
  location: string;
  attachments: string[];
}

const stripAnsi = (s: string) => s.replace(/\u001b\[[0-9;]*m/g, '');
const esc = (s: string) => s.replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]!));

class IssuesReporter implements Reporter {
  private issues = new Map<string, Issue>();
  private counts = { passed: 0, failed: 0, skipped: 0, flaky: 0 };
  private outputDir: string;
  private started = new Date();

  constructor(opts: { outputDir?: string } = {}) {
    this.outputDir = opts.outputDir ?? 'reports';
  }

  private severityOf(test: TestCase): Severity {
    for (const s of ORDER) if (test.tags.includes(`@${s}`)) return s;
    return 'medium';
  }
  private annotation(test: TestCase, type: string) {
    return test.annotations.find(a => a.type === type)?.description ?? '';
  }

  private add(i: Omit<Issue, 'projects'>, project: string) {
    const existing = this.issues.get(i.key);
    if (existing) existing.projects.add(project);
    else this.issues.set(i.key, { ...i, projects: new Set([project]) });
  }

  onTestEnd(test: TestCase, result: TestResult) {
    const project = test.parent.project()?.name ?? '';
    const location = `${path.relative(process.cwd(), test.location.file)}:${test.location.line}`;
    const area = this.annotation(test, 'area') || path.basename(path.dirname(test.location.file));
    const isFinal = result.retry === test.retries || result.status === 'passed' || result.status === 'skipped';
    if (!isFinal) return;

    const outcome = test.outcome();
    if (outcome === 'expected') this.counts.passed++;
    else if (outcome === 'skipped') this.counts.skipped++;
    else if (outcome === 'flaky') this.counts.flaky++;
    else this.counts.failed++;

    // Findings recorded at runtime (don't fail the test, but belong in the report).
    for (const a of result.annotations ?? []) {
      if (a.type !== 'finding' || !a.description) continue;
      const [sev, title, detail, fix] = a.description.split('|');
      this.add(
        {
          key: `finding:${title}`,
          severity: (ORDER.includes(sev as Severity) ? sev : 'low') as Severity,
          kind: 'finding', area, title, detail: detail ?? '', fix: fix ?? '', location, attachments: [],
        },
        project,
      );
    }

    if (outcome === 'unexpected') {
      const err = stripAnsi(result.errors.map(e => e.message ?? '').join('\n')).trim();
      // Network-level failures mean the runner couldn't reach the site (often a firewall
      // block after too many requests). Collapse them into one infrastructure issue.
      if (/ERR_ADDRESS_UNREACHABLE|EHOSTUNREACH|ECONNREFUSED|ECONNRESET|ERR_CONNECTION_(REFUSED|RESET|TIMED_OUT)|ETIMEDOUT/.test(err)) {
        this.add(
          {
            key: 'infra:unreachable',
            severity: 'high',
            kind: 'failure',
            area: 'Test infrastructure',
            title: 'Site became unreachable from the test runner during the run',
            detail: err.split('\n').slice(0, 3).join('\n') + `\n(first seen in: ${test.title})`,
            fix: 'Most likely the SiteGround firewall/anti-bot blocked the runner IP. Results for affected tests are unknown, not failures. Wait 15–30 min, lower WORKERS / raise NAV_PACE_MS, or ask SiteGround support to allowlist the runner IP.',
            location,
            attachments: [],
          },
          project,
        );
        return;
      }
      this.add(
        {
          key: `fail:${test.titlePath().slice(2).join(' › ')}`,
          severity: this.severityOf(test),
          kind: 'failure',
          area,
          title: `Failed check: ${test.title.replace(/\s*@\w+/g, '')}`,
          detail: err.split('\n').slice(0, 12).join('\n'),
          fix: this.annotation(test, 'fix'),
          location,
          attachments: result.attachments.filter(a => a.path).map(a => path.relative(process.cwd(), a.path!)),
        },
        project,
      );
    } else if (outcome === 'flaky') {
      this.add(
        {
          key: `flaky:${test.titlePath().slice(2).join(' › ')}`,
          severity: 'low', kind: 'failure', area,
          title: `Flaky: ${test.title.replace(/\s*@\w+/g, '')}`,
          detail: 'Failed at least once, then passed on retry. May indicate slow pages or intermittent errors.',
          fix: 'Re-run; if it keeps happening, check page speed / hosting caching around this flow.',
          location, attachments: [],
        },
        project,
      );
    }
  }

  async onEnd(result: FullResult) {
    fs.mkdirSync(this.outputDir, { recursive: true });
    const issues = [...this.issues.values()].sort(
      (a, b) => ORDER.indexOf(a.severity) - ORDER.indexOf(b.severity) || a.area.localeCompare(b.area) || a.title.localeCompare(b.title),
    );
    const json = {
      generatedAt: new Date().toISOString(),
      startedAt: this.started.toISOString(),
      baseURL: process.env.BASE_URL ?? 'http://localhost:8787',
      status: result.status,
      // Options given to `playwright test`: any at all means a partial run, which is never published.
      args: process.argv.slice(process.argv.indexOf('test') + 1),
      siteUnreachable: fs.existsSync(path.join('test-results', '.site-unreachable')),
      counts: this.counts,
      issues: issues.map(i => ({ ...i, projects: [...i.projects] })),
    };
    fs.writeFileSync(path.join(this.outputDir, 'issues.json'), JSON.stringify(json, null, 2));
    fs.writeFileSync(path.join(this.outputDir, 'issues.md'), this.markdown(json));
    fs.writeFileSync(path.join(this.outputDir, 'issues.html'), this.html(json));
    console.log(`\nIssues report: ${issues.length} issue(s) → ${this.outputDir}/issues.html (and .md/.json)`);
    // reports/latest → this run. Replaced in one step, so it always points at a real run.
    fs.rmSync('reports/.latest-new', { force: true });
    fs.symlinkSync(path.relative('reports', this.outputDir), 'reports/.latest-new');
    fs.renameSync('reports/.latest-new', 'reports/latest');
  }

  private markdown(r: any) {
    const lines = [
      `# Tenuta Roveglia booking system test report`,
      ``,
      `Generated ${r.generatedAt} against ${r.baseURL}`,
      ``,
      `Tests: ${r.counts.passed} passed, ${r.counts.failed} failed, ${r.counts.flaky} flaky, ${r.counts.skipped} skipped.`,
      ``,
    ];
    for (const sev of ORDER) {
      const list = r.issues.filter((i: any) => i.severity === sev);
      if (!list.length) continue;
      lines.push(`## ${sev.toUpperCase()} (${list.length})`, '');
      for (const i of list) {
        lines.push(`### ${i.title}`, '');
        lines.push(`- **Area:** ${i.area}  ·  **Type:** ${i.kind}  ·  **Seen on:** ${i.projects.join(', ')}`);
        lines.push(`- **Test:** \`${i.location}\``);
        if (i.fix) lines.push(`- **Suggested fix:** ${i.fix}`);
        if (i.detail) lines.push('', '```', i.detail, '```');
        if (i.attachments.length) lines.push('', 'Evidence: ' + i.attachments.map((a: string) => `\`${a}\``).join(', '));
        lines.push('');
      }
    }
    if (!r.issues.length) lines.push('No issues found. 🎉');
    return lines.join('\n');
  }

  private html(r: any) {
    const colors: Record<Severity, string> = { critical: '#b42318', high: '#c4320a', medium: '#b54708', low: '#475467' };
    const cards = r.issues
      .map(
        (i: any) => `
<article class="issue" data-sev="${i.severity}">
  <header><span class="sev" style="background:${colors[i.severity as Severity]}">${i.severity}</span>
  <h3>${esc(i.title)}</h3></header>
  <p class="meta">${esc(i.area)} · ${i.kind} · ${i.projects.join(', ')} · <code>${esc(i.location)}</code></p>
  ${i.fix ? `<p class="fix"><strong>Suggested fix:</strong> ${esc(i.fix)}</p>` : ''}
  ${i.detail ? `<details><summary>Details</summary><pre>${esc(i.detail)}</pre></details>` : ''}
  ${i.attachments.length ? `<p class="meta">Evidence: ${i.attachments.map((a: string) => `<a href="${esc(path.relative(this.outputDir, a))}">${esc(path.basename(a))}</a>`).join(' · ')}</p>` : ''}
</article>`,
      )
      .join('\n');
    const summary = ORDER.map(s => `<span><b>${r.issues.filter((i: any) => i.severity === s).length}</b> ${s}</span>`).join('');
    return `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>Site Health Report</title><style>
:root{--bg:#faf9f7;--fg:#1d1b19;--muted:#6b645c;--card:#fff;--line:#e7e2db}
@media (prefers-color-scheme:dark){:root{--bg:#171513;--fg:#eee9e3;--muted:#a59d93;--card:#211e1b;--line:#38332e}}
body{margin:0;background:var(--bg);color:var(--fg);font:15px/1.5 system-ui,sans-serif}
main{max-width:900px;margin:0 auto;padding:24px 16px}
h1{font-size:24px;margin:0 0 4px}.sub{color:var(--muted);margin:0 0 16px}
.summary{display:flex;gap:16px;flex-wrap:wrap;margin:0 0 24px;color:var(--muted)}.summary b{color:var(--fg);font-size:20px}
.issue{background:var(--card);border:1px solid var(--line);border-radius:10px;padding:14px 16px;margin:0 0 12px}
.issue header{display:flex;gap:10px;align-items:baseline}.issue h3{margin:0;font-size:16px}
.sev{color:#fff;border-radius:4px;padding:1px 7px;font-size:12px;text-transform:uppercase;letter-spacing:.04em}
.meta{color:var(--muted);font-size:13px;margin:6px 0}.fix{margin:8px 0}
pre{white-space:pre-wrap;font-size:12px;background:var(--bg);padding:8px;border-radius:6px;overflow-x:auto}
</style></head><body><main>
<h1>Site health report</h1>
<p class="sub">${esc(r.baseURL)} · ${r.generatedAt} · tests: ${r.counts.passed} passed, ${r.counts.failed} failed, ${r.counts.flaky} flaky</p>
<div class="summary">${summary}</div>
${cards || '<p>No issues found.</p>'}
</main></body></html>`;
  }
}

export default IssuesReporter;
