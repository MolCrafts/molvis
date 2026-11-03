import {
  type FileFormat,
  inferFormatFromFilename,
} from "@molcrafts/molvis-stage/io/formats";
import * as vscode from "vscode";
import type { MolecularFilePayload } from "../../protocol";
import { decideMolecularLoadIntent } from "./molecularLoadIntent";
import {
  collapseMrecStoreUri,
  getDisplayName,
  isMrecUriPath,
  isMrecZipPath,
  isStlPath,
} from "./pathUtils";
import {
  DEFAULT_MAX_STORE_BYTES,
  readZarrDirectoryWithFs,
} from "./zarrDirectoryReaderCore";

export interface LoadedMolecularFile {
  filename: string;
  payload: MolecularFilePayload;
  /** True when `payload` is raw bytes meant for the streaming worker path. */
  stream?: boolean;
  /**
   * When set, the host should send `openUri` instead of `loadFile`.
   * The payload is unused.
   */
  openUri?: {
    size: number;
    mtime: number;
  };
}

export class MolecularFileLoader {
  public async load(
    uri: vscode.Uri,
    knownFormat?: FileFormat,
  ): Promise<LoadedMolecularFile> {
    uri = collapseMrecStoreUri(uri);
    const stat = await vscode.workspace.fs.stat(uri);

    if (isMrecUriPath(uri, stat.type)) {
      // Whole store read here, once: the webview↔host channel is async, and
      // the reader's key host must answer synchronously inside the worker,
      // so the lazy file-tree door is not available to this host. The
      // webview transfers the map into its worker (`.claude/notes/notes.md`,
      // mrec-ingest).
      return {
        filename: getDisplayName(uri),
        payload: await readZarrDirectoryWithFs(
          uri,
          vscode.workspace.fs,
          vscode.Uri,
        ),
      };
    }

    if (isMrecZipPath(uri.path) || isStlPath(uri.path)) {
      if (stat.size > DEFAULT_MAX_STORE_BYTES) {
        throw new Error(
          `${getDisplayName(uri)} is ${(stat.size / (1024 * 1024)).toFixed(0)} MB; refusing to read more than ${(DEFAULT_MAX_STORE_BYTES / (1024 * 1024)).toFixed(0)} MB into the extension host`,
        );
      }
      return {
        filename: getDisplayName(uri),
        payload: await vscode.workspace.fs.readFile(uri),
        stream: false,
      };
    }

    const filename = getDisplayName(uri);
    const format = knownFormat ?? inferFormatFromFilename(filename);
    const intent = decideMolecularLoadIntent(format ?? undefined, stat.size);
    if (intent.action === "refuse") {
      throw new Error(intent.reason);
    }
    if (intent.action === "open-uri" && uri.scheme === "file") {
      return {
        filename,
        payload: new Uint8Array(0),
        stream: true,
        openUri: { size: stat.size, mtime: stat.mtime },
      };
    }

    // Read raw bytes via the fs provider instead of `openTextDocument`, which
    // is capped at ~50MB by VSCode's TextDocument IPC. Trajectory files
    // (.lammpstrj, .dump) routinely exceed that.
    const bytes = await vscode.workspace.fs.readFile(uri);

    if (intent.action === "open-uri") {
      // Non-file scheme: still copy once, then stream in the webview.
      return { filename, payload: bytes, stream: true };
    }
    if (format) {
      // Known format — binary or text — travels as raw bytes and is decoded
      // on the webview side. Decoding here would put a whole-file JS string
      // into the host↔webview message, which on Remote-SSH is the copy that
      // crosses the network.
      return { filename, payload: bytes, stream: false };
    }

    // No format to decide by: hand over text and let the webview's extension
    // dispatch resolve it. BOM is consumed by the decoder to match
    // `doc.getText()` behavior.
    return {
      filename,
      payload: new TextDecoder("utf-8").decode(bytes),
      stream: false,
    };
  }
}
