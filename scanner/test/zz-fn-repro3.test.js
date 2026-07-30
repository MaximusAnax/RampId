/** TEMPORARY reproduction harness #3. Not part of the product. */
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';

import { scanConsent } from '../src/consent.js';
import { diffScans, summarizeDrift } from '../src/diff.js';
import { triage } from '../src/monitor.js';

let server;
let base;

const shop = (extra) => `<!doctype html><html><head><title>Shop</title>
<script src="https://cdn.cookielaw.org/scripttemplates/otSDKStub.js"></script></head><body>
<div id="onetrust-banner-sdk"><p>We use cookies.</p>
<button id="a">Accept All</button><button id="r">Reject All</button></div>
<script>
  new Image().src = "https://www.facebook.com/tr?id=1&ev=PageView";
  ${extra ? 'new Image().src = "https://static.doubleclick.net/instream/ad_status.js";' : ''}
  document.getElementById('r').addEventListener('click', function () {
    document.getElementById('onetrust-banner-sdk').style.display = 'none';
  });
</script></body></html>`;

// A self-hosted vanilla-cookieconsent banner, injected 800ms after DOMContentLoaded,
// which is how every real consent manager behaves.
const SELF_HOSTED = `<!doctype html><html><head><title>Bespoke</title></head><body>
<h1>Store</h1>
<script>
  new Image().src = "https://www.facebook.com/tr?id=7&ev=PageView";
  setTimeout(function () {
    var d = document.createElement('div');
    d.id = 'cc-main';
    d.style.position = 'fixed'; d.style.bottom = '0'; d.style.left = '0';
    d.innerHTML = '<p>We use cookies and similar tracking technologies.</p>' +
      '<button class="cm__btn" data-role="necessary">Reject all</button>' +
      '<button class="cm__btn">Accept all</button>';
    document.body.appendChild(d);
  }, 800);
</script></body></html>`;

before(async () => {
  server = http.createServer((req, res) => {
    res.writeHead(200, { 'content-type': 'text/html; charset=utf-8' });
    if (req.url.startsWith('/selfhosted')) return res.end(SELF_HOSTED);
    return res.end(shop(req.url.startsWith('/plus')));
  });
  await new Promise((r) => server.listen(0, '127.0.0.1', r));
  base = `http://127.0.0.1:${server.address().port}`;
});

after(() => server?.close());

test('REPRO 7: a newly added ad tracker on an already-flagged site is triaged as "quiet"', async () => {
  const before_ = await scanConsent(`${base}/shop`, { settleMs: 800 });
  const after_ = await scanConsent(`${base}/plus`, { settleMs: 800 });
  after_.url = before_.url;

  const diff = diffScans(before_, after_);
  const result = { url: before_.url, skipped: false, diff, alert: summarizeDrift(diff) };
  const t = triage([result]);

  console.log('\n--- REPRO 7: tracker added, no new finding id ---');
  console.log('before trackers:', before_.passes.baseline.trackers.map((x) => x.name).join(','));
  console.log('after  trackers:', after_.passes.baseline.trackers.map((x) => x.name).join(','));
  console.log('diff.status       :', diff.status);
  console.log('diff.hasChanges   :', diff.hasChanges);
  console.log('diff.materiality  :', diff.materiality);
  console.log('diff.riskDelta    :', diff.riskDelta);
  console.log('diff.newFindings  :', diff.newFindings.map((f) => f.id).join(',') || '(none)');
  console.log('diff.newTrackers  :', diff.newTrackers.map((x) => x.name).join(','));
  console.log('alert.subject     :', result.alert.subject);
  console.log('triage            :', JSON.stringify(t));

  assert.equal(diff.materiality, 'regression', 'the diff itself knows this is a regression');
  assert.ok(diff.newTrackers.length > 0);
  assert.equal(t.regressions.length, 0, 'triage surfaces nothing');
  assert.equal(t.quiet, 1, 'and counts it as an unchanged target');
});

test('REPRO 8: a self-hosted banner rendered 800ms in is not detected at all', async () => {
  const scan = await scanConsent(`${base}/selfhosted`, { settleMs: 3000 });
  console.log('\n--- REPRO 8: DOM consent detection timing ---');
  console.log('cmp           :', JSON.stringify(scan.cmp));
  console.log('bannerVisible :', scan.bannerVisible);
  console.log('rejectClicked :', scan.passes.afterReject.rejectClicked);
  console.log('findings      :', scan.findings.map((f) => f.id).join(','));
  console.log('capture       :', JSON.stringify(scan.capture));
  assert.deepEqual(scan.cmp, [], 'no consent platform recorded');
  assert.equal(scan.bannerVisible, false, 'banner recorded as absent');
});
