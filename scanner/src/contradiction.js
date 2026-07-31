/**
 * Compares what a company's AI agent said against what the company published.
 *
 * This is the module that decides whether an accusation goes out, so it is written to stay
 * silent whenever there is any doubt at all. The asymmetry is even sharper here than in the
 * tracking work: a wrong tracking finding is an embarrassing error, but telling a general
 * counsel their AI agent invented a policy — when it did not — is an accusation about the
 * company's most publicly visible system, made to the person whose job is to evaluate
 * accusations.
 *
 * Three defences, in order of importance:
 *
 *   1. NUMBERS ONLY. A contradiction is reported only when the agent stated a value of the
 *      same kind as the published claim and the two differ. Semantic disagreement between
 *      two pieces of prose is never reported, because it is arguable, and an arguable finding
 *      is worse than none.
 *
 *   2. REPRODUCTION. Language models are non-deterministic. A single divergent answer proves
 *      almost nothing, so a contradiction must recur across independent sessions before it is
 *      reported at all. What does not reproduce is recorded as instability — which is itself
 *      a real and separately interesting finding, since an agent that answers the same
 *      question differently each time cannot be relied on either.
 *
 *   3. HEDGE DETECTION. An agent that says "typically around 30 days, but please check with
 *      support" has not asserted a policy. Hedged answers are excluded from contradiction,
 *      because holding a company to a qualified statement is the kind of overreach that gets
 *      the whole report dismissed.
 */

const DURATION_UNITS = {
  day: 1, days: 1,
  week: 7, weeks: 7,
  month: 30, months: 30,
  year: 365, years: 365,
};

/** Language that marks an answer as qualified rather than asserted. */
const HEDGES = [
  /\b(?:typically|usually|generally|normally|in most cases|as a rule)\b/i,
  /\b(?:may|might|could|should)\s+(?:be|vary|differ|take)\b/i,
  /\bplease\s+(?:check|contact|confirm|refer|see|visit)\b/i,
  /\b(?:approximately|around|about|roughly|up to)\b/i,
  /\bdepend(?:s|ing)?\s+on\b/i,
  /\bI(?:'m| am)\s+not\s+(?:sure|certain)\b/i,
  /\bvar(?:y|ies)\b/i,
];

/** Language that marks the agent as declining to answer, which is not a contradiction. */
const REFUSALS = [
  /\bI(?:'m| am)\s+(?:sorry|afraid)\b/i,
  /\bI\s+(?:can(?:'t|not)|don't|do not)\s+(?:help|assist|answer|provide|find)\b/i,
  /\bcontact\s+(?:our\s+)?(?:customer\s+)?(?:support|service|team)\b/i,
  /\bI\s+don'?t\s+have\s+(?:that|this|the)\s+information\b/i,
];

/** Pull values of each kind out of an agent's reply. */
export function extractValues(text) {
  const clean = String(text ?? '').replace(/\s+/g, ' ');
  const values = { duration: [], money: [], percentage: [] };

  for (const m of clean.matchAll(/\b(\d{1,3})[\s-]?(day|days|week|weeks|month|months|year|years)\b/gi)) {
    values.duration.push({
      value: Number(m[1]),
      unit: m[2].toLowerCase(),
      normalizedValue: Number(m[1]) * DURATION_UNITS[m[2].toLowerCase()],
      display: `${m[1]} ${m[2].toLowerCase()}`,
    });
  }
  for (const m of clean.matchAll(/\$\s?(\d{1,5}(?:\.\d{2})?)/g)) {
    values.money.push({
      value: Number(m[1]),
      unit: 'USD',
      normalizedValue: Number(m[1]),
      display: `$${m[1]}`,
    });
  }
  for (const m of clean.matchAll(/\b(\d{1,3})\s?%/g)) {
    values.percentage.push({
      value: Number(m[1]),
      unit: '%',
      normalizedValue: Number(m[1]),
      display: `${m[1]}%`,
    });
  }
  return values;
}

export const isHedged = (text) => HEDGES.some((re) => re.test(String(text ?? '')));
export const isRefusal = (text) => REFUSALS.some((re) => re.test(String(text ?? '')));

/** Split a reply into sentences, so hedging can be judged where it actually applies. */
export function sentences(text) {
  return String(text ?? '')
    .split(/(?<=[.!?])\s+/)
    .map((s) => s.trim())
    .filter(Boolean);
}

/**
 * Values the agent actually asserted, ignoring any it qualified.
 *
 * Hedging is judged per sentence rather than per reply. Judging the whole reply is too
 * blunt in both directions: "You can return within 30 days. Delivery usually takes 5 days."
 * would have the returns answer suppressed by a hedge attached to an unrelated aside, and a
 * single qualifier anywhere would mask a firmly asserted contradiction elsewhere.
 */
export function assertedValues(text) {
  const asserted = { duration: [], money: [], percentage: [] };
  for (const sentence of sentences(text)) {
    if (isHedged(sentence)) continue;
    const values = extractValues(sentence);
    for (const kind of Object.keys(asserted)) asserted[kind].push(...values[kind]);
  }
  return asserted;
}

/**
 * Compare one agent reply against the claims for its policy area.
 *
 * @returns {{status, matched, conflicting, reason}}
 *   status: 'agrees' | 'contradicts' | 'hedged' | 'declined' | 'no-value'
 */
export function compareReply(reply, claims) {
  const text = String(reply ?? '');

  if (isRefusal(text)) {
    return { status: 'declined', matched: [], conflicting: [], reason: 'The agent declined to answer.' };
  }

  // Only values the agent asserted outright. A qualified answer is not a policy assertion,
  // so it cannot contradict one.
  const stated = assertedValues(text);
  const assertedAnything = Object.values(stated).some((v) => v.length > 0);

  if (!assertedAnything && isHedged(text)) {
    return { status: 'hedged', matched: [], conflicting: [], reason: 'The agent qualified its answer.' };
  }
  const matched = [];
  const conflicting = [];

  for (const claim of claims) {
    const candidates = stated[claim.kind] ?? [];
    if (!candidates.length) continue;

    if (candidates.some((v) => v.normalizedValue === claim.normalizedValue)) {
      matched.push({ claim, agentSaid: claim.display });
      continue;
    }
    // Every value the agent gave for this kind differs from the published one.
    conflicting.push({
      claim,
      agentSaid: candidates.map((v) => v.display).join(', '),
      agentValues: candidates,
    });
  }

  if (!matched.length && !conflicting.length) {
    return { status: 'no-value', matched: [], conflicting: [], reason: 'The agent stated no comparable value.' };
  }
  // Agreement anywhere is treated as agreement overall. An agent that gives the right answer
  // alongside extra numbers (an unrelated fee, a delivery estimate) is not contradicting
  // anything, and reporting it would be a false positive of exactly the kind that ends this
  // business.
  if (matched.length) {
    return { status: 'agrees', matched, conflicting: [], reason: 'The agent restated the published value.' };
  }
  return {
    status: 'contradicts',
    matched: [],
    conflicting,
    reason: 'The agent stated a value that differs from the published policy.',
  };
}

/**
 * Decide what, if anything, to report after several independent runs of the same question.
 *
 * @param {Array} replies   one reply per independent session
 * @param {Array} claims    published claims for this policy area
 * @param {object} opts
 * @param {number} opts.minReproductions  how many runs must contradict before reporting
 */
export function assessProbe(replies, claims, { minReproductions = 2 } = {}) {
  const comparisons = replies.map((reply) => ({ reply, ...compareReply(reply, claims) }));
  const contradicting = comparisons.filter((c) => c.status === 'contradicts');

  // Distinct answers to the same question across sessions. Worth surfacing even when nothing
  // contradicts: an agent that answers differently every time cannot be relied on, and that
  // is a finding the company can act on without anyone arguing about which answer was right.
  const distinctValues = new Set(
    comparisons.flatMap((c) => [
      ...c.conflicting.map((x) => x.agentSaid),
      ...c.matched.map((x) => x.agentSaid),
    ])
  );
  const unstable = distinctValues.size > 1;

  if (contradicting.length < minReproductions) {
    return {
      finding: null,
      unstable,
      distinctAnswers: [...distinctValues],
      runs: comparisons.length,
      contradictedIn: contradicting.length,
      note:
        contradicting.length === 0
          ? 'No contradiction observed.'
          : `A contradiction appeared in ${contradicting.length} of ${comparisons.length} runs, ` +
            'below the threshold for reporting. Recorded as instability rather than a finding.',
    };
  }

  const example = contradicting[0];
  const conflict = example.conflicting[0];

  return {
    finding: {
      id: 'AGENT_CONTRADICTS_POLICY',
      severity: 'high',
      area: conflict.claim.area,
      title: `The agent stated a ${conflict.claim.area} value that differs from the published policy`,
      agentSaid: conflict.agentSaid,
      policySays: conflict.claim.display,
      policySource: conflict.claim.sourceUrl,
      policyExcerpt: conflict.claim.sourceText,
      transcript: example.reply,
      reproducedIn: `${contradicting.length} of ${comparisons.length} independent sessions`,
      detail:
        `Asked about ${conflict.claim.area}, the agent stated ${conflict.agentSaid}. ` +
        `The published policy states ${conflict.claim.display}. ` +
        `This was reproduced in ${contradicting.length} of ${comparisons.length} independent ` +
        'sessions. Both the agent response and the policy text are quoted below so the ' +
        'comparison can be checked directly.',
    },
    unstable,
    distinctAnswers: [...distinctValues],
    runs: comparisons.length,
    contradictedIn: contradicting.length,
    note: null,
  };
}
