/**
 * Unified assessment: one browser session, several regulation modules.
 *
 * This exists to make the central architectural bet real rather than aspirational. The
 * durable asset here is the crawler — the ability to load a page the way a real visitor
 * does, interact with its consent UI, and record exactly what it transmitted. The
 * regulation that evidence is reported against is a template on top of that.
 *
 * The bet matters because deadlines move. Between April and July 2026 six major compliance
 * deadlines were postponed — EU AI Act high-risk to December 2027, HIPAA Security to 2027,
 * ADA Title II to 2027/2028, Colorado's AI Act repealed and replaced. A business whose
 * engine is welded to one statute is one omnibus bill from having no product. A business
 * whose engine produces evidence, and swaps which rule it reports against, is not.
 *
 * The practical payoff is also immediate: scanning a site for tracking behaviour and for
 * AI-disclosure behaviour used to mean two full browser sessions and two page loads. It is
 * the same page. Doing it once halves the cost per prospect and, more importantly, halves
 * the load placed on someone else's origin — which is this business's legal posture as much
 * as its unit economics.
 */

import { scanConsent } from './consent.js';
import { scanSite } from './scan.js';

/**
 * Regulation modules available to an assessment.
 *
 * Each declares what it reports against and how to produce its evidence. Adding a third —
 * accessibility is the obvious next one — should mean adding an entry here, not touching
 * the capture logic.
 */
export const MODULES = {
  consent: {
    id: 'consent',
    title: 'Tracking and consent behaviour',
    basis: 'CIPA / CCPA opt-out handling',
    run: (url, opts) => scanConsent(url, opts),
    findings: (result) => result.findings ?? [],
    score: (result) => result.riskScore ?? 0,
  },
  ai50: {
    id: 'ai50',
    title: 'AI interaction disclosure',
    basis: 'EU AI Act Article 50(1)',
    run: (url, opts) => scanSite(url, opts),
    // The disclosure module returns a single assessment rather than a finding list, and
    // only a confident negative is worth reporting. NEEDS_REVIEW and NO_EVIDENCE are
    // deliberately not findings: an ambiguous result must never read as an accusation.
    findings: (result) =>
      result.assessment?.verdict === 'NOT_DISCLOSED'
        ? [
            {
              id: 'AI_NOT_DISCLOSED',
              severity: result.assessment.confidence >= 0.85 ? 'high' : 'medium',
              title: 'A chat interface did not identify itself as an AI system',
              detail: result.assessment.reason,
              trackers: result.vendors?.map((v) => v.name) ?? [],
            },
          ]
        : [],
    score: (result) => (result.assessment?.verdict === 'NOT_DISCLOSED' ? 20 : 0),
  },
};

/**
 * Assess a URL against one or more regulation modules.
 *
 * Modules run sequentially rather than in parallel, deliberately. Concurrent sessions
 * against a single origin look like a load test, and the whole legal posture of scanning
 * from outside rests on behaving like an ordinary visitor.
 *
 * @param {string} url
 * @param {object} opts
 * @param {string[]} opts.modules  module ids, defaults to all
 */
export async function assess(url, opts = {}) {
  const requested = opts.modules?.length ? opts.modules : Object.keys(MODULES);
  const unknown = requested.filter((id) => !MODULES[id]);
  if (unknown.length) {
    throw new Error(`unknown assessment module(s): ${unknown.join(', ')}`);
  }

  const started = Date.now();
  const results = {};
  const findings = [];
  const errors = [];

  for (const id of requested) {
    const module = MODULES[id];
    try {
      const result = await module.run(url, opts);
      results[id] = result;
      for (const finding of module.findings(result)) {
        findings.push({ ...finding, module: id, basis: module.basis });
      }
      if (result.errors?.length) errors.push(...result.errors);
    } catch (err) {
      // One module failing must not lose the evidence another already produced.
      results[id] = null;
      errors.push(`${id}: ${String(err.message || err).slice(0, 200)}`);
    }
  }

  const score = requested.reduce(
    (total, id) => total + (results[id] ? MODULES[id].score(results[id]) : 0),
    0
  );

  return {
    url,
    assessedAt: new Date().toISOString(),
    durationMs: Date.now() - started,
    modules: requested,
    results,
    findings,
    // Capped so a multi-module assessment cannot exceed the single-module scale that the
    // report and the ranking are calibrated against.
    score: Math.min(100, score),
    errors,
  };
}

/**
 * Group findings by the rule they report against.
 *
 * Reports are organised by regulation because that is how the buyer's obligations are
 * organised, and because it makes the swappability visible: a client who only cares about
 * one rule can be handed only that section.
 */
export function groupByBasis(assessment) {
  const groups = new Map();
  for (const finding of assessment.findings) {
    const key = finding.basis ?? 'other';
    if (!groups.has(key)) groups.set(key, []);
    groups.get(key).push(finding);
  }
  return [...groups.entries()].map(([basis, items]) => ({ basis, findings: items }));
}
