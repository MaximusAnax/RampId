/**
 * Tests for the aggregate index.
 *
 * The anonymity assertions are the ones that matter. Everything else here is arithmetic that
 * a careful reader could check by hand; a company name reaching the published page is a
 * breach of the one promise the artifact makes, and it would be discovered by the company
 * itself rather than by us. So the guard is tested from both directions: that it catches a
 * name a caller pastes into a label, and that it does not fire on a page that leaks nothing —
 * a guard that cries wolf gets switched off.
 *
 * Run: npm test
 */

import { test } from 'node:test';
import assert from 'node:assert/strict';

import {
  buildIndex,
  renderIndexHtml,
  collectIdentifiers,
  assertAnonymous,
  anonymizeScan,
  quantile,
  AnonymityError,
} from '../src/indexreport.js';

const tracker = (name, category, severity, sample) => ({
  name,
  category,
  severity,
  evidence: `${name} evidence line`,
  sample,
});

/** A scan shaped exactly like scanConsent's return value. */
function makeScan({
  url,
  company,
  scannedAt = '2026-07-14T12:00:00.000Z',
  cmp = [],
  bannerVisible = false,
  rejectClicked = false,
  baseline = [],
  gpc = [],
  afterReject = [],
  findings = [],
  riskScore = 0,
  capture = { ok: true, passesLoaded: 3, usable: true, note: null },
}) {
  const pass = (trackers) => ({
    observedRequestCount: 12,
    trackerCount: trackers.length,
    trackers,
    restrained: [],
    requestCount: 12,
    error: null,
  });

  return {
    url,
    company,
    scannedAt,
    durationMs: 24000,
    cmp,
    bannerVisible,
    passes: {
      baseline: pass(baseline),
      gpc: pass(gpc),
      afterReject: { ...pass(afterReject), rejectClicked, rejectMethod: rejectClicked ? 'role' : null },
    },
    findings,
    riskScore,
    capture,
    errors: [],
  };
}

const finding = (id, severity) => ({
  id,
  severity,
  title: `${id} on this specific site`,
  detail: 'Free text that must never reach the aggregate.',
  trackers: [],
});

const META = () => tracker('Meta Pixel', 'ad-pixel', 'critical', 'https://www.facebook.com/tr?id=1');
const GA = () => tracker('Google Analytics', 'analytics', 'medium', 'https://www.google-analytics.com/g/collect?v=2');
const HOTJAR = () => tracker('Hotjar', 'session-replay', 'critical', 'https://static.hotjar.com/c/hj.js');

/**
 * Five measurable sites plus two that could not be measured, with hand-checkable numbers:
 *
 *   findings         4 of 5 sites carry at least one
 *   PRE_CONSENT      3 of 5    GPC_IGNORED 2 of 5    REJECT_IGNORED 1 of 5
 *   platforms        3 of 5, of which 2 transmitted before any consent interaction
 *   reject control   3 of 5 showed a consent mechanism, 1 of those had no reject control
 *   exposure scores  0, 5, 15, 75, 90
 */
function sampleScans() {
  return [
    makeScan({
      url: 'https://shop.northwind-wellness.com/',
      company: 'Northwind Wellness, Inc.',
      scannedAt: '2026-07-10T09:00:00.000Z',
      cmp: ['OneTrust'],
      bannerVisible: true,
      rejectClicked: true,
      baseline: [META(), GA()],
      gpc: [META()],
      afterReject: [META()],
      findings: [
        finding('PRE_CONSENT', 'critical'),
        finding('GPC_IGNORED', 'critical'),
        finding('REJECT_IGNORED', 'critical'),
      ],
      riskScore: 90,
    }),
    makeScan({
      url: 'https://www.cascade-outfitters.com/',
      company: 'Cascade Outfitters',
      scannedAt: '2026-07-11T09:00:00.000Z',
      cmp: ['Cookiebot'],
      bannerVisible: true,
      rejectClicked: true,
      baseline: [GA()],
      findings: [finding('PRE_CONSENT', 'medium')],
      riskScore: 5,
    }),
    makeScan({
      url: 'https://harborlight-labs.com/shop',
      company: 'Harborlight Labs',
      scannedAt: '2026-07-12T09:00:00.000Z',
      baseline: [HOTJAR(), META()],
      gpc: [HOTJAR()],
      afterReject: [HOTJAR(), META()],
      findings: [
        finding('PRE_CONSENT', 'critical'),
        finding('GPC_IGNORED', 'critical'),
        finding('NO_CMP', 'high'),
      ],
      riskScore: 75,
    }),
    makeScan({
      url: 'https://quietbrook.com/',
      company: 'Quietbrook',
      scannedAt: '2026-07-13T09:00:00.000Z',
      cmp: ['Osano'],
      bannerVisible: true,
      findings: [finding('NO_REJECT_CONTROL', 'high')],
      riskScore: 15,
    }),
    makeScan({
      url: 'https://stillwater-clinic.com/',
      company: 'Stillwater Clinic',
      scannedAt: '2026-07-14T09:00:00.000Z',
      riskScore: 0,
    }),
    makeScan({
      url: 'https://greypine-supply.com/',
      company: 'Greypine Supply',
      capture: { ok: false, passesLoaded: 0, usable: false, note: 'page could not be loaded' },
    }),
    // The shape cli.js records when a scan throws outright.
    { url: 'https://vesper-goods.com/', company: 'Vesper Goods', error: 'net::ERR_NAME_NOT_RESOLVED' },
  ];
}

const index = () => buildIndex(sampleScans(), { sector: 'US direct-to-consumer retail', period: 'July 2026' });

test('failed captures are excluded from the denominator rather than counted as clean', () => {
  const i = index();
  assert.equal(i.sample.submitted, 7);
  assert.equal(i.sample.measured, 5);
  assert.equal(i.sample.excluded, 2);
  assert.equal(
    i.sample.exclusions.reduce((sum, row) => sum + row.count, 0),
    2,
    'every excluded site must be accounted for by a stated reason'
  );
  assert.equal(i.sample.observedFrom, '2026-07-10T09:00:00.000Z');
  assert.equal(i.sample.observedTo, '2026-07-14T09:00:00.000Z');
});

test('a partially captured site is excluded rather than counted as transmitting nothing', () => {
  // capture.usable only asks whether any conclusion at all can be drawn, which is the right
  // question for one client report and the wrong one here. A site whose baseline pass timed
  // out contributes an empty baseline to a share headed "transmitted before any consent
  // interaction", so it would be counted as a site that transmitted nothing — the aggregate
  // failing quietly in the reassuring direction.
  const partial = makeScan({
    url: 'https://halfloaded-example.com/',
    company: 'Halfloaded Example',
    cmp: ['OneTrust'],
    bannerVisible: true,
    rejectClicked: true,
    capture: { ok: false, passesLoaded: 2, usable: true, note: 'Only 2 of 3 passes loaded successfully.' },
  });
  partial.passes.baseline.error = 'net::ERR_TIMED_OUT';

  const clean = makeScan({
    url: 'https://fullyloaded-example.com/',
    company: 'Fullyloaded Example',
    cmp: ['OneTrust'],
    bannerVisible: true,
    rejectClicked: true,
    baseline: [META()],
    findings: [finding('PRE_CONSENT', 'critical')],
    riskScore: 30,
  });

  const i = buildIndex([partial, clean], { sector: 'Test' });
  assert.equal(i.sample.measured, 1);
  assert.equal(i.sample.excluded, 1);
  assert.deepEqual(i.sample.exclusions, [{ reason: 'only some of the three passes loaded', count: 1 }]);
  assert.equal(
    i.consentPlatform.transmittedPreConsentDespitePlatform.shareOfPlatformSites,
    1,
    'the one site actually measured transmitted pre-consent; a half-captured site must not halve it'
  );
});

test('a scan recorded without a capture summary is judged on its own passes', () => {
  // Stored results from an older engine carry no capture object. Excluding on the pass errors
  // directly means such a record still fails toward exclusion rather than toward a zero.
  const scan = makeScan({ url: 'https://legacy-example.com/', company: 'Legacy Example' });
  delete scan.capture;
  scan.passes.gpc.error = 'net::ERR_ABORTED';

  const i = buildIndex([scan], { sector: 'Test' });
  assert.equal(i.sample.measured, 0);
  assert.deepEqual(i.sample.exclusions, [{ reason: 'a capture pass did not complete', count: 1 }]);
});

test('share of sites with at least one observation, and share by observation type', () => {
  const i = index();
  assert.deepEqual(i.findings.anyFinding, { count: 4, denominator: 5, share: 0.8 });

  const byId = Object.fromEntries(i.findings.byId.map((row) => [row.id, row.count]));
  assert.equal(byId.PRE_CONSENT, 3);
  assert.equal(byId.GPC_IGNORED, 2);
  assert.equal(byId.REJECT_IGNORED, 1);
  assert.equal(byId.NO_CMP, 1);
  assert.equal(byId.NO_REJECT_CONTROL, 1);

  const preConsent = i.findings.byId.find((row) => row.id === 'PRE_CONSENT');
  assert.equal(preConsent.share, 0.6);
  assert.ok(
    !/this specific site/.test(preConsent.title),
    'per-scan finding titles describe one site and must not be copied into the aggregate'
  );
});

test('a finding id this module has no title for is still counted, and sorts last', () => {
  // The engine gains finding types faster than this template does. A new one must appear in
  // the aggregate rather than vanishing from it, but it must not lead the table on a tie
  // before anyone has written a title for it.
  const scans = sampleScans();
  scans[4].findings = [finding('SOMETHING_NEW', 'medium')];
  const rows = buildIndex(scans, { sector: 'Test' }).findings.byId;

  const novel = rows.find((row) => row.id === 'SOMETHING_NEW');
  assert.equal(novel.count, 1);
  assert.equal(novel.title, 'SOMETHING_NEW', 'the id stands in until a title exists');
  assert.ok(
    rows.findIndex((row) => row.id === 'SOMETHING_NEW') >
      rows.findIndex((row) => row.id === 'NO_CMP'),
    'ties break toward the canonical order'
  );
});

test('sites that deployed a consent platform and still transmitted pre-consent', () => {
  const i = index();
  assert.deepEqual(i.consentPlatform.deployed, { count: 3, denominator: 5, share: 0.6 });

  const stat = i.consentPlatform.transmittedPreConsentDespitePlatform;
  assert.equal(stat.platformSiteCount, 3);
  assert.equal(stat.count, 2);
  assert.equal(stat.share, 0.4, 'share of the whole sample');
  assert.ok(Math.abs(stat.shareOfPlatformSites - 2 / 3) < 1e-9, 'share of sites running a platform');

  const platforms = Object.fromEntries(i.consentPlatform.platforms.map((row) => [row.name, row.count]));
  assert.deepEqual(platforms, { Cookiebot: 1, OneTrust: 1, Osano: 1 });
});

test('missing reject controls are measured against sites that showed a consent mechanism', () => {
  const i = index();
  assert.deepEqual(i.rejectControl.consentMechanismPresent, { count: 3, denominator: 5, share: 0.6 });
  // Measured against the whole sample this would be 1 of 5, which silently folds in the two
  // sites that never showed a banner at all — a different observation entirely.
  assert.deepEqual(i.rejectControl.noRejectControlFound, { count: 1, denominator: 3, share: 1 / 3 });
});

test('tracker prevalence counts sites once, and ranks by prevalence then severity', () => {
  const i = index();
  const overall = i.trackers.overall;
  assert.deepEqual(
    overall.map((row) => [row.name, row.count]),
    [
      ['Meta Pixel', 2],
      ['Google Analytics', 2],
      ['Hotjar', 1],
    ],
    'ties break toward the more severe service'
  );
  assert.equal(overall[0].share, 0.4);
  assert.equal(overall[0].severity, 'critical');

  assert.deepEqual(
    i.trackers.byPass.afterReject.map((row) => [row.name, row.count]),
    [
      ['Meta Pixel', 2],
      ['Hotjar', 1],
    ]
  );
  assert.deepEqual(i.trackers.byPass.gpc.map((row) => row.name), ['Hotjar', 'Meta Pixel']);
});

test('services that signalled consent denied are not counted as pre-consent transmission', () => {
  // Google Consent Mode and Meta's Limited Data Use are designed to fire while transmitting a
  // denial. Counting them here would be the aggregate version of a false positive, which is
  // the failure mode this whole product is built to avoid.
  const scan = makeScan({ url: 'https://restrained-example.com/', company: 'Restrained Example' });
  scan.passes.baseline.restrained = [GA()];
  const i = buildIndex([scan], { sector: 'Test' });
  assert.equal(i.trackers.overall.length, 0);
  assert.equal(i.consentPlatform.transmittedPreConsentDespitePlatform.count, 0);
});

test('risk score distribution reports quartiles and buckets', () => {
  const distribution = index().riskScore;
  assert.equal(distribution.count, 5);
  assert.equal(distribution.min, 0);
  assert.equal(distribution.q1, 5);
  assert.equal(distribution.median, 15);
  assert.equal(distribution.q3, 75);
  assert.equal(distribution.max, 90);
  assert.equal(distribution.mean, 37);

  const buckets = Object.fromEntries(distribution.buckets.map((b) => [b.label, b.count]));
  assert.equal(buckets['0 — nothing observed'], 1);
  assert.equal(buckets['1–24'], 2);
  assert.equal(buckets['25–49'], 0);
  assert.equal(buckets['50–74'], 0);
  assert.equal(buckets['75–100'], 2);
  assert.equal(
    distribution.buckets.reduce((sum, b) => sum + b.count, 0),
    5,
    'buckets must partition the sample exactly once'
  );
});

test('quartiles interpolate between order statistics', () => {
  // The PERCENTILE.INC / R type 7 definition, which the published methodology names. Getting
  // this wrong moves a headline quartile by a whole bucket, and a reader recomputing from a
  // published dataset would catch it.
  assert.equal(quantile([1, 2, 3, 4], 0.25), 1.75);
  assert.equal(quantile([1, 2, 3, 4], 0.5), 2.5);
  assert.equal(quantile([1, 2, 3, 4], 0.75), 3.25);
  assert.equal(quantile([1, 2, 3, 4, 5], 0.5), 3);
  assert.equal(quantile([0, 0, 30, 90], 0.75), 45);
  assert.equal(quantile([7], 0.5), 7, 'a single observation is its own median');
  assert.equal(quantile([], 0.5), null, 'no observations yields no quartile, never zero');
  assert.equal(quantile(null, 0.5), null);
});

test('an empty sample reports nothing rather than reporting zeroes', () => {
  const i = buildIndex([], { sector: 'Nothing measured' });
  assert.equal(i.sample.submitted, 0);
  assert.equal(i.sample.measured, 0);
  assert.equal(i.findings.anyFinding.share, null, 'a share with no denominator must be null, not 0');
  assert.equal(i.riskScore.median, null);
  assert.equal(i.riskScore.count, 0);
  assert.deepEqual(i.trackers.overall, []);
  assert.equal(i.consentPlatform.transmittedPreConsentDespitePlatform.shareOfPlatformSites, null);

  const html = renderIndexHtml(i);
  assert.ok(html.startsWith('<!doctype html>'));
  assert.match(html, /No measurable sites in this sample/);
  assert.ok(!/NaN|undefined|Infinity/.test(html), 'an empty sample must not render arithmetic debris');
  assert.ok(!/\b0%/.test(html), 'zero percent of nothing is a claim about a market never measured');
});

test('the rendered page never contains a company name, hostname or URL from the input', () => {
  const scans = sampleScans();
  const html = renderIndexHtml(buildIndex(scans, { sector: 'US direct-to-consumer retail', period: 'July 2026' }));
  const identifiers = collectIdentifiers(scans);

  assert.ok(identifiers.length >= scans.length, 'every input site must contribute an identifier');
  for (const term of identifiers) {
    assert.ok(!html.toLowerCase().includes(term.toLowerCase()), `identifying term reached the page: ${term}`);
  }
  for (const term of ['Northwind', 'northwind-wellness.com', 'quietbrook', 'Harborlight']) {
    assert.ok(!html.toLowerCase().includes(term.toLowerCase()), `${term} reached the page`);
  }
});

test('rendering fails loudly when a company name would appear in the page', () => {
  const scans = sampleScans();
  // The realistic accident: a caller pastes a sample description into the sector label.
  const tainted = buildIndex(scans, { sector: 'US retail, including Northwind Wellness, Inc.' });

  assert.throws(
    () => renderIndexHtml(tainted),
    (err) => {
      assert.ok(err instanceof AnonymityError, 'must be the dedicated error, not a generic throw');
      assert.ok(
        err.terms.some((term) => /Northwind Wellness/i.test(term)),
        'the error must name the term that would have leaked'
      );
      return true;
    }
  );
});

test('rendering fails loudly when a hostname would appear in the page', () => {
  const scans = sampleScans();
  const tainted = buildIndex(scans, { sector: 'US retail', period: 'July 2026, shop.northwind-wellness.com onward' });
  assert.throws(() => renderIndexHtml(tainted), AnonymityError);
});

test('the guard sees through HTML escaping', () => {
  // "Acme & Co" reaches the page as "Acme &amp; Co". A naive substring check would pass it.
  assert.throws(
    () => assertAnonymous('<p>Measured across Acme &amp; Co and others.</p>', ['Acme & Co']),
    AnonymityError
  );
  assert.throws(
    () => assertAnonymous('<p>Measured across <em>Acme</em> Holdings.</p>', ['Acme Holdings']),
    AnonymityError,
    'markup interrupting a name must not hide it'
  );
  assert.deepEqual(assertAnonymous('<p>48% of sites measured.</p>', ['Acme & Co']), { checkedTerms: 1 });
});

test('a tracker sample URL carrying the page address never reaches the aggregate', () => {
  // Outbound pixels routinely carry the scanned page URL in a query parameter. This is the
  // subtle way an aggregate identifies a company while looking anonymous.
  const scan = makeScan({
    url: 'https://ravenglass-supply.com/',
    company: 'Ravenglass Supply',
    baseline: [tracker('Meta Pixel', 'ad-pixel', 'critical', 'https://www.facebook.com/tr?id=1&dl=https%3A%2F%2Fravenglass-supply.com%2F')],
    findings: [finding('PRE_CONSENT', 'critical')],
    riskScore: 30,
  });

  const view = anonymizeScan(scan);
  assert.equal(JSON.stringify(view).includes('ravenglass'), false, 'the strip step must drop sample URLs');

  const html = renderIndexHtml(buildIndex([scan], { sector: 'Test sector' }));
  assert.ok(!/ravenglass/i.test(html));
  assert.match(html, /Meta Pixel/, 'the service itself is still reported, only the URL is dropped');
});

test('scanning a tracking vendor does not permanently block publication', () => {
  // If the sample includes Hotjar itself, the bare word "Hotjar" is in the tracker tables by
  // design and identifies nobody. Blocking on it would make the guard unusable, so the
  // classifier's own vocabulary is exempt — while hotjar.com, the actual identifier, is not.
  const scan = makeScan({
    url: 'https://www.hotjar.com/',
    company: 'Hotjar',
    baseline: [HOTJAR()],
    findings: [finding('PRE_CONSENT', 'critical')],
    riskScore: 30,
  });

  const html = renderIndexHtml(buildIndex([scan], { sector: 'Test sector' }));
  assert.match(html, /Hotjar/);
  assert.ok(!/hotjar\.com/i.test(html), 'the hostname is still an identifier and must not appear');
});

test('a serialised index refuses to render rather than skipping the check', () => {
  // The identifier list is deliberately non-enumerable so JSON.stringify cannot carry a
  // client hostname into a published file. The cost is that a round-tripped index cannot be
  // verified, and an unverified page must never be produced silently.
  const built = buildIndex(sampleScans(), { sector: 'US retail' });
  assert.equal(JSON.stringify(built).includes('northwind'), false, 'the index JSON must be publishable');

  const roundTripped = JSON.parse(JSON.stringify(built));
  assert.throws(() => renderIndexHtml(roundTripped), (err) => {
    assert.ok(err instanceof AnonymityError);
    assert.match(err.message, /buildIndex/, 'the error must say how to recover');
    return true;
  });
});

test('the published page states observations and never a legal conclusion', () => {
  const html = renderIndexHtml(index());
  for (const banned of [/\bviolat/i, /\billegal\b/i, /non-?compliant/i, /breaking the law/i, /you (are|may be) liable/i]) {
    assert.ok(!banned.test(html), `the index must not assert a legal conclusion: ${banned}`);
  }
  assert.ok(!/AI-powered/i.test(html), 'never sell AI in client-facing copy');
  assert.match(html, /not legal advice/i);
  assert.match(html, /no individual company is named/i);
});

test('the methodology states the sample, the dates and what the method cannot see', () => {
  const html = renderIndexHtml(index());
  assert.match(html, /2026-07-10 to 2026-07-14/, 'the measurement window must be stated');
  assert.match(html, /7 sites submitted/);
  assert.match(html, /Server-side tagging/);
  assert.match(html, /CNAME-cloaked/);
  assert.match(html, /One page per site/);
  assert.match(html, /One geography, one profile/);
  assert.match(html, /PERCENTILE\.INC/, 'the quartile definition must be named');
});

test('the reject-control figure is not described as a share of sites that showed a banner', () => {
  // A consent platform detected only in network traffic — a banner gated to another region,
  // say — puts a site in this denominator without any banner having been observed. Describing
  // the figure as a share of sites "showing a consent banner" asserts something about a banner
  // this method never saw, on the one figure most likely to be quoted out of the page.
  const platformOnly = makeScan({
    url: 'https://geogated-example.com/',
    company: 'Geogated Example',
    cmp: ['OneTrust'],
    bannerVisible: false,
    findings: [finding('NO_REJECT_CONTROL', 'high')],
    riskScore: 15,
  });

  const i = buildIndex([platformOnly], { sector: 'Test' });
  assert.equal(i.rejectControl.consentMechanismPresent.count, 1, 'a named platform counts as a mechanism');

  const html = renderIndexHtml(i);
  assert.ok(
    !/of sites showing a consent banner/i.test(html),
    'the headline card must describe the denominator it was actually computed over'
  );
  assert.match(html, /consent mechanism/i);
});

test('caller-supplied labels are escaped rather than injected into the page', () => {
  // The sector and period are the only free text a caller supplies, and this artifact is
  // published rather than read once, so an unescaped label would be a stored injection.
  const html = renderIndexHtml(
    buildIndex([], { sector: '<script>alert(1)</script>', period: '" onmouseover="alert(2)' })
  );
  assert.ok(!/<script>alert/i.test(html), 'the tag must not survive as markup');
  assert.match(html, /&lt;script&gt;alert\(1\)&lt;\/script&gt;/);
  // The period lands in element content, so `onmouseover=` remains as inert text. What must
  // not survive is the quote that would close an attribute if this text ever moved into one.
  assert.ok(!/"\s*onmouseover=/i.test(html), 'the quote that would break out of an attribute must be escaped');
  assert.match(html, /&quot; onmouseover=&quot;alert\(2\)/);
});

test('a blocked publication says where the collision could have come from', () => {
  // A sample company sharing a name with one of the enforcement matters this template prints
  // blocks publication, correctly — an index of one sector that both scanned a company and
  // names it in the enforcement list reads as an accusation however it was meant. The message
  // has to name that cause, because the maintainer's instinct on an unexplained block is to
  // switch the guard off.
  const scan = makeScan({ url: 'https://www.honda.com/', company: 'Honda' });
  assert.throws(
    () => renderIndexHtml(buildIndex([scan], { sector: 'US automotive' })),
    (err) => {
      assert.ok(err instanceof AnonymityError);
      assert.match(err.message, /enforcement/i, 'the message must not blame the sector label alone');
      return true;
    }
  );
});

test('the page is self-contained and renders its distribution without external resources', () => {
  const html = renderIndexHtml(index());
  assert.ok(!/<script/i.test(html), 'no scripts: the page must survive being mirrored offline');
  // Not only a bandwidth concern: any external request would let the artifact report who is
  // reading it, which is an odd property for a document about tracking without consent.
  assert.ok(!/https?:\/\//.test(html), 'no external references of any kind');
  assert.match(html, /prefers-color-scheme: dark/);
  assert.match(html, /overflow-x:auto/);
  assert.match(html, /class="barfill" style="width:\d/, 'the distribution is drawn with plain HTML and CSS');
});
