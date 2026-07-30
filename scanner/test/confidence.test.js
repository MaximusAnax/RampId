/**
 * Tests for review triage.
 *
 * The rule this encodes: sending one wrong finding costs more than missing ten right ones.
 * So nothing here ever says "safe to send" — the highest rating is "routine", and a human
 * still reads it. What the scoring buys is that the borderline cases are unmissable, so a
 * fixed review budget lands on the drafts where a human look changes the outcome.
 */

import { test } from 'node:test';
import assert from 'node:assert/strict';

import { scoreFinding, scoreScan, REVIEW } from '../src/confidence.js';

const scan = (overrides = {}) => ({
  url: 'https://shop.example/',
  riskScore: 60,
  bannerVisible: true,
  capture: { ok: true, usable: true, passesLoaded: 3, note: null },
  findings: [],
  passes: {
    baseline: { trackers: [], restrained: [] },
    gpc: { trackers: [], restrained: [] },
    afterReject: { trackers: [], restrained: [], rejectClicked: true },
  },
  ...overrides,
});

test('a partial capture drops any finding out of routine review', () => {
  // A partial capture can produce a finding that is locally correct and globally
  // misleading, and no amount of per-finding evidence compensates for not having seen the
  // whole page.
  const s = scan({ capture: { ok: false, usable: true, passesLoaded: 2, note: 'partial' } });
  const r = scoreFinding({ id: 'REJECT_IGNORED', trackers: ['Meta Pixel'] }, s);
  assert.notEqual(r.review, REVIEW.ROUTINE);
  assert.ok(r.reasons.some((x) => /three passes/i.test(x)));
});

test('a reject-pass claim without a confirmed click is held back', () => {
  const s = scan({
    passes: {
      baseline: { trackers: [], restrained: [] },
      gpc: { trackers: [], restrained: [] },
      afterReject: { trackers: [], restrained: [], rejectClicked: false },
    },
  });
  const r = scoreFinding({ id: 'REJECT_IGNORED', trackers: ['Meta Pixel'] }, s);
  assert.equal(r.review, REVIEW.HOLD);
});

test('claiming no consent mechanism where a banner was seen is downgraded', () => {
  // This is the contradiction a reader settles in one click, so it must never go out
  // unreviewed.
  const r = scoreFinding({ id: 'NO_CMP', trackers: [] }, scan({ bannerVisible: true }));
  assert.equal(r.review, REVIEW.HOLD);
});

test('a curated high-severity service raises confidence over a long-tail match', () => {
  const withCurated = scan({
    passes: {
      baseline: {
        trackers: [{ name: 'Hotjar', source: 'curated', severity: 'critical' }],
        restrained: [],
      },
      gpc: { trackers: [], restrained: [] },
      afterReject: { trackers: [], restrained: [], rejectClicked: true },
    },
  });
  const longTail = scan({
    passes: {
      baseline: {
        trackers: [{ name: 'SomeVendor', source: 'third-party-web', severity: 'medium' }],
        restrained: [],
      },
      gpc: { trackers: [], restrained: [] },
      afterReject: { trackers: [], restrained: [], rejectClicked: true },
    },
  });

  const a = scoreFinding({ id: 'PRE_CONSENT', trackers: ['Hotjar'] }, withCurated);
  const b = scoreFinding({ id: 'PRE_CONSENT', trackers: ['SomeVendor'] }, longTail);
  assert.ok(a.confidence > b.confidence);
});

test('a scan is only as sendable as its weakest reported finding', () => {
  // The message goes out as one document, and a reader who disproves any part of it stops
  // trusting the rest.
  const s = scan({
    bannerVisible: true,
    findings: [
      { id: 'PRE_CONSENT', title: 'trackers fired', trackers: ['Meta Pixel'] },
      { id: 'NO_CMP', title: 'no consent mechanism', trackers: [] },
    ],
    passes: {
      baseline: {
        trackers: [{ name: 'Meta Pixel', source: 'curated', severity: 'critical' }],
        restrained: [],
      },
      gpc: { trackers: [], restrained: [] },
      afterReject: { trackers: [], restrained: [], rejectClicked: true },
    },
  });
  const r = scoreScan(s);
  assert.equal(r.review, REVIEW.HOLD, 'the weak finding must govern the whole scan');
  assert.ok(/do not send/i.test(r.guidance));
});

test('a scan with no findings needs no review and says so', () => {
  const r = scoreScan(scan({ findings: [] }));
  assert.equal(r.review, REVIEW.ROUTINE);
  assert.equal(r.guidance, 'Nothing to send.');
});

test('guidance always names what to check rather than just rating it', () => {
  const s = scan({
    findings: [{ id: 'NO_REJECT_CONTROL', title: 'No reject control found', trackers: [] }],
  });
  const r = scoreScan(s);
  assert.ok(r.guidance.length > 20, 'guidance must be actionable, not a bare label');
  assert.ok(/reject control/i.test(r.guidance));
});
