import * as vscode from "vscode";
import type { StructureOutlinePayload, WorkbenchSurface } from "../../protocol";
import { createInitMessage } from "../configuration";
import type { MolecularFileLoader } from "../loading/molecularFileLoader";
import { getDisplayName } from "../loading/pathUtils";
import type { Logger, PanelRegistry } from "../types";
import { withErrorHandler } from "./errorBoundary";
import { getWorkbenchHtml } from "./html";
import {
  handleDropUri,
  handleSaveFile,
  onWebviewMessage,
  sendLoadedFile,
  sendToWebview,
} from "./messaging";

export type OpenWorkbenchPanelOptions = {
  onStructureOutline?: (outline: StructureOutlinePayload | null) => void;
  /** Initial engine tab. Default stage. */
  surface?: WorkbenchSurface;
};

export const WORKBENCH_VIEW_TYPE = "molvis.workbench";

/**
 * Workbench editor tab — peer hosts for stage (3D) and sketch (2D).
 * Not the React page shell (use Open Page for that).
 */
export function openWorkbenchPanel(
  context: vscode.ExtensionContext,
  panelRegistry: PanelRegistry,
  logger: Logger,
  fileLoader: MolecularFileLoader,
  uri?: vscode.Uri,
  options?: OpenWorkbenchPanelOptions,
): vscode.WebviewPanel {
  const onStructureOutline = options?.onStructureOutline;
  const surface = options?.surface ?? "stage";
  const baseTitle = uri
    ? `MolVis: ${getDisplayName(uri)}`
    : surface === "sketch"
      ? "MolVis Sketch"
      : "MolVis Workbench";

  const panel = vscode.window.createWebviewPanel(
    WORKBENCH_VIEW_TYPE,
    baseTitle,
    { viewColumn: vscode.ViewColumn.One, preserveFocus: false },
    {
      enableScripts: true,
      retainContextWhenHidden: true,
      localResourceRoots: [vscode.Uri.joinPath(context.extensionUri, "out")],
    },
  );

  const getHtml = () =>
    getWorkbenchHtml(panel.webview, context.extensionUri, { surface });
  panel.webview.html = getHtml();

  const messageDisposable = onWebviewMessage(
    panel.webview,
    withErrorHandler(async (message) => {
      switch (message.type) {
        case "ready":
          sendToWebview(panel.webview, createInitMessage());
          if (uri) {
            // Ensure stage pane is active before load (host may have opened sketch).
            sendToWebview(panel.webview, {
              type: "setWorkbenchSurface",
              surface: "stage",
            });
            await sendLoadedFile(panel.webview, uri, fileLoader, logger);
          }
          break;
        case "dropUri":
          sendToWebview(panel.webview, {
            type: "setWorkbenchSurface",
            surface: "stage",
          });
          await handleDropUri(message.uri, panel.webview, fileLoader, logger);
          break;
        case "structureOutline":
          onStructureOutline?.(message.outline);
          break;
        case "saveFile":
          await handleSaveFile(message.data, message.suggestedName, logger);
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

  panelRegistry.register(panel, {
    getHtml,
    viewType: WORKBENCH_VIEW_TYPE,
  });

  panel.onDidDispose(() => {
    panelRegistry.unregister(panel);
    messageDisposable.dispose();
    onStructureOutline?.(null);
  });

  return panel;
}

/** Focus an existing workbench on a surface, or no-op. */
export function focusWorkbenchSurface(
  panel: vscode.WebviewPanel,
  surface: WorkbenchSurface,
): void {
  sendToWebview(panel.webview, { type: "setWorkbenchSurface", surface });
  panel.reveal(panel.viewColumn ?? vscode.ViewColumn.One, false);
}
