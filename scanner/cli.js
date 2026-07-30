#!/usr/bin/env node
/**
 * Evidence engine CLI.
 *
 *   node cli.js consent <url...>   three-pass tracking and consent capture (the revenue module)
 *   node cli.js ai50 <url...>      EU AI Act Article 50 chatbot disclosure check
 *
 * Both write JSON to the output directory; `consent` also writes a client-ready HTML
 * report per target and a summary index.
 */

import fs from 'node:fs';
import path from 'node:path';
import { scanConsent } from './src/consent.js';
import { monitorAll, triage } from './src/monitor.js';
import { runCampaign } from './src/campaign.js';
import { scanSite } from './src/scan.js';
import { renderReport } from './src/report.js';

const argv = process.argv.slice(2);
const MODES = new Set(['consent', 'ai50', 'monitor', 'campaign']);
const mode = MODES.has(argv[0]) ? argv[0] : 'consent';
const rest = MODES.has(argv[0]) ? argv.slice(1) : argv;

const flag = (n, d) => {
  const hit = rest.find((a) => a.startsWith(`--${n}=`));
  return hit ? hit.split('=').slice(1).join('=') : d;
};
const targets = rest.filter((a) => !a.startsWith('--'));
const outDir = flag('out', 'results');
const concurrency = Math.max(1, Number(flag('concurrency', 2)));

if (!targets.length) {
  console.error(
    'usage: node cli.js [consent|ai50|monitor|campaign] <target...> ' +
      '[--out=dir] [--concurrency=2] [--data=dir] [--sector=name] [--sender=name]'
  );
  process.exit(1);
}

fs.mkdirSync(outDir, { recursive: true });

const slug = (u) =>
  u.replace(/^https?:\/\//, '').replace(/[^a-z0-9]+/gi, '_').replace(/_+$/, '').slice(0, 60);

async function pool(items, n, fn) {
  const out = [];
  let i = 0;
  await Promise.all(
    Array.from({ length: Math.min(n, items.length) }, async () => {
      while (i < items.length) {
        const idx = i++;
        try {
          out[idx] = await fn(items[idx]);
        } catch (err) {
          out[idx] = { url: items[idx], error: String(err.message || err) };
        }
      }
    })
  );
  return out;
}

if (mode === 'campaign') {
  const sector = flag('sector', 'unspecified sector');
  const senderName = flag('sender', null);

  const result = await runCampaign(targets, {
    concurrency,
    sector,
    senderName,
    onScan: (scan, err) =>
      process.stderr.write(
        err ? `  failed  ${err.url}  ${err.error}\n` : `  scanned ${scan.url}  risk ${scan.riskScore}\n`
      ),
  });

  const draftsDir = path.join(outDir, 'drafts');
  const reportsDir = path.join(outDir, 'reports');
  fs.mkdirSync(draftsDir, { recursive: true });
  fs.mkdirSync(reportsDir, { recursive: true });

  for (const item of result.ranked) {
    fs.writeFileSync(path.join(reportsDir, `${slug(item.url)}.html`), item.report);
    if (item.draft) {
      fs.writeFileSync(
        path.join(draftsDir, `${slug(item.url)}.txt`),
        `Subject: ${item.draft.subject}\n\n${item.draft.body}\n`
      );
    }
  }
  if (result.indexHtml) fs.writeFileSync(path.join(outDir, 'sector-index.html'), result.indexHtml);

  console.log('\n=== CAMPAIGN ===');
  console.log(
    `${result.requested} requested · ${result.scanned} scanned · ` +
      `${result.usable} usable · ${result.contactable} with a draft`
  );
  if (result.rejected?.length) {
    console.log(`\n${result.rejected.length} target(s) rejected before scanning:`);
    for (const r of result.rejected.slice(0, 10)) console.log(`  ${r.input} — ${r.reason}`);
  }
  console.log(`${result.needsReview} of those need a manual check before sending.`);
  console.log('\nRanked queue (most sendable first):');
  for (const item of result.ranked) {
    const flag = !item.draft
      ? '(nothing to say)'
      : item.confidence.review === 'routine'
        ? ''
        : `<< ${item.confidence.guidance}`;
    console.log(
      `  ${String(item.riskScore).padStart(3)}  ${slug(item.url).padEnd(32)} ` +
        `${(item.findingIds.join(',') || 'clean').padEnd(32)} ${flag}`
    );
  }
  console.log(`\nreports → ${reportsDir}`);
  console.log(`drafts  → ${draftsDir}   (read them before sending anything)`);
  process.exit(0);
}

if (mode === 'monitor') {
  const dataRoot = flag('data', 'data');
  const urls = targets.map((t) => (t.startsWith('http') ? t : `https://${t}`));

  const results = await monitorAll(urls, {
    dataRoot,
    concurrency,
    onResult: (r) =>
      process.stderr.write(
        `  ${r.skipped ? 'skipped' : (r.diff?.status ?? 'done')}  ${r.url}` +
          (r.skipped ? `  (${r.reason})` : '') +
          '\n'
      ),
  });

  const t = triage(results);
  fs.writeFileSync(path.join(outDir, 'monitor.json'), JSON.stringify(results, null, 2));

  console.log('\n=== MONITOR ===');
  if (t.regressions.length) {
    console.log('\nREGRESSIONS (act on these):');
    for (const r of t.regressions) {
      console.log(`  +${r.riskDelta}  ${r.url}`);
      console.log(`      ${r.alert?.subject ?? ''}`);
    }
  }
  if (t.improvements.length) {
    console.log('\nImprovements:');
    for (const r of t.improvements) console.log(`  ${r.riskDelta}  ${r.url}`);
  }
  if (t.problems.length) {
    console.log('\nCould not be compared:');
    for (const r of t.problems) console.log(`  ${r.url} — ${r.reason}`);
  }
  console.log(`\n${t.quiet} target(s) unchanged.`);
  console.log(`wrote ${path.join(outDir, 'monitor.json')}`);
  process.exit(0);
}

const results = await pool(targets, concurrency, async (raw) => {
  const url = raw.startsWith('http') ? raw : `https://${raw}`;
  process.stderr.write(`scanning ${url}\n`);

  if (mode === 'ai50') {
    const r = await scanSite(url);
    process.stderr.write(
      `  → ${r.assessment?.verdict ?? 'ERROR'}  vendors=${r.vendors.map((v) => v.name).join(',') || 'none'}\n`
    );
    return r;
  }

  const r = await scanConsent(url);
  const file = path.join(outDir, `${slug(url)}.html`);
  fs.writeFileSync(file, renderReport(r));
  process.stderr.write(`  → risk ${r.riskScore}  ${r.findings.length} finding(s)  → ${file}\n`);
  return r;
});

fs.writeFileSync(path.join(outDir, `${mode}.json`), JSON.stringify(results, null, 2));

console.log(`\n=== ${mode.toUpperCase()} SUMMARY ===`);
if (mode === 'consent') {
  const ranked = results
    .filter((r) => typeof r.riskScore === 'number')
    .sort((a, b) => b.riskScore - a.riskScore);
  for (const r of ranked) {
    const ids = r.findings.map((f) => f.id).join(', ') || 'clean';
    console.log(`  ${String(r.riskScore).padStart(3)}  ${slug(r.url).padEnd(34)} ${ids}`);
  }
  const exposed = ranked.filter((r) => r.riskScore > 0).length;
  console.log(`\n  ${exposed}/${ranked.length} targets showed at least one finding`);
} else {
  for (const r of results) {
    console.log(`  ${(r.assessment?.verdict ?? 'ERROR').padEnd(14)} ${slug(r.url)}`);
  }
}
console.log(`\nwrote ${path.join(outDir, `${mode}.json`)}`);
