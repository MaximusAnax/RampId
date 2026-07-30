/** TEMPORARY reproduction harness #2. Not part of the product. */
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';

import { scanConsent } from '../src/consent.js';
import { monitorTarget, triage } from '../src/monitor.js';
import { renderReport } from '../src/report.js';
import { diffScans } from '../src/diff.js';

let server;
let base;
let mode = 'leaky';

const page = (extraTracker, bannerDelayMs) => `<!doctype html><html><head><title>Shop</title>
<script src="https://cdn.cookielaw.org/scripttemplates/otSDKStub.js"></script></head><body>
<h1>Shop</h1>
<script>
  new Image().src = "https://www.facebook.com/tr?id=1&ev=PageView";
  new Image().src = "https://static.hotjar.com/c/hotjar-1.js";
  ${extraTracker ? `new Image().src = "https://static.doubleclick.net/instream/ad_status.js";` : ''}
  setTimeout(function () {
    var d = document.createElement('div');
    d.id = 'onetrust-banner-sdk';
    d.innerHTML = '<p>We use cookies.</p><button id="a">Accept All</button>' +
                  '<button id="r">Reject All</button>';
    document.body.appendChild(d);
    document.getElementById('r').addEventListener('click', function () {
      new Image().src = "https://www.facebook.com/tr?id=1&ev=AfterReject";
      d.style.display = 'none';
    });
  }, ${bannerDelayMs});
</script></body></html>`;

before(async () => {
  server = http.createServer((req, res) => {
    if (mode === 'down') {
      req.socket.destroy(); // origin refusing the automated load
      return;
    }
    if (req.url.startsWith('/late-banner')) {
      res.writeHead(200, { 'content-type': 'text/html; charset=utf-8' });
      res.end(page(false, 4200));
      return;
    }
    if (req.url.startsWith('/early-banner')) {
      res.writeHead(200, { 'content-type': 'text/html; charset=utf-8' });
      res.end(page(false, 200));
      return;
    }
    res.writeHead(200, { 'content-type': 'text/html; charset=utf-8' });
    res.end(page(mode === 'leaky2', 200));
  });
  await new Promise((r) => server.listen(0, '127.0.0.1', r));
  base = `http://127.0.0.1:${server.address().port}`;
});

after(() => server?.close());

test('REPRO 4: real drift straddling one failed scan is reported as "unchanged"', async () => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'a50-mon-'));
  const url = `${base}/shop`;
  const opts = { dataRoot: root, settleMs: 700 };

  mode = 'leaky';
  const c1 = await monitorTarget(url, opts);

  mode = 'down';
  const c2 = await monitorTarget(url, opts);

  mode = 'leaky2'; // site is back up AND a new advertising tracker was added
  const c3 = await monitorTarget(url, opts);

  console.log('\n--- REPRO 4: drift across a failed cycle ---');
  console.log('cycle1 status', c1.diff?.status, 'skipped', c1.skipped);
  console.log('cycle2 skipped', c2.skipped, '| reason:', c2.reason?.slice(0, 90));
  console.log('cycle3 skipped', c3.skipped, '| status', c3.diff?.status,
    '| blockedBy', c3.diff?.blockedBy, '| hasChanges', c3.diff?.hasChanges, '| alert', c3.alert);
  console.log('cycle3 baseline trackers:',
    c3.scan.passes.baseline.trackers.map((t) => t.name).join(','));
  console.log('triage(cycle3):', JSON.stringify(triage([c3])));

  // the new tracker really is there
  assert.ok(
    c3.scan.passes.baseline.trackers.some((t) => /doubleclick|google/i.test(t.name)),
    'the new advertising tracker was captured'
  );
  const t = triage([c3]);
  assert.equal(t.regressions.length, 0);
  assert.equal(t.problems.length, 0);
  assert.equal(t.quiet, 1, 'counted as an unchanged target');
  assert.equal(c3.alert, null, 'no alert produced');

  // And the drift IS visible if the last GOOD scan is used instead of the last scan.
  const good = diffScans(c1.scan, c3.scan);
  console.log('diff vs last GOOD scan:', good.status, '| newTrackers:',
    good.newTrackers.map((x) => x.name).join(','), '| riskDelta', good.riskDelta);
});

test('REPRO 5: a report for a partly-failed capture states the failed pass was clean', async () => {
  const scan = await scanConsent(`${base}/shop`, { settleMs: 700 });
  // Simulate what scanConsent produces when the GPC pass alone fails to load: pass.error set,
  // no trackers, and capture recomputed the way consent.js computes it.
  scan.passes.gpc = {
    observedRequestCount: 1,
    trackerCount: 0,
    trackers: [],
    restrained: [],
    requestCount: 1,
    error: 'page.goto: net::ERR_CONNECTION_RESET',
  };
  scan.errors = ['page.goto: net::ERR_CONNECTION_RESET'];
  scan.capture = {
    ok: false,
    passesLoaded: 2,
    usable: true,
    note: 'Only 2 of 3 passes loaded successfully. Findings are incomplete.',
  };
  scan.findings = scan.findings.filter((f) => f.id !== 'GPC_IGNORED');

  const html = renderReport(scan);
  console.log('\n--- REPRO 5: report for a partly-failed capture ---');
  console.log('findings rendered:', scan.findings.map((f) => f.id).join(','));
  console.log('contains capture note?      ', html.includes(scan.capture.note));
  console.log('contains "did not complete"?', html.includes('This scan did not complete'));
  const pass2 = html.slice(html.indexOf('Pass 2 —'), html.indexOf('Pass 3 —'));
  console.log('Pass 2 block says:', pass2.match(/<p class="ok">[^<]*/)?.[0] ?? '(no ok line)');
  assert.equal(html.includes(scan.capture.note), false, 'capture note is nowhere in the report');
  assert.ok(pass2.includes('No third-party trackers observed in this pass'));
});

test('REPRO 6: a banner that renders after 4.2s is never rejected, at the production settle window', async () => {
  const late = await scanConsent(`${base}/late-banner`, { settleMs: 7000 });
  const early = await scanConsent(`${base}/early-banner`, { settleMs: 7000 });
  console.log('\n--- REPRO 6: late-rendering banner ---');
  console.log('early banner: rejectClicked', early.passes.afterReject.rejectClicked,
    '| findings', early.findings.map((f) => f.id).join(','), '| risk', early.riskScore);
  console.log('late  banner: rejectClicked', late.passes.afterReject.rejectClicked,
    '| findings', late.findings.map((f) => f.id).join(','), '| risk', late.riskScore);
  console.log('late cmp:', JSON.stringify(late.cmp), 'bannerVisible:', late.bannerVisible);
  console.log('late capture:', JSON.stringify(late.capture));
});
