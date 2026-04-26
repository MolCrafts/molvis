/**
 * Fingerprint a source file so the OPFS cache can recognize it across
 * page reloads. Real `File` objects (drag-drop, `<input type=file>`)
 * carry name + size + lastModified — those three are a good-enough
 * cache key.
 *
 * On false positive (e.g. user edits a trajectory in place without
 * bumping mtime), the cached index will yield wrong frame boundaries
 * and the parser surfaces a `frame-error`. Degraded gracefully.
 *
 * Anonymous `Blob`s (no name, no mtime) cannot be fingerprinted
 * reliably — callers branch on `file instanceof File` and skip
 * caching otherwise.
 */

import type { Format } from "../../transport/trajectory_worker/protocol";

export type Fingerprint = string;

export function fingerprintFile(file: File, format: Format): Fingerprint {
  const safeName = encodeURIComponent(file.name).slice(0, 64);
  return `${safeName}-${file.size}-${file.lastModified}-${format}`;
}
