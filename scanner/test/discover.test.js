/**
 * Regression tests for target discovery.
 *
 * Two classes of failure are being guarded against, and neither is visible at runtime:
 *
 *   - Identity errors. A hostname mapped to the wrong company either scans one buyer three
 *     times or silently deletes a vertical (every Shopify storefront folding into one row).
 *     Both look like a working pipeline producing a shorter list.
 *   - Politeness errors. The scan plan is the only thing standing between an overnight run
 *     and traffic that reads as abuse, so the spacing and the daily cap are asserted
 *     directly rather than trusted.
 *
 * Run: npm test
 */

import { test } from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';

import {
  normalizeTarget,
  normalizeTargets,
  registrableDomainOf,
  parseTargetList,
  loadTargetFile,
  dedupe,
  prioritize,
  toRevenueBand,
  DEFAULT_PRIORITY_WEIGHTS,
  buildScanPlan,
  DEFAULT_SCAN_PLAN_SETTINGS,
  parseRobots,
  isPathAllowed,
  robotsUrlFor,
  checkRobots,
  annotateWithRobots,
  partitionByRobots,
} from '../src/discover.js';

/* ---------------------------------------------------------------- *
 * Normalization
 * ---------------------------------------------------------------- */

test('a messy URL normalizes to a canonical scannable https URL', () => {
  const t = normalizeTarget('  HTTPS://WWW.Example.COM/Pricing/?utm_source=list  ');
  assert.equal(t.ok, true);
  assert.equal(t.url, 'https://www.example.com/Pricing');
  assert.equal(t.hostname, 'www.example.com');
  assert.equal(t.key, 'example.com');
});

test('a bare hostname becomes an https URL with a root path', () => {
  const t = normalizeTarget('example.com');
  assert.equal(t.url, 'https://example.com/');
  assert.equal(t.key, 'example.com');
});

test('http targets are upgraded to https', () => {
  assert.equal(normalizeTarget('http://example.com/').url, 'https://example.com/');
});

test('a multi-part public suffix resolves to the right company', () => {
  const t = normalizeTarget('shop.Example.CO.UK/');
  assert.equal(t.hostname, 'shop.example.co.uk');
  assert.equal(t.publicSuffix, 'co.uk');
  assert.equal(t.key, 'example.co.uk', 'co.uk must not be read as the registrable domain');
  assert.equal(t.url, 'https://shop.example.co.uk/');
});

test('list punctuation, wrapping and trailing dots survive normalization', () => {
  assert.equal(normalizeTarget('<https://example.co.uk/>,').key, 'example.co.uk');
  assert.equal(normalizeTarget('"www.example.com."').hostname, 'www.example.com');
});

test('an email address is read as the company behind it', () => {
  assert.equal(normalizeTarget('privacy@example.co.uk').key, 'example.co.uk');
  assert.equal(normalizeTarget('mailto:privacy@example.com').key, 'example.com');
});

test('hosted storefronts stay separate companies', () => {
  // Without myshopify.com in the suffix table every brand on Shopify collapses into one
  // target, which would quietly delete most of the first vertical the plan sells into.
  const a = normalizeTarget('brand-one.myshopify.com');
  const b = normalizeTarget('brand-two.myshopify.com');
  assert.equal(a.key, 'brand-one.myshopify.com');
  assert.notEqual(a.key, b.key);
});

test('an unknown multi-part suffix can be supplied by the caller', () => {
  const t = normalizeTarget('store.brand.example-platform.net', {
    extraPublicSuffixes: ['example-platform.net'],
  });
  assert.equal(t.key, 'brand.example-platform.net');
});

test('www is preserved by default and removable on request', () => {
  assert.equal(normalizeTarget('www.example.com').hostname, 'www.example.com');
  assert.equal(normalizeTarget('www.example.com', { stripWww: true }).hostname, 'example.com');
  assert.equal(
    normalizeTarget('www.example.com', { stripWww: true }).key,
    normalizeTarget('www.example.com').key,
    'stripping www must not change the company key'
  );
});

test('input that identifies no company is rejected with a reason', () => {
  for (const bad of ['', '   ', 'Acme Inc', 'co.uk', 'localhost', '127.0.0.1', 'ftp://example.com']) {
    const t = normalizeTarget(bad);
    assert.equal(t.ok, false, `expected ${JSON.stringify(bad)} to be rejected`);
    assert.ok(t.reason, 'a rejected row must say why so the list can be fixed');
  }
});

test('a bad row does not discard the rest of the list', () => {
  const { targets, rejected } = normalizeTargets(['example.com', 'Acme Inc', 'example.co.uk']);
  assert.equal(targets.length, 2);
  assert.equal(rejected.length, 1);
});

test('registrableDomainOf handles single and multi-part suffixes', () => {
  assert.equal(registrableDomainOf('a.b.example.com').registrableDomain, 'example.com');
  assert.equal(registrableDomainOf('a.b.example.co.uk').registrableDomain, 'example.co.uk');
  assert.equal(registrableDomainOf('co.uk').registrableDomain, null);
  assert.equal(registrableDomainOf('example.unknowntld').registrableDomain, 'example.unknowntld');
});

/* ---------------------------------------------------------------- *
 * Plain-file ingestion
 * ---------------------------------------------------------------- */

test('a newline list of domains parses', () => {
  const { targets } = parseTargetList('# prospects\nexample.com\n\nexample.co.uk\n');
  assert.deepEqual(targets.map((t) => t.key), ['example.com', 'example.co.uk']);
});

test('a CSV with a header maps columns onto signals', () => {
  const csv = [
    'domain,company,sector,revenue,consumer,cmp,risk',
    'shop.example.com,"Example, Inc",retail,$60M,yes,OneTrust,55',
    'b2b.example.co.uk,Example UK,saas,4m,no,,',
  ].join('\n');

  const { targets } = parseTargetList(csv);
  assert.equal(targets.length, 2);
  assert.equal(targets[0].key, 'example.com');
  assert.equal(targets[0].signals.company, 'Example, Inc');
  assert.equal(targets[0].signals.cmp, 'OneTrust');

  const ranked = prioritize(targets);
  assert.equal(ranked[0].key, 'example.com');
  assert.equal(ranked[0].priority.signals.revenueBand, 'mid');
  assert.equal(ranked[0].priority.signals.sector, 'retail');
  assert.equal(ranked[0].priority.signals.consumerFacing, true);
  assert.equal(ranked[0].priority.signals.consentPlatformDetected, true);
  assert.equal(ranked[0].priority.signals.priorRiskScore, 55);
});

test('a headerless single-column file still parses', () => {
  const { targets } = parseTargetList('example.com\nexample.org');
  assert.deepEqual(targets.map((t) => t.key), ['example.com', 'example.org']);
});

test('a target file loads from disk', async () => {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'discover-'));
  const file = path.join(dir, 'targets.csv');
  await fs.writeFile(file, 'domain,sector\nexample.com,retail\n');
  try {
    const { targets } = await loadTargetFile(file);
    assert.equal(targets.length, 1);
    assert.equal(targets[0].signals.sector, 'retail');
  } finally {
    await fs.rm(dir, { recursive: true, force: true });
  }
});

test('revenue shorthand maps onto bands', () => {
  assert.equal(toRevenueBand('$60M'), 'mid');
  assert.equal(toRevenueBand('1.2bn'), 'large');
  assert.equal(toRevenueBand(3_000_000), 'micro');
  assert.equal(toRevenueBand('midmarket'), 'mid');
  assert.equal(toRevenueBand('who knows'), null);
});

/* ---------------------------------------------------------------- *
 * Deduplication
 * ---------------------------------------------------------------- */

test('one company appearing as several hostnames collapses to one target', () => {
  const collapsed = dedupe([
    'https://shop.example.com/collections/all',
    'www.example.com',
    'example.com/careers',
    'example.co.uk',
  ]);

  assert.equal(collapsed.length, 2);
  assert.deepEqual(collapsed.map((t) => t.key), ['example.com', 'example.co.uk']);

  const [first] = collapsed;
  assert.equal(first.url, 'https://shop.example.com/collections/all', 'first seen wins');
  assert.deepEqual(first.aliases, ['www.example.com', 'example.com']);
  assert.equal(first.mergedCount, 3);
});

test('deduplication fills gaps from the rows it folded in', () => {
  const [merged] = dedupe([
    { domain: 'shop.example.com', sector: 'retail' },
    { domain: 'www.example.com', sector: 'software', revenue: '$60M' },
  ]);
  assert.equal(merged.signals.sector, 'retail', 'the surviving row keeps its own values');
  assert.equal(merged.signals.revenue, '$60M', 'and gains what it was missing');
});

/* ---------------------------------------------------------------- *
 * Prioritisation
 * ---------------------------------------------------------------- */

const RANKING_FIXTURE = [
  { domain: 'www.b2b-example.net', revenue: '$2M', sector: 'saas', consumer: 'no', cmp: 'no' },
  { domain: 'unenriched-example.org' },
  {
    domain: 'shop.retail-example.com',
    revenue: '$80M',
    sector: 'retail',
    consumer: 'yes',
    cmp: 'OneTrust',
    risk: 70,
  },
];

test('ranking puts the highest-value conversation first', () => {
  const ranked = prioritize(RANKING_FIXTURE);
  assert.deepEqual(
    ranked.map((t) => t.key),
    ['retail-example.com', 'unenriched-example.org', 'b2b-example.net']
  );
});

test('an unenriched target outranks one measured and found unpromising', () => {
  // Absence of data about a company is information about our enrichment, not about the
  // company. Ranking unknowns last would bury every row of a freshly imported list.
  const ranked = prioritize(RANKING_FIXTURE);
  const unknown = ranked.find((t) => t.key === 'unenriched-example.org');
  const known = ranked.find((t) => t.key === 'b2b-example.net');
  assert.ok(unknown.priority.score > known.priority.score);
  assert.ok(unknown.priority.confidence < known.priority.confidence);
});

test('signals passed at call time override what the file said', () => {
  const ranked = prioritize(RANKING_FIXTURE, {
    signals: {
      'unenriched-example.org': {
        revenue: '$120M',
        sector: 'digital-health',
        consumer: true,
        cmp: 'Didomi',
        risk: 90,
      },
    },
  });
  assert.equal(ranked[0].key, 'unenriched-example.org');
  assert.equal(ranked[0].priority.signals.sector, 'digital-health');
  assert.equal(ranked[0].priority.confidence, 1);
});

test('weights are configurable rather than baked into the scoring', () => {
  const flipped = prioritize(RANKING_FIXTURE, {
    weights: { sector: { software: 100 }, consumerFacing: { no: 100 } },
  });
  assert.equal(flipped[0].key, 'b2b-example.net');
  assert.equal(DEFAULT_PRIORITY_WEIGHTS.sector.software, 8, 'defaults must not be mutated');
});

test('every ranked target explains its own score', () => {
  const [top] = prioritize(RANKING_FIXTURE);
  assert.ok(top.priority.reasons.length >= 5);
  assert.ok(top.priority.reasons.some((r) => r.includes('revenue band mid')));
  assert.ok(top.priority.reasons.some((r) => r.includes('prior scan recorded risk score 70')));
  assert.ok(top.priority.score > 0 && top.priority.score <= 100);
  assert.equal(top.priority.confidence, 1);
});

test('ranking language never characterises a company as being in breach', () => {
  // The prospect queue is internal, but the same strings end up pasted into notes and
  // forwarded. Reading as an accusation before a scan has even run is the demand-letter-mill
  // posture the business plan names as its highest risk.
  const forbidden = [
    /violat/i, /illegal/i, /unlawful/i, /non-?compliant/i, /breach/i, /liab/i,
    /lawsuit/i, /penalt/i, /\bfines?\b/i, /at risk\b/i, /ai[- ]powered/i,
  ];
  for (const target of prioritize(RANKING_FIXTURE)) {
    for (const reason of target.priority.reasons) {
      for (const pattern of forbidden) {
        assert.ok(!pattern.test(reason), `ranking reason "${reason}" matched ${pattern}`);
      }
    }
  }
});

test('ranking is deterministic for equally scored targets', () => {
  const first = prioritize(['b.example.com', 'a.example.com']).map((t) => t.key);
  const second = prioritize(['a.example.com', 'b.example.com']).map((t) => t.key);
  assert.deepEqual(first, second);
});

/* ---------------------------------------------------------------- *
 * Scan plan
 * ---------------------------------------------------------------- */

const PLAN_START = '2026-08-03T09:00:00.000Z';

test('the shipped defaults are conservative', () => {
  assert.ok(DEFAULT_SCAN_PLAN_SETTINGS.maxConcurrent <= 2);
  assert.ok(DEFAULT_SCAN_PLAN_SETTINGS.perHostDelayMs >= 60_000);
  assert.ok(DEFAULT_SCAN_PLAN_SETTINGS.dailyCap <= 200);
});

test('the same registrable domain is never scanned twice in quick succession', () => {
  const plan = buildScanPlan(
    ['shop.example.com', 'www.example.com', 'other.example.org', 'third.example.net'],
    {
      maxConcurrent: 2,
      perHostDelayMs: 60_000,
      estimatedScanDurationMs: 30_000,
      dailyCap: 100,
      startDate: PLAN_START,
    }
  );

  const sameCompany = plan.items.filter((i) => i.key === 'example.com');
  assert.equal(sameCompany.length, 2);
  const [firstScan, secondScan] = sameCompany.sort((a, b) => a.startOffsetMs - b.startOffsetMs);
  assert.ok(
    secondScan.startOffsetMs >= firstScan.endOffsetMs + 60_000,
    `second scan of example.com started ${secondScan.startOffsetMs - firstScan.endOffsetMs}ms after the first finished`
  );
});

test('a robots crawl-delay widens the gap but never narrows it', () => {
  const targets = [
    { url: 'https://shop.example.com/', robots: { crawlDelayMs: 300_000, allowed: true, certain: true } },
    { url: 'https://www.example.com/' },
  ];
  const plan = buildScanPlan(targets, {
    maxConcurrent: 1,
    perHostDelayMs: 60_000,
    estimatedScanDurationMs: 10_000,
    startDate: PLAN_START,
  });
  const [first, second] = plan.items;
  assert.ok(second.startOffsetMs >= first.endOffsetMs + 300_000);
});

test('a worker takes the next unblocked target rather than shortening a delay', () => {
  const plan = buildScanPlan(['a.example.com', 'b.example.com', 'other.example.org'], {
    maxConcurrent: 1,
    perHostDelayMs: 60_000,
    estimatedScanDurationMs: 10_000,
    startDate: PLAN_START,
  });
  assert.deepEqual(
    plan.items.map((i) => i.hostname),
    ['a.example.com', 'other.example.org', 'b.example.com']
  );
  assert.equal(plan.items[1].startOffsetMs, 10_000, 'the unblocked target starts immediately');
});

test('the daily cap is respected and days roll over', () => {
  const targets = ['a.example.com', 'b.example.net', 'c.example.org', 'd.example.io', 'e.example.co'];
  const plan = buildScanPlan(targets, { dailyCap: 2, startDate: PLAN_START });

  assert.equal(plan.totalTargets, 5);
  assert.equal(plan.totalDays, 3);
  assert.deepEqual(plan.days.map((d) => d.items.length), [2, 2, 1]);
  assert.deepEqual(plan.items.map((i) => i.order), [1, 2, 3, 4, 5]);
  assert.deepEqual(plan.days.map((d) => d.day), [1, 2, 3]);

  assert.equal(plan.days[0].startAt, PLAN_START);
  assert.equal(plan.days[1].startAt, '2026-08-04T09:00:00.000Z');
  assert.equal(plan.days[0].items[0].plannedStartAt, PLAN_START);
});

test('an empty target list produces an empty plan rather than throwing', () => {
  const plan = buildScanPlan([], { startDate: PLAN_START });
  assert.equal(plan.totalTargets, 0);
  assert.equal(plan.totalDays, 0);
  assert.deepEqual(plan.items, []);
  assert.equal(plan.finishesBy, null);
});

test('the plan preserves the ranking it was handed', () => {
  const plan = buildScanPlan(prioritize(RANKING_FIXTURE), { dailyCap: 10, startDate: PLAN_START });
  assert.equal(plan.items[0].key, 'retail-example.com');
  assert.ok(plan.items[0].priority.score > 0, 'the ranking must survive plan construction');
});

/* ---------------------------------------------------------------- *
 * robots.txt
 * ---------------------------------------------------------------- */

const ROBOTS_SAMPLE = `
# Example robots file
User-agent: *
Disallow: /checkout
Disallow: /account/
Allow: /account/login
Disallow:
Crawl-delay: 5

User-agent: BadBot
Disallow: /

User-agent: ExampleScanner
User-agent: OtherScanner
Disallow: /private
Allow: /private/public-notice$

Sitemap: https://example.com/sitemap.xml
`;

test('robots.txt parses into user-agent groups', () => {
  const parsed = parseRobots(ROBOTS_SAMPLE);
  assert.equal(parsed.groups.length, 3);
  assert.deepEqual(parsed.groups[0].agents, ['*']);
  assert.equal(parsed.groups[0].crawlDelaySeconds, 5);
  assert.deepEqual(parsed.groups[2].agents, ['examplescanner', 'otherscanner']);
  assert.deepEqual(parsed.sitemaps, ['https://example.com/sitemap.xml']);
});

test('an empty Disallow line carries no rule', () => {
  const parsed = parseRobots(ROBOTS_SAMPLE);
  assert.equal(parsed.groups[0].rules.length, 3);
  assert.ok(parsed.groups[0].rules.every((r) => r.pattern !== ''));
});

test('the wildcard group applies to an unnamed agent', () => {
  const parsed = parseRobots(ROBOTS_SAMPLE);
  assert.equal(isPathAllowed(parsed, '/checkout').allowed, false);
  assert.equal(isPathAllowed(parsed, '/').allowed, true);
  assert.equal(isPathAllowed(parsed, '/products/shoes').allowed, true);
  assert.equal(isPathAllowed(parsed, '/').crawlDelayMs, 5000);
});

test('the longest matching rule wins and allow beats disallow', () => {
  const parsed = parseRobots(ROBOTS_SAMPLE);
  assert.equal(isPathAllowed(parsed, '/account/settings').allowed, false);
  const login = isPathAllowed(parsed, '/account/login');
  assert.equal(login.allowed, true);
  assert.equal(login.rule, 'Allow: /account/login');
});

test('a named agent gets its own group', () => {
  const parsed = parseRobots(ROBOTS_SAMPLE);
  assert.equal(isPathAllowed(parsed, '/anything', 'BadBot').allowed, false);
  assert.equal(isPathAllowed(parsed, '/private/records', 'ExampleScanner').allowed, false);
  assert.equal(
    isPathAllowed(parsed, '/private/public-notice', 'ExampleScanner').allowed,
    true,
    '$ anchors the pattern to the end of the path'
  );
  assert.equal(
    isPathAllowed(parsed, '/private/public-notice/extra', 'ExampleScanner').allowed,
    false
  );
  // Only the most specific matching group applies. Merging the wildcard group into a named
  // one would apply rules the site never wrote for that agent.
  assert.equal(
    isPathAllowed(parsed, '/checkout', 'ExampleScanner').allowed,
    true,
    'groups do not merge'
  );
});

test('wildcards inside a pattern match', () => {
  const parsed = parseRobots('User-agent: *\nDisallow: /*.json\n');
  assert.equal(isPathAllowed(parsed, '/data/export.json').allowed, false);
  assert.equal(isPathAllowed(parsed, '/data/export.csv').allowed, true);
});

test('a robots file with no applicable group allows everything', () => {
  const parsed = parseRobots('User-agent: BadBot\nDisallow: /\n');
  const decision = isPathAllowed(parsed, '/checkout');
  assert.equal(decision.allowed, true);
  assert.equal(decision.matchedAgent, null);
});

test('rules before any user-agent line are treated as applying to everyone', () => {
  const parsed = parseRobots('Disallow: /secret\n');
  assert.equal(isPathAllowed(parsed, '/secret').allowed, false);
});

test('robots lives at the origin root', () => {
  assert.equal(robotsUrlFor('https://shop.example.com/deep/page?x=1'), 'https://shop.example.com/robots.txt');
});

test('checkRobots reads a published file and decides on the URL path', async () => {
  const server = await startServer((req, res) => {
    if (req.url === '/robots.txt') {
      res.writeHead(200, { 'content-type': 'text/plain' });
      res.end(ROBOTS_SAMPLE);
      return;
    }
    res.writeHead(404);
    res.end();
  });

  try {
    const blocked = await checkRobots(`${server.origin}/checkout`, { timeoutMs: 2000 });
    assert.equal(blocked.allowed, false);
    assert.equal(blocked.certain, true);
    assert.equal(blocked.crawlDelayMs, 5000);
    assert.deepEqual(blocked.sitemaps, ['https://example.com/sitemap.xml']);

    const allowed = await checkRobots(`${server.origin}/`, { timeoutMs: 2000 });
    assert.equal(allowed.allowed, true);
    assert.equal(allowed.certain, true);
  } finally {
    server.close();
  }
});

test('a missing robots.txt means unrestricted, and a server error means undetermined', async () => {
  const missing = await startServer((req, res) => {
    res.writeHead(404);
    res.end();
  });
  const broken = await startServer((req, res) => {
    res.writeHead(503);
    res.end();
  });

  try {
    const noFile = await checkRobots(`${missing.origin}/`, { timeoutMs: 2000 });
    assert.equal(noFile.allowed, true);
    assert.equal(noFile.certain, true);

    // Cautious by default: a 5xx is not evidence of permission, so the target is skipped —
    // but `certain: false` keeps it retryable instead of writing the prospect off.
    const failed = await checkRobots(`${broken.origin}/`, { timeoutMs: 2000 });
    assert.equal(failed.allowed, false);
    assert.equal(failed.certain, false);
    assert.match(failed.reason, /503/);
  } finally {
    missing.close();
    broken.close();
  }
});

test('an unreachable host resolves cautiously rather than throwing', async () => {
  // Port 1 on loopback refuses connections immediately, so this exercises the network-error
  // path without depending on outbound egress.
  const result = await checkRobots('http://127.0.0.1:1/', { timeoutMs: 1500 });
  assert.equal(result.fetched, false);
  assert.equal(result.allowed, false);
  assert.equal(result.certain, false);
});

test('annotating a list carries the robots decision into the scan plan', async () => {
  const server = await startServer((req, res) => {
    if (req.url !== '/robots.txt') {
      res.writeHead(404);
      res.end();
      return;
    }
    res.writeHead(200, { 'content-type': 'text/plain' });
    res.end('User-agent: *\nDisallow: /admin\nCrawl-delay: 120\n');
  });

  try {
    // Shaped like the output of dedupe/prioritize, which is how this is called in practice.
    // A bare loopback URL would be rejected by normalization, since an IP identifies no
    // company.
    const target = {
      ok: true,
      key: 'example.com',
      hostname: 'example.com',
      url: `${server.origin}/`,
      signals: {},
    };

    const annotated = await annotateWithRobots([target], { timeoutMs: 2000 });
    assert.equal(annotated.length, 1);
    assert.equal(annotated[0].robots.allowed, true);
    assert.equal(annotated[0].robots.crawlDelayMs, 120_000);

    const { allowed } = partitionByRobots(annotated);
    assert.equal(allowed.length, 1);
  } finally {
    server.close();
  }
});

test('robots decisions partition into allowed, blocked and undetermined', () => {
  const { allowed, blocked, undetermined } = partitionByRobots([
    { key: 'a.com', robots: { allowed: true, certain: true } },
    { key: 'b.com', robots: { allowed: false, certain: true } },
    { key: 'c.com', robots: { allowed: false, certain: false } },
    { key: 'd.com' },
  ]);
  assert.deepEqual(allowed.map((t) => t.key), ['a.com']);
  assert.deepEqual(blocked.map((t) => t.key), ['b.com']);
  assert.deepEqual(undetermined.map((t) => t.key), ['c.com', 'd.com']);
});

/** Loopback-only helper; port 0 lets the OS pick, so a killed run leaves nothing stale. */
async function startServer(handler) {
  const server = http.createServer(handler);
  await new Promise((resolve, reject) => {
    server.once('error', reject);
    server.listen(0, '127.0.0.1', resolve);
  });
  return {
    origin: `http://127.0.0.1:${server.address().port}`,
    close: () => server.close(),
  };
}
