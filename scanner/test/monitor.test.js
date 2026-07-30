/**
 * Tests for the monitoring loop.
 *
 * These are integration tests on purpose. Every bug this loop has had so far was an
 * integration bug that unit tests could not have caught:
 *
 *   - the store returns a record that wraps the scan, and passing that record straight to
 *     the differ produced "not comparable" on every cycle. That failure mode is uniquely
 *     dangerous for a paid monitoring service, because it looks exactly like a working
 *     monitor on a client whose site never changes.
 *   - a site that correctly halts every tracker after the reject click records zero
 *     requests in that pass, which the capture-health check read as a failed page load.
 *     The best possible client outcome was being classified as a broken scan.
 */

import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';

import { monitorTarget, triage } from '../src/monitor.js';

const QUIET_PAGE = `<!doctype html><html><head><title>Quiet</title></head><body><h1>Quiet</h1>
<div id="onetrust-banner-sdk" style="position:fixed;bottom:0"><p>We use cookies.</p>
<button id="onetrust-accept-btn-handler">Accept All</button>
<button id="onetrust-reject-all-handler">Reject All</button></div>
<script>new Image().src='https://www.google-analytics.com/collect?v=1';</script></body></html>`;

const NOISY_PAGE = `<!doctype html><html><head><title>Quiet</title></head><body><h1>Quiet</h1>
<div id="onetrust-banner-sdk" style="position:fixed;bottom:0"><p>We use cookies.</p>
<button id="onetrust-accept-btn-handler">Accept All</button>
<button id="onetrust-reject-all-handler">Reject All</button></div>
<script>
new Image().src='https://www.google-analytics.com/collect?v=1';
new Image().src='https://www.facebook.com/tr?id=1&ev=PageView';
new Image().src='https://static.hotjar.com/c/hj.js';
</script></body></html>`;

let server;
let url;
let dataRoot;
let page = QUIET_PAGE;
let regressionAlert = null;

before(async () => {
  dataRoot = await fs.mkdtemp(path.join(os.tmpdir(), 'monitor-test-'));
  server = http.createServer((req, res) => {
    res.writeHead(200, { 'content-type': 'text/html; charset=utf-8' });
    res.end(page);
  });
  await new Promise((r) => server.listen(0, '127.0.0.1', r));
  url = `http://127.0.0.1:${server.address().port}/site.html`;
});

after(async () => {
  server?.close();
  if (dataRoot) await fs.rm(dataRoot, { recursive: true, force: true });
});

test('the first cycle establishes a baseline rather than reporting a regression', async () => {
  page = QUIET_PAGE;
  const r = await monitorTarget(url, { dataRoot, settleMs: 1200 });
  assert.equal(r.skipped, false, `unexpected skip: ${r.reason}`);
  assert.equal(r.diff.status, 'first-scan');
  assert.ok(r.alert?.subject, 'a baseline alert should still be produced');
  assert.ok(
    !/regress|worse|violation/i.test(r.alert.subject),
    'a first scan must not read as something the client just broke'
  );
});

test('a second cycle with no change compares cleanly and reports no drift', async () => {
  const r = await monitorTarget(url, { dataRoot, settleMs: 1200 });
  assert.equal(r.skipped, false, `unexpected skip: ${r.reason}`);
  assert.equal(r.diff.status, 'compared', 'the stored record must be unwrapped before comparison');
  assert.equal(r.diff.hasChanges, false);
  assert.equal(triage([r]).regressions.length, 0);
});

test('newly added tags are detected as a material regression', async () => {
  page = NOISY_PAGE;
  const r = await monitorTarget(url, { dataRoot, settleMs: 1200 });

  assert.equal(r.diff.status, 'compared');
  assert.equal(r.diff.hasChanges, true);
  assert.ok(r.diff.riskDelta > 0, 'risk should rise when trackers are added');
  assert.equal(r.diff.materiality, 'regression');

  const names = r.diff.newTrackers.map((t) => t.name || t);
  assert.ok(names.includes('Meta Pixel'));
  assert.ok(names.includes('Hotjar'));

  const t = triage([r]);
  assert.equal(t.regressions.length, 1);
  assert.equal(t.quiet, 0);

  regressionAlert = r.alert;
});

test('the drift alert names the specific service and asserts no legal conclusion', () => {
  // Asserts on the alert captured at the moment drift was detected. Re-scanning here would
  // compare noisy against noisy and correctly report no change, which tests nothing.
  assert.ok(regressionAlert, 'the regression cycle must have produced an alert');
  const text = `${regressionAlert.subject} ${regressionAlert.body}`;

  // The whole value of the alert is specificity. "Something changed" is not actionable.
  assert.ok(/Hotjar|Meta Pixel/.test(text), 'the alert must name what changed');

  // The same rule that governs the report governs the alert: observed facts only.
  for (const banned of [/\bviolat/i, /\billegal\b/i, /non-?compliant/i, /you (are|may be) liable/i]) {
    assert.ok(!banned.test(text), `alert must not assert a legal conclusion: ${banned}`);
  }
});

test('a failed capture never produces a fabricated improvement', async () => {
  // A scan that could not load the page records no trackers, which is indistinguishable
  // from a client having fixed everything. Reporting that as good news off the back of a
  // network failure would be worse than sending nothing at all.
  const dead = 'http://127.0.0.1:1/never-listening.html';
  const r = await monitorTarget(dead, { dataRoot, settleMs: 500 });
  assert.equal(r.skipped, true);
  assert.equal(r.alert, null);
  assert.ok(r.reason && r.reason.length > 0, 'the skip must explain itself');

  const t = triage([r]);
  assert.equal(t.improvements.length, 0, 'a failed scan must never read as an improvement');
  assert.equal(t.problems.length, 1);
});
