/**
 * Regression tests for the drift engine.
 *
 * The expensive failure here is not a missed change, it is an invented one. A monitoring
 * alert that tells a client their tracking got worse when it did not, or that congratulates
 * them on a fix that was really a failed page load, destroys the credibility the retainer
 * runs on. So the guards — errored scans, empty captures, first scans, changed measurement
 * basis — carry more weight than the detection cases.
 *
 * Run: node --test test/diff.test.js
 */

import { test } from 'node:test';
import assert from 'node:assert/strict';

import { diffScans, summarizeDrift, DRIFT_STATUS, MATERIALITY } from '../src/diff.js';

const TRACKER = {
  meta: {
    name: 'Meta Pixel',
    category: 'ad-pixel',
    severity: 'critical',
    evidence: 'Transmits page and event data to Meta, keyed to a user identifier.',
    sample: 'https://www.facebook.com/tr?id=123&ev=PageView',
  },
  tiktok: {
    name: 'TikTok Pixel',
    category: 'ad-pixel',
    severity: 'critical',
    evidence: 'Transmits page and event data to TikTok.',
    sample: 'https://analytics.tiktok.com/i18n/pixel/events.js',
  },
  hotjar: {
    name: 'Hotjar',
    category: 'session-replay',
    severity: 'critical',
    evidence: 'Captures session recordings and heatmaps of user interaction.',
    sample: 'https://static.hotjar.com/c/hotjar-1.js',
  },
  ga: {
    name: 'Google Analytics',
    category: 'analytics',
    severity: 'medium',
    evidence: 'Transmits page view and event data to Google Analytics.',
    sample: 'https://www.google-analytics.com/g/collect?v=2',
  },
};

const FINDING = {
  preConsent: (trackers) => ({
    id: 'PRE_CONSENT',
    severity: 'critical',
    title: `${trackers.length} third-party tracker(s) fired before any consent interaction`,
    detail: 'A consent platform is deployed, yet these trackers transmitted first.',
    trackers,
  }),
  rejectIgnored: (trackers) => ({
    id: 'REJECT_IGNORED',
    severity: 'critical',
    title: `${trackers.length} tracker(s) continued firing after the reject control was clicked`,
    detail: 'The reject control was clicked and these trackers transmitted afterwards.',
    trackers,
  }),
};

/** Build a scanConsent-shaped result. Only the fields diff.js reads are populated. */
function makeScan({
  url = 'https://shop.example.com/',
  scannedAt = '2026-07-30T09:00:00.000Z',
  baseline = [],
  gpc = [],
  afterReject = [],
  rejectClicked = true,
  cmp = ['OneTrust'],
  findings = [],
  riskScore = 0,
  errors = [],
  passOverrides = {},
} = {}) {
  const pass = (trackers, key) => ({
    trackerCount: trackers.length,
    trackers,
    requestCount: 42 + trackers.length,
    error: null,
    ...(passOverrides[key] || {}),
  });

  return {
    url,
    scannedAt,
    durationMs: 21000,
    cmp,
    passes: {
      baseline: pass(baseline, 'baseline'),
      gpc: pass(gpc, 'gpc'),
      afterReject: { ...pass(afterReject, 'afterReject'), rejectClicked },
    },
    findings,
    riskScore,
    errors,
  };
}

const JUNE = '2026-06-12T09:00:00.000Z';
const JULY = '2026-07-30T09:00:00.000Z';

test('an unchanged site reports no drift', () => {
  const shape = {
    baseline: [TRACKER.ga],
    gpc: [TRACKER.ga],
    afterReject: [],
    findings: [],
    riskScore: 0,
  };
  const diff = diffScans(
    makeScan({ ...shape, scannedAt: JUNE }),
    makeScan({ ...shape, scannedAt: JULY })
  );

  assert.equal(diff.status, DRIFT_STATUS.COMPARED);
  assert.equal(diff.hasChanges, false);
  assert.equal(diff.materiality, MATERIALITY.NEUTRAL);
  assert.equal(diff.riskDelta, 0);
  assert.deepEqual(diff.changes, []);
  assert.deepEqual(diff.newTrackers, []);
  assert.deepEqual(diff.removedTrackers, []);
  assert.equal(diff.cmpChanged, false);

  const { subject } = summarizeDrift(diff);
  assert.match(subject, /No change in tracking on shop\.example\.com/);
  assert.match(subject, /12 June/);
});

test('a tracker that starts firing before consent is reported as a regression', () => {
  const previous = makeScan({ scannedAt: JUNE, baseline: [TRACKER.ga], gpc: [TRACKER.ga] });
  const current = makeScan({
    scannedAt: JULY,
    baseline: [TRACKER.ga, TRACKER.meta, TRACKER.tiktok],
    gpc: [TRACKER.ga],
    findings: [FINDING.preConsent(['Google Analytics', 'Meta Pixel', 'TikTok Pixel'])],
    riskScore: 30,
  });

  const diff = diffScans(previous, current);

  assert.equal(diff.hasChanges, true);
  assert.equal(diff.materiality, MATERIALITY.REGRESSION);
  assert.equal(diff.riskDelta, 30);
  assert.deepEqual(
    diff.newTrackers.map((t) => t.name).sort(),
    ['Meta Pixel', 'TikTok Pixel']
  );
  assert.deepEqual(
    diff.perPass.baseline.added.map((t) => t.name).sort(),
    ['Meta Pixel', 'TikTok Pixel']
  );
  assert.equal(diff.perPass.baseline.materiality, MATERIALITY.REGRESSION);
  assert.deepEqual(diff.perPass.gpc.added, []);
  assert.equal(diff.newFindings.length, 1);
  assert.equal(diff.newFindings[0].id, 'PRE_CONSENT');

  const { subject, body } = summarizeDrift(diff);
  assert.match(subject, /New tracking on shop\.example\.com/);
  assert.match(body, /Two advertising trackers began firing before any consent interaction/);
  assert.match(body, /since the last check on 12 June/);
  assert.match(body, /Meta Pixel and TikTok Pixel now transmit on page load/);
});

test('a tracker that starts surviving the reject click outranks every other change', () => {
  // Meta Pixel is already known site-wide, so this is not a new tracker — it is the same
  // pixel now firing after the visitor declines, which is the worst movement the engine
  // can observe and must sort above a brand new critical tracker in the baseline pass.
  const previous = makeScan({
    scannedAt: JUNE,
    baseline: [TRACKER.meta],
    gpc: [TRACKER.meta],
    afterReject: [],
    findings: [FINDING.preConsent(['Meta Pixel'])],
    riskScore: 30,
  });
  const current = makeScan({
    scannedAt: JULY,
    baseline: [TRACKER.meta, TRACKER.hotjar],
    gpc: [TRACKER.meta],
    afterReject: [TRACKER.meta],
    findings: [
      FINDING.preConsent(['Meta Pixel', 'Hotjar']),
      FINDING.rejectIgnored(['Meta Pixel']),
    ],
    riskScore: 60,
  });

  const diff = diffScans(previous, current);
  const top = diff.changes[0];

  assert.equal(top.kind, 'tracker-added');
  assert.equal(top.pass, 'afterReject');
  assert.equal(top.name, 'Meta Pixel');
  assert.equal(top.materiality, MATERIALITY.REGRESSION);
  assert.equal(top.rank, 33, 'critical severity in the post-reject pass is the ceiling');
  assert.equal(Math.max(...diff.changes.map((c) => c.rank)), top.rank);

  const baselineAddition = diff.changes.find(
    (c) => c.kind === 'tracker-added' && c.pass === 'baseline'
  );
  assert.equal(baselineAddition.name, 'Hotjar');
  assert.ok(
    baselineAddition.rank < top.rank,
    'a new critical tracker pre-consent must still rank below one surviving reject'
  );

  // Scan-wide "new" means never seen in any pass before, which Meta Pixel was.
  assert.deepEqual(diff.newTrackers.map((t) => t.name), ['Hotjar']);
  assert.deepEqual(diff.perPass.afterReject.added.map((t) => t.name), ['Meta Pixel']);

  const { subject, body } = summarizeDrift(diff);
  assert.match(subject, /Meta Pixel now fires after a visitor clicks reject/);
  assert.match(body, /Meta Pixel began firing after the reject control was clicked/);
  // The post-reject sentence must come first in the body, ahead of the new critical
  // tracker in the baseline pass.
  assert.ok(body.indexOf('Meta Pixel') < body.indexOf('Hotjar'));
  // REJECT_IGNORED restates in general terms what the sentence above already said.
  assert.doesNotMatch(body, /Trackers now continue to transmit after/);
});

test('a finding that disappears is reported as an improvement, not as new tracking', () => {
  const previous = makeScan({
    scannedAt: JUNE,
    baseline: [TRACKER.meta, TRACKER.ga],
    gpc: [TRACKER.meta],
    findings: [FINDING.preConsent(['Meta Pixel', 'Google Analytics'])],
    riskScore: 30,
  });
  const current = makeScan({
    scannedAt: JULY,
    baseline: [TRACKER.ga],
    gpc: [],
    findings: [],
    riskScore: 0,
  });

  const diff = diffScans(previous, current);

  assert.equal(diff.materiality, MATERIALITY.IMPROVEMENT);
  assert.equal(diff.resolvedFindings.length, 1);
  assert.equal(diff.resolvedFindings[0].id, 'PRE_CONSENT');
  assert.deepEqual(diff.newFindings, []);
  assert.deepEqual(diff.newTrackers, []);
  assert.deepEqual(diff.removedTrackers.map((t) => t.name), ['Meta Pixel']);
  assert.equal(diff.riskDelta, -30);

  const { subject, body } = summarizeDrift(diff);
  assert.match(subject, /Tracking reduced on shop\.example\.com/);
  assert.match(body, /Meta Pixel no longer transmits/);
  assert.match(body, /No tracking before a consent interaction was observed in this check/);
});

test('the first scan establishes a baseline instead of reporting everything as new', () => {
  const first = makeScan({
    scannedAt: JULY,
    baseline: [TRACKER.meta, TRACKER.ga],
    gpc: [TRACKER.meta],
    afterReject: [TRACKER.meta],
    findings: [FINDING.preConsent(['Meta Pixel', 'Google Analytics'])],
    riskScore: 30,
  });

  const diff = diffScans(null, first);

  assert.equal(diff.status, DRIFT_STATUS.FIRST_SCAN);
  assert.equal(diff.hasChanges, false);
  assert.equal(diff.materiality, MATERIALITY.NEUTRAL);
  assert.equal(diff.riskDelta, null, 'no previous scan means no delta can be asserted');
  assert.deepEqual(diff.newTrackers, []);
  assert.deepEqual(diff.newFindings, []);
  assert.deepEqual(diff.snapshot.trackerCounts, { baseline: 2, gpc: 1, afterReject: 1 });
  assert.deepEqual(diff.snapshot.cmp, ['OneTrust']);

  const { subject, body } = summarizeDrift(diff);
  assert.match(subject, /Baseline recorded for shop\.example\.com/);
  assert.match(body, /first scan/);
  assert.doesNotMatch(body, /began firing|new/i);

  // Same result whether the caller passes null or omits the argument entirely.
  assert.equal(diffScans(undefined, first).status, DRIFT_STATUS.FIRST_SCAN);
});

test('a scan that errored is never compared', () => {
  const previous = makeScan({
    scannedAt: JUNE,
    baseline: [TRACKER.meta, TRACKER.hotjar, TRACKER.ga],
    gpc: [TRACKER.meta],
    afterReject: [TRACKER.meta],
    findings: [FINDING.preConsent(['Meta Pixel', 'Hotjar', 'Google Analytics'])],
    riskScore: 60,
  });
  const failed = makeScan({
    scannedAt: JULY,
    cmp: [],
    riskScore: 0,
    errors: ['page.goto: net::ERR_CONNECTION_TIMED_OUT'],
    passOverrides: {
      baseline: { error: 'page.goto: net::ERR_CONNECTION_TIMED_OUT', requestCount: 1 },
    },
  });

  const diff = diffScans(previous, failed);

  assert.equal(diff.status, DRIFT_STATUS.NOT_COMPARABLE);
  assert.equal(diff.hasChanges, false);
  assert.equal(diff.riskDelta, null);
  assert.deepEqual(diff.removedTrackers, [], 'a failed load must never read as a removal');
  assert.deepEqual(diff.resolvedFindings, []);
  assert.ok(diff.captureProblems.length);

  const { subject, body } = summarizeDrift(diff);
  assert.match(subject, /could not be compared/);
  assert.match(body, /did not complete cleanly/);
  assert.doesNotMatch(body, /improve|reduced|resolved/i);
});

test('a pass that captured no requests at all is treated as a failed capture', () => {
  // The trap this exists for: no error is recorded, the pass simply saw nothing. A page
  // that loads issues at least its own document request, so zero means the capture broke,
  // and comparing it would report every tracker on the site as having been removed.
  const previous = makeScan({ scannedAt: JUNE, baseline: [TRACKER.meta, TRACKER.hotjar] });
  const silent = makeScan({
    scannedAt: JULY,
    passOverrides: { gpc: { requestCount: 0 } },
  });

  const diff = diffScans(previous, silent);

  assert.equal(diff.status, DRIFT_STATUS.NOT_COMPARABLE);
  assert.deepEqual(diff.removedTrackers, []);
  assert.match(diff.captureProblems.join(' '), /no network requests/);

  // The same guard applies to the stored side of the comparison.
  const staleReference = makeScan({
    scannedAt: JUNE,
    passOverrides: { baseline: { requestCount: 0 } },
  });
  assert.equal(
    diffScans(staleReference, makeScan({ scannedAt: JULY, baseline: [TRACKER.meta] })).status,
    DRIFT_STATUS.NOT_COMPARABLE
  );
});

test('an empty post-reject pass on a compliant site is a real result, not a failed capture', () => {
  // Found by diffing two real scans of the local fixtures. consent.js cuts the request
  // buffer at the click, so a site that honours its own reject button records zero
  // requests in that pass. Treating that as a broken capture refused to compare exactly
  // the compliant sites the retainer is supposed to keep watching.
  const compliantAfterReject = { requestCount: 0, trackerCount: 0, trackers: [], error: null };
  const previous = makeScan({
    scannedAt: JUNE,
    baseline: [TRACKER.ga],
    passOverrides: { afterReject: compliantAfterReject },
  });
  const current = makeScan({
    scannedAt: JULY,
    baseline: [TRACKER.ga, TRACKER.meta],
    findings: [FINDING.preConsent(['Google Analytics', 'Meta Pixel'])],
    riskScore: 30,
    passOverrides: { afterReject: compliantAfterReject },
  });

  const diff = diffScans(previous, current);

  assert.equal(diff.status, DRIFT_STATUS.COMPARED);
  assert.deepEqual(diff.captureProblems, []);
  assert.equal(diff.perPass.afterReject.comparable, true);
  assert.deepEqual(diff.newTrackers.map((t) => t.name), ['Meta Pixel']);

  // The exemption is narrow: with no reject control clicked, the pass records the whole
  // page load, so zero requests there really is a failed capture.
  const noRejectControl = makeScan({
    scannedAt: JULY,
    rejectClicked: false,
    passOverrides: { afterReject: { requestCount: 0 } },
  });
  assert.equal(diffScans(previous, noRejectControl).status, DRIFT_STATUS.NOT_COMPARABLE);
});

test('a post-reject pass measured on a different basis is recorded but not characterised', () => {
  // The reject control was clickable in June and is not now, so the pass captured the whole
  // page load this time. Trackers "appearing" there describe the measurement, not the site.
  const previous = makeScan({ scannedAt: JUNE, baseline: [TRACKER.meta], afterReject: [] });
  const current = makeScan({
    scannedAt: JULY,
    baseline: [TRACKER.meta],
    afterReject: [TRACKER.meta],
    rejectClicked: false,
  });

  const diff = diffScans(previous, current);

  assert.equal(diff.perPass.afterReject.comparable, false);
  assert.ok(diff.perPass.afterReject.note);
  assert.equal(diff.perPass.afterReject.added[0].name, 'Meta Pixel');
  assert.equal(diff.perPass.afterReject.added[0].materiality, MATERIALITY.NEUTRAL);
  assert.equal(diff.perPass.afterReject.added[0].rank, 0);

  // Losing the reject control is itself a regression, and it is stated once.
  const rejectChange = diff.changes.find((c) => c.kind === 'reject-control-lost');
  assert.ok(rejectChange);
  assert.equal(rejectChange.materiality, MATERIALITY.REGRESSION);
  assert.equal(diff.materiality, MATERIALITY.REGRESSION);

  const { body } = summarizeDrift(diff);
  assert.match(body, /not measured on the same basis/);
});

test('a page load with no reject control is never narrated as post-reject behaviour', () => {
  // consent.js only slices the request buffer from the moment the reject control is clicked.
  // With no reject control to click it keeps the whole page load, so the third pass is a
  // second plain load wearing the post-reject name. Narrating it as "after a visitor clicks
  // reject" asserts a click that never happened, on precisely the sites least likely to
  // offer a reject button, and hands the change the rank reserved for surviving a real one.
  const previous = makeScan({
    scannedAt: JUNE,
    baseline: [TRACKER.ga],
    gpc: [TRACKER.ga],
    afterReject: [TRACKER.ga],
    rejectClicked: false,
  });
  // Meta Pixel is absent from the GPC pass, so the post-reject pass is the only one that
  // could push the change above baseline gravity. It must not.
  const current = makeScan({
    scannedAt: JULY,
    baseline: [TRACKER.ga, TRACKER.meta],
    gpc: [TRACKER.ga],
    afterReject: [TRACKER.ga, TRACKER.meta],
    rejectClicked: false,
    findings: [FINDING.preConsent(['Google Analytics', 'Meta Pixel'])],
    riskScore: 30,
  });

  const diff = diffScans(previous, current);
  assert.equal(diff.perPass.afterReject.measuredPostReject, false);
  assert.equal(diff.perPass.afterReject.rejectClicked.changed, false);

  const { subject, body } = summarizeDrift(diff);
  assert.doesNotMatch(subject, /reject/i, `subject claimed a reject click: ${subject}`);
  assert.doesNotMatch(
    body,
    /after (a visitor clicks reject|the reject control was clicked)/i,
    `body claimed a reject click that never happened: ${body}`
  );
  assert.match(subject, /Meta Pixel now fires on page load/);
  assert.match(diff.notes.join(' '), /recorded the whole page load both times/);

  // 33 is a critical tracker newly surviving the site's own reject button. A site with no
  // reject button cannot reach it.
  assert.ok(
    Math.max(...diff.changes.map((c) => c.rank)) < 33,
    'an unclicked third pass must not reach the ceiling reserved for a real reject click'
  );
  assert.equal(diff.newTrackers[0].worstPass, 'baseline');
});

test('scans supplied in the wrong chronological order are refused, not described backwards', () => {
  const june = makeScan({ scannedAt: JUNE, baseline: [TRACKER.ga] });
  const july = makeScan({
    scannedAt: JULY,
    baseline: [TRACKER.ga, TRACKER.meta],
    findings: [FINDING.preConsent(['Google Analytics', 'Meta Pixel'])],
    riskScore: 30,
  });

  assert.equal(diffScans(june, july).materiality, MATERIALITY.REGRESSION);

  // The same pair the wrong way round narrates that regression as a fix, and dates it
  // "since the last check on" a day that has not happened yet. Every classification here is
  // directional, so the reversed reading is confident and wrong rather than obviously wrong.
  const reversed = diffScans(july, june);
  assert.equal(reversed.status, DRIFT_STATUS.NOT_COMPARABLE);
  assert.equal(reversed.riskDelta, null);
  assert.deepEqual(reversed.removedTrackers, []);
  assert.match(reversed.captureProblems.join(' '), /wrong order/);
  assert.doesNotMatch(summarizeDrift(reversed).body, /no longer|reduced/i);

  // Two scans bearing the same timestamp are a legitimate no-op, not an ordering error.
  assert.equal(
    diffScans(june, makeScan({ scannedAt: JUNE, baseline: [TRACKER.ga] })).status,
    DRIFT_STATUS.COMPARED
  );
});

test('a finding whose severity fell while it gained services is not called an improvement', () => {
  // A finding's severity is the worst severity among its services, so it drops the moment
  // the single gravest one leaves — which can happen in the very check that two new ones
  // arrive. Reading only the severity reports that as a fix.
  const previous = makeScan({
    scannedAt: JUNE,
    baseline: [TRACKER.hotjar],
    findings: [{ ...FINDING.preConsent(['Hotjar']), severity: 'critical' }],
    riskScore: 30,
  });
  const current = makeScan({
    scannedAt: JULY,
    baseline: [TRACKER.ga, TRACKER.meta],
    findings: [
      { ...FINDING.preConsent(['Google Analytics', 'Meta Pixel']), severity: 'medium' },
    ],
    riskScore: 5,
  });

  const diff = diffScans(previous, current);
  const finding = diff.persistingFindings[0];

  assert.equal(finding.id, 'PRE_CONSENT');
  assert.deepEqual(finding.trackersAdded, ['Google Analytics', 'Meta Pixel']);
  assert.equal(finding.severityChanged, true);
  assert.notEqual(
    finding.materiality,
    MATERIALITY.IMPROVEMENT,
    'a finding that gained services has not improved, whatever its severity did'
  );
  assert.equal(diff.materiality, MATERIALITY.REGRESSION, 'two new pre-consent trackers lead');

  const { body } = summarizeDrift(diff);
  const improvementParagraph = body.split('\n\n').find((p) => /no longer/.test(p)) ?? '';
  assert.doesNotMatch(
    improvementParagraph,
    /severity recorded/,
    'a severity drop bought with new services must not sit in the improvements paragraph'
  );
});

test('losing the consent platform is a regression and swapping vendors is neither', () => {
  const base = { baseline: [TRACKER.ga], gpc: [TRACKER.ga] };

  const lost = diffScans(
    makeScan({ ...base, scannedAt: JUNE, cmp: ['OneTrust'] }),
    makeScan({ ...base, scannedAt: JULY, cmp: [] })
  );
  assert.equal(lost.cmpChanged, true);
  assert.equal(lost.materiality, MATERIALITY.REGRESSION);
  assert.deepEqual(lost.cmp.removed, ['OneTrust']);

  const migrated = diffScans(
    makeScan({ ...base, scannedAt: JUNE, cmp: ['OneTrust'] }),
    makeScan({ ...base, scannedAt: JULY, cmp: ['Cookiebot'] })
  );
  assert.equal(migrated.cmpChanged, true);
  assert.equal(migrated.materiality, MATERIALITY.NEUTRAL, 'a migration is not an accusation');
  assert.match(summarizeDrift(migrated).body, /changed from OneTrust to Cookiebot/);

  // Gaining a platform is an improvement, but nothing stopped firing, so the subject line
  // must not announce a reduction in tracking that did not occur.
  const gained = diffScans(
    makeScan({ ...base, scannedAt: JUNE, cmp: [] }),
    makeScan({ ...base, scannedAt: JULY, cmp: ['Cookiebot'] })
  );
  assert.equal(gained.materiality, MATERIALITY.IMPROVEMENT);
  assert.deepEqual(gained.removedTrackers, []);
  assert.doesNotMatch(summarizeDrift(gained).subject, /Tracking reduced|fewer observations/);
});

test('scans of different hosts are refused rather than compared', () => {
  const diff = diffScans(
    makeScan({ scannedAt: JUNE, url: 'https://shop.example.com/', baseline: [TRACKER.meta] }),
    makeScan({ scannedAt: JULY, url: 'https://other.example.org/' })
  );
  assert.equal(diff.status, DRIFT_STATUS.NOT_COMPARABLE);
  assert.match(diff.captureProblems.join(' '), /different hosts/);

  // Both scans completed. Telling a client their scan failed is a false statement about
  // their site's availability, and one they are likely to act on.
  const { body } = summarizeDrift(diff);
  assert.doesNotMatch(body, /did not complete cleanly/);
  assert.match(body, /completed, but it could not be set against the previous check/);
});

test('no narrative ever states a legal conclusion or sells AI', () => {
  const scans = [
    makeScan({ scannedAt: JUNE, baseline: [TRACKER.ga] }),
    makeScan({
      scannedAt: JULY,
      baseline: [TRACKER.ga, TRACKER.meta, TRACKER.hotjar],
      gpc: [TRACKER.meta],
      afterReject: [TRACKER.meta],
      cmp: [],
      findings: [
        FINDING.preConsent(['Google Analytics', 'Meta Pixel', 'Hotjar']),
        FINDING.rejectIgnored(['Meta Pixel']),
      ],
      riskScore: 90,
    }),
  ];

  const diffs = [
    diffScans(scans[0], scans[1]),
    diffScans(scans[1], scans[0]),
    diffScans(null, scans[1]),
    diffScans(scans[0], makeScan({ scannedAt: JULY, passOverrides: { gpc: { requestCount: 0 } } })),
    diffScans(scans[0], scans[0]),
    diffScans(
      makeScan({ scannedAt: JUNE, baseline: [TRACKER.ga], rejectClicked: false, cmp: [] }),
      makeScan({
        scannedAt: JULY,
        baseline: [TRACKER.ga, TRACKER.meta],
        afterReject: [TRACKER.ga, TRACKER.meta],
        rejectClicked: false,
        cmp: [],
        riskScore: 30,
      })
    ),
  ];

  const banned = /violat|illegal|unlawful|breach|non-?compliant|liable|liability|must fix|ai-powered/i;
  for (const diff of diffs) {
    const { subject, body } = summarizeDrift(diff);
    assert.doesNotMatch(subject, banned, `subject stated a conclusion: ${subject}`);
    assert.doesNotMatch(body, banned, `body stated a conclusion: ${body}`);
    assert.equal(diff.summary, subject, 'diff.summary is the alert subject line');
  }
});

test('a partially shaped diff still narrates without throwing', () => {
  // diffScans fills every field in every branch, but this is also the function that turns a
  // stored diff into an email, and stored diffs are re-read by later versions of this
  // module. A field this version has not heard of has to cost a thinner sentence, never an
  // alert that throws on the way out and is silently never sent.
  const malformed = [
    null,
    undefined,
    'not a diff',
    42,
    {},
    [],
    { status: 'compared' },
    { status: 'compared', hasChanges: true },
    { status: 'first-scan' },
    { status: 'not-comparable' },
    { status: 'not-comparable', captureProblems: null, blockedBy: 'pairing' },
    {
      status: 'compared',
      hasChanges: true,
      changes: null,
      perPass: { baseline: {} },
      cmp: null,
      riskScore: null,
    },
  ];

  for (const diff of malformed) {
    const { subject, body } = summarizeDrift(diff);
    assert.ok(subject.length, `no subject produced for ${JSON.stringify(diff)}`);
    assert.ok(body.length, `no body produced for ${JSON.stringify(diff)}`);
  }
});
