import * as vscode from "vscode";
import { createInitMessage, getMolvisWebviewOptions } from "../configuration";
import type { MolecularFileLoader } from "../loading/molecularFileLoader";
import type { Logger, PanelRegistry } from "../types";
import { withErrorHandler } from "./errorBoundary";
import { getViewerHtml } from "./html";
import { handleDropUri, onWebviewMessage, sendToWebview } from "./messaging";

/**
 * Activity-bar webview view provider for the full MolVis page.
 *
 * Hosts the React page bundle in the activity-bar sidebar with
 * `retainContextWhenHidden: true` so the scene survives collapse/reopen.
 * Registers itself in the shared {@link PanelRegistry} so
 * `molvis.reload` and settings-change broadcasts reach it.
 */
export class MolvisPageViewProvider implements vscode.WebviewViewProvider {
  public static readonly viewType = "molvis.pageView";

  private _view?: vscode.WebviewView;

  constructor(
    private readonly extensionUri: vscode.Uri,
    private readonly panelRegistry: PanelRegistry,
    private readonly logger: Logger,
    private readonly fileLoader: MolecularFileLoader,
  ) {}

  resolveWebviewView(
    webviewView: vscode.WebviewView,
    _context: vscode.WebviewViewResolveContext,
    _token: vscode.CancellationToken,
  ): void {
    this._view = webviewView;

    webviewView.webview.options = {
      enableScripts: true,
      localResourceRoots: [vscode.Uri.joinPath(this.extensionUri, "out")],
    };

    webviewView.webview.html = getViewerHtml(
      webviewView.webview,
      this.extensionUri,
      getMolvisWebviewOptions("full"),
    );

    const messageDisposable = onWebviewMessage(
      webviewView.webview,
      withErrorHandler(async (message) => {
        switch (message.type) {
          case "ready":
            sendToWebview(webviewView.webview, createInitMessage());
            break;
          case "dropUri":
            await handleDropUri(
              message.uri,
              webviewView.webview,
              this.fileLoader,
              this.logger,
            );
            break;
          case "error":
            this.logger.error(`MolVis page view: ${message.message}`);
            break;
          default:
            break;
        }
      }, this.logger),
    );

    // Register in the shared panel registry so molvis.reload and
    // settings-change broadcasts reach this view.
    this.panelRegistry.register(webviewView, {
      getHtml: () =>
        getViewerHtml(
          webviewView.webview,
          this.extensionUri,
          getMolvisWebviewOptions("full"),
        ),
      viewType: MolvisPageViewProvider.viewType,
    });

    webviewView.onDidDispose(() => {
      this.panelRegistry.unregister(webviewView);
      messageDisposable.dispose();
    });
  }
}
