/**
 * Tests for the unified multi-regulation assessment.
 *
 * The property under test is architectural rather than behavioural: that the crawler is
 * the asset and the regulation is a template on top of it. Six major compliance deadlines
 * moved between April and July 2026, so a business welded to one statute is one omnibus
 * bill from having no product. These tests exist to stop that coupling creeping back in.
 */

import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';

import { assess, groupByBasis, MODULES } from '../src/assess.js';

const PAGE = `<!doctype html><html><head><title>Northgate Bank</title></head><body>
<h1>Northgate Bank</h1>
<script src="https://static.ada.support/embed.js"></script>
<div id="onetrust-banner-sdk" style="position:fixed;bottom:0"><p>We use cookies.</p>
<button id="onetrust-accept-btn-handler">Accept All</button>
<button id="onetrust-reject-all-handler">Reject All</button></div>
<div id="launcher" role="button" onclick="document.getElementById('p').style.display='block'">Need help?</div>
<div id="p" class="chat-window" style="display:none"><div role="log">
<p>Hello! Welcome to Northgate Bank support.</p><p>How can I help you today?</p></div></div>
<script>new Image().src='https://analytics.tiktok.com/i18n/pixel/e.js?id=1';</script>
</body></html>`;

let server;
let url;
let both;

before(async () => {
  server = http.createServer((req, res) => {
    res.writeHead(200, { 'content-type': 'text/html; charset=utf-8' });
    res.end(PAGE);
  });
  await new Promise((r) => server.listen(0, '127.0.0.1', r));
  url = `http://127.0.0.1:${server.address().port}/x.html`;
  both = await assess(url, { settleMs: 1500 });
});

after(() => server?.close());

test('one page yields findings under two independent regulations', () => {
  const bases = new Set(both.findings.map((f) => f.basis));
  assert.ok(bases.size >= 2, `expected findings under multiple rules, got ${[...bases]}`);
});

test('every finding is attributed to the rule it reports against', () => {
  for (const f of both.findings) {
    assert.ok(f.module, 'finding must name its module');
    assert.ok(f.basis, 'finding must name its legal basis');
  }
});

test('findings group cleanly by legal basis', () => {
  const groups = groupByBasis(both);
  assert.ok(groups.length >= 2);
  for (const g of groups) {
    assert.ok(g.findings.length > 0);
    assert.ok(g.findings.every((f) => f.basis === g.basis));
  }
});

test('a single module can be run in isolation', () => {
  // A client who only cares about one rule should be able to buy only that, which is what
  // makes the regulation swappable rather than merely bundled.
  return assess(url, { modules: ['consent'], settleMs: 1200 }).then((r) => {
    assert.deepEqual(r.modules, ['consent']);
    assert.ok(r.findings.every((f) => f.module === 'consent'));
    assert.equal(r.results.ai50, undefined);
  });
});

test('an unknown module is rejected rather than silently ignored', async () => {
  // Silently skipping an unrecognised module would produce a report missing a section the
  // client was told it would contain, with nothing to indicate the omission.
  await assert.rejects(() => assess(url, { modules: ['nope'] }), /unknown assessment module/);
});

test('the combined score stays on the same scale as a single module', () => {
  assert.ok(both.score <= 100, 'score must not exceed the scale the ranking is calibrated on');
  assert.ok(both.score > 0);
});

test('every registered module declares a basis and a title', () => {
  for (const [id, m] of Object.entries(MODULES)) {
    assert.ok(m.basis, `${id} must declare the rule it reports against`);
    assert.ok(m.title, `${id} must declare a title`);
    assert.equal(typeof m.run, 'function');
    assert.equal(typeof m.findings, 'function');
  }
});

test('an ambiguous AI-disclosure result never becomes a finding', () => {
  // Article 50(1) covers AI systems. A human-staffed chat is out of scope, and an
  // unopenable widget is missing evidence rather than a violation. Both must resolve to
  // no finding, because an ambiguous result reading as an accusation is the failure mode
  // that destroys credibility.
  const ai50 = MODULES.ai50;
  for (const verdict of ['NEEDS_REVIEW', 'NO_EVIDENCE', 'DISCLOSED']) {
    const findings = ai50.findings({ assessment: { verdict, reason: 'x', confidence: 0.9 } });
    assert.deepEqual(findings, [], `${verdict} must not produce a finding`);
  }
});
