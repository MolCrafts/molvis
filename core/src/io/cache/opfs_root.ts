/**
 * Single owner of the molvis OPFS namespace. Everything we persist
 * under the user's origin lives at `/molvis/v1/<bucket>/<key>`. Bumping
 * the version segment lets us evolve formats without leaking stale
 * files: a new molvis release that needs `v2` simply ignores `v1` and
 * lets the browser GC it (or a maintenance pass deletes the old root).
 *
 * All entry points return `null` if OPFS is unavailable in the host
 * (older browsers, ext-only contexts, ServiceWorker scopes that opted
 * out). Callers treat `null` as "no cache" and degrade gracefully —
 * the trajectory still loads, just without the fast-path.
 */

import { logger } from "../../utils/logger";

const ROOT_DIR = "molvis";
const VERSION_DIR = "v1";

export type OpfsBucket = "idx" | "blob";

export async function getOpfsRoot(): Promise<FileSystemDirectoryHandle | null> {
  if (typeof navigator === "undefined") return null;
  const storage = (navigator as Navigator & { storage?: StorageManager })
    .storage;
  if (!storage?.getDirectory) return null;
  try {
    const root = await storage.getDirectory();
    const molvis = await root.getDirectoryHandle(ROOT_DIR, { create: true });
    return await molvis.getDirectoryHandle(VERSION_DIR, { create: true });
  } catch (err) {
    logger.warn(`[opfs] failed to open root: ${describeErr(err)}`);
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
    logger.warn(
      `[opfs] failed to open bucket '${bucket}': ${describeErr(err)}`,
    );
    return null;
  }
}

/** Best-effort `getFileHandle` that returns `null` for both missing
 *  bucket and missing file. Surface unexpected errors via the logger
 *  so the caller can stay terse. */
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
      logger.warn(
        `[opfs] '${bucket}/${filename}' open failed: ${describeErr(err)}`,
      );
    }
    return null;
  }
}

/** Idempotent `removeEntry`: missing keys (and missing buckets) are
 *  not an error. Other failures surface via the logger. */
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
      logger.warn(
        `[opfs] '${bucket}/${filename}' evict failed: ${describeErr(err)}`,
      );
    }
  }
}

/** True when an OPFS handle threw because the entry didn't exist.
 *  Centralized so the per-cache modules can stay focused. */
export function isNotFound(err: unknown): boolean {
  if (!err) return false;
  const name = (err as { name?: string }).name;
  return name === "NotFoundError";
}

/** Filesystem-safe key — strips characters that may not round-trip on
 *  every platform. Defense-in-depth: production fingerprints already
 *  pass through `encodeURIComponent`, but maintenance UIs and tests
 *  can pass arbitrary keys through. */
export function safeKey(fingerprint: string): string {
  return fingerprint.replace(/[^A-Za-z0-9._%-]/g, "_");
}

function describeErr(err: unknown): string {
  return err instanceof Error ? err.message : String(err);
}
