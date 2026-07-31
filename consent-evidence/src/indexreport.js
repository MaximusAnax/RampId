/**
 * The aggregate index: "Pre-Consent Tracking in US Retail, 2026" and its successors.
 *
 * This artifact exists for one commercial reason. Scanning three hundred companies and
 * publishing the aggregate — naming none of them — means every subsequent conversation with
 * one of those companies starts with a researcher who already measured the market, not a
 * vendor with a list. That reframing is the difference between being read and being deleted,
 * and it is also the defence against the single largest risk in this business: reading as a
 * demand-letter mill.
 *
 * Three constraints follow from that, and none of them are stylistic.
 *
 *   1. NO COMPANY MAY BE IDENTIFIABLE. Not by name, not by hostname, not by URL, not by a
 *      sample request URL that happens to carry the page address in a query parameter. A
 *      single leak here converts the artifact from research into a public accusation against
 *      a named company, which is the exact thing the index exists to avoid. So the aggregate
 *      is assembled only from values that cannot identify anyone (counts, ids from a closed
 *      set, vendor names from the classifier's own corpus), and the rendered page is then
 *      checked against every identifying string found in the input before it is returned.
 *      Rendering throws rather than returning a page that failed the check.
 *
 *   2. NO LEGAL CONCLUSION, in the aggregate any more than in an individual report. The page
 *      records what browsers transmitted. It does not say who was in breach of what.
 *
 *   3. NO OVERCLAIMING. The audience being courted is technical and sceptical, and a public
 *      research artifact that overstates its method is dismantled in a thread rather than
 *      cited. The methodology section states the sample, the dates, what was measured and
 *      what the method structurally cannot see — including the blind spots that would make
 *      the headline numbers understatements.
 */

import { parse } from 'tldts';
import { TRACKERS, CMPS, SEVERITY_RANK } from './trackers.js';
import { corpusStats } from './entities.js';

/**
 * Canonical finding titles, owned by this module rather than copied from the scans.
 *
 * A per-scan finding title contains counts and the names of the consent platforms found on
 * that specific site — free text derived from one company's page. Copying it into an
 * aggregate would be both wrong (the title describes one site) and an identification risk.
 * Only the finding id, which comes from a closed set, crosses the boundary.
 */
const FINDING_TITLES = {
  OPTOUT_NOT_DISPLAYED:
    'No indication displayed that an opt-out preference signal was processed',
  PRE_CONSENT: 'Third-party trackers transmitted before any consent interaction',
  GPC_IGNORED: 'Trackers continued transmitting with Global Privacy Control enabled',
  REJECT_IGNORED: 'Trackers continued transmitting after the reject control was clicked',
  NO_CMP: 'No consent mechanism could be identified on the page tested',
  NO_REJECT_CONTROL: 'No reject control could be found at banner level',
};

const FINDING_ORDER = Object.keys(FINDING_TITLES);

const RISK_BUCKETS = [
  { label: '0 — nothing observed', from: 0, to: 0 },
  { label: '1–24', from: 1, to: 24 },
  { label: '25–49', from: 25, to: 49 },
  { label: '50–74', from: 50, to: 74 },
  { label: '75–100', from: 75, to: 100 },
];

/**
 * Public enforcement context. Present in an aggregate for the same reason it is present in an
 * individual report — to say why this was worth measuring — and with the same rule: it is
 * context, never a threat, and it is never connected to anyone in the sample.
 */
const ENFORCEMENT_CONTEXT = [
  { who: 'Disney / ABC', amount: '$2.75M', when: 'Feb 2026' },
  { who: 'PlayOn Sports', amount: '$1.1M', when: 'Q1 2026' },
  { who: 'Honda', amount: '$632,500', when: '2026 — asymmetric opt-out design' },
  { who: 'Ford', amount: '$375,703', when: 'Mar 2026' },
];

/**
 * Domain labels shorter than this are not treated as identifiers on their own.
 *
 * A three-letter fragment of a domain matches ordinary English inside the page template, and
 * a guard that blocks every publication is a guard the next maintainer deletes. The strong
 * identifiers — full hostnames, registrable domains and whole company names — are unaffected
 * by this floor, so nothing that actually identifies a company is dropped by it.
 */
const MINIMUM_DOMAIN_LABEL_LENGTH = 4;

/** Legal-form suffixes stripped so "Acme Health, Inc." is also checked as "Acme Health". */
const COMPANY_SUFFIX_PATTERN =
  /[\s,]+(inc|inc\.|llc|l\.l\.c\.|ltd|ltd\.|limited|corp|corp\.|corporation|co|co\.|plc|gmbh|sa|s\.a\.|bv|b\.v\.|ag|nv|pty|holdings|group)$/i;

/** Fields a caller may have attached to a scan to record whose site it was. */
const COMPANY_FIELDS = ['company', 'client', 'brand', 'label', 'organization', 'organisation'];

export class AnonymityError extends Error {
  constructor(message, terms = []) {
    super(message);
    this.name = 'AnonymityError';
    this.terms = terms;
  }
}

const escapeHtml = (value) =>
  String(value ?? '').replace(/[&<>"']/g, (c) =>
    ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]
  );

const hostnameOf = (url) => {
  try {
    return new URL(url).hostname;
  } catch {
    return null;
  }
};

/* -------------------------------------------------------------------------- */
/* Anonymity                                                                   */
/* -------------------------------------------------------------------------- */

/**
 * Vendor names the aggregate is expected to print.
 *
 * If a scanned company happens to *be* a tracking vendor, its bare name would collide with the
 * tracker tables and block publication permanently, even though "Hotjar" appearing in a
 * prevalence table says nothing about which sites were scanned. A term that is exactly one of
 * the classifier's own vocabulary words is therefore not treated as an identifier. Hostnames,
 * registrable domains and full URLs are never exempted: those appear nowhere in this template
 * for any legitimate reason.
 */
function vendorVocabulary() {
  const tokens = new Set();
  for (const entry of [...TRACKERS, ...CMPS]) {
    tokens.add(String(entry.id).toLowerCase());
    for (const token of String(entry.name).toLowerCase().split(/[^a-z0-9]+/)) {
      if (token) tokens.add(token);
    }
  }
  return tokens;
}

/**
 * Every string drawn from the input that must not appear in the published page.
 *
 * @param {object[]} scans  scan results, optionally carrying a company/client label
 * @returns {string[]} sorted, de-duplicated identifying terms
 */
export function collectIdentifiers(scans) {
  const vocabulary = vendorVocabulary();
  const terms = new Set();

  const add = (value, { vendorExempt = false, minimumLength = 1 } = {}) => {
    const term = String(value ?? '').trim();
    if (term.length < minimumLength) return;
    if (vendorExempt && vocabulary.has(term.toLowerCase())) return;
    terms.add(term);
  };

  for (const scan of Array.isArray(scans) ? scans : []) {
    if (!scan || typeof scan !== 'object') continue;

    for (const field of COMPANY_FIELDS) {
      const value = typeof scan[field] === 'string' ? scan[field].trim() : '';
      if (!value) continue;
      // Whole strings only. Individual words of a company name are deliberately not
      // registered: "Health" out of "Northwind Health" collides with the sector label of a
      // digital-health index and would block a page that leaks nothing. The hostname is the
      // reliable identifier and it is always registered.
      add(value, { vendorExempt: true });
      const withoutSuffix = value.replace(COMPANY_SUFFIX_PATTERN, '').trim();
      if (withoutSuffix && withoutSuffix !== value) add(withoutSuffix, { vendorExempt: true });
    }

    const url = typeof scan.url === 'string' ? scan.url.trim() : '';
    if (!url) continue;

    add(url);
    add(url.replace(/^https?:\/\//i, '').replace(/\/+$/, ''));

    const hostname = hostnameOf(url);
    if (!hostname) continue;

    add(hostname);
    add(hostname.replace(/^www\./i, ''));

    const parsed = parse(hostname);
    if (parsed.domain) add(parsed.domain);
    if (parsed.domainWithoutSuffix) {
      add(parsed.domainWithoutSuffix, {
        vendorExempt: true,
        minimumLength: MINIMUM_DOMAIN_LABEL_LENGTH,
      });
    }
  }

  return [...terms].sort();
}

const HTML_ENTITIES = { '&amp;': '&', '&lt;': '<', '&gt;': '>', '&quot;': '"', '&#39;': "'" };

/**
 * Normalise text so escaping and formatting cannot hide a match. "Acme & Co" reaches the page
 * as "Acme &amp; Co", and a term split across a line break in the source reaches it with a
 * newline in the middle; neither should evade the check.
 */
function normalizeForMatching(text) {
  return (
    String(text ?? '')
      .replace(/&(?:amp|lt|gt|quot|#39);/g, (m) => HTML_ENTITIES[m])
      .toLowerCase()
      // Fold hyphens and underscores to spaces so a hostname label matches its prose form.
      // Without this "acme-corp.com" and "Acme Corp" are different strings to the guard, and
      // the check that is supposed to stop a company being named in a published research
      // document silently passes on exactly the inputs production produces.
      .replace(/[-_]+/g, ' ')
      .replace(/\s+/g, ' ')
      .trim()
  );
}

function occursIn(haystack, term) {
  const needle = normalizeForMatching(term).trim();
  if (!needle) return false;

  // Anything carrying a dot or a slash is a hostname or a URL. Those never appear in this
  // template for legitimate reasons, so a plain substring hit is enough and word boundaries
  // would only weaken the check.
  if (/[./]/.test(needle)) return haystack.includes(needle);

  const escaped = needle.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  const leftBoundary = /^[a-z0-9]/.test(needle) ? '\\b' : '';
  const rightBoundary = /[a-z0-9]$/.test(needle) ? '\\b' : '';
  return new RegExp(`${leftBoundary}${escaped}${rightBoundary}`).test(haystack);
}

/**
 * Verify that no identifying term appears in the rendered page.
 *
 * Throws AnonymityError naming every term that matched. Failing loudly is the point: a page
 * that silently passes an unrun check is worse than no check, because it is trusted.
 *
 * @param {string} html
 * @param {string[]} identifiers
 * @returns {{ checkedTerms: number }}
 */
export function assertAnonymous(html, identifiers) {
  const source = String(html ?? '');
  // Checked twice: as authored, and with tags removed. The second pass catches a term that
  // markup happens to interrupt, such as a name wrapped in emphasis halfway through.
  const haystack = [
    normalizeForMatching(source),
    normalizeForMatching(source.replace(/<[^>]*>/g, ' ')),
  ].join('\n');

  const terms = Array.isArray(identifiers) ? identifiers : [];
  const leaked = terms.filter((term) => occursIn(haystack, term));

  if (leaked.length) {
    // The message has to name the real candidate causes, because the maintainer's instinct on
    // an unexplained block is to switch the guard off. There are three, and only the first is
    // caller-supplied: a sector or period label with a company in it; a sample company that
    // shares a name with one of the enforcement matters this template prints; and a sample
    // company that shares a name with a service in the classifier corpus. The second and third
    // are not caller mistakes and blocking on them is still the right answer — an index of one
    // sector that both scanned a company and names it in the enforcement list reads as an
    // accusation against that company however it was meant.
    throw new AnonymityError(
      `The index would have published ${leaked.length} identifying term(s) from its own ` +
        `input: ${leaked.join(', ')}. The aggregate must name no individual company, so ` +
        'nothing is returned. Check in this order: the sector and period labels, which are ' +
        'the only free text a caller supplies; the enforcement-context list in this module, ' +
        'which names real companies; and the service names in the classifier corpus.',
      leaked
    );
  }

  return { checkedTerms: terms.length };
}

/**
 * Reduce a scan to the only shape allowed to reach the aggregate.
 *
 * This is the strip half of the anonymity story, and it is a whitelist rather than a
 * blacklist on purpose. Nothing is carried over except counts, ids from closed sets and
 * vendor names. In particular the tracker `sample` URLs are dropped: an outbound pixel URL
 * routinely carries the scanned page address in a query parameter (`dl=`, `dr=`, `u=`), which
 * is exactly how an aggregate would identify a company while looking anonymous.
 */
export function anonymizeScan(scan) {
  const exclusionReason = unmeasurableReason(scan);
  if (exclusionReason) return { measured: false, exclusionReason };

  const passes = scan.passes;
  return {
    measured: true,
    exclusionReason: null,
    scannedAt: typeof scan.scannedAt === 'string' ? scan.scannedAt : null,
    riskScore: typeof scan.riskScore === 'number' ? scan.riskScore : null,
    findingIds: (scan.findings ?? []).map((finding) => finding?.id).filter(Boolean),
    consentPlatforms: (scan.cmp ?? []).filter((name) => typeof name === 'string'),
    bannerVisible: Boolean(scan.bannerVisible),
    rejectClicked: Boolean(passes.afterReject?.rejectClicked),
    trackers: {
      baseline: trackerNames(passes.baseline),
      gpc: trackerNames(passes.gpc),
      afterReject: trackerNames(passes.afterReject),
    },
  };
}

/**
 * Services observed in one pass, de-duplicated by name.
 *
 * Only `trackers` is read, never `restrained`. A service that fired while transmitting a
 * consent-denied signal is behaving as designed, and counting it in a prevalence table headed
 * "transmitted before consent" would be the aggregate version of a false positive.
 */
function trackerNames(pass) {
  const byName = new Map();
  for (const tracker of pass?.trackers ?? []) {
    if (!tracker?.name || byName.has(tracker.name)) continue;
    byName.set(tracker.name, {
      name: tracker.name,
      category: tracker.category ?? null,
      severity: tracker.severity ?? null,
    });
  }
  return [...byName.values()];
}

/**
 * Why a scan cannot contribute to the statistics, or null if it can.
 *
 * A scan that failed records no trackers, which is indistinguishable from a site that
 * transmits none. Letting failures into the denominator would push every headline share
 * downward and make the index quietly wrong in the direction that looks reassuring.
 *
 * A PARTIAL capture is a failed capture here, and this is the case that is easy to get wrong.
 * `capture.usable` only asks whether any conclusion at all can be drawn, which is the right
 * question for a single client report; a scan whose baseline pass timed out is still usable
 * for the two passes that loaded. In an aggregate it is not, because the pass that failed
 * contributes a zero to every share drawn from it — a site whose baseline never loaded would
 * be counted as one that transmitted nothing before consent. One denominator serves every
 * figure on the page, so a site has to have produced all three passes to be in it.
 */
function unmeasurableReason(scan) {
  if (!scan || typeof scan !== 'object') return 'not a scan result';
  if (scan.error && !scan.passes) return 'the scan did not run';
  if (!scan.passes?.baseline) return 'the scan produced no passes';

  if (scan.capture) {
    if (scan.capture.usable === false) return 'the page could not be loaded';
    if (scan.capture.ok === false) return 'only some of the three passes loaded';
  }

  // Fallback for scans recorded without a capture summary, and a cross-check for scans that
  // carry one. Judged on the passes themselves so a stored result from an older engine, or a
  // capture summary that disagrees with its own passes, still fails toward exclusion.
  const anyPassFailed = ['baseline', 'gpc', 'afterReject'].some((name) => scan.passes[name]?.error);
  if (anyPassFailed) return 'a capture pass did not complete';

  return null;
}

/* -------------------------------------------------------------------------- */
/* Statistics                                                                  */
/* -------------------------------------------------------------------------- */

/**
 * A count against the denominator it was drawn from.
 *
 * `share` is null rather than 0 when the denominator is empty. Printing "0%" for a statistic
 * with nothing underneath it is a claim about a market that was never measured.
 */
function proportion(count, denominator) {
  return { count, denominator, share: denominator > 0 ? count / denominator : null };
}

/**
 * Quantile by linear interpolation between order statistics — the definition behind
 * Excel's PERCENTILE.INC and R's default type 7.
 *
 * Stated explicitly here and in the published methodology because quartiles differ by up to a
 * whole bucket between conventions, and a reader recomputing the numbers from a published
 * dataset needs to know which one produced them.
 *
 * @param {number[]} sortedValues  ascending
 * @param {number} probability     0..1
 */
export function quantile(sortedValues, probability) {
  if (!Array.isArray(sortedValues) || sortedValues.length === 0) return null;
  if (sortedValues.length === 1) return sortedValues[0];

  const position = (sortedValues.length - 1) * probability;
  const lower = Math.floor(position);
  const upper = Math.ceil(position);
  if (lower === upper) return sortedValues[lower];

  return sortedValues[lower] + (sortedValues[upper] - sortedValues[lower]) * (position - lower);
}

function riskDistribution(views) {
  const values = views
    .map((view) => view.riskScore)
    .filter((value) => typeof value === 'number' && Number.isFinite(value))
    .sort((a, b) => a - b);

  const buckets = RISK_BUCKETS.map((bucket) => {
    const count = values.filter((value) => value >= bucket.from && value <= bucket.to).length;
    return { ...bucket, ...proportion(count, values.length) };
  });

  if (!values.length) {
    return { count: 0, min: null, q1: null, median: null, q3: null, max: null, mean: null, buckets };
  }

  const mean = values.reduce((sum, value) => sum + value, 0) / values.length;

  return {
    count: values.length,
    min: values[0],
    q1: quantile(values, 0.25),
    median: quantile(values, 0.5),
    q3: quantile(values, 0.75),
    max: values[values.length - 1],
    mean: Math.round(mean * 10) / 10,
    buckets,
  };
}

/**
 * How many sites in the sample showed each service at least once.
 *
 * Counted per site, not per request: a site that loads the same pixel forty times is one site
 * with that pixel. Request counts would make the table a measure of page weight rather than
 * of how widespread a practice is.
 */
function trackerPrevalence(views, pick) {
  const rows = new Map();

  for (const view of views) {
    for (const tracker of pick(view)) {
      const row = rows.get(tracker.name) ?? {
        name: tracker.name,
        category: tracker.category,
        severity: tracker.severity,
        count: 0,
      };
      row.count += 1;
      rows.set(tracker.name, row);
    }
  }

  return [...rows.values()]
    .map((row) => ({ ...row, ...proportion(row.count, views.length) }))
    .sort(
      (a, b) =>
        b.count - a.count ||
        (SEVERITY_RANK[b.severity] ?? 0) - (SEVERITY_RANK[a.severity] ?? 0) ||
        a.name.localeCompare(b.name)
    );
}

const canonicalRank = (id) => (FINDING_ORDER.indexOf(id) + 1 || Number.MAX_SAFE_INTEGER);

function unionOfPasses(view) {
  const byName = new Map();
  for (const pass of ['baseline', 'gpc', 'afterReject']) {
    for (const tracker of view.trackers[pass]) {
      if (!byName.has(tracker.name)) byName.set(tracker.name, tracker);
    }
  }
  return [...byName.values()];
}

/**
 * Build the aggregate index.
 *
 * The returned object is safe to serialise and publish alongside the page: it contains no
 * URL, hostname or company name, because nothing but `anonymizeScan`'s whitelist ever reaches
 * it. The list of identifying terms the page must be checked against travels on a
 * non-enumerable `sourceIdentifiers` property, so `JSON.stringify(index)` cannot carry a
 * client's hostname into a file someone later publishes.
 *
 * @param {object[]} scans  results from scanConsent, optionally carrying a company label
 * @param {{ sector?: string, period?: string }} options
 */
export function buildIndex(scans, { sector = 'Unspecified sector', period = null } = {}) {
  const input = Array.isArray(scans) ? scans : [];
  const identifiers = collectIdentifiers(input);
  const anonymized = input.map(anonymizeScan);
  const views = anonymized.filter((view) => view.measured);

  const exclusionCounts = new Map();
  for (const view of anonymized) {
    if (view.measured) continue;
    exclusionCounts.set(view.exclusionReason, (exclusionCounts.get(view.exclusionReason) ?? 0) + 1);
  }

  const observedDates = views
    .map((view) => view.scannedAt)
    .filter(Boolean)
    .sort();

  const measured = views.length;
  const hasAnyFinding = (view) => view.findingIds.length > 0;
  const hasFinding = (view, id) => view.findingIds.includes(id);
  const transmittedPreConsent = (view) => view.trackers.baseline.length > 0;
  const hasPlatform = (view) => view.consentPlatforms.length > 0;
  const hasConsentMechanism = (view) => hasPlatform(view) || view.bannerVisible;

  const observedFindingIds = [
    ...FINDING_ORDER,
    ...new Set(views.flatMap((view) => view.findingIds).filter((id) => !FINDING_ORDER.includes(id))),
  ];

  const platformViews = views.filter(hasPlatform);
  const mechanismViews = views.filter(hasConsentMechanism);

  const platformRows = new Map();
  for (const view of views) {
    for (const name of new Set(view.consentPlatforms)) {
      platformRows.set(name, (platformRows.get(name) ?? 0) + 1);
    }
  }

  const index = {
    sector,
    period,
    generatedAt: new Date().toISOString(),

    sample: {
      submitted: input.length,
      measured,
      excluded: input.length - measured,
      exclusions: [...exclusionCounts.entries()]
        .map(([reason, count]) => ({ reason, count }))
        .sort((a, b) => b.count - a.count),
      observedFrom: observedDates[0] ?? null,
      observedTo: observedDates[observedDates.length - 1] ?? null,
    },

    findings: {
      anyFinding: proportion(views.filter(hasAnyFinding).length, measured),
      byId: observedFindingIds
        .map((id) => ({
          id,
          title: FINDING_TITLES[id] ?? id,
          ...proportion(views.filter((view) => hasFinding(view, id)).length, measured),
        }))
        // Ties break toward the canonical order, and an id this module does not recognise
        // sorts last rather than first — a new finding type should not silently lead the
        // table before anyone has written a title for it.
        .sort((a, b) => b.count - a.count || canonicalRank(a.id) - canonicalRank(b.id)),
    },

    consentPlatform: {
      deployed: proportion(platformViews.length, measured),
      // The statistic the index exists to publish. A company that bought and deployed a
      // consent platform has already decided it needs consent and has already paid for the
      // tool; a high share here says the purchase did not, by itself, change what the browser
      // transmitted. That is news, and it is also the sentence that makes a prospect read the
      // second paragraph.
      transmittedPreConsentDespitePlatform: {
        ...proportion(platformViews.filter(transmittedPreConsent).length, measured),
        shareOfPlatformSites:
          platformViews.length > 0
            ? platformViews.filter(transmittedPreConsent).length / platformViews.length
            : null,
        platformSiteCount: platformViews.length,
      },
      platforms: [...platformRows.entries()]
        .map(([name, count]) => ({ name, ...proportion(count, measured) }))
        .sort((a, b) => b.count - a.count || a.name.localeCompare(b.name)),
    },

    rejectControl: {
      consentMechanismPresent: proportion(mechanismViews.length, measured),
      // Denominator is sites that presented a consent mechanism at all. Measured against the
      // whole sample this number would silently fold in sites that show no banner, which is a
      // different observation entirely.
      noRejectControlFound: proportion(
        mechanismViews.filter((view) => !view.rejectClicked).length,
        mechanismViews.length
      ),
    },

    trackers: {
      overall: trackerPrevalence(views, unionOfPasses),
      byPass: {
        baseline: trackerPrevalence(views, (view) => view.trackers.baseline),
        gpc: trackerPrevalence(views, (view) => view.trackers.gpc),
        afterReject: trackerPrevalence(views, (view) => view.trackers.afterReject),
      },
    },

    riskScore: riskDistribution(views),

    anonymity: {
      identifierCount: identifiers.length,
      method:
        'Each scan is reduced to counts, finding ids from a closed set, and service names ' +
        'from the classifier corpus before aggregation. URLs, hostnames, company labels and ' +
        'sample request URLs are dropped rather than filtered. The rendered page is then ' +
        'checked against every identifying term found in the input and rendering fails if ' +
        'any of them would appear.',
    },
  };

  Object.defineProperty(index, 'sourceIdentifiers', {
    value: identifiers,
    enumerable: false,
    writable: false,
    configurable: false,
  });

  return index;
}

/* -------------------------------------------------------------------------- */
/* Rendering                                                                   */
/* -------------------------------------------------------------------------- */

const percent = (share) => (share === null || share === undefined ? '—' : `${Math.round(share * 100)}%`);

const barWidth = (share) => (share === null || share === undefined ? 0 : Math.round(share * 1000) / 10);

const oneDecimal = (value) =>
  value === null || value === undefined ? '—' : String(Math.round(value * 10) / 10);

const isoDate = (value) => {
  if (!value) return null;
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? null : date.toISOString().slice(0, 10);
};

const countOf = (stat) =>
  stat.denominator > 0 ? `${stat.count} of ${stat.denominator}` : 'no sites measured';

function barRow(label, stat) {
  return `
  <div class="barrow">
    <div class="barlabel">${escapeHtml(label)}</div>
    <div class="bartrack"><div class="barfill" style="width:${barWidth(stat.share)}%"></div></div>
    <div class="barvalue">${percent(stat.share)} <span class="muted">(${escapeHtml(countOf(stat))})</span></div>
  </div>`;
}

function trackerTable(rows, limit) {
  if (!rows.length) return '<p class="muted">No third-party services were observed in this pass.</p>';

  const body = rows
    .slice(0, limit)
    .map(
      (row) => `
      <tr>
        <td>${escapeHtml(row.name)}<div class="muted">${escapeHtml(row.category ?? 'uncategorised')}</div></td>
        <td class="num">${escapeHtml(countOf(row))}</td>
        <td class="barcell">
          <div class="bartrack"><div class="barfill" style="width:${barWidth(row.share)}%"></div></div>
        </td>
        <td class="num">${percent(row.share)}</td>
      </tr>`
    )
    .join('');

  const note =
    rows.length > limit
      ? `<p class="muted">Showing the ${limit} most prevalent of ${rows.length} services observed.</p>`
      : '';

  return `<div class="tablewrap"><table>
    <thead><tr><th>Service</th><th class="num">Sites</th><th>Prevalence</th><th class="num">Share</th></tr></thead>
    <tbody>${body}</tbody></table></div>${note}`;
}

function compactTrackerList(rows, limit) {
  if (!rows.length) return '<p class="muted">None observed.</p>';
  return `<ol class="compact">${rows
    .slice(0, limit)
    .map((row) => `<li>${escapeHtml(row.name)} <span class="muted">${percent(row.share)}</span></li>`)
    .join('')}</ol>`;
}

/**
 * A box plot drawn with three positioned divs, because the exposure score is already a 0–100
 * scale and needs no axis transform. No charting library and no script: the page has to
 * survive being emailed, mirrored and opened offline by a journalist, and any external
 * request would also be a way for the artifact to phone home about who is reading it.
 */
function spreadPlot(distribution) {
  if (distribution.count === 0) return '';

  const clamp = (value) => Math.max(0, Math.min(100, value));

  // Each mark has a minimum width so that a distribution with no spread — every site scoring
  // the same — is still drawn rather than collapsing to nothing. That minimum has to be taken
  // out of the left edge when the mark sits at the top of the scale, or the mark starts at
  // 100% and is drawn entirely outside the track.
  const mark = (from, to, minimumWidth) => {
    const width = Math.max(minimumWidth, clamp(to) - clamp(from));
    return { left: Math.min(clamp(from), 100 - width), width };
  };

  const whisker = mark(distribution.min, distribution.max, 0.4);
  const box = mark(distribution.q1, distribution.q3, 0.6);

  return `
  <div class="spread" role="img" aria-label="Exposure scores range from ${escapeHtml(oneDecimal(distribution.min))} to ${escapeHtml(oneDecimal(distribution.max))}, with a median of ${escapeHtml(oneDecimal(distribution.median))}">
    <div class="whisker" style="left:${whisker.left}%;width:${whisker.width}%"></div>
    <div class="box" style="left:${box.left}%;width:${box.width}%"></div>
    <div class="median" style="left:${clamp(distribution.median)}%"></div>
  </div>
  <div class="scale"><span>0</span><span>25</span><span>50</span><span>75</span><span>100</span></div>
  <p class="muted">Box spans the interquartile range (${escapeHtml(oneDecimal(distribution.q1))}–${escapeHtml(oneDecimal(distribution.q3))});
  the line marks the median (${escapeHtml(oneDecimal(distribution.median))}); the rule spans the observed range
  (${escapeHtml(oneDecimal(distribution.min))}–${escapeHtml(oneDecimal(distribution.max))}).</p>`;
}

/**
 * Render the index to a standalone HTML page.
 *
 * Throws AnonymityError rather than returning a page that would name anyone. It also throws
 * when the identifier list is missing on an index that had identifiers — which happens when an
 * index is serialised and reloaded — because rendering without running the check would produce
 * an unverified page indistinguishable from a verified one.
 *
 * @param {ReturnType<typeof buildIndex>} index
 * @returns {string} complete HTML document
 */
/**
 * Below this many measured sites, publishing is refused outright.
 *
 * Anonymity is a statistical property, not a string-matching one. In an index built from one
 * company, every figure on the page describes that company exactly, and no amount of name
 * scrubbing changes it. A reader who knows which sector was sampled can often re-identify
 * members of a small set from the cell values alone.
 */
export const MINIMUM_SAMPLE = 20;

/** Cells describing fewer sites than this are rolled into an "other" bucket. */
const MINIMUM_CELL = 3;

export function renderIndexHtml(index, { minimumSample = MINIMUM_SAMPLE } = {}) {
  // minimumSample is overridable only so tests can exercise rendering on small fixtures.
  // Lowering it for a real publication defeats the point: the floor exists because a small
  // sample identifies its members whatever the string scrubbing does.
  const measured = index?.sample?.measured ?? 0;

  // An index of nothing identifies nobody, so the floor does not apply to it. It renders the
  // honest "nothing was measured" page instead, which is a legitimate output.
  if (measured > 0 && measured < minimumSample) {
    throw new AnonymityError(
      `Refusing to render an index of ${measured} site(s). A published index needs at least ` +
        `${minimumSample} measured sites, because below that the statistics describe ` +
        'identifiable companies however thoroughly names are removed.'
    );
  }

  const expectedIdentifiers = Number(index?.anonymity?.identifierCount ?? 0);
  const identifiers = Array.isArray(index?.sourceIdentifiers) ? index.sourceIdentifiers : null;

  if (!identifiers && expectedIdentifiers > 0) {
    throw new AnonymityError(
      `This index was built from ${expectedIdentifiers} identifying term(s) but no longer ` +
        'carries the list to check the page against. That list does not survive ' +
        'serialisation. Rebuild the index with buildIndex(scans) before rendering rather ' +
        'than publishing a page whose anonymity was never verified.'
    );
  }

  if (identifiers && identifiers.length !== expectedIdentifiers) {
    throw new AnonymityError(
      'The identifier list does not match the count recorded when this index was built ' +
        `(${identifiers.length} present, ${expectedIdentifiers} expected). Rebuild the index.`
    );
  }

  const html = composeIndexHtml(index);
  assertAnonymous(html, identifiers ?? []);
  return html;
}

function composeIndexHtml(index) {
  const corpus = corpusStats();
  const sample = index.sample;
  const measured = sample.measured;
  const distribution = index.riskScore;
  const platform = index.consentPlatform;

  const observedFrom = isoDate(sample.observedFrom);
  const observedTo = isoDate(sample.observedTo);
  const observedRange =
    observedFrom && observedTo
      ? observedFrom === observedTo
        ? observedFrom
        : `${observedFrom} to ${observedTo}`
      : 'dates not recorded';

  const periodLabel = index.period || (observedFrom && observedTo ? observedRange : 'period not stated');

  const headline = [
    {
      figure: percent(index.findings.anyFinding.share),
      label: 'of measured sites showed at least one of the observations below',
      note: countOf(index.findings.anyFinding),
    },
    {
      figure: percent(platform.transmittedPreConsentDespitePlatform.shareOfPlatformSites),
      label: 'of sites running a consent platform still transmitted to third parties before any consent interaction',
      note: `${platform.transmittedPreConsentDespitePlatform.count} of ${platform.transmittedPreConsentDespitePlatform.platformSiteCount} sites with a platform`,
    },
    {
      figure: percent(index.rejectControl.noRejectControlFound.share),
      // The denominator is sites that showed a banner OR ran an identifiable consent platform,
      // not sites that showed a banner. A platform detected only in network traffic — a banner
      // gated to another region, for instance — is in this denominator without any banner
      // having been observed, so a card reading "of sites showing a consent banner" would
      // assert something about a banner this scan never saw.
      label: 'of sites presenting a consent mechanism had no reject control that automated interaction could reach at banner level',
      note: countOf(index.rejectControl.noRejectControlFound),
    },
  ];

  const headlineCards = headline
    .map(
      (card) => `
      <article class="stat">
        <b>${escapeHtml(card.figure)}</b>
        <p>${escapeHtml(card.label)}</p>
        <p class="muted">${escapeHtml(card.note)}</p>
      </article>`
    )
    .join('');

  const findingBars = index.findings.byId.map((row) => barRow(row.title, row)).join('');

  const distributionBars = distribution.buckets
    .map((bucket) => barRow(`Exposure score ${bucket.label}`, bucket))
    .join('');

  const platformRows = platform.platforms.length
    ? `<div class="tablewrap"><table>
        <thead><tr><th>Consent platform</th><th class="num">Sites</th><th class="num">Share</th></tr></thead>
        <tbody>${platform.platforms
          .map(
            (row) =>
              `<tr><td>${escapeHtml(row.name)}</td><td class="num">${escapeHtml(countOf(row))}</td><td class="num">${percent(row.share)}</td></tr>`
          )
          .join('')}</tbody></table></div>`
    : '<p class="muted">No consent platform was identified by name on any site measured.</p>';

  const exclusions = sample.exclusions.length
    ? `<ul>${sample.exclusions
        .map((row) => `<li>${escapeHtml(row.count)} — ${escapeHtml(row.reason)}</li>`)
        .join('')}</ul>`
    : sample.submitted === 0
      ? '<p class="muted">No sites were submitted.</p>'
      : '<p class="muted">Every site submitted produced a usable capture.</p>';

  const enforcement = ENFORCEMENT_CONTEXT.map(
    (item) =>
      `<li><strong>${escapeHtml(item.who)}</strong> — ${escapeHtml(item.amount)} <span class="muted">(${escapeHtml(item.when)})</span></li>`
  ).join('');

  const body = measured
    ? `
<h2>Headline figures</h2>
<div class="stats">${headlineCards}</div>

<h2>What was observed, by type</h2>
<p class="muted">Each bar is the share of measured sites on which that observation was recorded at
least once. A site can appear in more than one row.</p>
<div class="bars">${findingBars}</div>

<h2>Sites running a consent platform</h2>
<p>${escapeHtml(percent(platform.deployed.share))} of measured sites
(${escapeHtml(countOf(platform.deployed))}) were running a consent platform that could be identified
by name. Of those, ${escapeHtml(platform.transmittedPreConsentDespitePlatform.count)}
(${escapeHtml(percent(platform.transmittedPreConsentDespitePlatform.shareOfPlatformSites))})
transmitted to at least one third-party service before any consent interaction took place.</p>
<p class="muted">Recorded because deploying a consent platform is a deliberate, paid decision: these
sites had already concluded they needed consent management and had already bought a tool. The
observation is about configuration and drift, not about the platforms themselves — a consent
platform reports what a site declared, not what its browser did.</p>
${platformRows}

<h2>Reject controls</h2>
<p>${escapeHtml(String(index.rejectControl.consentMechanismPresent.count))} of the
${escapeHtml(String(measured))} measured sites presented a consent banner or an identifiable consent
platform. On ${escapeHtml(String(index.rejectControl.noRejectControlFound.count))} of those
${escapeHtml(String(index.rejectControl.noRejectControlFound.denominator))} sites
(${escapeHtml(percent(index.rejectControl.noRejectControlFound.share))}) no reject or decline control
could be found at the same level as accept by automated interaction.</p>
<p class="muted">Read this figure as an upper bound on what automation could reach, not as a count of
banners without a reject option. A control reachable only through a preferences dialog is not found
by this method and would need a manual check before anything is concluded from it.</p>

<h2>Exposure score distribution</h2>
<p class="muted">The exposure score is this engine's own 0–100 summary of a single scan, weighted by
the severity of what was observed. It is an internal ranking device, not a compliance rating, and it
has no standing outside this dataset.</p>
<div class="bars">${distributionBars}</div>
${spreadPlot(distribution)}
<div class="tablewrap"><table>
  <thead><tr><th>Minimum</th><th>First quartile</th><th>Median</th><th>Third quartile</th><th>Maximum</th><th>Mean</th></tr></thead>
  <tbody><tr>
    <td>${escapeHtml(oneDecimal(distribution.min))}</td>
    <td>${escapeHtml(oneDecimal(distribution.q1))}</td>
    <td>${escapeHtml(oneDecimal(distribution.median))}</td>
    <td>${escapeHtml(oneDecimal(distribution.q3))}</td>
    <td>${escapeHtml(oneDecimal(distribution.max))}</td>
    <td>${escapeHtml(oneDecimal(distribution.mean))}</td>
  </tr></tbody></table></div>

<h2>Most prevalent third-party services</h2>
<p class="muted">Counted once per site, across all three passes. A site loading the same pixel
repeatedly counts once.</p>
${trackerTable(index.trackers.overall, 20)}

<h3>By pass</h3>
<div class="grid">
  <section>
    <h4>Before any interaction</h4>
    <p class="muted">Observed on load, with nothing clicked.</p>
    ${compactTrackerList(index.trackers.byPass.baseline, 8)}
  </section>
  <section>
    <h4>With Global Privacy Control enabled</h4>
    <p class="muted">Observed while the browser advertised <code>Sec-GPC: 1</code>.</p>
    ${compactTrackerList(index.trackers.byPass.gpc, 8)}
  </section>
  <section>
    <h4>After the reject control was clicked</h4>
    <p class="muted">Observed only after the banner's own reject control was activated.</p>
    ${compactTrackerList(index.trackers.byPass.afterReject, 8)}
  </section>
</div>`
    : `
<h2>No measurable sites in this sample</h2>
<p>Nothing was measured, so no statistic is reported. An empty sample and a clean sample look
identical in a table of zeroes and mean opposite things, so no figures are shown at all. The
reasons are listed under the method below.</p>`;

  return `<!doctype html>
<html lang="en"><head><meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<title>Tracking &amp; consent index — ${escapeHtml(index.sector)}</title>
<style>
  :root { --ink:#0f172a; --muted:#64748b; --line:#e2e8f0; --bg:#ffffff; --panel:#f8fafc;
    --bar:#94a3b8; --barstrong:#475569; }
  @media (prefers-color-scheme: dark) {
    :root { --ink:#e2e8f0; --muted:#94a3b8; --line:#1e293b; --bg:#0b1120; --panel:#111827;
      --bar:#475569; --barstrong:#94a3b8; }
  }
  * { box-sizing:border-box; }
  body { margin:0; padding:2.5rem 1.25rem 4rem; background:var(--bg); color:var(--ink);
    font:16px/1.65 ui-sans-serif,system-ui,-apple-system,"Segoe UI",Roboto,sans-serif; }
  .wrap { max-width:56rem; margin:0 auto; }
  h1 { font-size:1.9rem; margin:0 0 .35rem; letter-spacing:-.02em; }
  h2 { font-size:1.2rem; margin:2.5rem 0 .75rem; letter-spacing:-.01em; }
  h3 { font-size:1rem; margin:1.75rem 0 .4rem; }
  h4 { font-size:.9rem; margin:0 0 .3rem; }
  p { margin:.6rem 0; }
  .muted { color:var(--muted); font-size:.9rem; }
  .lede { font-size:1.05rem; color:var(--muted); margin:0 0 1.75rem; }
  .stats { display:grid; grid-template-columns:repeat(auto-fit,minmax(14rem,1fr)); gap:.85rem; }
  .stat { background:var(--panel); border:1px solid var(--line); border-radius:.6rem;
    padding:1.1rem 1.15rem; }
  .stat b { display:block; font-size:2.1rem; letter-spacing:-.03em; line-height:1.1; }
  .stat p { margin:.4rem 0 0; font-size:.92rem; }
  .bars { margin:.9rem 0 1.2rem; }
  .barrow { display:grid; grid-template-columns:minmax(0,1fr) minmax(6rem,10rem) minmax(0,11rem);
    gap:.6rem; align-items:center; padding:.35rem 0; border-bottom:1px solid var(--line); }
  .barrow:last-child { border-bottom:0; }
  .barlabel { font-size:.9rem; }
  .barvalue { font-size:.85rem; text-align:right; }
  .bartrack { background:var(--panel); border:1px solid var(--line); border-radius:.25rem;
    height:.7rem; overflow:hidden; }
  .barfill { background:var(--bar); height:100%; }
  @media (max-width:34rem) {
    .barrow { grid-template-columns:1fr; gap:.25rem; }
    .barvalue { text-align:left; }
  }
  /* overflow:hidden is a backstop, not the mechanism — spreadPlot clamps every mark inside the
     track. It is here because an absolutely positioned mark that escaped would widen the whole
     document rather than scrolling inside its own container. */
  .spread { position:relative; height:2.4rem; margin:1rem 0 .2rem; overflow:hidden; }
  .whisker { position:absolute; top:1.1rem; height:2px; background:var(--bar); }
  .box { position:absolute; top:.45rem; height:1.4rem; background:var(--panel);
    border:1px solid var(--barstrong); border-radius:.2rem; }
  /* margin-left keeps the rule visible when the median sits at 100, where its left edge would
     otherwise be the track's right edge and the whole line would fall outside it. */
  .median { position:absolute; top:.3rem; height:1.7rem; width:2px; margin-left:-1px;
    background:var(--barstrong); }
  .scale { display:flex; justify-content:space-between; font-size:.75rem; color:var(--muted); }
  .grid { display:grid; grid-template-columns:repeat(auto-fit,minmax(15rem,1fr)); gap:1.25rem; }
  .tablewrap { overflow-x:auto; }
  table { width:100%; border-collapse:collapse; font-size:.88rem; margin-top:.6rem;
    min-width:24rem; }
  th,td { text-align:left; padding:.5rem .6rem; border-bottom:1px solid var(--line);
    vertical-align:top; }
  th { font-size:.75rem; text-transform:uppercase; letter-spacing:.06em; color:var(--muted); }
  td.num, th.num { text-align:right; white-space:nowrap; }
  td.barcell { width:35%; min-width:6rem; }
  td.barcell .bartrack { margin-top:.25rem; }
  code { font:.82rem ui-monospace,SFMono-Regular,Menlo,monospace; word-break:break-all; }
  ul,ol { padding-left:1.15rem; }
  li { margin:.25rem 0; font-size:.92rem; }
  ol.compact { margin:.35rem 0 0; }
  .note { background:var(--panel); border:1px solid var(--line); border-radius:.6rem;
    padding:1rem 1.15rem; font-size:.88rem; color:var(--muted); margin-top:2.5rem; }
</style></head>
<body><div class="wrap">

<h1>Tracking &amp; consent index — ${escapeHtml(index.sector)}</h1>
<p class="lede">${escapeHtml(periodLabel)} · ${escapeHtml(String(measured))} sites measured ·
no individual company is named in this document</p>

<p>This index records what browsers transmitted on one page of each site in a sample of
${escapeHtml(String(sample.submitted))} companies. Every figure below is computed over the
${escapeHtml(String(measured))} of those sites that produced a usable capture. Every measurement was
taken from the public internet. No company was contacted, no credentials were used, and no company's
systems or data were accessed. The figures describe the sample in aggregate and support no conclusion
about any individual company, including any company that believes it recognises itself here.</p>

${body}

<h2>Method</h2>
<ul>
  <li><strong>Sample.</strong> ${escapeHtml(String(sample.submitted))} sites submitted;
      ${escapeHtml(String(sample.measured))} produced a usable capture and are the denominator for
      every figure above; ${escapeHtml(String(sample.excluded))} were excluded.</li>
  <li><strong>Dates.</strong> Measurements were taken over the window ${escapeHtml(observedRange)}.
      Each figure is a snapshot of that window and nothing else — tag configurations change
      weekly.</li>
  <li><strong>What was measured.</strong> One page per site, loaded three times with a clean browser
      profile each time: once with no interaction; once with the Global Privacy Control signal
      advertised as <code>Sec-GPC: 1</code> and <code>navigator.globalPrivacyControl = true</code>;
      and once after activating the consent banner's own reject control, recording only requests
      issued after that click.</li>
  <li><strong>How services were identified.</strong> ${escapeHtml(String(corpus.curatedTrackers))}
      curated service fingerprints, supplemented by a public dataset of
      ${escapeHtml(String(corpus.broadEntities))} categorised third-party entities
      (${escapeHtml(corpus.broadSource)}).</li>
  <li><strong>Counting rule.</strong> Every share is a share of sites, counted once per site, never
      a share of requests.</li>
  <li><strong>Quartiles.</strong> Linear interpolation between order statistics — the definition
      used by <code>PERCENTILE.INC</code> and by R's default quantile type — so that anyone
      recomputing these numbers gets the same ones.</li>
  <li><strong>Services that signalled consent denied are excluded from every count.</strong> A tag
      firing while transmitting a consent-denied signal, as Google Consent Mode and Meta's Limited
      Data Use are designed to do, is not counted as pre-consent transmission. This makes the
      figures above lower than a naive request count would produce.</li>
</ul>

<h3>Why sites were excluded</h3>
${exclusions}
<p class="muted">Excluded sites are removed from the denominator rather than counted as clean. A
capture that failed observes no trackers, which is indistinguishable from a site that transmits
none, and folding those together would push every figure here downward.</p>

<h2>What this method cannot see</h2>
<p class="muted">Stated plainly, because the numbers above are more useful with their limits attached
than without them. Each of these makes the reported shares an understatement rather than an
overstatement.</p>
<ul>
  <li><strong>Server-side tagging.</strong> Tags routed through a company's own domain or through a
      server-side container are indistinguishable from ordinary first-party traffic when observed
      from outside. Data can be forwarded to third parties without appearing in any figure here.</li>
  <li><strong>First-party proxied and CNAME-cloaked trackers.</strong> The same limitation: a
      tracker served from a subdomain of the site is not counted as third-party.</li>
  <li><strong>One page per site, one moment.</strong> Only a single page was tested on each site.
      Behaviour commonly differs on checkout, account and search pages, which are the pages where
      the data involved is most sensitive.</li>
  <li><strong>One geography, one profile.</strong> Every load came from a single location with a
      single browser profile. Sites frequently vary tag behaviour by region, by consent framework,
      and by returning-visitor state.</li>
  <li><strong>Reject controls behind a preferences dialog.</strong> Automated interaction finds
      controls presented at banner level. A reject path that exists only inside a settings dialog is
      recorded here as not found, which is a statement about automated reachability, not about
      whether the control exists.</li>
  <li><strong>A request is not proof of what it carried.</strong> Observing that a request was sent
      is not evidence that personal data was shared. The figures describe network behaviour, which
      is the only thing this method observes.</li>
</ul>

<h2>Why this was measured</h2>
<p class="muted">Public enforcement activity in this area during 2026, included as context for why
this behaviour is worth measuring. No company in this sample is connected to any of these matters,
and no inference about any company should be drawn from them.</p>
<ul>${enforcement}</ul>

<div class="note">
  <strong>Scope.</strong> This is an aggregate technical observation of network behaviour, produced
  by automated testing from the public internet. It is not legal advice, and it states no conclusion
  about the legal position or compliance status of any company, named or unnamed. Whether any
  behaviour described here carries legal significance depends on facts that cannot be observed from
  outside — data-sharing agreements, the categories of data involved, and the jurisdictions of the
  visitors concerned. Those questions are for qualified counsel. No individual company is identified
  in this document, and the rendering process refuses to produce this page if any company name,
  hostname or URL from the underlying dataset would appear in it.
</div>

</div></body></html>`;
}
