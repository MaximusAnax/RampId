import { chromium } from 'playwright';
import { classifyRequests, worstSeverity, SEVERITY_RANK } from './trackers.js';

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

const REJECT_PATTERNS = [
  /^reject all$/i, /^reject$/i, /^decline all$/i, /^decline$/i,
  /^refuse all$/i, /^deny all$/i, /^only necessary$/i,
  /^necessary only$/i, /^essential only$/i, /^use necessary cookies only$/i,
  /^continue without accepting/i, /^manage.*reject/i,
];

// Production default. Real sites inject tags lazily, so this must stay generous;
// tests override it because fixtures fire synchronously.
const PASS_SETTLE_MS = 7000;

async function runPass(browser, url, { gpc = false, clickReject = false, settleMs = PASS_SETTLE_MS } = {}) {
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
  const pass = { requests: [], rejectClicked: false, error: null, timeline: [] };
  let cutFrom = 0;

  try {
    await page.goto(url, { waitUntil: 'domcontentloaded', timeout: 40000 });

    if (clickReject) {
      await page.waitForTimeout(Math.min(3500, settleMs));
      // Mark the cut point *before* clicking. Clearing the buffer afterwards races
      // against the banner's own click handler, which usually fires its pixels
      // synchronously — those are precisely the requests this pass exists to catch,
      // and discarding them turns the most damaging finding into a silent pass.
      cutFrom = requests.length;
      pass.rejectClicked = await clickRejectControl(page);
      if (!pass.rejectClicked) cutFrom = 0;
    }

    await page.waitForTimeout(settleMs);
  } catch (err) {
    pass.error = String(err.message || err).slice(0, 240);
  }

  pass.requests = [...new Set(requests.slice(cutFrom))];
  await context.close().catch(() => {});
  return pass;
}

async function clickRejectControl(page) {
  for (const re of REJECT_PATTERNS) {
    for (const frame of page.frames()) {
      try {
        const btn = frame.getByRole('button', { name: re }).first();
        if (await btn.isVisible({ timeout: 700 })) {
          await btn.click({ timeout: 2500 });
          return true;
        }
      } catch {
        /* control not present in this frame */
      }
    }
  }
  // Some CMPs render the reject control as a link rather than a button.
  for (const re of REJECT_PATTERNS) {
    try {
      const link = page.getByRole('link', { name: re }).first();
      if (await link.isVisible({ timeout: 700 })) {
        await link.click({ timeout: 2500 });
        return true;
      }
    } catch {
      /* not a link either */
    }
  }
  return false;
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

    const A = classifyRequests(baseline.requests);
    const B = classifyRequests(gpc.requests);
    const C = classifyRequests(reject.requests);

    const findings = buildFindings({ A, B, C, reject });

    return {
      url,
      scannedAt: new Date().toISOString(),
      durationMs: Date.now() - started,
      cmp: A.cmps.map((c) => c.name),
      passes: {
        baseline: summarise(A, baseline),
        gpc: summarise(B, gpc),
        afterReject: { ...summarise(C, reject), rejectClicked: reject.rejectClicked },
      },
      findings,
      riskScore: score(findings),
      errors: [baseline.error, gpc.error, reject.error].filter(Boolean),
    };
  } finally {
    await browser.close().catch(() => {});
  }
}

const summarise = (cls, pass) => ({
  trackerCount: cls.trackers.length,
  trackers: cls.trackers.map((t) => ({
    name: t.name,
    category: t.category,
    severity: t.severity,
    evidence: t.evidence,
    sample: t.requests[0] ?? null,
  })),
  requestCount: pass.requests.length,
  error: pass.error,
});

function buildFindings({ A, B, C, reject }) {
  const findings = [];
  const hasCmp = A.cmps.length > 0;

  if (A.trackers.length) {
    findings.push({
      id: 'PRE_CONSENT',
      severity: worstSeverity(A.trackers),
      title: `${A.trackers.length} third-party tracker(s) fired before any consent interaction`,
      detail: hasCmp
        ? `A consent platform (${A.cmps.map((c) => c.name).join(', ')}) is deployed, yet these ` +
          'trackers transmitted before the visitor made any choice.'
        : 'No consent management platform was detected on the page.',
      trackers: A.trackers.map((t) => t.name),
    });
  }

  const gpcIgnored = B.trackers.filter((t) => SEVERITY_RANK[t.severity] >= 2);
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

  if (reject.rejectClicked && C.trackers.length) {
    findings.push({
      id: 'REJECT_IGNORED',
      severity: 'critical',
      title: `${C.trackers.length} tracker(s) continued firing after the reject control was clicked`,
      detail:
        'The consent banner offered a reject control, it was clicked, and these trackers ' +
        'transmitted afterwards. This contradicts the choice the site itself presented.',
      trackers: C.trackers.map((t) => t.name),
    });
  }

  if (!hasCmp && A.trackers.length) {
    findings.push({
      id: 'NO_CMP',
      severity: 'high',
      title: 'No consent management platform detected',
      detail: 'Trackers are present with no mechanism for a visitor to refuse them.',
      trackers: [],
    });
  }

  if (!reject.rejectClicked && hasCmp) {
    findings.push({
      id: 'NO_REJECT_CONTROL',
      severity: 'high',
      title: 'No reject control found on the consent banner',
      detail:
        'A consent platform is present but no reject/decline control could be found at the ' +
        'same level as accept. Asymmetric consent design has drawn direct enforcement — ' +
        'the CPPA fined Honda $632,500 in a matter involving asymmetric opt-out flows.',
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
