/**
 * Tests for the AI agent policy-contradiction audit.
 *
 * The product claim is narrow and deliberately so: not "your chatbot is inaccurate", which
 * needs the company's internal ground truth and invites argument, but "your public agent
 * contradicts your own published policy" — where both sides are public and the comparison
 * is checkable by the reader in a minute.
 *
 * That only holds if the system is relentlessly conservative. The failure that would end
 * this business is telling a general counsel their agent invented a policy when it did not,
 * so most of what follows tests the cases where nothing should be reported.
 */

import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import https from 'node:https';
import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { extractClaims, questionSet, questionFor, POLICY_AREAS } from '../src/policy.js';
import { compareReply, assessProbe, extractValues, isHedged, isRefusal } from '../src/contradiction.js';
import { probe, repliesByArea } from '../src/agentprobe.js';

const FIXTURES = path.join(path.dirname(fileURLToPath(import.meta.url)), 'fixtures');

const POLICY_TEXT = `Returns. You may return most items within 30 days of delivery for a
full refund. A 15% restocking fee applies to opened electronics. Shipping. Standard delivery
costs $9.95 and typically arrives in 5 days. Orders over $75 ship free. Warranty. All
products carry a 12 month warranty against manufacturing defects.`;

const claims = extractClaims(POLICY_TEXT, 'https://example.com/policy');
const claimsFor = (area) => claims.filter((c) => c.area === area);

// ---------------------------------------------------------------- claim extraction

test('numeric claims are attributed to the policy area that governs them', () => {
  const byArea = {};
  for (const c of claims) (byArea[c.area] ??= []).push(c.display);

  assert.ok(byArea.returns?.includes('30 days'));
  assert.ok(byArea.warranty?.includes('12 month'));
  assert.ok(byArea.shipping?.includes('$9.95'));
  // "Orders over $75 ship free" sits immediately before the Warranty heading. Attributing
  // it to warranty would produce a confident, specific and entirely wrong finding.
  assert.ok(byArea.shipping?.includes('$75'), 'a value must not be captured by the next heading');
});

test('numbers with no nearby policy keyword are dropped rather than guessed at', () => {
  // A number attributed to the wrong area is worse than a number ignored.
  const noise = extractClaims('Founded in 1994. We have 250 employees across 12 offices.');
  assert.deepEqual(noise, []);
});

test('repeated statements of the same fact collapse to one claim', () => {
  const repetitive = extractClaims(
    'Returns within 30 days. You may return items within 30 days. Returns: 30 days.'
  );
  assert.equal(repetitive.filter((c) => c.area === 'returns' && c.kind === 'duration').length, 1);
});

test('durations are normalised so equivalent values compare equal', () => {
  const months = extractClaims('Warranty. Products carry a 1 month warranty.');
  const days = extractClaims('Warranty. Products carry a 30 day warranty.');
  assert.equal(months[0].normalizedValue, days[0].normalizedValue);
});

test('empty or missing policy text yields no claims', () => {
  assert.deepEqual(extractClaims(''), []);
  assert.deepEqual(extractClaims(null), []);
});

test('questions read as ordinary customer enquiries, not as tests', () => {
  for (const area of POLICY_AREAS) {
    const q = questionFor({ area: area.id });
    assert.ok(q.endsWith('?'), `${area.id} question must be a question`);
    // A leading or accusatory probe produces an answer the company can fairly disown, and
    // changes the posture of the exercise from audit to something adversarial.
    assert.ok(!/policy states|according to|is it true|why did/i.test(q), `${area.id} question is leading`);
  }
});

test('one question is asked per policy area, not one per claim', () => {
  // Every extra question spends the target's inference budget for no extra evidence.
  const set = questionSet(claims);
  assert.equal(new Set(set.map((s) => s.area)).size, set.length);
  assert.ok(set.length < claims.length);
});

// ---------------------------------------------------------------- comparison

test('an agent restating the published value is not a finding', () => {
  const r = compareReply('You can return items within 30 days of delivery.', claimsFor('returns'));
  assert.equal(r.status, 'agrees');
});

test('an agent stating a different value contradicts', () => {
  const r = compareReply('You have 90 days to return any item.', claimsFor('returns'));
  assert.equal(r.status, 'contradicts');
  assert.equal(r.conflicting[0].agentSaid, '90 days');
});

test('a hedged answer is never a contradiction', () => {
  // "Typically around 90 days, but please check" is not a policy assertion, and holding a
  // company to a qualified statement is the overreach that gets a report dismissed.
  for (const reply of [
    'Returns are typically around 90 days, but please check with support.',
    'It may vary, but generally 90 days.',
    'Usually 90 days depending on the item.',
  ]) {
    assert.equal(compareReply(reply, claimsFor('returns')).status, 'hedged', reply);
    assert.equal(isHedged(reply), true);
  }
});

test('an agent declining to answer is not a contradiction', () => {
  for (const reply of [
    'I am sorry, I cannot help with that. Please contact our support team.',
    "I don't have that information available.",
  ]) {
    assert.equal(compareReply(reply, claimsFor('returns')).status, 'declined', reply);
    assert.equal(isRefusal(reply), true);
  }
});

test('an answer containing no comparable value is not a contradiction', () => {
  const r = compareReply('Items must be unused and in original packaging.', claimsFor('returns'));
  assert.equal(r.status, 'no-value');
});

test('a correct answer accompanied by unrelated numbers still agrees', () => {
  // Reporting this would be a false positive of exactly the fatal kind: the agent answered
  // correctly and merely said more than was asked.
  const r = compareReply(
    'You can return items within 30 days. Delivery usually takes 5 days.',
    claimsFor('returns')
  );
  assert.equal(r.status, 'agrees');
});

test('values are extracted for each kind independently', () => {
  const v = extractValues('Returns take 30 days, shipping is $9.95, restocking is 15%.');
  assert.equal(v.duration[0].display, '30 days');
  assert.equal(v.money[0].display, '$9.95');
  assert.equal(v.percentage[0].display, '15%');
});

// ---------------------------------------------------------------- reproduction

test('a contradiction seen once is recorded as instability, not reported', () => {
  // Language models are non-deterministic. One divergent answer proves almost nothing, and
  // reporting it would mean accusing companies on the strength of a single sample.
  const r = assessProbe(
    [
      'You can return items within 30 days.',
      'You can return items within 30 days.',
      'You have 90 days to return any item.',
    ],
    claimsFor('returns'),
    { minReproductions: 2 }
  );
  assert.equal(r.finding, null);
  assert.equal(r.contradictedIn, 1);
  assert.equal(r.unstable, true, 'differing answers across sessions are still worth surfacing');
});

test('a contradiction reproduced across sessions is reported with its evidence', () => {
  const r = assessProbe(
    [
      'You have 90 days to return any item.',
      'Returns are accepted within 90 days.',
      'You can return items within 30 days.',
    ],
    claimsFor('returns'),
    { minReproductions: 2 }
  );

  assert.ok(r.finding);
  assert.equal(r.finding.id, 'AGENT_CONTRADICTS_POLICY');
  assert.equal(r.finding.agentSaid, '90 days');
  assert.equal(r.finding.policySays, '30 days');
  assert.ok(r.finding.transcript, 'the agent reply must be quotable');
  assert.ok(r.finding.policyExcerpt, 'the published text must be quotable alongside it');
  assert.ok(/2 of 3/.test(r.finding.reproducedIn));
});

test('a consistently correct agent produces nothing at all', () => {
  const r = assessProbe(
    ['Within 30 days.', 'You have 30 days to return.', '30 days from delivery.'],
    claimsFor('returns'),
    { minReproductions: 2 }
  );
  assert.equal(r.finding, null);
  assert.equal(r.unstable, false);
});

test('the finding states the comparison without asserting a legal conclusion', () => {
  const r = assessProbe(
    ['You have 90 days to return any item.', 'Returns are accepted within 90 days.'],
    claimsFor('returns'),
    { minReproductions: 2 }
  );
  const text = `${r.finding.title} ${r.finding.detail}`;
  for (const banned of [/\bviolat/i, /\billegal\b/i, /\bliable\b/i, /misled/i, /\bdeceptive\b/i]) {
    assert.ok(!banned.test(text), `must not assert a legal conclusion: ${banned}`);
  }
});

// ---------------------------------------------------------------- live probe

let server;
let base;
let available = true;
let certDir;

before(async () => {
  certDir = fs.mkdtempSync(path.join(os.tmpdir(), 'agent-cert-'));
  const key = path.join(certDir, 'k.pem');
  const cert = path.join(certDir, 'c.pem');
  try {
    execFileSync('openssl', [
      'req', '-x509', '-newkey', 'rsa:2048', '-keyout', key, '-out', cert,
      '-days', '1', '-nodes', '-subj', '/CN=fixture',
    ], { stdio: 'ignore' });
  } catch {
    available = false;
    return;
  }
  server = https.createServer(
    { key: fs.readFileSync(key), cert: fs.readFileSync(cert) },
    (req, res) => {
      const name = req.url.includes('policy') ? 'policy.html' : 'site.html';
      res.writeHead(200, { 'content-type': 'text/html; charset=utf-8' });
      res.end(fs.readFileSync(path.join(FIXTURES, name)));
    }
  );
  await new Promise((r) => server.listen(0, '127.0.0.1', r));
  base = `https://127.0.0.1:${server.address().port}`;
});

after(() => {
  server?.close();
  if (certDir) fs.rmSync(certDir, { recursive: true, force: true });
});

test('the probe drives a real widget and captures the agent reply', async (t) => {
  if (!available) return t.skip('openssl unavailable');

  const sessions = await probe(
    `${base}/site.html`,
    [{ area: 'returns', question: 'How long do I have to return an item?' }],
    { runs: 2, replyWaitMs: 1500, betweenRunsMs: 200 }
  );

  assert.equal(sessions.filter((s) => s.opened).length, 2, 'both sessions must open the widget');

  const byArea = repliesByArea(sessions);
  const replies = byArea.get('returns') ?? [];
  assert.equal(replies.length, 2);

  // The reply must not contain the question, or the audit would compare the question text
  // against the policy rather than the agent's answer.
  for (const reply of replies) {
    assert.ok(!reply.includes('How long do I have to return an item?'));
    assert.ok(/90 days/.test(reply), 'the fixture agent states the stale 90-day figure');
  }

  const r = assessProbe(replies, claimsFor('returns'), { minReproductions: 2 });
  assert.ok(r.finding, 'a reproduced contradiction must be reported');
  assert.equal(r.finding.agentSaid, '90 days');
  assert.equal(r.finding.policySays, '30 days');
});
