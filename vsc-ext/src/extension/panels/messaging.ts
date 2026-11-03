import * as path from "node:path";
import { FILE_FORMAT_REGISTRY } from "@molcrafts/molvis-stage/io/formats";
import * as vscode from "vscode";
import type {
  HostToWebviewMessage,
  LoadMode,
  WebviewToHostMessage,
} from "../../protocol";
import { FileRangeReader } from "../loading/fileRangeReader";
import { resolveFileFormat } from "../loading/formatResolver";
import type { MolecularFileLoader } from "../loading/molecularFileLoader";
import {
  collapseMrecStoreUri,
  getDisplayName,
  isMrecUriPath,
  isMrecZipPath,
  isStlPath,
  localizeRemoteUri,
} from "../loading/pathUtils";
import type { Logger } from "../types";

const rangeReader = new FileRangeReader();

/** Paths this webview may `readRange` / `dropUri` — the files we opened. */
const allowedFsPaths = new WeakMap<vscode.Webview, Set<string>>();

function allowWebviewPath(webview: vscode.Webview, fsPath: string): void {
  let allowed = allowedFsPaths.get(webview);
  if (!allowed) {
    allowed = new Set();
    allowedFsPaths.set(webview, allowed);
  }
  allowed.add(path.resolve(fsPath));
}

function isAllowedWebviewPath(
  webview: vscode.Webview,
  fsPath: string,
): boolean {
  const allowed = allowedFsPaths.get(webview);
  if (!allowed) return false;
  const resolved = path.resolve(fsPath);
  for (const open of allowed) {
    if (resolved === open || resolved.startsWith(open + path.sep)) return true;
  }
  return false;
}

function isWorkspacePath(fsPath: string): boolean {
  const folders = vscode.workspace.workspaceFolders;
  if (!folders || folders.length === 0) return false;
  const resolved = path.resolve(fsPath);
  return folders.some((folder) => {
    const root = path.resolve(folder.uri.fsPath);
    return resolved === root || resolved.startsWith(root + path.sep);
  });
}

/**
 * Upper bound on a single `readRange` request. Legitimate streaming chunks
 * are far smaller; the cap stops a webview from driving `Buffer.alloc` with
 * an arbitrary length.
 */
export const MAX_RANGE_BYTES = 512 * 1024 * 1024;

/**
 * The load this webview is currently working on: when the host posted it, and
 * how big the payload was. Consumed by the `loadStats` reply so one line can
 * name the transfer and the webview-side cost separately.
 */
const pendingLoads = new WeakMap<
  vscode.Webview,
  { filename: string; startedAt: number; bytes?: number; logger: Logger }
>();

function reportLoadStats(
  webview: vscode.Webview,
  filename: string,
  webviewMs: number,
): void {
  const pending = pendingLoads.get(webview);
  if (!pending || pending.filename !== filename) return;
  pendingLoads.delete(webview);
  const total = Date.now() - pending.startedAt;
  const size =
    pending.bytes !== undefined
      ? ` of ${(pending.bytes / (1024 * 1024)).toFixed(1)} MB`
      : "";
  const transfer = Math.max(0, total - webviewMs);
  pending.logger.info(
    `MolVis: ${filename} ready in ${(total / 1000).toFixed(1)} s` +
      ` — ${(transfer / 1000).toFixed(1)} s host→webview${size},` +
      ` ${(webviewMs / 1000).toFixed(1)} s parse + scene`,
  );
}

/**
 * Send a message from extension host to webview.
 */
export function sendToWebview(
  webview: vscode.Webview,
  message: HostToWebviewMessage,
): void {
  webview.postMessage(message);
}

export async function sendLoadedFile(
  webview: vscode.Webview,
  uri: vscode.Uri,
  fileLoader: MolecularFileLoader,
  logger: Logger,
  mode?: LoadMode,
): Promise<void> {
  try {
    uri = collapseMrecStoreUri(uri);
    allowWebviewPath(webview, uri.fsPath);
    const filename = getDisplayName(uri);
    const stat = await vscode.workspace.fs.stat(uri);
    // Say what is coming before the read + transfer, which for a large file
    // (and a remote host) is where the seconds go.
    sendToWebview(webview, {
      type: "loadPhase",
      phase: "reading",
      filename,
      ...(stat.size ? { bytes: stat.size } : {}),
    });
    // Store forms and meshes bypass the format picker: neither has a
    // FileFormat, so there is nothing to pick.
    const unparsed =
      isMrecUriPath(uri, stat.type) ||
      isMrecZipPath(uri.path) ||
      isStlPath(uri.path);
    const format = unparsed ? null : await resolveFileFormat(filename);
    if (!unparsed && !format) {
      logger.info(`MolVis: user cancelled format picker for ${filename}`);
      sendToWebview(webview, {
        type: "loadPhase",
        phase: "cancelled",
        filename,
      });
      return;
    }
    const loaded = await fileLoader.load(uri, format ?? undefined);
    if (loaded.openUri && format) {
      let index: Uint8Array | undefined;
      try {
        index = await vscode.workspace.fs.readFile(
          vscode.Uri.parse(`${uri.toString()}.molidx`),
        );
      } catch {
        // no sibling sidecar
      }
      const mb = loaded.openUri.size / (1024 * 1024);
      logger.info(
        `MolVis: streaming ${filename} (${mb.toFixed(1)} MB) via byte ranges`,
      );
      pendingLoads.set(webview, {
        filename: loaded.filename,
        startedAt: Date.now(),
        logger,
      });
      sendToWebview(webview, {
        type: "openUri",
        uri: uri.toString(),
        filename: loaded.filename,
        format,
        size: loaded.openUri.size,
        mtime: loaded.openUri.mtime,
        ...(mode ? { mode } : {}),
        ...(index ? { index } : {}),
      });
      return;
    }
    // `content` is text, packed bytes, or an mrec store of packed bytes.
    // Typed arrays anywhere in the message ride VS Code's buffer serializer
    // (`webview.postMessage` has no transfer list), so no base64 round trip.
    pendingLoads.set(webview, {
      filename: loaded.filename,
      startedAt: Date.now(),
      bytes:
        typeof loaded.payload === "string"
          ? loaded.payload.length
          : loaded.payload instanceof Uint8Array
            ? loaded.payload.byteLength
            : undefined,
      logger,
    });
    sendToWebview(webview, {
      type: "loadFile",
      content: loaded.payload,
      filename: loaded.filename,
      ...(format ? { format } : {}),
      ...(loaded.stream ? { stream: true } : {}),
      ...(mode ? { mode } : {}),
    });
  } catch (error) {
    logger.error(`MolVis: Failed to load file: ${error}`);
    sendToWebview(webview, {
      type: "loadPhase",
      phase: "cancelled",
      filename: getDisplayName(uri),
    });
    const message = error instanceof Error ? error.message : String(error);
    void vscode.window.showErrorMessage(`MolVis: ${message}`);
  }
}

/**
 * Set up message listener for webview-to-host communication.
 */
export function onWebviewMessage(
  webview: vscode.Webview,
  handler: (message: WebviewToHostMessage) => void,
): vscode.Disposable {
  return webview.onDidReceiveMessage((message: WebviewToHostMessage) => {
    // Load telemetry is the transport's own business — every panel would
    // otherwise repeat the same case for a line it does not act on.
    if (message?.type === "loadStats") {
      reportLoadStats(webview, message.filename, message.webviewMs);
      return;
    }
    handler(message);
  });
}

/**
 * Handle `readRange` / `cancelRange` from the webview. Returns true when
 * the message was consumed.
 */
export async function handleRangeMessage(
  webview: vscode.Webview,
  message: WebviewToHostMessage,
  logger: Logger,
): Promise<boolean> {
  if (message.type === "cancelRange") {
    rangeReader.cancel(message.fetchId);
    return true;
  }
  if (message.type !== "readRange") return false;
  try {
    const uri = localizeRemoteUri(
      vscode.Uri.parse(message.uri),
      vscode.env.remoteName,
    );
    if (uri.scheme !== "file") {
      throw new Error(
        `range read is only supported for file: URIs (${uri.scheme})`,
      );
    }
    if (!isAllowedWebviewPath(webview, uri.fsPath)) {
      throw new Error("range read is not allowed for this path");
    }
    const { start, end } = message;
    if (
      !Number.isInteger(start) ||
      !Number.isInteger(end) ||
      start < 0 ||
      end < start
    ) {
      throw new Error(`invalid range [${start}, ${end})`);
    }
    if (end - start > MAX_RANGE_BYTES) {
      throw new Error(
        `range of ${end - start} bytes exceeds the ${MAX_RANGE_BYTES}-byte limit`,
      );
    }
    const data = await rangeReader.read(
      uri.fsPath,
      message.start,
      message.end,
      message.fetchId,
    );
    // `data` is already a packed Uint8Array. Post it as-is so VS Code's
    // buffer serializer can extract the ArrayBuffer instead of JSON.
    sendToWebview(webview, { type: "bytes", fetchId: message.fetchId, data });
  } catch (error) {
    logger.error(`MolVis: range read failed: ${error}`);
    sendToWebview(webview, {
      type: "bytes",
      fetchId: message.fetchId,
      data: null,
      error: error instanceof Error ? error.message : String(error),
    });
  }
  return true;
}

/**
 * Handle saveFile message from webview: show native save dialog and write file.
 */
export async function handleSaveFile(
  base64Data: string,
  suggestedName: string,
  logger: Logger,
): Promise<void> {
  try {
    // Strip any directory part so a `../…` suggested name can't pre-fill the
    // dialog outside the workspace. The final save location is whatever the
    // user confirms in the native dialog.
    const safeName = path.basename(suggestedName);
    const workspaceFolder = vscode.workspace.workspaceFolders?.[0]?.uri;
    const defaultUri = workspaceFolder
      ? vscode.Uri.joinPath(workspaceFolder, safeName)
      : vscode.Uri.file(safeName);

    const uri = await vscode.window.showSaveDialog({
      defaultUri,
      filters: saveDialogFilters(safeName),
    });
    if (!uri) return;

    const binary = Buffer.from(base64Data, "base64");
    await vscode.workspace.fs.writeFile(uri, binary);
  } catch (error) {
    logger.error(`MolVis: Failed to save file: ${error}`);
  }
}

function saveDialogFilters(suggestedName: string): Record<string, string[]> {
  const extension = suggestedName.split(".").pop()?.toLowerCase();
  if (extension === "svg") return { "SVG image": ["svg"] };
  if (extension === "png") return { "PNG image": ["png"] };
  return {
    // Every extension molrs can write, straight from the format registry.
    "Molecular files": FILE_FORMAT_REGISTRY.filter(
      (descriptor) => descriptor.writable,
    ).flatMap((descriptor) => descriptor.extensions),
  };
}

/**
 * Read document contents and send to webview.
 */
export async function loadTextDocumentToWebview(
  webview: vscode.Webview,
  document: vscode.TextDocument,
  logger?: Logger,
): Promise<void> {
  const filename = getDisplayName(document.uri);
  const format = await resolveFileFormat(filename);
  if (!format) {
    logger?.info(`MolVis: user cancelled format picker for ${filename}`);
    return;
  }
  sendToWebview(webview, {
    type: "loadFile",
    content: document.getText(),
    filename,
    format,
  });
}

export async function handleDropUri(
  uriString: string,
  webview: vscode.Webview,
  fileLoader: MolecularFileLoader,
  logger: Logger,
  mode: LoadMode = "replace",
): Promise<void> {
  // A drop out of the Explorer carries the workbench URI, which in a remote
  // window is `vscode-remote:` for files the host itself reads as `file:`.
  const uri = localizeRemoteUri(
    vscode.Uri.parse(uriString),
    vscode.env.remoteName,
  );
  // Loading reads through `vscode.workspace.fs` / byte ranges, which only
  // serve `file:` URIs (mirrors the guard in `handleRangeMessage`). Reject
  // anything else instead of failing obscurely deeper in the load path.
  if (uri.scheme !== "file") {
    logger.error(
      `MolVis: drop is only supported for file: URIs (${uri.scheme})`,
    );
    void vscode.window.showErrorMessage(
      `MolVis: cannot open a ${uri.scheme}: URI — it is not readable from the extension host.`,
    );
    return;
  }
  if (
    !isAllowedWebviewPath(webview, uri.fsPath) &&
    !isWorkspacePath(uri.fsPath)
  ) {
    logger.error(`MolVis: drop refused for path outside the workspace`);
    void vscode.window.showErrorMessage(
      "MolVis: can only open files inside the workspace from the viewer.",
    );
    return;
  }
  await sendLoadedFile(webview, uri, fileLoader, logger, mode);
}
