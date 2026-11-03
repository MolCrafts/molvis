import {
  defaultMolvisConfig,
  type Molvis,
  type MolvisConfig,
  type MolvisSetting,
  mountMolvis,
} from "@molcrafts/molvis-stage";
import {
  isStlPath,
  type LoadMode,
  sceneDropLoadMode,
} from "@molcrafts/molvis-stage/io";
import type React from "react";
import { useCallback, useEffect, useRef, useState } from "react";
import { useBondMappingPicker } from "@/components/bond-column-mapping-dialog";
import {
  loadFileSmart,
  useFormatPicker,
} from "@/components/format-picker-dialog";
import {
  sceneHasUnsavedEdits,
  UnsavedSceneDialog,
} from "@/components/unsaved-scene-dialog";
import { MobileOpenHint } from "@/components/viewer/MobileOpenHint";
import {
  OpenStructureDialog,
  type OpenStructureRequest,
} from "@/components/viewer/OpenStructureDialog";
import { useReportOperationStatus } from "@/hooks/useReportOperationStatus";
import { useViewerOperation } from "@/hooks/useViewerOperation";
import { readDropUris } from "@/lib/drop-uris";
import { type OpenTarget, resolveDropTarget } from "@/lib/mrec-open";
import {
  bindLaunchQueue,
  fetchStructureFile,
  parseStructureSourceFromParams,
  stripStructureParamsFromLocation,
  takeSharedStructureFile,
} from "@/lib/open-structure";
import { reportStatus } from "@/lib/status-report";
import { isViewportHidden } from "@/lib/viewport-visibility";

interface MolvisWrapperProps {
  onMount?: (app: Molvis) => void;
  /**
   * Show the mobile open-file chip when no structure has been opened this
   * session. Defaults to coarse-pointer hosts only.
   */
  showMobileOpenHint?: boolean;
  /**
   * Offered a drag's workspace URIs before this component reads
   * `dataTransfer`. Return `true` to claim the drop. See
   * {@link MountHostOpts.onDropUris}.
   */
  onDropUris?: (uris: string[]) => boolean;
}

type ResumeState = "idle" | "requested" | "failed";

const START_COPY = {
  running: "Starting the molecular viewer…",
  success: "Molecular viewer ready",
  error: "Could not start the molecular viewer",
};

const DROP_COPY = {
  running: "Loading the dropped file…",
  success: "Dropped file loaded",
  error: "Could not load the dropped file",
};
const RESUME_COPY = {
  running: "Resuming the molecular viewer…",
  success: "Molecular viewer resumed",
  error: "Could not resume the molecular viewer",
};

type RuntimeInitPayload = {
  config?: unknown;
  settings?: unknown;
};

declare global {
  interface Window {
    __MOLVIS_VSCODE_INIT__?: RuntimeInitPayload;
  }
}

function asObject(value: unknown): Record<string, unknown> | undefined {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    return undefined;
  }
  return value as Record<string, unknown>;
}

function mergeUiConfig(
  baseUi: NonNullable<MolvisConfig["ui"]>,
  overrideUi: Partial<NonNullable<MolvisConfig["ui"]>> | undefined,
): NonNullable<MolvisConfig["ui"]> {
  return {
    ...baseUi,
    ...overrideUi,
    contextMenu: overrideUi?.contextMenu ?? baseUi.contextMenu,
  };
}

function applyMolvisSettings(
  app: Molvis,
  settings: Partial<MolvisSetting>,
): void {
  if (typeof settings.showFps === "boolean") {
    app.settings.setShowFps(settings.showFps);
  }
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
}

/**
 * Mounts a MolVis core instance into a full-size container and handles cleanup.
 */
const MolvisWrapper: React.FC<MolvisWrapperProps> = ({
  onMount,
  showMobileOpenHint,
  onDropUris,
}) => {
  const containerRef = useRef<HTMLDivElement>(null);
  // Read through a ref: the drop handler is registered once by the engine
  // effect, which must not re-run when a host swaps the callback.
  const onDropUrisRef = useRef(onDropUris);
  onDropUrisRef.current = onDropUris;
  const molvisRef = useRef<Molvis | null>(null);
  const pickFormat = useFormatPicker();
  const pickFormatRef = useRef(pickFormat);
  pickFormatRef.current = pickFormat;
  const pickBondMapping = useBondMappingPicker();
  const pickBondMappingRef = useRef(pickBondMapping);
  pickBondMappingRef.current = pickBondMapping;
  /** Dirty working tree must be resolved before a replace-style drop. */
  const [pendingDirtyDrop, setPendingDirtyDrop] = useState<OpenTarget | null>(
    null,
  );
  const [queuedDropFile, setQueuedDropFile] = useState<OpenTarget | null>(null);
  const [viewerReady, setViewerReady] = useState(false);
  const [viewerVisible, setViewerVisible] = useState(true);
  const [resumeState, setResumeState] = useState<ResumeState>("idle");
  const [structureOpened, setStructureOpened] = useState(false);
  const [linkDialogOpen, setLinkDialogOpen] = useState(false);
  const [coarsePointer, setCoarsePointer] = useState(
    () =>
      typeof window !== "undefined" &&
      window.matchMedia?.("(pointer: coarse)").matches === true,
  );
  const { feedback, running, run: runOperation } = useViewerOperation();
  useReportOperationStatus(feedback);
  const runningRef = useRef(running);
  runningRef.current = running;
  const viewerReadyRef = useRef(viewerReady);
  viewerReadyRef.current = viewerReady;
  const resumeStateRef = useRef(resumeState);
  resumeStateRef.current = resumeState;
  const viewerVisibleRef = useRef(viewerVisible);
  viewerVisibleRef.current = viewerVisible;
  const pendingDirtyModeRef = useRef<LoadMode>("replace");
  /** Deep-link / share-target / launch-queue processed once per mount. */
  const openIngressDoneRef = useRef(false);

  useEffect(() => {
    if (typeof window === "undefined" || !window.matchMedia) return;
    const query = window.matchMedia("(pointer: coarse)");
    const update = () => setCoarsePointer(query.matches);
    update();
    query.addEventListener("change", update);
    return () => query.removeEventListener("change", update);
  }, []);

  const loadDroppedFile = async (
    file: OpenTarget,
    mode: LoadMode,
    copy: typeof DROP_COPY = DROP_COPY,
  ) => {
    const app = molvisRef.current;
    if (!app) return;
    const result = await runOperation(
      async () => {
        // Throws with molrs parse detail on failure — keep that message.
        const outcome = await loadFileSmart(
          app,
          file,
          pickFormatRef.current,
          mode,
          pickBondMappingRef.current,
        );
        if (outcome === "cancelled") {
          throw new DOMException("File loading cancelled", "AbortError");
        }
        return outcome;
      },
      copy,
      { successDurationMs: 2400 },
    );
    if (result.ok) {
      setStructureOpened(true);
    }
  };

  // The mount effect below must not depend on loadDroppedFile: it is recreated
  // every render, and listing it would tear down and rebuild the WebGL/WASM
  // engine on each one. Same latest-value-in-a-ref pattern as pickFormatRef.
  const loadDroppedFileRef = useRef(loadDroppedFile);
  loadDroppedFileRef.current = loadDroppedFile;

  const enqueueOrLoadFile = useCallback(
    (file: OpenTarget, mode: LoadMode = "replace") => {
      const app = molvisRef.current;
      if (!app) {
        setQueuedDropFile(file);
        return;
      }
      if (
        runningRef.current ||
        !viewerReadyRef.current ||
        resumeStateRef.current !== "idle" ||
        !viewerVisibleRef.current
      ) {
        setQueuedDropFile(file);
        reportStatus(
          `${file.name} queued — it will load when the viewer is ready.`,
          "info",
        );
        return;
      }
      // A mesh is added beside the scene, never in place of it, so there is
      // nothing for the unsaved-edits prompt to protect — and answering it
      // with "discard" would throw away edits the drop was never going to
      // touch.
      if (sceneHasUnsavedEdits(app) && !isStlPath(file.name)) {
        pendingDirtyModeRef.current = mode;
        setPendingDirtyDrop(file);
      } else {
        void loadDroppedFileRef.current(file, mode, DROP_COPY);
      }
    },
    [],
  );

  const enqueueOrLoadFileRef = useRef(enqueueOrLoadFile);
  enqueueOrLoadFileRef.current = enqueueOrLoadFile;

  const resolveDirtyDrop = async (action: "save" | "discard" | "cancel") => {
    const file = pendingDirtyDrop;
    setPendingDirtyDrop(null);
    if (!file || action === "cancel") return;
    const app = molvisRef.current;
    if (!app) return;
    if (action === "save") app.commitScene();
    else app.discardScene();
    await loadDroppedFile(file, pendingDirtyModeRef.current, DROP_COPY);
  };

  useEffect(() => {
    if (running || !viewerReady || !viewerVisible) return;
    const app = molvisRef.current;
    if (!app) return;
    if (resumeState !== "idle") {
      if (resumeState === "failed") return;
      void runOperation(
        async () => {
          try {
            await app.start();
          } catch (error) {
            app.stop();
            throw error;
          }
        },
        RESUME_COPY,
        { successDurationMs: 1200 },
      ).then((result) => {
        if (molvisRef.current !== app) return;
        setResumeState((current) => {
          if (current !== "requested") return current;
          return result.ok ? "idle" : "failed";
        });
      });
      return;
    }
    if (!queuedDropFile) return;
    const file = queuedDropFile;
    setQueuedDropFile(null);
    const mode = sceneDropLoadMode(app.modifierPipeline);
    if (sceneHasUnsavedEdits(app) && !isStlPath(file.name)) {
      pendingDirtyModeRef.current = mode;
      setPendingDirtyDrop(file);
    } else {
      void loadDroppedFileRef.current(file, mode, DROP_COPY);
    }
  }, [
    queuedDropFile,
    resumeState,
    runOperation,
    running,
    viewerReady,
    viewerVisible,
  ]);

  // Deep link (?pdb= / ?url=), share-target hand-off, File Handling API.
  useEffect(() => {
    if (!viewerReady || openIngressDoneRef.current) return;
    openIngressDoneRef.current = true;

    const unbindLaunch = bindLaunchQueue((file) => {
      enqueueOrLoadFile(file, "replace");
    });

    void (async () => {
      if (typeof window === "undefined") return;
      const source = parseStructureSourceFromParams(
        new URLSearchParams(window.location.search),
      );
      if (!source) return;

      try {
        if (source.kind === "shared") {
          const file = await takeSharedStructureFile();
          if (file) {
            enqueueOrLoadFile(file, "replace");
          } else {
            reportStatus("No shared structure was found.", "info");
          }
        } else if (source.url) {
          reportStatus(`Downloading ${source.filename}…`, "info");
          const file = await fetchStructureFile(source.url, source.filename);
          if (
            !runningRef.current &&
            viewerReadyRef.current &&
            resumeStateRef.current === "idle" &&
            viewerVisibleRef.current
          ) {
            void loadDroppedFileRef.current(file, "replace", DROP_COPY);
          } else {
            enqueueOrLoadFile(file, "replace");
          }
        }
      } catch (err) {
        const message =
          err instanceof Error ? err.message : "Could not open structure";
        reportStatus(message, "error");
      } finally {
        stripStructureParamsFromLocation();
      }
    })();

    return () => {
      unbindLaunch();
    };
  }, [viewerReady, enqueueOrLoadFile]);

  const handleOpenFromLink = useCallback(
    (request: OpenStructureRequest) => {
      void (async () => {
        try {
          reportStatus(`Downloading ${request.filename}…`, "info");
          const file = await fetchStructureFile(request.url, request.filename);
          if (
            !runningRef.current &&
            viewerReadyRef.current &&
            resumeStateRef.current === "idle" &&
            viewerVisibleRef.current
          ) {
            void loadDroppedFileRef.current(file, "replace", DROP_COPY);
          } else {
            enqueueOrLoadFile(file, "replace");
          }
        } catch (err) {
          const message =
            err instanceof Error ? err.message : "Could not open structure";
          reportStatus(message, "error");
        }
      })();
    },
    [enqueueOrLoadFile],
  );

  useEffect(() => {
    if (!containerRef.current) return;

    const baseUiConfig: NonNullable<MolvisConfig["ui"]> = {
      showModePanel: true,
      showViewPanel: true,
      showInfoPanel: true,
      showPerfPanel: true,
      showTrajPanel: false,
      showContextMenu: true,
      contextMenu: {
        // Keep mode / panel menu items (short core titles). Hosts may
        // append only — do not strip to a single Shot entry.
        buildItems: ({ items }) => [...items],
      },
    };
    const baseConfig: MolvisConfig = {
      showUI: true,
      useRightHandedSystem: true,
      ui: baseUiConfig,
    };
    const runtimeConfig = asObject(window.__MOLVIS_VSCODE_INIT__?.config);
    const config = defaultMolvisConfig({
      ...baseConfig,
      ...(runtimeConfig as Partial<MolvisConfig>),
      ui: mergeUiConfig(
        baseUiConfig,
        (runtimeConfig as Partial<MolvisConfig>)?.ui,
      ),
    });

    const baseSettings: Partial<MolvisSetting> = {
      grid: {
        enabled: false,
        size: 100,
        opacity: 0.5,
      },
      graphics: {
        hardwareScaling: 1.0,
        fxaa: true,
        dof: false,
      },
    };
    const runtimeSettings = asObject(window.__MOLVIS_VSCODE_INIT__?.settings) as
      | Partial<MolvisSetting>
      | undefined;
    const settings: Partial<MolvisSetting> = {
      ...baseSettings,
      ...runtimeSettings,
      grid: {
        ...baseSettings.grid,
        ...(runtimeSettings?.grid ?? {}),
      },
      graphics: {
        ...baseSettings.graphics,
        ...(runtimeSettings?.graphics ?? {}),
      },
    };

    const app = mountMolvis(containerRef.current, config, settings);
    molvisRef.current = app;
    let startupComplete = false;
    let viewportVisible = true;

    // The canvas keeps Babylon's default clear colour, the same one the
    // stage's own surfaces show (`stage/src/viewport_settings.ts` drops its
    // clearColor for exactly this reason). Painting it from a CSS token here
    // was the only thing making the Page and Quick look disagree about the
    // background. A host that wants a specific colour still says so through
    // the `background` mount option below.

    void runOperation(
      async () => {
        try {
          await app.start();
        } catch (error) {
          // Molvis marks itself running before the initial frame render.
          // Roll that flag/world loop back so this operation's Retry is real.
          app.stop();
          setViewerReady(false);
          throw error;
        }
        if (molvisRef.current !== app) {
          throw new DOMException("Viewer mount cancelled", "AbortError");
        }
        startupComplete = true;
        if (!viewportVisible) app.stop();
        setViewerReady(true);
        onMount?.(app);
      },
      START_COPY,
      { feedbackMode: "errors", paintRunning: false },
    );

    // Resize is owned by MolvisApp (container ResizeObserver). Hosts only
    // opt into visibility pause for multi-cell notebook embeds.
    //
    // `isViewportHidden` ignores 0-area boxes — opening a side rail briefly
    // collapses the canvas flex slot, and IntersectionObserver reports
    // isIntersecting:false even though the viewer is still on screen.
    // Treating that as a hide called stop() then resume→start(), which
    // force-rebuilds the loaded scene. Real off-screen hides (notebook
    // cells) still debounce 150ms before stop().
    let hideStopTimer: ReturnType<typeof setTimeout> | undefined;
    let intersecting = true;
    let enginePausedForHide = false;
    const visibilityObserver = new IntersectionObserver(
      (entries) => {
        for (const entry of entries) {
          intersecting = !isViewportHidden(entry);
          const m = molvisRef.current;
          if (!m || !startupComplete) {
            viewportVisible = intersecting;
            setViewerVisible(intersecting);
            continue;
          }
          if (intersecting) {
            if (hideStopTimer !== undefined) {
              clearTimeout(hideStopTimer);
              hideStopTimer = undefined;
            }
            viewportVisible = true;
            setViewerVisible(true);
            if (enginePausedForHide) {
              enginePausedForHide = false;
              setResumeState("requested");
            }
          } else {
            if (hideStopTimer !== undefined) clearTimeout(hideStopTimer);
            hideStopTimer = setTimeout(() => {
              hideStopTimer = undefined;
              if (intersecting) return;
              viewportVisible = false;
              setViewerVisible(false);
              setResumeState("idle");
              enginePausedForHide = true;
              molvisRef.current?.stop();
            }, 150);
          }
        }
      },
      { threshold: 0 },
    );
    visibilityObserver.observe(containerRef.current);

    const handleHostMessage = (
      event: MessageEvent<{
        type?: string;
        config?: unknown;
        settings?: unknown;
      }>,
    ) => {
      if (event.origin !== window.location.origin) {
        return;
      }
      const payload = event.data;
      if (!payload || typeof payload !== "object") {
        return;
      }
      if (payload.type !== "init" && payload.type !== "applySettings") {
        return;
      }
      if (!molvisRef.current) {
        return;
      }

      const nextConfig = asObject(payload.config);
      if (nextConfig) {
        molvisRef.current.setConfig(nextConfig as Partial<MolvisConfig>);
      }

      const nextSettings = asObject(payload.settings) as
        | Partial<MolvisSetting>
        | undefined;
      if (nextSettings) {
        applyMolvisSettings(molvisRef.current, nextSettings);
      }
    };
    window.addEventListener("message", handleHostMessage);

    const container = containerRef.current;
    const handleDragOver = (e: DragEvent) => {
      e.preventDefault();
      e.stopPropagation();
    };
    const handleDrop = (e: DragEvent) => {
      e.preventDefault();
      e.stopPropagation();
      // A drag from the host's file explorer carries `text/uri-list` and no
      // `File` — a webview cannot read a workspace file, so only the host can
      // load it. Offer it first, and stop if the host claims it, or the same
      // drag would be loaded twice.
      const hostUris = readDropUris(e.dataTransfer);
      if (hostUris.length > 0 && onDropUrisRef.current?.(hostUris)) return;
      // A dropped `*.mrec` folder resolves to its File handles (read lazily
      // in the worker); anything else is the plain File. The item accessors
      // run synchronously inside `resolveDropTarget` before it awaits.
      const items = e.dataTransfer?.items;
      const files = e.dataTransfer?.files;
      const count = Math.max(items?.length ?? 0, files?.length ?? 0);
      const jobs: Promise<OpenTarget | null>[] = [];
      for (let i = 0; i < count; i++) {
        jobs.push(resolveDropTarget(items?.[i], files?.[i]));
      }
      void (async () => {
        try {
          const targets = (await Promise.all(jobs)).filter(
            (target): target is OpenTarget => target !== null,
          );
          for (const target of targets) {
            const pipeline = molvisRef.current?.modifierPipeline;
            enqueueOrLoadFileRef.current(
              target,
              pipeline ? sceneDropLoadMode(pipeline) : "replace",
            );
          }
        } catch (error: unknown) {
          reportStatus(
            error instanceof Error ? error.message : String(error),
            "error",
          );
        }
      })();
    };
    container.addEventListener("dragover", handleDragOver);
    container.addEventListener("drop", handleDrop);

    return () => {
      if (hideStopTimer !== undefined) clearTimeout(hideStopTimer);
      container.removeEventListener("dragover", handleDragOver);
      container.removeEventListener("drop", handleDrop);
      visibilityObserver.disconnect();
      window.removeEventListener("message", handleHostMessage);
      if (molvisRef.current) {
        molvisRef.current.destroy();
        molvisRef.current = null;
      }
      setViewerReady(false);
      setViewerVisible(false);
      setResumeState("idle");
    };
  }, [onMount, runOperation]);

  const mobileHintEnabled = showMobileOpenHint ?? coarsePointer;
  const showOpenHint =
    mobileHintEnabled &&
    viewerReady &&
    !structureOpened &&
    !running &&
    pendingDirtyDrop === null;

  return (
    <>
      <div
        ref={containerRef}
        aria-busy={running}
        style={{ position: "absolute", inset: 0, overflow: "hidden" }}
      />
      {showOpenHint && (
        <MobileOpenHint
          onPickFile={(file) => enqueueOrLoadFile(file, "replace")}
          onOpenLink={() => setLinkDialogOpen(true)}
        />
      )}
      <OpenStructureDialog
        open={linkDialogOpen}
        onOpenChange={setLinkDialogOpen}
        onSubmit={handleOpenFromLink}
      />
      <UnsavedSceneDialog
        open={pendingDirtyDrop !== null}
        busy={running}
        onCancel={() => void resolveDirtyDrop("cancel")}
        onSave={() => void resolveDirtyDrop("save")}
        onDiscard={() => void resolveDirtyDrop("discard")}
      />
    </>
  );
};

export default MolvisWrapper;
