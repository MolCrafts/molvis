import * as vscode from "vscode";
import type { Logger, PanelRegistry } from "../types";
import { withErrorHandler } from "./errorBoundary";
import { getPageHtml } from "./html";
import { handleSaveFile, onWebviewMessage } from "./messaging";

export const PAGE_VIEW_TYPE = "molvis.page";

/**
 * Full React product shell from `page/` — optional command surface.
 * Not the default Workbench path (Workbench hosts stage + sketch engines only).
 */
export function openPagePanel(
  context: vscode.ExtensionContext,
  panelRegistry: PanelRegistry,
  logger: Logger,
): vscode.WebviewPanel {
  const panel = vscode.window.createWebviewPanel(
    PAGE_VIEW_TYPE,
    "MolVis",
    { viewColumn: vscode.ViewColumn.One, preserveFocus: false },
    {
      enableScripts: true,
      retainContextWhenHidden: true,
      localResourceRoots: [vscode.Uri.joinPath(context.extensionUri, "out")],
    },
  );

  const getHtml = () => getPageHtml(panel.webview, context.extensionUri);
  panel.webview.html = getHtml();

  const messageDisposable = onWebviewMessage(
    panel.webview,
    withErrorHandler(async (message) => {
      switch (message.type) {
        case "saveFile":
          await handleSaveFile(message.data, message.suggestedName, logger);
          break;
        case "error":
          logger.error(`MolVis Page: ${message.message}`);
          break;
        default:
          break;
      }
    }, logger),
  );

  panelRegistry.register(panel, {
    getHtml,
    viewType: PAGE_VIEW_TYPE,
  });

  panel.onDidDispose(() => {
    panelRegistry.unregister(panel);
    messageDisposable.dispose();
  });

  return panel;
}
