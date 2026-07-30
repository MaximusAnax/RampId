import fs from 'node:fs/promises';
import path from 'node:path';
import { createHash, randomUUID } from 'node:crypto';

/**
 * Scan history persistence.
 *
 * The monitoring retainer is the recurring-revenue product, and it only works if a scan
 * recorded three months ago is still readable and still trustworthy today. That makes
 * durability, not throughput, the constraint this module is designed around.
 *
 * Plain JSON files, no database. Zero setup is a commercial property rather than a
 * convenience: the engine has to run from a laptop, a cron box, or a fresh container with
 * nothing provisioned, and a client's evidence history has to survive being copied around
 * as an ordinary folder or handed to their counsel as a zip.
 *
 * Layout:
 *   <root>/<slug>/2026-07-30T20-14-02-123Z.json   one scan, written once, never edited
 *   <root>/<slug>/meta.json                       who the target is and how we serve them
 *
 * Two rules the code cannot show on its own:
 *
 *   1. Every write lands in a temp file, is flushed, then renamed over the destination.
 *      A process killed mid-write must leave the previous history intact rather than a
 *      truncated file — a scan that reads as "no trackers observed" because it was
 *      half-written is a false negative manufactured by the storage layer.
 *   2. A target string is untrusted input. It arrives from a CLI argument, a CSV of
 *      prospects, or a scheduler config, and it is used to build a path. The traversal
 *      guard below is a security boundary, not tidiness.
 *
 * The concurrency model is one writer per store, which is what a scheduler running scans
 * through a pool provides. Scan records are write-once and safe regardless, but meta.json
 * is read-modify-write: two processes updating the same target's metadata at the same
 * instant can lose one of the two edits. Reads are safe at any time, from any number of
 * processes, because a reader only ever sees a fully written file.
 */

/** Relative by default, resolved against the working directory of whatever invokes it. */
export const DEFAULT_DATA_ROOT = process.env.A50_DATA_DIR || 'data';

const META_FILE = 'meta.json';

/** Fixed-width UTC stamp, so a lexicographic sort of file names is a chronological sort. */
const SCAN_FILE_PATTERN = /^\d{4}-\d{2}-\d{2}T\d{2}-\d{2}-\d{2}-\d{3}Z\.json$/;

const MAX_SLUG_LENGTH = 64;

/**
 * Fields an operator owns. They are merged in on read as well as write so callers never
 * have to branch on undefined. `monitoringEnabled` defaults to false because a target must
 * be opted into recurring scanning deliberately — a default of true would quietly start
 * scanning, and billing for, every company that was ever assessed once.
 */
const DEFAULT_META = {
  companyName: null,
  contactNotes: null,
  tier: null,
  monitoringEnabled: false,
};

export class StoreError extends Error {
  constructor(code, message) {
    super(message);
    this.name = 'StoreError';
    this.code = code;
  }
}

/**
 * Reduce a target to one safe directory name.
 *
 * Accepts a full URL or a bare host. The port is kept, so a staging site on :8443 keeps a
 * separate timeline instead of merging into the production host's history — they run
 * different tag configurations and comparing across them would produce invented changes.
 *
 * `www.example.com` and `example.com` are also kept apart, for the same reason: they can
 * serve different consent configurations and are worth reporting on separately.
 */
export function slugifyTarget(target) {
  const raw = String(target ?? '').trim();
  if (!raw) {
    throw new StoreError('UNSAFE_TARGET', 'A target is required.');
  }
  if (raw.includes('\0')) {
    throw new StoreError('UNSAFE_TARGET', `Target contains a null byte: ${JSON.stringify(raw)}`);
  }

  const candidate = resolveHost(raw);

  // Rejected rather than sanitised. Rewriting "../../etc/passwd" into a tidy name would
  // keep the store safe but would file the scan under a target nobody asked for, and
  // evidence stored against the wrong company is worse than a loud failure.
  if (!candidate || candidate.includes('..') || /[\\/]/.test(candidate)) {
    throw new StoreError(
      'UNSAFE_TARGET',
      `Target is not a usable host name: ${JSON.stringify(raw)}`
    );
  }

  // Runs of dashes are left alone on purpose: URL punycodes an internationalised host to
  // "xn--mnchen-3ya.de", and collapsing that pair would corrupt the name and let two
  // distinct IDN hosts land in one directory.
  const slug = candidate
    .toLowerCase()
    .replace(/[^a-z0-9.-]+/g, '-')
    .replace(/\.{2,}/g, '.')
    .replace(/^[-.]+|[-.]+$/g, '');

  if (!slug) {
    throw new StoreError(
      'UNSAFE_TARGET',
      `Target reduces to an empty directory name: ${JSON.stringify(raw)}`
    );
  }
  if (slug.length <= MAX_SLUG_LENGTH) return slug;

  // Truncation with a digest of the full slug appended, so two very long hosts sharing a
  // 64-character prefix cannot end up writing into one another's history.
  const digest = createHash('sha1').update(slug).digest('hex').slice(0, 8);
  return `${slug.slice(0, MAX_SLUG_LENGTH).replace(/[-.]+$/, '')}-${digest}`;
}

/** Absolute directory holding one target's history. Never escapes the root. */
export function targetDirectory(target, { root = DEFAULT_DATA_ROOT } = {}) {
  const rootPath = path.resolve(root);
  const directory = path.resolve(rootPath, slugifyTarget(target));

  // Second, independent guard. slugifyTarget already refuses traversal tokens, but this is
  // the check that actually defines the boundary: a stored path must be a direct child of
  // the root, whatever the slug rules happen to do today or are changed to do later.
  if (path.dirname(directory) !== rootPath) {
    throw new StoreError(
      'UNSAFE_TARGET',
      `Target resolves outside the data root: ${JSON.stringify(String(target))}`
    );
  }
  return directory;
}

/**
 * Persist one scanConsent() result.
 *
 * The result is stored verbatim under `scan`, wrapped in an envelope carrying the target
 * and the timestamps. Nothing is normalised or trimmed on the way in: this is the evidence
 * record, and a future reader must see exactly what the engine produced.
 */
export async function saveScan(target, scanResult, { root = DEFAULT_DATA_ROOT } = {}) {
  if (!scanResult || typeof scanResult !== 'object') {
    throw new StoreError('INVALID_SCAN', 'saveScan requires a scan result object.');
  }

  const directory = targetDirectory(target, { root });
  const slug = path.basename(directory);
  const scannedAt = normaliseTimestamp(scanResult.scannedAt) ?? new Date().toISOString();

  const filePath = await reserveScanPath(directory, scannedAt);
  const record = {
    target: String(target),
    slug,
    scannedAt,
    savedAt: new Date().toISOString(),
    scan: scanResult,
  };

  await writeJsonAtomic(filePath, record);
  await touchTargetMeta(directory, { target: String(target), slug, scannedAt });

  // `file` is attached on the way out and deliberately not persisted: the root can be
  // moved or copied, and a stored absolute path would be wrong the moment it is.
  return { ...record, file: filePath };
}

/**
 * Every target with a directory under the root, newest-first history counts included.
 * Returns an empty array on a store that has never been written to.
 */
export async function listTargets({ root = DEFAULT_DATA_ROOT } = {}) {
  const rootPath = path.resolve(root);

  let entries;
  try {
    entries = await fs.readdir(rootPath, { withFileTypes: true });
  } catch (err) {
    if (err.code === 'ENOENT') return [];
    throw err;
  }

  const targets = [];
  for (const entry of entries) {
    if (!entry.isDirectory() || entry.name.startsWith('.')) continue;

    const directory = path.join(rootPath, entry.name);
    const fileNames = await listScanFileNames(directory);
    const meta = await readTargetMeta(directory);

    targets.push({
      slug: entry.name,
      // The original target string round-trips through meta, so a caller can feed this
      // straight back into getHistory() without reconstructing a URL from a slug.
      target: meta?.target ?? entry.name,
      directory,
      scanCount: fileNames.length,
      // Read from the file name rather than by opening every record, because the listing
      // is what a monitoring dashboard calls on every page load.
      latestScanAt: fileNames.length ? timestampFromFileName(fileNames[0]) : null,
      meta,
    });
  }

  return targets.sort((a, b) => a.slug.localeCompare(b.slug));
}

/** Stored scans for one target, newest first. Empty array if the target is unknown. */
export async function getHistory(
  target,
  { limit = Number.POSITIVE_INFINITY, root = DEFAULT_DATA_ROOT } = {}
) {
  const directory = targetDirectory(target, { root });
  const fileNames = await listScanFileNames(directory);
  const selected = Number.isFinite(limit)
    ? fileNames.slice(0, Math.max(0, Math.trunc(limit)))
    : fileNames;

  const records = [];
  for (const name of selected) {
    const filePath = path.join(directory, name);
    const record = await readJson(filePath);
    if (record) records.push({ ...record, file: filePath });
  }
  return records;
}

/** Most recent stored scan, or null. */
export async function getLatest(target, { root = DEFAULT_DATA_ROOT } = {}) {
  const [latest] = await getHistory(target, { limit: 1, root });
  return latest ?? null;
}

/**
 * The scan before the most recent one, or null when fewer than two exist.
 * This is the baseline every monitoring diff is measured against.
 */
export async function getPrevious(target, { root = DEFAULT_DATA_ROOT } = {}) {
  const records = await getHistory(target, { limit: 2, root });
  return records[1] ?? null;
}

/**
 * Merge operator-supplied metadata into a target's meta.json.
 *
 * Patch semantics: unmentioned fields keep their stored values, so writing a contact note
 * cannot silently drop the tier someone set last month.
 */
export async function saveTargetMeta(target, meta, { root = DEFAULT_DATA_ROOT } = {}) {
  if (!meta || typeof meta !== 'object') {
    throw new StoreError('INVALID_META', 'saveTargetMeta requires a metadata object.');
  }

  const directory = targetDirectory(target, { root });
  const slug = path.basename(directory);
  const filePath = path.join(directory, META_FILE);
  const existing = (await readJson(filePath)) ?? {};

  const merged = {
    ...DEFAULT_META,
    ...existing,
    ...meta,
    target: meta.target ?? existing.target ?? String(target),
    slug,
    // An explicit firstSeen wins, so a wrong value can be corrected. It is never changed
    // by an ordinary merge, because it anchors the evidence timeline a retainer is
    // measured against.
    firstSeen: meta.firstSeen ?? existing.firstSeen ?? new Date().toISOString(),
    updatedAt: new Date().toISOString(),
  };

  await writeJsonAtomic(filePath, merged);
  return merged;
}

/** Stored metadata for a target, or null if the target has never been written. */
export async function getTargetMeta(target, { root = DEFAULT_DATA_ROOT } = {}) {
  return readTargetMeta(targetDirectory(target, { root }));
}

/**
 * Delete all but the newest `keepCount` scans for a target.
 *
 * keepCount is validated rather than clamped. A value arriving as 0, NaN or undefined from
 * a config file would otherwise erase a client's entire evidence history in one call —
 * exactly the outcome this module exists to prevent.
 */
export async function pruneHistory(target, keepCount, { root = DEFAULT_DATA_ROOT } = {}) {
  if (!Number.isInteger(keepCount) || keepCount < 1) {
    throw new StoreError(
      'INVALID_RETENTION',
      `keepCount must be an integer of at least 1, received ${JSON.stringify(keepCount)}.`
    );
  }

  const directory = targetDirectory(target, { root });
  const fileNames = await listScanFileNames(directory);
  const removed = fileNames.slice(keepCount);

  for (const name of removed) {
    await fs.rm(path.join(directory, name), { force: true });
  }

  return { kept: fileNames.length - removed.length, removed };
}

/**
 * Bind every operation to one root. Convenient for the monitoring runner, which works
 * against a single store for its whole lifetime, and for tests using a temp directory.
 */
export function createStore(root = DEFAULT_DATA_ROOT) {
  const withRoot = (options = {}) => ({ ...options, root });
  return {
    root: path.resolve(root),
    saveScan: (target, scanResult, options) => saveScan(target, scanResult, withRoot(options)),
    listTargets: (options) => listTargets(withRoot(options)),
    getHistory: (target, options) => getHistory(target, withRoot(options)),
    getLatest: (target, options) => getLatest(target, withRoot(options)),
    getPrevious: (target, options) => getPrevious(target, withRoot(options)),
    saveTargetMeta: (target, meta, options) => saveTargetMeta(target, meta, withRoot(options)),
    getTargetMeta: (target, options) => getTargetMeta(target, withRoot(options)),
    pruneHistory: (target, keepCount, options) =>
      pruneHistory(target, keepCount, withRoot(options)),
    targetDirectory: (target, options) => targetDirectory(target, withRoot(options)),
  };
}

/* ------------------------------------------------------------------ internals */

/**
 * Extract the host part of a target, or null if there isn't a usable one.
 *
 * The two branches are deliberately not collapsed into one URL() call. Prefixing a scheme
 * onto an arbitrary string and trusting the result is unsafe: `new URL('https:///etc/passwd')`
 * reports its host as "etc", because URL tolerates extra slashes for special schemes. That
 * would file a scan of "/etc/passwd" under a target named "etc" instead of refusing it.
 */
function resolveHost(raw) {
  try {
    const { host } = new URL(raw);
    // An absolute URL parsed its own authority, so its path cannot leak into the name.
    if (host) return host;
  } catch {
    /* not an absolute URL; read it as a bare host below */
  }

  // Bare host, possibly carrying a port and a path. Everything from the first separator
  // onwards is path and must not influence the directory name.
  const [hostPart] = raw.split(/[\\/]/);
  if (!hostPart || hostPart.includes('..')) return null;

  try {
    const { host } = new URL(`https://${hostPart}`);
    return host || null;
  } catch {
    return null;
  }
}

const fileStamp = (date) => date.toISOString().replace(/[:.]/g, '-');

function timestampFromFileName(fileName) {
  const [datePart, timePart] = fileName.replace(/\.json$/, '').split('T');
  const [hours, minutes, seconds, milliseconds] = timePart.replace(/Z$/, '').split('-');
  return `${datePart}T${hours}:${minutes}:${seconds}.${milliseconds}Z`;
}

function normaliseTimestamp(value) {
  if (typeof value !== 'string') return null;
  const millis = Date.parse(value);
  return Number.isNaN(millis) ? null : new Date(millis).toISOString();
}

const laterTimestamp = (a, b) => {
  if (!a) return b;
  if (!b) return a;
  return Date.parse(a) >= Date.parse(b) ? a : b;
};

async function pathExists(filePath) {
  try {
    await fs.access(filePath);
    return true;
  } catch {
    return false;
  }
}

/**
 * Pick a free file name for a scan.
 *
 * Two scans of one target can land in the same millisecond — a re-run, or a backfill. The
 * file name is advanced by a millisecond rather than overwriting; the record still carries
 * the true scannedAt, and no evidence is lost. This assumes a single writer per store,
 * which is what the scheduler provides.
 */
async function reserveScanPath(directory, scannedAt) {
  await fs.mkdir(directory, { recursive: true });

  let millis = Date.parse(scannedAt);
  for (let attempt = 0; attempt < 1000; attempt += 1) {
    const filePath = path.join(directory, `${fileStamp(new Date(millis))}.json`);
    if (!(await pathExists(filePath))) return filePath;
    millis += 1;
  }
  throw new StoreError('NAME_COLLISION', `Could not find a free scan file name in ${directory}.`);
}

async function listScanFileNames(directory) {
  let entries;
  try {
    entries = await fs.readdir(directory);
  } catch (err) {
    // A target with no directory yet is the first-run case, not an error.
    if (err.code === 'ENOENT') return [];
    throw err;
  }

  // The stamp is fixed-width UTC, so sorting the names sorts the scans. Doing it this way
  // means the ordering still holds for a directory whose records cannot all be parsed.
  return entries.filter((name) => SCAN_FILE_PATTERN.test(name)).sort().reverse();
}

async function readJson(filePath) {
  let contents;
  try {
    contents = await fs.readFile(filePath, 'utf8');
  } catch (err) {
    if (err.code === 'ENOENT') return null;
    throw err;
  }

  try {
    return JSON.parse(contents);
  } catch (err) {
    // Raised, not skipped. A monitoring run that quietly ignores an unreadable record
    // compares the latest scan against the wrong baseline and reports a change to a client
    // that never happened.
    throw new StoreError(
      'CORRUPT_RECORD',
      `Stored record is not valid JSON: ${filePath} (${err.message})`
    );
  }
}

async function readTargetMeta(directory) {
  const stored = await readJson(path.join(directory, META_FILE));
  return stored ? { ...DEFAULT_META, ...stored } : null;
}

/** Store-maintained meta fields, refreshed on every save. Never touches operator fields. */
async function touchTargetMeta(directory, { target, slug, scannedAt }) {
  const filePath = path.join(directory, META_FILE);
  const existing = (await readJson(filePath)) ?? {};

  await writeJsonAtomic(filePath, {
    ...DEFAULT_META,
    ...existing,
    target: existing.target ?? target,
    slug,
    firstSeen: existing.firstSeen ?? scannedAt,
    // laterTimestamp, not assignment: backfilling an older scan must not drag the
    // last-scanned marker backwards and make a monitored target look overdue.
    lastScanAt: laterTimestamp(existing.lastScanAt, scannedAt),
    updatedAt: new Date().toISOString(),
  });
}

/**
 * Write JSON so that a crash can never leave a partial file in place of a good one:
 * write to a temp name, flush it to the device, then rename over the destination.
 */
async function writeJsonAtomic(filePath, value) {
  const directory = path.dirname(filePath);
  await fs.mkdir(directory, { recursive: true });

  const temporaryPath = path.join(
    directory,
    `.${path.basename(filePath)}.${process.pid}-${randomUUID().slice(0, 8)}.tmp`
  );
  const contents = `${JSON.stringify(value, null, 2)}\n`;

  try {
    const handle = await fs.open(temporaryPath, 'wx');
    try {
      await handle.writeFile(contents, 'utf8');
      // rename() is atomic for readers, but without this flush the bytes can still be in
      // the page cache when the machine loses power, leaving a correctly named empty file.
      await handle.sync();
    } finally {
      await handle.close();
    }
    await fs.rename(temporaryPath, filePath);
    await syncDirectory(directory);
  } catch (err) {
    await fs.rm(temporaryPath, { force: true });
    throw err;
  }
}

async function syncDirectory(directory) {
  // Best effort. The rename is only fully durable once the directory entry is flushed, but
  // not every platform allows opening a directory, and failing here must not fail a write
  // that has otherwise succeeded.
  try {
    const handle = await fs.open(directory, 'r');
    try {
      await handle.sync();
    } finally {
      await handle.close();
    }
  } catch {
    /* directory fsync unavailable on this platform */
  }
}
