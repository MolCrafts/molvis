import * as vscode from "vscode";
import { createInitMessage } from "../configuration";
import type { MolecularFileLoader } from "../loading/molecularFileLoader";
import type { RecentFilesStore } from "../loading/recentFiles";
import type { Logger, PanelRegistry } from "../types";
import { withErrorHandler } from "./errorBoundary";
import { getPreviewHtml } from "./html";
import {
  handleDropUri,
  handleSaveFile,
  loadTextDocumentToWebview,
  onWebviewMessage,
  sendToWebview,
} from "./messaging";

/**
 * Custom text editor provider for molecular text formats (`.pdb/.xyz/.data`).
 * Keeps the webview in sync with the currently opened text document.
 */
export class MolvisEditorProvider implements vscode.CustomTextEditorProvider {
  public static readonly viewType = "molvis.editor";

  public static register(
    context: vscode.ExtensionContext,
    panelRegistry: PanelRegistry,
    logger: Logger,
    fileLoader: MolecularFileLoader,
    recentFiles?: RecentFilesStore,
  ): vscode.Disposable {
    const provider = new MolvisEditorProvider(
      context,
      panelRegistry,
      logger,
      fileLoader,
      recentFiles,
    );
    return vscode.window.registerCustomEditorProvider(
      MolvisEditorProvider.viewType,
      provider,
      {
        webviewOptions: {
          retainContextWhenHidden: true,
        },
      },
    );
  }

  constructor(
    private readonly context: vscode.ExtensionContext,
    private readonly panelRegistry: PanelRegistry,
    private readonly logger: Logger,
    private readonly fileLoader: MolecularFileLoader,
    private readonly recentFiles?: RecentFilesStore,
  ) {}

  public async resolveCustomTextEditor(
    document: vscode.TextDocument,
    webviewPanel: vscode.WebviewPanel,
    _token: vscode.CancellationToken,
  ): Promise<void> {
    void this.recentFiles?.add(document.uri);

    webviewPanel.webview.options = {
      enableScripts: true,
      localResourceRoots: [
        vscode.Uri.joinPath(this.context.extensionUri, "out"),
      ],
    };
    webviewPanel.webview.html = getPreviewHtml(
      webviewPanel.webview,
      this.context.extensionUri,
    );

    const baseTitle = webviewPanel.title;
    const messageDisposable = onWebviewMessage(
      webviewPanel.webview,
      withErrorHandler(async (message) => {
        switch (message.type) {
          case "ready":
            sendToWebview(webviewPanel.webview, createInitMessage());
            await loadTextDocumentToWebview(webviewPanel.webview, document);
            break;
          case "saveFile":
            await handleSaveFile(
              message.data,
              message.suggestedName,
              this.logger,
            );
            break;
          case "dropUri":
            await handleDropUri(
              message.uri,
              webviewPanel.webview,
              this.fileLoader,
              this.logger,
            );
            break;
          case "dirtyStateChanged":
            webviewPanel.title = message.isDirty ? `● ${baseTitle}` : baseTitle;
            break;
          case "error":
            this.logger.error(`MolVis: ${message.message}`);
            break;
          default:
            break;
        }
      }, this.logger),
    );

    let changeTimer: ReturnType<typeof setTimeout> | null = null;
    const changeDocumentSubscription = vscode.workspace.onDidChangeTextDocument(
      (event) => {
        if (event.document.uri.toString() !== document.uri.toString()) return;
        if (changeTimer) clearTimeout(changeTimer);
        changeTimer = setTimeout(() => {
          changeTimer = null;
          void loadTextDocumentToWebview(webviewPanel.webview, document);
        }, 300);
      },
    );

    this.panelRegistry.register(webviewPanel, {
      getHtml: () =>
        getPreviewHtml(webviewPanel.webview, this.context.extensionUri),
      reload: async () => {
        await loadTextDocumentToWebview(webviewPanel.webview, document);
      },
    });

    webviewPanel.onDidDispose(() => {
      if (changeTimer) clearTimeout(changeTimer);
      this.panelRegistry.unregister(webviewPanel);
      messageDisposable.dispose();
      changeDocumentSubscription.dispose();
    });
  }
}
