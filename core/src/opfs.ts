/**
 * Browser-origin persistent storage shared by every MolVis engine.
 *
 * Single owner of the molvis OPFS namespace: everything persisted under
 * the user's origin lives at `/molvis/v1/<bucket>/<key>`. Bumping the
 * version segment lets formats evolve without leaking stale files — a
 * release that needs `v2` ignores `v1`, and {@link clearOpfsCache} is the
 * maintenance pass that removes whatever earlier versions left behind.
 *
 * This lives in `core` rather than an engine because `sketch` and `stage`
 * are peers that must not import each other, so anything both can use has
 * to sit below them. Engine-specific *contents* stay with their engine —
 * stage owns the trajectory index sidecar (`.molidx`) and its codec; core
 * owns only the namespace, the byte bucket, and the sweep helpers.
 *
 * All entry points return `null` (or a zeroed usage) when OPFS is
 * unavailable — older browsers, extension-only contexts, ServiceWorker
 * scopes that opted out. Callers treat that as "no cache" and degrade
 * gracefully; the data still loads, just without the fast path.
 *
 * Diagnostics go to `console.warn` rather than a logging library: core
 * carries exactly one dependency on purpose, and this subpath must stay
 * tree-shakeable for consumers that never touch OPFS.
 */

const ROOT_DIR = "molvis";
const VERSION_DIR = "v1";
const LOG_TAG = "[molvis:opfs]";

export type OpfsBucket = "idx" | "blob";

/** Every bucket MolVis writes; the sweep helpers iterate this. */
export const OPFS_BUCKETS: readonly OpfsBucket[] = ["idx", "blob"];

/**
 * The origin's `StorageManager`, or `null` where OPFS is unavailable.
 *
 * `getDirectory` is typed as always-present, but is genuinely missing in
 * older browsers and some extension/worker scopes — hence the runtime
 * probe through an optional-typed view rather than `storage?.getDirectory`,
 * which the compiler rightly flags as always true.
 */
function storageManager(): StorageManager | null {
  if (typeof navigator === "undefined") return null;
  const storage = (navigator as Navigator & { storage?: StorageManager })
    .storage as (StorageManager & { getDirectory?: unknown }) | undefined;
  return typeof storage?.getDirectory === "function"
    ? (storage as StorageManager)
    : null;
}

export async function getOpfsRoot(): Promise<FileSystemDirectoryHandle | null> {
  const storage = storageManager();
  if (!storage) return null;
  try {
    const root = await storage.getDirectory();
    const molvis = await root.getDirectoryHandle(ROOT_DIR, { create: true });
    return await molvis.getDirectoryHandle(VERSION_DIR, { create: true });
  } catch (err) {
    console.warn(`${LOG_TAG} failed to open root: ${describeErr(err)}`);
    return null;
  }
}

export async function getOpfsBucket(
  bucket: OpfsBucket,
): Promise<FileSystemDirectoryHandle | null> {
  const root = await getOpfsRoot();
  if (!root) return null;
  try {
    return await root.getDirectoryHandle(bucket, { create: true });
  } catch (err) {
    console.warn(
      `${LOG_TAG} failed to open bucket '${bucket}': ${describeErr(err)}`,
    );
    return null;
  }
}

/**
 * Best-effort `getFileHandle` returning `null` for both a missing bucket
 * and a missing file. Unexpected errors surface via the console so the
 * caller can stay terse.
 */
export async function getFileIfExists(
  bucket: OpfsBucket,
  filename: string,
): Promise<FileSystemFileHandle | null> {
  const dir = await getOpfsBucket(bucket);
  if (!dir) return null;
  try {
    return await dir.getFileHandle(filename);
  } catch (err) {
    if (!isNotFound(err)) {
      console.warn(
        `${LOG_TAG} '${bucket}/${filename}' open failed: ${describeErr(err)}`,
      );
    }
    return null;
  }
}

/**
 * Idempotent `removeEntry`: missing keys — and missing buckets — are not
 * an error. Other failures surface via the console.
 */
export async function removeEntryIfExists(
  bucket: OpfsBucket,
  filename: string,
): Promise<void> {
  const dir = await getOpfsBucket(bucket);
  if (!dir) return;
  try {
    await dir.removeEntry(filename);
  } catch (err) {
    if (!isNotFound(err)) {
      console.warn(
        `${LOG_TAG} '${bucket}/${filename}' evict failed: ${describeErr(err)}`,
      );
    }
  }
}

/** What a cache sweep found, or freed. */
export interface OpfsCacheUsage {
  files: number;
  bytes: number;
}

/**
 * Measure everything MolVis holds in OPFS across all buckets.
 *
 * Counts the *current* version root only; {@link clearOpfsCache} is what
 * reaches stale ones.
 */
export async function readOpfsCacheUsage(): Promise<OpfsCacheUsage> {
  const usage: OpfsCacheUsage = { files: 0, bytes: 0 };
  const root = await getOpfsRoot();
  if (!root) return usage;

  for (const bucket of OPFS_BUCKETS) {
    const dir = await getOpfsBucket(bucket);
    if (!dir) continue;
    for await (const handle of dir.values()) {
      if (handle.kind !== "file") continue;
      try {
        const file = await (handle as FileSystemFileHandle).getFile();
        usage.files += 1;
        usage.bytes += file.size;
      } catch (err) {
        // A concurrent eviction is expected; anything else is worth a line.
        if (!isNotFound(err)) {
          console.warn(
            `${LOG_TAG} '${bucket}/${handle.name}' stat failed: ${describeErr(err)}`,
          );
        }
      }
    }
  }
  return usage;
}

/**
 * Delete the whole MolVis OPFS namespace and report what was freed.
 *
 * Removes `/molvis` outright instead of walking the current version's
 * buckets, so roots orphaned by an older release go with it.
 *
 * Everything stored here is derived: index sidecars and cached request
 * bytes are rebuilt on the next load, just more slowly. That is why this
 * is a plain action rather than an undoable command — there is no prior
 * state to restore.
 */
export async function clearOpfsCache(): Promise<OpfsCacheUsage> {
  const usage = await readOpfsCacheUsage();
  const storage = storageManager();
  if (!storage) return usage;
  try {
    const root = await storage.getDirectory();
    await root.removeEntry(ROOT_DIR, { recursive: true });
  } catch (err) {
    if (!isNotFound(err)) {
      console.warn(`${LOG_TAG} cache clear failed: ${describeErr(err)}`);
      throw err;
    }
  }
  return usage;
}

/** True when an OPFS handle threw because the entry did not exist. */
export function isNotFound(err: unknown): boolean {
  if (!err) return false;
  return (err as { name?: string }).name === "NotFoundError";
}

/**
 * Filesystem-safe key — strips characters that may not round-trip on
 * every platform. Defense in depth: production fingerprints already pass
 * through `encodeURIComponent`, but maintenance UIs and tests can supply
 * arbitrary keys.
 */
export function safeKey(fingerprint: string): string {
  return fingerprint.replace(/[^A-Za-z0-9._%-]/g, "_");
}

export type Fingerprint = string;

/**
 * Fingerprint a source file so the cache can recognise it across page
 * reloads. Real `File` objects (drag-drop, `<input type=file>`) carry
 * name + size + lastModified, which together are a good-enough key.
 *
 * `kind` distinguishes otherwise-identical files cached by different
 * readers (a trajectory format, a sketch document type, …) so engines
 * cannot collide on one key.
 *
 * On a false positive — the user edits a file in place without bumping
 * mtime — the cached entry is stale and the consumer surfaces a parse
 * error. Degraded, not corrupted.
 *
 * Anonymous `Blob`s (no name, no mtime) cannot be fingerprinted
 * reliably; callers branch on `file instanceof File` and skip caching.
 */
export function fingerprintFile(file: File, kind: string): Fingerprint {
  const safeName = encodeURIComponent(file.name).slice(0, 64);
  return `${safeName}-${file.size}-${file.lastModified}-${kind}`;
}

/**
 * Byte bucket: a persistent copy of source bytes, readable by a worker
 * through a `FileSystemSyncAccessHandle`.
 *
 * Why cache source bytes when the consumer already caches its index?
 * Re-opening a known file still produces a fresh `Blob`, backed either by
 * the original filesystem entry (drag-drop) or a network response (the
 * VSCode extension) — the latter would re-download. Persistent storage
 * gives the network case a 1-RTT skip on every reload and lets a worker
 * read straight into WASM linear memory.
 *
 * Opt-in on purpose: auto-promoting every file the user opens would
 * saturate the origin's quota on a large trajectory.
 */
export const OpfsBlobCache = {
  async has(fingerprint: string): Promise<boolean> {
    return (await getFileIfExists("blob", safeKey(fingerprint))) !== null;
  },

  async set(fingerprint: string, blob: Blob): Promise<void> {
    const dir = await getOpfsBucket("blob");
    if (!dir) {
      throw new Error("OpfsBlobCache: OPFS unavailable");
    }
    const handle = await dir.getFileHandle(safeKey(fingerprint), {
      create: true,
    });
    const writable = await handle.createWritable();
    try {
      // `FileSystemWritableFileStream` supports `pipeTo`, which overlaps
      // reads from the Blob with writes to OPFS for ~2× throughput on
      // multi-GB blobs versus a serial loop.
      await blob.stream().pipeTo(writable);
    } catch (err) {
      try {
        await writable.abort();
      } catch {
        // best-effort
      }
      throw err;
    }
  },

  evict(fingerprint: string): Promise<void> {
    return removeEntryIfExists("blob", safeKey(fingerprint));
  },

  /**
   * Worker side: open a cached file as a `FileSystemSyncAccessHandle`.
   * `null` on cache miss or where sync access is unavailable.
   */
  async openSync(
    fingerprint: string,
  ): Promise<FileSystemSyncAccessHandle | null> {
    const handle = await getFileIfExists("blob", safeKey(fingerprint));
    if (!handle) return null;
    const sync = handle as unknown as {
      createSyncAccessHandle?: () => Promise<FileSystemSyncAccessHandle>;
    };
    if (!sync.createSyncAccessHandle) return null;
    return await sync.createSyncAccessHandle();
  },
};

function describeErr(err: unknown): string {
  return err instanceof Error ? err.message : String(err);
}
