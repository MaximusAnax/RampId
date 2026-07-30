/**
 * Tests for consent-platform detection and the hybrid request classifier.
 *
 * The fixtures under test/fixtures/real reproduce the markup that real consent managers
 * actually render — the class names were extracted from the shipped CSS of OneTrust-style
 * markup, Klaro and vanilla-cookieconsent rather than invented. That matters: testing
 * against hand-written banners is what let a false positive through in the first place.
 * The scanner reported "no consent management platform detected" for any self-hosted
 * consent manager, because those serve from the site's own domain and make no third-party
 * request for a network signature to match.
 */

import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { scanConsent } from '../src/consent.js';
import { classifyRequest, classifyAll } from '../src/entities.js';
import { REJECT_LABELS, DOM_SIGNATURES } from '../src/cmp.js';

const REAL = path.join(path.dirname(fileURLToPath(import.meta.url)), 'fixtures', 'real');

let server;
let base;
const scans = {};

before(async () => {
  server = http.createServer(async (req, res) => {
    try {
      const name = path.basename(new URL(req.url, 'http://127.0.0.1').pathname);
      res.writeHead(200, { 'content-type': 'text/html; charset=utf-8' });
      res.end(await fs.readFile(path.join(REAL, name)));
    } catch {
      res.writeHead(404);
      res.end('not found');
    }
  });
  await new Promise((r) => server.listen(0, '127.0.0.1', r));
  base = `http://127.0.0.1:${server.address().port}`;

  for (const name of ['onetrust-like', 'selfhosted-klaro', 'custom-banner']) {
    scans[name] = await scanConsent(`${base}/${name}.html`, { settleMs: 1500 });
  }
});

after(() => server?.close());

test('a hosted platform is identified from its rendered markup', () => {
  assert.ok(scans['onetrust-like'].cmp.includes('OneTrust'));
});

test('a self-hosted consent manager is identified despite making no third-party request', () => {
  // The regression guard for the original false positive. Klaro serves from the site's own
  // domain, so there is no network signature to match and detection must come from the DOM.
  const scan = scans['selfhosted-klaro'];
  assert.ok(scan.cmp.length > 0, 'expected a consent platform to be identified');
  assert.ok(scan.cmp.some((c) => /klaro/i.test(c)));
});

test('a self-hosted consent manager never yields a "no consent mechanism" claim', () => {
  const ids = scans['selfhosted-klaro'].findings.map((f) => f.id);
  assert.ok(!ids.includes('NO_CMP'), 'must not claim there is no consent mechanism');
});

test('a bespoke banner with no recognisable signature is still treated as a consent mechanism', () => {
  // A site can roll its own banner. Claiming it has no consent mechanism is a factual error
  // the reader disproves in five seconds, which discredits the whole report.
  const scan = scans['custom-banner'];
  assert.equal(scan.bannerVisible, true);
  assert.ok(!scan.findings.map((f) => f.id).includes('NO_CMP'));
});

test('a reject control is found across differing platform conventions', () => {
  for (const name of ['onetrust-like', 'selfhosted-klaro', 'custom-banner']) {
    assert.equal(
      scans[name].passes.afterReject.rejectClicked,
      true,
      `expected to find a reject control on ${name}`
    );
  }
});

test('trackers firing after reject are caught on real platform markup', () => {
  const ids = scans['onetrust-like'].findings.map((f) => f.id);
  assert.ok(ids.includes('REJECT_IGNORED'));
});

test('reject labels prefer the explicit reject-all form over a bare reject', () => {
  // Order matters: several platforms render both a full reject and a narrower option, and
  // clicking the narrower one produces a partial opt-out that would then be misreported as
  // a full rejection being ignored.
  const rejectAll = REJECT_LABELS.findIndex((r) => r.test('Reject all'));
  const bareReject = REJECT_LABELS.findIndex((r) => String(r) === String(/^reject$/i));
  assert.ok(rejectAll < bareReject, 'reject-all must be matched before bare reject');
});

test('every DOM signature declares at least one selector', () => {
  for (const sig of DOM_SIGNATURES) {
    assert.ok(sig.selectors.length > 0, `${sig.id} has no selectors`);
    assert.ok(sig.name, `${sig.id} has no display name`);
  }
});

test('curated entries win over the broad dataset and keep their severity', () => {
  const hit = classifyRequest('https://static.hotjar.com/c/hotjar-1.js', 'shop.example.com');
  assert.equal(hit.source, 'curated');
  assert.equal(hit.severity, 'critical');
  assert.equal(hit.category, 'session-replay');
});

test('the broad dataset catches services absent from the curated list', () => {
  const hit = classifyRequest('https://js.klaviyo.com/onsite.js', 'shop.example.com');
  assert.ok(hit, 'expected the broad dataset to classify Klaviyo');
  assert.equal(hit.source, 'third-party-web');
});

test('first-party requests are never reported as third-party trackers', () => {
  assert.equal(classifyRequest('https://shop.example.com/api/cart', 'shop.example.com'), null);
  assert.equal(classifyRequest('https://www.shop.example.com/x.js', 'shop.example.com'), null);
});

test('CDN and font requests are excluded as noise', () => {
  // Reporting a font CDN as a privacy finding buries the signal that matters under noise
  // the reader will dismiss, taking the credible findings down with it.
  assert.equal(classifyRequest('https://fonts.gstatic.com/s/x.woff2', 'shop.example.com'), null);
  assert.equal(classifyRequest('https://cdn.shopify.com/s/files/logo.png', 'shop.example.com'), null);
});

test('classification sorts most severe first and deduplicates by service', () => {
  const { trackers } = classifyAll(
    [
      'https://www.google-analytics.com/collect?v=1',
      'https://www.facebook.com/tr?id=1',
      'https://www.facebook.com/tr?id=2',
      'https://static.hotjar.com/c/h.js',
    ],
    { pageHost: 'shop.example.com' }
  );
  assert.equal(trackers.length, 3, 'the two Meta requests must collapse to one service');
  assert.equal(trackers[0].severity, 'critical');
  const meta = trackers.find((t) => t.name === 'Meta Pixel');
  assert.equal(meta.requests.length, 2, 'both sample URLs should be retained as evidence');
});

test('malformed and non-http URLs are ignored rather than throwing', () => {
  assert.equal(classifyRequest('', 'x.com'), null);
  assert.equal(classifyRequest('data:text/html,hi', 'x.com'), null);
  assert.equal(classifyRequest('about:blank', 'x.com'), null);
  assert.equal(classifyRequest('not a url at all', 'x.com'), null);
});

test('a tag that signals consent denied is not reported as a finding', () => {
  // Google Consent Mode and Meta Limited Data Use are designed so a tag can fire while
  // transmitting that consent was denied. That is compliant behaviour. Reporting it as a
  // violation is the fastest way to be dismissed by the engineer asked to check the claim,
  // and Privado found 48% of top sites misconfigure Consent Mode — so distinguishing
  // correctly-configured from misconfigured is the whole value of this check.
  const r = classifyAll(
    [
      'https://www.google-analytics.com/g/collect?v=2&gcs=G100&gcd=11p1p1p1',
      'https://www.facebook.com/tr?id=1&ev=PageView&dpo=LDU&dpoco=1&dpost=1000',
      'https://analytics.tiktok.com/i18n/pixel/events.js?sdkid=1',
    ],
    { pageHost: 'shop.example.com' }
  );

  const restrained = r.restrained.map((t) => t.name);
  assert.ok(restrained.includes('Google Analytics'));
  assert.ok(restrained.includes('Meta Pixel'));

  const reportable = r.reportable.map((t) => t.name);
  assert.deepEqual(reportable, ['TikTok Pixel'], 'only the unsignalled tag is reportable');
});

test('one unsignalled request makes a service reportable', () => {
  // Partial configuration is the common real-world case: a tag correctly restricted on one
  // route and not on another. The unrestricted request is the one that matters.
  const r = classifyAll(
    [
      'https://www.google-analytics.com/g/collect?v=2&gcs=G100',
      'https://www.google-analytics.com/g/collect?v=2&cid=abc',
    ],
    { pageHost: 'shop.example.com' }
  );
  assert.equal(r.reportable.length, 1);
  assert.equal(r.restrained.length, 0);
});
