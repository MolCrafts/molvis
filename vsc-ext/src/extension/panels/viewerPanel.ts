import * as vscode from "vscode";
import { createInitMessage, getMolvisWebviewOptions } from "../configuration";
import type { MolecularFileLoader } from "../loading/molecularFileLoader";
import { getDisplayName } from "../loading/pathUtils";
import type { Logger, PanelRegistry } from "../types";
import { withErrorHandler } from "./errorBoundary";
import { getViewerHtml } from "./html";
import {
  handleDropUri,
  onWebviewMessage,
  sendLoadedFile,
  sendToWebview,
} from "./messaging";

export function openEditorPanel(
  context: vscode.ExtensionContext,
  panelRegistry: PanelRegistry,
  logger: Logger,
  fileLoader: MolecularFileLoader,
  uri?: vscode.Uri,
): void {
  const title = uri ? `MolVis: ${getDisplayName(uri)}` : "MolVis Editor";
  const panel = vscode.window.createWebviewPanel(
    "molvis.workspace",
    title,
    vscode.ViewColumn.Active,
    {
      enableScripts: true,
      retainContextWhenHidden: true,
      localResourceRoots: [vscode.Uri.joinPath(context.extensionUri, "out")],
    },
  );

  panel.webview.html = getViewerHtml(
    panel.webview,
    context.extensionUri,
    getMolvisWebviewOptions("full"),
  );

  const messageDisposable = onWebviewMessage(
    panel.webview,
    withErrorHandler(async (message) => {
      switch (message.type) {
        case "ready":
          sendToWebview(panel.webview, createInitMessage());
          if (uri) {
            await sendLoadedFile(panel.webview, uri, fileLoader, logger);
          }
          break;
        case "dropUri":
          await handleDropUri(message.uri, panel.webview, fileLoader, logger);
          break;
        case "error":
          logger.error(`MolVis: ${message.message}`);
          break;
        default:
          break;
      }
    }, logger),
  );

  panelRegistry.register(panel, {
    getHtml: () =>
      getViewerHtml(
        panel.webview,
        context.extensionUri,
        getMolvisWebviewOptions("full"),
      ),
  });

  panel.onDidDispose(() => {
    panelRegistry.unregister(panel);
    messageDisposable.dispose();
  });
}
