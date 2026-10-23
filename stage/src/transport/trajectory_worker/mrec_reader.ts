/**
 * Open a molrec `MrecReader` from the store handle the host posted.
 *
 * Worker-side counterpart of `io/mrec_stream.ts`: the host chose the shape
 * (in-memory files, `File` handles, a packed zip); this module turns it into
 * the reader without ever reading more than the reader asks for. Separate
 * from `worker.ts` so it can be exercised without the workload handler's
 * import-time side effects.
 */

import { MrecReader, openMrecStore } from "@molcrafts/molvis-core/molrs";
import {
  type FileRangeReadSync,
  FileTreeMrecStoreHost,
  fileReaderSyncRange,
  MapMrecStoreHost,
} from "../../io/mrec_store";
import type { MrecSourceHandle } from "./protocol";

export interface OpenedMrecReader {
  reader: MrecReader;
  /** Summed store size in bytes (0 when the handle does not say). */
  totalBytes: number;
}

/**
 * Open `source`. `fileRange` is the synchronous `File` reader the file-tree
 * shape needs; it defaults to `FileReaderSync` and is only resolved for that
 * shape, so the other two work anywhere.
 */
export function openMrecReader(
  source: MrecSourceHandle,
  fileRange: () => FileRangeReadSync = fileReaderSyncRange,
): OpenedMrecReader {
  switch (source.kind) {
    case "mrec-files": {
      const files = new Map<string, Uint8Array>();
      let totalBytes = 0;
      for (const [key, buffer] of source.files) {
        files.set(key, new Uint8Array(buffer));
        totalBytes += buffer.byteLength;
      }
      return { reader: openMrecStore(new MapMrecStoreHost(files)), totalBytes };
    }
    case "mrec-file-tree": {
      let totalBytes = 0;
      for (const file of source.files.values()) totalBytes += file.size;
      return {
        reader: openMrecStore(
          new FileTreeMrecStoreHost(source.files, fileRange()),
        ),
        totalBytes,
      };
    }
    case "mrec-zip":
      return {
        reader: MrecReader.fromZip(new Uint8Array(source.bytes)),
        totalBytes: source.bytes.byteLength,
      };
  }
}
