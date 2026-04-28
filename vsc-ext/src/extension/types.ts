import * as vscode from "vscode";

// --- Logger (was infra/logger.ts) ---

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

  public dispose(): void {
    this.channel.dispose();
  }
}

// --- Messages (was types/messages.ts) ---

export type MolecularFilePayload = string | Record<string, string>;

/**
 * String identifier for a molecular file format. Mirrors `FileFormat`
 * from `@molvis/core/io/formats`; we re-declare it here so the
 * extension host doesn't depend on core's type exports transitively.
 */
export type MolecularFileFormat =
  | "pdb"
  | "xyz"
  | "lammps"
  | "lammps-dump"
  | "sdf"
  | "dcd";

export type HostToWebviewMessage =
  | {
      type: "init";
      mode: "standalone" | "editor" | "app";
      config?: unknown;
      settings?: unknown;
    }
  | { type: "applySettings"; config?: unknown; settings?: unknown }
  | {
      type: "loadFile";
      content: MolecularFilePayload;
      filename: string;
      format?: MolecularFileFormat;
    }
  | { type: "triggerSave" }
  | { type: "error"; message: string };

export type WebviewToHostMessage =
  | { type: "ready" }
  | { type: "saveFile"; data: string; suggestedName: string }
  | { type: "dropUri"; uri: string }
  | { type: "dirtyStateChanged"; isDirty: boolean }
  | { type: "error"; message: string };

// --- Panel (was types/panel.ts) ---

export interface WebviewPanelMeta {
  getHtml: () => string;
  reload?: () => Promise<void>;
}

export interface PanelRegistry {
  register(panel: vscode.WebviewPanel, meta: WebviewPanelMeta): void;
  unregister(panel: vscode.WebviewPanel): void;
  getRegisteredViewTypes(): readonly string[];
  forEachVisible(
    callback: (
      panel: vscode.WebviewPanel,
      meta: WebviewPanelMeta,
    ) => Promise<void> | void,
  ): Promise<void>;
  forEach(
    callback: (
      panel: vscode.WebviewPanel,
      meta: WebviewPanelMeta,
    ) => Promise<void> | void,
  ): Promise<void>;
}
