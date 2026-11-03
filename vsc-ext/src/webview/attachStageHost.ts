/**
 * Shared stage ↔ VS Code host bridge.
 *
 * Stage surfaces (Quick look and the Stage editor tab) share
 * load/settings/save/drop. Extra host messages (selectAtoms) go through
 * {@link AttachStageHostOptions.onExtraMessage} or the core switch.
 */

import type { Molvis } from "@molcrafts/molvis-stage";
import {
  decideIngest,
  decodeMolidx,
  exportFrame,
  type FileFormat,
  HostRangeSource,
  inferFormatFromFilename,
  isBinaryFormat,
  loadFileContent,
  loadFileStream,
  loadMeshOverlay,
  loadMrecSource,
  OpfsIndexCache,
  sceneDropLoadMode,
} from "@molcrafts/molvis-stage/io";
import { isMrecZipPath, isStlPath } from "@molcrafts/molvis-stage/io/formats";
import {
  type HostToWebviewMessage,
  isQuickViewHostMessage,
  type WebviewToHostMessage,
} from "../protocol";
import { applyConfigAndSettings } from "./applySettings";
import { type HostApi, reportError, runAsync } from "./errorBoundary";
import { hostPayload } from "./hostPayload";
import { asHostBytes, WebviewHostRangeSource } from "./hostRangeSource";

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
   * When false, only {@link StageHostHandle.handleMessage} is used.
   * Default true for Stage / Quick look.
   */
  listenWindow?: boolean;
  /**
   * Which host messages this surface accepts.
   * Default: Quick look set only.
   */
  isHostMessage?: (data: unknown) => data is HostToWebviewMessage;
  /**
   * Handle messages not covered by the core load/settings/save path
   * (selectAtoms, enableCapability, …). Return true if handled.
   */
  onExtraMessage?: (message: HostToWebviewMessage) => boolean;
  /**
   * Non-claiming pre-dispatch observer: sees every accepted host message
   * before {@link handleCore}. Returns nothing, so it can never claim,
   * reorder or suppress a message.
   *
   * It exists because `handleCore` claims `init` and returns `true`, which
   * puts `init`'s payload structurally out of reach of `onExtraMessage`. The
   * alternative — letting a surface run its own window listener — would fork
   * message delivery into two owners that stay identical by convention alone.
   */
  onMessageSeen?: (message: HostToWebviewMessage) => void;
  /**
   * Called with a label while a host-driven load is in flight and with
   * `null` once it settles. Quick look paints it over the canvas so a large
   * file is not a silent wait on an empty scene.
   */
  onBusy?: (label: string | null) => void;
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
    onMessageSeen,
    onBusy,
  } = options;

  let rangeSource: WebviewHostRangeSource | null = null;

  /**
   * Run one host-driven load: hold the busy label (refreshed from the
   * engine's own `status-message` phases) until the load settles, and report
   * the webview-side duration so the host can log how much of the wait was
   * the wire and how much was here.
   */
  const runLoad = (
    filename: string,
    scope: string,
    task: () => Promise<unknown>,
  ): void => {
    const startedAt = performance.now();
    onBusy?.(`Loading ${filename}…`);
    const onPhase = ({ text }: { text: string }) => onBusy?.(text);
    app.events.on("status-message", onPhase);
    const finish = () => {
      app.events.off("status-message", onPhase);
      onBusy?.(null);
      host.postMessage({
        type: "loadStats",
        filename,
        webviewMs: Math.round(performance.now() - startedAt),
      });
    };
    task().then(finish, (error: unknown) => {
      finish();
      reportError(host, scope, error);
    });
  };

  app.saveFile = async (blob: Blob, suggestedName: string) => {
    const buffer = await blob.arrayBuffer();
    const data = uint8ArrayToBase64(new Uint8Array(buffer));
    host.postMessage({ type: "saveFile", data, suggestedName });
  };

  const handleCore = (message: HostToWebviewMessage): boolean => {
    switch (message.type) {
      case "loadPhase": {
        if (message.phase === "cancelled") {
          onBusy?.(null);
          return true;
        }
        const size =
          message.bytes !== undefined
            ? ` (${(message.bytes / (1024 * 1024)).toFixed(1)} MB)`
            : "";
        // Held until `runLoad` takes over when the payload lands — the host
        // read plus the wire hop is dead air otherwise.
        onBusy?.(`Opening ${message.filename}${size}…`);
        return true;
      }
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
      case "openUri": {
        // Show `0/0…` immediately on replace — do not wait for the worker.
        // Augment (data + DCD) must not wipe the timeline already on screen.
        if (message.mode !== "augment") {
          app.events.emit("length-changed", {
            indexedLength: 0,
            length: null,
            indexComplete: false,
          });
        }
        app.events.emit("status-message", {
          text: `Opening ${message.filename}…`,
          type: "info",
        });
        const source = new WebviewHostRangeSource(
          message.uri,
          message.size,
          (msg) => host.postMessage(msg),
        );
        rangeSource = source;
        const fingerprint = `${message.uri}:${message.size}:${message.mtime}`;
        runLoad(
          message.filename,
          `Failed to load ${message.filename}`,
          async () => {
            if (message.index) {
              const copy = new Uint8Array(message.index.byteLength);
              copy.set(message.index);
              const decoded = decodeMolidx(copy.buffer);
              if (decoded) await OpfsIndexCache.set(fingerprint, decoded);
            }
            return loadFileStream(
              app,
              new HostRangeSource(source),
              message.filename,
              message.format,
              {
                fingerprint,
                // Host IPC is a postMessage round-trip per chunk. 1 MiB
                // is enough for a first streamable frame without stuffing
                // the webview channel.
                chunkSize: 1024 * 1024,
              },
              message.mode,
            );
          },
        );
        return true;
      }
      case "bytes": {
        if (message.error) {
          rangeSource?.fail(message.fetchId, message.error);
          return true;
        }
        const bytes = asHostBytes(message.data);
        if (!bytes) {
          rangeSource?.fail(
            message.fetchId,
            "byte-range payload was not binary",
          );
          return true;
        }
        rangeSource?.deliver(message.fetchId, bytes);
        return true;
      }
      case "loadFile": {
        const { content, filename, format, mode, stream } = message;
        if (isStlPath(filename)) {
          // Scene geometry: the host posted the mesh bytes, and there is no
          // `FileFormat` to route them by. Additive, so `mode` says nothing
          // here either — a mesh never replaces the scene.
          const bytes = asHostBytes(content);
          runAsync(host, `Failed to load ${filename}`, async () => {
            if (!bytes) {
              throw new Error(`STL mesh ${filename} was not binary`);
            }
            await loadMeshOverlay(app, bytes, filename);
          });
          return true;
        }
        if (isMrecZipPath(filename)) {
          // Packed mrec store: the host posted the archive bytes; the mrec
          // reader opens it (in the trajectory worker when available).
          const bytes = asHostBytes(content);
          runAsync(host, `Failed to load ${filename}`, async () => {
            if (!bytes) {
              throw new Error(`packed mrec store ${filename} was not binary`);
            }
            await loadMrecSource(
              app,
              { kind: "zip", blob: new Blob([bytes as BlobPart]) },
              filename,
              mode,
            );
          });
          return true;
        }
        if (stream && content instanceof Uint8Array && format) {
          const blob = new Blob([content as BlobPart]);
          runLoad(filename, `Failed to load ${filename}`, () =>
            loadFileStream(app, blob, filename, format as FileFormat, {}, mode),
          );
        } else {
          const payload = hostPayload(
            content,
            format !== undefined && !isBinaryFormat(format),
          );
          runLoad(filename, `Failed to load ${filename}`, () =>
            loadFileContent(app, payload, filename, format, mode),
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
      case "selectAtoms": {
        // A range is expanded here, where the atoms already live, so a
        // whole-frame select costs two numbers on the wire instead of one
        // per atom.
        const rows =
          message.indices ??
          (message.range
            ? Array.from(
                {
                  length: Math.max(0, message.range.end - message.range.start),
                },
                (_, i) => (message.range as { start: number }).start + i,
              )
            : undefined);
        if (!rows || rows.length === 0) return true;
        app.world.selectionManager.replaceAtomsByIds(rows);
        return true;
      }
      case "error":
        return true;
      default:
        return false;
    }
  };

  const handleMessage = (message: HostToWebviewMessage): void => {
    onMessageSeen?.(message);
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
      const mode = sceneDropLoadMode(app.modifierPipeline);
      if (uriList) {
        const uri = uriList
          .split("\n")
          .filter((l) => l.trim())[0]
          ?.trim();
        if (uri) {
          host.postMessage({ type: "dropUri", uri, mode });
          return;
        }
      }

      const file = event.dataTransfer?.files?.[0];
      if (!file) return;

      void (async () => {
        try {
          if (isStlPath(file.name)) {
            await loadMeshOverlay(
              app,
              new Uint8Array(await file.arrayBuffer()),
              file.name,
            );
            return;
          }
          if (isMrecZipPath(file.name)) {
            await loadMrecSource(
              app,
              { kind: "zip", blob: file },
              file.name,
              mode,
            );
            return;
          }
          const inferred = inferFormatFromFilename(file.name);
          const decision = inferred ? decideIngest(inferred, file.size) : null;
          if (decision?.path === "refuse") {
            throw new Error(decision.reason);
          }
          if (decision?.path === "stream" && inferred) {
            await loadFileStream(app, file, file.name, inferred, {}, mode);
            return;
          }
          const content =
            inferred !== null && isBinaryFormat(inferred)
              ? new Uint8Array(await file.arrayBuffer())
              : await file.text();
          await loadFileContent(
            app,
            content,
            file.name,
            inferred ?? undefined,
            mode,
          );
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
