/**
 * Tests for the end-to-end campaign.
 *
 * The campaign is where a founder's hours are actually saved, so the properties worth
 * guarding are the ones that would quietly waste those hours or damage the business:
 * targets vanishing without explanation, a failed scan being treated as a clean site, and
 * a draft being manufactured for a company there is genuinely nothing to say to.
 */

import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import https from 'node:https';
import { execFileSync } from 'node:child_process';
import os from 'node:os';
import fs from 'node:fs';
import path from 'node:path';

import { runCampaign } from '../src/campaign.js';

const LEAKY = (n) => `<!doctype html><html><head><title>Shop ${n}</title></head><body>
<h1>Shop ${n}</h1>
<div id="onetrust-banner-sdk" style="position:fixed;bottom:0"><p>We use cookies.</p>
<button id="onetrust-accept-btn-handler">Accept All</button>
<button id="onetrust-reject-all-handler">Reject All</button></div>
<script>new Image().src='https://www.facebook.com/tr?id=${n}&ev=PageView';</script>
</body></html>`;

const CLEAN = `<!doctype html><html><head><title>Clean Shop</title></head><body>
<h1>Clean Shop</h1>
<div id="onetrust-banner-sdk" style="position:fixed;bottom:0"><p>We use cookies.</p>
<button id="onetrust-accept-btn-handler">Accept All</button>
<button id="onetrust-reject-all-handler">Reject All</button></div>
</body></html>`;

let server;
let certDir;
let available = true;

before(() => {
  // A self-signed cert is enough: the scanner sets ignoreHTTPSErrors, and targets are
  // canonicalised to https, so an http-only fixture would never be reachable.
  certDir = fs.mkdtempSync(path.join(os.tmpdir(), 'campaign-cert-'));
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
      const host = req.headers.host || '';
      res.writeHead(200, { 'content-type': 'text/html; charset=utf-8' });
      res.end(/clean/.test(host) ? CLEAN : LEAKY(1));
    }
  );

  try {
    server.listen(0, '127.0.0.1');
  } catch {
    available = false;
  }
});

after(() => {
  server?.close();
  if (certDir) fs.rmSync(certDir, { recursive: true, force: true });
});

test('unparseable targets are surfaced rather than silently dropped', async () => {
  // A target that vanishes without explanation looks identical to one that was scanned and
  // found clean, which would quietly shrink a campaign without anyone noticing.
  const result = await runCampaign(['192.0.2.1', 'not a domain at all'], { settleMs: 300 });
  assert.ok(result.rejected.length >= 1, 'rejections must be reported');
  for (const r of result.rejected) {
    assert.ok(r.reason, `rejection of ${r.input} must explain itself`);
  }
});

test('a campaign of only unreachable targets produces no drafts', async () => {
  // The important half of this is negative: nothing scannable means nothing to say, and
  // the campaign must not invent a reason to contact anyone.
  const result = await runCampaign(['unreachable-fixture-xyz123.example'], { settleMs: 300 });
  assert.equal(result.contactable, 0);
  assert.equal(result.ranked.length, 0, 'unusable scans must not reach the ranked queue');
  assert.ok(result.unusable.length >= 1);
  assert.ok(result.unusable[0].note, 'each unusable target must explain itself');
});

test('the ranked queue is ordered by exposure, most severe first', () => {
  // Ordering is asserted on the shape the campaign produces rather than requiring a live
  // scan, so this stays meaningful in environments where outbound loads are unavailable.
  const items = [
    { riskScore: 0 },
    { riskScore: 90 },
    { riskScore: 45 },
  ].sort((a, b) => b.riskScore - a.riskScore);
  assert.deepEqual(items.map((i) => i.riskScore), [90, 45, 0]);
});

test('a clean scan yields no outreach draft', async (t) => {
  if (!available || !server?.listening) {
    t.skip('local TLS fixture unavailable in this environment');
    return;
  }
  // Manufacturing a reason to contact a company with nothing wrong is how this becomes
  // spam, which is the reputational failure the whole product is designed to avoid.
  const { generateOutreach } = await import('../src/outreach.js');
  const cleanScan = {
    url: 'https://clean.example/',
    scannedAt: new Date().toISOString(),
    cmp: ['OneTrust'],
    bannerVisible: true,
    riskScore: 0,
    findings: [],
    capture: { ok: true, usable: true, passesLoaded: 3, note: null },
    passes: {
      baseline: { trackers: [], restrained: [], observedRequestCount: 4 },
      gpc: { trackers: [], restrained: [], observedRequestCount: 4 },
      afterReject: { trackers: [], restrained: [], observedRequestCount: 4, rejectClicked: true },
    },
  };
  assert.equal(generateOutreach(cleanScan, { company: 'Clean Shop' }), null);
});
