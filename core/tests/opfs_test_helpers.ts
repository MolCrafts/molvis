/**
 * Shared helpers for OPFS-backed tests. The OPFS-dependent suites all
 * need to:
 *
 *   1. Skip when `navigator.storage` isn't around (node, restricted
 *      contexts).
 *   2. Wipe the bucket between cases so leftover entries from one
 *      test don't bleed into the next.
 *
 * Centralizing here keeps each test file focused on its own assertions.
 */

import { it } from "@rstest/core";
import { type OpfsBucket, getOpfsBucket } from "../src/io/cache/opfs_root";

export const opfsAvailable =
  typeof navigator !== "undefined" &&
  typeof (navigator as Navigator).storage?.getDirectory === "function";

/** `it` when OPFS is available, `it.skip` otherwise. Drop-in for
 *  the rstest `it` import in OPFS-dependent suites. */
export const opfsIt = opfsAvailable ? it : it.skip;

export async function clearBucket(bucket: OpfsBucket): Promise<void> {
  const dir = await getOpfsBucket(bucket);
  if (!dir) return;
  const iter = dir as unknown as AsyncIterable<[string, FileSystemHandle]>;
  for await (const [name] of iter) {
    try {
      await dir.removeEntry(name);
    } catch {
      // best-effort
    }
  }
}
