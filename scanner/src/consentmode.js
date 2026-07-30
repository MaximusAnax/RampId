/**
 * Decoder for the consent signals a tracker request carries about itself.
 *
 * This module exists to stop the engine making false accusations, which is the single
 * failure mode the business cannot survive.
 *
 * A tracker request firing is not, on its own, evidence of anything. Google Consent Mode,
 * Meta Limited Data Use and the IAB frameworks are all designed so that a tag *still fires*
 * after the visitor refuses, and carries the refusal to the receiving vendor inside the
 * request. That is the intended, compliant behaviour of a correctly configured site. A
 * scanner that counts those requests as violations tells a company that did the work
 * properly that it did not - and there is no recovering from that in a sales conversation.
 *
 * So every request the engine is about to report gets asked one question first: does this
 * request advertise that consent was denied? Three answers only:
 *
 *   'signalled-denied'  - the request carries a denial. Do not present as a likely problem.
 *   'signalled-granted' - the request carries an affirmative consent state.
 *   'unknown'           - no recognised signal. This is the honest default and by far the
 *                         most common answer on real sites.
 *
 * 'unknown' is never upgraded to 'signalled-granted' by inference. An unreadable request is
 * unreadable, and saying so is the whole point.
 *
 * PARAMETER MEANINGS AND WHERE THEY WERE VERIFIED
 *
 *   gcs (Google Consent Mode)   format G1<ad_storage><analytics_storage>, 1 = granted,
 *       0 = denied. Verified against https://www.owntag.eu/blog/gsc-parameter/ and
 *       https://docs.cookiehub.com/advanced/consent-mode-v2-signals. Google documents the
 *       consent types themselves at
 *       https://developers.google.com/tag-platform/security/concepts/consent-mode but does
 *       not document the wire parameter in its public docs, but its own gtm.js builds the
 *       value as "G1" + ad_storage + analytics_storage and orders the same keys identically
 *       when building gcd, so the digit order is vendor-confirmed rather than merely
 *       community-established
 *       rather than vendor-stated. One secondary source reverses the two digits. See the
 *       note on decodeGcsParameter for why that disagreement cannot produce a false
 *       accusation here.
 *
 *   gcd (Google Consent Mode v2)  carries all four signals including ad_user_data and
 *       ad_personalization, encoded as letters rather than digits. Deliberately NOT used to
 *       derive a consent verdict - see parseGoogleConsentMode. Reference:
 *       https://www.giancampo.com/2024/02/understanding-new-gcd-parameter-in-ga4.html
 *
 *   dpo / dpoco / dpost (Meta Limited Data Use)  parameter names confirmed from observed
 *       facebook.com/tr traffic in https://github.com/MisterPhilip/omnibug/issues/124;
 *       semantics from Meta's own docs at
 *       https://developers.facebook.com/docs/meta-pixel/implementation/data-processing-options
 *       Country 0 = let Meta geolocate, 1 = United States. State 0 = geolocate,
 *       1000 = California, 1001 = Colorado, 1002 = Connecticut.
 *
 *   us_privacy (IAB US Privacy String)  four characters, {version}{notice}{opt-out sale}
 *       {LSPA}. Verified against the IAB Tech Lab specification text at
 *       https://github.com/InteractiveAdvertisingBureau/USPrivacy/blob/master/CCPA/US%20Privacy%20String.md
 *
 *   gdpr_consent / euconsent-v2 (IAB TCF v2)  bit offsets for the Core segment verified
 *       field-by-field against
 *       https://github.com/InteractiveAdvertisingBureau/GDPR-Transparency-and-Consent-Framework/blob/master/TCFv2/IAB%20Tech%20Lab%20-%20Consent%20string%20and%20vendor%20list%20formats%20v2.md
 *       and cross-checked by decoding that specification's own example string.
 *
 *   gpp / gpp_sid (IAB Global Privacy Platform)  header encoding, Fibonacci range encoding
 *       and section IDs verified against
 *       https://github.com/InteractiveAdvertisingBureau/Global-Privacy-Platform/blob/main/Core/Consent%20String%20Specification.md
 *       and https://github.com/InteractiveAdvertisingBureau/Global-Privacy-Platform/blob/main/Sections/Section%20Information.md
 *       The header decoder reproduces all three worked examples in that specification
 *       (DBABM, DBACNY, DBABjw).
 */

export const FRAMEWORK = {
  GOOGLE_CONSENT_MODE: 'google-consent-mode',
  META_LIMITED_DATA_USE: 'meta-limited-data-use',
  US_PRIVACY: 'iab-us-privacy',
  GPP: 'iab-gpp',
  TCF: 'iab-tcf-v2',
};

export const CONSENT_STATUS = {
  DENIED: 'signalled-denied',
  GRANTED: 'signalled-granted',
  UNKNOWN: 'unknown',
};

/**
 * Order used when a request carries several frameworks and none of them denies. Google and
 * Meta come first because their signals are tag-specific, where the IAB strings are a
 * page-wide broadcast that any tag may copy without acting on it.
 */
const FRAMEWORK_PRECEDENCE = [
  FRAMEWORK.GOOGLE_CONSENT_MODE,
  FRAMEWORK.META_LIMITED_DATA_USE,
  FRAMEWORK.GPP,
  FRAMEWORK.US_PRIVACY,
  FRAMEWORK.TCF,
];

// ---------------------------------------------------------------------------
// Bit-level helpers shared by the two IAB string formats.
// ---------------------------------------------------------------------------

/**
 * Both TCF and GPP pack fields into a bit string and then encode six bits per character.
 * TCF specifies URL-safe base64 ('-' and '_'); GPP's specification prints the RFC 4648
 * table ('+' and '/') while requiring URL-safe output. Accepting both alphabets costs two
 * map entries and removes a whole class of silent decode failure.
 */
const BASE64_ALPHABET = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/';
const BASE64_VALUES = new Map();
for (let i = 0; i < BASE64_ALPHABET.length; i += 1) BASE64_VALUES.set(BASE64_ALPHABET[i], i);
BASE64_VALUES.set('-', 62);
BASE64_VALUES.set('_', 63);

/** Returns a string of '0'/'1', or null if the segment contains anything unencodable. */
function toBitString(segment) {
  if (!segment) return null;
  let bits = '';
  for (const character of segment) {
    if (character === '=') break; // padding, if a producer emitted any
    const value = BASE64_VALUES.get(character);
    if (value === undefined) return null;
    bits += value.toString(2).padStart(6, '0');
  }
  return bits;
}

/** Fixed-width unsigned integer. Returns null rather than NaN when the field is truncated. */
function readInt(bits, start, length) {
  if (start < 0 || start + length > bits.length) return null;
  return Number.parseInt(bits.slice(start, start + length), 2);
}

/** Two-letter country/language code: each letter is six bits, A = 0. */
function readLetters(bits, start, count) {
  let out = '';
  for (let i = 0; i < count; i += 1) {
    const value = readInt(bits, start + i * 6, 6);
    if (value === null || value > 25) return null;
    out += String.fromCharCode(65 + value);
  }
  return out;
}

const FIBONACCI = [1, 2, 3, 5, 8, 13, 21, 34, 55, 89, 144, 233, 377, 610, 987, 1597];

/**
 * Fibonacci-coded integer, terminated by the second of two consecutive set bits.
 * Returns null on truncation or on a code word longer than the table, which is far past
 * any legitimate GPP section ID.
 */
function readFibonacci(bits, start) {
  let value = 0;
  for (let i = start; i < bits.length; i += 1) {
    if (bits[i] === '1') {
      if (i > start && bits[i - 1] === '1') return { value, next: i + 1 };
      const position = i - start;
      if (position >= FIBONACCI.length) return null;
      value += FIBONACCI[position];
    }
  }
  return null;
}

/**
 * Range(Fibonacci): a 12-bit count, then per item a group flag, an offset from the last
 * emitted ID, and for groups a run length. Used by the GPP header to list its sections.
 *
 * `limit` is a hard ceiling on how many IDs may be produced, and it is a safety control
 * rather than a tuning knob. Both the item count and each group's run length come out of a
 * string this scanner read off a page it does not control, and they multiply: a few hundred
 * characters of crafted or corrupt input expands into millions of entries and exhausts the
 * process. Nothing legitimate comes near the ceiling, so exceeding it is treated as an
 * undecodable string.
 */
function readFibonacciRange(bits, start, limit) {
  const amount = readInt(bits, start, 12);
  if (amount === null || amount > limit) return null;

  const ids = [];
  let cursor = start + 12;
  let last = 0;

  for (let item = 0; item < amount; item += 1) {
    if (cursor >= bits.length) return null;
    const isGroup = bits[cursor] === '1';
    cursor += 1;

    const offset = readFibonacci(bits, cursor);
    if (!offset) return null;
    cursor = offset.next;
    const first = last + offset.value;

    if (isGroup) {
      const length = readFibonacci(bits, cursor);
      if (!length) return null;
      cursor = length.next;
      if (ids.length + length.value + 1 > limit) return null;
      for (let id = first; id <= first + length.value; id += 1) ids.push(id);
      last = first + length.value;
    } else {
      if (ids.length + 1 > limit) return null;
      ids.push(first);
      last = first;
    }
  }

  return { ids, next: cursor };
}

// ---------------------------------------------------------------------------
// IAB US Privacy String
// ---------------------------------------------------------------------------

const US_PRIVACY_CHARACTER = { Y: true, N: false, '-': null };

/**
 * Decode a US Privacy String such as '1YNN' or '1YYN'.
 *
 * Character 3 is the one that matters commercially: 'Y' means the visitor has opted out of
 * the sale of their personal information. '1---' is the publisher stating it determined the
 * visitor is outside a US privacy jurisdiction, which is a claim about scope and not a
 * consent record - so it decodes to applies: false and optedOut: null, never to a grant.
 *
 * Spec: https://github.com/InteractiveAdvertisingBureau/USPrivacy/blob/master/CCPA/US%20Privacy%20String.md
 */
export function decodeUsPrivacyString(value) {
  const raw = typeof value === 'string' ? value.trim() : '';

  if (!/^[0-9][YN-]{3}$/i.test(raw)) {
    return {
      valid: false,
      raw: raw || null,
      version: null,
      noticeGiven: null,
      optOutSale: null,
      lspaCovered: null,
      applies: null,
      optedOut: null,
    };
  }

  const upper = raw.toUpperCase();
  const noticeGiven = US_PRIVACY_CHARACTER[upper[1]];
  const optOutSale = US_PRIVACY_CHARACTER[upper[2]];
  const lspaCovered = US_PRIVACY_CHARACTER[upper[3]];

  // The spec permits a hyphen in position 3 only where CCPA does not apply, so all-hyphens
  // is the documented way of saying "out of scope" rather than "no opt-out recorded".
  const applies = !(noticeGiven === null && optOutSale === null && lspaCovered === null);

  return {
    valid: true,
    raw: upper,
    version: Number(upper[0]),
    noticeGiven,
    optOutSale,
    lspaCovered,
    applies,
    optedOut: optOutSale === true ? true : optOutSale === false ? false : null,
  };
}

// ---------------------------------------------------------------------------
// IAB TCF v2
// ---------------------------------------------------------------------------

/**
 * Core segment field offsets, in bits, taken directly from the TCF v2 specification table.
 * Version 6, Created 36, LastUpdated 36, CmpId 12, CmpVersion 12, ConsentScreen 6,
 * ConsentLanguage 12, VendorListVersion 12, TcfPolicyVersion 6, IsServiceSpecific 1,
 * UseNonStandardTexts 1, SpecialFeatureOptIns 12, PurposesConsent 24.
 */
const TCF_PURPOSES_CONSENT_OFFSET = 152;
const TCF_PURPOSES_LI_OFFSET = 176;
const TCF_CORE_MINIMUM_BITS = 213;

/**
 * Purpose 1 is "Store and/or access information on a device". It is the purpose every
 * tracker in this engine's corpus needs, so it is the one the assessment keys on. Purposes
 * are 1-indexed in the framework and 0-indexed in the bit field.
 */
const TCF_PURPOSE_DEVICE_STORAGE = 1;

/**
 * Best-effort TC String decode. Only the Core segment is read: the vendor consent section
 * that follows uses range or bitfield encoding chosen at write time, and reading it wrongly
 * would be worse than not reading it. Purpose-level consent is enough to answer the only
 * question this module asks.
 */
export function parseTcfString(value) {
  const raw = typeof value === 'string' ? value.trim() : '';
  if (!raw) return null;

  // Segments are joined on a dot; the Core segment is always first.
  const bits = toBitString(raw.split('.')[0]);
  if (!bits || bits.length < TCF_CORE_MINIMUM_BITS) return null;

  const version = readInt(bits, 0, 6);
  if (version !== 2) return null;

  const purposeConsents = [];
  const purposeLegitimateInterests = [];
  for (let i = 0; i < 24; i += 1) {
    purposeConsents.push(bits[TCF_PURPOSES_CONSENT_OFFSET + i] === '1');
    purposeLegitimateInterests.push(bits[TCF_PURPOSES_LI_OFFSET + i] === '1');
  }

  return {
    raw,
    version,
    lastUpdated: (() => {
      const deciseconds = readInt(bits, 42, 36);
      return deciseconds === null ? null : new Date(deciseconds * 100).toISOString();
    })(),
    cmpId: readInt(bits, 78, 12),
    consentLanguage: readLetters(bits, 108, 2),
    vendorListVersion: readInt(bits, 120, 12),
    policyVersion: readInt(bits, 132, 6),
    publisherCountry: readLetters(bits, 201, 2),
    purposeConsents,
    purposeLegitimateInterests,
    deviceStorageConsent: purposeConsents[TCF_PURPOSE_DEVICE_STORAGE - 1],
    consentedPurposes: purposeConsents
      .map((granted, index) => (granted ? index + 1 : null))
      .filter((n) => n !== null),
  };
}

// ---------------------------------------------------------------------------
// IAB Global Privacy Platform
// ---------------------------------------------------------------------------

/** Section IDs from the GPP specification's section table. */
export const GPP_SECTIONS = {
  1: 'tcfeuv1',
  2: 'tcfeuv2',
  3: 'header',
  4: 'signal-integrity',
  5: 'tcfcav1',
  6: 'uspv1',
  7: 'usnat',
  8: 'usca',
  9: 'usva',
  10: 'usco',
  11: 'usut',
  12: 'usct',
  13: 'usfl',
  14: 'usmt',
  15: 'usor',
  16: 'ustx',
  17: 'usde',
  18: 'usia',
  19: 'usne',
  20: 'usnh',
  21: 'usnj',
  22: 'ustn',
  23: 'usmn',
  24: 'usmd',
  25: 'usin',
  26: 'usky',
  27: 'usri',
};

const GPP_HEADER_TYPE = 3;

/**
 * The specification registers 27 sections and a string carries at most one of each. The
 * ceiling is deliberately loose enough to survive new registrations and still refuse the
 * kind of section list that only a corrupt or hostile string produces.
 */
const GPP_MAX_SECTIONS = 64;

/**
 * Opt-out field offsets for the two sections whose Core layout was read directly from the
 * IAB specs. Every other US state section has its own field order, and guessing at them
 * would produce confident nonsense - so they are reported as present and left undecoded.
 *
 * Values in all three fields: 0 = not applicable, 1 = opted out, 2 = did not opt out.
 *
 * 0 is not a consumer choice. The specification glosses it as "the Business does not Sell
 * Personal Data", which records that the question never arose - so it decodes to null, the
 * same as a field that could not be read at all, and only an explicit 2 counts as the
 * consumer declining to opt out.
 */
const GPP_OPT_OUT_LAYOUTS = {
  // MSPA US National: Version(6) SharingNotice SaleOptOutNotice SharingOptOutNotice
  // TargetedAdvertisingOptOutNotice SensitiveDataProcessingOptOutNotice
  // SensitiveDataLimitUseNotice, then the three opt-out fields, all Int(2).
  usnat: { saleOptOut: 18, sharingOptOut: 20, targetedAdvertisingOptOut: 22 },
  // California: Version(6) SaleOptOutNotice SharingOptOutNotice SensitiveDataLimitUseNotice,
  // then SaleOptOut and SharingOptOut. There is no targeted-advertising field.
  usca: { saleOptOut: 12, sharingOptOut: 14 },
};

const GPP_SUBSECTION_GPC = 1;

function decodeGppSection(name, payload) {
  // Sub-sections inside one GPP section are dot-separated; the Core sub-section is first.
  const subsections = payload.split('.');
  const coreBits = toBitString(subsections[0]);
  if (!coreBits) return null;

  const section = {
    name,
    version: readInt(coreBits, 0, 6),
    optOuts: null,
    fieldsRead: 0,
    globalPrivacyControl: null,
  };

  const layout = GPP_OPT_OUT_LAYOUTS[name];
  if (layout) {
    const optOuts = {};
    for (const [field, offset] of Object.entries(layout)) {
      const value = readInt(coreBits, offset, 2);
      // A truncated section returns null here. Counting how many fields actually carried a
      // value is what keeps "this section says nothing" distinguishable from "this section
      // says nobody opted out" further down.
      if (value !== null) section.fieldsRead += 1;
      optOuts[field] = value === 1 ? true : value === 2 ? false : null;
    }
    section.optOuts = optOuts;
  }

  // The US state sections carry an optional GPC sub-section: SubsectionType Int(2) where
  // 1 = GPC, then a single bit, 1 = GPC is set. This is the only place a Global Privacy
  // Control signal survives into a URL, since the header form of it never leaves the browser.
  for (const subsection of subsections.slice(1)) {
    const bits = toBitString(subsection);
    if (!bits || bits.length < 3) continue;
    if (readInt(bits, 0, 2) === GPP_SUBSECTION_GPC) section.globalPrivacyControl = bits[2] === '1';
  }

  return section;
}

/**
 * Best-effort GPP decode: always tells you whether a GPP string is present and which
 * jurisdictions it covers, and decodes the opt-out fields for the two sections whose
 * layout was verified. Anything else is reported as present-but-undecoded rather than
 * guessed at.
 */
export function parseGppString(value) {
  const raw = typeof value === 'string' ? value.trim() : '';
  if (!raw) return null;

  const parts = raw.split('~');
  const headerBits = toBitString(parts[0]);
  if (!headerBits || headerBits.length < 24) return null;
  if (readInt(headerBits, 0, 6) !== GPP_HEADER_TYPE) return null;

  const range = readFibonacciRange(headerBits, 12, GPP_MAX_SECTIONS);
  const sectionIds = range ? range.ids : [];

  const sections = {};
  let globalPrivacyControl = null;

  sectionIds.forEach((id, index) => {
    const name = GPP_SECTIONS[id] ?? `section-${id}`;
    const payload = parts[index + 1];
    if (!payload) {
      sections[name] = { name, decoded: false };
      return;
    }
    // The TCF section carries a plain TC String rather than GPP field encoding.
    if (name === 'tcfeuv2') {
      const tcf = parseTcfString(payload);
      sections[name] = tcf ? { name, decoded: true, tcf } : { name, decoded: false };
      return;
    }
    const decoded = decodeGppSection(name, payload);
    sections[name] = decoded
      ? { ...decoded, decoded: decoded.fieldsRead > 0 }
      : { name, decoded: false };
    if (decoded?.globalPrivacyControl === true) globalPrivacyControl = true;
    else if (decoded?.globalPrivacyControl === false && globalPrivacyControl === null) {
      globalPrivacyControl = false;
    }
  });

  return {
    raw,
    version: readInt(headerBits, 6, 6),
    sectionIds,
    sectionNames: sectionIds.map((id) => GPP_SECTIONS[id] ?? `section-${id}`),
    sections,
    globalPrivacyControl,
  };
}

// ---------------------------------------------------------------------------
// Google Consent Mode
// ---------------------------------------------------------------------------

/**
 * Decode the gcs parameter: 'G1' followed by ad_storage then analytics_storage, each
 * '1' granted, '0' denied, '-' not set.
 *
 * On the digit order: one secondary source reverses ad_storage and analytics_storage. That
 * disagreement is contained here on purpose. The two unambiguous values - G100 (both
 * denied) and G111 (both granted) - read the same under either convention, and they are by
 * far the most common values in the wild. For the mixed values G101 and G110, reading the
 * order backwards moves a correctly-restrained service into the reportable set on mixed
 * values such as G101 and G110 — a false accusation, not the harmless over- or
 * under-suppression an earlier version of this comment claimed. The order is therefore
 * failure this module exists to prevent.
 */
export function decodeGcsParameter(value) {
  const raw = typeof value === 'string' ? value.trim() : '';
  if (!/^G1[01-]{2}$/.test(raw)) return null;

  const state = (character) => (character === '1' ? true : character === '0' ? false : null);
  return { raw, adStorage: state(raw[2]), analyticsStorage: state(raw[3]) };
}

/**
 * The gcd parameter positions four letters, one per consent signal, in the order
 * ad_storage, analytics_storage, ad_user_data, ad_personalization.
 *
 * Only one letter is used here. 'l' means the signal was never configured with Consent
 * Mode at all, and that reading is consistent across every source found. The rest of the
 * alphabet ('p', 'q', 'r', 't', 'u', 'v', 'm', 'n') encodes both the consent state and how
 * it was reached, is not documented by Google, and the available write-ups contradict each
 * other on which letters mean granted - two sources place 'q' and 'u' on opposite sides.
 *
 * Rather than pick a side, this decoder reports the raw letters and refuses to derive a
 * consent verdict from them. An unresolved disagreement in a public blog post is not a
 * basis for telling a company what its website did.
 */
const GCD_SIGNAL_ORDER = ['adStorage', 'analyticsStorage', 'adUserData', 'adPersonalization'];
const GCD_NOT_CONFIGURED = 'l';

export function decodeGcdParameter(value) {
  const raw = typeof value === 'string' ? value.trim() : '';
  const letters = raw.match(/[a-z]/g);
  if (!letters || letters.length < GCD_SIGNAL_ORDER.length) return null;

  const signalLetters = {};
  const notConfigured = [];
  GCD_SIGNAL_ORDER.forEach((signal, index) => {
    const letter = letters[index];
    signalLetters[signal] = letter;
    if (letter === GCD_NOT_CONFIGURED) notConfigured.push(signal);
  });

  return { raw, signalLetters, notConfigured };
}

function parseGoogleConsentMode(params) {
  const gcs = decodeGcsParameter(params.get('gcs'));
  const gcd = decodeGcdParameter(params.get('gcd'));
  if (!gcs && !gcd) return null;

  return {
    gcs: gcs?.raw ?? null,
    gcd: gcd?.raw ?? null,
    adStorage: gcs?.adStorage ?? null,
    analyticsStorage: gcs?.analyticsStorage ?? null,
    signalsNotConfigured: gcd?.notConfigured ?? [],
    gcdSignalLetters: gcd?.signalLetters ?? null,
  };
}

// ---------------------------------------------------------------------------
// Meta Limited Data Use
// ---------------------------------------------------------------------------

const META_HOSTS = ['facebook.com', 'facebook.net', 'fb.com', 'meta.com', 'fbcdn.net'];

const META_LDU_COUNTRIES = { 0: 'auto-detected from IP', 1: 'United States' };
const META_LDU_STATES = {
  0: 'auto-detected from IP',
  1000: 'California',
  1001: 'Colorado',
  1002: 'Connecticut',
};

/**
 * Limited Data Use restricts Meta to processing the event as a service provider: no
 * retargeting, no custom audiences, no profile building. It is a processing restriction,
 * not a consent record, and the distinction matters. LDU absent does not mean the visitor
 * consented - it means no restriction was requested - so the absent case resolves to
 * unknown rather than to granted.
 *
 * `dpo` is only three characters and could collide on an unrelated host, so it is accepted
 * either on a Meta host or when the value is literally 'LDU'.
 */
function parseMetaLimitedDataUse(params, hostname) {
  if (!params.has('dpo')) return null;

  const raw = (params.get('dpo') || '').trim();
  const onMetaHost = META_HOSTS.some((host) => hostname === host || hostname.endsWith(`.${host}`));
  const declaresLdu = /\bLDU\b/i.test(raw);
  if (!onMetaHost && !declaresLdu) return null;

  const asNumber = (name) => {
    const value = params.get(name);
    if (value === null || value.trim() === '') return null;
    const parsed = Number(value);
    return Number.isFinite(parsed) ? parsed : null;
  };

  const country = asNumber('dpoco');
  const state = asNumber('dpost');

  return {
    limitedDataUse: declaresLdu,
    raw: raw || null,
    country,
    state,
    countryLabel: country === null ? null : META_LDU_COUNTRIES[country] ?? `country code ${country}`,
    stateLabel: state === null ? null : META_LDU_STATES[state] ?? `state code ${state}`,
  };
}

// ---------------------------------------------------------------------------
// Request-level parsing
// ---------------------------------------------------------------------------

/**
 * Parameter aliases seen in the wild. The IAB specifies `us_privacy`; several tag vendors
 * ship the unpunctuated form, and the TCF string travels under both its URL macro name and
 * its cookie name.
 */
const US_PRIVACY_PARAMS = ['us_privacy', 'usprivacy', 'us_privacy_string', 'uspString'];
const TCF_PARAMS = ['gdpr_consent', 'euconsent-v2', 'euconsent'];

function firstParam(params, names) {
  for (const name of names) {
    const value = params.get(name);
    if (value !== null && value.trim() !== '') return value;
  }
  return null;
}

/**
 * Presence detector for the IAB framework strings on a request, without committing to a
 * consent verdict. Useful on its own for methodology reporting: "the page broadcasts a GPP
 * string covering California" is a fact worth stating even when nothing can be concluded
 * from it.
 *
 * Query parsing is deliberately limited to top-level parameters. Redirect-style trackers
 * carry whole encoded URLs in their query, and reading a consent string out of a nested URL
 * would attribute one vendor's signal to another's request.
 */
export function detectPrivacyStrings(requestUrl) {
  let params;
  try {
    params = new URL(requestUrl).searchParams;
  } catch {
    return { usPrivacy: null, gpp: null, tcf: null, gdprApplies: null };
  }

  const usPrivacyRaw = firstParam(params, US_PRIVACY_PARAMS);
  const gppRaw = params.get('gpp');
  const tcfRaw = firstParam(params, TCF_PARAMS);

  const usPrivacy = usPrivacyRaw ? decodeUsPrivacyString(usPrivacyRaw) : null;
  const gpp = gppRaw ? parseGppString(gppRaw) : null;
  const tcf = tcfRaw ? parseTcfString(tcfRaw) : null;

  return {
    // A present-but-unreadable string is reported as present. Silently dropping it would
    // let a malformed CMP output look identical to a site with no framework at all.
    usPrivacy: usPrivacyRaw ? { present: true, decoded: usPrivacy?.valid === true, ...(usPrivacy ?? {}) } : null,
    // A GPP header that parses but lists no readable section has not been decoded in any
    // sense the caller can use, so it is reported the same way as one that failed outright.
    gpp: gppRaw
      ? { present: true, decoded: (gpp?.sectionIds?.length ?? 0) > 0, ...(gpp ?? { raw: gppRaw }) }
      : null,
    tcf: tcfRaw ? { present: true, decoded: tcf !== null, ...(tcf ?? { raw: tcfRaw }) } : null,
    gdprApplies: params.has('gdpr') ? params.get('gdpr') === '1' : null,
  };
}

/**
 * Per-framework verdict. true = the request advertises a denial, false = it advertises an
 * affirmative state, null = the framework is present but says nothing conclusive.
 */
function verdictForGoogle(googleSignals) {
  const { adStorage, analyticsStorage } = googleSignals;
  if (adStorage === false || analyticsStorage === false) return true;
  if (adStorage === true && analyticsStorage === true) return false;
  return null;
}

function verdictForGpp(gpp) {
  if (gpp.globalPrivacyControl === true) return true;

  let sawAffirmative = false;
  for (const section of Object.values(gpp.sections)) {
    if (section.tcf) {
      if (section.tcf.deviceStorageConsent === false) return true;
      sawAffirmative = true;
      continue;
    }
    if (!section.optOuts) continue;
    const recorded = Object.values(section.optOuts);
    if (recorded.some((optedOut) => optedOut === true)) return true;
    if (recorded.some((optedOut) => optedOut === false)) sawAffirmative = true;
  }

  // Only an explicit "did not opt out" makes this affirmative. Applying the layout to a
  // section is not the same as reading a choice out of it: a truncated section, and one
  // whose every field is the spec's "not applicable", both leave nothing but nulls behind.
  // Treating either as a grant would turn "unreadable" into "the visitor agreed", which is
  // the inference this module exists to refuse.
  return sawAffirmative ? false : null;
}

/**
 * Read every consent-signalling parameter a request carries.
 *
 * `consentDenied` is true when any recognised framework on the request carries a denial.
 * Conflicting frameworks resolve toward denial on purpose: the consequence of resolving
 * toward denial is that the engine keeps quiet about a request, and the consequence of
 * resolving the other way is that it accuses a company on contested evidence.
 *
 * Note the deliberate difference from assessTrackerRequest. This function answers "does the
 * request carry any denial at all", so a mixed Consent Mode value such as gcs=G101 reads as
 * denied here. assessTrackerRequest answers the narrower and more useful question, "does it
 * deny the thing this particular tracker does", and reads the digit that governs that
 * tracker. The two can disagree on mixed values, and that is correct rather than a bug.
 *
 * @param {string} requestUrl
 * @returns {{framework: string|null, frameworks: string[], signals: object,
 *            consentDenied: boolean|null, raw: object}}
 */
export function parseConsentSignals(requestUrl) {
  const empty = { framework: null, frameworks: [], signals: {}, consentDenied: null, raw: {} };

  let url;
  try {
    url = new URL(requestUrl);
  } catch {
    return empty;
  }

  const params = url.searchParams;
  const signals = {};
  const raw = {};
  const verdicts = new Map();

  const google = parseGoogleConsentMode(params);
  if (google) {
    signals.googleConsentMode = google;
    if (google.gcs) raw.gcs = google.gcs;
    if (google.gcd) raw.gcd = google.gcd;
    verdicts.set(FRAMEWORK.GOOGLE_CONSENT_MODE, verdictForGoogle(google));
  }

  const meta = parseMetaLimitedDataUse(params, url.hostname.toLowerCase());
  if (meta) {
    signals.metaLimitedDataUse = meta;
    raw.dpo = meta.raw;
    if (meta.country !== null) raw.dpoco = String(meta.country);
    if (meta.state !== null) raw.dpost = String(meta.state);
    // LDU present means restricted; LDU absent means unrestricted, which is not a grant.
    verdicts.set(FRAMEWORK.META_LIMITED_DATA_USE, meta.limitedDataUse ? true : null);
  }

  const usPrivacyRaw = firstParam(params, US_PRIVACY_PARAMS);
  if (usPrivacyRaw) {
    const usPrivacy = decodeUsPrivacyString(usPrivacyRaw);
    signals.usPrivacy = usPrivacy;
    raw.us_privacy = usPrivacyRaw;
    verdicts.set(FRAMEWORK.US_PRIVACY, usPrivacy.valid ? usPrivacy.optedOut : null);
  }

  const gppRaw = params.get('gpp');
  if (gppRaw) {
    const gpp = parseGppString(gppRaw);
    signals.gpp = gpp ?? { raw: gppRaw, decoded: false };
    raw.gpp = gppRaw;
    if (params.get('gpp_sid')) raw.gpp_sid = params.get('gpp_sid');
    verdicts.set(FRAMEWORK.GPP, gpp ? verdictForGpp(gpp) : null);
  }

  const tcfRaw = firstParam(params, TCF_PARAMS);
  if (tcfRaw) {
    const tcf = parseTcfString(tcfRaw);
    signals.tcf = tcf ?? { raw: tcfRaw, decoded: false };
    raw.gdpr_consent = tcfRaw;
    if (params.has('gdpr')) raw.gdpr = params.get('gdpr');
    // A readable TC String with Purpose 1 unset is a denial of device storage, which every
    // tracker in the corpus needs. An unreadable one says nothing.
    verdicts.set(FRAMEWORK.TCF, tcf ? tcf.deviceStorageConsent !== true : null);
  }

  if (verdicts.size === 0) return empty;

  const frameworks = FRAMEWORK_PRECEDENCE.filter((name) => verdicts.has(name));
  const denying = frameworks.filter((name) => verdicts.get(name) === true);
  const granting = frameworks.filter((name) => verdicts.get(name) === false);

  const consentDenied = denying.length ? true : granting.length ? false : null;
  const framework = denying[0] ?? granting[0] ?? frameworks[0] ?? null;

  return { framework, frameworks, signals, consentDenied, raw };
}

// ---------------------------------------------------------------------------
// Tracker-level assessment
// ---------------------------------------------------------------------------

/**
 * Which Google Consent Mode storage type governs a given tracker. Categories cover both
 * the curated corpus in trackers.js ('ad-pixel', 'analytics', 'session-replay') and the
 * broader third-party-web categories used by entities.js.
 */
const ADVERTISING_CATEGORIES = new Set(['ad-pixel', 'ad', 'social', 'marketing']);
const ANALYTICS_CATEGORIES = new Set(['analytics', 'tag-manager']);

function purposeForCategory(category) {
  if (ADVERTISING_CATEGORIES.has(category)) return 'advertising';
  if (ANALYTICS_CATEGORIES.has(category)) return 'analytics';
  return 'other';
}

/**
 * The Consent Mode storage state that governs this tracker, as true (granted), false
 * (denied) or null (nothing conclusive).
 *
 * Consent Mode has no storage type covering session replay or customer-success tooling, so
 * for those the only readable answer is a blanket state across both types. Reading a mixed
 * gcs value as if it applied to them would be inventing a signal Google never sent.
 */
function googleStateForPurpose({ adStorage, analyticsStorage }, purpose) {
  if (purpose === 'advertising') return adStorage;
  if (purpose === 'analytics') return analyticsStorage;
  if (adStorage === false && analyticsStorage === false) return false;
  if (adStorage === true && analyticsStorage === true) return true;
  return null;
}

/**
 * Decide whether a single tracker request should be presented as a likely problem.
 *
 * This is the gate every reported request passes through. 'signalled-denied' means the
 * request itself carries a refusal, so the tag firing is the documented behaviour of a
 * working consent setup rather than evidence of a failure.
 *
 * @param {string} requestUrl
 * @param {{name?: string, category?: string}} [trackerMeta]  as produced by
 *        classifyRequest() in entities.js or an entry from TRACKERS in trackers.js
 * @returns {{status: string, explanation: string, framework: string|null, signals: object}}
 */
export function assessTrackerRequest(requestUrl, trackerMeta = {}) {
  const parsed = parseConsentSignals(requestUrl);
  const label = trackerMeta?.name ?? 'This request';
  const purpose = purposeForCategory(trackerMeta?.category);

  if (!parsed.frameworks.length) {
    return {
      status: CONSENT_STATUS.UNKNOWN,
      explanation:
        `${label} carried no consent-signalling parameter that this scanner recognises, so ` +
        'the request does not state what consent it was sent under.',
      framework: null,
      signals: parsed.signals,
    };
  }

  const denials = [];
  const grants = [];

  const google = parsed.signals.googleConsentMode;
  if (google) {
    const relevant = googleStateForPurpose(google, purpose);
    const storageName =
      purpose === 'analytics'
        ? 'analytics_storage'
        : purpose === 'advertising'
          ? 'ad_storage'
          : 'both ad_storage and analytics_storage';

    if (relevant === false || relevant === true) {
      const sentence =
        `${label} carried Google Consent Mode parameter gcs=${google.gcs}, which tells Google ` +
        `that consent for ${storageName} was ${relevant ? 'granted' : 'denied'} for this hit.`;
      (relevant ? grants : denials).push({
        framework: FRAMEWORK.GOOGLE_CONSENT_MODE,
        text: sentence,
      });
    }
  }

  const meta = parsed.signals.metaLimitedDataUse;
  if (meta?.limitedDataUse) {
    const where = meta.stateLabel ? ` Jurisdiction sent as ${meta.stateLabel}.` : '';
    denials.push({
      framework: FRAMEWORK.META_LIMITED_DATA_USE,
      text:
        `${label} carried Meta's Limited Data Use flag (dpo=LDU), which asks Meta to process ` +
        `the event as a service provider only - no custom audiences and no retargeting.${where}`,
    });
  }

  const usPrivacy = parsed.signals.usPrivacy;
  if (usPrivacy?.valid && usPrivacy.optedOut === true) {
    denials.push({
      framework: FRAMEWORK.US_PRIVACY,
      text:
        `${label} carried US Privacy String ${usPrivacy.raw}, whose third character records ` +
        'that the visitor opted out of the sale of their personal information.',
    });
  } else if (usPrivacy?.valid && usPrivacy.optedOut === false) {
    // The notice character is independent of the opt-out character: '1NNN' and '1-N-' are
    // both "no opt-out recorded", and describing either of them as notice having been given
    // would put a statement in the report that the string does not make.
    const notice =
      usPrivacy.noticeGiven === true
        ? 'notice given'
        : usPrivacy.noticeGiven === false
          ? 'notice not given'
          : 'the notice status not stated';
    grants.push({
      framework: FRAMEWORK.US_PRIVACY,
      text:
        `${label} carried US Privacy String ${usPrivacy.raw}, which records ${notice} and no ` +
        'opt-out of the sale of personal information.',
    });
  }

  const gpp = parsed.signals.gpp;
  if (gpp?.sectionNames) {
    const verdict = verdictForGpp(gpp);
    const jurisdictions = gpp.sectionNames.join(', ');
    if (verdict === true) {
      denials.push({
        framework: FRAMEWORK.GPP,
        text:
          `${label} carried a Global Privacy Platform string covering ${jurisdictions} that ` +
          'records an opt-out or a Global Privacy Control signal.',
      });
    } else if (verdict === false) {
      grants.push({
        framework: FRAMEWORK.GPP,
        text:
          `${label} carried a Global Privacy Platform string covering ${jurisdictions} with ` +
          'no opt-out recorded.',
      });
    }
  }

  const tcf = parsed.signals.tcf;
  if (tcf?.purposeConsents) {
    if (tcf.deviceStorageConsent === false) {
      denials.push({
        framework: FRAMEWORK.TCF,
        text:
          `${label} carried a TCF v2 consent string in which Purpose 1, "Store and/or access ` +
          'information on a device", is not consented.',
      });
    } else {
      grants.push({
        framework: FRAMEWORK.TCF,
        text:
          `${label} carried a TCF v2 consent string consenting to Purpose 1, "Store and/or ` +
          'access information on a device". Vendor-level consent was not decoded.',
      });
    }
  }

  if (denials.length) {
    return {
      status: CONSENT_STATUS.DENIED,
      explanation: denials.map((d) => d.text).join(' '),
      framework: denials[0].framework,
      signals: parsed.signals,
    };
  }

  if (grants.length) {
    return {
      status: CONSENT_STATUS.GRANTED,
      explanation: grants.map((g) => g.text).join(' '),
      framework: grants[0].framework,
      signals: parsed.signals,
    };
  }

  return {
    status: CONSENT_STATUS.UNKNOWN,
    explanation:
      `${label} carried consent framework parameters (${parsed.frameworks.join(', ')}), but ` +
      'none of them recorded a consent state this scanner can read.',
    framework: parsed.frameworks[0] ?? null,
    signals: parsed.signals,
  };
}

// ---------------------------------------------------------------------------
// Plain-English rendering for the client report
// ---------------------------------------------------------------------------

/**
 * What each status means, written for a reader who is not an ad-tech engineer. These
 * strings go straight into the report, so they describe what was observed and what it does
 * not establish. None of them characterises anything as lawful or unlawful; that judgement
 * belongs to the reader's counsel and stating it here would be practising law.
 */
export const CONSENT_STATUS_MEANING = {
  [CONSENT_STATUS.DENIED]:
    'The request carried a signal telling the receiving vendor that consent was refused. ' +
    'Tags are designed to keep firing in this state so that measurement still works, so ' +
    'seeing the request is expected behaviour and not by itself a sign of a problem.',
  [CONSENT_STATUS.GRANTED]:
    'The request carried a signal telling the receiving vendor that consent was given. ' +
    'Whether the visitor actually gave it is a separate question, answered by which scan ' +
    'pass the request appeared in rather than by the request itself.',
  [CONSENT_STATUS.UNKNOWN]:
    'The request carried no consent signal this scanner recognises. Nothing can be ' +
    'concluded from that either way: the site may use a mechanism not covered here, or may ' +
    'send no consent signal at all.',
};

/**
 * Render a parsed signal state as report-ready prose.
 *
 * `caveat` is not optional garnish. Every one of these signals is a statement the website
 * made to a vendor, and none of them proves what the visitor was shown or chose. A report
 * that presents them as proof of the visitor's choice overstates its own evidence, and the
 * first competent reader to notice that discredits everything else in the document.
 *
 * @param {ReturnType<typeof parseConsentSignals>} parsed
 * @returns {{summary: string, detail: string[], caveat: string}}
 */
export function explainConsentSignals(parsed) {
  const detail = [];
  const signals = parsed?.signals ?? {};

  const google = signals.googleConsentMode;
  if (google) {
    if (google.gcs) {
      const describe = (state) => (state === true ? 'granted' : state === false ? 'denied' : 'not set');
      detail.push(
        `Google Consent Mode: the request declared advertising storage ${describe(google.adStorage)} ` +
          `and analytics storage ${describe(google.analyticsStorage)} (gcs=${google.gcs}).`
      );
    }
    if (google.signalsNotConfigured?.length) {
      detail.push(
        `Google Consent Mode: ${google.signalsNotConfigured.join(', ')} were sent as not ` +
          'configured, meaning no consent state has been wired up for them.'
      );
    }
  }

  const meta = signals.metaLimitedDataUse;
  if (meta) {
    // An empty dpo is Meta's documented way of sending no data-processing option at all. Any
    // other unrecognised value is just unrecognised, and reading it as "unrestricted" would
    // state something about the site's configuration that was not observed.
    const unrestricted =
      'Meta Limited Data Use: the parameter was present but did not request the restriction, ' +
      'so the event was sent for unrestricted use.';
    // The value itself is not quoted into the sentence. Every other value this module prints
    // is one it validated against a fixed shape first; this one is arbitrary text copied off
    // a page the scanner does not control, and report copy is not the place to start
    // trusting the caller to escape it.
    const unrecognised =
      'Meta Limited Data Use: the parameter was present but carried a value this scanner does ' +
      'not recognise, so what it asked Meta to do cannot be stated.';

    detail.push(
      meta.limitedDataUse
        ? 'Meta Limited Data Use: the request asked Meta to treat the event as restricted, ' +
          'which rules out custom audiences and retargeting from it' +
          (meta.stateLabel ? ` (jurisdiction sent as ${meta.stateLabel}).` : '.')
        : meta.raw === null
          ? unrestricted
          : unrecognised
    );
  }

  const usPrivacy = signals.usPrivacy;
  if (usPrivacy?.valid) {
    if (usPrivacy.applies === false) {
      detail.push(
        `US Privacy String ${usPrivacy.raw}: the site stated that US privacy rules were ` +
          'determined not to apply to this visitor.'
      );
    } else {
      detail.push(
        `US Privacy String ${usPrivacy.raw}: notice ` +
          `${usPrivacy.noticeGiven === true ? 'given' : usPrivacy.noticeGiven === false ? 'not given' : 'not stated'}, ` +
          `sale of personal information ${usPrivacy.optedOut === true ? 'opted out of' : usPrivacy.optedOut === false ? 'not opted out of' : 'not stated'}.`
      );
    }
  } else if (signals.usPrivacy) {
    detail.push('US Privacy String: present but not in a readable format.');
  }

  const gpp = signals.gpp;
  if (gpp?.sectionNames?.length) {
    detail.push(`Global Privacy Platform: string present, covering ${gpp.sectionNames.join(', ')}.`);
    for (const section of Object.values(gpp.sections)) {
      if (!section.optOuts) continue;
      const entries = Object.entries(section.optOuts);
      const optedOutOf = entries.filter(([, value]) => value === true).map(([field]) => field);
      const declined = entries.some(([, value]) => value === false);

      // Three outcomes, not two. A section where every field is the spec's "not applicable",
      // or one too short to read, records no choice at all - and "no opt-out recorded" would
      // read to a client as the visitor having declined to opt out.
      detail.push(
        optedOutOf.length
          ? `Global Privacy Platform (${section.name}): opt-out recorded for ${optedOutOf.join(', ')}.`
          : declined
            ? `Global Privacy Platform (${section.name}): no opt-out recorded.`
            : `Global Privacy Platform (${section.name}): no opt-out choice was recorded either way.`
      );
    }
    if (gpp.globalPrivacyControl === true) {
      detail.push(
        'Global Privacy Platform: the string reports that the browser sent a Global Privacy ' +
          'Control signal.'
      );
    }
  } else if (signals.gpp) {
    detail.push('Global Privacy Platform: string present but could not be decoded.');
  }

  const tcf = signals.tcf;
  if (tcf?.purposeConsents) {
    detail.push(
      tcf.deviceStorageConsent
        ? 'IAB TCF: the consent string records consent for Purpose 1, storing or accessing ' +
          'information on the device.'
        : 'IAB TCF: the consent string records no consent for Purpose 1, storing or accessing ' +
          'information on the device.'
    );
  } else if (signals.tcf) {
    detail.push('IAB TCF: consent string present but could not be decoded.');
  }

  const summary =
    parsed?.consentDenied === true
      ? 'This request told the receiving vendor that consent was refused.'
      : parsed?.consentDenied === false
        ? 'This request told the receiving vendor that consent was given.'
        : 'This request did not carry a consent signal that could be read.';

  return {
    summary,
    detail,
    caveat:
      'These values are what the website sent to the vendor. They record the state the site ' +
      'reported, not what the visitor was shown or chose, and they say nothing about how the ' +
      'vendor then used the data.',
  };
}
