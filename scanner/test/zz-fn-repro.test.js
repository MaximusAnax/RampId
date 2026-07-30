/**
 * TEMPORARY reproduction harness for the silent-false-negative review. Not part of the product.
 */
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';

import { scanConsent } from '../src/consent.js';
import { diffScans, findCaptureProblems, summarizeDrift } from '../src/diff.js';

let server;
let base;

const CHALLENGE_BODY = `<!doctype html><html><head><title>Just a moment...</title>
<link rel="stylesheet" href="/cdn-cgi/styles/challenge.css">
</head><body>
<h1>Checking your browser before accessing the site.</h1>
<p>Enable JavaScript and cookies to continue.</p>
<script src="/cdn-cgi/challenge-platform/h/b/orchestrate/jsch/v1"></script>
</body></html>`;

const LEAKY_BODY = `<!doctype html><html><head><title>Shop</title>
<script src="https://cdn.cookielaw.org/scripttemplates/otSDKStub.js"></script></head><body>
<div id="onetrust-banner-sdk"><p>We use cookies.</p>
<button id="a">Accept All</button><button id="r">Reject All</button></div>
<script>
  new Image().src = "https://www.facebook.com/tr?id=1&ev=PageView";
  new Image().src = "https://static.hotjar.com/c/hotjar-1.js";
  document.getElementById('r').addEventListener('click', function(){
    new Image().src = "https://www.facebook.com/tr?id=1&ev=AfterReject";
    document.getElementById('onetrust-banner-sdk').style.display='none';
  });
</script></body></html>`;

// Fires a real tracker AFTER the settle window closes.
const LATE_BODY = `<!doctype html><html><head><title>Late</title></head><body>
<h1>Hello</h1>
<script>
  setTimeout(function(){
    new Image().src = "https://www.facebook.com/tr?id=99&ev=PageView";
    new Image().src = "https://static.hotjar.com/c/hotjar-9.js";
  }, 2500);
</script></body></html>`;

before(async () => {
  server = http.createServer((req, res) => {
    if (req.url.startsWith('/challenge')) {
      // Exactly what Cloudflare / Akamai / PerimeterX serve to a headless browser.
      res.writeHead(403, { 'content-type': 'text/html; charset=utf-8' });
      res.end(CHALLENGE_BODY);
      return;
    }
    if (req.url.startsWith('/leaky')) {
      res.writeHead(200, { 'content-type': 'text/html; charset=utf-8' });
      res.end(LEAKY_BODY);
      return;
    }
    if (req.url.startsWith('/late')) {
      res.writeHead(200, { 'content-type': 'text/html; charset=utf-8' });
      res.end(LATE_BODY);
      return;
    }
    res.writeHead(404);
    res.end('nope');
  });
  await new Promise((r) => server.listen(0, '127.0.0.1', r));
  base = `http://127.0.0.1:${server.address().port}`;
});

after(() => server?.close());

test('REPRO 1: a 403 bot-challenge page reports as a clean, healthy scan', async () => {
  const scan = await scanConsent(`${base}/challenge`, { settleMs: 800 });
  console.log('\n--- REPRO 1: bot challenge ---');
  console.log('capture      :', JSON.stringify(scan.capture));
  console.log('errors       :', JSON.stringify(scan.errors));
  console.log('findings     :', JSON.stringify(scan.findings.map((f) => f.id)));
  console.log('riskScore    :', scan.riskScore);
  console.log('captureProbs :', JSON.stringify(findCaptureProblems(scan, 'scan')));
  assert.equal(scan.capture.ok, true, 'capture reports fully healthy');
  assert.deepEqual(scan.errors, [], 'no errors recorded');
  assert.deepEqual(findCaptureProblems(scan, 'scan'), [], 'diff.js sees no capture problem');
});

test('REPRO 2: a site that starts serving a challenge page produces an "improvement" alert', async () => {
  const previous = await scanConsent(`${base}/leaky`, { settleMs: 800 });
  const current = await scanConsent(`${base}/challenge`, { settleMs: 800 });
  // Same host, later timestamp: exactly what a monitoring cycle produces.
  current.url = previous.url;
  const diff = diffScans(previous, current);
  const alert = summarizeDrift(diff);
  console.log('\n--- REPRO 2: monitoring across a bot challenge ---');
  console.log('previous findings:', previous.findings.map((f) => f.id).join(','));
  console.log('current  findings:', current.findings.map((f) => f.id).join(','));
  console.log('diff.status      :', diff.status);
  console.log('diff.materiality :', diff.materiality);
  console.log('riskDelta        :', diff.riskDelta);
  console.log('resolvedFindings :', diff.resolvedFindings.map((f) => f.id).join(','));
  console.log('SUBJECT >>', alert.subject);
  console.log('BODY    >>\n' + alert.body);
});

test('REPRO 3: a tracker firing after the settle window is invisible and undetectable', async () => {
  const short = await scanConsent(`${base}/late`, { settleMs: 800 });
  const long = await scanConsent(`${base}/late`, { settleMs: 5000 });
  console.log('\n--- REPRO 3: late-firing tracker ---');
  console.log('settle 800ms  -> capture', JSON.stringify(short.capture),
    'findings', short.findings.map((f) => f.id).join(',') || 'NONE',
    'risk', short.riskScore);
  console.log('settle 5000ms -> capture', JSON.stringify(long.capture),
    'findings', long.findings.map((f) => f.id).join(',') || 'NONE',
    'risk', long.riskScore);
  console.log('short baseline pass keys:', JSON.stringify(Object.keys(short.passes.baseline)));
});
