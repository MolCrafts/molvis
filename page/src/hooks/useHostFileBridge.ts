import type { Molvis } from "@molvis/core";
import {
  type FileContent,
  type FileFormat,
  type LoadMode,
  loadFileContent,
} from "@molvis/core/io";
import { useEffect } from "react";

interface VsCodeApi {
  postMessage: (message: unknown) => void;
}

declare global {
  interface Window {
    __molvisVsCodeApi?: VsCodeApi;
  }
  const acquireVsCodeApi: (() => VsCodeApi) | undefined;
}

function getVsCodeApi(): VsCodeApi | null {
  if (typeof window === "undefined") return null;
  if (window.__molvisVsCodeApi) return window.__molvisVsCodeApi;
  if (typeof acquireVsCodeApi !== "function") return null;
  try {
    window.__molvisVsCodeApi = acquireVsCodeApi();
    return window.__molvisVsCodeApi;
  } catch {
    return null;
  }
}

/**
 * Bridges the React page to a VSCode-like host. When `acquireVsCodeApi`
 * is available, posts a single `ready` message on mount (so the host
 * knows to push `loadFile` back) and routes inbound `loadFile` messages
 * through the unified core ingress. When not in a VSCode webview, this
 * is a no-op.
 */
export function useHostFileBridge(app: Molvis | null): void {
  useEffect(() => {
    if (!app) return;
    const vscode = getVsCodeApi();
    if (!vscode) return;

    vscode.postMessage({ type: "ready" });

    const handler = (event: MessageEvent<unknown>) => {
      const data = event.data;
      if (!data || typeof data !== "object") return;
      const message = data as { type?: string };
      if (message.type !== "loadFile") return;
      const { content, filename, format, mode } = message as {
        content: FileContent;
        filename: string;
        format?: FileFormat;
        mode?: LoadMode;
      };
      // Honor the host's load mode: a dropped trajectory arrives as "auto"
      // and keeps the topology of the structure already on screen.
      loadFileContent(app, content, filename, format, mode).catch(
        (err: unknown) => {
          const text = err instanceof Error ? err.message : String(err);
          app.events.emit("status-message", {
            text: `Failed to load ${filename}: ${text}`,
            type: "error",
          });
        },
      );
    };

    window.addEventListener("message", handler);
    return () => window.removeEventListener("message", handler);
  }, [app]);
}
