/**
 * The AI agent audit, end to end: read the published policy, ask the agent, compare.
 *
 * The whole product in one function. It needs nothing from the company — both the policy
 * pages and the agent are public — which is the same structural property that lets the
 * tracking engine sell to enterprises without passing a vendor security review.
 */

import { launchBrowser } from '@evidence/shared/browser';
import { extractClaims, questionSet, POLICY_PATHS } from './policy.js';
import { probe, repliesByArea } from './agentprobe.js';
import { assessProbe } from './contradiction.js';

/**
 * Read a company's published policy pages.
 *
 * Tries the conventional paths. A page that 404s or carries no policy language contributes
 * nothing rather than failing the run, because most sites have only two or three of these.
 */
export async function readPolicies(baseUrl, { paths = POLICY_PATHS, maxPages = 6 } = {}) {
  const proxyServer = process.env.A50_PROXY || null;
  const browser = await launchBrowser();
  const context = await browser.newContext({ ignoreHTTPSErrors: true });
  const page = await context.newPage();

  const pages = [];
  const claims = [];

  try {
    for (const p of paths) {
      if (pages.length >= maxPages) break;
      const url = new URL(p, baseUrl).toString();
      try {
        const response = await page.goto(url, { waitUntil: 'domcontentloaded', timeout: 20000 });
        if (!response || response.status() >= 400) continue;
        const text = await page.evaluate(() => document.body?.innerText?.slice(0, 40000) ?? '');
        const found = extractClaims(text, url);
        if (!found.length) continue;
        pages.push({ url, claimCount: found.length });
        claims.push(...found);
      } catch {
        // Path absent or unreachable; not an error worth surfacing.
      }
    }
  } finally {
    await browser.close().catch(() => {});
  }

  // The same fact often appears on several pages. Keep one, preferring the first source.
  const deduped = [];
  const seen = new Set();
  for (const c of claims) {
    const key = `${c.area}|${c.kind}|${c.normalizedValue}`;
    if (seen.has(key)) continue;
    seen.add(key);
    deduped.push(c);
  }

  return { pages, claims: deduped };
}

/**
 * Audit one company's agent against its own published policy.
 *
 * @param {string} baseUrl     the company's site
 * @param {object} opts
 * @param {string} opts.agentUrl  page carrying the chat widget, defaults to the site root
 * @param {number} opts.runs      independent sessions per question
 */
export async function auditAgent(baseUrl, opts = {}) {
  const { agentUrl = baseUrl, runs = 3, minReproductions = 2 } = opts;
  const startedAt = new Date().toISOString();

  const { pages, claims } = await readPolicies(baseUrl, opts);

  if (!claims.length) {
    return {
      url: baseUrl,
      startedAt,
      policyPages: pages,
      claims: [],
      findings: [],
      // Without published claims there is nothing to compare against, and inventing a
      // standard of our own is exactly what this product refuses to do.
      inconclusive: 'No checkable policy claims were found on the published pages.',
    };
  }

  const questions = questionSet(claims);
  const sessions = await probe(agentUrl, questions, { runs, ...opts });
  const opened = sessions.filter((s) => s.opened).length;

  if (!opened) {
    return {
      url: baseUrl,
      startedAt,
      policyPages: pages,
      claims,
      sessions,
      findings: [],
      inconclusive: 'No chat agent could be opened, so nothing was asked and nothing is concluded.',
    };
  }

  const byArea = repliesByArea(sessions);
  const findings = [];
  const areas = [];

  for (const q of questions) {
    const replies = byArea.get(q.area) ?? [];
    const areaClaims = claims.filter((c) => c.area === q.area);
    const assessment = assessProbe(replies, areaClaims, { minReproductions });

    areas.push({
      area: q.area,
      question: q.question,
      runs: assessment.runs,
      contradictedIn: assessment.contradictedIn,
      unstable: assessment.unstable,
      distinctAnswers: assessment.distinctAnswers,
      note: assessment.note,
    });
    if (assessment.finding) findings.push(assessment.finding);
  }

  // An agent that answers the same question differently across sessions is unreliable even
  // where no single answer contradicts the policy. Worth telling a client, and it needs no
  // argument about which answer was correct.
  const unstableAreas = areas.filter((a) => a.unstable && !findings.some((f) => f.area === a.area));
  for (const a of unstableAreas) {
    findings.push({
      id: 'AGENT_ANSWERS_INCONSISTENTLY',
      severity: 'medium',
      area: a.area,
      title: `The agent gave different ${a.area} answers across identical questions`,
      detail:
        `Asked the same ${a.area} question in ${a.runs} independent sessions, the agent gave ` +
        `these different answers: ${a.distinctAnswers.join('; ')}. No single answer ` +
        'contradicted the published policy, but the variation itself means a customer cannot ' +
        'rely on the answer they receive.',
      reproducedIn: `${a.runs} independent sessions`,
    });
  }

  return {
    url: baseUrl,
    agentUrl,
    startedAt,
    durationMs: Date.now() - Date.parse(startedAt),
    policyPages: pages,
    claims,
    areas,
    sessionsOpened: `${opened} of ${sessions.length}`,
    findings,
    inconclusive: null,
  };
}
