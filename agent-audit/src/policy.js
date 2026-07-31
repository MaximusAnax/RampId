/**
 * Extracts checkable claims from a company's own published policy pages.
 *
 * This is the ground truth half of the AI agent audit. The product does not ask "is your
 * chatbot accurate", which needs the company's internal knowledge and invites argument about
 * whose standard applies. It asks a narrower and far more defensible question:
 *
 *     Does your public AI agent contradict your own published policies?
 *
 * Both sides of that comparison are public, so the finding needs nothing from the company and
 * cannot be waved away as a difference of opinion. "Your agent said 90 days, your returns page
 * says 30" is the same evidential quality as "this HTTP request was sent" — and it is exactly
 * the failure mode that made Air Canada liable for its chatbot's invented bereavement policy
 * in Moffatt v. Air Canada (2024 BCCRT 149).
 *
 * SCOPE, DELIBERATELY NARROW
 *
 * Only claims with a NUMERIC OR ENUMERABLE value are extracted: durations, amounts,
 * percentages, and counts. Vague semantic claims ("we aim to respond promptly") are ignored
 * on purpose, because a contradiction between two vague statements is arguable, and an
 * arguable finding is worse than no finding. Numbers are where the contradiction is objective
 * and where the reader concedes immediately.
 */

/** Policy areas worth checking, and the words that mark them. */
export const POLICY_AREAS = [
  { id: 'returns', label: 'returns', keywords: ['return', 'returned', 'returning'] },
  { id: 'refunds', label: 'refunds', keywords: ['refund', 'refunded', 'money back'] },
  { id: 'exchanges', label: 'exchanges', keywords: ['exchange', 'exchanged'] },
  { id: 'warranty', label: 'warranty', keywords: ['warranty', 'guarantee', 'guaranteed'] },
  // 'ship' bare, so "ships free" and "orders over $75 ship free" attach to shipping rather
  // than to whichever section heading happens to follow them.
  { id: 'shipping', label: 'shipping', keywords: ['shipping', 'ship', 'delivery', 'dispatch'] },
  { id: 'cancellation', label: 'cancellation', keywords: ['cancel', 'cancellation', 'cancelled'] },
  { id: 'price-match', label: 'price matching', keywords: ['price match', 'price matching'] },
];

/** Paths where these policies usually live, for discovery from a bare domain. */
export const POLICY_PATHS = [
  '/returns', '/returns-policy', '/return-policy', '/refunds', '/refund-policy',
  '/shipping', '/shipping-policy', '/delivery', '/warranty', '/guarantee',
  '/terms', '/terms-of-service', '/terms-and-conditions', '/policies', '/help/returns',
];

const DURATION_UNITS = {
  day: 1, days: 1,
  week: 7, weeks: 7,
  month: 30, months: 30,
  year: 365, years: 365,
};

/**
 * How far from a number to look for the policy area it belongs to.
 *
 * Asymmetric on purpose. Policy pages are structured with headings, so the word that names
 * the section ("Returns", "Shipping") almost always appears BEFORE the numbers it governs.
 * Weighting a preceding keyword more heavily than a following one is what stops "a 15%
 * restocking fee" in the returns section being attributed to the shipping heading that
 * happens to come next.
 */
const LOOK_BACK = 400;
const LOOK_FORWARD = 120;
const FORWARD_PENALTY = 4;

/**
 * Pull claims out of policy prose.
 *
 * @param {string} text     visible text of a policy page
 * @param {string} sourceUrl  where it came from, quoted as evidence
 * @returns {Array<Claim>}
 */
export function extractClaims(text, sourceUrl = null) {
  const clean = String(text ?? '').replace(/\s+/g, ' ');
  if (!clean.trim()) return [];

  const claims = [];
  const seen = new Set();

  const push = (claim) => {
    // One claim per (area, kind, value). Policy pages repeat themselves constantly, and a
    // report that lists the same fact four times reads as padding.
    const key = `${claim.area}|${claim.kind}|${claim.normalizedValue}`;
    if (seen.has(key)) return;
    seen.add(key);
    claims.push(claim);
  };

  // Durations: "within 30 days", "30-day return window", "up to 12 months"
  for (const match of clean.matchAll(/\b(\d{1,3})[\s-]?(day|days|week|weeks|month|months|year|years)\b/gi)) {
    const amount = Number(match[1]);
    const unit = match[2].toLowerCase();
    const area = areaFor(clean, match.index);
    if (!area) continue;
    push({
      id: `${area}-duration-${amount}${unit}`,
      area,
      kind: 'duration',
      value: amount,
      unit,
      normalizedValue: amount * DURATION_UNITS[unit],
      display: `${amount} ${unit}`,
      sourceUrl,
      sourceText: excerpt(clean, match.index, match[0].length),
    });
  }

  // Money: "$9.95 shipping", "orders over $50"
  for (const match of clean.matchAll(/\$\s?(\d{1,5}(?:\.\d{2})?)/g)) {
    const amount = Number(match[1]);
    const area = areaFor(clean, match.index);
    if (!area) continue;
    push({
      id: `${area}-money-${amount}`,
      area,
      kind: 'money',
      value: amount,
      unit: 'USD',
      normalizedValue: amount,
      display: `$${amount}`,
      sourceUrl,
      sourceText: excerpt(clean, match.index, match[0].length),
    });
  }

  // Percentages: "20% restocking fee"
  for (const match of clean.matchAll(/\b(\d{1,3})\s?%/g)) {
    const amount = Number(match[1]);
    const area = areaFor(clean, match.index);
    if (!area) continue;
    push({
      id: `${area}-percent-${amount}`,
      area,
      kind: 'percentage',
      value: amount,
      unit: '%',
      normalizedValue: amount,
      display: `${amount}%`,
      sourceUrl,
      sourceText: excerpt(clean, match.index, match[0].length),
    });
  }

  return claims;
}

/**
 * Which policy area a match sits in, decided by the words immediately around it.
 *
 * Returns null when nothing relevant is nearby, which drops the number entirely. That is the
 * conservative choice on purpose: a number attributed to the wrong policy area produces a
 * confident, specific, and completely wrong finding — the most damaging output this system
 * could generate.
 */
function areaFor(text, index) {
  const lower = text.toLowerCase();
  let best = null;
  let bestScore = Infinity;

  for (const area of POLICY_AREAS) {
    for (const keyword of area.keywords) {
      // Nearest occurrence before the number.
      const backStart = Math.max(0, index - LOOK_BACK);
      const before = lower.lastIndexOf(keyword, index);
      if (before >= backStart) {
        const score = index - before;
        if (score < bestScore) {
          bestScore = score;
          best = area.id;
        }
      }

      // Nearest occurrence after it, penalised so a following heading does not steal a
      // number that belongs to the section above it.
      const after = lower.indexOf(keyword, index);
      if (after !== -1 && after - index <= LOOK_FORWARD) {
        const score = (after - index) * FORWARD_PENALTY;
        if (score < bestScore) {
          bestScore = score;
          best = area.id;
        }
      }
    }
  }
  return best;
}

function excerpt(text, index, length) {
  const start = Math.max(0, index - 90);
  const end = Math.min(text.length, index + length + 90);
  return `${start > 0 ? '…' : ''}${text.slice(start, end).trim()}${end < text.length ? '…' : ''}`;
}

/**
 * Turn a claim into a question a customer would plausibly ask.
 *
 * Phrased as an ordinary customer enquiry, never as a test or a trap. Two reasons: a leading
 * question produces an answer the company can fairly disown, and a probe that reads as an
 * attack changes the legal posture of the whole exercise.
 */
export function questionFor(claim) {
  const questions = {
    returns: 'How long do I have to return an item?',
    refunds: 'How long does it take to get a refund, and is there any fee?',
    exchanges: 'How long do I have to exchange something?',
    warranty: 'How long is the warranty on your products?',
    shipping: 'How much is shipping and how long does delivery take?',
    cancellation: 'How long do I have to cancel an order?',
    'price-match': 'Do you price match, and for how long after purchase?',
  };
  return questions[claim.area] ?? `What is your ${claim.area} policy?`;
}

/** One question per policy area, so a probe run stays short and cheap for the target. */
export function questionSet(claims) {
  const byArea = new Map();
  for (const claim of claims) {
    if (!byArea.has(claim.area)) {
      byArea.set(claim.area, { area: claim.area, question: questionFor(claim), claims: [] });
    }
    byArea.get(claim.area).claims.push(claim);
  }
  return [...byArea.values()];
}
