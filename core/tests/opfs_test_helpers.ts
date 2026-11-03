/**
 * Shared helpers for OPFS-backed tests.
 *
 * Skip when `navigator.storage` is absent (Node, restricted contexts).
 */

import { it } from "@rstest/core";
import { getOpfsBucket, type OpfsBucket } from "../src/opfs";

export const opfsAvailable =
  typeof navigator !== "undefined" &&
  typeof (navigator as Navigator).storage?.getDirectory === "function";

/** `it` when OPFS is available, `it.skip` otherwise. */
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
