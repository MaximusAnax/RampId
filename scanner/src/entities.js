/**
 * Hybrid request classifier.
 *
 * Two data sources, deliberately, because they solve different problems:
 *
 *   CURATED (trackers.js) - about 25 services chosen for litigation relevance. Each carries a
 *   severity and a plain-English description of what it does. This is what the client report
 *   is built from, because "Hotjar records keystrokes and replays the session" is a sentence a
 *   general counsel can act on, and no generic dataset will produce it.
 *
 *   BROAD (third-party-web) - 2,142 categorized entities maintained from HTTP Archive crawl
 *   data, MIT licensed. This exists to catch the long tail. Without it the scanner silently
 *   misses anything not hand-listed, and a report that misses trackers the client's own
 *   engineer can see in DevTools is worse than no report at all.
 *
 * A licensing note that matters commercially: the obvious choice here was Ghostery's
 * TrackerDB, which is far richer. It is licensed CC-BY-NC-SA-4.0 - NonCommercial - so it
 * cannot ship in a paid product. third-party-web is MIT and can. This is exactly the kind of
 * trap worth being explicit about, since the NonCommercial term is easy to miss and the
 * consequence lands after you already have customers.
 */

// third-party-web ships CommonJS, so its exports have to come off the default import.
import thirdPartyWeb from 'third-party-web';
import { parse } from 'tldts';

const { getEntity } = thirdPartyWeb;
import { TRACKERS, CMPS, SEVERITY_RANK } from './trackers.js';
import { assessTrackerRequest } from './consentmode.js';

/**
 * third-party-web categories that represent third-party data collection worth reporting.
 * 'cdn', 'hosting', 'video' and 'content' are deliberately excluded: a font or an image CDN
 * firing before consent is not the finding anyone is buying, and including it would bury the
 * signal that matters under noise the reader will dismiss.
 */
const REPORTABLE_CATEGORIES = new Set([
  'ad',
  'analytics',
  'social',
  'marketing',
  'tag-manager',
  'customer-success',
]);

/** Default severity when only the broad dataset knows about a service. */
const CATEGORY_SEVERITY = {
  ad: 'high',
  social: 'high',
  marketing: 'medium',
  analytics: 'medium',
  'tag-manager': 'medium',
  'customer-success': 'medium',
};

const CATEGORY_EVIDENCE = {
  ad: 'Transmits page or event data to an advertising network.',
  social: 'Transmits page or event data to a social platform.',
  marketing: 'Transmits visitor data to a marketing platform.',
  analytics: 'Transmits page view and interaction data to an analytics service.',
  'tag-manager': 'Loads and orchestrates other third-party tags on the page.',
  'customer-success': 'Transmits visitor interaction data to a customer engagement service.',
};

const lower = (s) => String(s || '').toLowerCase();

/** Curated match, which always wins over the broad dataset. */
function matchCurated(url) {
  const u = lower(url);
  return TRACKERS.find((t) => t.hosts.some((h) => u.includes(lower(h)))) || null;
}

function matchCuratedCmp(url) {
  const u = lower(url);
  return CMPS.find((c) => c.hosts.some((h) => u.includes(lower(h)))) || null;
}

/**
 * Classify a single request URL.
 *
 * Returns null for anything not worth reporting - first-party requests, CDNs, static assets.
 * Returning null generously is intentional: every false entry in a report is a place the
 * reader stops trusting the rest of it.
 */
export function classifyRequest(url, pageHost = null) {
  if (!url || !/^https?:/i.test(url)) return null;

  const parsed = parse(url);
  const requestDomain = parsed.domain;
  if (!requestDomain) return null;

  // First-party requests are out of scope. Note the honest limitation: server-side tagging
  // and CNAME-cloaked trackers deliberately present as first-party, so this check is also
  // the scanner's main blind spot. It is documented rather than papered over.
  if (pageHost) {
    const pageDomain = parse(pageHost).domain;
    if (pageDomain && pageDomain === requestDomain) return null;
  }

  const curatedCmp = matchCuratedCmp(url);
  if (curatedCmp) {
    return {
      kind: 'cmp',
      id: curatedCmp.id,
      name: curatedCmp.name,
      domain: requestDomain,
      source: 'curated',
      url,
    };
  }

  const curated = matchCurated(url);
  if (curated) {
    return {
      kind: 'tracker',
      id: curated.id,
      name: curated.name,
      category: curated.category,
      severity: curated.severity,
      evidence: curated.evidence,
      domain: requestDomain,
      source: 'curated',
      url,
    };
  }

  const entity = getEntity(url);
  if (!entity) return null;

  const category = entity.categories?.[0] ?? entity.category ?? null;

  if (category === 'consent-provider') {
    return {
      kind: 'cmp',
      id: `tpw:${entity.name}`,
      name: entity.name,
      domain: requestDomain,
      source: 'third-party-web',
      url,
    };
  }

  if (!REPORTABLE_CATEGORIES.has(category)) return null;

  return {
    kind: 'tracker',
    id: `tpw:${entity.name}`,
    name: entity.name,
    category,
    severity: CATEGORY_SEVERITY[category] ?? 'medium',
    evidence: CATEGORY_EVIDENCE[category] ?? 'Transmits data to a third-party service.',
    domain: requestDomain,
    source: 'third-party-web',
    url,
  };
}

/**
 * Classify a list of request URLs, deduplicating by service.
 *
 * Keeps up to `sampleLimit` example URLs per service so the report can show a reader exactly
 * what to look for in their own network tab. Evidence a client cannot independently verify in
 * a couple of minutes gets dismissed rather than acted on.
 */
export function classifyAll(urls, { pageHost = null, sampleLimit = 5 } = {}) {
  const trackers = new Map();
  const cmps = new Map();

  for (const url of urls) {
    const hit = classifyRequest(url, pageHost);
    if (!hit) continue;

    const bucket = hit.kind === 'cmp' ? cmps : trackers;
    const existing = bucket.get(hit.id);

    if (existing) {
      if (existing.requests.length < sampleLimit) existing.requests.push(url.slice(0, 400));
    } else {
      bucket.set(hit.id, { ...hit, requests: [url.slice(0, 400)] });
    }
  }

  // Annotate each service with what its own requests advertised about consent.
  //
  // This is the difference between a defensible finding and a false accusation. Google
  // Consent Mode and Meta's Limited Data Use let a tag fire while transmitting a signal
  // that consent was denied — that is the designed, compliant behaviour, not a failure.
  // Reporting those as violations is the fastest way to be dismissed by the one reader
  // who matters: the engineer asked to check the claim.
  //
  // A service counts as having signalled denial only when EVERY observed request did.
  // One unsignalled request is enough to make the service reportable, because that request
  // carried no restriction.
  for (const tracker of trackers.values()) {
    const assessments = tracker.requests.map((u) => assessTrackerRequest(u, tracker));
    const statuses = assessments.map((a) => a.status);

    tracker.consentSignal = statuses.every((s) => s === 'signalled-denied')
      ? 'signalled-denied'
      : statuses.some((s) => s === 'signalled-granted')
        ? 'signalled-granted'
        : 'unknown';

    tracker.consentSignalExplanation = assessments[0]?.explanation ?? null;
  }

  const rank = (t) => SEVERITY_RANK[t.severity] ?? 0;
  const all = [...trackers.values()].sort(
    (a, b) => rank(b) - rank(a) || a.name.localeCompare(b.name)
  );

  return {
    trackers: all,
    // Services that consistently signalled denial are separated rather than dropped: they
    // belong in the report as context ("these fired but restricted themselves"), just not
    // in the findings.
    reportable: all.filter((t) => t.consentSignal !== 'signalled-denied'),
    restrained: all.filter((t) => t.consentSignal === 'signalled-denied'),
    cmps: [...cmps.values()],
  };
}

/** Coverage figures, so the report's methodology section can state them honestly. */
export function corpusStats() {
  return {
    curatedTrackers: TRACKERS.length,
    curatedConsentPlatforms: CMPS.length,
    broadEntities: 2142,
    broadSource: 'third-party-web (MIT), HTTP Archive derived',
  };
}
