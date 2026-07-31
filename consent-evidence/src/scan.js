import { launchBrowser } from '@evidence/shared/browser';
import { identifyVendors, aiLikelihood } from './vendors.js';
import { assessDisclosure, VERDICT } from './disclosure.js';

const AI_ORDER = ['human', 'hybrid', 'usually', 'always'];

/** Selectors and accessible-name patterns that open a chat widget. */
const LAUNCHER_SELECTORS = [
  '#launcher',
  '.intercom-launcher',
  '[class*="intercom-launcher"]',
  '[id*="intercom-container"] [role="button"]',
  '#drift-widget',
  '[id*="drift-frame-controller"]',
  '#hubspot-messages-iframe-container',
  '.embeddedServiceHelpButton',
  '#fc_frame',
  '#tidio-chat',
  '.crisp-client',
  '#tawkchat-minified-container',
  '[data-testid*="launcher"]',
];

const LAUNCHER_NAME_RE = /chat|help|support|message|assistant|ask|talk to us|contact us|live/i;

/** Ignore boilerplate that appears on every page and pollutes the captured copy. */
const NOISE_RE = /cookie|accept all|privacy policy|subscribe|newsletter|©|all rights reserved/i;

export async function scanSite(url, opts = {}) {
  const {
    timeoutMs = 45000,
    screenshotPath = null,
    headless = true,
    userAgent = 'Mozilla/5.0 (compatible; A50Audit/0.1; +compliance research scanner)',
  } = opts;

  const started = Date.now();
  const result = {
    url,
    scannedAt: new Date().toISOString(),
    reachable: false,
    vendors: [],
    aiConfidence: 'human',
    widgetOpened: false,
    capturedText: '',
    assessment: null,
    signals: {},
    errors: [],
    durationMs: 0,
  };

  // Proxy is opt-in, matching consent.js. Routing through an intercepting proxy that
  // re-signs TLS breaks sub-resource loading badly enough that pages render empty and
  // every widget looks absent — a silent false negative, the worst failure mode here.
  const proxyServer = process.env.A50_PROXY || null;

  const browser = await launchBrowser();
  const context = await browser.newContext({
    userAgent,
    ignoreHTTPSErrors: Boolean(proxyServer),
    viewport: { width: 1440, height: 900 },
    locale: 'en-GB',
    // Article 50 scope follows EU market access, so present as an EU visitor. Some
    // sites geo-gate their chat widget, and a US-looking visitor would see a
    // different surface than the one the regulation actually applies to.
    timezoneId: 'Europe/Brussels',
  });

  const requestUrls = new Set();
  context.on('request', (r) => requestUrls.add(r.url()));

  const page = await context.newPage();

  try {
    await page.goto(url, { waitUntil: 'domcontentloaded', timeout: timeoutMs });
    result.reachable = true;

    // Widgets are almost always injected late, after the main document settles.
    await page.waitForTimeout(6000);
    await dismissConsent(page);
    await page.waitForTimeout(2000);

    const html = await page.content().catch(() => '');
    const haystack = [...requestUrls].join(' ') + ' ' + html;

    result.vendors = identifyVendors(haystack).map((v) => ({ id: v.id, name: v.name, ai: v.ai }));
    result.aiConfidence = AI_ORDER[aiLikelihood(result.vendors)] ?? 'human';
    result.signals = await collectSignals(page, haystack);

    const opened = await openWidget(page);
    result.widgetOpened = opened;

    if (opened) {
      await page.waitForTimeout(4000);
      result.capturedText = await captureChatCopy(page);
    }

    result.assessment = assessDisclosure(result.capturedText, {
      aiConfidence: result.aiConfidence,
    });

    // A widget we could not open is a gap in evidence, not a finding. Say so plainly
    // rather than letting an absent-text result read as a violation.
    if (!opened && result.vendors.length) {
      result.assessment = {
        verdict: VERDICT.NEEDS_REVIEW,
        confidence: 0.25,
        reason:
          `Detected ${result.vendors.map((v) => v.name).join(', ')} but could not open the ` +
          'widget automatically. Manual check required before any claim is made.',
        matched: [],
      };
    }

    if (screenshotPath) {
      await page.screenshot({ path: screenshotPath, fullPage: false }).catch(() => {});
      result.screenshot = screenshotPath;
    }
  } catch (err) {
    result.errors.push(String(err.message || err).slice(0, 300));
  } finally {
    await browser.close().catch(() => {});
    result.durationMs = Date.now() - started;
  }

  return result;
}

/** Consent banners sit on top of the launcher and block the click. */
async function dismissConsent(page) {
  const patterns = [
    /^(accept|allow|agree|got it|ok)\b/i,
    /accept all/i,
    /allow all/i,
    /i agree/i,
  ];
  for (const re of patterns) {
    try {
      const btn = page.getByRole('button', { name: re }).first();
      if (await btn.isVisible({ timeout: 1200 })) {
        await btn.click({ timeout: 2500 });
        return true;
      }
    } catch {
      /* no banner matching this pattern */
    }
  }
  return false;
}

/** Other Article 50 surfaces worth recording while the page is already loaded. */
async function collectSignals(page, haystack) {
  const lower = haystack.toLowerCase();
  return {
    // 50(2) machine-readable marking of synthetic content
    c2pa: /c2pa|contentcredentials|content credentials/i.test(lower),
    // llms.txt / agent directives, adjacent readiness signal
    aiPolicyMeta: await page
      .locator('meta[name*="ai" i], meta[name*="robots" i][content*="noai" i]')
      .count()
      .catch(() => 0),
    mentionsAiAssistant: /\b(ai assistant|virtual assistant|ai agent|chatbot)\b/i.test(lower),
    hasVoiceWidget: /voice|speech|vapi|retell|elevenlabs/i.test(lower),
  };
}

async function openWidget(page) {
  for (const sel of LAUNCHER_SELECTORS) {
    try {
      const el = page.locator(sel).first();
      if (await el.isVisible({ timeout: 800 })) {
        await el.click({ timeout: 3000, force: true });
        return true;
      }
    } catch {
      /* selector absent on this site */
    }
  }

  // Accessible-name fallback catches custom widgets the selector list misses.
  try {
    const byName = page.getByRole('button', { name: LAUNCHER_NAME_RE }).last();
    if (await byName.isVisible({ timeout: 1500 })) {
      await byName.click({ timeout: 3000, force: true });
      return true;
    }
  } catch {
    /* no accessible launcher */
  }

  // Many widgets render the launcher inside their own iframe.
  for (const frame of page.frames()) {
    if (frame === page.mainFrame()) continue;
    try {
      const btn = frame.locator('button, [role="button"], a').first();
      if (await btn.isVisible({ timeout: 800 })) {
        await btn.click({ timeout: 2500, force: true });
        return true;
      }
    } catch {
      /* frame not interactive */
    }
  }

  return false;
}

/** Pull the copy a real user would see in the opened widget, across all frames. */
async function captureChatCopy(page) {
  const chunks = [];

  for (const frame of page.frames()) {
    try {
      const url = frame.url();
      const isChatFrame =
        frame === page.mainFrame() ||
        /intercom|drift|zendesk|zopim|hubspot|freshchat|tidio|crisp|tawk|ada|sierra|decagon|liveperson|salesforce|qualified|gorgias/i.test(
          url
        );
      if (!isChatFrame) continue;

      const text = await frame.evaluate(() => {
        const containers = document.querySelectorAll(
          '[class*="chat" i],[class*="messenger" i],[class*="conversation" i],' +
            '[id*="chat" i],[role="dialog"],[role="log"],[aria-live]'
        );
        const pool = containers.length ? containers : [document.body];
        return [...pool]
          .map((n) => n.innerText || '')
          .join('\n')
          .slice(0, 6000);
      });

      if (text && text.trim()) chunks.push(text);
    } catch {
      /* cross-origin frame we cannot read; skip */
    }
  }

  return chunks
    .join('\n')
    .split('\n')
    .map((l) => l.trim())
    .filter((l) => l.length > 2 && l.length < 400 && !NOISE_RE.test(l))
    .filter((l, i, a) => a.indexOf(l) === i)
    .slice(0, 60)
    .join('\n');
}
