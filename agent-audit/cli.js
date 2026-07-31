#!/usr/bin/env node
/**
 * Agent audit CLI.
 *
 *   node cli.js audit <url>            one target, full report
 *   node cli.js campaign <url...>      batch, ranked queue with drafts
 *
 * Neither mode sends anything. A human reads the drafts and decides, because one wrong
 * finding costs more than every prospect it might have won.
 */

import fs from 'node:fs';
import path from 'node:path';
import { auditAgent } from './src/agentaudit.js';
import { renderAgentReport } from './src/agentreport.js';
import { runCampaign } from './src/campaign.js';

const argv = process.argv.slice(2);
const MODES = new Set(['audit', 'campaign']);
const mode = MODES.has(argv[0]) ? argv[0] : 'audit';
const rest = MODES.has(argv[0]) ? argv.slice(1) : argv;

const flag = (name, fallback) => {
  const hit = rest.find((a) => a.startsWith(`--${name}=`));
  return hit ? hit.split('=').slice(1).join('=') : fallback;
};
const targets = rest.filter((a) => !a.startsWith('--'));
const outDir = flag('out', 'results');
const runs = Math.max(1, Number(flag('runs', 3)));
// Exposed because the sensible default is slow: a real agent needs several seconds to
// answer, and a run is questions x sessions x targets of that.
const replyWaitMs = Math.max(500, Number(flag('reply-wait', 9000)));
const betweenRunsMs = Math.max(0, Number(flag('between-runs', 3000)));

if (!targets.length) {
  console.error(
    'usage: node cli.js [audit|campaign] <url...> [--out=dir] [--runs=3] [--sender=name]\n' +
      '       [--concurrency=2] [--reply-wait=9000] [--between-runs=3000]'
  );
  process.exit(1);
}

fs.mkdirSync(outDir, { recursive: true });
const slug = (u) =>
  u.replace(/^https?:\/\//, '').replace(/[^a-z0-9]+/gi, '_').replace(/_+$/, '').slice(0, 60);

if (mode === 'campaign') {
  const senderName = flag('sender', null);
  const result = await runCampaign(targets, {
    runs,
    replyWaitMs,
    betweenRunsMs,
    senderName,
    concurrency: Math.max(1, Number(flag('concurrency', 2))),
    onAudit: (audit, err) =>
      process.stderr.write(
        err
          ? `  failed   ${err.url}  ${err.error}\n`
          : `  audited  ${audit.url}  ${audit.findings.length} finding(s)` +
            `${audit.inconclusive ? '  (inconclusive)' : ''}\n`
      ),
  });

  const reportsDir = path.join(outDir, 'reports');
  const draftsDir = path.join(outDir, 'drafts');
  fs.mkdirSync(reportsDir, { recursive: true });
  fs.mkdirSync(draftsDir, { recursive: true });

  for (const item of result.ranked) {
    fs.writeFileSync(path.join(reportsDir, `${slug(item.url)}.html`), item.report);
    if (item.draft) {
      fs.writeFileSync(
        path.join(draftsDir, `${slug(item.url)}.txt`),
        `Subject: ${item.draft.subject}\n\n${item.draft.body}\n\n---\nVERIFY BEFORE SENDING\n` +
          item.draft.plainFacts.map((f) => `  ${f}`).join('\n') +
          '\n'
      );
    }
  }

  console.log('\n=== AGENT AUDIT CAMPAIGN ===');
  console.log(
    `${result.requested} requested · ${result.audited} audited · ` +
      `${result.conclusive} conclusive · ${result.contactable} with a draft`
  );

  if (result.rejected.length) {
    console.log(`\n${result.rejected.length} rejected before auditing:`);
    for (const r of result.rejected.slice(0, 10)) console.log(`  ${r.input} — ${r.reason}`);
  }

  console.log('\nRanked queue:');
  for (const item of result.ranked) {
    const mark = item.hasConflict ? 'CONFLICT' : item.findingCount ? 'variance' : 'clean';
    console.log(
      `  ${mark.padEnd(9)} ${slug(item.url).padEnd(34)} ` +
        `${item.findingCount} finding(s)${item.draft ? '' : '   (nothing to say)'}`
    );
  }

  if (result.inconclusive.length) {
    console.log('\nCould not be audited:');
    for (const x of result.inconclusive) console.log(`  ${x.url} — ${x.note}`);
  }

  console.log(`\nreports → ${reportsDir}`);
  console.log(`drafts  → ${draftsDir}   (read them before sending anything)`);
  process.exit(0);
}

// Single-target audit.
for (const raw of targets) {
  const url = raw.startsWith('http') ? raw : `https://${raw}`;
  process.stderr.write(`auditing ${url}\n`);

  const audit = await auditAgent(url, { runs, replyWaitMs, betweenRunsMs });
  const file = path.join(outDir, `${slug(url)}.html`);
  fs.writeFileSync(file, renderAgentReport(audit));
  fs.writeFileSync(path.join(outDir, `${slug(url)}.json`), JSON.stringify(audit, null, 2));

  if (audit.inconclusive) {
    console.log(`  inconclusive: ${audit.inconclusive}`);
  } else {
    console.log(`  ${audit.findings.length} finding(s), sessions opened ${audit.sessionsOpened}`);
    for (const f of audit.findings) {
      console.log(`    [${f.severity}] ${f.title}`);
      if (f.agentSaid) console.log(`        agent: ${f.agentSaid}   policy: ${f.policySays}`);
    }
  }
  console.log(`  wrote ${file}`);
}
