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
