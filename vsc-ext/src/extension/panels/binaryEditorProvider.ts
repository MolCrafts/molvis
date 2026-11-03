import * as vscode from "vscode";
import { createInitMessage } from "../configuration";
import type { MolecularFileLoader } from "../loading/molecularFileLoader";
import type { RecentFilesStore } from "../loading/recentFiles";
import type { Logger, PanelRegistry } from "../types";
import { withErrorHandler } from "./errorBoundary";
import { getPageHtml } from "./html";
import {
  handleDropUri,
  handleRangeMessage,
  handleSaveFile,
  onWebviewMessage,
  sendLoadedFile,
  sendToWebview,
} from "./messaging";

/**
 * Read-only custom editor for files that must reach MolVis as bytes: the
 * binary trajectories (`.dcd`, `.trr`, `.xtc`) and STL meshes (`.stl`).
 *
 * A {@link vscode.CustomTextEditorProvider} can't host these: its `document`
 * decodes the file as UTF-8 text, which corrupts the raw bytes. They therefore
 * get a {@link vscode.CustomReadonlyEditorProvider} that streams the file
 * straight from disk through the byte-capable {@link MolecularFileLoader},
 * exactly like the Quick Preview / Open-in-Editor commands. Registered with
 * `priority: "default"` in `package.json` so opening one pops MolVis directly
 * — there is nothing useful to show in a text editor.
 *
 * STL belongs here even though half of the format is ASCII: the extension does
 * not say which half a given file is, and reading bytes is right for both.
 * `molvis.showSource` still opens an ASCII one as text.
 */
export class MolvisBinaryEditorProvider
  implements vscode.CustomReadonlyEditorProvider
{
  public static readonly viewType = "molvis.binaryEditor";

  public static register(
    context: vscode.ExtensionContext,
    panelRegistry: PanelRegistry,
    logger: Logger,
    fileLoader: MolecularFileLoader,
    recentFiles?: RecentFilesStore,
  ): vscode.Disposable {
    const provider = new MolvisBinaryEditorProvider(
      context,
      panelRegistry,
      logger,
      fileLoader,
      recentFiles,
    );
    return vscode.window.registerCustomEditorProvider(
      MolvisBinaryEditorProvider.viewType,
      provider,
      {
        webviewOptions: { retainContextWhenHidden: true },
        supportsMultipleEditorsPerDocument: false,
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

  /** No backing model: the file is read lazily from `uri` on resolve. */
  public openCustomDocument(uri: vscode.Uri): vscode.CustomDocument {
    return { uri, dispose: () => {} };
  }

  public async resolveCustomEditor(
    document: vscode.CustomDocument,
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
    // Same viewer as Quick look and the Page, opened with its chrome off.
    // "Show controls" on the canvas reveals the full interface in place.
    const getHtml = () =>
      getPageHtml(webviewPanel.webview, this.context.extensionUri, {
        surface: "canvas",
      });
    webviewPanel.webview.html = getHtml();

    const baseTitle = webviewPanel.title;
    const messageDisposable = onWebviewMessage(
      webviewPanel.webview,
      withErrorHandler(async (message) => {
        switch (message.type) {
          case "ready":
            sendToWebview(webviewPanel.webview, createInitMessage());
            await sendLoadedFile(
              webviewPanel.webview,
              document.uri,
              this.fileLoader,
              this.logger,
            );
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
              message.mode,
            );
            break;
          case "dirtyStateChanged":
            webviewPanel.title = message.isDirty ? `● ${baseTitle}` : baseTitle;
            break;
          case "error":
            this.logger.error(`MolVis: ${message.message}`);
            break;
          default:
            if (
              await handleRangeMessage(
                webviewPanel.webview,
                message,
                this.logger,
              )
            ) {
              break;
            }
            break;
        }
      }, this.logger),
    );

    this.panelRegistry.register(webviewPanel, {
      getHtml,
      reload: async () => {
        await sendLoadedFile(
          webviewPanel.webview,
          document.uri,
          this.fileLoader,
          this.logger,
        );
      },
    });

    webviewPanel.onDidDispose(() => {
      this.panelRegistry.unregister(webviewPanel);
      messageDisposable.dispose();
    });
  }
}
