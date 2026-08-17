import * as vscode from "vscode";

// Protocol types — single source in `src/protocol/`.
export type {
  FileFormat,
  HostToWebviewMessage,
  LoadMode,
  MolecularFilePayload,
  StructureOutlineNode,
  StructureOutlinePayload,
  WebviewToHostMessage,
} from "../protocol";

// --- Logger ---

export interface Logger {
  debug(message: string): void;
  info(message: string): void;
  warn(message: string): void;
  error(message: string): void;
}

export class VsCodeLogger implements Logger, vscode.Disposable {
  private readonly channel: vscode.OutputChannel;

  constructor() {
    this.channel = vscode.window.createOutputChannel("MolVis");
  }

  public debug(message: string): void {
    this.channel.appendLine(`[DEBUG] ${message}`);
  }

  public info(message: string): void {
    this.channel.appendLine(`[INFO] ${message}`);
  }

  public warn(message: string): void {
    this.channel.appendLine(`[WARN] ${message}`);
    vscode.window.showWarningMessage(message);
  }

  public error(message: string): void {
    this.channel.appendLine(`[ERROR] ${message}`);
    vscode.window.showErrorMessage(message);
  }

  /** Reveal the MolVis Output channel (activity-bar Help action). */
  public show(): void {
    this.channel.show(true);
  }

  public dispose(): void {
    this.channel.dispose();
  }
}

// --- Panel ---

/**
 * Minimal structural handle for a webview host. Both `vscode.WebviewPanel`
 * and `vscode.WebviewView` satisfy this; the registry uses it so a single
 * broadcast path serves both panel types.
 */
export interface PanelHandle {
  readonly webview: vscode.Webview;
  readonly visible: boolean;
}

export interface WebviewPanelMeta {
  getHtml: () => string;
  reload?: () => Promise<void>;
  /** Explicit view type for hosts that don't carry one natively (e.g. WebviewView). */
  viewType?: string;
}

export interface PanelRegistry {
  register(panel: PanelHandle, meta: WebviewPanelMeta): void;
  unregister(panel: PanelHandle): void;
  getRegisteredViewTypes(): readonly string[];
  forEachVisible(
    callback: (
      panel: PanelHandle,
      meta: WebviewPanelMeta,
    ) => Promise<void> | void,
  ): Promise<void>;
  forEach(
    callback: (
      panel: PanelHandle,
      meta: WebviewPanelMeta,
    ) => Promise<void> | void,
  ): Promise<void>;
}
