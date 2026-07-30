/**
 * Third-party tracker fingerprints, tagged by the risk theory that makes each one
 * expensive when it fires before consent.
 *
 * `severity` reflects litigation reality rather than data-protection theory:
 *
 *   critical - named in actual CIPA/CCPA enforcement or the session-replay case law
 *              that drives ~65% of filings
 *   high     - advertising pixels that transmit identifiers to an ad network
 *   medium   - analytics with a plausible legitimate-interest argument
 *
 * The `evidence` string is written to be quotable directly into a client-facing
 * report, so it states what the tracker does, not what law it breaks.
 */

export const TRACKERS = [
  // Session replay - the single largest driver of CIPA filings
  { id: 'fullstory', name: 'FullStory', category: 'session-replay', severity: 'critical',
    hosts: ['fullstory.com', 'fs.js'],
    evidence: 'Records keystrokes, mouse movement and page content as a replayable session.' },
  { id: 'hotjar', name: 'Hotjar', category: 'session-replay', severity: 'critical',
    hosts: ['hotjar.com', 'hotjar.io'],
    evidence: 'Captures session recordings and heatmaps of user interaction.' },
  { id: 'quantummetric', name: 'Quantum Metric', category: 'session-replay', severity: 'critical',
    hosts: ['quantummetric.com'],
    evidence: 'Captures full session replay including form interaction.' },
  { id: 'contentsquare', name: 'Contentsquare', category: 'session-replay', severity: 'critical',
    hosts: ['contentsquare.net', 'contentsquare.com'],
    evidence: 'Captures behavioural session data and replay.' },
  { id: 'clarity', name: 'Microsoft Clarity', category: 'session-replay', severity: 'critical',
    hosts: ['clarity.ms'],
    evidence: 'Records session replays and heatmaps.' },
  { id: 'glassbox', name: 'Glassbox', category: 'session-replay', severity: 'critical',
    hosts: ['glassbox.com', 'glassboxdigital.io'],
    evidence: 'Captures full session replay.' },
  { id: 'logrocket', name: 'LogRocket', category: 'session-replay', severity: 'critical',
    hosts: ['logrocket.com', 'lr-ingest.io'],
    evidence: 'Records session replay including network and console activity.' },
  // The broad dataset files these under generic "analytics", which understates them badly.
  // Session replay is implicated in roughly 65% of CIPA filings, so it is curated here to
  // carry the severity and the specific description the finding actually needs.
  { id: 'mouseflow', name: 'Mouseflow', category: 'session-replay', severity: 'critical',
    hosts: ['mouseflow.com'],
    evidence: 'Records session replays, heatmaps and form interaction.' },
  { id: 'smartlook', name: 'Smartlook', category: 'session-replay', severity: 'critical',
    hosts: ['smartlook.com', 'smartlook.cloud'],
    evidence: 'Records session replays including form and click interaction.' },
  { id: 'inspectlet', name: 'Inspectlet', category: 'session-replay', severity: 'critical',
    hosts: ['inspectlet.com'],
    evidence: 'Records session replays and keystroke-level interaction.' },
  { id: 'luckyorange', name: 'Lucky Orange', category: 'session-replay', severity: 'critical',
    hosts: ['luckyorange.com', 'luckyorange.net'],
    evidence: 'Records session replays, heatmaps and form analytics.' },
  { id: 'sessioncam', name: 'SessionCam', category: 'session-replay', severity: 'critical',
    hosts: ['sessioncam.com'],
    evidence: 'Records session replay of visitor interaction.' },
  { id: 'decibel', name: 'Decibel / Medallia DXA', category: 'session-replay', severity: 'critical',
    hosts: ['decibelinsight.net', 'decibelinsight.com'],
    evidence: 'Records session replay and digital experience telemetry.' },

  // Advertising pixels - identifier transmission to an ad network
  { id: 'meta', name: 'Meta Pixel', category: 'ad-pixel', severity: 'critical',
    hosts: ['facebook.com/tr', 'connect.facebook.net', 'facebook.net'],
    evidence: 'Transmits page and event data to Meta, keyed to a user identifier.' },
  { id: 'tiktok', name: 'TikTok Pixel', category: 'ad-pixel', severity: 'critical',
    hosts: ['analytics.tiktok.com', 'tiktok.com/i18n/pixel'],
    evidence: 'Transmits page and event data to TikTok.' },
  { id: 'googleads', name: 'Google Ads / DoubleClick', category: 'ad-pixel', severity: 'high',
    hosts: ['googleadservices.com', 'doubleclick.net', 'google.com/pagead', 'googlesyndication.com'],
    evidence: 'Transmits conversion and remarketing data to Google advertising systems.' },
  { id: 'linkedin', name: 'LinkedIn Insight', category: 'ad-pixel', severity: 'high',
    hosts: ['snap.licdn.com', 'px.ads.linkedin.com'],
    evidence: 'Transmits page view and conversion data to LinkedIn.' },
  { id: 'twitter', name: 'X / Twitter Pixel', category: 'ad-pixel', severity: 'high',
    hosts: ['static.ads-twitter.com', 't.co/i/adsct'],
    evidence: 'Transmits event data to X advertising systems.' },
  { id: 'pinterest', name: 'Pinterest Tag', category: 'ad-pixel', severity: 'high',
    hosts: ['ct.pinterest.com'], evidence: 'Transmits conversion data to Pinterest.' },
  { id: 'reddit', name: 'Reddit Pixel', category: 'ad-pixel', severity: 'high',
    hosts: ['redditstatic.com/ads', 'alb.reddit.com'],
    evidence: 'Transmits conversion data to Reddit.' },
  { id: 'criteo', name: 'Criteo', category: 'ad-pixel', severity: 'high',
    hosts: ['criteo.com', 'criteo.net'], evidence: 'Transmits retargeting data to Criteo.' },
  { id: 'taboola', name: 'Taboola', category: 'ad-pixel', severity: 'high',
    hosts: ['taboola.com'], evidence: 'Transmits page and user data to Taboola.' },
  { id: 'bing', name: 'Microsoft UET', category: 'ad-pixel', severity: 'high',
    hosts: ['bat.bing.com'], evidence: 'Transmits conversion data to Microsoft Advertising.' },

  // Analytics - lower severity, still in scope pre-consent
  { id: 'ga', name: 'Google Analytics', category: 'analytics', severity: 'medium',
    hosts: ['google-analytics.com', 'googletagmanager.com/gtag', 'analytics.google.com'],
    evidence: 'Transmits page view and event data to Google Analytics.' },
  { id: 'segment', name: 'Segment', category: 'analytics', severity: 'medium',
    hosts: ['segment.com', 'segment.io'], evidence: 'Forwards event data to downstream destinations.' },
  { id: 'mixpanel', name: 'Mixpanel', category: 'analytics', severity: 'medium',
    hosts: ['mixpanel.com'], evidence: 'Transmits product analytics events.' },
  { id: 'amplitude', name: 'Amplitude', category: 'analytics', severity: 'medium',
    hosts: ['amplitude.com'], evidence: 'Transmits product analytics events.' },
  { id: 'heap', name: 'Heap', category: 'analytics', severity: 'medium',
    hosts: ['heap.io', 'heapanalytics.com'], evidence: 'Auto-captures interaction events.' },
];

/** Consent Management Platforms - their presence proves the company knows it needs consent. */
export const CMPS = [
  { id: 'onetrust', name: 'OneTrust', hosts: ['onetrust.com', 'cookielaw.org', 'otSDKStub'] },
  { id: 'trustarc', name: 'TrustArc', hosts: ['trustarc.com', 'truste.com'] },
  { id: 'cookiebot', name: 'Cookiebot', hosts: ['cookiebot.com'] },
  { id: 'usercentrics', name: 'Usercentrics', hosts: ['usercentrics.eu', 'usercentrics.com'] },
  { id: 'didomi', name: 'Didomi', hosts: ['didomi.io'] },
  { id: 'osano', name: 'Osano', hosts: ['osano.com'] },
  { id: 'ketch', name: 'Ketch', hosts: ['ketchcdn.com', 'ketch.com'] },
  { id: 'quantcast', name: 'Quantcast Choice', hosts: ['quantcast.mgr.consensu.org', 'quantcast.com'] },
  { id: 'termly', name: 'Termly', hosts: ['termly.io'] },
  { id: 'iubenda', name: 'iubenda', hosts: ['iubenda.com'] },
];

const matchAll = (table, url) => {
  const u = url.toLowerCase();
  return table.filter((t) => t.hosts.some((h) => u.includes(h.toLowerCase())));
};

/** Classify a list of observed request URLs into trackers and CMPs. */
export function classifyRequests(urls) {
  const trackers = new Map();
  const cmps = new Map();

  for (const url of urls) {
    for (const t of matchAll(TRACKERS, url)) {
      const hit = trackers.get(t.id) || { ...t, requests: [] };
      if (hit.requests.length < 5) hit.requests.push(url.slice(0, 400));
      trackers.set(t.id, hit);
    }
    for (const c of matchAll(CMPS, url)) {
      const hit = cmps.get(c.id) || { ...c, requests: [] };
      if (hit.requests.length < 2) hit.requests.push(url.slice(0, 300));
      cmps.set(c.id, hit);
    }
  }

  return { trackers: [...trackers.values()], cmps: [...cmps.values()] };
}

export const SEVERITY_RANK = { critical: 3, high: 2, medium: 1 };

export function worstSeverity(trackers) {
  return trackers.reduce(
    (w, t) => (SEVERITY_RANK[t.severity] > SEVERITY_RANK[w] ? t.severity : w),
    'medium'
  );
}
