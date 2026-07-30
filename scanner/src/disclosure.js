/**
 * Decides whether a piece of chat copy discloses that the user is talking to an AI,
 * to the standard Article 50(1) actually sets:
 *
 *   "...ensure that a reasonably informed user understands they are interacting with
 *    an AI system... in a clear and distinguishable manner at the latest at the time
 *    of the first interaction."
 *
 * Two failure modes to avoid, and they pull in opposite directions:
 *
 *   False positive - calling something a violation when it is compliant. This is the
 *   expensive one. If I send a company an audit that says they are exposed and their
 *   engineer opens the widget and sees "Hi, I'm an AI assistant," I have destroyed my
 *   credibility and the deal.
 *
 *   False negative - missing a real violation. Cheap; it just costs a lead.
 *
 * So the bias here is deliberately toward declaring compliance. Ambiguous evidence
 * resolves to NEEDS_REVIEW, never to VIOLATION.
 */

/** Unambiguous first-person AI disclosure. */
const STRONG = [
  /\bi(?:'m| am)\s+(?:an?\s+)?(?:ai|a\.i\.|artificial intelligence)\b/i,
  /\bi(?:'m| am)\s+(?:an?\s+)?(?:ai|automated|virtual|digital)\s+(?:assistant|agent|bot|helper)\b/i,
  /\bi(?:'m| am)\s+(?:a\s+)?(?:bot|chatbot)\b/i,
  /\byou(?:'re| are)\s+(?:now\s+)?(?:chatting|speaking|talking)\s+(?:with|to)\s+(?:an?\s+)?(?:ai|bot|virtual|automated|digital)/i,
  /\bthis\s+(?:chat|conversation|assistant|is)\s+(?:is\s+)?(?:powered by|uses|an?)\s*(?:ai|artificial intelligence)/i,
  /\bautomated\s+(?:assistant|agent|response|system)\b/i,
  /\bai[- ]powered\s+(?:assistant|agent|chat|support)\b/i,
  /\bpowered by\s+(?:ai|artificial intelligence|gpt|claude|gemini)\b/i,
  /\bvirtual\s+(?:assistant|agent)\b/i,
];

/**
 * Mentions AI but may not be a disclosure about the speaker. "Ask about our AI
 * products" is not a disclosure. These force human review rather than a verdict.
 */
const WEAK = [
  /\bai\b/i,
  /\bartificial intelligence\b/i,
  /\bbot\b/i,
  /\bautomat(?:ed|ic)\b/i,
  /\bassistant\b/i,
];

/** Explicit claims of being a human, which make an undisclosed AI worse, not better. */
const HUMAN_CLAIM = [
  /\b(?:a\s+)?(?:member of\s+)?our\s+team\s+(?:will|is|are)\b/i,
  /\bi(?:'m| am)\s+(?:a\s+)?(?:human|real person)\b/i,
  /\bspeak\s+(?:with|to)\s+(?:a\s+)?(?:human|person|agent|representative)\b/i,
  /\bconnect(?:ing)?\s+you\s+(?:with|to)\s+(?:a\s+)?(?:human|agent|representative)\b/i,
];

export const VERDICT = {
  DISCLOSED: 'DISCLOSED',
  NOT_DISCLOSED: 'NOT_DISCLOSED',
  NEEDS_REVIEW: 'NEEDS_REVIEW',
  NO_EVIDENCE: 'NO_EVIDENCE',
};

/**
 * @param {string} text  visible copy captured from the widget at first interaction
 * @param {object} opts
 * @param {string} opts.aiConfidence  'always' | 'usually' | 'hybrid' | 'human'
 */
export function assessDisclosure(text, { aiConfidence = 'hybrid' } = {}) {
  const clean = (text || '').replace(/\s+/g, ' ').trim();

  if (!clean) {
    return {
      verdict: VERDICT.NO_EVIDENCE,
      confidence: 0,
      reason: 'No chat copy captured; widget did not open or rendered no text.',
      matched: [],
    };
  }

  const strong = STRONG.filter((r) => r.test(clean)).map(String);
  if (strong.length) {
    return {
      verdict: VERDICT.DISCLOSED,
      confidence: 0.95,
      reason: 'Copy states plainly that the user is interacting with an AI system.',
      matched: strong,
    };
  }

  const weak = WEAK.filter((r) => r.test(clean)).map(String);
  const humanClaim = HUMAN_CLAIM.filter((r) => r.test(clean)).map(String);

  // Mentions AI somewhere but never says the speaker is one. Genuinely ambiguous, and
  // a human has to look. Never auto-fail this.
  if (weak.length) {
    return {
      verdict: VERDICT.NEEDS_REVIEW,
      confidence: 0.4,
      reason:
        'Copy references AI or automation but does not clearly identify the speaker as an ' +
        'AI system. Article 50(1) requires the disclosure be clear and distinguishable.',
      matched: weak,
    };
  }

  // No AI language at all. How strong a claim I can make depends entirely on how
  // certain I am that an AI is behind the widget.
  if (aiConfidence === 'always') {
    return {
      verdict: VERDICT.NOT_DISCLOSED,
      confidence: 0.9,
      reason:
        'Vendor is a purpose-built AI agent, yet no AI disclosure appears in the copy ' +
        'presented at first interaction.',
      matched: humanClaim,
    };
  }

  if (aiConfidence === 'usually') {
    return {
      verdict: VERDICT.NOT_DISCLOSED,
      confidence: 0.7,
      reason:
        'Vendor is an AI-first platform and no AI disclosure appears at first interaction. ' +
        'Confirm the AI feature is enabled before asserting exposure.',
      matched: humanClaim,
    };
  }

  // Hybrid or human-first vendor with no AI language. Most likely a human live chat,
  // which is simply out of scope. Saying "violation" here would be wrong.
  return {
    verdict: VERDICT.NEEDS_REVIEW,
    confidence: 0.3,
    reason:
      'No AI disclosure found, but the vendor is commonly deployed as human live chat, ' +
      'which falls outside Article 50(1). Scope must be confirmed before any claim.',
    matched: humanClaim,
  };
}
