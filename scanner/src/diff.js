import { SEVERITY_RANK } from './trackers.js';

/**
 * Drift detection between two consent scans.
 *
 * This is the module that turns a one-off audit into a retainer. A consent configuration
 * is not a state, it is a moving target: every tag a marketing team adds through a tag
 * manager can re-break it, and nobody inside the company sees it happen. A scan from June
 * says nothing true about August. Detecting that movement and describing it in a sentence
 * a marketing director understands is the entire argument for being paid monthly rather
 * than once.
 *
 * Two rules govern everything in this file.
 *
 *   An incomplete capture must never be reported as drift. A scan that could not load the
 *   page records no trackers, and a naive comparison reads that absence as every tracker
 *   having been removed — an alert congratulating a client on a fix that never happened.
 *   That is worse than silence, because it is a false statement they will act on. Any
 *   incomplete capture on either side disqualifies the comparison outright rather than
 *   degrading it quietly.
 *
 *   Every sentence produced here states an observation, never a legal conclusion. These
 *   strings go out as alert email subject lines, which are read faster and more literally
 *   than a report, and which are the least recoverable place to have made an accusation.
 */

export const DRIFT_STATUS = {
  FIRST_SCAN: 'first-scan',
  COMPARED: 'compared',
  NOT_COMPARABLE: 'not-comparable',
};

export const MATERIALITY = {
  REGRESSION: 'regression',
  IMPROVEMENT: 'improvement',
  NEUTRAL: 'neutral',
};

const PASS_KEYS = ['baseline', 'gpc', 'afterReject'];

/**
 * How indefensible it is for a tracker to appear in a given pass. Severity still leads,
 * because severity is calibrated to litigation reality; the pass only separates trackers
 * of equal severity. The consequence is deliberate: the highest rank any change can carry
 * is a critical-severity tracker that newly survives the site's own reject button, which
 * is the single worst thing this engine can find having changed.
 */
const PASS_GRAVITY = { baseline: 1, gpc: 2, afterReject: 3 };

/** Ordering aid within one diff, not a score. Maximum is 33; see PASS_GRAVITY. */
export function regressionRank(severity, passKey) {
  return (SEVERITY_RANK[severity] ?? 1) * 10 + (PASS_GRAVITY[passKey] ?? 1);
}

const findingRank = (severity) => (SEVERITY_RANK[severity] ?? 1) * 10;

/** A consent platform disappearing matters, but it ranks below any tracker movement. */
const CMP_RANK = 15;
const REJECT_CONTROL_RANK = 18;

const MATERIALITY_ORDER = {
  [MATERIALITY.REGRESSION]: 0,
  [MATERIALITY.IMPROVEMENT]: 1,
  [MATERIALITY.NEUTRAL]: 2,
};

const hostOf = (url) => {
  try {
    return new URL(url).hostname;
  } catch {
    return String(url ?? 'the target');
  }
};

/**
 * Reasons a scan cannot be used as either side of a comparison.
 *
 * Exported because a scheduler should re-run a broken scan rather than store it as the new
 * reference point — a bad reference silently poisons every comparison after it.
 */
export function findCaptureProblems(scan, label = 'scan') {
  if (!scan || typeof scan !== 'object' || !scan.passes) {
    return [`The ${label} is missing or contains no pass data.`];
  }

  const problems = [];

  for (const key of PASS_KEYS) {
    const pass = scan.passes[key];
    if (!pass) {
      problems.push(`The ${label} has no ${key} pass.`);
      continue;
    }
    if (pass.error) {
      problems.push(`The ${label} ${key} pass ended with an error: ${pass.error}`);
      continue;
    }
    // A pass that loaded anything at all records at least the document request. Zero
    // requests therefore means the capture failed, not that the page is clean — and a
    // clean-looking failure is exactly the input that would fabricate an improvement.
    if (!(pass.requestCount > 0)) {
      problems.push(
        `The ${label} ${key} pass recorded no network requests at all, which indicates a ` +
          'failed page load rather than an absence of trackers.'
      );
    }
  }

  for (const error of scan.errors || []) {
    if (!problems.some((problem) => problem.includes(error))) {
      problems.push(`The ${label} reported an error: ${error}`);
    }
  }

  return problems;
}

const indexByName = (trackers) =>
  new Map((trackers || []).map((tracker) => [tracker.name, tracker]));

const emptyPassDiff = (passKey) => ({
  pass: passKey,
  comparable: false,
  added: [],
  removed: [],
  trackerCountDelta: 0,
  requestCountDelta: 0,
  materiality: MATERIALITY.NEUTRAL,
  note: null,
  ...(passKey === 'afterReject'
    ? { rejectClicked: { previous: null, current: null, changed: false } }
    : {}),
});

/**
 * Every returned diff carries every field, whatever the status, so a caller can read
 * `diff.newTrackers.length` without first checking which branch it got.
 */
function emptyDiff(previous, current, status) {
  return {
    status,
    url: current?.url ?? previous?.url ?? null,
    previousScannedAt: previous?.scannedAt ?? null,
    currentScannedAt: current?.scannedAt ?? null,
    hasChanges: false,
    materiality: MATERIALITY.NEUTRAL,
    // null rather than 0 wherever no comparison happened: 0 asserts "risk did not move",
    // which is a claim, and no claim is available here.
    riskDelta: null,
    riskScore: { previous: previous?.riskScore ?? null, current: current?.riskScore ?? null },
    summary: '',
    newTrackers: [],
    removedTrackers: [],
    newFindings: [],
    resolvedFindings: [],
    persistingFindings: [],
    cmpChanged: false,
    cmp: { previous: [], current: [], added: [], removed: [] },
    perPass: {
      baseline: emptyPassDiff('baseline'),
      gpc: emptyPassDiff('gpc'),
      afterReject: emptyPassDiff('afterReject'),
    },
    changes: [],
    notes: [],
    captureProblems: [],
    snapshot: null,
  };
}

function snapshotOf(scan) {
  const names = new Set();
  const trackerCounts = {};
  for (const key of PASS_KEYS) {
    const trackers = scan.passes[key]?.trackers || [];
    trackerCounts[key] = trackers.length;
    for (const tracker of trackers) names.add(tracker.name);
  }
  return {
    riskScore: scan.riskScore ?? null,
    cmp: [...(scan.cmp || [])],
    findingIds: (scan.findings || []).map((finding) => finding.id),
    trackerCounts,
    trackerNames: [...names],
    rejectClicked: Boolean(scan.passes.afterReject?.rejectClicked),
  };
}

/**
 * Compare two scanConsent results.
 *
 * @param {object|null} previous  the last stored scan, or null/undefined if none exists
 * @param {object} current        the scan just completed
 */
export function diffScans(previous, current) {
  const currentProblems = findCaptureProblems(current, 'current scan');
  if (currentProblems.length) return notComparable(previous, current, currentProblems);

  if (previous === null || previous === undefined) return firstScan(current);

  const previousProblems = findCaptureProblems(previous, 'previous scan');
  if (previousProblems.length) return notComparable(previous, current, previousProblems);

  if (hostOf(previous.url) !== hostOf(current.url)) {
    return notComparable(previous, current, [
      `The two scans are of different hosts (${hostOf(previous.url)} and ` +
        `${hostOf(current.url)}), so any difference between them is meaningless.`,
    ]);
  }

  return compare(previous, current);
}

function notComparable(previous, current, problems) {
  const diff = emptyDiff(previous, current, DRIFT_STATUS.NOT_COMPARABLE);
  diff.captureProblems = problems;
  diff.notes.push(
    'No drift is reported from this pair of scans. An incomplete capture records fewer ' +
      'trackers than the page actually loads, so comparing it would manufacture an ' +
      'improvement that did not happen.'
  );
  diff.summary = summarizeDrift(diff).subject;
  return diff;
}

function firstScan(current) {
  const diff = emptyDiff(null, current, DRIFT_STATUS.FIRST_SCAN);
  diff.cmp = { previous: [], current: [...(current.cmp || [])], added: [], removed: [] };
  diff.snapshot = snapshotOf(current);
  // Deliberately not populating newTrackers: on a first scan nothing has appeared, it has
  // merely been seen for the first time. Reporting it as new would make the opening alert
  // read as a sudden regression the client caused.
  diff.notes.push(
    'No earlier scan was available, so nothing in this scan is a change. It is the ' +
      'reference point the next scan will be compared against.'
  );
  diff.summary = summarizeDrift(diff).subject;
  return diff;
}

function compare(previous, current) {
  const diff = emptyDiff(previous, current, DRIFT_STATUS.COMPARED);
  diff.snapshot = snapshotOf(current);

  if (previous.url !== current.url) {
    diff.notes.push(
      `The scanned URL changed from ${previous.url} to ${current.url}. The host is the ` +
        'same, but a different path can legitimately load a different set of tags.'
    );
  }

  for (const key of PASS_KEYS) {
    diff.perPass[key] = diffPass(key, previous.passes[key], current.passes[key]);
    if (diff.perPass[key].note) diff.notes.push(diff.perPass[key].note);
  }

  diff.changes.push(...trackerChanges(diff.perPass));
  Object.assign(diff, findingDiff(previous.findings || [], current.findings || []));
  diff.changes.push(...findingChanges(diff));

  const cmpResult = cmpDiff(previous.cmp || [], current.cmp || []);
  diff.cmp = cmpResult.cmp;
  diff.cmpChanged = cmpResult.changed;
  if (cmpResult.change) diff.changes.push(cmpResult.change);

  const rejectChange = rejectControlChange(diff.perPass.afterReject);
  if (rejectChange) diff.changes.push(rejectChange);

  Object.assign(diff, scanWideTrackerSets(previous, current, diff.perPass));

  diff.riskDelta = (current.riskScore ?? 0) - (previous.riskScore ?? 0);
  diff.changes.sort(
    (a, b) =>
      MATERIALITY_ORDER[a.materiality] - MATERIALITY_ORDER[b.materiality] || b.rank - a.rank
  );

  diff.hasChanges = diff.changes.length > 0 || diff.riskDelta !== 0;
  diff.materiality = diff.changes.some((c) => c.materiality === MATERIALITY.REGRESSION)
    ? MATERIALITY.REGRESSION
    : diff.changes.some((c) => c.materiality === MATERIALITY.IMPROVEMENT)
      ? MATERIALITY.IMPROVEMENT
      : MATERIALITY.NEUTRAL;

  diff.summary = summarizeDrift(diff).subject;
  return diff;
}

function diffPass(passKey, before, after) {
  const result = emptyPassDiff(passKey);
  result.comparable = true;

  if (passKey === 'afterReject') {
    const previousClicked = Boolean(before.rejectClicked);
    const currentClicked = Boolean(after.rejectClicked);
    result.rejectClicked = {
      previous: previousClicked,
      current: currentClicked,
      changed: previousClicked !== currentClicked,
    };

    // When the reject control could be clicked in one scan and not the other, this pass
    // measured two different things: post-click traffic versus the whole page load. Tracker
    // differences then describe the measurement, not the site, so they are recorded as
    // observations and explicitly not classified as better or worse.
    if (result.rejectClicked.changed) {
      result.comparable = false;
      result.note = currentClicked
        ? 'A reject control was found and clicked in this check but not in the previous ' +
          'one, so the post-reject pass now records only what followed the click. ' +
          'Differences in that pass reflect what could be measured, not necessarily a ' +
          'change on the site.'
        : 'No reject control could be found in this check, so the post-reject pass records ' +
          'the whole page load rather than only what followed a click. Differences in that ' +
          'pass reflect what could be measured, not necessarily a change on the site.';
    }
  }

  const beforeTrackers = indexByName(before.trackers);
  const afterTrackers = indexByName(after.trackers);

  result.added = [...afterTrackers.values()]
    .filter((tracker) => !beforeTrackers.has(tracker.name))
    .map((tracker) => classifiedTracker(tracker, passKey, MATERIALITY.REGRESSION, result.comparable));

  result.removed = [...beforeTrackers.values()]
    .filter((tracker) => !afterTrackers.has(tracker.name))
    .map((tracker) => classifiedTracker(tracker, passKey, MATERIALITY.IMPROVEMENT, result.comparable));

  result.trackerCountDelta = (after.trackerCount ?? 0) - (before.trackerCount ?? 0);
  result.requestCountDelta = (after.requestCount ?? 0) - (before.requestCount ?? 0);
  result.materiality = worstMateriality([...result.added, ...result.removed]);

  return result;
}

function classifiedTracker(tracker, passKey, materiality, comparable) {
  return {
    name: tracker.name,
    category: tracker.category,
    severity: tracker.severity,
    evidence: tracker.evidence,
    sample: tracker.sample ?? null,
    pass: passKey,
    materiality: comparable ? materiality : MATERIALITY.NEUTRAL,
    rank: comparable ? regressionRank(tracker.severity, passKey) : 0,
  };
}

const worstMateriality = (items) =>
  items.reduce(
    (worst, item) =>
      MATERIALITY_ORDER[item.materiality] < MATERIALITY_ORDER[worst] ? item.materiality : worst,
    MATERIALITY.NEUTRAL
  );

function trackerChanges(perPass) {
  const changes = [];
  for (const key of PASS_KEYS) {
    for (const tracker of perPass[key].added) {
      changes.push({
        kind: 'tracker-added',
        pass: key,
        name: tracker.name,
        category: tracker.category,
        severity: tracker.severity,
        materiality: tracker.materiality,
        rank: tracker.rank,
        description:
          `${tracker.name} was observed in the ${PASS_LABEL[key]} pass and was not ` +
          'observed there at the previous check.',
      });
    }
    for (const tracker of perPass[key].removed) {
      changes.push({
        kind: 'tracker-removed',
        pass: key,
        name: tracker.name,
        category: tracker.category,
        severity: tracker.severity,
        materiality: tracker.materiality,
        rank: tracker.rank,
        description:
          `${tracker.name} was observed in the ${PASS_LABEL[key]} pass at the previous ` +
          'check and was not observed there in this one.',
      });
    }
  }
  return changes;
}

function findingDiff(previousFindings, currentFindings) {
  const before = new Map(previousFindings.map((finding) => [finding.id, finding]));
  const after = new Map(currentFindings.map((finding) => [finding.id, finding]));

  const newFindings = [...after.values()]
    .filter((finding) => !before.has(finding.id))
    .map((finding) => ({
      ...finding,
      materiality: MATERIALITY.REGRESSION,
      rank: findingRank(finding.severity),
    }));

  const resolvedFindings = [...before.values()]
    .filter((finding) => !after.has(finding.id))
    .map((finding) => ({
      ...finding,
      materiality: MATERIALITY.IMPROVEMENT,
      rank: findingRank(finding.severity),
    }));

  const persistingFindings = [...after.values()]
    .filter((finding) => before.has(finding.id))
    .map((finding) => {
      const was = before.get(finding.id);
      const severityChanged = was.severity !== finding.severity;
      const severityWorse =
        (SEVERITY_RANK[finding.severity] ?? 1) > (SEVERITY_RANK[was.severity] ?? 1);
      const trackersAdded = (finding.trackers || []).filter(
        (name) => !(was.trackers || []).includes(name)
      );
      const trackersRemoved = (was.trackers || []).filter(
        (name) => !(finding.trackers || []).includes(name)
      );

      // A finding that gained trackers and lost others resolves to regression: the worse
      // half of a mixed change is the half the client has to act on.
      const materiality = severityChanged
        ? severityWorse
          ? MATERIALITY.REGRESSION
          : MATERIALITY.IMPROVEMENT
        : trackersAdded.length
          ? MATERIALITY.REGRESSION
          : trackersRemoved.length
            ? MATERIALITY.IMPROVEMENT
            : MATERIALITY.NEUTRAL;

      return {
        id: finding.id,
        title: finding.title,
        severity: finding.severity,
        previousSeverity: was.severity,
        severityChanged,
        trackersAdded,
        trackersRemoved,
        materiality,
        rank: findingRank(finding.severity),
      };
    });

  return { newFindings, resolvedFindings, persistingFindings };
}

function findingChanges(diff) {
  const changes = [];

  for (const finding of diff.newFindings) {
    changes.push({
      kind: 'finding-appeared',
      id: finding.id,
      severity: finding.severity,
      materiality: MATERIALITY.REGRESSION,
      rank: finding.rank,
      description: `A new observation was recorded: ${finding.title}`,
    });
  }

  for (const finding of diff.resolvedFindings) {
    changes.push({
      kind: 'finding-resolved',
      id: finding.id,
      severity: finding.severity,
      materiality: MATERIALITY.IMPROVEMENT,
      rank: finding.rank,
      description: `An observation from the previous check is no longer present: ${finding.title}`,
    });
  }

  for (const finding of diff.persistingFindings) {
    if (finding.materiality === MATERIALITY.NEUTRAL) continue;
    changes.push({
      kind: 'finding-changed',
      id: finding.id,
      severity: finding.severity,
      materiality: finding.materiality,
      rank: finding.rank,
      description: finding.severityChanged
        ? `The severity recorded for ${finding.id} moved from ${finding.previousSeverity} ` +
          `to ${finding.severity}.`
        : `The services listed under ${finding.id} changed.`,
    });
  }

  return changes;
}

function cmpDiff(previousCmp, currentCmp) {
  const before = [...new Set(previousCmp)];
  const after = [...new Set(currentCmp)];
  const added = after.filter((name) => !before.includes(name));
  const removed = before.filter((name) => !after.includes(name));
  const cmp = { previous: before, current: after, added, removed };

  if (!added.length && !removed.length) return { cmp, changed: false, change: null };

  // Losing the consent platform entirely is a regression; gaining one is an improvement.
  // Swapping one vendor for another is a migration — genuinely neither, and the rule that
  // ambiguity resolves to neutral rather than to an accusation applies here too.
  const materiality =
    after.length === 0 && before.length > 0
      ? MATERIALITY.REGRESSION
      : before.length === 0 && after.length > 0
        ? MATERIALITY.IMPROVEMENT
        : MATERIALITY.NEUTRAL;

  return {
    cmp,
    changed: true,
    change: {
      kind: 'consent-platform-changed',
      materiality,
      rank: CMP_RANK,
      added,
      removed,
      description: `Detected consent platform changed from ${before.join(', ') || 'none'} to ${
        after.join(', ') || 'none'
      }.`,
    },
  };
}

function rejectControlChange(afterRejectDiff) {
  if (!afterRejectDiff.rejectClicked?.changed) return null;
  const nowClickable = afterRejectDiff.rejectClicked.current;
  return {
    kind: nowClickable ? 'reject-control-found' : 'reject-control-lost',
    materiality: nowClickable ? MATERIALITY.IMPROVEMENT : MATERIALITY.REGRESSION,
    rank: REJECT_CONTROL_RANK,
    description: nowClickable
      ? 'A reject control was found on the consent banner in this check; none could be ' +
        'found at the previous check.'
      : 'No reject control could be found on the consent banner in this check; one was ' +
        'found and clicked at the previous check.',
  };
}

/**
 * Trackers new to the site as a whole, as distinct from new to one pass. A tracker already
 * present in baseline that now also survives the reject click is not new here — it is a
 * per-pass addition, and perPass carries that far more serious event.
 */
function scanWideTrackerSets(previous, current, perPass) {
  const before = new Map();
  const after = new Map();
  for (const key of PASS_KEYS) {
    for (const tracker of previous.passes[key]?.trackers || []) before.set(tracker.name, tracker);
    for (const tracker of current.passes[key]?.trackers || []) after.set(tracker.name, tracker);
  }

  const passesContaining = (name, side) =>
    PASS_KEYS.filter((key) =>
      (side.passes[key]?.trackers || []).some((tracker) => tracker.name === name)
    );

  const describe = (tracker, side, materiality) => {
    const passes = passesContaining(tracker.name, side);
    const relevant = passes.filter((key) =>
      materiality === MATERIALITY.REGRESSION
        ? perPass[key].added.some((t) => t.name === tracker.name)
        : perPass[key].removed.some((t) => t.name === tracker.name)
    );
    const comparablePasses = relevant.filter((key) => perPass[key].comparable);
    const worstPass = comparablePasses.reduce(
      (worst, key) => (PASS_GRAVITY[key] > PASS_GRAVITY[worst ?? 'baseline'] ? key : worst),
      comparablePasses[0] ?? null
    );
    return {
      name: tracker.name,
      category: tracker.category,
      severity: tracker.severity,
      evidence: tracker.evidence,
      sample: tracker.sample ?? null,
      passes,
      worstPass,
      materiality: worstPass ? materiality : MATERIALITY.NEUTRAL,
      rank: worstPass ? regressionRank(tracker.severity, worstPass) : 0,
    };
  };

  return {
    newTrackers: [...after.values()]
      .filter((tracker) => !before.has(tracker.name))
      .map((tracker) => describe(tracker, current, MATERIALITY.REGRESSION)),
    removedTrackers: [...before.values()]
      .filter((tracker) => !after.has(tracker.name))
      .map((tracker) => describe(tracker, previous, MATERIALITY.IMPROVEMENT)),
  };
}

/* ------------------------------------------------------------------------------------ *
 * Narrative
 *
 * The wording below is a product decision rather than a formatting detail. It is written
 * to survive being read by the client's lawyer: it says what was transmitted and when it
 * changed, and it never characterises that as exposure, violation, or risk of either.
 * ------------------------------------------------------------------------------------ */

const PASS_LABEL = {
  baseline: 'baseline',
  gpc: 'Global Privacy Control',
  afterReject: 'post-reject',
};

const PASS_PHRASE_PAST = {
  baseline: 'before any consent interaction',
  gpc: 'while the browser advertised Global Privacy Control',
  afterReject: 'after the reject control was clicked',
};

const PASS_PHRASE_PRESENT = {
  baseline: 'on page load',
  gpc: 'while the browser advertises Global Privacy Control',
  afterReject: 'after a visitor clicks reject',
};

/** Which pass each finding is a summary of, so the narrative does not say it twice. */
const FINDING_PASS = {
  PRE_CONSENT: 'baseline',
  GPC_IGNORED: 'gpc',
  REJECT_IGNORED: 'afterReject',
};

const CATEGORY_NOUN = {
  'session-replay': ['session-replay tool', 'session-replay tools'],
  'ad-pixel': ['advertising tracker', 'advertising trackers'],
  analytics: ['analytics tracker', 'analytics trackers'],
};

const FINDING_NARRATIVE = {
  PRE_CONSENT: {
    appeared: 'Tracking now occurs before any consent interaction; it was not observed at the previous check.',
    resolved: 'No tracking before a consent interaction was observed in this check.',
    subject: 'trackers now fire before any consent interaction',
  },
  GPC_IGNORED: {
    appeared: 'Trackers now continue to transmit while the browser advertises Global Privacy Control.',
    resolved: 'No trackers continued transmitting with Global Privacy Control enabled in this check.',
    subject: 'trackers now transmit with Global Privacy Control enabled',
  },
  REJECT_IGNORED: {
    appeared: 'Trackers now continue to transmit after the consent banner’s reject control is clicked.',
    resolved: 'No trackers continued transmitting after the reject control was clicked in this check.',
    subject: 'trackers now transmit after the reject control is clicked',
  },
  NO_CMP: {
    appeared: 'No consent management platform was detected on the page in this check.',
    resolved: 'A consent management platform is now detected on the page.',
    subject: 'no consent platform detected',
  },
  NO_REJECT_CONTROL: {
    appeared: 'No reject control could be found on the consent banner in this check.',
    resolved: 'A reject control was found on the consent banner in this check.',
    subject: 'no reject control found on the consent banner',
  },
};

const NUMBER_WORDS = [
  'no', 'one', 'two', 'three', 'four', 'five',
  'six', 'seven', 'eight', 'nine', 'ten',
];

const countWord = (n) => NUMBER_WORDS[n] ?? String(n);
const sentenceCase = (text) => text.charAt(0).toUpperCase() + text.slice(1);
const categoryNoun = (category, count) => {
  const [one, many] = CATEGORY_NOUN[category] || ['third-party tracker', 'third-party trackers'];
  return count === 1 ? one : many;
};

const listFormatter = new Intl.ListFormat('en-GB', { style: 'long', type: 'conjunction' });

function nameList(names) {
  if (names.length <= 4) return listFormatter.format(names);
  return listFormatter.format([...names.slice(0, 3), `${names.length - 3} others`]);
}

/** "12 June", or "12 June 2025" when the two scans fall in different years. */
function formatCheckDate(iso, referenceIso) {
  const when = new Date(iso);
  if (Number.isNaN(when.getTime())) return null;
  const reference = new Date(referenceIso);
  const sameYear =
    !Number.isNaN(reference.getTime()) && when.getUTCFullYear() === reference.getUTCFullYear();
  return new Intl.DateTimeFormat('en-GB', {
    day: 'numeric',
    month: 'long',
    timeZone: 'UTC',
    ...(sameYear ? {} : { year: 'numeric' }),
  }).format(when);
}

/**
 * Narrate a diff for an alert email.
 *
 * @returns {{subject: string, body: string}}
 */
export function summarizeDrift(diff) {
  if (!diff || typeof diff !== 'object') {
    return {
      subject: 'No comparison available',
      body: 'No diff was supplied, so there is nothing to report.',
    };
  }

  const host = hostOf(diff.url);

  if (diff.status === DRIFT_STATUS.FIRST_SCAN) return firstScanNarrative(diff, host);
  if (diff.status === DRIFT_STATUS.NOT_COMPARABLE) return notComparableNarrative(diff, host);

  const lastChecked = formatCheckDate(diff.previousScannedAt, diff.currentScannedAt);
  const sinceClause = lastChecked ? ` since the last check on ${lastChecked}` : ' since the last check';

  if (!diff.hasChanges) {
    return {
      subject: `No change in tracking on ${host}${lastChecked ? ` since ${lastChecked}` : ''}`,
      body: paragraphs([
        `The same trackers were observed in all three passes on ${host} as at the ` +
          `previous check${lastChecked ? ` on ${lastChecked}` : ''}. ` +
          consentPlatformSentence(diff) +
          ` The exposure score is unchanged at ${diff.riskScore.current ?? 0}.`,
        CLOSING_LINE,
      ]),
    };
  }

  const added = trackerNarrative(diff, 'tracker-added', MATERIALITY.REGRESSION);
  const removed = trackerNarrative(diff, 'tracker-removed', MATERIALITY.IMPROVEMENT);

  const regressionSentences = [];
  const improvementSentences = [];

  added.forEach((group, index) => {
    const count = group.names.length;
    const since = index === 0 ? sinceClause : '';

    if (count === 1) {
      regressionSentences.push(
        `${group.names[0]} began firing ${PASS_PHRASE_PAST[group.leadPass]}${since}.`
      );
    } else {
      regressionSentences.push(
        `${sentenceCase(countWord(count))} ${categoryNoun(group.category, count)} began firing ` +
          `${PASS_PHRASE_PAST[group.leadPass]}${since}.`,
        `${nameList(group.names)} now transmit ${PASS_PHRASE_PRESENT[group.leadPass]}.`
      );
    }

    // Naming the gravest pass separately matters: a tag that fires on load is a
    // configuration slip, and the same tag still firing after the visitor declines is a
    // different statement about the same tag.
    if (group.worstPass !== group.leadPass) {
      regressionSentences.push(
        `${count === 1 ? 'It also transmits' : 'They also transmit'} ` +
          `${PASS_PHRASE_PRESENT[group.worstPass]}.`
      );
    }
  });

  removed.forEach((group) => {
    const count = group.names.length;
    if (count === 1) {
      improvementSentences.push(
        `${group.names[0]} no longer transmits ${PASS_PHRASE_PRESENT[group.leadPass]}.`
      );
    } else {
      improvementSentences.push(
        `${sentenceCase(countWord(count))} ${categoryNoun(group.category, count)} are no longer ` +
          `observed ${PASS_PHRASE_PAST[group.leadPass]}.`,
        `${nameList(group.names)} no longer transmit ${PASS_PHRASE_PRESENT[group.leadPass]}.`
      );
    }
  });

  for (const finding of [...diff.newFindings].sort((a, b) => b.rank - a.rank)) {
    // Skip the finding-level sentence when the tracker sentences above already described
    // that pass. Repeating the same fact in general terms makes an alert read as padding.
    const covered = added.some((group) => group.passes.includes(FINDING_PASS[finding.id]));
    if (covered) continue;
    regressionSentences.push(
      FINDING_NARRATIVE[finding.id]?.appeared ?? `A new observation was recorded: ${finding.title}`
    );
  }
  for (const finding of [...diff.resolvedFindings].sort((a, b) => b.rank - a.rank)) {
    improvementSentences.push(
      FINDING_NARRATIVE[finding.id]?.resolved ??
        `An observation from the previous check is no longer present: ${finding.title}`
    );
  }

  for (const finding of diff.persistingFindings) {
    if (!finding.severityChanged) continue;
    const sentence =
      `The severity recorded for an existing observation (${finding.id}) moved from ` +
      `${finding.previousSeverity} to ${finding.severity}.`;
    if (finding.materiality === MATERIALITY.REGRESSION) regressionSentences.push(sentence);
    else improvementSentences.push(sentence);
  }

  const cmpSentence = consentPlatformChangeSentence(diff);
  if (cmpSentence) {
    const change = diff.changes.find((c) => c.kind === 'consent-platform-changed');
    if (change?.materiality === MATERIALITY.REGRESSION) regressionSentences.push(cmpSentence);
    else if (change?.materiality === MATERIALITY.IMPROVEMENT) improvementSentences.push(cmpSentence);
    else regressionSentences.push(cmpSentence);
  }

  // The reject-control change and the NO_REJECT_CONTROL finding describe the same event.
  // Say it once.
  const rejectChange = diff.changes.find(
    (c) => c.kind === 'reject-control-found' || c.kind === 'reject-control-lost'
  );
  const rejectAlreadySaid = [...diff.newFindings, ...diff.resolvedFindings].some(
    (finding) => finding.id === 'NO_REJECT_CONTROL'
  );
  if (rejectChange && !rejectAlreadySaid) {
    if (rejectChange.materiality === MATERIALITY.REGRESSION)
      regressionSentences.push(rejectChange.description);
    else improvementSentences.push(rejectChange.description);
  }

  const neutralSentences = PASS_KEYS.filter(
    (key) =>
      !diff.perPass[key].comparable &&
      (diff.perPass[key].added.length || diff.perPass[key].removed.length)
  ).map((key) => {
    const names = [...diff.perPass[key].added, ...diff.perPass[key].removed].map((t) => t.name);
    return (
      `${nameList(names)} ${names.length === 1 ? 'differs' : 'differ'} in the ` +
      `${PASS_LABEL[key]} pass between the two checks, but that pass was not measured on ` +
      'the same basis both times, so the difference is recorded rather than characterised.'
    );
  });

  const scoreSentence =
    diff.riskDelta !== 0 && diff.riskScore.previous !== null && diff.riskScore.current !== null
      ? `The exposure score moved from ${diff.riskScore.previous} to ${diff.riskScore.current}.`
      : null;

  // Backstop against an alert that announces a change and then describes nothing. Any
  // future change kind that has no prose of its own still gets stated in the body.
  fillFromDescriptions(regressionSentences, diff.changes, MATERIALITY.REGRESSION);
  fillFromDescriptions(improvementSentences, diff.changes, MATERIALITY.IMPROVEMENT);

  const body = paragraphs([
    regressionSentences.join(' '),
    improvementSentences.join(' '),
    neutralSentences.join(' '),
    scoreSentence,
    diff.notes.join(' '),
    CLOSING_LINE,
  ]);

  return { subject: changedSubject(diff, host, added, removed), body };
}

const CLOSING_LINE =
  'This records what a browser transmitted when it loaded the page from the public ' +
  'internet. It states no conclusion about your legal position.';

const paragraphs = (parts) => parts.filter((part) => part && part.trim()).join('\n\n');

function fillFromDescriptions(sentences, changes, materiality) {
  if (sentences.length) return;
  for (const change of changes) {
    if (change.materiality === materiality) sentences.push(change.description);
  }
}

function changedSubject(diff, host, added, removed) {
  if (diff.materiality === MATERIALITY.REGRESSION) {
    // Regressions lead with the gravest pass; that is the sentence the reader has to see
    // before deciding whether to open the mail.
    const group = added[0];
    if (group) {
      const detail =
        group.names.length === 1
          ? `${group.names[0]} now fires ${PASS_PHRASE_PRESENT[group.worstPass]}`
          : `${group.names.length} trackers now fire ${PASS_PHRASE_PRESENT[group.worstPass]}`;
      return `New tracking on ${host} — ${detail}`;
    }
    const finding = [...diff.newFindings].sort((a, b) => b.rank - a.rank)[0];
    if (finding) {
      return `New observation on ${host} — ${
        FINDING_NARRATIVE[finding.id]?.subject ?? finding.title
      }`;
    }
    return `Consent configuration changed on ${host}`;
  }

  // Improvements lead with the earliest pass instead: a tracker that stops firing on load
  // necessarily stops firing in the later passes too, so that is the fuller statement.
  if (diff.materiality === MATERIALITY.IMPROVEMENT) {
    const group = removed[0];
    const detail = group
      ? group.names.length === 1
        ? `${group.names[0]} no longer fires ${PASS_PHRASE_PRESENT[group.leadPass]}`
        : `${group.names.length} trackers no longer fire ${PASS_PHRASE_PRESENT[group.leadPass]}`
      : 'fewer observations than the previous check';
    return `Tracking reduced on ${host} — ${detail}`;
  }

  return `Configuration change observed on ${host}`;
}

/**
 * Group tracker movement for prose, one sentence per tracker rather than one per pass.
 *
 * A tag added through a tag manager almost always shows up in the baseline and the GPC
 * pass at once, so narrating per pass repeats the same tracker two or three times. Each
 * group therefore carries the full set of passes it moved in: `leadPass` is the earliest
 * and plainest way to say what happened ("began firing before any consent interaction"),
 * `worstPass` is the gravest and drives ranking and the subject line.
 */
function trackerNarrative(diff, kind, materiality) {
  const byTracker = new Map();
  for (const change of diff.changes) {
    if (change.kind !== kind || change.materiality !== materiality) continue;
    const entry = byTracker.get(change.name) || {
      name: change.name,
      category: change.category,
      passes: [],
      rank: 0,
    };
    entry.passes.push(change.pass);
    entry.rank = Math.max(entry.rank, change.rank);
    byTracker.set(change.name, entry);
  }

  const groups = new Map();
  for (const entry of byTracker.values()) {
    const passes = [...entry.passes].sort((a, b) => PASS_GRAVITY[a] - PASS_GRAVITY[b]);
    const key = `${passes.join(',')}|${entry.category}`;
    const group = groups.get(key) || {
      passes,
      leadPass: passes[0],
      worstPass: passes[passes.length - 1],
      category: entry.category,
      names: [],
      rank: 0,
    };
    group.names.push(entry.name);
    group.rank = Math.max(group.rank, entry.rank);
    groups.set(key, group);
  }

  return [...groups.values()].sort((a, b) => b.rank - a.rank);
}

function consentPlatformSentence(diff) {
  const current = diff.cmp.current;
  return current.length
    ? `The same consent platform (${current.join(', ')}) was detected.`
    : 'No consent management platform was detected, as at the previous check.';
}

function consentPlatformChangeSentence(diff) {
  if (!diff.cmpChanged) return null;
  const { previous, current } = diff.cmp;
  if (!current.length) {
    return (
      `No consent management platform was detected in this check; ` +
      `${previous.join(', ')} was detected at the previous check.`
    );
  }
  if (!previous.length) {
    return `A consent management platform (${current.join(', ')}) is now detected on the page.`;
  }
  return `The detected consent platform changed from ${previous.join(', ')} to ${current.join(', ')}.`;
}

function firstScanNarrative(diff, host) {
  const snapshot = diff.snapshot;
  const counts = snapshot?.trackerCounts ?? { baseline: 0, gpc: 0, afterReject: 0 };
  return {
    subject: `Baseline recorded for ${host} — ${counts.baseline} tracker(s) before consent`,
    body: paragraphs([
      `This is the first scan of ${diff.url}. It establishes the reference point for ` +
        'future checks; nothing in it is being reported as a change.',
      `Observed at this baseline: ${counts.baseline} third-party tracker(s) before any ` +
        `consent interaction, ${counts.gpc} with Global Privacy Control enabled, and ` +
        `${counts.afterReject} after the reject control was ` +
        `${snapshot?.rejectClicked ? 'clicked' : 'looked for but not found'}. ` +
        (snapshot?.cmp.length
          ? `Consent platform detected: ${snapshot.cmp.join(', ')}.`
          : 'No consent management platform was detected.'),
      'The next scan will be compared against this one, and only differences will be reported.',
      CLOSING_LINE,
    ]),
  };
}

function notComparableNarrative(diff, host) {
  return {
    subject: `Scan of ${host} could not be compared to the previous check`,
    body: paragraphs([
      `The latest scan of ${host} did not complete cleanly, so it has not been compared ` +
        'to the previous check and no drift is being reported from it.',
      diff.captureProblems.map((problem) => `- ${problem}`).join('\n'),
      'Re-running the scan is the fix. Nothing here indicates anything about the site ' +
        'itself; it describes the measurement.',
    ]),
  };
}
