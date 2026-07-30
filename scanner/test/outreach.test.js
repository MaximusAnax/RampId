/**
 * Regression tests for first-contact message generation.
 *
 * The expensive failure in this module is not a badly worded email, it is a *sendable* one
 * that accuses. Outreach is the only part of the system a stranger reads before deciding what
 * kind of operation this is, and an accusation, a fabricated statistic or a pressure line
 * reclassifies the sender as a demand-letter mill permanently. So the guard tests and the
 * "clean scan produces nothing at all" test carry more weight than the copy assertions.
 *
 * Run: node --test test/outreach.test.js
 */

import { test } from 'node:test';
import assert from 'node:assert/strict';

import {
  generateOutreach,
  generateFollowUp,
  assertFactualCopy,
  findBannedPhrases,
  countSentences,
  selectLeadObservation,
  MAX_BODY_SENTENCES,
  MAX_FOLLOW_UP_SENTENCES,
} from '../src/outreach.js';

const TRACKER = {
  hotjar: {
    name: 'Hotjar',
    category: 'session-replay',
    severity: 'critical',
    evidence: 'Captures session recordings and heatmaps of user interaction.',
    sample: 'https://static.hotjar.com/c/hotjar-2941.js?sv=6',
  },
  meta: {
    name: 'Meta Pixel',
    category: 'ad-pixel',
    severity: 'critical',
    evidence: 'Transmits page and event data to Meta, keyed to a user identifier.',
    sample: 'https://www.facebook.com/tr?id=123456&ev=PageView',
  },
  ga: {
    name: 'Google Analytics',
    category: 'analytics',
    severity: 'medium',
    evidence: 'Transmits page view and event data to Google Analytics.',
    sample: 'https://www.google-analytics.com/g/collect?v=2&tid=G-ABC123',
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
  gpcIgnored: (trackers) => ({
    id: 'GPC_IGNORED',
    severity: 'critical',
    title: `${trackers.length} tracker(s) continued firing with Global Privacy Control enabled`,
    detail: 'The request advertised Sec-GPC: 1 and navigator.globalPrivacyControl = true.',
    trackers,
  }),
  rejectIgnored: (trackers) => ({
    id: 'REJECT_IGNORED',
    severity: 'critical',
    title: `${trackers.length} tracker(s) continued firing after the reject control was clicked`,
    detail: 'The reject control was clicked and these trackers transmitted afterwards.',
    trackers,
  }),
  noRejectControl: () => ({
    id: 'NO_REJECT_CONTROL',
    severity: 'high',
    title: 'No reject control found on the consent banner',
    detail: 'A consent banner is present but no reject control could be found beside accept.',
    trackers: [],
  }),
  noCmp: () => ({
    id: 'NO_CMP',
    severity: 'high',
    title: 'No consent mechanism detected',
    detail: 'Third-party trackers were observed and no consent banner could be identified.',
    trackers: [],
  }),
};

/** Build a scanConsent-shaped result. Only the fields outreach.js reads are populated. */
function makeScan({
  url = 'https://shop.example.com/',
  scannedAt = '2026-07-28T10:12:00.000Z',
  baseline = [],
  gpc = [],
  afterReject = [],
  rejectClicked = true,
  cmp = ['OneTrust'],
  bannerVisible = null,
  findings = [],
  riskScore = 0,
  errors = [],
  passOverrides = {},
} = {}) {
  const pass = (trackers, key) => ({
    trackerCount: trackers.length,
    trackers,
    // Non-zero everywhere: diff.js treats a pass with no requests at all as a failed capture,
    // and outreach refuses to write from a failed capture.
    requestCount: 40 + trackers.length,
    error: null,
    ...(passOverrides[key] || {}),
  });

  return {
    url,
    scannedAt,
    durationMs: 24000,
    cmp,
    // consent.js reports a bespoke banner it cannot name, so this is a separate signal from
    // the platform list and the copy has to read it separately.
    bannerVisible: bannerVisible === null ? cmp.length > 0 : bannerVisible,
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

const LEAKY = makeScan({
  baseline: [TRACKER.hotjar, TRACKER.meta, TRACKER.ga],
  gpc: [TRACKER.hotjar, TRACKER.meta],
  afterReject: [TRACKER.hotjar, TRACKER.meta],
  findings: [
    FINDING.preConsent(['Hotjar', 'Meta Pixel', 'Google Analytics']),
    FINDING.gpcIgnored(['Hotjar', 'Meta Pixel']),
    FINDING.rejectIgnored(['Hotjar', 'Meta Pixel']),
  ],
  riskScore: 90,
});

const CLEAN = makeScan({ findings: [], riskScore: 0 });

const NO_REJECT = makeScan({
  cmp: ['Cookiebot'],
  baseline: [TRACKER.ga],
  gpc: [TRACKER.ga],
  afterReject: [TRACKER.ga],
  rejectClicked: false,
  findings: [FINDING.noRejectControl()],
  riskScore: 15,
});

const GPC_ONLY = makeScan({
  gpc: [TRACKER.meta],
  afterReject: [],
  findings: [FINDING.gpcIgnored(['Meta Pixel'])],
  riskScore: 30,
});

const ALL_TONES = ['plain', 'technical', 'brief'];

test('a clean scan produces no outreach at all', () => {
  // The whole point. There is nothing true and specific to say about a site with no findings,
  // and manufacturing a reason to make contact is what turns this into bulk mail.
  assert.equal(generateOutreach(CLEAN, { company: 'Clean Shop' }), null);
  assert.equal(generateFollowUp(CLEAN, { priorSubject: 'anything' }), null);
  assert.equal(selectLeadObservation(CLEAN), null);
});

test('a scan whose capture failed produces no outreach', () => {
  // A timed-out pass records no trackers, which looks identical to a site that is clean.
  // First contact has no second chance to correct the record, so it is refused outright.
  const failed = makeScan({
    baseline: [TRACKER.meta],
    afterReject: [TRACKER.meta],
    findings: [FINDING.rejectIgnored(['Meta Pixel'])],
    passOverrides: { gpc: { error: 'net::ERR_TIMED_OUT' } },
    errors: ['net::ERR_TIMED_OUT'],
  });
  assert.equal(generateOutreach(failed, {}), null);
});

test('missing or malformed input produces no outreach rather than an exception', () => {
  assert.equal(generateOutreach(null, {}), null);
  assert.equal(generateOutreach({}, {}), null);
  assert.equal(generateOutreach({ findings: [] }, {}), null);
  assert.equal(generateFollowUp(undefined, {}), null);
});

test('the message opens with a named service and a named endpoint from the scan', () => {
  const message = generateOutreach(LEAKY, { company: 'Example Shop', senderName: 'A. Ndiongue' });
  const [firstSentence] = message.body.split(/(?<=\.)\s/);

  assert.match(firstSentence, /Hotjar/, 'the lead sentence must name the service observed');
  assert.match(firstSentence, /static\.hotjar\.com/, 'the lead sentence must name the endpoint');
  assert.match(firstSentence, /shop\.example\.com/);

  // Not a greeting, not credentials, not a pitch.
  assert.doesNotMatch(firstSentence, /^(hi|hello|hey|dear|greetings)\b/i);
  assert.doesNotMatch(message.body, /\bI (help|work with|specialise|specialize)\b/i);
});

test('the named endpoint is one the scan actually recorded', () => {
  // The guard against the failure that ends the business quietly: a plausible endpoint the
  // recipient's own engineer cannot find in their logs discredits every other sentence.
  const message = generateOutreach(LEAKY, {});
  const recorded = Object.values(LEAKY.passes)
    .flatMap((pass) => pass.trackers)
    .map((tracker) => tracker.sample);

  const cited = message.body.match(/[a-z0-9.-]+\.(com|net|io|ms|org)/gi) || [];
  const endpointsCited = cited.filter((host) => !host.endsWith('example.com'));
  assert.ok(endpointsCited.length, 'expected at least one endpoint host in the copy');
  for (const host of endpointsCited) {
    assert.ok(
      recorded.some((sample) => sample.includes(host)),
      `${host} appears in the copy but not in the scan`
    );
  }
});

test('the message stays inside its sentence budget', () => {
  const plain = generateOutreach(LEAKY, { company: 'Example Shop', senderName: 'A. Ndiongue' });
  assert.ok(countSentences(plain.body) <= MAX_BODY_SENTENCES);
  assert.equal(MAX_BODY_SENTENCES, 6);

  const brief = generateOutreach(LEAKY, { tone: 'brief', senderName: 'A. Ndiongue' });
  assert.ok(countSentences(brief.body) <= 3, 'brief tone must be shorter still');
  assert.ok(countSentences(brief.body) < countSentences(plain.body));
});

test('brevity never costs a required caveat', () => {
  // The shortest tone buys one extra sentence rather than dropping the qualification that
  // keeps a negative observation from reading as a claim.
  const brief = generateOutreach(NO_REJECT, { tone: 'brief' });
  assert.match(brief.body, /manual look/);
  assert.ok(countSentences(brief.body) <= 4);
  assert.ok(countSentences(brief.body) <= MAX_BODY_SENTENCES);
});

test('an unknown tone falls back to the plain message rather than failing', () => {
  const fallback = generateOutreach(LEAKY, { tone: 'enthusiastic' });
  assert.deepEqual(fallback, generateOutreach(LEAKY, { tone: 'plain' }));
});

test('the message offers verification before it asks for anything', () => {
  const { body } = generateOutreach(LEAKY, {});
  const verifyAt = body.indexOf('check it yourself');
  const askAt = body.indexOf('If it is useful');

  assert.ok(verifyAt > -1, 'the reader must be told how to confirm this independently');
  assert.ok(askAt > -1, 'there must be exactly one ask');
  assert.ok(verifyAt < askAt, 'the useful thing comes before the ask');
  assert.match(body, /not legal advice/);
  assert.match(body, /counsel/);
});

test('the most damaging finding leads when several are present', () => {
  const lead = selectLeadObservation(LEAKY);
  assert.equal(lead.finding.id, 'REJECT_IGNORED');
  assert.equal(lead.passKey, 'afterReject');
  // Session replay leads a tie on severity: it is the most concrete thing to describe and the
  // category behind most CIPA filings.
  assert.equal(lead.tracker.name, 'Hotjar');

  const { subject } = generateOutreach(LEAKY, {});
  assert.match(subject, /after clicking reject/);
});

test('the message differs by finding type, because the remediation differs', () => {
  const reject = generateOutreach(LEAKY, {});
  const noControl = generateOutreach(NO_REJECT, {});
  const gpc = generateOutreach(GPC_ONLY, {});

  assert.notEqual(reject.subject, noControl.subject);
  assert.notEqual(reject.body, noControl.body);
  assert.notEqual(gpc.subject, reject.subject);

  assert.match(reject.body, /tag manager/, 'post-reject failure points at the tag trigger');
  assert.match(noControl.body, /No reject control|could not find a reject control/i);
  assert.match(noControl.body, /banner template/, 'a missing control is a banner change');
  assert.match(gpc.body, /Sec-GPC: 1/, 'the GPC message states the signal that was sent');
  assert.match(gpc.body, /Global Privacy Control/);
});

test('a negative observation carries its own manual-check caveat', () => {
  // NO_REJECT_CONTROL is the finding an automated check is most likely to be wrong about, so
  // the message says so itself rather than leaving the recipient to discover it.
  const { body, plainFacts } = generateOutreach(NO_REJECT, {});
  assert.match(body, /preferences dialog/);
  assert.match(body, /manual look/);
  assert.doesNotMatch(body, /continued firing after/, 'nothing may be claimed about pass 3');
  assert.ok(plainFacts.some((fact) => /Pass 3 could not be completed/.test(fact)));
});

test('no consent banner is claimed on a site where none was found', () => {
  // consent.js records PRE_CONSENT and NO_CMP together on a site with no banner at all, and
  // PRE_CONSENT leads. Copy that says "your consent banner" regardless puts a statement the
  // reader disproves in one click into the sentence the whole message rests on, and
  // contradicts the sibling finding in the same scan.
  const noBanner = makeScan({
    cmp: [],
    bannerVisible: false,
    baseline: [TRACKER.meta, TRACKER.ga],
    findings: [FINDING.preConsent(['Meta Pixel', 'Google Analytics']), FINDING.noCmp()],
  });

  const { body, subject } = generateOutreach(noBanner, {});
  assert.match(body, /before anything on the page was clicked/);
  assert.doesNotMatch(body, /your consent banner|touching the banner/);
  assert.doesNotMatch(subject, /consent banner/, 'the subject presupposes nothing either');

  // A site that does have one keeps the more specific wording.
  const withBanner = makeScan({
    baseline: [TRACKER.meta],
    findings: [FINDING.preConsent(['Meta Pixel'])],
  });
  assert.match(generateOutreach(withBanner, {}).body, /your OneTrust banner was clicked/);
});

test('the follow-up never refers to a banner the first message could not find', () => {
  const noCmp = makeScan({
    cmp: [],
    bannerVisible: false,
    baseline: [TRACKER.meta],
    findings: [FINDING.noCmp()],
  });

  const first = generateOutreach(noCmp, {});
  assert.match(first.body, /no consent banner or consent platform was detectable/);

  const followUp = generateFollowUp(noCmp, { priorSubject: first.subject });
  assert.match(followUp.body, /Meta Pixel/);
  assert.doesNotMatch(followUp.body, /your banner/, 'the two messages must not contradict');
});

test('a follow-up that restates a negative observation restates its caveat too', () => {
  // NO_REJECT_CONTROL has no named service to compress the fact into, so the follow-up
  // reuses the claim word for word. Dropping the qualification there would make the second
  // message a firmer assertion than the first, on the finding automation is most likely to
  // have got wrong.
  const followUp = generateFollowUp(NO_REJECT, {});
  assert.match(followUp.body, /could not find a reject control/);
  assert.match(followUp.body, /preferences dialog/);
  assert.ok(countSentences(followUp.body) <= MAX_FOLLOW_UP_SENTENCES + 1);

  // A caveat buys a sentence; it does not license a longer follow-up generally.
  assert.ok(countSentences(generateFollowUp(LEAKY, {}).body) <= MAX_FOLLOW_UP_SENTENCES);
});

test('a banned word inside a captured URL does not make a prospect uncontactable', () => {
  // The guard polices language this product wrote. A company whose page sits at
  // /data-breach-response accuses nobody by having that URL, and refusing to write to them
  // left the sender nothing to reword — the offending text is the recipient's own.
  const sample = 'https://www.facebook.com/tr?id=1&cd[value]=$50&ev=Purchase';
  const awkward = makeScan({
    url: 'https://example.com/legal/data-breach-response',
    baseline: [{ ...TRACKER.meta, sample }],
    afterReject: [{ ...TRACKER.meta, sample }],
    findings: [FINDING.rejectIgnored(['Meta Pixel'])],
  });

  const message = generateOutreach(awkward, { tone: 'technical' });
  assert.ok(message, 'captured evidence must not be able to block generation');
  assert.ok(message.plainFacts.some((fact) => fact.includes('data-breach-response')));
  assert.ok(message.body.includes(sample), 'the evidence is still quoted exactly as captured');

  // The exemption covers captured strings only. The same words written as copy still throw,
  // and a caller-supplied name cannot borrow the exemption.
  assert.throws(() => assertFactualCopy('This is a breach of the law.'), /never sends/);
  assert.throws(() => generateOutreach(awkward, { company: 'Breach Recovery Inc' }), /never sends/);
});

test('a captured URL ending in a terminator neither ends a sentence nor breaks the budget', () => {
  // The last character of a request URL belongs to a third party. Dropped mid-sentence it
  // reads as the sentence ending; counted as prose it puts the body over a cap it does not
  // actually breach, which used to stop the message being generated at all.
  const odd = { ...TRACKER.meta, sample: 'https://cdn.example.net/collect.' };
  const scan = makeScan({
    baseline: [odd],
    gpc: [odd],
    afterReject: [odd],
    findings: [FINDING.rejectIgnored(['Meta Pixel'])],
  });

  for (const tone of ALL_TONES) {
    const message = generateOutreach(scan, { tone });
    assert.ok(message, `${tone}: a trailing full stop must not stop generation`);
    assert.ok(countSentences(message.body) <= MAX_BODY_SENTENCES, tone);
    assert.doesNotMatch(
      message.body.split('\n')[0],
      /collect\.\s/,
      `${tone}: no endpoint label may close a sentence halfway through it`
    );
  }

  assert.ok(generateOutreach(scan, {}).plainFacts.some((fact) => fact.includes('collect.')));
});

test('a malformed record produces no message rather than a blank in the first sentence', () => {
  // Scans are read back from disk as often as they come from a live capture, so a record can
  // arrive truncated. Opening on "null sent a request" is worse than sending nothing.
  const nameless = makeScan({
    baseline: [{ ...TRACKER.meta, name: undefined }],
    afterReject: [{ ...TRACKER.meta, name: undefined }],
    findings: [FINDING.rejectIgnored([])],
  });
  assert.equal(generateOutreach(nameless, {}), null);

  // A platform list that arrived as objects rather than names must not print into the copy.
  const oddCmp = makeScan({
    cmp: [{ name: 'OneTrust' }],
    baseline: [TRACKER.meta],
    afterReject: [TRACKER.meta],
    findings: [FINDING.rejectIgnored(['Meta Pixel'])],
  });
  const message = generateOutreach(oddCmp, {});
  assert.doesNotMatch(message.body, /\[object Object\]/);
  assert.ok(message.plainFacts.every((fact) => !fact.includes('[object Object]')));
});

test('no endpoint is invented when the capture recorded no sample URL', () => {
  const noSample = makeScan({
    afterReject: [{ ...TRACKER.meta, sample: null }],
    baseline: [{ ...TRACKER.meta, sample: null }],
    findings: [FINDING.rejectIgnored(['Meta Pixel'])],
  });
  const { body, plainFacts } = generateOutreach(noSample, {});

  assert.match(body, /Meta Pixel sent a request on/);
  assert.doesNotMatch(body, /undefined|null|facebook/);
  assert.ok(plainFacts.some((fact) => /URL was not retained/.test(fact)));
});

test('plainFacts records the observation the copy was built from', () => {
  const { plainFacts } = generateOutreach(LEAKY, { company: 'Example Shop' });

  assert.ok(plainFacts.some((fact) => fact.includes('https://shop.example.com/')));
  assert.ok(plainFacts.some((fact) => fact.includes('28 July 2026')));
  assert.ok(plainFacts.some((fact) => fact.includes('OneTrust')));
  assert.ok(
    plainFacts.some((fact) => fact.includes(TRACKER.hotjar.sample)),
    'the raw request URL must be available to the sender before they press send'
  );
  assert.ok(plainFacts.every((fact) => findBannedPhrases(fact).length === 0));
});

test('banned language throws instead of being sent', () => {
  const forbidden = [
    'You are in violation of CIPA.',
    'This tracking is illegal.',
    'Your site is non-compliant.',
    'You are exposed to statutory damages.',
    'You could be sued for this.',
    'This is a breach of the law.',
    'You may be liable for each visitor.',
    'The CPPA fined a carmaker $632,500 for this.',
    'Act now before it is too late.',
    'This is urgent.',
    'Trusted by hundreds of companies.',
    'Our AI-powered scanner found this.',
    'We guarantee a fix.',
  ];

  for (const copy of forbidden) {
    assert.throws(() => assertFactualCopy(copy), /never sends/, `not caught: ${copy}`);
    assert.ok(findBannedPhrases(copy).length, `not detected: ${copy}`);
  }

  assert.equal(findBannedPhrases(forbidden[0])[0].reason, 'states a legal conclusion');
});

test('the guard is enforced during generation, not left to the caller', () => {
  // Untrusted text reaches the copy through the options, so the guard has to sit on the
  // output path rather than in a checklist the sender is trusted to follow.
  assert.throws(
    () => generateOutreach(LEAKY, { company: 'Violation Records Inc' }),
    /never sends/
  );
  assert.throws(
    () => generateFollowUp(LEAKY, { priorSubject: 'Your illegal tracking' }),
    /never sends/
  );
});

test('no generated string in any variant or tone carries banned language', () => {
  const scans = [LEAKY, NO_REJECT, GPC_ONLY,
    makeScan({
      cmp: [],
      baseline: [TRACKER.meta],
      findings: [FINDING.noCmp()],
      riskScore: 15,
    }),
    makeScan({
      baseline: [TRACKER.ga],
      findings: [FINDING.preConsent(['Google Analytics'])],
      riskScore: 5,
    }),
  ];

  for (const scan of scans) {
    for (const tone of ALL_TONES) {
      const message = generateOutreach(scan, { tone, company: 'Example Shop', senderName: 'A. N.' });
      assert.ok(message, `expected outreach for ${scan.findings[0].id}`);
      for (const copy of [message.subject, message.body, ...message.plainFacts]) {
        assert.deepEqual(findBannedPhrases(copy), [], `${scan.findings[0].id}/${tone}: ${copy}`);
      }
      assert.ok(countSentences(message.body) <= MAX_BODY_SENTENCES);

      const followUp = generateFollowUp(scan, { tone, priorSubject: message.subject });
      assert.deepEqual(findBannedPhrases(followUp.subject), []);
      assert.deepEqual(findBannedPhrases(followUp.body), []);
    }
  }
});

test('the follow-up restates the same fact and closes the thread', () => {
  const first = generateOutreach(LEAKY, { senderName: 'A. Ndiongue' });
  const followUp = generateFollowUp(LEAKY, {
    priorSubject: first.subject,
    senderName: 'A. Ndiongue',
  });

  assert.equal(followUp.subject, `Re: ${first.subject}`);
  assert.match(followUp.body, /Hotjar/);
  assert.match(followUp.body, /static\.hotjar\.com/);
  assert.match(followUp.body, /only follow-up/, 'the end of the thread must be stated');
  assert.match(followUp.body, /no reply is needed/i);
  assert.ok(countSentences(followUp.body) <= MAX_FOLLOW_UP_SENTENCES);
  assert.equal(MAX_FOLLOW_UP_SENTENCES, 3);
  assert.ok(countSentences(followUp.body) < countSentences(first.body));
});

test('the follow-up derives its own subject and never doubles the Re: prefix', () => {
  const derived = generateFollowUp(LEAKY, {});
  assert.match(derived.subject, /^Re: Hotjar request on shop\.example\.com/);

  const alreadyReplied = generateFollowUp(LEAKY, { priorSubject: 'Re: an earlier thread' });
  assert.equal(alreadyReplied.subject, 'Re: an earlier thread');
});

test('sentence counting is not fooled by dotted tokens or an initial', () => {
  assert.equal(countSentences('Meta Pixel sent a request to www.facebook.com/tr.'), 1);
  assert.equal(countSentences('Sec-GPC: 1 and navigator.globalPrivacyControl = true.'), 1);
  assert.equal(countSentences('One. Two. Three.'), 3);
  assert.equal(countSentences('— A. Ndiongue'), 0);
  assert.equal(countSentences(''), 0);
});
