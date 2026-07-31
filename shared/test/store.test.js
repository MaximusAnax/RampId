/**
 * Regression tests for the scan history store.
 *
 * The retainer is the recurring-revenue product, so the properties asserted here are the
 * ones a client's evidence timeline depends on: a scan comes back exactly as it went in,
 * ordering is chronological and stable, the baseline a monitoring diff compares against is
 * the right record, retention cannot silently delete everything, and a hostile target
 * string cannot write outside the data root.
 *
 * Run: npm test
 */

import { test, before, after, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';

import {
  createStore,
  slugifyTarget,
  targetDirectory,
  StoreError,
} from '../src/store.js';

let sandbox;
let root;
let store;

/** Shaped like a real scanConsent() result, so the round-trip proves nested data survives. */
const scanFixture = (scannedAt, { riskScore = 45 } = {}) => ({
  url: 'https://shop.example.com/',
  scannedAt,
  durationMs: 21403,
  cmp: ['OneTrust'],
  passes: {
    baseline: {
      trackerCount: 2,
      trackers: [
        {
          name: 'Meta Pixel',
          category: 'ad-pixel',
          severity: 'critical',
          evidence: 'Transmits page and event data to Meta, keyed to a user identifier.',
          sample: 'https://www.facebook.com/tr?id=123&ev=PageView',
        },
        {
          name: 'Hotjar',
          category: 'session-replay',
          severity: 'critical',
          evidence: 'Captures session recordings and heatmaps of user interaction.',
          sample: 'https://static.hotjar.com/c/hotjar-123.js',
        },
      ],
      requestCount: 64,
      error: null,
    },
    gpc: { trackerCount: 1, trackers: [], requestCount: 61, error: null },
    afterReject: {
      trackerCount: 1,
      trackers: [],
      requestCount: 12,
      error: null,
      rejectClicked: true,
    },
  },
  findings: [
    {
      id: 'PRE_CONSENT',
      severity: 'critical',
      title: '2 third-party tracker(s) fired before any consent interaction',
      detail: 'A consent platform is deployed, yet these trackers transmitted first.',
      trackers: ['Meta Pixel', 'Hotjar'],
    },
  ],
  riskScore,
  errors: [],
});

before(async () => {
  sandbox = await fs.mkdtemp(path.join(os.tmpdir(), 'rampid-store-'));
});

after(async () => {
  await fs.rm(sandbox, { recursive: true, force: true });
});

beforeEach(async () => {
  // A fresh, deliberately non-existent root per test: every test therefore also exercises
  // the first-run case, which is the one that has to work with zero setup.
  root = path.join(sandbox, `store-${Math.random().toString(36).slice(2, 10)}`, 'data');
  store = createStore(root);
});

test('a scan round-trips through disk unchanged', async () => {
  const scan = scanFixture('2026-07-30T09:15:00.000Z');
  const saved = await store.saveScan('https://shop.example.com/', scan);

  assert.equal(saved.slug, 'shop.example.com');
  assert.equal(saved.scannedAt, '2026-07-30T09:15:00.000Z');
  assert.equal(path.basename(saved.file), '2026-07-30T09-15-00-000Z.json');

  const latest = await store.getLatest('https://shop.example.com/');
  assert.deepEqual(latest.scan, scan, 'the stored evidence must come back byte-identical');
  assert.equal(latest.target, 'https://shop.example.com/');
  assert.equal(latest.scan.passes.baseline.trackers[0].sample, scan.passes.baseline.trackers[0].sample);
});

test('an empty store answers every read without throwing', async () => {
  assert.deepEqual(await store.listTargets(), []);
  assert.deepEqual(await store.getHistory('example.com'), []);
  assert.equal(await store.getLatest('example.com'), null);
  assert.equal(await store.getPrevious('example.com'), null);
  assert.equal(await store.getTargetMeta('example.com'), null);
});

test('history is returned newest first', async () => {
  for (const stamp of [
    '2026-05-01T10:00:00.000Z',
    '2026-07-01T10:00:00.000Z',
    '2026-06-01T10:00:00.000Z',
  ]) {
    await store.saveScan('shop.example.com', scanFixture(stamp));
  }

  const history = await store.getHistory('shop.example.com');
  assert.deepEqual(
    history.map((record) => record.scannedAt),
    ['2026-07-01T10:00:00.000Z', '2026-06-01T10:00:00.000Z', '2026-05-01T10:00:00.000Z']
  );
});

test('history honours a limit', async () => {
  for (const stamp of ['2026-05-01T10:00:00.000Z', '2026-06-01T10:00:00.000Z', '2026-07-01T10:00:00.000Z']) {
    await store.saveScan('shop.example.com', scanFixture(stamp));
  }

  const history = await store.getHistory('shop.example.com', { limit: 2 });
  assert.equal(history.length, 2);
  assert.equal(history[0].scannedAt, '2026-07-01T10:00:00.000Z');
});

test('getPrevious returns the second-newest scan', async () => {
  // This is the record every monitoring diff is measured against. Returning the newest, or
  // an arbitrary older one, would report drift that never happened.
  await store.saveScan('shop.example.com', scanFixture('2026-05-01T10:00:00.000Z', { riskScore: 10 }));
  await store.saveScan('shop.example.com', scanFixture('2026-06-01T10:00:00.000Z', { riskScore: 45 }));
  await store.saveScan('shop.example.com', scanFixture('2026-07-01T10:00:00.000Z', { riskScore: 75 }));

  const previous = await store.getPrevious('shop.example.com');
  assert.equal(previous.scannedAt, '2026-06-01T10:00:00.000Z');
  assert.equal(previous.scan.riskScore, 45);
});

test('getPrevious is null until a second scan exists', async () => {
  await store.saveScan('shop.example.com', scanFixture('2026-07-01T10:00:00.000Z'));
  assert.equal(await store.getPrevious('shop.example.com'), null);
});

test('two scans sharing a timestamp both survive', async () => {
  // A re-run inside the same millisecond must not overwrite the earlier record. Losing
  // evidence to a file-name collision is silent and unrecoverable.
  const stamp = '2026-07-30T09:15:00.000Z';
  const first = await store.saveScan('shop.example.com', scanFixture(stamp, { riskScore: 30 }));
  const second = await store.saveScan('shop.example.com', scanFixture(stamp, { riskScore: 60 }));

  assert.notEqual(first.file, second.file);
  const history = await store.getHistory('shop.example.com');
  assert.equal(history.length, 2);
  assert.deepEqual(history.map((r) => r.scan.riskScore).sort(), [30, 60]);
});

test('pruneHistory keeps the newest scans and deletes the rest', async () => {
  for (const stamp of [
    '2026-04-01T10:00:00.000Z',
    '2026-05-01T10:00:00.000Z',
    '2026-06-01T10:00:00.000Z',
    '2026-07-01T10:00:00.000Z',
  ]) {
    await store.saveScan('shop.example.com', scanFixture(stamp));
  }

  const result = await store.pruneHistory('shop.example.com', 2);
  assert.equal(result.kept, 2);
  assert.equal(result.removed.length, 2);

  const history = await store.getHistory('shop.example.com');
  assert.deepEqual(
    history.map((record) => record.scannedAt),
    ['2026-07-01T10:00:00.000Z', '2026-06-01T10:00:00.000Z']
  );

  // Pruning must never take the target's metadata with it.
  const meta = await store.getTargetMeta('shop.example.com');
  assert.equal(meta.firstSeen, '2026-04-01T10:00:00.000Z');
});

test('pruneHistory is a no-op when there is less history than the retention count', async () => {
  await store.saveScan('shop.example.com', scanFixture('2026-07-01T10:00:00.000Z'));
  const result = await store.pruneHistory('shop.example.com', 5);
  assert.equal(result.kept, 1);
  assert.deepEqual(result.removed, []);
});

test('pruneHistory refuses a retention count that would erase everything', async () => {
  await store.saveScan('shop.example.com', scanFixture('2026-07-01T10:00:00.000Z'));

  for (const bad of [0, -1, undefined, Number.NaN, 1.5, '3']) {
    await assert.rejects(
      () => store.pruneHistory('shop.example.com', bad),
      (err) => err instanceof StoreError && err.code === 'INVALID_RETENTION',
      `keepCount ${JSON.stringify(bad)} must be refused, not clamped`
    );
  }

  assert.equal((await store.getHistory('shop.example.com')).length, 1);
});

test('a path traversal target is rejected and writes nothing', async () => {
  // Materialise the root first, so the emptiness assertions below distinguish "the guard
  // held" from "nothing existed to look at".
  await fs.mkdir(root, { recursive: true });

  const hostile = [
    '../../etc/passwd',
    '..',
    '/etc/passwd',
    '..\\..\\windows\\system32',
    'https://../../etc/passwd',
    '%2e%2e/foo',
    '',
  ];

  for (const target of hostile) {
    await assert.rejects(
      () => store.saveScan(target, scanFixture('2026-07-01T10:00:00.000Z')),
      (err) => err instanceof StoreError && err.code === 'UNSAFE_TARGET',
      `${JSON.stringify(target)} must not be accepted as a target`
    );
    assert.throws(() => targetDirectory(target, { root }), StoreError);
  }

  // The guard is only real if nothing appeared outside the root. The root's own parent is
  // where a "../" escape would land.
  const rootPath = path.resolve(root);
  assert.deepEqual(await fs.readdir(rootPath), [], 'a rejected target must write nothing');
  assert.deepEqual(
    await fs.readdir(path.dirname(rootPath)),
    [path.basename(rootPath)],
    'a rejected target must not create anything beside the data root'
  );
});

test('a target with no host of its own is refused, not filed under its scheme', async () => {
  // These parse as URLs but carry no authority at all, so reading them as bare hosts would
  // mistake the scheme for a host name and open an evidence timeline for "file", "b.com" or
  // "c" — a company nobody asked to be scanned.
  for (const target of ['file:///etc/passwd', 'mailto:privacy@example.com', 'C:\\evidence\\x', 'data:text/html,hi']) {
    assert.throws(
      () => slugifyTarget(target),
      (err) => err instanceof StoreError && err.code === 'UNSAFE_TARGET',
      `${JSON.stringify(target)} names no host and must be refused`
    );
  }

  // A bare host with a port looks the same to URL() — protocol "example.com:", no
  // authority — and must still be accepted, with a directory name a human can read.
  assert.equal(slugifyTarget('example.com:8080'), 'example.com-8080');
  assert.equal(slugifyTarget('example.com:8080/pricing'), 'example.com-8080');
});

test('hosts that differ only in punctuation keep separate histories', async () => {
  // "[::1]" and "[1::]" are different machines. Flattening both to "1" would file one
  // client's evidence in the other's directory and make a monitoring diff compare a host
  // against a host it has never seen.
  assert.notEqual(slugifyTarget('http://[::1]'), slugifyTarget('http://[1::]'));
  assert.notEqual(
    slugifyTarget('http://[2001:db8::1]'),
    slugifyTarget('http://[2001:db8::2]')
  );

  await store.saveScan('http://[::1]', scanFixture('2026-07-01T10:00:00.000Z', { riskScore: 11 }));
  await store.saveScan('http://[1::]', scanFixture('2026-07-01T10:00:00.000Z', { riskScore: 22 }));

  assert.equal((await store.getHistory('http://[::1]')).length, 1);
  assert.equal((await store.getLatest('http://[::1]')).scan.riskScore, 11);
  assert.equal((await store.getLatest('http://[1::]')).scan.riskScore, 22);
  assert.equal((await store.listTargets()).length, 2);

  // A trailing root dot is the same host, though, and must not fork the timeline.
  assert.equal(slugifyTarget('https://example.com./x'), slugifyTarget('https://example.com/x'));
});

test('every stored path stays directly under the data root', async () => {
  const rootPath = path.resolve(root);
  for (const target of ['https://shop.example.com/a/b', 'example.com/pricing', 'http://127.0.0.1:8080/x']) {
    const directory = targetDirectory(target, { root });
    assert.equal(path.dirname(directory), rootPath);
  }
});

test('slugs separate hosts that can serve different configurations', async () => {
  assert.equal(slugifyTarget('https://shop.example.com/checkout?a=1'), 'shop.example.com');
  assert.equal(slugifyTarget('SHOP.EXAMPLE.COM'), 'shop.example.com');
  assert.notEqual(slugifyTarget('www.example.com'), slugifyTarget('example.com'));
  assert.notEqual(slugifyTarget('http://127.0.0.1:8080'), slugifyTarget('http://127.0.0.1:9090'));
});

test('target metadata merges rather than overwrites', async () => {
  await store.saveScan('shop.example.com', scanFixture('2026-04-01T10:00:00.000Z'));

  await store.saveTargetMeta('shop.example.com', {
    companyName: 'Example Retail Inc.',
    tier: 'monitoring',
    monitoringEnabled: true,
  });
  await store.saveTargetMeta('shop.example.com', { contactNotes: 'Intro via privacy counsel.' });

  const meta = await store.getTargetMeta('shop.example.com');
  assert.equal(meta.companyName, 'Example Retail Inc.', 'an unrelated write must not drop this');
  assert.equal(meta.tier, 'monitoring');
  assert.equal(meta.monitoringEnabled, true);
  assert.equal(meta.contactNotes, 'Intro via privacy counsel.');
  assert.equal(meta.firstSeen, '2026-04-01T10:00:00.000Z');
});

test('firstSeen anchors to the earliest scan and later scans do not move it', async () => {
  await store.saveScan('shop.example.com', scanFixture('2026-04-01T10:00:00.000Z'));
  await store.saveScan('shop.example.com', scanFixture('2026-07-01T10:00:00.000Z'));

  const meta = await store.getTargetMeta('shop.example.com');
  assert.equal(meta.firstSeen, '2026-04-01T10:00:00.000Z');
  assert.equal(meta.lastScanAt, '2026-07-01T10:00:00.000Z');
});

test('backfilling an older scan does not move the last-scanned marker backwards', async () => {
  await store.saveScan('shop.example.com', scanFixture('2026-07-01T10:00:00.000Z'));
  await store.saveScan('shop.example.com', scanFixture('2026-01-01T10:00:00.000Z'));

  const meta = await store.getTargetMeta('shop.example.com');
  assert.equal(meta.lastScanAt, '2026-07-01T10:00:00.000Z');
});

test('monitoring is off until a target is explicitly opted in', async () => {
  await store.saveScan('shop.example.com', scanFixture('2026-07-01T10:00:00.000Z'));
  const meta = await store.getTargetMeta('shop.example.com');
  assert.equal(meta.monitoringEnabled, false);
});

test('listTargets summarises every stored target', async () => {
  await store.saveScan('https://shop.example.com/', scanFixture('2026-06-01T10:00:00.000Z'));
  await store.saveScan('https://shop.example.com/', scanFixture('2026-07-01T10:00:00.000Z'));
  await store.saveScan('clinic.example.org', scanFixture('2026-07-02T10:00:00.000Z'));
  await store.saveTargetMeta('clinic.example.org', { companyName: 'Example Clinic' });

  const targets = await store.listTargets();
  assert.deepEqual(targets.map((t) => t.slug), ['clinic.example.org', 'shop.example.com']);

  const shop = targets.find((t) => t.slug === 'shop.example.com');
  assert.equal(shop.scanCount, 2);
  assert.equal(shop.latestScanAt, '2026-07-01T10:00:00.000Z');
  // The original target string round-trips, so a caller can feed it straight back in.
  assert.equal(shop.target, 'https://shop.example.com/');
  assert.deepEqual(await store.getHistory(shop.target, { limit: 1 }), [
    await store.getLatest('shop.example.com'),
  ]);

  const clinic = targets.find((t) => t.slug === 'clinic.example.org');
  assert.equal(clinic.meta.companyName, 'Example Clinic');
});

test('a corrupt record is reported rather than skipped', async () => {
  // Silently dropping an unreadable scan would make a monitoring diff compare against the
  // wrong baseline and report drift to a client that never occurred.
  const saved = await store.saveScan('shop.example.com', scanFixture('2026-07-01T10:00:00.000Z'));
  await fs.writeFile(saved.file, '{"scan": truncated', 'utf8');

  await assert.rejects(
    () => store.getHistory('shop.example.com'),
    (err) => err instanceof StoreError && err.code === 'CORRUPT_RECORD'
  );
});

test('saving something that is not a scan result is refused', async () => {
  for (const bad of [null, undefined, 'a scan', 42, []]) {
    await assert.rejects(
      () => store.saveScan('shop.example.com', bad),
      (err) => err instanceof StoreError && err.code === 'INVALID_SCAN'
    );
  }
});

test('a scan whose timestamp cannot be filed is refused rather than written invisibly', async () => {
  // Date.parse accepts an expanded year, and toISOString renders it as "+012026-…", which no
  // reader recognises as a scan file. Accepting it would report the save as successful and
  // then hide the record from getHistory, listTargets and every monitoring comparison —
  // a false negative created by the storage layer rather than by the site.
  for (const stamp of ['+012026-07-30T10:00:00.000Z', '-000001-01-01T00:00:00.000Z']) {
    await assert.rejects(
      () => store.saveScan('shop.example.com', scanFixture(stamp)),
      (err) => err instanceof StoreError && err.code === 'INVALID_SCAN',
      `${stamp} cannot be filed and must not be silently accepted`
    );
  }

  assert.deepEqual(await store.getHistory('shop.example.com'), []);
  assert.deepEqual(await store.listTargets(), []);
});

test('a temp file orphaned by a crashed write is invisible to every reader', async () => {
  // Durability rests on write-temp-then-rename, which means a process killed mid-write can
  // leave a partial file behind. It must never be read back as evidence.
  const saved = await store.saveScan('shop.example.com', scanFixture('2026-07-01T10:00:00.000Z'));
  const directory = path.dirname(saved.file);

  await fs.writeFile(path.join(directory, '.2026-07-02T10-00-00-000Z.json.999-deadbeef.tmp'), '{"scan":');
  await fs.writeFile(path.join(directory, '.meta.json.999-deadbeef.tmp'), '{"companyName":');
  await fs.writeFile(path.join(path.resolve(root), '.orphan.tmp'), 'x');

  const history = await store.getHistory('shop.example.com');
  assert.equal(history.length, 1, 'a partial write must not be read back as a scan');
  assert.equal(history[0].scannedAt, '2026-07-01T10:00:00.000Z');

  const targets = await store.listTargets();
  assert.deepEqual(targets.map((t) => t.slug), ['shop.example.com']);
  assert.equal(targets[0].scanCount, 1);
  assert.equal((await store.getTargetMeta('shop.example.com')).companyName, null);
});

test('a metadata field left undefined does not erase what is stored', async () => {
  // An operator screen saving a form with one field blank must not wipe the value someone
  // else set last month. An explicit null still clears, because that is an instruction.
  await store.saveTargetMeta('shop.example.com', {
    companyName: 'Example Retail Inc.',
    tier: 'monitoring',
    contactNotes: 'Intro via privacy counsel.',
  });
  await store.saveTargetMeta('shop.example.com', { tier: undefined, companyName: undefined });

  const kept = await store.getTargetMeta('shop.example.com');
  assert.equal(kept.tier, 'monitoring');
  assert.equal(kept.companyName, 'Example Retail Inc.');

  await store.saveTargetMeta('shop.example.com', { contactNotes: null });
  assert.equal((await store.getTargetMeta('shop.example.com')).contactNotes, null);
});

test('no temporary files are left behind after a write', async () => {
  await store.saveScan('shop.example.com', scanFixture('2026-07-01T10:00:00.000Z'));
  const entries = await fs.readdir(path.join(path.resolve(root), 'shop.example.com'));
  assert.deepEqual(entries.sort(), ['2026-07-01T10-00-00-000Z.json', 'meta.json']);
});
