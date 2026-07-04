import * as vscode from "vscode";
import { createInitMessage } from "../configuration";
import type { MolecularFileLoader } from "../loading/molecularFileLoader";
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

/**
 * Read-only custom editor for binary molecular trajectories (`.dcd`, `.trr`,
 * `.xtc`).
 *
 * A {@link vscode.CustomTextEditorProvider} can't host these: its `document`
 * decodes the file as UTF-8 text, which corrupts the raw bytes. Binary formats
 * therefore get a {@link vscode.CustomReadonlyEditorProvider} that streams the
 * file straight from disk through the byte-capable {@link MolecularFileLoader},
 * exactly like the Quick Preview / Open-in-Editor commands. Registered with
 * `priority: "default"` in `package.json` so opening a binary trajectory pops
 * MolVis directly — there is nothing useful to show in a text editor.
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
  ): vscode.Disposable {
    const provider = new MolvisBinaryEditorProvider(
      context,
      panelRegistry,
      logger,
      fileLoader,
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
            sendToWebview(webviewPanel.webview, createInitMessage("editor"));
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

    this.panelRegistry.register(webviewPanel, {
      getHtml: () =>
        getPreviewHtml(webviewPanel.webview, this.context.extensionUri),
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
