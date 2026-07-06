import * as vscode from "vscode";
import { createInitMessage } from "../configuration";
import { resolveActiveUri } from "../loading/activeUri";
import type { MolecularFileLoader } from "../loading/molecularFileLoader";
import { getDisplayName } from "../loading/pathUtils";
import type { Logger, PanelRegistry } from "../types";
import { withErrorHandler } from "./errorBoundary";
import { getPreviewHtml } from "./html";
import {
  handleDropUri,
  handleSaveFile,
  onWebviewMessage,
  sendLoadedFile,
  sendToWebview,
} from "./messaging";

export async function openQuickViewPanel(
  context: vscode.ExtensionContext,
  panelRegistry: PanelRegistry,
  logger: Logger,
  fileLoader: MolecularFileLoader,
  uri?: vscode.Uri,
): Promise<void> {
  const targetUri = resolveActiveUri(uri);

  const title = targetUri
    ? `Quick View: ${getDisplayName(targetUri)}`
    : "Quick View";

  const panel = vscode.window.createWebviewPanel(
    "molvis.quickView",
    title,
    vscode.ViewColumn.Beside,
    {
      enableScripts: true,
      retainContextWhenHidden: true,
      localResourceRoots: [vscode.Uri.joinPath(context.extensionUri, "out")],
    },
  );

  panel.webview.html = getPreviewHtml(panel.webview, context.extensionUri);

  const reloadPreview = targetUri
    ? async () => {
        await sendLoadedFile(panel.webview, targetUri, fileLoader, logger);
      }
    : undefined;

  panelRegistry.register(panel, {
    getHtml: () => getPreviewHtml(panel.webview, context.extensionUri),
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
          logger.error(`MolVis: ${message.message}`);
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
