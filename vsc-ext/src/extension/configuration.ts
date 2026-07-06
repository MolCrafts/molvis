import * as vscode from "vscode";
import type { HostToWebviewMessage } from "./types";

export interface MolvisWebviewOptions {
  config?: Record<string, unknown>;
  settings?: Record<string, unknown>;
  /** Mount options forwarded to the page bundle's `readMountOptsFromHost()`. */
  mount?: { surface?: string };
}

function asObject(value: unknown): Record<string, unknown> | undefined {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    return undefined;
  }
  return value as Record<string, unknown>;
}

export function getMolvisWebviewOptions(
  surface?: string,
): MolvisWebviewOptions {
  const cfg = vscode.workspace.getConfiguration("molvis");
  return {
    config: asObject(cfg.get("config")),
    settings: asObject(cfg.get("settings")),
    ...(surface ? { mount: { surface } } : {}),
  };
}

export function createInitMessage(): HostToWebviewMessage {
  const options = getMolvisWebviewOptions();
  return {
    type: "init",
    config: options.config,
    settings: options.settings,
  };
}

export function createApplySettingsMessage(): HostToWebviewMessage {
  const options = getMolvisWebviewOptions();
  return {
    type: "applySettings",
    config: options.config,
    settings: options.settings,
  };
}

export function affectsMolvisSettings(
  event: vscode.ConfigurationChangeEvent,
): boolean {
  return (
    event.affectsConfiguration("molvis.config") ||
    event.affectsConfiguration("molvis.settings")
  );
}
