/**
 * Regression tests for the evidence engine.
 *
 * The bias throughout the product is that a false positive is far more expensive than a
 * false negative: an audit that accuses a compliant company of a violation destroys the
 * credibility the whole sales motion depends on. So the clean-fixture assertions are the
 * ones that matter most.
 *
 * Run: npm test
 */

import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { scanConsent } from '../src/consent.js';
import { assessDisclosure, VERDICT } from '../src/disclosure.js';
import { identifyVendors, aiLikelihood } from '../src/vendors.js';
import { classifyRequests } from '../src/trackers.js';

const FIXTURES = path.join(path.dirname(fileURLToPath(import.meta.url)), 'fixtures');

let server;
let clean;
let leaky;

before(async () => {
  server = http.createServer(async (req, res) => {
    try {
      const name = path.basename(new URL(req.url, 'http://127.0.0.1').pathname);
      res.writeHead(200, { 'content-type': 'text/html; charset=utf-8' });
      res.end(await fs.readFile(path.join(FIXTURES, name)));
    } catch {
      res.writeHead(404);
      res.end('not found');
    }
  });

  // Port 0 lets the OS pick a free port, so a suite killed mid-run never leaves a stale
  // listener that fails the next run with EADDRINUSE.
  await new Promise((resolve, reject) => {
    server.once('error', reject);
    server.listen(0, '127.0.0.1', resolve);
  });

  const base = `http://127.0.0.1:${server.address().port}`;

  // Each scan drives three full browser passes, so scan once here and assert many times
  // below rather than paying that cost per assertion. Fixtures fire synchronously, so
  // they need nowhere near the production settle window.
  clean = await scanConsent(`${base}/clean-shop.html`, { settleMs: 1200 });
  leaky = await scanConsent(`${base}/leaky-shop.html`, { settleMs: 1200 });
});

after(() => server?.close());

test('a compliant site produces no findings', () => {
  assert.deepEqual(clean.findings, [], 'clean fixture must not generate any accusation');
  assert.equal(clean.riskScore, 0);
});

test('the reject control is found on a well-built banner', () => {
  assert.equal(clean.passes.afterReject.rejectClicked, true);
});

test('pre-consent tracker firing is detected', () => {
  const f = leaky.findings.find((x) => x.id === 'PRE_CONSENT');
  assert.ok(f, 'expected a PRE_CONSENT finding');
  assert.ok(f.trackers.includes('Meta Pixel'));
  assert.ok(f.trackers.includes('Hotjar'), 'session replay drives most CIPA filings');
});

test('trackers ignoring Global Privacy Control are detected', () => {
  const f = leaky.findings.find((x) => x.id === 'GPC_IGNORED');
  assert.ok(f, 'expected a GPC_IGNORED finding');
  assert.equal(f.severity, 'critical');
});

test('trackers firing after the reject click are detected', () => {
  // Regression guard for the request-buffer race. The banner's reject handler fires its
  // pixels synchronously on click, so clearing the buffer *after* clicking silently
  // dropped the single most damaging finding the engine produces.
  const f = leaky.findings.find((x) => x.id === 'REJECT_IGNORED');
  assert.ok(f, 'expected a REJECT_IGNORED finding');
  assert.ok(f.trackers.includes('Meta Pixel'));
});

test('the consent platform in use is identified', () => {
  assert.deepEqual(leaky.cmp, ['OneTrust']);
});

test('classification separates trackers from consent platforms', () => {
  const { trackers, cmps } = classifyRequests([
    'https://www.facebook.com/tr?id=1',
    'https://cdn.cookielaw.org/otSDKStub.js',
    'https://example.com/logo.png',
  ]);
  assert.equal(trackers.length, 1);
  assert.equal(trackers[0].name, 'Meta Pixel');
  assert.equal(cmps[0].name, 'OneTrust');
});

test('classification ignores ordinary first-party assets', () => {
  const { trackers } = classifyRequests([
    'https://shop.example.com/css/app.css',
    'https://shop.example.com/api/cart',
  ]);
  assert.equal(trackers.length, 0);
});

test('plain first-person AI disclosure passes', () => {
  const r = assessDisclosure("Hi! I'm an AI assistant, how can I help?", { aiConfidence: 'always' });
  assert.equal(r.verdict, VERDICT.DISCLOSED);
});

test('a known AI agent with no disclosure fails', () => {
  const r = assessDisclosure('Hello! How can I help you today?', { aiConfidence: 'always' });
  assert.equal(r.verdict, VERDICT.NOT_DISCLOSED);
});

test('human live chat is never called a violation', () => {
  // Article 50(1) covers AI systems. A human-staffed chat is out of scope, and flagging
  // one would be exactly the false positive that kills a deal.
  const r = assessDisclosure('Leave a message and our team will reply shortly.', {
    aiConfidence: 'human',
  });
  assert.equal(r.verdict, VERDICT.NEEDS_REVIEW);
});

test('an incidental mention of AI is not treated as disclosure', () => {
  const r = assessDisclosure('Ask about our AI analytics platform.', { aiConfidence: 'usually' });
  assert.equal(r.verdict, VERDICT.NEEDS_REVIEW);
});

test('no captured copy yields no claim', () => {
  const r = assessDisclosure('', { aiConfidence: 'always' });
  assert.equal(r.verdict, VERDICT.NO_EVIDENCE);
});

test('a purpose-built AI agent is recognised', () => {
  const v = identifyVendors('<script src="https://static.ada.support/embed.js">');
  assert.equal(v[0].id, 'ada');
  assert.equal(aiLikelihood(v), 3);
});

test('human live chat vendors rate lowest for AI likelihood', () => {
  const v = identifyVendors('https://embed.tawk.to/abc');
  assert.equal(aiLikelihood(v), 0);
});
