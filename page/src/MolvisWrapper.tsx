import {
  defaultMolvisConfig,
  type Molvis,
  type MolvisConfig,
  type MolvisSetting,
  mountMolvis,
} from "@molcrafts/molvis-stage";
import type { LoadMode } from "@molcrafts/molvis-stage/io";
import type React from "react";
import { useEffect, useRef, useState } from "react";
import { useBondMappingPicker } from "@/components/bond-column-mapping-dialog";
import {
  loadFileSmart,
  useFormatPicker,
} from "@/components/format-picker-dialog";
import {
  sceneHasUnsavedEdits,
  UnsavedSceneDialog,
} from "@/components/unsaved-scene-dialog";
import { useReportOperationStatus } from "@/hooks/useReportOperationStatus";
import { useViewerOperation } from "@/hooks/useViewerOperation";
import { reportStatus } from "@/lib/status-report";

interface MolvisWrapperProps {
  onMount?: (app: Molvis) => void;
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

function readCanvasColor(source: Element): [number, number, number] {
  const raw = getComputedStyle(source)
    .getPropertyValue("--molvis-canvas-rgb")
    .trim();
  const channels = raw.split(/\s+/).map(Number);
  if (
    channels.length !== 3 ||
    channels.some((channel) => !Number.isFinite(channel))
  ) {
    return [0.031385, 0.040408, 0.052783];
  }
  return [channels[0], channels[1], channels[2]];
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
const MolvisWrapper: React.FC<MolvisWrapperProps> = ({ onMount }) => {
  const containerRef = useRef<HTMLDivElement>(null);
  const molvisRef = useRef<Molvis | null>(null);
  const pickFormat = useFormatPicker();
  const pickFormatRef = useRef(pickFormat);
  pickFormatRef.current = pickFormat;
  const pickBondMapping = useBondMappingPicker();
  const pickBondMappingRef = useRef(pickBondMapping);
  pickBondMappingRef.current = pickBondMapping;
  /** Dirty working tree must be resolved before a replace-style drop. */
  const [pendingDirtyDrop, setPendingDirtyDrop] = useState<File | null>(null);
  const [queuedDropFile, setQueuedDropFile] = useState<File | null>(null);
  const [viewerReady, setViewerReady] = useState(false);
  const [viewerVisible, setViewerVisible] = useState(true);
  const [resumeState, setResumeState] = useState<ResumeState>("idle");
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

  const loadDroppedFile = async (file: File, mode: LoadMode) => {
    const app = molvisRef.current;
    if (!app) return;
    await runOperation(
      async () => {
        // Throws with molrs parse detail on failure — keep that message.
        const result = await loadFileSmart(
          app,
          file,
          pickFormatRef.current,
          mode,
          pickBondMappingRef.current,
        );
        if (result === "cancelled") {
          throw new DOMException("File loading cancelled", "AbortError");
        }
        return result;
      },
      DROP_COPY,
      { successDurationMs: 2400 },
    );
  };

  // The mount effect below must not depend on loadDroppedFile: it is recreated
  // every render, and listing it would tear down and rebuild the WebGL/WASM
  // engine on each one. Same latest-value-in-a-ref pattern as pickFormatRef.
  const loadDroppedFileRef = useRef(loadDroppedFile);
  loadDroppedFileRef.current = loadDroppedFile;

  const resolveDirtyDrop = async (action: "save" | "discard" | "cancel") => {
    const file = pendingDirtyDrop;
    setPendingDirtyDrop(null);
    if (!file || action === "cancel") return;
    const app = molvisRef.current;
    if (!app) return;
    if (action === "save") app.commitScene();
    else app.discardScene();
    await loadDroppedFile(file, pendingDirtyModeRef.current);
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
    // Queued drops also replace — no combine dialog.
    if (sceneHasUnsavedEdits(app)) {
      pendingDirtyModeRef.current = "replace";
      setPendingDirtyDrop(file);
    } else {
      void loadDroppedFileRef.current(file, "replace");
    }
  }, [
    queuedDropFile,
    resumeState,
    runOperation,
    running,
    viewerReady,
    viewerVisible,
  ]);

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

    const syncCanvasToTheme = () => {
      if (!molvisRef.current || !containerRef.current) return;
      const [r, g, b] = readCanvasColor(containerRef.current);
      molvisRef.current.scene.clearColor.set(r, g, b, 1);
    };
    syncCanvasToTheme();

    const handleThemeChange = () => {
      syncCanvasToTheme();
    };
    window.addEventListener("molvis:theme-change", handleThemeChange);

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
    const visibilityObserver = new IntersectionObserver(
      (entries) => {
        for (const entry of entries) {
          const wasVisible = viewportVisible;
          viewportVisible = entry.isIntersecting;
          setViewerVisible(entry.isIntersecting);
          const m = molvisRef.current;
          if (!m || !startupComplete) continue;
          if (entry.isIntersecting) {
            if (!wasVisible) setResumeState("requested");
          } else {
            setResumeState("idle");
            m.stop();
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
    const handleDrop = async (e: DragEvent) => {
      e.preventDefault();
      e.stopPropagation();
      const file = e.dataTransfer?.files?.[0];
      const app = molvisRef.current;
      if (!file || !app) return;
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
      // Drop = replace. Extend / add live only on Data Source overflow menu.
      if (sceneHasUnsavedEdits(app)) {
        pendingDirtyModeRef.current = "replace";
        setPendingDirtyDrop(file);
      } else {
        await loadDroppedFileRef.current(file, "replace");
      }
    };
    container.addEventListener("dragover", handleDragOver);
    container.addEventListener("drop", handleDrop);

    return () => {
      container.removeEventListener("dragover", handleDragOver);
      container.removeEventListener("drop", handleDrop);
      visibilityObserver.disconnect();
      window.removeEventListener("message", handleHostMessage);
      window.removeEventListener("molvis:theme-change", handleThemeChange);
      if (molvisRef.current) {
        molvisRef.current.destroy();
        molvisRef.current = null;
      }
      setViewerReady(false);
      setViewerVisible(false);
      setResumeState("idle");
    };
  }, [onMount, runOperation]);

  return (
    <>
      <div
        ref={containerRef}
        aria-busy={running}
        style={{ position: "absolute", inset: 0, overflow: "hidden" }}
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
