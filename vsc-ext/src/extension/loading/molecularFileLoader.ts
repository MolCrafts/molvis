import {
  canStream,
  inferFormatFromFilename,
  isBinaryFormat,
} from "@molvis/core/io/formats";
import * as vscode from "vscode";
import type { MolecularFilePayload } from "../types";
import { getDisplayName, isZarrUriPath } from "./pathUtils";
import { readZarrDirectoryWithFs } from "./zarrDirectoryReaderCore";

export interface LoadedMolecularFile {
  filename: string;
  payload: MolecularFilePayload;
  /** True when `payload` is raw bytes meant for the streaming worker path. */
  stream?: boolean;
}

/**
 * Files at or above this size that can stream are handed to the webview as raw
 * bytes and parsed through the streaming worker, never decoded to a single
 * string. Mirrors the page's `STREAMING_FILE_THRESHOLD` (16 MiB) so both hosts
 * pick the same path; the hard reason is V8's ~512 MB max string length, which
 * a multi-hundred-MB trajectory would blow when decoded eagerly.
 */
const STREAM_THRESHOLD = 16 * 1024 * 1024;

export class MolecularFileLoader {
  public async load(uri: vscode.Uri): Promise<LoadedMolecularFile> {
    const stat = await vscode.workspace.fs.stat(uri);

    if (isZarrUriPath(uri, stat.type)) {
      return {
        filename: getDisplayName(uri),
        payload: await readZarrDirectoryWithFs(
          uri,
          vscode.workspace.fs,
          vscode.Uri,
        ),
      };
    }

    // Read raw bytes via the fs provider instead of `openTextDocument`, which
    // is capped at ~50MB by VSCode's TextDocument IPC. Trajectory files
    // (.lammpstrj, .dump) routinely exceed that.
    const bytes = await vscode.workspace.fs.readFile(uri);
    const filename = getDisplayName(uri);
    const format = inferFormatFromFilename(filename);

    // Large streamable trajectory → hand bytes over untouched; the webview
    // streams them through the worker pipeline. Decoding to one string here
    // would throw "Cannot create a string longer than 0x1fffffe8 characters".
    if (format && canStream(format) && bytes.byteLength >= STREAM_THRESHOLD) {
      return { filename, payload: bytes, stream: true };
    }

    // Binary formats (e.g. DCD) are bytes by nature — the eager reader takes a
    // Uint8Array, so don't UTF-8 decode them.
    if (format && isBinaryFormat(format)) {
      return { filename, payload: bytes, stream: false };
    }

    // Small text: safe to decode (well under the string cap). BOM is consumed
    // by the decoder to match `doc.getText()` behavior.
    return {
      filename,
      payload: new TextDecoder("utf-8").decode(bytes),
      stream: false,
    };
  }
}
