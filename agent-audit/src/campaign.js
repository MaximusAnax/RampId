/**
 * Runs agent audits across a target list and produces a ready-to-act queue.
 *
 * The concurrency posture here is far more conservative than the tracking campaign, and the
 * reason is economic rather than technical: every probe spends the target's money on model
 * inference. A tracking scan costs someone a few HTTP responses; an agent probe costs them
 * real compute, per question, per session. Running these the way a page scanner runs would
 * be both a bad neighbour and a bad legal posture.
 *
 * So: low concurrency, sequential sessions within a target, pauses between everything, and a
 * hard cap on questions per target that comes from the policy pages rather than from
 * curiosity.
 */

import { normalizeTargets, dedupe, prioritize } from '@evidence/shared/discover';
import { auditAgent } from './agentaudit.js';
import { renderAgentReport } from './agentreport.js';
import { generateOutreach } from './outreach.js';

/**
 * @param {string[]} rawTargets
 * @param {object} opts
 * @param {number} opts.concurrency  parallel targets; deliberately low
 * @param {number} opts.runs         independent sessions per question
 * @param {string} opts.senderName   signature on generated drafts
 */
export async function runCampaign(rawTargets, opts = {}) {
  const {
    concurrency = 2,
    runs = 3,
    senderName = null,
    betweenTargetsMs = 2000,
    onAudit = null,
  } = opts;

  const { targets: parsed, rejected } = normalizeTargets(rawTargets);
  const prioritized = prioritize(dedupe(parsed));

  const audits = [];
  const failures = [];
  let cursor = 0;

  await Promise.all(
    Array.from({ length: Math.min(concurrency, prioritized.length) }, async () => {
      while (cursor < prioritized.length) {
        const target = prioritized[cursor++];
        const url = target.url ?? target;
        try {
          const audit = await auditAgent(url, { runs, ...opts });
          audits.push(audit);
          if (onAudit) onAudit(audit, null);
        } catch (err) {
          // Recorded rather than dropped: a target that silently disappears looks identical
          // to one audited and found clean.
          failures.push({ url, error: String(err.message || err) });
          if (onAudit) onAudit(null, { url, error: String(err.message || err) });
        }
        if (betweenTargetsMs) await new Promise((r) => setTimeout(r, betweenTargetsMs));
      }
    })
  );

  const conclusive = audits.filter((a) => !a.inconclusive);
  const inconclusive = audits.filter((a) => a.inconclusive);

  const ranked = conclusive
    .map((audit) => ({
      audit,
      url: audit.url,
      findingCount: audit.findings.length,
      // A direct contradiction outranks an inconsistency: it is concrete and actionable
      // today, where inconsistency is a reliability observation.
      hasConflict: audit.findings.some((f) => f.id === 'AGENT_CONTRADICTS_POLICY'),
      report: renderAgentReport(audit),
      draft: safeDraft(audit, senderName),
    }))
    .sort((a, b) => {
      if (a.hasConflict !== b.hasConflict) return a.hasConflict ? -1 : 1;
      if (Boolean(a.draft) !== Boolean(b.draft)) return a.draft ? -1 : 1;
      return b.findingCount - a.findingCount;
    });

  return {
    requested: rawTargets.length,
    rejected: (rejected ?? []).map((r) => ({ input: r.input, reason: r.reason })),
    audited: audits.length,
    conclusive: conclusive.length,
    inconclusive: [
      ...inconclusive.map((a) => ({ url: a.url, note: a.inconclusive })),
      ...failures.map((f) => ({ url: f.url, note: f.error })),
    ],
    contactable: ranked.filter((r) => r.draft).length,
    ranked,
  };
}

/** One odd audit should cost its own draft, not the whole run. */
function safeDraft(audit, senderName) {
  try {
    return generateOutreach(audit, senderName ? { senderName } : {});
  } catch {
    return null;
  }
}
