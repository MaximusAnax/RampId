/**
 * Consent platform detection and reject-control interaction.
 *
 * This module exists because of a false positive found by testing against real consent
 * managers rather than hand-written fixtures. The original detector identified consent
 * platforms purely by network signature - a request to cookielaw.org means OneTrust, and so
 * on. That works for hosted platforms and fails completely for:
 *
 *   - self-hosted open-source managers (Klaro, vanilla-cookieconsent, Osano's cookieconsent),
 *     which serve from the site's own domain and make no third-party request at all
 *   - platforms bundled into the site's main JavaScript
 *   - first-party-proxied hosted platforms
 *
 * In all those cases the scanner reported "no consent management platform detected" about a
 * site with a consent banner plainly visible on screen. Sending that to a prospect is worse
 * than sending nothing: it is a factual claim they can disprove in five seconds, and it
 * discredits every other finding in the report.
 *
 * So detection now runs three ways, and the DOM is the authority when they disagree.
 *
 * The class names below were extracted from the shipped CSS of the actual libraries rather
 * than guessed, so they match what really renders.
 */

/** DOM signatures, keyed to what each platform actually renders. */
export const DOM_SIGNATURES = [
  { id: 'onetrust', name: 'OneTrust', selectors: ['#onetrust-banner-sdk', '#onetrust-consent-sdk', '.optanon-alert-box-wrapper'] },
  { id: 'cookiebot', name: 'Cookiebot', selectors: ['#CybotCookiebotDialog', '#CookiebotWidget'] },
  { id: 'usercentrics', name: 'Usercentrics', selectors: ['#usercentrics-root', '[data-testid="uc-container"]'] },
  { id: 'didomi', name: 'Didomi', selectors: ['#didomi-host', '.didomi-popup-container', '#didomi-notice'] },
  { id: 'trustarc', name: 'TrustArc', selectors: ['#truste-consent-track', '#consent_blackbar'] },
  { id: 'osano', name: 'Osano', selectors: ['.osano-cm-window', '.osano-cm-dialog'] },
  { id: 'quantcast', name: 'Quantcast Choice', selectors: ['.qc-cmp2-container', '#qc-cmp2-ui'] },
  { id: 'termly', name: 'Termly', selectors: ['#termly-code-snippet-support', '.t-consentPrompt'] },
  { id: 'iubenda', name: 'iubenda', selectors: ['#iubenda-cs-banner', '.iubenda-cs-container'] },
  { id: 'cookieyes', name: 'CookieYes', selectors: ['.cky-consent-container', '#cookieyes'] },
  { id: 'complianz', name: 'Complianz', selectors: ['#cmplz-cookiebanner-container', '.cmplz-cookiebanner'] },
  { id: 'sourcepoint', name: 'Sourcepoint', selectors: ['.sp_message_container', '#sp_message_container_1'] },
  { id: 'klaro', name: 'Klaro (self-hosted)', selectors: ['.klaro', '.cookie-notice', '#klaro'] },
  { id: 'vanilla-cc', name: 'vanilla-cookieconsent (self-hosted)', selectors: ['#cc-main', '.cm-wrapper', '.cm__btn'] },
  { id: 'osano-cc', name: 'cookieconsent (self-hosted)', selectors: ['.cc-window', '.cc-banner'] },
  { id: 'cookie-script', name: 'CookieScript', selectors: ['#cookiescript_injected'] },
  { id: 'axeptio', name: 'Axeptio', selectors: ['#axeptio_overlay', '.axeptio_widget'] },
  { id: 'tarteaucitron', name: 'tarteaucitron', selectors: ['#tarteaucitronRoot', '#tarteaucitronAlertBig'] },
];

/**
 * Reject-control labels, ordered most-specific first.
 *
 * Order matters. "Reject all" must be tried before a bare "Reject", and anything explicitly
 * about necessary-only must be tried before generic decline text, because several platforms
 * render both and clicking the wrong one produces a partial opt-out that the scanner would
 * then wrongly report as a full rejection being ignored.
 */
export const REJECT_LABELS = [
  /^reject all( cookies)?$/i,
  /^decline all( cookies)?$/i,
  /^refuse all( cookies)?$/i,
  /^deny all( cookies)?$/i,
  /^(use )?(only |strictly )?necessary( cookies)?( only)?$/i,
  /^essential (cookies )?only$/i,
  /^only essential( cookies)?$/i,
  /^continue without accepting$/i,
  /^continue without agreeing$/i,
  /^i do not accept$/i,
  /^do not (sell|share)( my (personal )?information)?$/i,
  /^opt.?out( of all)?$/i,
  /^reject$/i,
  /^decline$/i,
  /^refuse$/i,
  /^disagree$/i,
];

/** Platform-specific reject selectors, from each library's own markup. */
export const REJECT_SELECTORS = [
  '#onetrust-reject-all-handler',
  '.ot-pc-refuse-all-handler',
  '#CybotCookiebotDialogBodyButtonDecline',
  '#CybotCookiebotDialogBodyLevelButtonLevelOptinDeclineAll',
  '.osano-cm-denyAll',
  '#didomi-notice-disagree-button',
  '.qc-cmp2-summary-buttons button[mode="secondary"]',
  '.cky-btn-reject',
  '.cmplz-deny',
  '#iubenda-cs-reject-btn',
  '[data-role="necessary"]',
  '[data-cc-action="reject"]',
  '.cm__btn[data-role="necessary"]',
  '.cm-btn-decline',
  '#tarteaucitronAllDenied2',
  'button[aria-label*="reject" i]',
  'button[aria-label*="decline" i]',
  'button[id*="reject" i]',
  'button[class*="reject" i]',
  'button[class*="decline" i]',
];

/** Text that suggests an element is a consent banner even when the platform is unknown. */
const BANNER_TEXT = /\b(cookie|consent|privacy|tracking|we use|your choices|manage preferences)\b/i;

/**
 * Detect consent platforms present on a loaded page.
 *
 * @param page  a Playwright Page
 * @param networkHits  platform names already identified from network signatures
 * @returns {Promise<{platforms: string[], source: string, bannerVisible: boolean}>}
 */
export async function detectConsentPlatform(page, networkHits = []) {
  const found = new Set(networkHits);
  let domMatched = false;

  for (const sig of DOM_SIGNATURES) {
    for (const sel of sig.selectors) {
      try {
        if ((await page.locator(sel).count()) > 0) {
          found.add(sig.name);
          domMatched = true;
          break;
        }
      } catch {
        // An invalid selector for this page shape is not an error worth surfacing.
      }
    }
  }

  // Generic fallback. A site can run a bespoke banner with no recognisable signature at all,
  // and claiming it has no consent mechanism would be the same false positive in a new form.
  let bannerVisible = domMatched;
  if (!found.size) {
    try {
      bannerVisible = await page.evaluate((pattern) => {
        const re = new RegExp(pattern, 'i');
        const candidates = document.querySelectorAll('div,section,aside,dialog,[role="dialog"]');
        for (const el of candidates) {
          const style = getComputedStyle(el);
          if (style.position !== 'fixed' && style.position !== 'sticky') continue;
          if (style.display === 'none' || style.visibility === 'hidden') continue;
          const text = (el.innerText || '').slice(0, 400);
          if (!re.test(text)) continue;
          if (el.querySelector('button,a[role="button"],input[type="button"]')) return true;
        }
        return false;
      }, BANNER_TEXT.source);
    } catch {
      bannerVisible = false;
    }
  }

  return {
    platforms: [...found],
    source: networkHits.length && domMatched ? 'network+dom' : domMatched ? 'dom' : networkHits.length ? 'network' : 'none',
    bannerVisible: bannerVisible || found.size > 0,
  };
}

/**
 * Click a reject control if one can be found.
 *
 * Returns a structured result rather than a bare boolean, because "clicked reject" and
 * "there was no reject control" and "there was no banner at all" are three different
 * findings and collapsing them loses the distinction the report depends on.
 */
export async function clickReject(page, { timeoutMs = 900 } = {}) {
  // Platform-specific selectors first: they are unambiguous where they match.
  for (const sel of REJECT_SELECTORS) {
    for (const frame of page.frames()) {
      try {
        const el = frame.locator(sel).first();
        if (await el.isVisible({ timeout: timeoutMs })) {
          await el.click({ timeout: 2500 });
          return { clicked: true, method: 'selector', matched: sel };
        }
      } catch {
        // Not present in this frame; try the next.
      }
    }
  }

  // Accessible-name matching. Covers custom banners and platforms not in the selector list.
  // Playwright's getByRole pierces open shadow roots, which several platforms use.
  for (const re of REJECT_LABELS) {
    for (const frame of page.frames()) {
      for (const role of ['button', 'link']) {
        try {
          const el = frame.getByRole(role, { name: re }).first();
          if (await el.isVisible({ timeout: timeoutMs })) {
            await el.click({ timeout: 2500 });
            return { clicked: true, method: 'role', matched: String(re) };
          }
        } catch {
          // Keep trying other roles/frames/labels.
        }
      }
    }
  }

  return { clicked: false, method: null, matched: null };
}
