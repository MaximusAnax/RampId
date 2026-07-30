/**
 * The monitoring loop: scan, persist, compare against last time, and report what moved.
 *
 * This is the part of the system that makes the business a business rather than a
 * consulting engagement. A one-time audit is worth one fee and is stale within about three
 * months, because every marketing tag added after the audit re-breaks the configuration.
 * Monitoring turns that same drift — which is a liability for the client — into the reason
 * the relationship renews.
 *
 * The operational rule that matters most here is negative: never report drift derived from
 * a failed scan. A network timeout captures no trackers, which looks identical to a client
 * having fixed everything overnight. Sending "great news, all findings resolved" off the
 * back of a DNS failure would be worse than sending nothing at all, so capture problems
 * short-circuit the comparison entirely.
 */

import { scanConsent } from './consent.js';
import { createStore } from './store.js';
import { diffScans, summarizeDrift, findCaptureProblems, DRIFT_STATUS } from './diff.js';

/**
 * How far back to look for the last scan that actually captured.
 *
 * Bounded rather than unlimited: comparing against evidence months old would narrate drift
 * that happened long before the current window and attribute it to this cycle.
 */
const HISTORY_WALKBACK = 12;

/**
 * Run one monitoring cycle for a single target.
 *
 * @param {string} url
 * @param {object} opts
 * @param {string} opts.dataRoot   where scan history lives
 * @param {number} opts.settleMs   per-pass settle window
 * @param {number} opts.keepHistory  how many scans to retain per target
 * @returns {Promise<{url, scan, previous, diff, alert, skipped, reason}>}
 */
export async function monitorTarget(url, opts = {}) {
  const { dataRoot, settleMs, keepHistory = 24 } = opts;
  const store = createStore(dataRoot);

  // Compare against the last scan that actually captured, not merely the last one stored.
  //
  // Taking the immediately previous record means comparing against a failed or blocked scan
  // whenever one occurred, which yields "not comparable" — and the next cycle compares
  // against that failure too. Every change across the outage is permanently erased and
  // reported as unchanged, so the drift the client pays for disappears with nothing looking
  // wrong.
  //
  // Records wrap the scan alongside their own metadata, so each has to be unwrapped before
  // comparison; passing a record straight to diffScans yields "not comparable" every cycle.
  const history = await store.getHistory(url, { limit: HISTORY_WALKBACK });
  const previous =
    (history ?? [])
      .map((record) => record?.scan ?? record)
      .find((candidate) => candidate && candidate.capture?.usable !== false) ?? null;
  const scan = await scanConsent(url, settleMs ? { settleMs } : {});

  // Persist regardless of outcome. A failed scan is itself a fact worth keeping: a target
  // that starts refusing automated loads is information about the target, and silently
  // dropping those records would make the history lie about coverage.
  await store.saveScan(url, scan);
  await store.pruneHistory(url, keepHistory);

  // findCaptureProblems takes one scan plus a label. Only the current scan is checked here:
  // a previous scan that failed is already handled by diffScans returning NOT_COMPARABLE.
  const problems = findCaptureProblems(scan, 'current scan');
  if (problems.length) {
    return {
      url,
      scan,
      previous,
      diff: null,
      alert: null,
      skipped: true,
      reason: problems.join('; '),
    };
  }

  const diff = diffScans(previous, scan);

  // summarizeDrift returns { subject, body }. It is generated for every comparable diff,
  // including first scans, because "monitoring established a baseline" is a legitimate
  // thing to tell a client on day one.
  const alert =
    diff.status === DRIFT_STATUS.NOT_COMPARABLE ? null : summarizeDrift(diff);

  return { url, scan, previous, diff, alert, skipped: false, reason: null };
}

/**
 * Run a monitoring cycle across many targets.
 *
 * Concurrency is deliberately low and configurable. Each target costs three full page loads,
 * and a monitoring service that hammers its own clients' origins is a bad neighbour and a
 * bad legal posture at the same time.
 */
export async function monitorAll(urls, opts = {}) {
  const { concurrency = 2, onResult = null } = opts;
  const results = [];
  let cursor = 0;

  await Promise.all(
    Array.from({ length: Math.min(concurrency, urls.length) }, async () => {
      while (cursor < urls.length) {
        const index = cursor++;
        const url = urls[index];
        try {
          const result = await monitorTarget(url, opts);
          results[index] = result;
          if (onResult) onResult(result);
        } catch (err) {
          results[index] = {
            url,
            scan: null,
            previous: null,
            diff: null,
            alert: null,
            skipped: true,
            reason: `monitor failed: ${String(err.message || err)}`,
          };
          if (onResult) onResult(results[index]);
        }
      }
    })
  );

  return results;
}

/**
 * Reduce a monitoring run to the handful of items a human should actually look at.
 *
 * The value of monitoring collapses the moment it produces a digest nobody reads, so this
 * returns only regressions and capture problems — never a wall of unchanged targets.
 */
export function triage(results) {
  const regressions = [];
  const improvements = [];
  const problems = [];

  for (const r of results) {
    if (r.skipped) {
      problems.push({ url: r.url, reason: r.reason });
      continue;
    }
    if (!r.diff?.hasChanges) continue;

    // riskDelta is deliberately null when no comparison was possible, so compare
    // explicitly rather than relying on > 0 silently coercing null to a falsy zero.
    const delta = typeof r.diff.riskDelta === 'number' ? r.diff.riskDelta : 0;

    // New trackers must count as a regression even when no new finding ID appears.
    //
    // The common real case is a marketing team adding one more tag to a site that already
    // has a PRE_CONSENT finding: the finding set is unchanged, the risk score is unchanged,
    // and the drift that the client pays to hear about would otherwise be filed as "quiet".
    // That single gap would hollow out the retainer while appearing to work.
    const newTrackers = r.diff.newTrackers?.length ?? 0;

    if (delta > 0 || r.diff.newFindings?.length || newTrackers > 0) {
      regressions.push({ url: r.url, alert: r.alert, riskDelta: delta });
    } else if (delta < 0 || r.diff.resolvedFindings?.length) {
      improvements.push({ url: r.url, alert: r.alert, riskDelta: delta });
    }
  }

  regressions.sort((a, b) => b.riskDelta - a.riskDelta);

  return {
    regressions,
    improvements,
    problems,
    quiet: results.length - regressions.length - improvements.length - problems.length,
  };
}
