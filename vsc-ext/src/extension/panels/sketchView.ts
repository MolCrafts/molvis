import * as vscode from "vscode";
import type { Logger, PanelRegistry } from "../types";
import { getSketchHtml } from "./html";
import { handleSaveFile, onWebviewMessage } from "./messaging";

/** Standalone 2D structure editor hosted in its own Activity Bar container. */
export class MolvisSketchViewProvider implements vscode.WebviewViewProvider {
  static readonly viewType = "molvis.sketch";

  constructor(
    private readonly context: vscode.ExtensionContext,
    private readonly panelRegistry: PanelRegistry,
    private readonly logger: Logger,
  ) {}

  resolveWebviewView(view: vscode.WebviewView): void {
    view.webview.options = {
      enableScripts: true,
      localResourceRoots: [
        vscode.Uri.joinPath(this.context.extensionUri, "out"),
      ],
    };
    const getHtml = () =>
      getSketchHtml(view.webview, this.context.extensionUri);
    view.webview.html = getHtml();

    const messageDisposable = onWebviewMessage(view.webview, (message) => {
      switch (message.type) {
        case "saveFile":
          void handleSaveFile(message.data, message.suggestedName, this.logger);
          break;
        case "error":
          this.logger.error(`MolVis Sketch: ${message.message}`);
          break;
        default:
          break;
      }
    });

    this.panelRegistry.register(view, {
      getHtml,
      viewType: MolvisSketchViewProvider.viewType,
    });
    view.onDidDispose(() => {
      messageDisposable.dispose();
      this.panelRegistry.unregister(view);
    });
  }
}
