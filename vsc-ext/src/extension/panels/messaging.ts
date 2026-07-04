import { FILE_FORMAT_REGISTRY } from "@molvis/core/io/formats";
import * as vscode from "vscode";
import { resolveFileFormat } from "../loading/formatResolver";
import type { MolecularFileLoader } from "../loading/molecularFileLoader";
import { getDisplayName } from "../loading/pathUtils";
import type {
  HostToWebviewMessage,
  Logger,
  MolecularLoadMode,
  WebviewToHostMessage,
} from "../types";

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
  mode?: MolecularLoadMode,
): Promise<void> {
  try {
    const loaded = await fileLoader.load(uri);
    // Text (string) and byte (Uint8Array) payloads both need a format hint;
    // zarr `Record` payloads dispatch on shape and never do.
    const needsFormat =
      typeof loaded.payload === "string" ||
      loaded.payload instanceof Uint8Array;
    const format = needsFormat
      ? await resolveFileFormat(loaded.filename)
      : null;
    if (needsFormat && !format) {
      logger.info(
        `MolVis: user cancelled format picker for ${loaded.filename}`,
      );
      return;
    }
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
  }
}

/**
 * Set up message listener for webview-to-host communication.
 */
export function onWebviewMessage(
  webview: vscode.Webview,
  handler: (message: WebviewToHostMessage) => void,
): vscode.Disposable {
  return webview.onDidReceiveMessage(handler);
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
    const workspaceFolder = vscode.workspace.workspaceFolders?.[0]?.uri;
    const defaultUri = workspaceFolder
      ? vscode.Uri.joinPath(workspaceFolder, suggestedName)
      : vscode.Uri.file(suggestedName);

    const uri = await vscode.window.showSaveDialog({
      defaultUri,
      filters: {
        // Every extension molrs can write, straight from the format registry.
        "Molecular files": FILE_FORMAT_REGISTRY.filter(
          (d) => d.writable,
        ).flatMap((d) => d.extensions),
      },
    });
    if (!uri) return;

    const binary = Buffer.from(base64Data, "base64");
    await vscode.workspace.fs.writeFile(uri, binary);
  } catch (error) {
    logger.error(`MolVis: Failed to save file: ${error}`);
  }
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
): Promise<void> {
  // A drop is "auto": replace, unless it's a trajectory dropped onto an open
  // structure with topology — then keep the bonds and animate the positions.
  await sendLoadedFile(
    webview,
    vscode.Uri.parse(uriString),
    fileLoader,
    logger,
    "auto",
  );
}
