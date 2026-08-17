import * as vscode from "vscode";
import { createInitMessage } from "../configuration";
import { resolveActiveUri } from "../loading/activeUri";
import type { MolecularFileLoader } from "../loading/molecularFileLoader";
import { getDisplayName } from "../loading/pathUtils";
import type { Logger, PanelRegistry } from "../types";
import { withErrorHandler } from "./errorBoundary";
import { getSketchHtml } from "./html";
import {
  handleDropUri,
  handleSaveFile,
  onWebviewMessage,
  sendLoadedFile,
  sendToWebview,
} from "./messaging";

/**
 * Sketch Quick View — 2D peek panel (peer to stage Quick View).
 * Uses sketch bundle only; never the page React shell.
 */
export async function openSketchQuickViewPanel(
  context: vscode.ExtensionContext,
  panelRegistry: PanelRegistry,
  logger: Logger,
  fileLoader: MolecularFileLoader,
  uri?: vscode.Uri,
): Promise<void> {
  const targetUri = resolveActiveUri(uri);

  const title = targetUri
    ? `Sketch Quick View: ${getDisplayName(targetUri)}`
    : "Sketch Quick View";

  const panel = vscode.window.createWebviewPanel(
    "molvis.quickViewSketch",
    title,
    vscode.ViewColumn.Beside,
    {
      enableScripts: true,
      retainContextWhenHidden: true,
      localResourceRoots: [vscode.Uri.joinPath(context.extensionUri, "out")],
    },
  );

  panel.webview.html = getSketchHtml(panel.webview, context.extensionUri);

  const reloadPreview = targetUri
    ? async () => {
        await sendLoadedFile(panel.webview, targetUri, fileLoader, logger);
      }
    : undefined;

  panelRegistry.register(panel, {
    getHtml: () => getSketchHtml(panel.webview, context.extensionUri),
    reload: reloadPreview,
  });

  const baseTitle = panel.title;
  const messageDisposable = onWebviewMessage(
    panel.webview,
    withErrorHandler(async (message) => {
      switch (message.type) {
        case "ready":
          sendToWebview(panel.webview, createInitMessage());
          if (targetUri) {
            await sendLoadedFile(panel.webview, targetUri, fileLoader, logger);
          }
          break;
        case "saveFile":
          await handleSaveFile(message.data, message.suggestedName, logger);
          break;
        case "dropUri":
          await handleDropUri(message.uri, panel.webview, fileLoader, logger);
          break;
        case "dirtyStateChanged":
          panel.title = message.isDirty ? `● ${baseTitle}` : baseTitle;
          break;
        case "error":
          logger.error(`MolVis Sketch QV: ${message.message}`);
          break;
        default:
          break;
      }
    }, logger),
  );

  panel.onDidDispose(() => {
    panelRegistry.unregister(panel);
    messageDisposable.dispose();
  });
}
