import { launchBrowser } from '@evidence/shared/browser';
import { worstSeverity, SEVERITY_RANK } from './trackers.js';
import { classifyAll } from './entities.js';
import { detectConsentPlatform, clickReject } from './cmp.js';
import { detectOptOutDisplay, optOutDisplayFinding } from './optoutdisplay.js';

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
    const response = await page.goto(url, { waitUntil: 'domcontentloaded', timeout: 40000 });

    // What the server actually returned, and whether what came back is a real page.
    //
    // Without this a Cloudflare or Akamai challenge, a 403, or a 500 error page all scan
    // as perfectly healthy and perfectly clean: the navigation succeeded, requests were
    // recorded, and no trackers fired — because there was no site there. In monitoring it
    // is worse than useless, because a client who starts challenging our traffic would be
    // told every one of their findings had been resolved.
    pass.status = response?.status() ?? null;
    pass.challenge = await detectChallengePage(page, pass.status);

    // Let the page finish becoming itself before inspecting it.
    //
    // Every real consent platform injects its banner with JavaScript after
    // DOMContentLoaded, and so does any acknowledgement that an opt-out preference signal
    // was processed. Inspecting immediately after navigation sees a page that has not
    // rendered its consent UI yet, which manufactures two of the worst false accusations
    // this system can make: "no consent mechanism detected" about a site with a visible
    // banner, and "no indication the opt-out signal was processed" about a site that says
    // so plainly a moment later. Static test fixtures hide this completely, because inline
    // markup is present at DOMContentLoaded.
    await page.waitForTimeout(settleMs);

    pass.consent = await detectConsentPlatform(page, []);

    // Only meaningful on the GPC pass: the obligation is to display that a signal was
    // processed, and no signal is sent on the other passes.
    if (gpc) pass.optOutDisplay = await detectOptOutDisplay(page);

    if (doReject) {
      // Mark the cut point *before* clicking. Clearing the buffer afterwards races
      // against the banner's own click handler, which usually fires its pixels
      // synchronously — those are precisely the requests this pass exists to catch,
      // and discarding them turns the most damaging finding into a silent pass.
      cutFrom = requests.length;
      const outcome = await clickReject(page);
      pass.rejectClicked = outcome.clicked;
      pass.rejectMethod = outcome.method;
      if (!pass.rejectClicked) cutFrom = 0;

      await page.waitForTimeout(settleMs);
    }
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
  const browser = await launchBrowser();

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

    // Gated on evidence that the site actually shares with third parties at all — across
    // any pass, since a tag suppressed under GPC still shows the site is in the business of
    // sharing. Without that evidence the display obligation may simply not attach.
    const observedThirdPartySharing =
      A.trackers.length > 0 || B.trackers.length > 0 || C.trackers.length > 0;

    const optOut = optOutDisplayFinding(gpc.optOutDisplay, {
      gpcHonoured: B.reportable.length === 0,
      sharesWithThirdParties: observedThirdPartySharing,
    });
    if (optOut) findings.push(optOut);

    // Navigation failure is the reliable signal, not request volume.
    //
    // Counting requests looks tempting but is wrong in both directions: a failed navigation
    // still registers one request, and a genuinely clean page with no third-party resources
    // also registers exactly one. Thresholding on the count therefore marked clean sites as
    // failed scans — which in monitoring would have meant the best-behaved clients were
    // silently skipped forever.
    const passLoaded = (p) =>
      !p.error && !p.challenge?.blocked && (p.observedRequestCount ?? 0) >= 1;
    const loadedPasses = [baseline, gpc, reject].filter(passLoaded).length;
    const blocked = [baseline, gpc, reject].find((p) => p.challenge?.blocked);
    const capture = {
      ok: loadedPasses === 3,
      passesLoaded: loadedPasses,
      usable: loadedPasses > 0,
      blocked: Boolean(blocked),
      note:
        loadedPasses === 3
          ? null
          : blocked
            ? `${blocked.challenge.reason} No conclusion can be drawn about this site's ` +
              'tracking behaviour from this scan.'
            : loadedPasses === 0
              ? 'The page could not be loaded. No conclusion can be drawn from this scan.'
              : `Only ${loadedPasses} of 3 passes loaded successfully. Findings are incomplete.`,
    };

    return {
      url,
      scannedAt: new Date().toISOString(),
      durationMs: Date.now() - started,
      cmp: consentPlatforms,
      bannerVisible,
      optOutDisplay: gpc.optOutDisplay ?? null,
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
      // Whether the scan can support any conclusion at all.
      //
      // Without this, a site that never loaded returns zero findings, and zero findings
      // renders as a clean bill of health. Handing a client "no issues found" for a page
      // that failed to load is worse than handing them nothing, and it is not a failure
      // they could detect from the report.
      capture,
      errors: [baseline.error, gpc.error, reject.error].filter(Boolean),
    };
  } finally {
    await browser.close().catch(() => {});
  }
}

/** Signatures of an interstitial served instead of the site. */
const CHALLENGE_MARKERS = [
  /just a moment/i,
  /checking your browser/i,
  /enable javascript and cookies to continue/i,
  /verify you are (?:a )?human/i,
  /attention required/i,
  /access denied/i,
  /request blocked/i,
  /are you a robot/i,
  /ddos protection/i,
  /pardon our interruption/i,
  /unusual traffic/i,
];

async function detectChallengePage(page, status) {
  if (status !== null && status >= 400) {
    return { blocked: true, reason: `Server responded ${status}.` };
  }
  try {
    const [title, text] = await Promise.all([
      page.title().catch(() => ''),
      page.evaluate(() => document.body?.innerText?.slice(0, 2000) ?? ''),
    ]);
    const haystack = `${title}\n${text}`;
    const marker = CHALLENGE_MARKERS.find((re) => re.test(haystack));
    if (marker) {
      return { blocked: true, reason: 'An interstitial or challenge page was served instead of the site.' };
    }
  } catch {
    // Unreadable page; the capture-health check covers this case.
  }
  return { blocked: false, reason: null };
}

const trackerView = (t) => ({
  name: t.name,
  category: t.category,
  severity: t.severity,
  evidence: t.evidence,
  consentSignal: t.consentSignal,
  sample: t.evidenceUrl ?? t.requests[0] ?? null,
});

const summarise = (cls, pass) => ({
  observedRequestCount: pass.observedRequestCount ?? pass.requests.length,
  // Carried through so the report can never print "no third-party trackers observed" in
  // green for a pass that failed. An empty pass and a clean pass look identical and mean
  // opposite things.
  loaded: !pass.error && !pass.challenge?.blocked,
  status: pass.status ?? null,
  blocked: Boolean(pass.challenge?.blocked),
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
        'The request advertised Sec-GPC: 1 and navigator.globalPrivacyControl = true.',
      trackers: gpcIgnored.map((t) => t.name),
    });
  }

  // Apply the same severity floor GPC_IGNORED uses. Without it, a single medium-severity
  // analytics tag whose consent signal was merely unreadable produces a critical finding,
  // and the exposure score is what ranks prospects and what the client reads first.
  const rejectIgnored = C.reportable.filter((t) => SEVERITY_RANK[t.severity] >= 2);

  if (reject.rejectClicked && rejectIgnored.length) {
    findings.push({
      id: 'REJECT_IGNORED',
      severity: 'critical',
      title: `${rejectIgnored.length} tracker(s) continued firing after the reject control was clicked`,
      detail:
        'The consent banner offered a reject control, it was clicked, and these trackers ' +
        'transmitted afterwards. This contradicts the choice the site itself presented.',
      trackers: rejectIgnored.map((t) => t.name),
    });
  }

  // Gate on bannerVisible, not just on recognising a named platform. A bespoke or
  // self-hosted banner is a real consent mechanism even when no signature matches it, and
  // claiming otherwise is a factual error the reader can disprove instantly.
  // A scan that found and clicked a reject control has proved a consent mechanism exists,
  // whatever the detectors concluded. Without this check the same document can say the
  // reject control was clicked in its method section and that no consent mechanism could be
  // identified in its findings — a self-contradiction a reader resolves against us.
  const rejectProvesMechanism = reject.rejectClicked === true;

  if (!hasCmp && !bannerVisible && !rejectProvesMechanism && A.reportable.length) {
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

  // Two guards, both learned from cases where this finding was wrong.
  //
  // First, a pass that failed to load cannot support any claim about the banner it never
  // saw — a transient network failure on our side would otherwise be rendered to the client
  // as a high-severity defect in their consent design.
  //
  // Second, the claim is about a *banner*, so it must rest on having seen one. A CMP script
  // request proves the SDK was served, not that a banner rendered; these SDKs ship to every
  // visitor while the banner itself is frequently geo-gated, so network evidence alone would
  // make this finding fire routinely on correctly-behaving sites.
  const rejectPassLoaded = !reject.error && (reject.observedRequestCount ?? 0) >= 1;

  if (!reject.rejectClicked && bannerVisible && rejectPassLoaded) {
    findings.push({
      id: 'NO_REJECT_CONTROL',
      severity: 'high',
      title: 'No reject control found on the consent banner',
      detail:
        'A consent banner is present but no reject or decline control could be found at the ' +
        'same level as accept. Automated interaction may miss a control that is only reachable ' +
        'through a preferences dialog, so this warrants a manual check before it is relied on.',
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
