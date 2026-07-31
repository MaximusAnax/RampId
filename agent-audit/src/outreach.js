/**
 * Turns an agent audit into a sendable first message.
 *
 * The opening sentence does all the work here, and it has an advantage the tracking product
 * had to fight for: this finding is inherently non-adversarial. "Your agent told me 90 days,
 * your returns page says 30" is something a helpful customer might mention. It reads as
 * useful rather than as a threat, which is exactly the category the tracking outreach had to
 * be redesigned to reach.
 *
 * That advantage is easy to squander, so the rules are strict:
 *
 *   - Quote both sides. The recipient must be able to check the claim without replying, and
 *     the check should take under a minute.
 *   - Never mention liability, Air Canada, or what this could cost them. The precedent is
 *     why the finding matters, not something to wield. Their counsel already knows it, and
 *     raising it converts a helpful note into a threat.
 *   - Never say the agent lied, misled, or deceived. It stated a different number. That is
 *     the whole claim, and it is enough.
 *   - Say how you found it. A method the reader can repeat is what separates this from an
 *     anonymous accusation.
 */

import { assertFactualCopy } from '@evidence/shared/copyguard';

/** Extra banned phrasings specific to talking about an AI agent. */
const AGENT_BANNED = [
  { pattern: /\b(?:lied|lying|deceiv\w*|misle\w*|misrepresent\w*)\b/i, reason: 'characterises intent' },
  { pattern: /\bhallucinat\w*\b/i, reason: 'a loaded term the reader will dispute' },
  { pattern: /\bair canada\b/i, reason: 'invokes a precedent as leverage' },
  { pattern: /\b(?:could|would|might)\s+cost\s+you\b/i, reason: 'predicts financial harm' },
  { pattern: /\bbound\s+by\b/i, reason: 'states a legal conclusion about enforceability' },
];

export function assertAgentCopy(text, label = 'copy') {
  assertFactualCopy(text, label);
  for (const { pattern, reason } of AGENT_BANNED) {
    if (pattern.test(text)) {
      throw new Error(`${label} contains language this product never sends: ${pattern} (${reason})`);
    }
  }
  return text;
}

const host = (u) => {
  try {
    return new URL(u).hostname;
  } catch {
    return u;
  }
};

const formatDate = (iso) => {
  const d = new Date(iso);
  return Number.isNaN(d.getTime())
    ? null
    : d.toLocaleDateString('en-GB', { day: 'numeric', month: 'long', year: 'numeric' });
};

/**
 * Generate the first-contact message for an audit.
 *
 * Returns null when there is nothing worth saying. An audit where the agent was consistent
 * and correct produces no message at all — manufacturing a reason to make contact is how
 * this becomes spam, and the restraint is what makes the messages that do go out credible.
 */
export function generateOutreach(audit, { company = null, senderName = null } = {}) {
  const findings = audit?.findings ?? [];
  if (!findings.length || audit?.inconclusive) return null;

  // A direct contradiction leads over an inconsistency: it is concrete, checkable, and the
  // reader can act on it today.
  const conflict = findings.find((f) => f.id === 'AGENT_CONTRADICTS_POLICY');
  const finding = conflict ?? findings[0];

  const site = host(audit.url);
  const label = company ? `${company} (${site})` : site;
  const observed = formatDate(audit.startedAt);
  const when = observed ? ` on ${observed}` : '';

  const body = conflict
    ? [
        `I asked the assistant on ${label} how long customers have for ${finding.area}${when}, ` +
          `and it answered ${finding.agentSaid}. Your published ${finding.area} page says ` +
          `${finding.policySays}.`,

        `I asked the same question in ${sessionCount(finding)}, starting fresh each time, and ` +
          'got the same answer, so it does not look like a one-off.',

        'You can check it in a minute: open the assistant and ask the same question, then ' +
          `compare it against ${finding.policySource ?? 'your published policy page'}.`,

        'If it is useful I can send the full transcripts and the other policy areas I ' +
          'checked, at no charge and with nothing needed from your side.',
      ]
    : [
        `I asked the assistant on ${label} the same ${finding.area} question several times${when}, ` +
          'starting a fresh session each time, and got different answers.',

        `The answers I saw were: ${(finding.detail.match(/answers: ([^.]+)\./) ?? [, 'various'])[1]}.`,

        'None of them conflicted with your published pages, so this is about consistency ' +
          'rather than accuracy — a customer cannot rely on which answer they happen to get.',

        'If it is useful I can send the full transcripts, at no charge and with nothing ' +
          'needed from your side.',
      ];

  const closing =
    'This is an outside observation from your public site, not legal advice, and the ' +
    'question of what it means is one for your own team.';

  const lines = [...body, closing];
  if (senderName) lines.push(`\n— ${senderName}`);

  const subject = conflict
    ? `${site} assistant and your ${finding.area} page give different answers`
    : `${site} assistant gives different ${finding.area} answers between sessions`;

  assertAgentCopy(subject, 'subject');
  for (const [i, line] of lines.entries()) assertAgentCopy(line, `body[${i}]`);

  return {
    subject,
    body: lines.join('\n\n'),
    finding,
    // The sender's own verification sheet: exactly what is being claimed, so it can be
    // checked against the audit before anything is sent.
    plainFacts: conflict
      ? [
          `Agent said: ${finding.agentSaid}`,
          `Published policy says: ${finding.policySays}`,
          `Policy source: ${finding.policySource ?? 'not recorded'}`,
          `Reproduced in: ${finding.reproducedIn}`,
          `Transcript captured: ${finding.transcript ? 'yes' : 'no'}`,
        ]
      : [
          `Area: ${finding.area}`,
          `Observation: inconsistent answers across sessions`,
          `Reproduced in: ${finding.reproducedIn}`,
        ],
  };
}

function sessionCount(finding) {
  const m = String(finding.reproducedIn ?? '').match(/(\d+)\s+of\s+(\d+)/);
  return m ? `${m[2]} separate sessions` : 'several separate sessions';
}
