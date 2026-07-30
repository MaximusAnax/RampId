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
  assert.match(body, /after a visitor clicks reject/);
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
});

test('scans of different hosts are refused rather than compared', () => {
  const diff = diffScans(
    makeScan({ scannedAt: JUNE, url: 'https://shop.example.com/', baseline: [TRACKER.meta] }),
    makeScan({ scannedAt: JULY, url: 'https://other.example.org/' })
  );
  assert.equal(diff.status, DRIFT_STATUS.NOT_COMPARABLE);
  assert.match(diff.captureProblems.join(' '), /different hosts/);
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
  ];

  const banned = /violat|illegal|unlawful|breach|non-?compliant|liable|liability|must fix|ai-powered/i;
  for (const diff of diffs) {
    const { subject, body } = summarizeDrift(diff);
    assert.doesNotMatch(subject, banned, `subject stated a conclusion: ${subject}`);
    assert.doesNotMatch(body, banned, `body stated a conclusion: ${body}`);
    assert.equal(diff.summary, subject, 'diff.summary is the alert subject line');
  }
});

test('a malformed diff still narrates without throwing', () => {
  const { subject, body } = summarizeDrift(null);
  assert.ok(subject.length);
  assert.ok(body.length);
});
