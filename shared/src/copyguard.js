/**
 * The rule that keeps this out of demand-letter territory, enforced in code.
 *
 * Both products state observed facts and never legal conclusions. "This request was sent"
 * and "your agent said 90 days, your policy says 30" are observations. "You are in
 * violation" is a legal conclusion — unauthorized practice of law, and the sentence that
 * reframes the sender as one more mill the recipient's counsel tells them to ignore.
 *
 * It lives here rather than in either product because the rule is identical for both and a
 * guard that exists in two copies eventually disagrees with itself. It is enforced in code
 * rather than left to discipline because a single accusatory sentence, sent once, costs more
 * than every finding it might have won.
 */

export const BANNED_PATTERNS = [
  { pattern: /\bviolat(e|es|ed|ing|ion|ions|or|ors)\b/i, reason: 'states a legal conclusion' },
  { pattern: /\billegal(ly)?\b/i, reason: 'states a legal conclusion' },
  { pattern: /\bunlawful(ly)?\b/i, reason: 'states a legal conclusion' },
  { pattern: /\bnon[-\s]?compliant\b/i, reason: 'states a legal conclusion' },
  { pattern: /\bnon[-\s]?compliance\b/i, reason: 'states a legal conclusion' },
  { pattern: /\bbreach(es|ed|ing)?\b/i, reason: 'states a legal conclusion' },
  { pattern: /\bliable\b/i, reason: 'states a legal conclusion' },
  { pattern: /\bliabilit(y|ies)\b/i, reason: 'states a legal conclusion' },
  { pattern: /\bexposed\b/i, reason: 'asserts legal exposure' },
  { pattern: /\blegal exposure\b/i, reason: 'asserts legal exposure' },
  { pattern: /\bsue[ds]?\b/i, reason: 'predicts litigation against the reader' },
  { pattern: /\bsuing\b/i, reason: 'predicts litigation against the reader' },
  { pattern: /\blawsuits?\b/i, reason: 'predicts litigation against the reader' },
  { pattern: /\bclass[-\s]actions?\b/i, reason: 'predicts litigation against the reader' },
  { pattern: /\bdemand letters?\b/i, reason: 'predicts litigation against the reader' },
  { pattern: /\bstatutory damages\b/i, reason: 'predicts litigation against the reader' },
  { pattern: /\bdamages\b/i, reason: 'predicts litigation against the reader' },
  { pattern: /\bplaintiffs?\b/i, reason: 'predicts litigation against the reader' },
  // The compliance family. Without these a legal conclusion can be stated in plain English
  // without using any of the words above — "your site does not comply", "you are required
  // to display this", "this falls short of your obligations" — which is the same assertion
  // and the same problem.
  { pattern: /\b(?:do(?:es)?n[’']?t|do(?:es)? not|fail(?:s|ed|ing)? to|not in)\s+compl(?:y|iance)\b/i,
    reason: 'states a legal conclusion' },
  { pattern: /\byou(?:r site|r company)?\s+(?:are|is)\s+required\s+to\b/i,
    reason: 'states a legal conclusion about the reader' },
  { pattern: /\bfalls?\s+short\s+of\b/i, reason: 'states a legal conclusion' },
  { pattern: /\byour\s+obligations?\b/i, reason: 'states a legal conclusion about the reader' },
  { pattern: /\bpenalt(?:y|ies)\b/i, reason: 'predicts enforcement against the reader' },
  { pattern: /\bfined?\b/i, reason: 'predicts enforcement against the reader' },
  { pattern: /\benforcement action\b/i, reason: 'predicts enforcement against the reader' },
  { pattern: /\bpenalt(y|ies)\b/i, reason: 'threatens a sanction' },
  { pattern: /\bfined?\b/i, reason: 'threatens a sanction' },
  { pattern: /\bfines\b/i, reason: 'threatens a sanction' },
  { pattern: /\benforcement action\b/i, reason: 'threatens a sanction' },
  { pattern: /\bat risk\b/i, reason: 'characterises the reader instead of reporting an observation' },
  { pattern: /\brequired by law\b/i, reason: 'states a legal conclusion' },
  { pattern: /\blegally required\b/i, reason: 'states a legal conclusion' },
  { pattern: /\bmust comply\b/i, reason: 'states a legal conclusion' },
  { pattern: /\byou must\b/i, reason: 'instructs the reader instead of informing them' },
  { pattern: /\bact now\b/i, reason: 'manufactures urgency' },
  { pattern: /\burgent(ly)?\b/i, reason: 'manufactures urgency' },
  { pattern: /\bimmediately\b/i, reason: 'manufactures urgency' },
  { pattern: /\bbefore it('|’)?s too late\b/i, reason: 'manufactures urgency' },
  { pattern: /\blimited time\b/i, reason: 'manufactures urgency' },
  { pattern: /\blast chance\b/i, reason: 'manufactures urgency' },
  { pattern: /\btime[- ]sensitive\b/i, reason: 'manufactures urgency' },
  { pattern: /\bdeadlines?\b/i, reason: 'manufactures urgency' },
  { pattern: /\bas soon as possible\b/i, reason: 'manufactures urgency' },
  { pattern: /\basap\b/i, reason: 'manufactures urgency' },
  { pattern: /\btrusted by\b/i, reason: 'social proof this sender cannot evidence' },
  { pattern: /\bour (clients|customers)\b/i, reason: 'social proof this sender cannot evidence' },
  { pattern: /\bindustry[- ]leading\b/i, reason: 'social proof this sender cannot evidence' },
  { pattern: /\bmarket[- ]leading\b/i, reason: 'social proof this sender cannot evidence' },
  { pattern: /\bhundreds of (companies|clients|customers|brands)\b/i, reason: 'social proof this sender cannot evidence' },
  { pattern: /\bguarantee[ds]?\b/i, reason: 'promises an outcome this method cannot promise' },
  { pattern: /\bai[- ]powered\b/i, reason: 'selling "AI" is a negative credibility signal to this buyer' },
  { pattern: /\bpowered by ai\b/i, reason: 'selling "AI" is a negative credibility signal to this buyer' },
  { pattern: /[$£€]\s?\d/, reason: 'a monetary figure in first contact reads as a threat' },
];

function maskCapturedEvidence(text, capturedEvidence) {
  return [...capturedEvidence]
    .filter((item) => typeof item === 'string' && item.length >= 6)
    .sort((a, b) => b.length - a.length)
    .reduce((masked, item) => masked.split(item).join(' '), text);
}

export function findBannedPhrases(text, capturedEvidence = []) {
  const searched = maskCapturedEvidence(String(text ?? ''), capturedEvidence);
  const found = [];
  for (const entry of BANNED_PATTERNS) {
    const match = searched.match(entry.pattern);
    if (match) found.push({ phrase: match[0], reason: entry.reason });
  }
  return found;
}

export function assertFactualCopy(text, label = 'outreach copy', capturedEvidence = []) {
  const found = findBannedPhrases(text, capturedEvidence);
  if (!found.length) return text;
  const detail = found.map((f) => `"${f.phrase}" (${f.reason})`).join('; ');
  throw new Error(`${label} contains language this product never sends: ${detail}`);
}
