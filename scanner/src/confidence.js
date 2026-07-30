/**
 * Scores how much human review a finding actually needs before it is sent.
 *
 * The runbook budgets forty minutes a week to reading drafts, and that is the largest
 * remaining block of founder time in the whole operation. Most of it is spent re-confirming
 * findings that were never in doubt. This module exists to spend that attention where it
 * changes an outcome.
 *
 * The asymmetry that governs everything here: sending one wrong finding costs more than
 * missing ten right ones. So this never says "safe to send" — the highest rating is
 * "routine," and a human still reads it. What it does is make the borderline cases
 * unmissable, so the forty minutes goes to the four drafts that deserve it rather than
 * being spread evenly over twenty that do not.
 */

/**
 * How self-evident each finding type is from the evidence alone.
 *
 * REJECT_IGNORED sits highest because the company built the reject control itself: there is
 * no argument available about whether the standard was fair, only about whether the
 * observation is accurate. NO_REJECT_CONTROL sits lowest because automated interaction
 * genuinely misses controls reachable only through a preferences dialog, and asserting a
 * company offers no way to decline when it does is the most embarrassing error available.
 */
const BASE_CONFIDENCE = {
  REJECT_IGNORED: 0.9,
  PRE_CONSENT: 0.85,
  GPC_IGNORED: 0.8,
  OPTOUT_NOT_DISPLAYED: 0.75,
  AI_NOT_DISCLOSED: 0.6,
  NO_CMP: 0.5,
  NO_REJECT_CONTROL: 0.4,
};

export const REVIEW = {
  ROUTINE: 'routine',
  CHECK: 'check',
  HOLD: 'hold',
};

/**
 * Score one finding in the context of the scan it came from.
 *
 * @returns {{confidence: number, review: string, reasons: string[]}}
 */
export function scoreFinding(finding, scan) {
  let confidence = BASE_CONFIDENCE[finding.id] ?? 0.5;
  const reasons = [];

  // Capture health dominates everything else. A partial capture can produce a finding that
  // is locally correct and globally misleading, and no amount of per-finding evidence
  // compensates for not having seen the whole page.
  if (scan?.capture && !scan.capture.ok) {
    confidence -= 0.35;
    reasons.push('Not all three passes loaded cleanly.');
  }

  // A named, curated service carries a description written for this purpose. A long-tail
  // match from the broad dataset is accurate about *what* fired but says less about why it
  // matters, which is exactly where a reader pushes back.
  const named = findingTrackers(finding, scan);
  if (named.length) {
    const curated = named.filter((t) => t.source === 'curated' || t.severity === 'critical');
    if (curated.length) {
      confidence += 0.05;
    } else {
      confidence -= 0.1;
      reasons.push('Only long-tail services matched; no curated high-severity service.');
    }
  }

  // Findings that name no service at all are structural claims about the page, and those
  // are the ones automated interaction most often gets wrong.
  if (!finding.trackers?.length && finding.id !== 'OPTOUT_NOT_DISPLAYED') {
    confidence -= 0.1;
    reasons.push('Finding names no specific service.');
  }

  // A reject-pass claim is only as good as the click that produced it.
  if (finding.id === 'REJECT_IGNORED' && !scan?.passes?.afterReject?.rejectClicked) {
    confidence -= 0.4;
    reasons.push('Reject control was not confirmed clicked.');
  }

  // Claiming there is no consent mechanism on a page where a banner was seen is the
  // contradiction a reader settles in one click.
  if ((finding.id === 'NO_CMP' || finding.id === 'NO_REJECT_CONTROL') && scan?.bannerVisible) {
    confidence -= 0.2;
    reasons.push('A banner was visible, so the page has some consent mechanism.');
  }

  // Everything the site restrained correctly is evidence its stack is configured with some
  // care, which raises the prior that anything still firing is deliberate rather than an
  // artefact of how it was measured.
  const restrained = countRestrained(scan);
  if (restrained > 0) {
    confidence += 0.05;
  }

  confidence = Math.max(0, Math.min(1, Number(confidence.toFixed(2))));

  const review =
    confidence >= 0.8 ? REVIEW.ROUTINE : confidence >= 0.6 ? REVIEW.CHECK : REVIEW.HOLD;

  return { confidence, review, reasons };
}

/**
 * Score a whole scan, and say plainly what a human should do with it.
 *
 * A scan is only as sendable as its weakest reported finding, because the message goes out
 * as one document and a reader who disproves any part of it stops trusting the rest.
 */
export function scoreScan(scan) {
  const findings = scan?.findings ?? [];
  if (!findings.length) {
    return { review: REVIEW.ROUTINE, confidence: 1, findings: [], guidance: 'Nothing to send.' };
  }

  const scored = findings.map((f) => ({ ...f, ...scoreFinding(f, scan) }));
  const weakest = scored.reduce((min, f) => (f.confidence < min.confidence ? f : min), scored[0]);

  const guidance =
    weakest.review === REVIEW.HOLD
      ? `Do not send as written. ${weakest.title} needs a manual check first.`
      : weakest.review === REVIEW.CHECK
        ? `Open the site and confirm: ${weakest.title}.`
        : 'Read once, then send.';

  return {
    review: weakest.review,
    confidence: weakest.confidence,
    findings: scored,
    guidance,
  };
}

function findingTrackers(finding, scan) {
  const names = new Set(finding.trackers ?? []);
  if (!names.size || !scan?.passes) return [];
  return Object.values(scan.passes)
    .flatMap((p) => p.trackers ?? [])
    .filter((t) => names.has(t.name));
}

function countRestrained(scan) {
  if (!scan?.passes) return 0;
  return Object.values(scan.passes).reduce((n, p) => n + (p.restrained?.length ?? 0), 0);
}
