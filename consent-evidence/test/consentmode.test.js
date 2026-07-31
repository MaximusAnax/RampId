/**
 * Regression tests for the consent-signal decoder.
 *
 * This module's job is to stop the engine reporting a request that already carries a
 * refusal, so the assertions that matter most are the ones proving a denial is recognised
 * and the ones proving an unreadable request stays 'unknown'. A decoder that quietly
 * resolves ambiguity into 'signalled-granted' would hand the report a fabricated fact.
 *
 * Fixture provenance: the TCF core segment and the three GPP headers are the literal
 * example strings printed in the IAB specifications. Everything else is assembled bit by
 * bit from the published field tables, in encodeFromBits below, so a future reader can
 * check each expectation against the spec without trusting this file.
 *
 * Run: npm test
 */

import { test } from 'node:test';
import assert from 'node:assert/strict';

import {
  CONSENT_STATUS,
  CONSENT_STATUS_MEANING,
  FRAMEWORK,
  assessTrackerRequest,
  decodeGcsParameter,
  decodeUsPrivacyString,
  detectPrivacyStrings,
  explainConsentSignals,
  parseConsentSignals,
  parseGppString,
  parseTcfString,
} from '../src/consentmode.js';

// ---------------------------------------------------------------------------
// Fixture construction
// ---------------------------------------------------------------------------

const URL_SAFE_BASE64 = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789-_';

/** Six bits per character, right-padded with zeros, exactly as both IAB specs require. */
function encodeFromBits(bits) {
  const padded = bits.padEnd(Math.ceil(bits.length / 6) * 6, '0');
  let out = '';
  for (let i = 0; i < padded.length; i += 6) {
    out += URL_SAFE_BASE64[Number.parseInt(padded.slice(i, i + 6), 2)];
  }
  return out;
}

function decodeToBits(segment) {
  let bits = '';
  for (const character of segment) {
    bits += URL_SAFE_BASE64.indexOf(character).toString(2).padStart(6, '0');
  }
  return bits;
}

const int = (value, width) => value.toString(2).padStart(width, '0');

/** The TC String printed as the worked example in the TCF v2 specification. */
const TCF_EXAMPLE =
  'CQSbk4AQSbk4ANwAAAENAwCgAAAAAAAAAAYgACPAAAAA.IDKQA4AAgAKAGQAygAAA.YAAAAAAAAAAA';

/** Same string with the Purpose 1 consent bit (core offset 152) flipped on. */
const TCF_PURPOSE_ONE_GRANTED = (() => {
  const [core, ...rest] = TCF_EXAMPLE.split('.');
  const bits = decodeToBits(core).split('');
  bits[152] = '1';
  return [encodeFromBits(bits.join('')), ...rest].join('.');
})();

/**
 * GPP header listing a single section. Type is fixed at 3, version 1, then a
 * Range(Fibonacci) of one single-ID item whose offset from zero is the section ID.
 */
const FIBONACCI_CODE = { 6: '1011', 7: '01011', 8: '000011', 9: '100011' };

function gppHeaderFor(sectionId) {
  return encodeFromBits(
    int(3, 6) + int(1, 6) + int(1, 12) + '0' + FIBONACCI_CODE[sectionId]
  );
}

/**
 * US-California core sub-section. Field order from the IAB California Privacy Technical
 * Specification: Version Int(6), SaleOptOutNotice Int(2), SharingOptOutNotice Int(2),
 * SensitiveDataLimitUseNotice Int(2), SaleOptOut Int(2), SharingOptOut Int(2), then the
 * sensitive-data bitfields this decoder deliberately does not read.
 *
 * Opt-out values: 0 not applicable, 1 opted out, 2 did not opt out.
 */
function uscaSection({ saleOptOut, sharingOptOut = 0, gpc = null, notices = 1 }) {
  const core = encodeFromBits(
    int(1, 6) + int(notices, 2) + int(notices, 2) + int(notices, 2) +
      int(saleOptOut, 2) + int(sharingOptOut, 2) +
      '0'.repeat(18) + '0'.repeat(4) + int(0, 2) + int(1, 2) + int(1, 2) + int(0, 2)
  );
  if (gpc === null) return core;
  // GPC sub-section: SubsectionType Int(2) = 1, then a single Boolean bit.
  return `${core}.${encodeFromBits('01' + (gpc ? '1' : '0'))}`;
}

const gppString = (sectionId, payload) => `${gppHeaderFor(sectionId)}~${payload}`;

const AD_PIXEL = { name: 'Google Ads / DoubleClick', category: 'ad-pixel' };
const ANALYTICS = { name: 'Google Analytics', category: 'analytics' };
const META_PIXEL = { name: 'Meta Pixel', category: 'ad-pixel' };
const SESSION_REPLAY = { name: 'Hotjar', category: 'session-replay' };

// ---------------------------------------------------------------------------
// Google Consent Mode
// ---------------------------------------------------------------------------

test('a Google request with gcs=G100 is recognised as carrying a denial', () => {
  const url = 'https://www.google-analytics.com/g/collect?v=2&tid=G-ABC&gcs=G100&gcd=13p3p3p2p1';
  const result = assessTrackerRequest(url, ANALYTICS);

  assert.equal(result.status, CONSENT_STATUS.DENIED);
  assert.equal(result.framework, FRAMEWORK.GOOGLE_CONSENT_MODE);
  assert.match(result.explanation, /analytics_storage/);
  assert.equal(parseConsentSignals(url).consentDenied, true);
});

test('a Google request with gcs=G111 is recognised as carrying a grant', () => {
  const url = 'https://stats.g.doubleclick.net/g/collect?v=2&tid=G-ABC&gcs=G111';
  const result = assessTrackerRequest(url, AD_PIXEL);

  assert.equal(result.status, CONSENT_STATUS.GRANTED);
  assert.equal(result.framework, FRAMEWORK.GOOGLE_CONSENT_MODE);
  assert.equal(parseConsentSignals(url).consentDenied, false);
});

test('a mixed gcs value is read against the storage type the tracker actually uses', () => {
  // G110: ad_storage granted, analytics_storage denied.
  const url = 'https://www.google-analytics.com/g/collect?v=2&gcs=G110';
  assert.equal(assessTrackerRequest(url, ANALYTICS).status, CONSENT_STATUS.DENIED);
  assert.equal(assessTrackerRequest(url, AD_PIXEL).status, CONSENT_STATUS.GRANTED);
});

test('a mixed gcs value tells a session-replay tool nothing, so it stays unknown', () => {
  // Consent Mode has no storage type covering session replay. Picking one of the two
  // digits for it would be inventing a signal Google never sent.
  const url = 'https://www.google-analytics.com/g/collect?v=2&gcs=G110';
  assert.equal(assessTrackerRequest(url, SESSION_REPLAY).status, CONSENT_STATUS.UNKNOWN);
});

test('gcs=G1-- means consent mode is present but unset, which is not a grant', () => {
  const url = 'https://www.google-analytics.com/g/collect?v=2&gcs=G1--';
  assert.equal(assessTrackerRequest(url, ANALYTICS).status, CONSENT_STATUS.UNKNOWN);
  assert.equal(parseConsentSignals(url).consentDenied, null);
});

test('gcs values outside the documented shape are rejected rather than guessed at', () => {
  assert.equal(decodeGcsParameter('G2001'), null);
  assert.equal(decodeGcsParameter('G1'), null);
  assert.equal(decodeGcsParameter(''), null);
  assert.equal(decodeGcsParameter(undefined), null);
});

test('the gcd parameter reports unconfigured signals but never decides consent', () => {
  // Only the letter 'l' - signal never configured - is agreed across sources. The rest of
  // the alphabet is reverse-engineered and the write-ups contradict each other, so gcd
  // alone must not move the verdict off unknown.
  const url = 'https://www.google-analytics.com/g/collect?v=2&gcd=11l1l1l1l5';
  const parsed = parseConsentSignals(url);

  assert.deepEqual(parsed.signals.googleConsentMode.signalsNotConfigured, [
    'adStorage',
    'analyticsStorage',
    'adUserData',
    'adPersonalization',
  ]);
  assert.equal(parsed.consentDenied, null);
  assert.equal(assessTrackerRequest(url, ANALYTICS).status, CONSENT_STATUS.UNKNOWN);

  const granted = parseConsentSignals('https://www.google-analytics.com/g/collect?gcd=11t1t1t1t5');
  assert.equal(granted.consentDenied, null, 'gcd letters must not be read as a consent state');
});

// ---------------------------------------------------------------------------
// Meta Limited Data Use
// ---------------------------------------------------------------------------

test('a Meta request carrying Limited Data Use is recognised as restricted', () => {
  const url = 'https://www.facebook.com/tr/?id=123&ev=PageView&dpo=LDU&dpoco=1&dpost=1000';
  const result = assessTrackerRequest(url, META_PIXEL);

  assert.equal(result.status, CONSENT_STATUS.DENIED);
  assert.equal(result.framework, FRAMEWORK.META_LIMITED_DATA_USE);
  assert.match(result.explanation, /California/);

  const signals = parseConsentSignals(url).signals.metaLimitedDataUse;
  assert.equal(signals.limitedDataUse, true);
  assert.equal(signals.countryLabel, 'United States');
  assert.equal(signals.stateLabel, 'California');
});

test('Limited Data Use with zeroed geography still counts as restricted', () => {
  const url = 'https://www.facebook.com/tr/?id=123&ev=PageView&dpo=LDU&dpoco=0&dpost=0';
  const signals = parseConsentSignals(url).signals.metaLimitedDataUse;

  assert.equal(signals.limitedDataUse, true);
  assert.equal(signals.stateLabel, 'auto-detected from IP');
  assert.equal(assessTrackerRequest(url, META_PIXEL).status, CONSENT_STATUS.DENIED);
});

test('absent Limited Data Use is not evidence of consent', () => {
  // LDU is a processing restriction, not a consent record. Its absence means no
  // restriction was asked for, which says nothing about what the visitor chose.
  const noParameter = 'https://www.facebook.com/tr/?id=123&ev=PageView';
  assert.equal(assessTrackerRequest(noParameter, META_PIXEL).status, CONSENT_STATUS.UNKNOWN);

  const emptyParameter = 'https://www.facebook.com/tr/?id=123&ev=PageView&dpo=&dpoco=0&dpost=0';
  const result = assessTrackerRequest(emptyParameter, META_PIXEL);
  assert.equal(result.status, CONSENT_STATUS.UNKNOWN);
  assert.equal(parseConsentSignals(emptyParameter).signals.metaLimitedDataUse.limitedDataUse, false);
});

test('a bare dpo parameter on an unrelated host is ignored unless it names LDU', () => {
  const collision = 'https://cdn.example.com/beacon?dpo=7';
  assert.deepEqual(parseConsentSignals(collision).frameworks, []);

  const explicit = 'https://cdn.example.com/beacon?dpo=LDU';
  assert.deepEqual(parseConsentSignals(explicit).frameworks, [FRAMEWORK.META_LIMITED_DATA_USE]);
});

// ---------------------------------------------------------------------------
// IAB US Privacy String
// ---------------------------------------------------------------------------

test('a US Privacy String recording an opt-out is decoded as an opt-out', () => {
  const decoded = decodeUsPrivacyString('1YYN');

  assert.equal(decoded.valid, true);
  assert.equal(decoded.version, 1);
  assert.equal(decoded.noticeGiven, true);
  assert.equal(decoded.optOutSale, true);
  assert.equal(decoded.lspaCovered, false);
  assert.equal(decoded.optedOut, true);

  const url = 'https://ct.pinterest.com/v3/?event=pagevisit&us_privacy=1YYN';
  const result = assessTrackerRequest(url, { name: 'Pinterest Tag', category: 'ad-pixel' });
  assert.equal(result.status, CONSENT_STATUS.DENIED);
  assert.equal(result.framework, FRAMEWORK.US_PRIVACY);
});

test('a US Privacy String with no opt-out is decoded as no opt-out', () => {
  const decoded = decodeUsPrivacyString('1YNN');

  assert.equal(decoded.valid, true);
  assert.equal(decoded.noticeGiven, true);
  assert.equal(decoded.optOutSale, false);
  assert.equal(decoded.optedOut, false);

  const url = 'https://ct.pinterest.com/v3/?event=pagevisit&us_privacy=1YNN';
  assert.equal(
    assessTrackerRequest(url, { name: 'Pinterest Tag', category: 'ad-pixel' }).status,
    CONSENT_STATUS.GRANTED
  );
});

test('1--- states the rules were judged not to apply, which is not a consent record', () => {
  const decoded = decodeUsPrivacyString('1---');

  assert.equal(decoded.valid, true);
  assert.equal(decoded.applies, false);
  assert.equal(decoded.optedOut, null);

  const url = 'https://ct.pinterest.com/v3/?event=pagevisit&us_privacy=1---';
  assert.equal(
    assessTrackerRequest(url, { name: 'Pinterest Tag', category: 'ad-pixel' }).status,
    CONSENT_STATUS.UNKNOWN
  );
});

test('the US Privacy sentence reports the notice character it actually read', () => {
  // The notice character is independent of the opt-out character. '1NNN' records notice NOT
  // given, and a report telling a client their string said otherwise is a fabricated fact
  // that the first engineer to decode it themselves will catch.
  const pinterest = { name: 'Pinterest Tag', category: 'ad-pixel' };

  const noticeNotGiven = assessTrackerRequest('https://ct.pinterest.com/v3/?us_privacy=1NNN', pinterest);
  assert.equal(noticeNotGiven.status, CONSENT_STATUS.GRANTED);
  assert.match(noticeNotGiven.explanation, /records notice not given/);

  const noticeUnknown = assessTrackerRequest('https://ct.pinterest.com/v3/?us_privacy=1-N-', pinterest);
  assert.match(noticeUnknown.explanation, /notice status not stated/);

  assert.match(
    assessTrackerRequest('https://ct.pinterest.com/v3/?us_privacy=1YNN', pinterest).explanation,
    /records notice given/
  );
});

test('a malformed US Privacy String is reported as unreadable, not as a grant', () => {
  for (const value of ['', 'YYN', '1YY', 'nonsense', null, undefined]) {
    const decoded = decodeUsPrivacyString(value);
    assert.equal(decoded.valid, false);
    assert.equal(decoded.optedOut, null);
  }
});

// ---------------------------------------------------------------------------
// IAB TCF v2
// ---------------------------------------------------------------------------

test('the TCF specification example string decodes to its published field values', () => {
  const tcf = parseTcfString(TCF_EXAMPLE);

  assert.equal(tcf.version, 2);
  assert.equal(tcf.consentLanguage, 'EN');
  assert.equal(tcf.publisherCountry, 'DE');
  assert.equal(tcf.cmpId, 880);
  assert.equal(tcf.vendorListVersion, 48);
  assert.deepEqual(tcf.consentedPurposes, []);
  assert.equal(tcf.deviceStorageConsent, false);
});

test('a TCF string without Purpose 1 consent is treated as a denial of device storage', () => {
  const url = `https://ads.example.net/px?gdpr=1&gdpr_consent=${TCF_EXAMPLE}`;
  const result = assessTrackerRequest(url, AD_PIXEL);

  assert.equal(result.status, CONSENT_STATUS.DENIED);
  assert.equal(result.framework, FRAMEWORK.TCF);
  assert.match(result.explanation, /Purpose 1/);
});

test('a TCF string granting Purpose 1 is read as a grant, with the vendor caveat stated', () => {
  const url = `https://ads.example.net/px?gdpr=1&gdpr_consent=${TCF_PURPOSE_ONE_GRANTED}`;
  const result = assessTrackerRequest(url, AD_PIXEL);

  assert.equal(result.status, CONSENT_STATUS.GRANTED);
  assert.deepEqual(parseTcfString(TCF_PURPOSE_ONE_GRANTED).consentedPurposes, [1]);
  assert.match(result.explanation, /Vendor-level consent was not decoded/);
});

test('a TCF string that cannot be decoded stays unknown', () => {
  const url = 'https://ads.example.net/px?gdpr=1&gdpr_consent=not-a-real-string';
  assert.equal(assessTrackerRequest(url, AD_PIXEL).status, CONSENT_STATUS.UNKNOWN);
  assert.equal(parseTcfString('BOfoo'), null, 'a v1 string is not a v2 string');
});

// ---------------------------------------------------------------------------
// IAB Global Privacy Platform
// ---------------------------------------------------------------------------

test('the GPP specification header examples decode to their published section lists', () => {
  assert.deepEqual(parseGppString('DBABM~x').sectionIds, [2]);
  assert.deepEqual(parseGppString('DBACNY~x~y').sectionIds, [2, 6]);
  assert.deepEqual(parseGppString('DBABjw~x~y').sectionIds, [5, 6], 'group range encoding');
  assert.deepEqual(parseGppString('DBABM~x').sectionNames, ['tcfeuv2']);
});

test('a GPP California section recording a sale opt-out is recognised as a denial', () => {
  const url = `https://ct.pinterest.com/v3/?us_privacy=1---&gpp=${gppString(8, uscaSection({ saleOptOut: 1 }))}&gpp_sid=8`;
  const result = assessTrackerRequest(url, { name: 'Pinterest Tag', category: 'ad-pixel' });

  assert.equal(result.status, CONSENT_STATUS.DENIED);
  assert.equal(result.framework, FRAMEWORK.GPP);
  assert.match(result.explanation, /usca/);
});

test('a GPP California section recording no opt-out is read as no opt-out', () => {
  // 2 is the spec's "Did Not Opt Out" value; 0 means the field is not applicable.
  const url = `https://ct.pinterest.com/v3/?gpp=${gppString(8, uscaSection({ saleOptOut: 2, sharingOptOut: 2 }))}`;
  assert.equal(
    assessTrackerRequest(url, { name: 'Pinterest Tag', category: 'ad-pixel' }).status,
    CONSENT_STATUS.GRANTED
  );
});

test('a Global Privacy Control flag inside a GPP string is recognised as a denial', () => {
  const section = uscaSection({ saleOptOut: 2, sharingOptOut: 2, gpc: true });
  const url = `https://ct.pinterest.com/v3/?gpp=${gppString(8, section)}`;
  const parsed = parseConsentSignals(url);

  assert.equal(parsed.signals.gpp.globalPrivacyControl, true);
  assert.equal(parsed.consentDenied, true);
});

test('a GPP section whose opt-out fields are all "not applicable" is not read as a grant', () => {
  // 0 is the spec's "Not Applicable", glossed as "the Business does not Sell Personal Data".
  // It records that the question never arose. Reading it as the visitor declining to opt out
  // would manufacture a consent state out of a section that states none.
  const url = `https://ct.pinterest.com/v3/?gpp=${gppString(8, uscaSection({ saleOptOut: 0, sharingOptOut: 0, notices: 0 }))}`;
  const parsed = parseConsentSignals(url);

  assert.equal(parsed.consentDenied, null);
  assert.equal(
    assessTrackerRequest(url, { name: 'Pinterest Tag', category: 'ad-pixel' }).status,
    CONSENT_STATUS.UNKNOWN
  );
  assert.ok(
    explainConsentSignals(parsed).detail.some((line) => /no opt-out choice was recorded/.test(line)),
    'the prose must not describe an absent choice as "no opt-out recorded"'
  );
});

test('a GPP section too short to hold its opt-out fields is undecoded, not a grant', () => {
  // Six bits is a version and nothing else. Every field read off it comes back null, which
  // must stay distinguishable from a section that recorded "did not opt out".
  const truncated = encodeFromBits(int(1, 6));
  const url = `https://ct.pinterest.com/v3/?gpp=${gppString(8, truncated)}`;
  const parsed = parseConsentSignals(url);

  assert.equal(parsed.signals.gpp.sections.usca.decoded, false);
  assert.equal(parsed.consentDenied, null);
  assert.equal(
    assessTrackerRequest(url, { name: 'Pinterest Tag', category: 'ad-pixel' }).status,
    CONSENT_STATUS.UNKNOWN
  );
});

test('a GPP section list large enough to exhaust the process is refused', () => {
  // Both the item count and each group run length are attacker-controlled and they multiply.
  // Before the ceiling, a few hundred characters of crafted input expanded into hundreds of
  // thousands of sections, and a few thousand characters took the scanner's process down.
  // The scanner reads these strings off pages it does not control, so this is load-bearing.
  const item = '1' + '11' + '0101010101010101' + '1';
  const hostile = encodeFromBits(int(3, 6) + int(1, 6) + int(4095, 12) + item.repeat(4095));

  const started = Date.now();
  const parsed = parseConsentSignals(`https://ct.pinterest.com/v3/?gpp=${hostile}`);

  assert.deepEqual(parsed.signals.gpp.sectionIds, []);
  assert.equal(parsed.consentDenied, null);
  assert.ok(Date.now() - started < 1000, 'decoding must not scale with the claimed section count');
  assert.equal(detectPrivacyStrings(`https://ct.pinterest.com/v3/?gpp=${hostile}`).gpp.decoded, false);
});

test('a GPP section whose layout is not verified is reported present but undecoded', () => {
  // Virginia (section 9) has its own field order. Reading it with California's offsets
  // would produce a confident wrong answer, so the section is named and left alone.
  const url = `https://ct.pinterest.com/v3/?gpp=${gppString(9, uscaSection({ saleOptOut: 1 }))}&gpp_sid=9`;
  const parsed = parseConsentSignals(url);

  assert.deepEqual(parsed.signals.gpp.sectionNames, ['usva']);
  assert.equal(parsed.signals.gpp.sections.usva.decoded, false);
  assert.equal(parsed.consentDenied, null, 'an undecoded section must not produce a verdict');
  assert.equal(
    assessTrackerRequest(url, { name: 'Pinterest Tag', category: 'ad-pixel' }).status,
    CONSENT_STATUS.UNKNOWN
  );
});

test('the presence detector reports unreadable framework strings rather than dropping them', () => {
  // A CMP emitting a malformed string looks identical to a site with no framework at all
  // unless presence is tracked separately from decodability.
  const detected = detectPrivacyStrings(
    'https://ads.example.net/px?gdpr=1&gdpr_consent=broken&gpp=broken&us_privacy=broken'
  );

  assert.equal(detected.tcf.present, true);
  assert.equal(detected.tcf.decoded, false);
  assert.equal(detected.gpp.present, true);
  assert.equal(detected.gpp.decoded, false);
  assert.equal(detected.usPrivacy.present, true);
  assert.equal(detected.usPrivacy.decoded, false);
  assert.equal(detected.gdprApplies, true);

  const clean = detectPrivacyStrings('https://static.hotjar.com/c/hotjar-1.js');
  assert.deepEqual(
    [clean.usPrivacy, clean.gpp, clean.tcf, clean.gdprApplies],
    [null, null, null, null]
  );

  // A URL the parser cannot read must return the same shape, so a caller reading a field off
  // the result gets null rather than undefined and cannot mistake one for a decoded value.
  assert.deepEqual(detectPrivacyStrings('not a url'), {
    usPrivacy: null,
    gpp: null,
    tcf: null,
    gdprApplies: null,
  });
});

// ---------------------------------------------------------------------------
// Conservatism guarantees
// ---------------------------------------------------------------------------

test('an ordinary tracker request with no consent parameters returns unknown', () => {
  const result = assessTrackerRequest('https://static.hotjar.com/c/hotjar-123.js?sv=7', SESSION_REPLAY);

  assert.equal(result.status, CONSENT_STATUS.UNKNOWN);
  assert.equal(result.framework, null);
  assert.match(result.explanation, /no consent-signalling parameter/);

  const parsed = parseConsentSignals('https://static.hotjar.com/c/hotjar-123.js?sv=7');
  assert.equal(parsed.consentDenied, null);
  assert.deepEqual(parsed.frameworks, []);
});

test('an unparseable URL returns unknown instead of throwing', () => {
  for (const value of ['', 'not a url', null, undefined]) {
    assert.equal(assessTrackerRequest(value, AD_PIXEL).status, CONSENT_STATUS.UNKNOWN);
    assert.equal(parseConsentSignals(value).consentDenied, null);
  }
});

test('conflicting frameworks resolve toward denial', () => {
  // Resolving the other way would let one permissive signal wave away an explicit opt-out
  // and put an accusation in the report on contested evidence.
  const url = 'https://ct.pinterest.com/v3/?gcs=G111&us_privacy=1YYN';
  const parsed = parseConsentSignals(url);

  assert.equal(parsed.consentDenied, true);
  assert.equal(parsed.framework, FRAMEWORK.US_PRIVACY);
  assert.equal(assessTrackerRequest(url, AD_PIXEL).status, CONSENT_STATUS.DENIED);
});

test('consent parameters inside a nested redirect URL are not attributed to the request', () => {
  const inner = encodeURIComponent('https://www.google-analytics.com/g/collect?gcs=G100');
  const parsed = parseConsentSignals(`https://redirector.example.com/r?url=${inner}`);

  assert.deepEqual(parsed.frameworks, []);
  assert.equal(parsed.consentDenied, null);
});

test('a tracker with no category metadata is still handled', () => {
  const url = 'https://ads.example.net/px?us_privacy=1YYN';
  assert.equal(assessTrackerRequest(url).status, CONSENT_STATUS.DENIED);
  assert.equal(assessTrackerRequest(url, null).status, CONSENT_STATUS.DENIED);
});

// ---------------------------------------------------------------------------
// Report copy
// ---------------------------------------------------------------------------

test('the plain-English explanation describes the signal without drawing a legal conclusion', () => {
  const url = 'https://www.google-analytics.com/g/collect?v=2&gcs=G100&gcd=11l1l1l1l5';
  const explained = explainConsentSignals(parseConsentSignals(url));

  assert.equal(explained.summary, 'This request told the receiving vendor that consent was refused.');
  assert.ok(explained.detail.some((line) => line.includes('advertising storage denied')));
  assert.ok(explained.detail.some((line) => line.includes('not configured')));
  assert.match(explained.caveat, /not what the visitor was shown or chose/);
});

test('no report copy in this module asserts legality, violation or exposure', () => {
  // Rule one of the product: record what was observed, never characterise it as unlawful.
  // Saying otherwise in a document sent to a company is practising law without a licence.
  const forbidden = /\b(illegal|unlawful|violat\w*|non-?compliant|liabilit\w*|you are in breach)\b/i;

  // Every URL below is chosen to reach a different branch of the prose, because a guard that
  // only walks the two easy paths proves nothing about the sentences a real scan emits.
  const urls = [
    'https://ads.example.net/px?us_privacy=1YYN',
    'https://ads.example.net/px?us_privacy=1NNN',
    'https://ads.example.net/px?us_privacy=1---',
    'https://ads.example.net/px?us_privacy=garbage',
    'https://www.facebook.com/tr/?dpo=LDU&dpoco=1&dpost=1000',
    'https://www.facebook.com/tr/?dpo=&dpoco=0&dpost=0',
    'https://www.facebook.com/tr/?dpo=unrecognised-value',
    'https://www.google-analytics.com/g/collect?gcs=G100&gcd=11l1l1l1l5',
    'https://www.google-analytics.com/g/collect?gcs=G111',
    'https://static.hotjar.com/c/hotjar-1.js',
    `https://ads.example.net/px?gdpr=1&gdpr_consent=${TCF_EXAMPLE}`,
    `https://ads.example.net/px?gdpr=1&gdpr_consent=${TCF_PURPOSE_ONE_GRANTED}`,
    'https://ads.example.net/px?gdpr=1&gdpr_consent=undecodable',
    `https://ct.pinterest.com/v3/?gpp=${gppString(8, uscaSection({ saleOptOut: 1 }))}`,
    `https://ct.pinterest.com/v3/?gpp=${gppString(8, uscaSection({ saleOptOut: 2, sharingOptOut: 2 }))}`,
    `https://ct.pinterest.com/v3/?gpp=${gppString(8, uscaSection({ saleOptOut: 0, sharingOptOut: 0, notices: 0 }))}`,
    `https://ct.pinterest.com/v3/?gpp=${gppString(8, uscaSection({ saleOptOut: 2, gpc: true }))}`,
    'https://ct.pinterest.com/v3/?gpp=undecodable',
  ];

  const copy = [
    ...Object.values(CONSENT_STATUS_MEANING),
    ...urls.flatMap((url) => {
      const parsed = parseConsentSignals(url);
      const explained = explainConsentSignals(parsed);
      return [
        explained.summary,
        explained.caveat,
        ...explained.detail,
        assessTrackerRequest(url, AD_PIXEL).explanation,
        assessTrackerRequest(url, META_PIXEL).explanation,
        assessTrackerRequest(url, SESSION_REPLAY).explanation,
      ];
    }),
  ];

  assert.ok(copy.length > 100, 'the guard must actually walk the prose branches');

  for (const line of copy) {
    assert.doesNotMatch(line, forbidden, `report copy must stay factual: ${line}`);
  }
});

test('every status has report-ready copy explaining what it does and does not establish', () => {
  for (const status of Object.values(CONSENT_STATUS)) {
    assert.equal(typeof CONSENT_STATUS_MEANING[status], 'string');
    assert.ok(CONSENT_STATUS_MEANING[status].length > 80);
  }
});
