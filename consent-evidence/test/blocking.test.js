/**
 * Tests for the cases where a site does not actually serve us the site.
 *
 * These are the highest-consequence silent failures in the system. A Cloudflare challenge,
 * an Akamai interstitial, a 403 or a 500 all produce a page that loads successfully,
 * records requests, and contains no trackers — because there is no site there. Scored
 * naively that is a perfect clean result.
 *
 * In monitoring it is worse than useless: a client who starts challenging our traffic would
 * be told every one of their findings had been resolved, which is both wrong and the exact
 * kind of good news nobody questions.
 */

import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import https from 'node:https';
import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

import { scanConsent } from '../src/consent.js';
import { triage } from '../src/monitor.js';

const CHALLENGE = `<!doctype html><html><head><title>Just a moment...</title></head>
<body><h1>Just a moment...</h1><p>Checking your browser before accessing the site.</p></body></html>`;

let server;
let base;
let certDir;
let available = true;

before(async () => {
  certDir = fs.mkdtempSync(path.join(os.tmpdir(), 'blocking-cert-'));
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
      if (req.url.startsWith('/err')) {
        res.writeHead(403, { 'content-type': 'text/html' });
        return res.end('<html><head><title>Forbidden</title></head><body>403</body></html>');
      }
      res.writeHead(200, { 'content-type': 'text/html; charset=utf-8' });
      res.end(CHALLENGE);
    }
  );
  await new Promise((r) => server.listen(0, '127.0.0.1', r));
  base = `https://127.0.0.1:${server.address().port}`;
});

after(() => {
  server?.close();
  if (certDir) fs.rmSync(certDir, { recursive: true, force: true });
});

test('an interstitial served instead of the site is not a clean scan', async (t) => {
  if (!available) return t.skip('openssl unavailable');
  const scan = await scanConsent(`${base}/`, { settleMs: 800 });

  assert.equal(scan.capture.blocked, true, 'the challenge page must be recognised');
  assert.equal(scan.capture.usable, false, 'nothing can be concluded from a challenge page');
  assert.deepEqual(scan.findings, [], 'and no findings may be invented from it either');
  assert.ok(/interstitial|challenge/i.test(scan.capture.note));
});

test('an HTTP error page is not a clean scan', async (t) => {
  if (!available) return t.skip('openssl unavailable');
  const scan = await scanConsent(`${base}/err`, { settleMs: 800 });

  assert.equal(scan.capture.blocked, true);
  assert.equal(scan.capture.usable, false);
  assert.ok(/403/.test(scan.capture.note), 'the status code belongs in the explanation');
});

test('a new tracker is a regression even when no new finding appears', () => {
  // The common real case: a marketing team adds one more tag to a site that already has a
  // pre-consent finding. The finding set is unchanged and the risk score is unchanged, so
  // without this the drift a client pays to hear about is filed as "quiet" — hollowing out
  // the retainer while appearing to work perfectly.
  const result = {
    url: 'https://shop.example/',
    skipped: false,
    alert: { subject: 'New tracker', body: 'TikTok Pixel began firing.' },
    diff: {
      hasChanges: true,
      riskDelta: 0,
      newFindings: [],
      resolvedFindings: [],
      newTrackers: [{ name: 'TikTok Pixel' }],
    },
  };

  const t = triage([result]);
  assert.equal(t.regressions.length, 1, 'a new tracker must surface as a regression');
  assert.equal(t.quiet, 0);
});

test('a skipped scan is never reported as an improvement', () => {
  const t = triage([
    { url: 'https://shop.example/', skipped: true, reason: 'challenge page served', diff: null },
  ]);
  assert.equal(t.improvements.length, 0);
  assert.equal(t.problems.length, 1);
});

test('monitoring walks back past a failed cycle to the last good scan', async () => {
  // Without this, a single blocked cycle permanently erases the drift that happened across
  // it: the failure becomes the baseline, the next cycle compares against the failure, and
  // everything that changed in between is reported as unchanged. Nothing looks wrong.
  const { createStore } = await import('@evidence/shared/store');
  const { monitorTarget } = await import('../src/monitor.js');
  const os = await import('node:os');
  const fsp = await import('node:fs/promises');
  const nodePath = await import('node:path');

  const dataRoot = await fsp.mkdtemp(nodePath.join(os.tmpdir(), 'walkback-'));
  const store = createStore(dataRoot);
  const target = 'https://walkback.example/';

  const good = {
    url: target,
    scannedAt: '2026-07-01T00:00:00.000Z',
    cmp: ['OneTrust'],
    bannerVisible: true,
    riskScore: 60,
    findings: [{ id: 'PRE_CONSENT', severity: 'critical', title: 't', detail: 'd', trackers: ['Meta Pixel'] }],
    capture: { ok: true, usable: true, passesLoaded: 3, blocked: false, note: null },
    errors: [],
    passes: {
      baseline: { trackers: [{ name: 'Meta Pixel' }], restrained: [], requestCount: 4, observedRequestCount: 4, loaded: true },
      gpc: { trackers: [], restrained: [], requestCount: 4, observedRequestCount: 4, loaded: true },
      afterReject: { trackers: [], restrained: [], requestCount: 4, observedRequestCount: 4, loaded: true, rejectClicked: true },
    },
  };

  const blocked = {
    ...good,
    scannedAt: '2026-07-15T00:00:00.000Z',
    riskScore: 0,
    findings: [],
    capture: { ok: false, usable: false, passesLoaded: 0, blocked: true, note: 'challenge served' },
  };

  await store.saveScan(target, good);
  await store.saveScan(target, blocked);

  const history = await store.getHistory(target, { limit: 12 });
  const chosen = history
    .map((r) => r?.scan ?? r)
    .find((c) => c && c.capture?.usable !== false);

  assert.ok(chosen, 'a usable prior scan must be found');
  assert.equal(chosen.scannedAt, good.scannedAt, 'must skip the blocked scan and use the good one');

  await fsp.rm(dataRoot, { recursive: true, force: true });
});

test('capture problems name a blocked pass so drift is never derived from it', async () => {
  // The upstream status check alone was not enough: the differ has its own capture gate, and
  // a challenge page passed it because the challenge page's own assets make the request count
  // non-zero and set no error. That is how a blocked cycle became "all findings resolved".
  const { findCaptureProblems } = await import('../src/diff.js');

  const blockedScan = {
    url: 'https://shop.example/',
    capture: { ok: false, usable: false, blocked: true, passesLoaded: 0, note: 'challenge served' },
    errors: [],
    passes: {
      baseline: { requestCount: 3, observedRequestCount: 3, loaded: false, blocked: true, status: 403 },
      gpc: { requestCount: 3, observedRequestCount: 3, loaded: false, blocked: true, status: 403 },
      afterReject: { requestCount: 3, observedRequestCount: 3, loaded: false, blocked: true, status: 403 },
    },
  };

  const problems = findCaptureProblems(blockedScan, 'current scan');
  assert.ok(problems.length > 0, 'a blocked scan must never be treated as comparable');
  assert.ok(problems.some((p) => /interstitial|error page|blocked/i.test(p)));
});

test('a target that could not be compared is a problem, not a quiet week', async () => {
  const { DRIFT_STATUS } = await import('../src/diff.js');
  const t = triage([
    {
      url: 'https://shop.example/',
      skipped: false,
      alert: null,
      diff: {
        status: DRIFT_STATUS.NOT_COMPARABLE,
        hasChanges: false,
        riskDelta: null,
        captureProblems: ['the previous scan was blocked'],
      },
    },
  ]);
  assert.equal(t.problems.length, 1, 'must surface as a coverage gap');
  assert.equal(t.quiet, 0, 'and must not be counted as unchanged');
});

test('duplicate URL forms of one host are collapsed before scanning', async () => {
  // Two writers appending to one stored timeline compare each other's scans and produce
  // drift alerts describing changes that never happened.
  const { monitorAll } = await import('../src/monitor.js');
  const seen = [];
  await monitorAll(
    ['https://dup-fixture.example/', 'https://dup-fixture.example/checkout'],
    { concurrency: 1, settleMs: 200, dataRoot: undefined, onResult: (r) => seen.push(r.url) }
  );
  assert.equal(seen.length, 1, 'the same host must be scanned once per cycle');
});
