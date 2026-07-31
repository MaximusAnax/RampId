/**
 * Tests for the § 7025(c)(6) opt-out display check.
 *
 * This is the product's lead finding, and the reason is commercial rather than technical.
 * "Since 1 January the regulation requires your site to display that it processed an
 * opt-out signal, and here is what yours displays" is a compliance observation. "Here is
 * the tracking pixel that fired" is, in form, indistinguishable from the demand letters
 * that volume plaintiff firms send to hundreds of brands weekly — which recipients' counsel
 * have trained them to forward and never answer. Same scan, opposite category.
 *
 * So the false-positive bar here is higher than anywhere else in the system: telling a
 * company it failed to display something it did display would discredit the one finding the
 * whole outreach motion is built on.
 */

import { test } from 'node:test';
import assert from 'node:assert/strict';

import { detectOptOutDisplay, optOutDisplayFinding } from '../src/optoutdisplay.js';

/** Minimal stand-in for a Playwright page exposing only what the detector reads. */
const pageWithText = (text) => ({
  evaluate: async () => text,
});

const pageThatThrows = () => ({
  evaluate: async () => {
    throw new Error('detached frame');
  },
});

test('explicit acknowledgement of the signal counts as displayed', async () => {
  for (const copy of [
    'We detected your opt-out preference signal and have applied it.',
    'Global Privacy Control detected. You have been opted out.',
    'Your privacy choice was honored.',
    'We received your GPC signal.',
  ]) {
    const r = await detectOptOutDisplay(pageWithText(copy));
    assert.equal(r.displayed, true, `should count as displayed: ${copy}`);
  }
});

test('acknowledgement evidence is captured for the report', async () => {
  const r = await detectOptOutDisplay(
    pageWithText('Some header text. We have honored your opt-out preference signal. Footer.')
  );
  assert.equal(r.displayed, true);
  assert.ok(r.evidence && r.evidence.length > 0, 'evidence must be quotable in the report');
  assert.ok(/opt-out preference signal/i.test(r.evidence));
});

test('a page silent about the signal is a confident negative', async () => {
  const r = await detectOptOutDisplay(pageWithText('Welcome to our store. Shop now. Contact us.'));
  assert.equal(r.displayed, false);
  assert.equal(r.hasOptOutLinkOnly, false);
});

test('an opt-out link alone is distinguished from acknowledging the signal', async () => {
  // A "Do Not Sell" link is a control, not a confirmation that the browser signal was
  // processed. Reporting these identically would be both inaccurate and needlessly harsh
  // toward a company that has clearly done some of the work.
  const r = await detectOptOutDisplay(
    pageWithText('Home. Products. Do Not Sell or Share My Personal Information. Careers.')
  );
  assert.equal(r.displayed, false);
  assert.equal(r.hasOptOutLinkOnly, true);
  assert.ok(/link is present/i.test(r.note));
});

test('unreadable or empty pages yield no conclusion at all', async () => {
  // Missing evidence is not evidence of a failure. Both of these must be null rather than
  // false, because false becomes a finding.
  const thrown = await detectOptOutDisplay(pageThatThrows());
  assert.equal(thrown.displayed, null);

  const empty = await detectOptOutDisplay(pageWithText('   '));
  assert.equal(empty.displayed, null);
});

test('only a confident negative produces a finding', () => {
  assert.equal(optOutDisplayFinding({ displayed: true }), null);
  assert.equal(optOutDisplayFinding({ displayed: null }), null);
  assert.equal(optOutDisplayFinding(null), null);

  const finding = optOutDisplayFinding({ displayed: false, hasOptOutLinkOnly: false });
  assert.ok(finding);
  assert.equal(finding.id, 'OPTOUT_NOT_DISPLAYED');
});

test('the finding cites the regulation and its date without asserting a violation', () => {
  const f = optOutDisplayFinding({ displayed: false, hasOptOutLinkOnly: true });

  assert.ok(/7025\(c\)\(6\)/.test(f.detail), 'must cite the specific provision');
  assert.ok(/1 January 2026/.test(f.detail), 'must date the change');

  // The whole reframing depends on this staying an observation rather than an accusation.
  for (const banned of [/\bviolat/i, /\billegal\b/i, /non-?compliant/i, /you (are|may be) liable/i]) {
    assert.ok(!banned.test(f.detail), `finding must not assert a legal conclusion: ${banned}`);
  }
});

test('the finding notes when transmission also continued during the pass', () => {
  const withTransmission = optOutDisplayFinding(
    { displayed: false, hasOptOutLinkOnly: false },
    { gpcHonoured: false }
  );
  assert.ok(/transmission also continued/i.test(withTransmission.detail));

  const without = optOutDisplayFinding(
    { displayed: false, hasOptOutLinkOnly: false },
    { gpcHonoured: true }
  );
  assert.ok(!/transmission also continued/i.test(without.detail));
});

test('a site sharing nothing with third parties gets no display finding', () => {
  // Section 7025(c)(6) attaches to "a business that processes an opt-out preference signal."
  // A site observed sharing nothing may have no such obligation, and telling a company with
  // no tracking that it failed a display requirement is exactly the false accusation that
  // would discredit the finding this product leads with.
  const finding = optOutDisplayFinding(
    { displayed: false, hasOptOutLinkOnly: false },
    { sharesWithThirdParties: false }
  );
  assert.equal(finding, null);
});

test('a site that does share still gets the display finding', () => {
  const finding = optOutDisplayFinding(
    { displayed: false, hasOptOutLinkOnly: false },
    { sharesWithThirdParties: true }
  );
  assert.ok(finding);
  assert.equal(finding.id, 'OPTOUT_NOT_DISPLAYED');
});
