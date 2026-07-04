import {
  type LightingSettings,
  type Molvis,
  type MolvisConfig,
  type MolvisSetting,
  mountMolvis,
} from "@molvis/core";
import {
  exportFrame,
  type FileFormat,
  loadFileContent,
  loadFileStream,
} from "@molvis/core/io";
import type {
  HostToWebviewMessage,
  WebviewToHostMessage,
} from "../extension/types";
import {
  installGlobalErrorHandlers,
  reportError,
  runAsync,
} from "./errorBoundary";

declare const acquireVsCodeApi: () => {
  postMessage: (message: WebviewToHostMessage) => void;
};

const VALID_HOST_MESSAGE_TYPES = new Set([
  "init",
  "applySettings",
  "loadFile",
  "triggerSave",
  "error",
]);

function isValidHostMessage(data: unknown): data is HostToWebviewMessage {
  return (
    typeof data === "object" &&
    data !== null &&
    "type" in data &&
    typeof (data as { type: unknown }).type === "string" &&
    VALID_HOST_MESSAGE_TYPES.has((data as { type: string }).type)
  );
}

function uint8ArrayToBase64(bytes: Uint8Array): string {
  const CHUNK_SIZE = 0x8000;
  const chunks: string[] = [];
  for (let i = 0; i < bytes.length; i += CHUNK_SIZE) {
    chunks.push(String.fromCharCode(...bytes.subarray(i, i + CHUNK_SIZE)));
  }
  return btoa(chunks.join(""));
}

export interface BootstrapOptions {
  /**
   * Called once the MolVis app has finished starting (engine up, first render
   * loop running). The host uses it to dismiss the loading overlay.
   */
  onReady?: () => void;
}

export function bootstrapWebview(
  container: HTMLElement,
  options: BootstrapOptions = {},
): void {
  const vscode = acquireVsCodeApi();
  installGlobalErrorHandlers(vscode);

  const app = mountMolvis(
    container,
    { showUI: true },
    {
      grid: { enabled: true },
    },
  );
  const resizeObserver = new ResizeObserver(() => app.resize());
  resizeObserver.observe(container);

  const applyOptions = (config: unknown, settings: unknown): void => {
    if (config && typeof config === "object") {
      app.setConfig(config as Partial<MolvisConfig>);
    }

    if (settings && typeof settings === "object") {
      applyMolvisSettings(app, settings as Partial<MolvisSetting>);
    }
  };

  // Override saveFile: encode blob as base64 and postMessage to extension host
  // (showSaveFilePicker is blocked in cross-origin webview iframes)
  app.saveFile = async (blob: Blob, suggestedName: string) => {
    const buffer = await blob.arrayBuffer();
    const data = uint8ArrayToBase64(new Uint8Array(buffer));
    vscode.postMessage({ type: "saveFile", data, suggestedName });
  };

  window.addEventListener("message", (event: MessageEvent<unknown>) => {
    if (!isValidHostMessage(event.data)) return;
    const message = event.data;
    switch (message.type) {
      case "init":
        try {
          applyOptions(message.config, message.settings);
        } catch (error) {
          reportError(vscode, "Failed to apply init options", error);
        }
        break;
      case "applySettings":
        try {
          applyOptions(message.config, message.settings);
        } catch (error) {
          reportError(vscode, "Failed to apply settings", error);
        }
        break;
      case "loadFile": {
        const { content, filename, format, mode, stream } = message;
        if (stream && content instanceof Uint8Array && format) {
          // Large trajectory: wrap the bytes in a Blob and stream them through
          // the worker pipeline. The file is read in byte-range chunks and
          // never materialized as one string, so it sidesteps V8's ~512 MB
          // string cap that the eager text path hits on big files.
          // `content` is a Uint8Array (a valid BlobPart at runtime); the cast
          // sidesteps lib.dom's ArrayBuffer/SharedArrayBuffer generic mismatch.
          const blob = new Blob([content as BlobPart]);
          runAsync(vscode, `Failed to load ${filename}`, () =>
            loadFileStream(app, blob, filename, format as FileFormat, {}, mode),
          );
        } else {
          runAsync(vscode, `Failed to load ${filename}`, () =>
            loadFileContent(app, content, filename, format, mode),
          );
        }
        break;
      }
      case "triggerSave":
        try {
          app.save();
        } catch (error) {
          reportError(vscode, "Failed to save", error);
        }
        break;
      case "error":
        break;
      default:
        break;
    }
  });

  app.events.on("dirty-change", (isDirty: boolean) => {
    vscode.postMessage({ type: "dirtyStateChanged", isDirty });
  });

  // Right-click "Export" in the canvas context menu emits export-requested.
  // Build a payload from the current scene and round-trip through saveFile,
  // which the host turns into a Save dialog.
  app.events.on("export-requested", (payload) => {
    runAsync(vscode, "Failed to export scene", async () => {
      // Format chosen from the Export ▸ <format> submenu (defaults to pdb).
      const format = payload?.format ?? "pdb";
      const suggestedName = `molvis.${format}`;
      const result = exportFrame(app.world.sceneIndex, {
        format,
        filename: suggestedName,
      });
      // content is a string (text formats) or Uint8Array (DCD/TRR/XTC).
      const blob = new Blob([result.content as BlobPart], {
        type: result.mime,
      });
      await app.saveFile(blob, result.suggestedName);
    });
  });

  container.addEventListener("dragover", (event) => {
    event.preventDefault();
    event.stopPropagation();
  });

  container.addEventListener("drop", async (event) => {
    event.preventDefault();
    event.stopPropagation();

    // VSCode Explorer drag: carries uri-list, delegate to extension host
    // so it works over SSH remote connections
    const uriList = event.dataTransfer?.getData("text/uri-list");
    if (uriList) {
      const uri = uriList
        .split("\n")
        .filter((l) => l.trim())[0]
        ?.trim();
      if (uri) {
        vscode.postMessage({ type: "dropUri", uri });
        return;
      }
    }

    // OS file manager drag: browser File API (local only). "auto" mode keeps
    // the topology when a trajectory is dropped onto an open structure.
    const file = event.dataTransfer?.files?.[0];
    if (!file) return;

    try {
      const content = await file.text();
      await loadFileContent(app, content, file.name, undefined, "auto");
    } catch (error) {
      reportError(vscode, `Failed to load dropped file ${file.name}`, error);
    }
  });

  window.addEventListener("beforeunload", () => {
    resizeObserver.disconnect();
    app.destroy();
  });

  // App startup is independent from molecule shader compilation.
  // Molecular visibility is gated inside Artist draw/redraw flows.
  void app
    .start()
    .then(() => {
      options.onReady?.();
      vscode.postMessage({ type: "ready" });
    })
    .catch((error: unknown) => {
      // Surface the failure but still dismiss the overlay so the canvas (and
      // any error toast) is visible rather than hidden behind the spinner.
      options.onReady?.();
      reportError(vscode, "Failed to start MolVis", error);
    });
}

function applyMolvisSettings(
  app: Molvis,
  settings: Partial<MolvisSetting>,
): void {
  if (typeof settings.cameraPanSpeed === "number") {
    app.settings.setCameraPanSpeed(settings.cameraPanSpeed);
  }
  if (typeof settings.cameraRotateSpeed === "number") {
    app.settings.setCameraRotateSpeed(settings.cameraRotateSpeed);
  }
  if (typeof settings.cameraZoomSpeed === "number") {
    app.settings.setCameraZoomSpeed(settings.cameraZoomSpeed);
  }
  if (typeof settings.cameraInertia === "number") {
    app.settings.setCameraInertia(settings.cameraInertia);
  }
  if (typeof settings.cameraPanInertia === "number") {
    app.settings.setCameraPanInertia(settings.cameraPanInertia);
  }
  if (typeof settings.cameraMinRadius === "number") {
    app.settings.setCameraMinRadius(settings.cameraMinRadius);
  }
  if (
    settings.cameraMaxRadius === null ||
    typeof settings.cameraMaxRadius === "number"
  ) {
    app.settings.setCameraMaxRadius(settings.cameraMaxRadius);
  }
  if (settings.grid && typeof settings.grid === "object") {
    app.settings.setGrid(
      settings.grid as Parameters<typeof app.settings.setGrid>[0],
    );
  }
  if (settings.graphics && typeof settings.graphics === "object") {
    app.settings.setGraphics(
      settings.graphics as Parameters<typeof app.settings.setGraphics>[0],
    );
  }
  if (settings.lighting && typeof settings.lighting === "object") {
    app.settings.setLighting(settings.lighting as Partial<LightingSettings>);
  }
}
