/**
 * The campaign: one command from a raw target list to a ready-to-act queue.
 *
 * This module exists purely to protect the founder's hours, which are the scarce resource
 * the whole business is optimised around. Everything here would otherwise be manual work
 * repeated per prospect: normalising a messy list, spacing requests politely, scanning,
 * ranking by what is actually worth a conversation, writing the first message, and
 * assembling the aggregate research artifact.
 *
 * What it deliberately does NOT do is send anything. A human reads the drafts and decides.
 * That is not squeamishness — it is the control that keeps a false finding from going out
 * under your name, and one false finding costs more than ten missed prospects.
 */

import { normalizeTargets, dedupe, prioritize, buildScanPlan } from '@evidence/shared/discover';
import { scanConsent } from './consent.js';
import { renderReport } from './report.js';
import { generateOutreach } from './outreach.js';
import { buildIndex, renderIndexHtml } from './indexreport.js';
import { scoreScan, REVIEW } from './confidence.js';

/**
 * Run a full prospecting campaign.
 *
 * @param {string[]} rawTargets     domains or URLs, any shape
 * @param {object} opts
 * @param {number} opts.concurrency  parallel scans; keep low, these are other people's sites
 * @param {number} opts.settleMs     per-pass settle window
 * @param {string} opts.sector       label for the aggregate index
 * @param {string} opts.senderName   signature on generated drafts
 * @param {function} opts.onScan     progress callback
 */
export async function runCampaign(rawTargets, opts = {}) {
  const {
    concurrency = 3,
    settleMs,
    sector = 'unspecified sector',
    period = new Date().toISOString().slice(0, 7),
    senderName = null,
    onScan = null,
  } = opts;

  // normalizeTargets separates what it could parse from what it rejected. Rejections are
  // surfaced rather than dropped, because a silently vanished target looks identical to a
  // target that was scanned and found clean.
  const { targets: parsed, rejected } = normalizeTargets(rawTargets);
  const prioritized = prioritize(dedupe(parsed), opts.signals ? { signals: opts.signals } : {});

  // The plan spaces same-domain work apart and caps daily volume. Honouring it is part of
  // this business's legal posture, not an optimisation — the defence for scanning from
  // outside is that it behaves like an ordinary visitor.
  const plan = buildScanPlan(prioritized, {
    maxConcurrent: concurrency,
    ...(opts.planSettings ?? {}),
  });

  const queue = planTargets(plan, prioritized);
  const scans = [];
  const failures = [];
  let cursor = 0;

  await Promise.all(
    Array.from({ length: Math.min(concurrency, queue.length) }, async () => {
      while (cursor < queue.length) {
        const target = queue[cursor++];
        const url = target.url ?? target;
        try {
          const scan = await scanConsent(url, settleMs ? { settleMs } : {});
          scans.push(scan);
          if (onScan) onScan(scan, null);
        } catch (err) {
          // Record the failure in the returned result too. Reporting it only through the
          // optional callback means a crashed scan vanishes from the run entirely, and a
          // target that silently disappears looks identical to one scanned and found clean.
          failures.push({ url, error: String(err.message || err) });
          if (onScan) onScan(null, { url, error: String(err.message || err) });
        }
      }
    })
  );

  // Only scans that actually captured can support a claim. Everything downstream — the
  // ranking, the drafts, the published index — reads from this filtered set, because an
  // empty result and a clean result look identical and mean opposite things.
  const usable = scans.filter((s) => s.capture?.usable !== false);
  const unusable = scans.filter((s) => s.capture?.usable === false);

  const ranked = usable
    .map((scan) => ({
      scan,
      url: scan.url,
      riskScore: scan.riskScore,
      findingIds: scan.findings.map((f) => f.id),
      // How much of the operator's attention this one actually deserves. The point is not
      // to skip review — it is to spend the review budget on the few drafts where a human
      // look changes the outcome, rather than spreading it evenly over twenty that do not.
      confidence: scoreScan(scan),
      report: renderReport(scan),
      // A clean site yields no draft. There is genuinely nothing to say, and manufacturing
      // a reason to make contact is how this becomes spam.
      draft: safeDraft(scan, senderName),
    }))
    // Actionable items first, most sendable among them at the top; sites with nothing to
    // say sink to the bottom. A clean site scores maximum confidence, which would otherwise
    // float it above every draft the operator actually has work to do on.
    .sort((a, b) => {
      if (Boolean(a.draft) !== Boolean(b.draft)) return a.draft ? -1 : 1;
      return b.confidence.confidence - a.confidence.confidence || b.riskScore - a.riskScore;
    });

  const index = usable.length ? buildIndex(usable, { sector, period }) : null;

  return {
    requested: rawTargets.length,
    rejected: (rejected ?? []).map((r) => ({ input: r.input, reason: r.reason })),
    scanned: scans.length,
    usable: usable.length,
    unusable: [
      ...unusable.map((s) => ({ url: s.url, note: s.capture?.note ?? 'capture failed' })),
      ...failures.map((f) => ({ url: f.url, note: f.error })),
    ],
    contactable: ranked.filter((r) => r.draft).length,
    needsReview: ranked.filter((r) => r.draft && r.confidence.review !== REVIEW.ROUTINE).length,
    ranked,
    index,
    indexHtml: index ? renderIndexHtml(index) : null,
  };
}

/**
 * Draft generation must never take the campaign down. A generator that throws on one odd
 * scan should cost that one draft, not the whole run.
 */
function safeDraft(scan, senderName) {
  try {
    return generateOutreach(scan, senderName ? { senderName } : {});
  } catch {
    return null;
  }
}

/**
 * Flatten a scan plan into an ordered list of targets.
 *
 * The plan's shape has varied across revisions, so this accepts the common forms rather
 * than coupling the campaign to one of them, and falls back to the prioritised list if the
 * plan cannot be interpreted. Losing politeness ordering is bad; losing the whole run
 * because a shape changed is worse.
 */
function planTargets(plan, fallback) {
  if (Array.isArray(plan?.items) && plan.items.length) return plan.items;
  if (Array.isArray(plan?.days) && plan.days.length) {
    return plan.days.flatMap((d) => d.items ?? d.targets ?? []);
  }
  if (Array.isArray(plan) && plan.length) return plan;
  return fallback;
}
