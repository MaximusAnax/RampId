import { SEVERITY_RANK } from './trackers.js';
import { findCaptureProblems } from './diff.js';

/**
 * First-contact message generation.
 *
 * Sales time is the binding constraint on this business, and an unknown solo vendor has no
 * brand to borrow credibility from. The only known substitute is a true, specific, checkable
 * fact about the recipient's own site, delivered in fewer words than they expected. This
 * module turns a scan into that message — and refuses to produce one when the scan has
 * nothing specific to say.
 *
 * Four rules are enforced in code rather than left to whoever is writing copy that week:
 *
 *   1. The first sentence is an observation about their own site: a named service, a named
 *      endpoint, and which of the three passes it appeared in. Never a greeting, never
 *      credentials, never a value proposition. A generic opening is the signal a reader uses
 *      to sort mail into bulk, and they use it before sentence two.
 *   2. Six sentences, hard cap — three in brief tone, four where a required caveat has to
 *      survive. assertSentenceBudget enforces it after assembly, so a future template that
 *      quietly grows fails the test suite instead of the recipient's patience.
 *   3. No legal conclusion, no pressure, no invented proof. assertFactualCopy runs over every
 *      generated string, including the subject line and every entry in plainFacts. One
 *      accusatory email reframes the sender as a demand-letter mill — the highest-severity
 *      risk in the business plan — and that reframing is not recoverable, so it cannot be
 *      left to discipline.
 *   4. Nothing is asked for before something is given. The finding and the steps to verify it
 *      independently come first; the ask is one soft line near the end.
 *
 * Deliberately absent: enforcement actions and monetary figures. They belong in the client
 * report, where the reader has already chosen to engage and the surrounding text frames them
 * as context. The same sentence in a cold email reads as a threat, so the guard rejects
 * currency figures outright rather than trusting the template.
 */

/**
 * Exported because the tests assert against them rather than magic numbers.
 *
 * MAX_BODY_SENTENCES is an absolute ceiling nothing raises. The follow-up figure is a base:
 * a required caveat buys one sentence beyond it, on the same rule that governs the body,
 * because a qualification is never the thing that gets traded away for brevity.
 */
export const MAX_BODY_SENTENCES = 6;
export const MAX_FOLLOW_UP_SENTENCES = 3;

/**
 * Language this product never sends, with the reason each entry exists.
 *
 * Three families, all of which look survivable in isolation and are not:
 *   - legal conclusions, which are unauthorized practice of law and invite the recipient to
 *     hire a lawyer to fight rather than a vendor to fix;
 *   - pressure and fabricated proof, which are the tells of bulk mail and cost the sender the
 *     one thing being traded on, credibility;
 *   - "AI" as a selling point, which since MIT's 2025 finding on GenAI pilots is a negative
 *     credibility signal to the exact buyer being written to.
 *
 * Patterns are deliberately broad. A false trip here costs a failed test and a reworded
 * sentence; a miss costs the sender's standing with a named account permanently.
 */
export const BANNED_PATTERNS = [
  { pattern: /\bviolat(e|es|ed|ing|ion|ions|or|ors)\b/i, reason: 'states a legal conclusion' },
  { pattern: /\billegal(ly)?\b/i, reason: 'states a legal conclusion' },
  { pattern: /\bunlawful(ly)?\b/i, reason: 'states a legal conclusion' },
  { pattern: /\bnon[-\s]?compliant\b/i, reason: 'states a legal conclusion' },
  { pattern: /\bnon[-\s]?compliance\b/i, reason: 'states a legal conclusion' },
  { pattern: /\bbreach(es|ed|ing)?\b/i, reason: 'states a legal conclusion' },
  { pattern: /\bliable\b/i, reason: 'states a legal conclusion' },
  { pattern: /\bliabilit(y|ies)\b/i, reason: 'states a legal conclusion' },
  { pattern: /\bexposed\b/i, reason: 'asserts legal exposure' },
  { pattern: /\blegal exposure\b/i, reason: 'asserts legal exposure' },
  { pattern: /\bsue[ds]?\b/i, reason: 'predicts litigation against the reader' },
  { pattern: /\bsuing\b/i, reason: 'predicts litigation against the reader' },
  { pattern: /\blawsuits?\b/i, reason: 'predicts litigation against the reader' },
  { pattern: /\bclass[-\s]actions?\b/i, reason: 'predicts litigation against the reader' },
  { pattern: /\bdemand letters?\b/i, reason: 'predicts litigation against the reader' },
  { pattern: /\bstatutory damages\b/i, reason: 'predicts litigation against the reader' },
  { pattern: /\bdamages\b/i, reason: 'predicts litigation against the reader' },
  { pattern: /\bplaintiffs?\b/i, reason: 'predicts litigation against the reader' },
  // The compliance family. Without these a legal conclusion can be stated in plain English
  // without using any of the words above — "your site does not comply", "you are required
  // to display this", "this falls short of your obligations" — which is the same assertion
  // and the same problem.
  { pattern: /\b(?:do(?:es)?n[’']?t|do(?:es)? not|fail(?:s|ed|ing)? to|not in)\s+compl(?:y|iance)\b/i,
    reason: 'states a legal conclusion' },
  { pattern: /\byou(?:r site|r company)?\s+(?:are|is)\s+required\s+to\b/i,
    reason: 'states a legal conclusion about the reader' },
  { pattern: /\bfalls?\s+short\s+of\b/i, reason: 'states a legal conclusion' },
  { pattern: /\byour\s+obligations?\b/i, reason: 'states a legal conclusion about the reader' },
  { pattern: /\bpenalt(?:y|ies)\b/i, reason: 'predicts enforcement against the reader' },
  { pattern: /\bfined?\b/i, reason: 'predicts enforcement against the reader' },
  { pattern: /\benforcement action\b/i, reason: 'predicts enforcement against the reader' },
  { pattern: /\bpenalt(y|ies)\b/i, reason: 'threatens a sanction' },
  { pattern: /\bfined?\b/i, reason: 'threatens a sanction' },
  { pattern: /\bfines\b/i, reason: 'threatens a sanction' },
  { pattern: /\benforcement action\b/i, reason: 'threatens a sanction' },
  { pattern: /\bat risk\b/i, reason: 'characterises the reader instead of reporting an observation' },
  { pattern: /\brequired by law\b/i, reason: 'states a legal conclusion' },
  { pattern: /\blegally required\b/i, reason: 'states a legal conclusion' },
  { pattern: /\bmust comply\b/i, reason: 'states a legal conclusion' },
  { pattern: /\byou must\b/i, reason: 'instructs the reader instead of informing them' },
  { pattern: /\bact now\b/i, reason: 'manufactures urgency' },
  { pattern: /\burgent(ly)?\b/i, reason: 'manufactures urgency' },
  { pattern: /\bimmediately\b/i, reason: 'manufactures urgency' },
  { pattern: /\bbefore it('|’)?s too late\b/i, reason: 'manufactures urgency' },
  { pattern: /\blimited time\b/i, reason: 'manufactures urgency' },
  { pattern: /\blast chance\b/i, reason: 'manufactures urgency' },
  { pattern: /\btime[- ]sensitive\b/i, reason: 'manufactures urgency' },
  { pattern: /\bdeadlines?\b/i, reason: 'manufactures urgency' },
  { pattern: /\bas soon as possible\b/i, reason: 'manufactures urgency' },
  { pattern: /\basap\b/i, reason: 'manufactures urgency' },
  { pattern: /\btrusted by\b/i, reason: 'social proof this sender cannot evidence' },
  { pattern: /\bour (clients|customers)\b/i, reason: 'social proof this sender cannot evidence' },
  { pattern: /\bindustry[- ]leading\b/i, reason: 'social proof this sender cannot evidence' },
  { pattern: /\bmarket[- ]leading\b/i, reason: 'social proof this sender cannot evidence' },
  { pattern: /\bhundreds of (companies|clients|customers|brands)\b/i, reason: 'social proof this sender cannot evidence' },
  { pattern: /\bguarantee[ds]?\b/i, reason: 'promises an outcome this method cannot promise' },
  { pattern: /\bai[- ]powered\b/i, reason: 'selling "AI" is a negative credibility signal to this buyer' },
  { pattern: /\bpowered by ai\b/i, reason: 'selling "AI" is a negative credibility signal to this buyer' },
  { pattern: /[$£€]\s?\d/, reason: 'a monetary figure in first contact reads as a threat' },
];

/**
 * Blank out strings the scan captured verbatim before the banned list is applied to copy.
 *
 * The guard polices language this product wrote. Banned words also turn up inside evidence
 * quoted word for word — a prospect whose page sits at /data-breach-response, a pixel that
 * carries a price in its query string — and repeating a company's own URL back to them
 * accuses nobody. Scanning it anyway made those accounts permanently uncontactable, and with
 * no wording the sender could change, since the offending text is the recipient's, not ours.
 *
 * Only strings the scan itself recorded are exempt, and they are matched literally, never as
 * a pattern. Nothing a caller supplies is exempt, so a company name cannot be shaped to look
 * like evidence and slip language past the guard.
 */
function maskCapturedEvidence(text, capturedEvidence) {
  return [...capturedEvidence]
    .filter((item) => typeof item === 'string' && item.length >= 6)
    .sort((a, b) => b.length - a.length)
    .reduce((masked, item) => masked.split(item).join(' '), text);
}

/** Every banned phrase present in `text`, with the reason each is banned. */
export function findBannedPhrases(text, capturedEvidence = []) {
  const searched = maskCapturedEvidence(String(text ?? ''), capturedEvidence);
  const found = [];
  for (const entry of BANNED_PATTERNS) {
    const match = searched.match(entry.pattern);
    if (match) found.push({ phrase: match[0], reason: entry.reason });
  }
  return found;
}

/**
 * Throw if generated copy contains anything on the banned list.
 *
 * Returns the text so it can wrap an expression inline, which is the point: every string that
 * leaves this module passes through here, and there is no path around it. A company whose own
 * name contains a banned word will make generation throw rather than send — that is the
 * intended trade, since a loud failure is recoverable in seconds and a sent accusation is not.
 */
export function assertFactualCopy(text, label = 'outreach copy', capturedEvidence = []) {
  const found = findBannedPhrases(text, capturedEvidence);
  if (!found.length) return text;
  const detail = found.map((f) => `"${f.phrase}" (${f.reason})`).join('; ');
  throw new Error(`${label} contains language this product never sends: ${detail}`);
}

/**
 * Sentence count, defined as terminators followed by whitespace or end of string.
 *
 * Written this way because copy is full of dotted tokens — facebook.com/tr,
 * navigator.globalPrivacyControl, Sec-GPC: 1 — and splitting on bare periods would count a
 * single sentence about an endpoint as four. The lookbehind exempts a lone initial, so a
 * signature reading "A. Ndiongue" does not spend a sentence of the budget on the sender's
 * first name.
 *
 * A raw evidence URL is dropped before counting rather than trusted to end in a letter. It is
 * quoted exactly as captured, so its last character belongs to a third party: a request URL
 * ending in "?" or a path ending in "." would otherwise make an evidence line count as a
 * sentence and put the body over a cap it does not actually breach.
 */
export function countSentences(text) {
  const prose = String(text ?? '').replace(/https?:\/\/\S+/gi, ' ');
  return (prose.match(/(?<!\b[A-Za-z])[.!?](?=\s|$)/g) || []).length;
}

export function assertSentenceBudget(text, maxSentences, label = 'body') {
  const used = countSentences(text);
  if (used > maxSentences) {
    throw new Error(`${label} runs to ${used} sentences; the cap is ${maxSentences}`);
  }
  return text;
}

/**
 * Which finding leads the message, most damaging first.
 *
 * REJECT_IGNORED opens because the company built the reject button itself and cannot argue
 * the standard was unfair. The two negative observations rank last: they are the ones an
 * automated check is most likely to be wrong about, so they only lead when nothing positive
 * was observed at all.
 */
// OPTOUT_NOT_DISPLAYED leads, ahead of every tracker-based observation, and the reason is
// category rather than severity.
//
// "Since 1 January the regulation requires your site to display that it processed an
// opt-out signal, and here is what yours displays" is a compliance observation. "Here is
// the tracking pixel that fired" has the same opening sentence as the demand letters that
// volume plaintiff firms send to hundreds of brands weekly — which recipients' counsel have
// trained them to forward and never answer. Leading with the tracker puts a legitimate
// message into the bin those letters go to, regardless of how carefully it is written.
const LEAD_ORDER = [
  'OPTOUT_NOT_DISPLAYED',
  'REJECT_IGNORED',
  'GPC_IGNORED',
  'PRE_CONSENT',
  'NO_CMP',
  'NO_REJECT_CONTROL',
];

/** The pass whose captured requests evidence each finding. */
const FINDING_PASS = {
  REJECT_IGNORED: 'afterReject',
  GPC_IGNORED: 'gpc',
  PRE_CONSENT: 'baseline',
  NO_CMP: 'baseline',
  NO_REJECT_CONTROL: null,
  // The display requirement is evidenced by what the GPC pass showed on the page, not by
  // requests. Leaving it unmapped made it fall into the branch written for
  // NO_REJECT_CONTROL, so the sender's own verification sheet asserted no reject control
  // was found on scans where the scanner had clicked one — a contradiction in the single
  // artefact that exists to be checked before sending.
  OPTOUT_NOT_DISPLAYED: 'gpc',
};

/** Findings that cannot lead a message without a named service to point at. */
// OPTOUT_NOT_DISPLAYED is deliberately absent: it is an observation about what the page
// does not show, so there is no tracker to name and requiring one would suppress the lead.
const NEEDS_NAMED_TRACKER = new Set(['REJECT_IGNORED', 'GPC_IGNORED', 'PRE_CONSENT', 'NO_CMP']);

/**
 * Scans are read back from disk as often as they come from a live capture, so a record can
 * arrive truncated. One without a service name is not a service this module can point at: the
 * first sentence would open on a blank where the name belongs, which is worse than the silence
 * this module is built to prefer.
 */
const hasUsableName = (tracker) =>
  typeof tracker?.name === 'string' && tracker.name.trim() !== '';

/**
 * Tie-break between services of equal severity, so the named one is chosen rather than
 * inherited from list order. Session replay leads because it is both the most concrete thing
 * to describe to a non-technical reader — it records what the visitor typed and played it
 * back — and the category implicated in roughly 65% of CIPA filings.
 */
const CATEGORY_LEAD_RANK = { 'session-replay': 3, 'ad-pixel': 2 };

const PASS_FACT_LABEL = {
  baseline: 'Pass 1, first load with nothing clicked',
  gpc: 'Pass 2, Global Privacy Control enabled',
  afterReject: 'Pass 3, after the reject control was clicked',
};

/**
 * The same three passes as a clause that can sit inside a sentence.
 *
 * The baseline clause names no banner on purpose. It is also the pass behind NO_CMP, where the
 * first message said no banner could be found at all, and a follow-up referring to "your
 * banner" would contradict the message it is following up on.
 */
const PASS_RECAP_PHRASE = {
  baseline: 'on first load, before anything on the page was clicked',
  gpc: 'while the browser was advertising Global Privacy Control',
  afterReject: 'after I clicked the reject control on your banner',
};

const TONES = {
  plain: { maxSentences: MAX_BODY_SENTENCES, rawEvidence: false, foldScopeIntoAsk: false },
  technical: { maxSentences: MAX_BODY_SENTENCES, rawEvidence: true, foldScopeIntoAsk: false },
  brief: { maxSentences: 3, rawEvidence: false, foldScopeIntoAsk: true },
};

const listFormatter = new Intl.ListFormat('en-GB', { style: 'long', type: 'conjunction' });
const dateFormatter = new Intl.DateTimeFormat('en-GB', {
  day: 'numeric',
  month: 'long',
  year: 'numeric',
  timeZone: 'UTC',
});

function nameList(names) {
  if (names.length <= 3) return listFormatter.format(names);
  return listFormatter.format([...names.slice(0, 2), `${names.length - 2} others`]);
}

function hostOf(url) {
  try {
    return new URL(url).hostname;
  } catch {
    return String(url ?? '').replace(/^https?:\/\//, '').split('/')[0] || String(url ?? '');
  }
}

/**
 * A label that would read as the end of a sentence cannot be dropped into the middle of one.
 *
 * Hostnames and path segments may legitimately end in a full stop — a trailing-dot FQDN, a
 * path that ends in one — and both arrive from a third party rather than from this codebase.
 * Carried into prose, one of them ends the sentence in the reader's eye halfway through it
 * and spends a sentence of the budget, which is enough to stop the message being generated at
 * all. The copy degrades to naming no endpoint instead, which it is already built to do.
 */
const usableLabel = (value) => (value && !/[.!?]$/.test(value) ? value : null);

/**
 * The host to put in the reader's network-panel filter box. Parsed rather than trimmed with
 * hostOf's fallback, because a sample that is not a URL would otherwise be printed as though
 * it were a hostname, telling the reader to filter for something that cannot be filtered for.
 */
function sampleHost(sampleUrl) {
  if (!sampleUrl) return null;
  try {
    return usableLabel(new URL(sampleUrl).hostname);
  } catch {
    return null;
  }
}

/** "www.facebook.com/tr" — host plus one path segment, which is what an engineer greps for. */
function endpointLabel(sampleUrl) {
  if (!sampleUrl) return null;
  try {
    const parsed = new URL(sampleUrl);
    const [first] = parsed.pathname.split('/').filter(Boolean);
    const withSegment = first && first.length <= 24 ? `${parsed.hostname}/${first}` : null;
    return usableLabel(withSegment) ?? usableLabel(parsed.hostname);
  } catch {
    return null;
  }
}

function formatObservedDate(iso) {
  if (typeof iso !== 'string' || !iso.trim()) return null;
  const when = new Date(iso);
  if (Number.isNaN(when.getTime())) return null;
  return dateFormatter.format(when);
}

/**
 * Pick the finding to lead on and the single named service that evidences it.
 *
 * Returns null when there is nothing specific to say. That is a supported outcome, not a
 * failure: the alternative is manufacturing a reason to make contact, which is precisely the
 * behaviour that makes cold mail worthless.
 */
export function selectLeadObservation(scan) {
  if (!scan || typeof scan !== 'object' || !Array.isArray(scan.findings)) return null;

  // A first contact demands a clean capture end to end. Drift alerts can tolerate a partial
  // scan because a relationship already exists to correct the record; an opening message
  // built on a timed-out pass has no such recovery, and its first impression is its only one.
  if (findCaptureProblems(scan, 'scan').length) return null;

  for (const id of LEAD_ORDER) {
    const finding = scan.findings.find((f) => f.id === id);
    if (!finding) continue;

    const passKey = FINDING_PASS[id];
    const pass = passKey ? scan.passes?.[passKey] : null;
    if (passKey && (!pass || pass.error)) continue;

    const named = new Set(finding.trackers || []);
    const candidates = (pass?.trackers || []).filter(
      (t) => hasUsableName(t) && (!named.size || named.has(t.name))
    );
    const ranked = [...candidates].sort(
      (a, b) =>
        (SEVERITY_RANK[b.severity] || 0) - (SEVERITY_RANK[a.severity] || 0) ||
        (CATEGORY_LEAD_RANK[b.category] || 0) - (CATEGORY_LEAD_RANK[a.category] || 0) ||
        Number(Boolean(b.sample)) - Number(Boolean(a.sample)) ||
        String(a.name).localeCompare(String(b.name))
    );

    if (NEEDS_NAMED_TRACKER.has(id) && !ranked.length) continue;

    return {
      finding,
      passKey,
      tracker: ranked[0] ?? null,
      others: ranked.slice(1),
    };
  }

  return null;
}

/**
 * Shared context for both the first message and the follow-up, so the two can never describe
 * the observation differently. A follow-up that restates the fact loosely is worse than none.
 */
function buildContext(scan, { company = null, tone = 'plain' } = {}) {
  const lead = selectLeadObservation(scan);
  if (!lead) return null;

  const pageHost = hostOf(scan.url);
  const consentPlatforms = (scan.cmp || []).filter(
    (name) => typeof name === 'string' && name.trim() !== ''
  );
  const tracker = lead.tracker;
  const endpoint = endpointLabel(tracker?.sample);
  const endpointHost = sampleHost(tracker?.sample);

  return {
    scan,
    lead,
    tone: TONES[tone] || TONES.plain,
    pageHost,
    siteLabel: company ? `${company} (${pageHost})` : pageHost,
    consentPlatforms,
    cmpLabel: consentPlatforms.length ? `${consentPlatforms.join(' / ')} banner` : 'consent banner',
    // Whether anything banner-like was seen at all. PRE_CONSENT fires on sites that run a
    // consent banner and on sites that run none — consent.js records NO_CMP beside it in the
    // second case — so copy that says "your consent banner" either way asserts a banner the
    // same scan reports finding no trace of. That contradiction lands in the one sentence the
    // whole message is betting its credibility on, and the reader settles it in a click.
    bannerObserved: consentPlatforms.length > 0 || scan.bannerVisible === true,
    observedClause: formatObservedDate(scan.scannedAt)
      ? ` (observed ${formatObservedDate(scan.scannedAt)})`
      : '',
    observedDate: formatObservedDate(scan.scannedAt),
    trackerName: tracker?.name ?? null,
    endpoint,
    endpointHost,
    rawSample: tracker?.sample ?? null,
    otherNames: lead.others.map((t) => t.name),
    // Everything in the copy that was quoted from the capture rather than written here,
    // including the labels derived from a sample URL. See maskCapturedEvidence.
    capturedEvidence: [
      scan.url,
      pageHost,
      endpoint,
      endpointHost,
      tracker?.sample,
      ...Object.values(scan.passes || {}).flatMap((pass) =>
        (pass?.trackers || []).map((t) => t.sample)
      ),
    ].filter((value) => typeof value === 'string' && value !== ''),
  };
}

/**
 * "sent a request to www.facebook.com/tr", or just "sent a request" when the capture recorded
 * no sample URL. The endpoint is never inferred from the fingerprint table — a plausible
 * endpoint the recipient's engineer cannot find in their own logs discredits the whole message.
 */
const requestClause = (ctx) =>
  ctx.endpoint ? `sent a request to ${ctx.endpoint}` : 'sent a request';

/** What to type into the network panel's filter box, or the honest fallback. */
const filterClause = (ctx) =>
  ctx.endpointHost
    ? `filter for ${ctx.endpointHost}`
    : `watch for outbound requests to ${ctx.trackerName}`;

const panelClause = (ctx) =>
  ctx.tone.rawEvidence
    ? 'with the network panel open and "Preserve log" enabled'
    : 'with the network panel open';

/** Both say the request preceded any choice; only one of them claims a banner exists. */
const beforeConsentClause = (ctx) =>
  ctx.bannerObserved
    ? `before anything on your ${ctx.cmpLabel} was clicked`
    : 'before anything on the page was clicked';

const withoutTouchingClause = (ctx) =>
  ctx.bannerObserved ? 'without touching the banner' : 'without clicking anything on the page';

const VARIANTS = {
  OPTOUT_NOT_DISPLAYED: (ctx) => ({
    subject: `${ctx.pageHost} and the opt-out preference signal display requirement`,
    // The regulation citation lives in the lead rather than in an optional sentence,
    // because it is the entire reason this message is a compliance observation rather than
    // something that reads like a demand letter. It must never be dropped to fit a budget.
    lead:
      `Loading ${ctx.siteLabel} with Global Privacy Control switched on, the page showed ` +
      `nothing indicating the signal had been processed${ctx.observedClause}. California's ` +
      'CCPA regulations at section 7025(c)(6) changed from "may" to "shall" effective ' +
      '1 January 2026, so a business that processes an opt-out preference signal now has to ' +
      'display that it has done so.',
    extra: 'It is a recent change and an easy one to miss.',
    verify:
      'To check it yourself: turn on Global Privacy Control — Brave and DuckDuckGo send it ' +
      'by default, and there are extensions for other browsers — then load the page and look ' +
      'for any confirmation that the signal was received.',
    remediation:
      'In most consent platforms this is a display setting rather than a code change.',
  }),

  REJECT_IGNORED: (ctx) => ({
    subject: `${ctx.trackerName} request on ${ctx.pageHost} after clicking reject`,
    lead:
      `${ctx.trackerName} ${requestClause(ctx)} on ${ctx.siteLabel} after I clicked the reject ` +
      `control on your ${ctx.cmpLabel}${ctx.observedClause}.`,
    caveat: null,
    extra: ctx.otherNames.length
      ? `${nameList(ctx.otherNames)} transmitted after the same click.`
      : null,
    verify:
      `To check it yourself: open the page in a fresh private window ${panelClause(ctx)}, click ` +
      `reject, and ${filterClause(ctx)} — everything the panel shows from that point arrived ` +
      'after the click.',
    remediation:
      'In most setups this is a tag whose trigger is not wired to the consent state rather ' +
      'than anything in the page code, so the change is usually in the tag manager.',
  }),

  GPC_IGNORED: (ctx) => ({
    subject: `${ctx.trackerName} request on ${ctx.pageHost} with Global Privacy Control on`,
    lead:
      `${ctx.trackerName} ${requestClause(ctx)} on ${ctx.siteLabel} while the browser was ` +
      'advertising Global Privacy Control — Sec-GPC: 1 and navigator.globalPrivacyControl = ' +
      `true${ctx.observedClause}.`,
    caveat: null,
    extra: ctx.otherNames.length
      ? `${nameList(ctx.otherNames)} transmitted on the same load.`
      : null,
    verify:
      'To check it yourself: load the page in a browser with GPC switched on — or send ' +
      `Sec-GPC: 1 with a single curl — and ${filterClause(ctx)} in the network panel.`,
    remediation:
      'Global Privacy Control is the opt-out preference signal California’s rules ' +
      'recognise, and in most consent platforms honouring it is a setting rather than a code ' +
      'change.',
  }),

  PRE_CONSENT: (ctx) => ({
    subject: ctx.bannerObserved
      ? `${ctx.trackerName} loads on ${ctx.pageHost} before the consent banner is touched`
      : `${ctx.trackerName} loads on ${ctx.pageHost} before anything on the page is clicked`,
    lead:
      `${ctx.trackerName} ${requestClause(ctx)} on first load of ${ctx.siteLabel}, ` +
      `${beforeConsentClause(ctx)}${ctx.observedClause}.`,
    caveat: null,
    extra: ctx.otherNames.length
      ? `${nameList(ctx.otherNames)} transmitted on the same load.`
      : null,
    verify:
      `To check it yourself: open the page in a fresh private window ${panelClause(ctx)} and ` +
      `${filterClause(ctx)} ${withoutTouchingClause(ctx)}.`,
    remediation:
      'This is normally a tag firing on page view instead of on consent, which is a trigger ' +
      'condition in the tag manager rather than a code change.',
  }),

  NO_CMP: (ctx) => ({
    subject: `${ctx.trackerName} loads on ${ctx.pageHost} with no consent banner found`,
    lead:
      `${ctx.trackerName} ${requestClause(ctx)} on first load of ${ctx.siteLabel}, and no ` +
      `consent banner or consent platform was detectable on the page I tested${ctx.observedClause}.`,
    // Required, not optional: a banner shown only to visitors in certain regions is invisible
    // to a single-location check, and asserting its absence without this line is the kind of
    // error a recipient disproves in one click.
    caveat:
      'A banner that only appears for visitors in certain regions would not show up in a check ' +
      'run from one location, so that is worth confirming from your side.',
    extra: ctx.otherNames.length
      ? `${nameList(ctx.otherNames)} transmitted on the same load.`
      : null,
    verify:
      `To check it yourself: open the page in a fresh private window ${panelClause(ctx)} and ` +
      `${filterClause(ctx)} on first load.`,
    remediation: null,
  }),

  NO_REJECT_CONTROL: (ctx) => ({
    subject: `No reject control found on the ${ctx.pageHost} consent banner`,
    lead:
      `On ${ctx.siteLabel} I could not find a reject control at the same level as accept on ` +
      `your ${ctx.cmpLabel}, so the third pass of the check — what happens after a visitor ` +
      `declines — could not be completed${ctx.observedClause}.`,
    // Required for the same reason as above, and more so: this is the observation most likely
    // to be an artefact of automation rather than of the site.
    caveat:
      'An automated check can miss a control that only exists inside a preferences dialog, so ' +
      'this is worth a manual look before anyone treats it as settled.',
    extra: null,
    verify:
      'To check it yourself: load the page in a fresh private window and count the clicks it ' +
      'takes to decline against the clicks it takes to accept on the first banner layer.',
    remediation:
      'Where those two paths differ, the change is normally in the banner template rather than ' +
      'in the site.',
  }),
};

const ASK_SENTENCE =
  'If it is useful I can send the full capture — all three page loads with the raw request ' +
  'URLs — at no charge, and nothing is needed from your side.';

const SCOPE_SENTENCE =
  'This is an outside observation of network traffic on your public site, not legal advice, ' +
  'and the legal question belongs with your own counsel.';

const ASK_WITH_SCOPE_SENTENCE =
  'I can send the full capture with the raw request URLs if that is useful — it is an outside ' +
  'observation of network traffic on your public site, not legal advice.';

/**
 * Drop optional sentences, least important first, until the body fits its budget.
 *
 * Trimming by construction rather than truncating afterwards keeps every message a complete
 * thought. If the required sentences alone exceed the budget that is a template bug, and
 * assertSentenceBudget below is what surfaces it.
 */
function fitToBudget(items, maxSentences) {
  const kept = items.filter((item) => item && item.text);
  const total = () => kept.reduce((n, item) => n + countSentences(item.text), 0);

  while (total() > maxSentences) {
    let dropAt = -1;
    let worstPriority = -Infinity;
    kept.forEach((item, index) => {
      if (item.optional && item.priority > worstPriority) {
        worstPriority = item.priority;
        dropAt = index;
      }
    });
    if (dropAt === -1) break;
    kept.splice(dropAt, 1);
  }

  return kept;
}

function paragraphsFrom(items, groups) {
  return groups
    .map((group) =>
      items
        .filter((item) => item.group === group)
        .map((item) => item.text)
        .join(' ')
    )
    .filter(Boolean);
}

/**
 * The atomic observations behind the message, one per line, in the order a reader would check
 * them. Returned alongside the copy so the sender can see exactly which claims were made and
 * confirm each against the scan before pressing send.
 */
function buildPlainFacts(ctx) {
  const { scan, lead } = ctx;
  const facts = [
    `Site tested: ${scan.url}`,
    ctx.observedDate ? `Observed: ${ctx.observedDate} (UTC)` : null,
    'Method: three page loads from a clean browser profile, from the public internet. No ' +
      'access to systems, accounts or data.',
    `Consent platform detected: ${
      ctx.consentPlatforms.length ? ctx.consentPlatforms.join(', ') : 'none identified'
    }`,
    `Observation: ${lead.finding.title}`,
  ].filter(Boolean);

  if (lead.passKey) {
    const pass = scan.passes[lead.passKey];
    const named = new Set(lead.finding.trackers || []);
    const rows = (pass.trackers || []).filter(
      (t) => hasUsableName(t) && (!named.size || named.has(t.name))
    );
    for (const t of rows.slice(0, 6)) {
      facts.push(
        `${PASS_FACT_LABEL[lead.passKey]}: ${t.name} requested ` +
          `${t.sample ?? 'an endpoint whose URL was not retained'}`
      );
    }
    if (rows.length > 6) facts.push(`${rows.length - 6} further service(s) recorded in the same pass.`);
  } else if (ctx.lead.finding.id === 'NO_REJECT_CONTROL') {
    facts.push(
      'Pass 3 could not be completed: no reject control was found at the top layer of the ' +
        'banner by automated interaction.'
    );
  } else {
    facts.push('No third-party requests are quoted for this observation.');
  }

  return facts.map((fact, index) =>
    assertFactualCopy(fact, `plainFacts[${index}]`, ctx.capturedEvidence)
  );
}

/**
 * Turn a scan into a sendable first-contact message.
 *
 * @param {object} scan  a scanConsent result
 * @param {object} [options]
 * @param {string} [options.company]     recipient's company name, used once beside the hostname
 * @param {string} [options.senderName]  signature line; omitted entirely when absent
 * @param {string} [options.tone]        'plain' (default), 'technical', or 'brief'
 * @returns {{subject: string, body: string, plainFacts: string[]}|null}
 *
 * Returns null when the scan produced no finding worth writing about, when the capture was
 * incomplete, or when no named service can be pointed at. There is no fallback message,
 * because a message with no specific fact in it is the thing this module exists to avoid.
 *
 * Throws when the assembled copy trips the banned-phrase guard or the sentence budget.
 */
export function generateOutreach(scan, options = {}) {
  const { senderName = null } = options;
  const ctx = buildContext(scan, options);
  if (!ctx) return null;

  const variant = VARIANTS[ctx.lead.finding.id];
  if (!variant) return null;

  const copy = variant(ctx);
  const foldScope = ctx.tone.foldScopeIntoAsk;

  // A required caveat is never traded away for brevity. It is the sentence that keeps a
  // negative observation from reading as a claim, so the shortest tone buys one extra
  // sentence rather than dropping it — still well inside the six-sentence ceiling.
  const maxSentences = Math.min(
    MAX_BODY_SENTENCES,
    ctx.tone.maxSentences + (copy.caveat ? 1 : 0)
  );

  const items = fitToBudget(
    [
      { group: 'observation', text: copy.lead, optional: false, priority: 0 },
      { group: 'observation', text: copy.extra, optional: true, priority: 2 },
      // The caveat closes the observation paragraph: it qualifies everything above it, and a
      // qualification the reader meets before the claim it qualifies reads as hedging.
      { group: 'observation', text: copy.caveat, optional: false, priority: 0 },
      { group: 'verify', text: copy.verify, optional: false, priority: 0 },
      { group: 'verify', text: copy.remediation, optional: true, priority: 1 },
      {
        group: 'ask',
        text: foldScope ? ASK_WITH_SCOPE_SENTENCE : ASK_SENTENCE,
        optional: false,
        priority: 0,
      },
      { group: 'scope', text: foldScope ? null : SCOPE_SENTENCE, optional: false, priority: 0 },
    ],
    maxSentences
  );

  const paragraphs = paragraphsFrom(items, ['observation', 'verify', 'ask', 'scope']);

  // The budget is asserted on the prose alone, before the evidence line and the signature are
  // attached. Neither is a sentence and neither is something the template controls: a captured
  // URL that happens to end in a full stop or a question mark must not be able to stop a
  // message being generated, and a sender's name must not either.
  assertSentenceBudget(paragraphs.join(' '), maxSentences, 'outreach body');

  // The raw URL rides below the observation rather than inside a sentence: it is evidence to
  // be pasted into a search box, not prose, and putting it in a sentence makes the sentence
  // unreadable at the exact moment the reader is deciding whether this is real.
  if (ctx.tone.rawEvidence && ctx.rawSample) {
    paragraphs[0] = `${paragraphs[0]}\n${ctx.rawSample}`;
  }

  if (senderName) paragraphs.push(`— ${senderName}`);
  const body = paragraphs.join('\n\n');

  return {
    subject: assertFactualCopy(copy.subject, 'outreach subject', ctx.capturedEvidence),
    body: assertFactualCopy(body, 'outreach body', ctx.capturedEvidence),
    plainFacts: buildPlainFacts(ctx),
  };
}

/**
 * One follow-up. Not a sequence.
 *
 * The message restates the same observation in compressed form, offers the capture again,
 * routes to a better recipient if there is one, and says plainly that nothing further will
 * arrive. Naming the end of the thread is the part that keeps this out of a spam complaint:
 * since the 2025 bulk-sender enforcement changes, a complaint rate above 0.3% causes outright
 * rejection rather than spam-foldering, which makes an unanswered follow-up sequence a threat
 * to the sending domain itself rather than merely an annoyance.
 *
 * @param {object} scan  the same scan the first message was generated from
 * @param {object} [options]
 * @param {string} [options.priorSubject] subject of the first message; derived when absent
 * @param {string} [options.company]
 * @param {string} [options.senderName]
 * @param {string} [options.tone]
 * @returns {{subject: string, body: string}|null}
 */
export function generateFollowUp(scan, options = {}) {
  const { priorSubject = null, senderName = null } = options;
  const ctx = buildContext(scan, options);
  if (!ctx) return null;

  const variant = VARIANTS[ctx.lead.finding.id];
  if (!variant) return null;

  const copy = variant(ctx);

  // Compressed where a named service exists, verbatim from the first message where one does
  // not. Either way the fact is regenerated from the same scan rather than paraphrased, so a
  // follow-up can never describe the observation more strongly than the original did.
  const compressed = ctx.trackerName
    ? `Closing the loop on my earlier note: ${ctx.trackerName} ${requestClause(ctx)} on ` +
      `${ctx.pageHost} ${PASS_RECAP_PHRASE[ctx.lead.passKey]}${ctx.observedClause}.`
    : null;

  // A negative observation is only ever restated with the qualification it was first made
  // with. The compressed recap states what was transmitted and drops the negative claim
  // entirely, so it needs no caveat; the verbatim lead keeps the claim, and dropping the
  // caveat there would make the second message a firmer assertion than the first — the one
  // direction a follow-up must never move in, and on the finding this engine is most likely
  // to have got wrong.
  const caveat = compressed ? null : copy.caveat;
  const maxSentences = MAX_FOLLOW_UP_SENTENCES + (caveat ? 1 : 0);

  const paragraphs = [
    [compressed ?? copy.lead, caveat].filter(Boolean).join(' '),
    'The full capture with the raw request URLs is still yours at no charge, and if someone ' +
      'else is the right person for it I am glad to send it to them instead.',
    'This is the only follow-up I will send; no reply is needed if it is not relevant.',
  ].filter(Boolean);

  assertSentenceBudget(paragraphs.join(' '), maxSentences, 'follow-up body');

  if (senderName) paragraphs.push(`— ${senderName}`);
  const body = paragraphs.join('\n\n');
  const base = priorSubject || copy.subject;
  const subject = /^re:\s/i.test(base) ? base : `Re: ${base}`;

  return {
    subject: assertFactualCopy(subject, 'follow-up subject', ctx.capturedEvidence),
    body: assertFactualCopy(body, 'follow-up body', ctx.capturedEvidence),
  };
}
