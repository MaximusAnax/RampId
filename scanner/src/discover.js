import fs from 'node:fs/promises';
import https from 'node:https';
import http from 'node:http';

/**
 * Target discovery, deduplication, prioritisation and polite scheduling.
 *
 * Prospecting is the one part of this business that consumes founder hours without
 * producing evidence, so this module converts it into compute. A messy list of domains —
 * scraped, exported from a CRM, or typed by hand — goes in; an ordered, deduplicated,
 * rate-limited execution plan comes out, and the operator's only job is to start it.
 *
 * Four things this module is deliberately careful about:
 *
 *   1. Identity. Two hostnames can be one company (www.acme.com, shop.acme.com) and one
 *      hostname suffix can hide hundreds of separate companies (brand.myshopify.com).
 *      Getting this wrong either scans the same buyer three times or collapses an entire
 *      vertical into a single row.
 *   2. Ranking is about the value of the *conversation*, never about how likely a company
 *      is to be doing something wrong. Nothing here predicts a finding: a scan has not run
 *      yet, and a prospect list that pre-judges companies is the demand-letter-mill posture
 *      the business plan names as its highest risk.
 *   3. Unknown signals must not be scored as bad ones. Absence of data about a company is
 *      information about our enrichment, not about the company.
 *   4. Politeness. Everything this engine does is done from the public internet without
 *      permission, which is legitimate exactly as long as it looks like a browser and not
 *      like a load test. The defaults below are conservative on purpose.
 *
 * Composition order is dedupe -> prioritize -> buildScanPlan. Each step accepts either raw
 * strings or the normalized records produced by the previous one, so a caller can skip any
 * of them.
 */

/* ------------------------------------------------------------------ *
 * Hostname identity
 * ------------------------------------------------------------------ */

/**
 * Multi-part public suffixes, embedded rather than pulled from a dependency.
 *
 * `tldts` is already installed for the request classifier and is the right tool when full
 * Public Suffix List fidelity matters. It is not used here on purpose: this list is small,
 * auditable in one screen, and covers what prospect lists actually contain. A caller that
 * hits a gap can pass `extraPublicSuffixes` rather than waiting on this file.
 *
 * The hosted-platform entries at the bottom are the ones that earn their place. A
 * direct-to-consumer retail list — the first vertical the plan targets — is full of Shopify
 * and Squarespace storefronts. Without `myshopify.com` in this table, forty separate brands
 * dedupe into one company called "myshopify.com" and thirty-nine prospects vanish silently.
 *
 * Known limitation: wildcard and exception rules from the real Public Suffix List
 * (`*.ck`, `!www.ck`) are not modelled. An unrecognised multi-part suffix degrades to
 * last-two-labels, which is the correct answer for the overwhelming majority of hosts.
 */
export const PUBLIC_SUFFIXES = new Set([
  // United Kingdom
  'co.uk', 'org.uk', 'me.uk', 'ltd.uk', 'plc.uk', 'net.uk', 'sch.uk', 'ac.uk', 'gov.uk', 'nhs.uk',
  // Ireland, continental Europe
  'co.at', 'or.at', 'com.es', 'org.es', 'com.pt', 'com.gr', 'com.pl', 'com.ro', 'com.ua',
  'com.tr', 'com.ru', 'net.ru', 'org.ru', 'com.cy', 'com.mt', 'com.hr',
  // Asia Pacific
  'com.au', 'net.au', 'org.au', 'edu.au', 'gov.au', 'asn.au', 'id.au',
  'co.nz', 'net.nz', 'org.nz', 'govt.nz', 'ac.nz',
  'co.jp', 'ne.jp', 'or.jp', 'ac.jp', 'go.jp',
  'co.kr', 'or.kr', 'com.cn', 'net.cn', 'org.cn', 'gov.cn',
  'com.hk', 'com.tw', 'com.sg', 'com.my', 'com.ph', 'com.vn', 'com.bd', 'com.pk',
  'co.in', 'net.in', 'org.in', 'co.id', 'or.id', 'web.id', 'co.th', 'in.th',
  // Americas
  'com.br', 'net.br', 'org.br', 'gov.br', 'com.mx', 'com.ar', 'com.co', 'com.pe',
  'com.uy', 'com.ve', 'com.ec', 'com.do',
  // Middle East and Africa
  'co.il', 'org.il', 'com.sa', 'com.eg', 'com.ng', 'co.ke', 'co.za', 'org.za', 'web.za',
  // Hosted platforms: each customer is a different company, so the platform domain itself
  // is the suffix.
  'myshopify.com', 'squarespace.com', 'bigcartel.com', 'wixsite.com', 'webflow.io',
  'wordpress.com', 'blogspot.com', 'github.io', 'netlify.app', 'vercel.app', 'pages.dev',
  'herokuapp.com', 'azurewebsites.net', 'cloudfront.net',
]);

/** Longest suffix this table models. Bounds the candidate loop below. */
const MAX_SUFFIX_LABELS = 3;

const IPV4_PATTERN = /^\d{1,3}(\.\d{1,3}){3}$/;

/**
 * Split a hostname into its public suffix and the registrable domain that identifies one
 * company. Returns nulls rather than throwing, because every caller here is processing a
 * list where one bad row must not stop the other nine hundred.
 */
export function registrableDomainOf(hostname, { extraPublicSuffixes = [] } = {}) {
  const host = String(hostname ?? '').trim().toLowerCase().replace(/\.$/, '');
  if (!host || !host.includes('.')) return { registrableDomain: null, publicSuffix: null };

  const suffixes = extraPublicSuffixes.length
    ? new Set([...PUBLIC_SUFFIXES, ...extraPublicSuffixes.map((s) => String(s).toLowerCase())])
    : PUBLIC_SUFFIXES;

  const labels = host.split('.');
  let suffixLabelCount = 1;
  // The candidate loop runs up to the full label count, not one short of it. A hostname that
  // is itself a public suffix ("co.uk", "myshopify.com") has to be recognised as such, or it
  // becomes a registrable domain and a whole hosting platform turns into one prospect.
  for (let length = Math.min(MAX_SUFFIX_LABELS, labels.length); length >= 2; length--) {
    if (suffixes.has(labels.slice(-length).join('.'))) {
      suffixLabelCount = length;
      break;
    }
  }

  const publicSuffix = labels.slice(-suffixLabelCount).join('.');
  if (labels.length <= suffixLabelCount) {
    // The hostname *is* a public suffix ("co.uk"). There is no company here.
    return { registrableDomain: null, publicSuffix };
  }

  return {
    registrableDomain: labels.slice(-(suffixLabelCount + 1)).join('.'),
    publicSuffix,
  };
}

/** Wrapping characters and list punctuation that survive copy-paste out of a spreadsheet. */
const WRAPPER_CHARACTERS = /^[<("'\s]+|[>)"'\s,;]+$/g;

const rejectTarget = (input, reason) => ({
  ok: false,
  input: typeof input === 'string' ? input : String(input ?? ''),
  reason,
  url: null,
  hostname: null,
  registrableDomain: null,
  publicSuffix: null,
  key: null,
});

/**
 * Turn one messy input into a canonical, scannable https URL plus the registrable-domain
 * key that identifies the company behind it.
 *
 * Accepts bare hostnames, full URLs with paths, mailto: links, bare email addresses,
 * uppercase, trailing slashes, trailing commas and angle-bracket wrapping.
 *
 * Three decisions worth knowing about:
 *
 *   - `www.` is preserved by default. Dropping it produces a tidier list and occasionally an
 *     unscannable one: plenty of hosts publish an A record for `www` and nothing for the
 *     apex, and a scan that fails to load produces no findings, which reads downstream as a
 *     clean site. Deduplication does not need the hostname rewritten because it keys on the
 *     registrable domain. Pass `stripWww: true` if a caller wants it anyway.
 *   - The scheme is forced to https. The engine measures what a modern browser does, and a
 *     host still serving plain http will redirect.
 *   - Query strings are dropped unless `keepQuery` is set. Prospect lists are full of
 *     campaign parameters that make one page look like four targets.
 */
export function normalizeTarget(input, options = {}) {
  const { extraPublicSuffixes = [], stripWww = false, keepQuery = false } = options;

  const raw = String(input ?? '').trim();
  if (!raw) return rejectTarget(input, 'empty input');
  if (raw.includes('\0')) return rejectTarget(input, 'contains a null byte');

  let candidate = raw.replace(WRAPPER_CHARACTERS, '');
  if (!candidate) return rejectTarget(input, 'empty input');

  // Contact lists and domain lists get mixed constantly. An address identifies the company
  // just as well as its website does, so take the domain instead of discarding the row.
  if (/^mailto:/i.test(candidate)) candidate = candidate.slice('mailto:'.length);
  if (!/^[a-z][a-z0-9+.-]*:\/\//i.test(candidate) && candidate.includes('@')) {
    candidate = candidate.slice(candidate.lastIndexOf('@') + 1);
  }

  if (/\s/.test(candidate)) return rejectTarget(input, 'contains whitespace, not a hostname');

  const hasScheme = /^[a-z][a-z0-9+.-]*:\/\//i.test(candidate);
  if (hasScheme && !/^https?:\/\//i.test(candidate)) {
    return rejectTarget(input, 'unsupported scheme');
  }

  let parsed;
  try {
    parsed = new URL(hasScheme ? candidate : `https://${candidate}`);
  } catch {
    return rejectTarget(input, 'not a parseable URL');
  }

  const hostname = parsed.hostname.toLowerCase().replace(/\.$/, '');
  if (!hostname) return rejectTarget(input, 'no hostname');
  if (hostname.startsWith('[') || IPV4_PATTERN.test(hostname)) {
    return rejectTarget(input, 'IP address, which identifies no company');
  }
  if (!hostname.includes('.')) return rejectTarget(input, 'not a public hostname');

  const { registrableDomain, publicSuffix } = registrableDomainOf(hostname, { extraPublicSuffixes });
  if (!registrableDomain) {
    return rejectTarget(input, `"${hostname}" is a public suffix with no registrable domain`);
  }

  const finalHostname =
    stripWww && hostname === `www.${registrableDomain}` ? registrableDomain : hostname;

  const path = parsed.pathname === '/' ? '/' : parsed.pathname.replace(/\/+$/, '');
  const port = parsed.port ? `:${parsed.port}` : '';
  const query = keepQuery ? parsed.search : '';

  return {
    ok: true,
    input: raw,
    url: `https://${finalHostname}${port}${path}${query}`,
    hostname: finalHostname,
    registrableDomain,
    publicSuffix,
    // The company's identity everywhere downstream: dedupe key, throttling key, and the
    // lookup key for enrichment signals.
    key: registrableDomain,
    signals: {},
    reason: null,
  };
}

/**
 * Normalize a mixed list of strings and objects.
 *
 * Objects may carry a URL under any of the usual column names plus arbitrary enrichment
 * fields, which are preserved on `signals` for `prioritize` to read. Invalid rows are
 * returned separately instead of thrown, because a list is never clean and losing the
 * reason a row was dropped makes the list impossible to fix.
 */
export function normalizeTargets(inputs, options = {}) {
  const targets = [];
  const rejected = [];

  for (const entry of inputs ?? []) {
    if (entry && typeof entry === 'object' && !Array.isArray(entry)) {
      const { value, signals, structural } = splitRecord(entry);
      const normalized = normalizeTarget(value, options);
      if (normalized.ok) {
        targets.push({ ...normalized, ...structural, signals: { ...normalized.signals, ...signals } });
      } else {
        rejected.push(normalized);
      }
      continue;
    }

    const normalized = normalizeTarget(entry, options);
    if (normalized.ok) targets.push(normalized);
    else rejected.push(normalized);
  }

  return { targets, rejected };
}

/** Column names that mean "this is the website", in the order they are trusted. */
const URL_FIELDS = ['url', 'website', 'domain', 'site', 'host', 'hostname', 'homepage', 'email'];

/**
 * Fields this module produces itself. They are lifted back onto the target rather than
 * treated as enrichment, so a target that has already been through `annotateWithRobots` or
 * `prioritize` survives a second pass through normalization with its robots decision and
 * ranking intact — otherwise re-normalizing quietly discards a crawl-delay the plan depends
 * on.
 */
const STRUCTURAL_FIELDS = ['robots', 'priority', 'aliases', 'mergedCount'];

function splitRecord(record) {
  const lowered = {};
  for (const [field, value] of Object.entries(record)) lowered[field.trim().toLowerCase()] = value;

  const urlField = URL_FIELDS.find((f) => lowered[f] != null && String(lowered[f]).trim() !== '');
  const signals = { ...lowered };
  if (urlField) delete signals[urlField];

  const structural = {};
  for (const field of STRUCTURAL_FIELDS) {
    if (signals[field] !== undefined) {
      structural[field] = signals[field];
      delete signals[field];
    }
  }

  return { value: urlField ? lowered[urlField] : '', signals, structural };
}

/* ------------------------------------------------------------------ *
 * Plain-file ingestion
 * ------------------------------------------------------------------ */

/**
 * Parse a newline or CSV list of targets.
 *
 * One column is treated as a plain domain list. Multiple columns are treated as CSV, and a
 * header row — detected by whether the first row names any column this module understands —
 * maps the remaining columns onto enrichment signals. Blank lines and `#` comments are
 * skipped so an operator can annotate the list they are working through.
 */
export function parseTargetList(text, options = {}) {
  const rows = [];
  for (const line of String(text ?? '').split(/\r?\n/)) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith('#')) continue;
    rows.push(parseCsvLine(trimmed));
  }
  if (!rows.length) return { targets: [], rejected: [] };

  const header = rows[0].map((cell) => cell.trim().toLowerCase());
  const hasHeader = header.some((cell) => URL_FIELDS.includes(cell) || SIGNAL_FIELDS.has(cell));
  const dataRows = hasHeader ? rows.slice(1) : rows;

  const inputs = dataRows.map((cells) => {
    if (!hasHeader) return cells[0];
    const record = {};
    header.forEach((name, index) => {
      if (name && cells[index] !== undefined) record[name] = cells[index];
    });
    return record;
  });

  return normalizeTargets(inputs, options);
}

/**
 * Minimal CSV field splitter: commas separate, double quotes group, `""` escapes a quote.
 * Deliberately not a full CSV implementation — a target list with embedded newlines inside
 * quoted fields is a spreadsheet export problem, and silently mis-parsing one is worse than
 * the operator noticing a mangled row.
 */
function parseCsvLine(line) {
  const cells = [];
  let current = '';
  let inQuotes = false;

  for (let i = 0; i < line.length; i++) {
    const char = line[i];
    if (inQuotes) {
      if (char === '"' && line[i + 1] === '"') {
        current += '"';
        i++;
      } else if (char === '"') {
        inQuotes = false;
      } else {
        current += char;
      }
    } else if (char === '"') {
      inQuotes = true;
    } else if (char === ',') {
      cells.push(current);
      current = '';
    } else {
      current += char;
    }
  }
  cells.push(current);
  return cells.map((cell) => cell.trim());
}

/** Read and parse a target list from disk. */
export async function loadTargetFile(filePath, options = {}) {
  return parseTargetList(await fs.readFile(filePath, 'utf8'), options);
}

/* ------------------------------------------------------------------ *
 * Deduplication
 * ------------------------------------------------------------------ */

/**
 * Collapse hostnames belonging to the same company.
 *
 * The first occurrence of a registrable domain wins and keeps its URL. Source order is
 * treated as intentional: if a list says `shop.acme.com`, that is where the commerce tags
 * live, and rewriting it to the apex would scan a brochure page and report a clean site for
 * a company whose storefront is full of pixels. Later duplicates survive as `aliases` so the
 * operator can see what was folded in, and their signals fill gaps the winner left empty.
 */
export function dedupe(targets, options = {}) {
  const byKey = new Map();

  for (const target of asTargets(targets, options)) {
    const existing = byKey.get(target.key);
    if (!existing) {
      byKey.set(target.key, { ...target, aliases: [], mergedCount: 1 });
      continue;
    }

    if (target.hostname !== existing.hostname && !existing.aliases.includes(target.hostname)) {
      existing.aliases.push(target.hostname);
    }
    existing.mergedCount++;

    // First non-empty value wins, matching the "first occurrence is intentional" rule above.
    // Nothing is averaged or maximised: a prior risk score belongs to one hostname's scan,
    // and carrying the highest one across a company's other hostnames would attribute an
    // observation to a page it was never made on.
    for (const [field, value] of Object.entries(target.signals ?? {})) {
      const held = existing.signals[field];
      if (held === undefined || held === null || held === '') existing.signals[field] = value;
    }
  }

  return [...byKey.values()];
}

/** Accept raw strings, normalized targets, or a mix, and return normalized targets. */
function asTargets(input, options = {}) {
  const list = Array.isArray(input) ? input : [input];
  const out = [];
  for (const entry of list) {
    if (entry && typeof entry === 'object' && entry.ok === true && entry.key) {
      out.push({ ...entry, signals: { ...entry.signals } });
      continue;
    }
    const { targets } = normalizeTargets([entry], options);
    out.push(...targets);
  }
  return out;
}

/* ------------------------------------------------------------------ *
 * Prioritisation
 * ------------------------------------------------------------------ */

/** Enrichment column names recognised in a CSV header. */
const SIGNAL_FIELDS = new Set([
  'company', 'name', 'revenue', 'revenueband', 'revenue_band', 'sector', 'industry', 'vertical',
  'cmp', 'consent', 'consentplatform', 'consent_platform', 'risk', 'riskscore', 'risk_score',
  'priorrisk', 'prior_risk', 'consumer', 'consumerfacing', 'consumer_facing', 'b2c', 'audience',
]);

/**
 * Ranking weights. Every number a target's score is built from lives here so it can be tuned
 * from a config object instead of edited in the scoring function.
 *
 * The quantity being ranked is expected value per founder-hour of the *conversation*, which
 * is not the same as company size and is emphatically not a prediction that a company is
 * doing anything wrong. Each band below has a reason:
 *
 *   revenueBand   `mid` and `large` lead. They have enough California consumer traffic and
 *                 enough marketing tags to make a scan worth reading, a budget that clears a
 *                 $7.5k assessment without procurement, and no in-house privacy engineer who
 *                 has already looked. `enterprise` scores *below* `large` on purpose: those
 *                 deals are bigger and slower, they arrive with a vendor security review and
 *                 a panel of outside counsel, and the metric this business optimises is
 *                 profit per hour rather than contract value. `micro` cannot fund the work.
 *
 *   sector        Retail and digital health lead because that is where the plan starts:
 *                 heavy California consumer traffic and short buying cycles. Everything else
 *                 is scaled against those two.
 *
 *   consumerFacing  Consumer traffic is what makes any of the observations in a report
 *                 meaningful to the reader. A pure B2B site scans the same way and the
 *                 finding lands with far less weight.
 *
 *   consentPlatformDetected  A deployed consent platform means the company has already
 *                 accepted it needs consent, has budgeted for it, and has someone who owns
 *                 it — which means the report reaches a named person instead of a form.
 *
 *   priorRiskScoreCoefficient  Multiplies a prior scan's 0-100 risk score. A prior scan is
 *                 the difference between a cold introduction and a specific, checkable fact
 *                 about the recipient's own site, which is the only substitute for a brand
 *                 this business has.
 *
 * `unknown` entries are set mid-low rather than zero. A company we have not enriched must
 * not sink below a company we have measured and found unpromising: that would rank our own
 * ignorance as a property of the target, and would quietly bury every row of a fresh list.
 */
export const DEFAULT_PRIORITY_WEIGHTS = {
  revenueBand: {
    micro: 0,
    small: 8,
    mid: 30,
    large: 26,
    enterprise: 14,
    unknown: 12,
  },
  sector: {
    retail: 25,
    'digital-health': 25,
    travel: 18,
    media: 16,
    'financial-services': 12,
    education: 12,
    automotive: 12,
    'real-estate': 10,
    software: 8,
    nonprofit: 4,
    government: 0,
    unknown: 10,
  },
  consumerFacing: { yes: 18, no: 2, unknown: 8 },
  consentPlatformDetected: { yes: 14, no: 6, unknown: 6 },
  priorRiskScoreCoefficient: 0.25,
};

const REVENUE_BAND_ALIASES = {
  micro: 'micro', tiny: 'micro', startup: 'micro',
  small: 'small', smb: 'small',
  mid: 'mid', midmarket: 'mid', 'mid-market': 'mid', medium: 'mid',
  large: 'large', big: 'large',
  enterprise: 'enterprise', ent: 'enterprise', 'large-enterprise': 'enterprise',
};

/** Upper bound of each band in US dollars of annual revenue. */
const REVENUE_BAND_CEILINGS = [
  ['micro', 5e6],
  ['small', 25e6],
  ['mid', 250e6],
  ['large', 2e9],
];

/**
 * Coerce a revenue signal into a band. Accepts a band name, a plain number, or the shorthand
 * a human types into a spreadsheet ("$40M", "1.2bn").
 */
export function toRevenueBand(value) {
  if (value === null || value === undefined || value === '') return null;

  const text = String(value).trim().toLowerCase();
  if (REVENUE_BAND_ALIASES[text]) return REVENUE_BAND_ALIASES[text];

  const match = text.replace(/[$£€,\s]/g, '').match(/^(\d+(?:\.\d+)?)(k|m|b|bn)?$/);
  if (!match) return null;

  const multiplier = { k: 1e3, m: 1e6, b: 1e9, bn: 1e9 }[match[2]] ?? 1;
  const amount = Number(match[1]) * multiplier;
  for (const [band, ceiling] of REVENUE_BAND_CEILINGS) {
    if (amount < ceiling) return band;
  }
  return 'enterprise';
}

const SECTOR_ALIASES = {
  retail: 'retail', ecommerce: 'retail', 'e-commerce': 'retail', dtc: 'retail', d2c: 'retail',
  commerce: 'retail', shopping: 'retail', apparel: 'retail', 'consumer-goods': 'retail',
  health: 'digital-health', healthcare: 'digital-health', 'digital-health': 'digital-health',
  telehealth: 'digital-health', pharma: 'digital-health', wellness: 'digital-health',
  travel: 'travel', hospitality: 'travel', airline: 'travel', hotels: 'travel',
  media: 'media', publishing: 'media', news: 'media', entertainment: 'media',
  finance: 'financial-services', fintech: 'financial-services', banking: 'financial-services',
  insurance: 'financial-services', 'financial-services': 'financial-services',
  education: 'education', edtech: 'education',
  automotive: 'automotive', auto: 'automotive',
  'real-estate': 'real-estate', proptech: 'real-estate',
  software: 'software', saas: 'software', b2b: 'software', tech: 'software',
  nonprofit: 'nonprofit', charity: 'nonprofit',
  government: 'government', 'public-sector': 'government',
};

function toSector(value) {
  if (value === null || value === undefined || value === '') return null;
  const text = String(value).trim().toLowerCase().replace(/[\s_]+/g, '-');
  return SECTOR_ALIASES[text] ?? null;
}

const TRUE_WORDS = new Set(['true', 'yes', 'y', '1', 'consumer', 'b2c', 'consumer-facing']);
const FALSE_WORDS = new Set(['false', 'no', 'n', '0', 'b2b', 'business', 'none']);

function toBoolean(value) {
  if (value === null || value === undefined || value === '') return null;
  if (typeof value === 'boolean') return value;
  const text = String(value).trim().toLowerCase();
  if (TRUE_WORDS.has(text)) return true;
  if (FALSE_WORDS.has(text)) return false;
  return null;
}

function toRiskScore(value) {
  if (value === null || value === undefined || value === '') return null;
  const number = Number(value);
  if (!Number.isFinite(number)) return null;
  return Math.min(100, Math.max(0, number));
}

const firstDefined = (source, fields) => {
  for (const field of fields) {
    const value = source[field];
    if (value !== undefined && value !== null && value !== '') return value;
  }
  return null;
};

/**
 * Reduce whatever a caller supplied into the five signals the ranking understands.
 * Anything unrecognised stays null, which routes to the `unknown` weight rather than to a
 * penalty.
 */
export function readSignals(target, lookup = {}) {
  const supplied = {
    ...(target.signals ?? {}),
    ...(lookup[target.key] ?? {}),
    ...(lookup[target.hostname] ?? {}),
  };
  const lowered = {};
  for (const [field, value] of Object.entries(supplied)) lowered[field.toLowerCase()] = value;

  const consentValue = firstDefined(lowered, [
    'consentplatformdetected', 'consentplatform', 'consent_platform', 'cmp', 'consent',
  ]);

  return {
    revenueBand: toRevenueBand(
      firstDefined(lowered, ['revenueband', 'revenue_band', 'revenue', 'annualrevenue'])
    ),
    sector: toSector(firstDefined(lowered, ['sector', 'industry', 'vertical'])),
    consumerFacing: toBoolean(
      firstDefined(lowered, ['consumerfacing', 'consumer_facing', 'consumer', 'b2c', 'audience'])
    ),
    // A consent platform signal arrives either as a boolean or as the platform's name, and a
    // name is the stronger form of the same fact.
    consentPlatformDetected:
      consentValue === null ? null : (toBoolean(consentValue) ?? true),
    priorRiskScore: toRiskScore(
      firstDefined(lowered, ['priorriskscore', 'riskscore', 'risk_score', 'risk', 'priorrisk'])
    ),
  };
}

function mergeWeights(base, override = {}) {
  const merged = { ...base };
  for (const [field, value] of Object.entries(override ?? {})) {
    merged[field] =
      value && typeof value === 'object' && !Array.isArray(value)
        ? { ...(base[field] ?? {}), ...value }
        : value;
  }
  return merged;
}

const maxOf = (table) => Math.max(...Object.values(table));

/**
 * Rank targets by expected value of the conversation.
 *
 * @param targets  strings or normalized targets
 * @param options.signals  optional lookup keyed by registrable domain or hostname; values
 *                         here override signals carried on the target itself, so a fresh
 *                         enrichment pass wins over whatever the source file said
 * @param options.weights  partial override merged over DEFAULT_PRIORITY_WEIGHTS
 *
 * Returns a new array, highest first, each target carrying `priority`:
 *   { score, rawScore, maxScore, confidence, reasons, signals }
 *
 * `score` is normalised to 0-100 against the maximum the current weights can produce, so
 * retuning the weights does not silently change what a "70" means. `reasons` exists because
 * a ranked queue nobody can explain is a queue nobody trusts; each entry names the signal and
 * the points it contributed.
 */
export function prioritize(targets, options = {}) {
  const { signals: lookup = {}, weights: overrides = {} } = options;
  const weights = mergeWeights(DEFAULT_PRIORITY_WEIGHTS, overrides);

  const maxScore =
    maxOf(weights.revenueBand) +
    maxOf(weights.sector) +
    maxOf(weights.consumerFacing) +
    maxOf(weights.consentPlatformDetected) +
    weights.priorRiskScoreCoefficient * 100;

  const scored = asTargets(targets, options).map((target) => {
    const signals = readSignals(target, lookup);
    const reasons = [];
    let rawScore = 0;

    const add = (points, reason) => {
      rawScore += points;
      reasons.push(`${reason} (${points >= 0 ? '+' : ''}${round(points)})`);
    };

    const revenuePoints = weights.revenueBand[signals.revenueBand ?? 'unknown']
      ?? weights.revenueBand.unknown;
    add(revenuePoints, `revenue band ${signals.revenueBand ?? 'unknown'}`);

    const sectorPoints = weights.sector[signals.sector ?? 'unknown'] ?? weights.sector.unknown;
    add(sectorPoints, `sector ${signals.sector ?? 'unknown'}`);

    const consumerKey =
      signals.consumerFacing === null ? 'unknown' : signals.consumerFacing ? 'yes' : 'no';
    add(weights.consumerFacing[consumerKey], `consumer-facing ${consumerKey}`);

    const consentKey =
      signals.consentPlatformDetected === null
        ? 'unknown'
        : signals.consentPlatformDetected
          ? 'yes'
          : 'no';
    add(weights.consentPlatformDetected[consentKey], `consent platform detected ${consentKey}`);

    if (signals.priorRiskScore !== null) {
      add(
        signals.priorRiskScore * weights.priorRiskScoreCoefficient,
        `prior scan recorded risk score ${signals.priorRiskScore}`
      );
    } else {
      reasons.push('no prior scan on record (+0)');
    }

    const known = Object.values(signals).filter((value) => value !== null).length;

    return {
      ...target,
      priority: {
        score: round((rawScore / maxScore) * 100),
        rawScore: round(rawScore),
        maxScore: round(maxScore),
        // How much of the ranking rests on measured signals rather than defaults. Two targets
        // with the same score are not equally well understood, and the operator should see it.
        confidence: round(known / 5, 2),
        reasons,
        signals,
      },
    };
  });

  // Deterministic ordering: score, then how much is actually known, then the key. Stable
  // output matters because the plan below is handed to an operator who will work it over
  // several days and expects the same list each morning.
  return scored.sort(
    (a, b) =>
      b.priority.score - a.priority.score ||
      b.priority.confidence - a.priority.confidence ||
      a.key.localeCompare(b.key)
  );
}

const round = (value, places = 1) => {
  const factor = 10 ** places;
  return Math.round(value * factor) / factor;
};

/* ------------------------------------------------------------------ *
 * Politeness and scheduling
 * ------------------------------------------------------------------ */

/**
 * Conservative by design.
 *
 * This engine scans companies that have not asked to be scanned. That is legitimate — it
 * loads public pages the way any visitor's browser would, and it is how independent
 * measurement research has always worked — but the legitimacy is conditional on behaving
 * like a visitor rather than like a stress test. The moment a run looks like abuse, the
 * business stops being a researcher and becomes an incident in someone's WAF logs, which is
 * both an ethical failure and the fastest available route to a legal complaint.
 *
 *   maxConcurrent 2   Each target already costs three sequential page loads. Two workers is
 *                     enough to keep a laptop busy overnight and nowhere near enough to
 *                     register as load anywhere.
 *   perHostDelayMs    A full minute between finishing one scan of a domain and starting the
 *                     next. Repeat visits are what look automated; a gap makes the traffic
 *                     indistinguishable from two ordinary visitors.
 *   dailyCap 200      Matches the outreach ceiling the business plan sets for entirely
 *                     separate reasons (bulk-sender policy caps named outreach at roughly
 *                     this scale). Scanning far past what can be followed up creates traffic
 *                     with no purpose, which is the definition of an impolite crawl.
 *   estimatedScanDurationMs  Three passes at production settle windows plus navigation.
 *                     Only used to lay out the plan; the runner measures reality.
 */
export const DEFAULT_SCAN_PLAN_SETTINGS = {
  maxConcurrent: 2,
  perHostDelayMs: 60_000,
  dailyCap: 200,
  estimatedScanDurationMs: 75_000,
};

const MS_PER_DAY = 24 * 60 * 60 * 1000;

/**
 * Turn a ranked target list into an ordered execution plan.
 *
 * Input order is treated as priority order, so the usual pipeline is
 * `buildScanPlan(prioritize(dedupe(targets)))`.
 *
 * Two guarantees the plan provides:
 *
 *   1. No registrable domain is scanned again until `perHostDelayMs` has elapsed since the
 *      previous scan of that domain finished. Where a target carries a robots.txt
 *      crawl-delay (see `annotateWithRobots`), the larger of the two is used — the site's
 *      own stated preference is never narrowed.
 *   2. No day contains more than `dailyCap` targets.
 *
 * When the highest-priority remaining target is still inside its host's cooling-off window
 * and another target is not, the plan takes the other one. That keeps the workers busy
 * without ever shortening a delay, which is the only trade that is safe to make here.
 */
export function buildScanPlan(targets, options = {}) {
  const settings = { ...DEFAULT_SCAN_PLAN_SETTINGS, ...options };
  const maxConcurrent = Math.max(1, Math.floor(settings.maxConcurrent));
  const dailyCap = Math.max(1, Math.floor(settings.dailyCap));
  const perHostDelayMs = Math.max(0, settings.perHostDelayMs);
  const scanMs = Math.max(1, settings.estimatedScanDurationMs);

  const startDate = options.startDate ? new Date(options.startDate) : new Date();
  const ordered = asTargets(targets, options);

  const days = [];
  let order = 0;

  for (let dayIndex = 0; dayIndex * dailyCap < ordered.length; dayIndex++) {
    const dayTargets = ordered.slice(dayIndex * dailyCap, (dayIndex + 1) * dailyCap);
    const dayStart = new Date(startDate.getTime() + dayIndex * MS_PER_DAY);
    const items = scheduleDay(dayTargets, { maxConcurrent, perHostDelayMs, scanMs }).map((item) => ({
      ...item,
      day: dayIndex + 1,
      order: ++order,
      // An estimate, not a commitment: real scan durations vary by an order of magnitude
      // between a static page and one that lazy-loads forty tags.
      plannedStartAt: new Date(dayStart.getTime() + item.startOffsetMs).toISOString(),
      plannedEndAt: new Date(dayStart.getTime() + item.endOffsetMs).toISOString(),
    }));

    days.push({ day: dayIndex + 1, startAt: dayStart.toISOString(), items });
  }

  // Items are ordered by start time, and the last one to start is not always the last one to
  // finish, so take the maximum rather than the tail.
  const dayDurationMs = (day) => day.items.reduce((longest, i) => Math.max(longest, i.endOffsetMs), 0);
  const lastDay = days[days.length - 1];
  const longestDayMs = days.reduce((longest, day) => Math.max(longest, dayDurationMs(day)), 0);

  return {
    createdAt: new Date().toISOString(),
    settings: { maxConcurrent, perHostDelayMs, dailyCap, estimatedScanDurationMs: scanMs },
    totalTargets: ordered.length,
    totalDays: days.length,
    longestDayMs,
    finishesBy: lastDay
      ? new Date(new Date(lastDay.startAt).getTime() + dayDurationMs(lastDay)).toISOString()
      : null,
    days,
    /** Flat view for a runner that does not care about day boundaries. */
    items: days.flatMap((day) => day.items),
  };
}

function scheduleDay(targets, { maxConcurrent, perHostDelayMs, scanMs }) {
  const workerFreeAt = new Array(Math.min(maxConcurrent, targets.length || 1)).fill(0);
  const hostFreeAt = new Map();
  const pending = [...targets];
  const scheduled = [];

  const delayFor = (target) =>
    Math.max(perHostDelayMs, Number(target.robots?.crawlDelayMs) || 0);

  while (pending.length) {
    let workerIndex = 0;
    for (let i = 1; i < workerFreeAt.length; i++) {
      if (workerFreeAt[i] < workerFreeAt[workerIndex]) workerIndex = i;
    }
    const workerTime = workerFreeAt[workerIndex];

    // Highest-priority target whose host is already cool. Falling back to the earliest-cool
    // target means the worker idles rather than the delay being shortened.
    let chosen = pending.findIndex((t) => (hostFreeAt.get(t.key) ?? 0) <= workerTime);
    if (chosen === -1) {
      chosen = pending.reduce(
        (best, t, index) =>
          (hostFreeAt.get(t.key) ?? 0) < (hostFreeAt.get(pending[best].key) ?? 0) ? index : best,
        0
      );
    }

    const target = pending.splice(chosen, 1)[0];
    const startOffsetMs = Math.max(workerTime, hostFreeAt.get(target.key) ?? 0);
    const endOffsetMs = startOffsetMs + scanMs;

    workerFreeAt[workerIndex] = endOffsetMs;
    hostFreeAt.set(target.key, endOffsetMs + delayFor(target));

    scheduled.push({ ...target, worker: workerIndex, startOffsetMs, endOffsetMs });
  }

  return scheduled.sort((a, b) => a.startOffsetMs - b.startOffsetMs || a.worker - b.worker);
}

/* ------------------------------------------------------------------ *
 * robots.txt
 * ------------------------------------------------------------------ */

/**
 * The scanner loads pages the way an ordinary browser does, and robots.txt governs
 * automated retrieval rather than browsing, so there is a real argument that it does not
 * bind this tool at all. That argument is not worth having with a prospect. Honouring
 * robots costs a handful of targets and removes the single easiest objection anyone can
 * raise about how the evidence was collected, so the module makes honouring it the easy
 * path and leaves the decision to the caller.
 */
export const DEFAULT_ROBOTS_AGENT = '*';

/**
 * Sent when fetching robots.txt itself. Honest and identifiable — a site operator reading
 * their logs should be able to tell what this was without guessing.
 */
export const DEFAULT_ROBOTS_FETCH_USER_AGENT =
  'Mozilla/5.0 (compatible; consent-evidence-scanner; honours robots.txt)';

/** robots.txt files are small; anything past this is a trap or a mistake. */
const MAX_ROBOTS_BYTES = 512 * 1024;

/** robots.txt lives only at the origin root. */
export function robotsUrlFor(url) {
  const parsed = new URL(url);
  return `${parsed.protocol}//${parsed.host}/robots.txt`;
}

/**
 * Parse a robots.txt body into user-agent groups.
 *
 * Consecutive `User-agent` lines share one group, per the standard. `Sitemap` is
 * origin-wide rather than group-scoped and is collected separately — it is also genuinely
 * useful to this module, since a sitemap is a list of the site's own pages and therefore a
 * source of scannable targets that needs no crawling to discover.
 */
export function parseRobots(body) {
  const groups = [];
  const sitemaps = [];
  let current = null;
  let expectingAgents = false;

  for (const rawLine of String(body ?? '').split(/\r?\n/)) {
    const line = rawLine.split('#')[0].trim();
    if (!line) continue;

    const separator = line.indexOf(':');
    if (separator === -1) continue;

    const field = line.slice(0, separator).trim().toLowerCase();
    const value = line.slice(separator + 1).trim();

    if (field === 'sitemap') {
      if (value) sitemaps.push(value);
      continue;
    }

    if (field === 'user-agent') {
      if (!current || !expectingAgents) {
        current = { agents: [], rules: [], crawlDelaySeconds: null };
        groups.push(current);
        expectingAgents = true;
      }
      if (value) current.agents.push(value.toLowerCase());
      continue;
    }

    if (!current) {
      // Rules before any user-agent line are malformed. Treat them as applying to everyone,
      // which is the cautious reading.
      current = { agents: ['*'], rules: [], crawlDelaySeconds: null };
      groups.push(current);
    }
    expectingAgents = false;

    if (field === 'allow' || field === 'disallow') {
      // An empty Disallow means "nothing is disallowed" and carries no rule.
      if (!value) continue;
      current.rules.push({ allow: field === 'allow', pattern: value.startsWith('/') ? value : `/${value}` });
      continue;
    }

    if (field === 'crawl-delay') {
      const seconds = Number(value);
      if (Number.isFinite(seconds) && seconds >= 0) current.crawlDelaySeconds = seconds;
    }
  }

  return { groups, sitemaps };
}

function patternToRegExp(pattern) {
  const anchored = pattern.endsWith('$');
  const body = anchored ? pattern.slice(0, -1) : pattern;
  const escaped = body.replace(/[.+?^${}()|[\]\\]/g, '\\$&').replace(/\*/g, '.*');
  return new RegExp(`^${escaped}${anchored ? '$' : ''}`);
}

/**
 * Decide whether `path` is permitted for `userAgent`.
 *
 * Group selection is longest-token-wins, matched case-insensitively as a substring of the
 * agent name, falling back to `*`. Rule selection is longest-pattern-wins with allow
 * beating disallow on a tie, which is the behaviour the major crawlers implement and the
 * one a site operator will have tested their file against.
 */
export function isPathAllowed(parsed, path, userAgent = DEFAULT_ROBOTS_AGENT) {
  const groups = parsed?.groups ?? [];
  const agent = String(userAgent ?? '*').toLowerCase();

  let selectedToken = null;
  for (const group of groups) {
    for (const token of group.agents) {
      if (token === '*') continue;
      if (agent === '*' || !agent.includes(token)) continue;
      if (!selectedToken || token.length > selectedToken.length) selectedToken = token;
    }
  }
  if (!selectedToken && groups.some((g) => g.agents.includes('*'))) selectedToken = '*';

  if (!selectedToken) {
    return { allowed: true, matchedAgent: null, rule: null, crawlDelayMs: null };
  }

  const applicable = groups.filter((group) => group.agents.includes(selectedToken));
  const target = String(path || '/');

  let best = null;
  for (const group of applicable) {
    for (const rule of group.rules) {
      if (!patternToRegExp(rule.pattern).test(target)) continue;
      if (
        !best ||
        rule.pattern.length > best.pattern.length ||
        (rule.pattern.length === best.pattern.length && rule.allow && !best.allow)
      ) {
        best = rule;
      }
    }
  }

  const crawlDelaySeconds = applicable.reduce(
    (longest, group) => Math.max(longest, group.crawlDelaySeconds ?? 0),
    0
  );

  return {
    allowed: best ? best.allow : true,
    matchedAgent: selectedToken,
    rule: best ? `${best.allow ? 'Allow' : 'Disallow'}: ${best.pattern}` : null,
    crawlDelayMs: crawlDelaySeconds > 0 ? crawlDelaySeconds * 1000 : null,
  };
}

/**
 * Fetch a URL's robots.txt and report whether that URL's path may be retrieved.
 *
 * Failure resolves cautiously: a timeout, a connection error, a server error, an
 * access-controlled robots.txt or a truncated body all return `allowed: false` with
 * `certain: false`, so a caller filtering on `allowed` skips the target rather than
 * guessing. The one case that resolves to allowed-and-certain is a 404, because a missing
 * robots.txt is the standard's own way of saying "no restrictions" — treating it as a
 * prohibition would block most of the web and would misread the file's meaning.
 *
 * `certain` is separated from `allowed` so a caller can retry the undetermined ones later
 * instead of writing a prospect off permanently over one flaky DNS lookup.
 */
export async function checkRobots(url, options = {}) {
  const {
    userAgent = DEFAULT_ROBOTS_AGENT,
    fetchUserAgent = DEFAULT_ROBOTS_FETCH_USER_AGENT,
    timeoutMs = 8000,
    maxRedirects = 3,
  } = options;

  let robotsUrl;
  let path;
  try {
    const parsedUrl = new URL(url);
    robotsUrl = robotsUrlFor(url);
    path = `${parsedUrl.pathname}${parsedUrl.search}`;
  } catch {
    return {
      url: String(url),
      robotsUrl: null,
      path: null,
      userAgent,
      fetched: false,
      status: null,
      allowed: false,
      certain: true,
      reason: 'not a parseable URL',
      rule: null,
      crawlDelayMs: null,
      sitemaps: [],
    };
  }

  const base = {
    url: String(url),
    robotsUrl,
    path,
    userAgent,
    rule: null,
    crawlDelayMs: null,
    sitemaps: [],
  };

  let response;
  try {
    response = await fetchText(robotsUrl, { timeoutMs, maxRedirects, fetchUserAgent });
  } catch (err) {
    return {
      ...base,
      fetched: false,
      status: null,
      allowed: false,
      certain: false,
      reason: `robots.txt could not be fetched: ${String(err.message || err)}`,
    };
  }

  const { status, body, truncated } = response;

  if (status === 404 || status === 410) {
    return {
      ...base,
      fetched: true,
      status,
      allowed: true,
      certain: true,
      reason: 'no robots.txt published, which the standard treats as unrestricted',
    };
  }

  if (status < 200 || status >= 300) {
    return {
      ...base,
      fetched: true,
      status,
      allowed: false,
      certain: false,
      reason: `robots.txt returned HTTP ${status}; treating as undetermined`,
    };
  }

  if (truncated) {
    return {
      ...base,
      fetched: true,
      status,
      allowed: false,
      certain: false,
      reason: `robots.txt exceeded ${MAX_ROBOTS_BYTES} bytes and was not read in full`,
    };
  }

  const parsed = parseRobots(body);
  const decision = isPathAllowed(parsed, path, userAgent);

  return {
    ...base,
    fetched: true,
    status,
    allowed: decision.allowed,
    certain: true,
    reason: decision.rule
      ? `matched ${decision.rule} for user-agent ${decision.matchedAgent}`
      : 'no matching rule',
    rule: decision.rule,
    crawlDelayMs: decision.crawlDelayMs,
    sitemaps: parsed.sitemaps,
  };
}

/**
 * Minimal GET returning status and body text.
 *
 * node:https / node:http rather than global fetch: the body has to be capped while it
 * streams, and this keeps the module free of any assumption about which fetch
 * implementation the host runtime provides.
 */
function fetchText(url, { timeoutMs, maxRedirects, fetchUserAgent }, redirectsFollowed = 0) {
  return new Promise((resolve, reject) => {
    const parsed = new URL(url);
    const client = parsed.protocol === 'http:' ? http : https;

    const request = client.get(
      url,
      { headers: { 'user-agent': fetchUserAgent, accept: 'text/plain, */*' } },
      (response) => {
        const status = response.statusCode ?? 0;

        if (status >= 300 && status < 400 && response.headers.location) {
          response.resume();
          if (redirectsFollowed >= maxRedirects) {
            reject(new Error('too many redirects'));
            return;
          }
          const next = new URL(response.headers.location, url).toString();
          resolve(
            fetchText(next, { timeoutMs, maxRedirects, fetchUserAgent }, redirectsFollowed + 1)
          );
          return;
        }

        let body = '';
        let truncated = false;
        response.setEncoding('utf8');
        response.on('data', (chunk) => {
          if (truncated) return;
          body += chunk;
          if (body.length > MAX_ROBOTS_BYTES) {
            truncated = true;
            response.destroy();
          }
        });
        response.on('end', () => resolve({ status, body, truncated }));
        response.on('close', () => {
          if (truncated) resolve({ status, body, truncated });
        });
        response.on('error', reject);
      }
    );

    request.setTimeout(timeoutMs, () => {
      request.destroy(new Error(`timed out after ${timeoutMs}ms`));
    });
    request.on('error', reject);
  });
}

/**
 * Attach a robots.txt decision to every target.
 *
 * Concurrency is capped for the same reason the scan plan is: this is one request per
 * origin, but a burst of them from one address is still a burst. The returned targets carry
 * `robots`, which `buildScanPlan` reads for a crawl-delay and which `partitionByRobots`
 * splits on.
 */
export async function annotateWithRobots(targets, options = {}) {
  const { concurrency = 2 } = options;
  const list = asTargets(targets, options);
  const annotated = new Array(list.length);
  let cursor = 0;

  await Promise.all(
    Array.from({ length: Math.min(concurrency, list.length) || 1 }, async () => {
      while (cursor < list.length) {
        const index = cursor++;
        const target = list[index];
        annotated[index] = { ...target, robots: await checkRobots(target.url, options) };
      }
    })
  );

  return annotated;
}

/**
 * Split robots-annotated targets three ways. `undetermined` is kept separate from `blocked`
 * on purpose: one is a site's stated preference and the other is a network problem, and
 * dropping a prospect permanently because of the second would be a slow, invisible leak in
 * the pipeline.
 */
export function partitionByRobots(targets) {
  const allowed = [];
  const blocked = [];
  const undetermined = [];

  for (const target of targets) {
    if (!target.robots || target.robots.certain !== true) undetermined.push(target);
    else if (target.robots.allowed) allowed.push(target);
    else blocked.push(target);
  }

  return { allowed, blocked, undetermined };
}
