import { chromium } from 'playwright';
import { worstSeverity, SEVERITY_RANK } from './trackers.js';
import { classifyAll } from './entities.js';
import { detectConsentPlatform, clickReject } from './cmp.js';

/**
 * Three-pass consent evidence capture.
 *
 * The whole commercial value of this engine is that it does not ask what a company
 * *declared* in its consent tool. It records what the browser *did*. Those two things
 * diverge constantly, and the gap is invisible from the inside — which is exactly why
 * the company will pay someone outside to see it.
 *
 *   Pass A - BASELINE     load with a clean profile, touch nothing.
 *                         Anything that fires here fired before any consent existed.
 *
 *   Pass B - GPC          load again sending Sec-GPC: 1, the Global Privacy Control
 *                         signal. California regulations effective 1 Jan 2026 require
 *                         this be honoured as a valid opt-out. Trackers still firing
 *                         here are ignoring a legally recognised opt-out.
 *
 *   Pass C - REJECT       load, click the consent banner's reject control, then wait.
 *                         Trackers still firing here contradict the company's own UI.
 *
 * Pass C is the most damaging finding and the hardest to argue with, because the
 * company built the button itself.
 */

// Production default. Real sites inject tags lazily, so this must stay generous;
// tests override it because fixtures fire synchronously.
const PASS_SETTLE_MS = 7000;

async function runPass(browser, url, { gpc = false, clickReject: doReject = false, settleMs = PASS_SETTLE_MS } = {}) {
  const context = await browser.newContext({
    viewport: { width: 1440, height: 900 },
    locale: 'en-US',
    timezoneId: 'America/Los_Angeles', // CIPA is a California statute; present as a CA visitor
    ignoreHTTPSErrors: true,
    ...(gpc ? { extraHTTPHeaders: { 'Sec-GPC': '1' } } : {}),
  });

  // The JS-visible half of the GPC signal. Sites check navigator.globalPrivacyControl
  // as often as they check the header, and honouring only one is a common failure.
  if (gpc) {
    await context.addInitScript(() => {
      Object.defineProperty(navigator, 'globalPrivacyControl', { get: () => true });
    });
  }

  const requests = [];
  context.on('request', (r) => requests.push(r.url()));

  const page = await context.newPage();
  const pass = { requests: [], rejectClicked: false, rejectMethod: null, consent: null, error: null };
  let cutFrom = 0;

  try {
    await page.goto(url, { waitUntil: 'domcontentloaded', timeout: 40000 });

    pass.consent = await detectConsentPlatform(page, []);

    if (doReject) {
      await page.waitForTimeout(Math.min(3500, settleMs));
      // Mark the cut point *before* clicking. Clearing the buffer afterwards races
      // against the banner's own click handler, which usually fires its pixels
      // synchronously — those are precisely the requests this pass exists to catch,
      // and discarding them turns the most damaging finding into a silent pass.
      cutFrom = requests.length;
      const outcome = await clickReject(page);
      pass.rejectClicked = outcome.clicked;
      pass.rejectMethod = outcome.method;
      if (!pass.rejectClicked) cutFrom = 0;
    }

    await page.waitForTimeout(settleMs);
  } catch (err) {
    pass.error = String(err.message || err).slice(0, 240);
  }

  // Two different counts, because they answer two different questions.
  // `requests` is what fired in the window we care about (after the reject click, for the
  // reject pass). `observedRequestCount` is everything the page issued at all.
  //
  // The distinction is load-bearing: a site that correctly halts every tracker after the
  // visitor clicks reject produces zero requests in the sliced window. That is the BEST
  // possible outcome, and judging capture health on the sliced count would misread it as a
  // failed page load — which would make the system unable to monitor precisely the
  // well-behaved clients who are paying for monitoring.
  pass.requests = [...new Set(requests.slice(cutFrom))];
  pass.observedRequestCount = requests.length;
  await context.close().catch(() => {});
  return pass;
}

export async function scanConsent(url, opts = {}) {
  // Proxy is opt-in. An intercepting proxy that re-signs TLS breaks sub-resource
  // loading badly enough that the page renders empty and every tracker looks absent —
  // a silent false-negative, which is the worst failure this engine can have. Only
  // route through one when explicitly asked, and always bypass loopback.
  const proxyServer = process.env.A50_PROXY || null;
  const browser = await chromium.launch({
    headless: opts.headless !== false,
    ...(proxyServer
      ? { proxy: { server: proxyServer, bypass: '127.0.0.1,localhost' } }
      : {}),
    args: ['--no-sandbox', '--disable-dev-shm-usage'],
  });

  const started = Date.now();
  try {
    // Sequential rather than parallel: three concurrent contexts against one host
    // looks like a load test, and being a good citizen is also a legal posture.
    const settleMs = opts.settleMs ?? PASS_SETTLE_MS;
    const baseline = await runPass(browser, url, { settleMs });
    const gpc = await runPass(browser, url, { gpc: true, settleMs });
    const reject = await runPass(browser, url, { clickReject: true, settleMs });

    const pageHost = (() => {
      try { return new URL(url).hostname; } catch { return null; }
    })();

    const A = classifyAll(baseline.requests, { pageHost });
    const B = classifyAll(gpc.requests, { pageHost });
    const C = classifyAll(reject.requests, { pageHost });

    // DOM detection is authoritative over network signatures: a self-hosted consent manager
    // makes no third-party request, so network evidence alone reports "none" for a banner
    // that is plainly on screen.
    const consentPlatforms = [
      ...new Set([
        ...A.cmps.map((c) => c.name),
        ...(baseline.consent?.platforms ?? []),
        ...(reject.consent?.platforms ?? []),
      ]),
    ];
    const bannerVisible = Boolean(baseline.consent?.bannerVisible || reject.consent?.bannerVisible);

    const findings = buildFindings({ A, B, C, reject, consentPlatforms, bannerVisible });

    return {
      url,
      scannedAt: new Date().toISOString(),
      durationMs: Date.now() - started,
      cmp: consentPlatforms,
      bannerVisible,
      passes: {
        baseline: summarise(A, baseline),
        gpc: summarise(B, gpc),
        afterReject: {
          ...summarise(C, reject),
          rejectClicked: reject.rejectClicked,
          rejectMethod: reject.rejectMethod,
        },
      },
      findings,
      riskScore: score(findings),
      errors: [baseline.error, gpc.error, reject.error].filter(Boolean),
    };
  } finally {
    await browser.close().catch(() => {});
  }
}

const trackerView = (t) => ({
  name: t.name,
  category: t.category,
  severity: t.severity,
  evidence: t.evidence,
  consentSignal: t.consentSignal,
  sample: t.requests[0] ?? null,
});

const summarise = (cls, pass) => ({
  observedRequestCount: pass.observedRequestCount ?? pass.requests.length,
  trackerCount: cls.reportable.length,
  trackers: cls.reportable.map(trackerView),
  // Services that fired but signalled that consent was denied. Kept visible as context so
  // the report can say "these restricted themselves" rather than appearing to have missed
  // requests the client's own engineer can see in the network tab.
  restrained: cls.restrained.map(trackerView),
  requestCount: pass.requests.length,
  error: pass.error,
});

function buildFindings({ A, B, C, reject, consentPlatforms, bannerVisible }) {
  const findings = [];
  const hasCmp = consentPlatforms.length > 0;

  if (A.reportable.length) {
    findings.push({
      id: 'PRE_CONSENT',
      severity: worstSeverity(A.reportable),
      title: `${A.reportable.length} third-party tracker(s) fired before any consent interaction`,
      detail: hasCmp
        ? `A consent platform (${consentPlatforms.join(', ')}) is deployed, yet these ` +
          'trackers transmitted before the visitor made any choice.'
        : 'No consent management platform was detected on the page.',
      trackers: A.reportable.map((t) => t.name),
    });
  }

  const gpcIgnored = B.reportable.filter((t) => SEVERITY_RANK[t.severity] >= 2);
  if (gpcIgnored.length) {
    findings.push({
      id: 'GPC_IGNORED',
      severity: 'critical',
      title: `${gpcIgnored.length} tracker(s) continued firing with Global Privacy Control enabled`,
      detail:
        'The request advertised Sec-GPC: 1 and navigator.globalPrivacyControl = true. ' +
        'California regulations effective 1 January 2026 require opt-out preference signals ' +
        'to be honoured.',
      trackers: gpcIgnored.map((t) => t.name),
    });
  }

  if (reject.rejectClicked && C.reportable.length) {
    findings.push({
      id: 'REJECT_IGNORED',
      severity: 'critical',
      title: `${C.reportable.length} tracker(s) continued firing after the reject control was clicked`,
      detail:
        'The consent banner offered a reject control, it was clicked, and these trackers ' +
        'transmitted afterwards. This contradicts the choice the site itself presented.',
      trackers: C.reportable.map((t) => t.name),
    });
  }

  // Gate on bannerVisible, not just on recognising a named platform. A bespoke or
  // self-hosted banner is a real consent mechanism even when no signature matches it, and
  // claiming otherwise is a factual error the reader can disprove instantly.
  if (!hasCmp && !bannerVisible && A.reportable.length) {
    findings.push({
      id: 'NO_CMP',
      severity: 'high',
      title: 'No consent mechanism detected',
      detail:
        'Third-party trackers were observed and no consent banner or platform could be ' +
        'identified on the tested page.',
      trackers: [],
    });
  }

  if (!reject.rejectClicked && (hasCmp || bannerVisible)) {
    findings.push({
      id: 'NO_REJECT_CONTROL',
      severity: 'high',
      title: 'No reject control found on the consent banner',
      detail:
        'A consent banner is present but no reject or decline control could be found at the ' +
        'same level as accept. Automated interaction may miss a control that is only reachable ' +
        'through a preferences dialog, so this warrants a manual check before it is relied on. ' +
        'Asymmetric consent design has drawn direct enforcement — the CPPA fined Honda ' +
        '$632,500 in a matter involving asymmetric opt-out flows.',
      trackers: [],
    });
  }

  return findings;
}

/** 0-100. Higher is worse. Deliberately blunt, because the report explains itself. */
function score(findings) {
  const weights = { critical: 30, high: 15, medium: 5 };
  return Math.min(100, findings.reduce((s, f) => s + (weights[f.severity] || 5), 0));
}
