/**
 * Detects whether a site displays that it processed an opt-out preference signal.
 *
 * WHY THIS IS THE LEAD FINDING
 *
 * California's CCPA regulations § 7025(c)(6) changed from "may" to "shall" effective
 * 1 January 2026: a business that processes an opt-out preference signal **must display**
 * that it has done so. That single word change is the most commercially useful fact in this
 * whole domain, for four reasons:
 *
 *   1. It is dated and new, so it is a legitimate reason to make contact now.
 *   2. It is a positive obligation — something the site must *show* — which makes
 *      non-compliance externally observable rather than inferable.
 *   3. It is almost universally unmet, because almost nobody has noticed the change.
 *   4. Most importantly, it reframes the entire outreach. "Since 1 January the regulation
 *      requires your site to display that it processed an opt-out signal, and here is what
 *      yours displays" is a compliance observation. "Here is the tracking pixel that fired"
 *      is, in form, indistinguishable from the demand letters that four volume plaintiff
 *      firms send to hundreds of brands weekly — which recipients' counsel have trained
 *      them to forward and never answer.
 *
 * Same scan, opposite category. This module is what makes that reframing possible.
 *
 * A tailwind worth knowing: AB 566, signed 8 October 2025 and operative 1 January 2027,
 * requires browsers to offer an opt-out preference signal. GPC traffic is about to rise
 * sharply, which makes failing to handle it more expensive over time rather than less.
 */

/**
 * Language a site uses when it acknowledges an opt-out preference signal.
 *
 * Deliberately broad. A false negative here costs a lead; a false positive means telling a
 * company it failed to display something it did display, which is the accusation class that
 * destroys credibility. So anything plausibly acknowledging the signal counts as displayed.
 */
const ACKNOWLEDGEMENT = [
  /opt[- ]?out preference signal/i,
  /global privacy control/i,
  /\bGPC\b/,
  /you (?:have been|are) opted[- ]?out/i,
  /we (?:have )?(?:detected|received|honou?red|processed|recognised|recognized)[^.]{0,40}(?:signal|preference|gpc)/i,
  /your (?:opt[- ]?out|privacy) (?:preference|choice|signal) (?:has been|was) (?:applied|honou?red|processed|received)/i,
  /do not sell[^.]{0,30}(?:opted[- ]?out|honou?red|applied)/i,
  /signal (?:has been|was) (?:honou?red|processed|applied|detected)/i,
];

/** Text that only offers a control, without acknowledging a signal was processed. */
const MERE_LINK = /do not sell or share my personal information/i;

/**
 * Inspect a page loaded with the Global Privacy Control signal enabled.
 *
 * Must be called on the GPC pass. Calling it on a baseline load would be meaningless: the
 * obligation is to display that a signal *was processed*, and no signal was sent.
 *
 * @param page  a Playwright Page from the GPC pass
 */
export async function detectOptOutDisplay(page) {
  let visibleText = '';
  try {
    visibleText = await page.evaluate(() => document.body?.innerText?.slice(0, 20000) ?? '');
  } catch {
    return {
      displayed: null,
      evidence: null,
      note: 'Page text could not be read, so no conclusion is drawn.',
    };
  }

  if (!visibleText.trim()) {
    return {
      displayed: null,
      evidence: null,
      note: 'No page text was captured, so no conclusion is drawn.',
    };
  }

  for (const pattern of ACKNOWLEDGEMENT) {
    const match = visibleText.match(pattern);
    if (match) {
      return {
        displayed: true,
        evidence: contextAround(visibleText, match.index, match[0].length),
        note: 'The page acknowledges an opt-out preference signal.',
      };
    }
  }

  // A "Do Not Sell" link is a control, not an acknowledgement. Worth recording separately,
  // because it shows the company knows the obligation exists and has addressed a different
  // part of it — which is a more useful and less accusatory observation than silence.
  const hasControlOnly = MERE_LINK.test(visibleText);

  return {
    displayed: false,
    evidence: null,
    hasOptOutLinkOnly: hasControlOnly,
    note: hasControlOnly
      ? 'An opt-out link is present, but the page does not indicate that the browser’s ' +
        'opt-out preference signal was processed.'
      : 'No indication was found that the browser’s opt-out preference signal was processed.',
  };
}

function contextAround(text, index, length) {
  const start = Math.max(0, index - 60);
  const end = Math.min(text.length, index + length + 60);
  return text.slice(start, end).replace(/\s+/g, ' ').trim();
}

/**
 * Build the finding, if there is one.
 *
 * Only a confident negative produces a finding. A page whose text could not be read yields
 * nothing, because missing evidence is not evidence of a failure.
 */
export function optOutDisplayFinding(
  detection,
  { gpcHonoured = null, sharesWithThirdParties = true } = {}
) {
  if (!detection || detection.displayed !== false) return null;

  // Section 7025(c)(6) attaches to "a business that processes an opt-out preference signal."
  // A site observed sharing nothing with third parties may have no such obligation at all,
  // and telling a company with no tracking that it has failed a display requirement is
  // precisely the false accusation that would discredit the lead finding this product is
  // built on. When nothing was observed leaving the page, stay silent.
  if (!sharesWithThirdParties) return null;

  return {
    id: 'OPTOUT_NOT_DISPLAYED',
    severity: 'high',
    title: 'No indication that the opt-out preference signal was processed',
    detail:
      'The page was loaded with Global Privacy Control enabled — Sec-GPC: 1 and ' +
      'navigator.globalPrivacyControl set — and nothing on the page indicated the signal ' +
      'had been processed. California’s CCPA regulations at section 7025(c)(6) changed from ' +
      '"may" to "shall" effective 1 January 2026, requiring a business that processes an ' +
      'opt-out preference signal to display that it has done so. ' +
      (detection.hasOptOutLinkOnly
        ? 'An opt-out link is present, so the underlying control exists; what is absent is ' +
          'the confirmation that the browser signal itself was acted on.'
        : '') +
      (gpcHonoured === false
        ? ' Third-party transmission also continued during this pass.'
        : ''),
    trackers: [],
  };
}
