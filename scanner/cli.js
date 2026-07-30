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
import { scanSite } from './src/scan.js';
import { renderReport } from './src/report.js';

const argv = process.argv.slice(2);
const mode = argv[0] === 'ai50' ? 'ai50' : 'consent';
const rest = argv[0] === 'consent' || argv[0] === 'ai50' ? argv.slice(1) : argv;

const flag = (n, d) => {
  const hit = rest.find((a) => a.startsWith(`--${n}=`));
  return hit ? hit.split('=').slice(1).join('=') : d;
};
const targets = rest.filter((a) => !a.startsWith('--'));
const outDir = flag('out', 'results');
const concurrency = Math.max(1, Number(flag('concurrency', 2)));

if (!targets.length) {
  console.error('usage: node cli.js [consent|ai50] <url...> [--out=dir] [--concurrency=2]');
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
