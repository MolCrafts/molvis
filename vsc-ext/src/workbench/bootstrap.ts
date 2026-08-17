/**
 * Workbench L1 — hosts peer engines: stage (3D) and sketch (2D).
 *
 * Lazy-mounts each engine the first time its surface is shown.
 * Open Page is a separate host command (full React product shell).
 */

import type {
  HostToWebviewMessage,
  WebviewToHostMessage,
  WorkbenchSurface,
} from "../protocol";
import { isWorkbenchHostMessage } from "../protocol";
import {
  attachStageHost,
  postStageReady,
  type StageHostHandle,
} from "../webview/attachStageHost";
import {
  installGlobalErrorHandlers,
  reportError,
} from "../webview/errorBoundary";
import {
  type CapabilityRegistry,
  createCapabilityRegistry,
  DEFAULT_WORKBENCH_CAPABILITIES,
} from "./capabilities";

declare const acquireVsCodeApi: () => {
  postMessage: (message: WebviewToHostMessage) => void;
};

declare global {
  interface Window {
    __MOLVIS_WORKBENCH__?: { surface?: WorkbenchSurface };
  }
}

export interface WorkbenchBootstrapOptions {
  onReady?: () => void;
  initialSurface?: WorkbenchSurface;
}

function bytesToBase64(bytes: Uint8Array): string {
  const chunkSize = 0x8000;
  const chunks: string[] = [];
  for (let offset = 0; offset < bytes.length; offset += chunkSize) {
    chunks.push(
      String.fromCharCode(...bytes.subarray(offset, offset + chunkSize)),
    );
  }
  return btoa(chunks.join(""));
}

/**
 * Wire L0 chrome (tabs + panes) then mount engines on demand.
 * `root` is `#molvis-workbench`.
 */
export async function bootstrapWorkbench(
  root: HTMLElement,
  options: WorkbenchBootstrapOptions = {},
): Promise<void> {
  const host = acquireVsCodeApi();
  installGlobalErrorHandlers(host);

  const stagePane = root.querySelector<HTMLElement>("[data-pane='stage']");
  const sketchPane = root.querySelector<HTMLElement>("[data-pane='sketch']");
  const tabStage = root.querySelector<HTMLElement>("[data-tab='stage']");
  const tabSketch = root.querySelector<HTMLElement>("[data-tab='sketch']");
  if (!stagePane || !sketchPane) {
    throw new Error("Workbench panes missing");
  }

  let active: WorkbenchSurface =
    options.initialSurface ?? window.__MOLVIS_WORKBENCH__?.surface ?? "stage";

  let stageBridge: StageHostHandle | undefined;
  let stageDestroy: (() => void) | undefined;
  let capabilities: CapabilityRegistry | undefined;
  let sketchDestroy: (() => void) | undefined;
  let stageMounting: Promise<void> | undefined;
  let sketchMounting: Promise<void> | undefined;
  const pendingStageMessages: HostToWebviewMessage[] = [];

  const setTabUi = (surface: WorkbenchSurface): void => {
    active = surface;
    stagePane.hidden = surface !== "stage";
    sketchPane.hidden = surface !== "sketch";
    tabStage?.setAttribute(
      "aria-selected",
      surface === "stage" ? "true" : "false",
    );
    tabSketch?.setAttribute(
      "aria-selected",
      surface === "sketch" ? "true" : "false",
    );
    tabStage?.classList.toggle("is-active", surface === "stage");
    tabSketch?.classList.toggle("is-active", surface === "sketch");
  };

  const ensureStage = (): Promise<void> => {
    if (stageBridge) return Promise.resolve();
    stageMounting ??= (async () => {
      const { mountMolvis } = await import("@molcrafts/molvis-stage");
      const app = mountMolvis(
        stagePane,
        { showUI: true },
        { grid: { enabled: true } },
      );
      capabilities = createCapabilityRegistry({ app, host });

      stageBridge = attachStageHost(app, {
        host,
        listenWindow: false,
        isHostMessage: isWorkbenchHostMessage,
        onExtraMessage: (message: HostToWebviewMessage) => {
          switch (message.type) {
            case "selectAtoms": {
              const { indices } = message;
              if (!Array.isArray(indices) || indices.length === 0) return true;
              app.world.selectionManager.replaceAtomsByIds(indices);
              return true;
            }
            case "enableCapability":
              void capabilities?.enable(message.id);
              return true;
            case "disableCapability":
              capabilities?.disable(message.id);
              return true;
            case "setWorkbenchSurface":
              return true;
            default:
              return false;
          }
        },
      });

      await app.start();
      for (const id of DEFAULT_WORKBENCH_CAPABILITIES) {
        await capabilities.enable(id);
      }

      for (const msg of pendingStageMessages.splice(0)) {
        if (msg.type === "setWorkbenchSurface") continue;
        stageBridge.handleMessage(msg);
      }

      stageDestroy = () => {
        capabilities?.dispose();
        stageBridge?.dispose();
        app.destroy();
        stageBridge = undefined;
        capabilities = undefined;
        stageMounting = undefined;
      };
    })();
    return stageMounting;
  };

  const ensureSketch = (): Promise<void> => {
    if (sketchDestroy) return Promise.resolve();
    sketchMounting ??= (async () => {
      const { SketchComposer } = await import("@molcrafts/molvis-sketch");
      const composer = new SketchComposer({
        gui: true,
        onExportFile: async (blob, suggestedName) => {
          const bytes = new Uint8Array(await blob.arrayBuffer());
          host.postMessage({
            type: "saveFile",
            data: bytesToBase64(bytes),
            suggestedName,
          });
        },
      });
      sketchPane.style.cssText = [
        "position:absolute",
        "inset:0",
        "--msk-rail-bg:#252526",
        "--msk-stage-bg:#1e1e1e",
        "--msk-ink:#cccccc",
        "--msk-muted:#858585",
        "--msk-hover:rgba(255,255,255,0.06)",
        "--msk-active:rgba(14,99,156,0.45)",
        "--msk-active-ink:#4fc1ff",
        "--msk-active-fg:#ffffff",
        "--msk-sep:#3c3c3c",
        "--msk-font:-apple-system,BlinkMacSystemFont,'Segoe UI',system-ui,sans-serif",
      ].join(";");
      composer.mount(sketchPane);
      sketchDestroy = () => {
        composer.unmount();
        sketchDestroy = undefined;
        sketchMounting = undefined;
      };
    })();
    return sketchMounting;
  };

  const showSurface = async (surface: WorkbenchSurface): Promise<void> => {
    setTabUi(surface);
    try {
      if (surface === "stage") await ensureStage();
      else await ensureSketch();
    } catch (error: unknown) {
      reportError(host, `Failed to open ${surface}`, error);
    }
  };

  const routeHostMessage = (message: HostToWebviewMessage): void => {
    if (message.type === "setWorkbenchSurface") {
      void showSurface(message.surface);
      return;
    }
    // Stage-bound IO (load / settings / selection / caps)
    if (!stageBridge) {
      pendingStageMessages.push(message);
      void ensureStage().then(() => {
        // ensureStage flushes pending
      });
      return;
    }
    stageBridge.handleMessage(message);
  };

  const onWindowMessage = (event: MessageEvent<unknown>): void => {
    if (!isWorkbenchHostMessage(event.data)) return;
    routeHostMessage(event.data);
  };
  window.addEventListener("message", onWindowMessage);

  tabStage?.addEventListener("click", () => {
    void showSurface("stage");
  });
  tabSketch?.addEventListener("click", () => {
    void showSurface("sketch");
  });

  window.addEventListener("beforeunload", () => {
    window.removeEventListener("message", onWindowMessage);
    stageDestroy?.();
    sketchDestroy?.();
  });

  try {
    await showSurface(active);
    options.onReady?.();
    postStageReady(host);
  } catch (error: unknown) {
    options.onReady?.();
    reportError(host, "Failed to start MolVis Workbench", error);
  }
}
