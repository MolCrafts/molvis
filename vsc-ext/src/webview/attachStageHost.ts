/**
 * Shared stage ↔ VS Code host bridge.
 *
 * Quick View and Workbench share load/settings/save/drop. Workbench passes a
 * wider message guard and an `onExtraMessage` hook for selectAtoms / capabilities.
 */

import type { Molvis } from "@molcrafts/molvis-stage";
import {
  exportFrame,
  type FileFormat,
  loadFileContent,
  loadFileStream,
} from "@molcrafts/molvis-stage/io";
import {
  type HostToWebviewMessage,
  isQuickViewHostMessage,
  type WebviewToHostMessage,
} from "../protocol";
import { applyConfigAndSettings } from "./applySettings";
import { type HostApi, reportError, runAsync } from "./errorBoundary";

function uint8ArrayToBase64(bytes: Uint8Array): string {
  const CHUNK_SIZE = 0x8000;
  const chunks: string[] = [];
  for (let i = 0; i < bytes.length; i += CHUNK_SIZE) {
    chunks.push(String.fromCharCode(...bytes.subarray(i, i + CHUNK_SIZE)));
  }
  return btoa(chunks.join(""));
}

export interface AttachStageHostOptions {
  host: HostApi;
  enableDrop?: boolean;
  /**
   * When false, only {@link StageHostHandle.handleMessage} is used (Workbench
   * owns the window listener). Default true for Quick View.
   */
  listenWindow?: boolean;
  /**
   * Which host messages this surface accepts.
   * Default: Quick View set only.
   */
  isHostMessage?: (data: unknown) => data is HostToWebviewMessage;
  /**
   * Handle messages not covered by the core load/settings/save path
   * (selectAtoms, enableCapability, …). Return true if handled.
   */
  onExtraMessage?: (message: HostToWebviewMessage) => boolean;
}

export interface StageHostHandle {
  dispose(): void;
  handleMessage(message: HostToWebviewMessage): void;
}

/**
 * Attach host messaging to a running stage app.
 * Call after `mountMolvis`, before or after `app.start()`.
 */
export function attachStageHost(
  app: Molvis,
  options: AttachStageHostOptions,
): StageHostHandle {
  const {
    host,
    enableDrop = true,
    listenWindow = true,
    isHostMessage = isQuickViewHostMessage,
    onExtraMessage,
  } = options;

  app.saveFile = async (blob: Blob, suggestedName: string) => {
    const buffer = await blob.arrayBuffer();
    const data = uint8ArrayToBase64(new Uint8Array(buffer));
    host.postMessage({ type: "saveFile", data, suggestedName });
  };

  const handleCore = (message: HostToWebviewMessage): boolean => {
    switch (message.type) {
      case "init":
      case "applySettings":
        try {
          applyConfigAndSettings(app, message.config, message.settings);
        } catch (error) {
          reportError(
            host,
            message.type === "init"
              ? "Failed to apply init options"
              : "Failed to apply settings",
            error,
          );
        }
        return true;
      case "loadFile": {
        const { content, filename, format, mode, stream } = message;
        if (stream && content instanceof Uint8Array && format) {
          const blob = new Blob([content as BlobPart]);
          runAsync(host, `Failed to load ${filename}`, () =>
            loadFileStream(app, blob, filename, format as FileFormat, {}, mode),
          );
        } else {
          runAsync(host, `Failed to load ${filename}`, () =>
            loadFileContent(app, content, filename, format, mode),
          );
        }
        return true;
      }
      case "triggerSave":
        try {
          app.commitScene();
        } catch (error) {
          reportError(host, "Failed to save", error);
        }
        return true;
      case "error":
        return true;
      default:
        return false;
    }
  };

  const handleMessage = (message: HostToWebviewMessage): void => {
    if (handleCore(message)) return;
    if (onExtraMessage?.(message)) return;
  };

  const onWindowMessage = (event: MessageEvent<unknown>): void => {
    if (!isHostMessage(event.data)) return;
    handleMessage(event.data);
  };
  if (listenWindow) {
    window.addEventListener("message", onWindowMessage);
  }

  const onDirty = (isDirty: boolean): void => {
    host.postMessage({ type: "dirtyStateChanged", isDirty });
  };
  app.events.on("dirty-change", onDirty);

  const onExport = (payload: { format?: string } | undefined): void => {
    runAsync(host, "Failed to export scene", async () => {
      const format = payload?.format ?? "pdb";
      const suggestedName = `molvis.${format}`;
      const result = exportFrame(app.world.sceneIndex, {
        format,
        filename: suggestedName,
      });
      const blob = new Blob([result.content as BlobPart], {
        type: result.mime,
      });
      await app.saveFile(blob, result.suggestedName);
    });
  };
  app.events.on("export-requested", onExport);

  let onDragOver: ((event: DragEvent) => void) | undefined;
  let onDrop: ((event: DragEvent) => void) | undefined;
  if (enableDrop) {
    onDragOver = (event: DragEvent) => {
      event.preventDefault();
      event.stopPropagation();
    };
    onDrop = (event: DragEvent) => {
      event.preventDefault();
      event.stopPropagation();

      const uriList = event.dataTransfer?.getData("text/uri-list");
      if (uriList) {
        const uri = uriList
          .split("\n")
          .filter((l) => l.trim())[0]
          ?.trim();
        if (uri) {
          host.postMessage({ type: "dropUri", uri });
          return;
        }
      }

      const file = event.dataTransfer?.files?.[0];
      if (!file) return;

      void (async () => {
        try {
          const content = await file.text();
          await loadFileContent(app, content, file.name, undefined, "replace");
        } catch (error) {
          reportError(host, `Failed to load dropped file ${file.name}`, error);
        }
      })();
    };
    app.mountPoint.addEventListener("dragover", onDragOver);
    app.mountPoint.addEventListener("drop", onDrop);
  }

  return {
    handleMessage,
    dispose() {
      if (listenWindow) {
        window.removeEventListener("message", onWindowMessage);
      }
      app.events.off("dirty-change", onDirty);
      app.events.off("export-requested", onExport);
      if (onDragOver && onDrop) {
        app.mountPoint.removeEventListener("dragover", onDragOver);
        app.mountPoint.removeEventListener("drop", onDrop);
      }
    },
  };
}

/** Post `ready` after a successful `app.start()`. */
export function postStageReady(host: {
  postMessage: (message: WebviewToHostMessage) => void;
}): void {
  host.postMessage({ type: "ready" });
}
