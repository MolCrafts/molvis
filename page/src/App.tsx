import type { Molvis } from "@molcrafts/molvis-stage";
import type React from "react";
import {
  lazy,
  Suspense,
  useCallback,
  useEffect,
  useRef,
  useState,
} from "react";
import { BondMappingPickerProvider } from "@/components/bond-column-mapping-dialog";
import { ErrorBoundary } from "@/components/ErrorBoundary";
import { FormatPickerProvider } from "@/components/format-picker-dialog";
import {
  ResizableHandle,
  ResizablePanel,
  ResizablePanelGroup,
  usePanelRef,
} from "@/components/ui/resizable";
import { ExitFullscreenAction } from "@/components/viewer/ExitFullscreenAction";
import { ResetMolvisDialog } from "@/components/viewer/ResetMolvisDialog";
import { StructureInspector } from "@/components/viewer/StructureInspector";
import { TrajectoryTimeline } from "@/components/viewer/TrajectoryTimeline";
import { ViewerSidePanel } from "@/components/viewer/ViewerSidePanel";
import { ViewerStatusOverlay } from "@/components/viewer/ViewerStatusOverlay";
import { ViewerToolbar } from "@/components/viewer/ViewerToolbar";
import { WeChatOpenBrowserBanner } from "@/components/viewer/WeChatOpenBrowserBanner";
import { WorkbenchBottomPanel } from "@/components/viewer/WorkbenchBottomPanel";
import { useDevDemo } from "@/dev/useDevDemo";
import { BackendConnectionProvider } from "@/hooks/useBackendConnection";
import { useBackendStateSync } from "@/hooks/useBackendStateSync";
import { useIsNarrow } from "@/hooks/useIsNarrow";
import { useMolvisUiState } from "@/hooks/useMolvisUiState";
import { resolveChrome, useMountOpts } from "@/lib/mount-opts";
import { cn } from "@/lib/utils";
import {
  CommandPalette,
  PluginDialogHost,
  useCommandPaletteHotkey,
} from "@/plugins";
import {
  CANVAS_MIN_PCT,
  isSidePanelOpen,
  resolveViewerPanelLayout,
  SIDE_PANEL,
  sidePanelMinPct,
} from "./lib/viewer-layout";
import MolvisWrapper from "./MolvisWrapper";
import { KeyboardShortcutsDialog } from "./ui/layout/KeyboardShortcutsDialog";
import { LeftShellProvider } from "./ui/layout/LeftShellContext";
import { StateSyncDialog } from "./ui/layout/StateSyncDialog";
import { CameraTrajectoryOverlay } from "./ui/modes/view/CameraTrajectoryOverlay";

// Compute pulls in molplot/Vega and a large catalog of result panels. It is
// closed by default, so keep that entire graph off the viewer's startup path.
const LeftSidebar = lazy(() =>
  import("./ui/layout/LeftSidebar").then((module) => ({
    default: module.LeftSidebar,
  })),
);

const INLINE_PANEL_BREAKPOINT = 1280;
const COARSE_POINTER_INLINE_PANEL_BREAKPOINT = 1580;

/**
 * Main page application shell for the MolVis viewer.
 *
 * When mounted with `surface: "canvas"`, all chrome is hidden and only the
 * 3D canvas is rendered (useful for embeds that supply their own UI).
 */
const App: React.FC = () => {
  const opts = useMountOpts();
  const chrome = resolveChrome(opts);
  const canvasOnly =
    !chrome.topBar &&
    !chrome.leftSidebar &&
    !chrome.rightSidebar &&
    !chrome.statusBar &&
    !chrome.timeline;

  const [app, setApp] = useState<Molvis | null>(null);

  // Host-supplied canvas colour (`mv.Stage(background="#FFFFFF")` or
  // `?background=`). Applied once, when the engine hands us the app; the
  // Style panel owns it from then on.
  useEffect(() => {
    if (!app || !opts.background) return;
    app.setBackgroundColor(opts.background);
  }, [app, opts.background]);
  const { currentMode, setCurrentMode, trajectoryLength } =
    useMolvisUiState(app);

  // Bind plugin runtime once the engine is ready; restore Settings plugins
  // and host-injected sources (VSCode molvis.plugins / Python plugins=).
  useEffect(() => {
    if (!app) return;
    let cancelled = false;
    const hostPlugins = opts.plugins ?? [];
    void import("@/plugins").then(
      ({ pluginManager, registerBuiltinModifierPanels }) => {
        if (cancelled) return;
        registerBuiltinModifierPanels();
        pluginManager.bindApp(app);
        void pluginManager.restore(hostPlugins);
      },
    );
    return () => {
      cancelled = true;
    };
  }, [app, opts.plugins]);

  const [shortcutsOpen, setShortcutsOpen] = useState(false);
  const [commandPaletteOpen, setCommandPaletteOpen] = useState(false);
  const [resetOpen, setResetOpen] = useState(false);
  /**
   * Bumped to restart the viewer. Remounting MolvisWrapper disposes the
   * Babylon engine and builds a fresh one, which is what "reload" has to
   * mean here — `location.reload()` would reload the *host* page, and
   * MolVis usually lives inside someone else's (a notebook cell, a VSCode
   * webview).
   */
  const [viewerGeneration, setViewerGeneration] = useState(0);
  const reloadViewer = useCallback(() => {
    setApp(null);
    setViewerGeneration((n) => n + 1);
  }, []);
  const openCommandPalette = useCallback(() => {
    setCommandPaletteOpen(true);
  }, []);
  useCommandPaletteHotkey(openCommandPalette, !canvasOnly);
  // "Fullscreen" = hide all chrome (top bar, sidebars, status, timeline),
  // leaving only the 3D canvas. The canvas panel stays mounted so the engine
  // is never torn down; exit via the floating button or Esc.
  const [uiHidden, setUiHidden] = useState(false);
  // Wide layouts restore the original three-region work surface: Compute on
  // the left, canvas in the center, and mode tools on the right. Narrow hosts
  // keep the same two panels as edge drawers so the WebGL surface stays useful.
  const [rootRef, isNarrow, shellWidth] = useIsNarrow<HTMLDivElement>(
    INLINE_PANEL_BREAKPOINT,
    COARSE_POINTER_INLINE_PANEL_BREAKPOINT,
  );
  /**
   * Rail floor for this shell width: the percentage floor, or the 240px compute
   * form floor when a percentage would render the rail narrower than the forms
   * are designed for. The same value gates snap-close, so a rail can never rest
   * between "too narrow to use" and "closed".
   */
  const railMinPct = sidePanelMinPct(shellWidth);
  /** Rendered rail width: closed stays closed, open honours the floor. */
  const openRailWidth = (pct: number) =>
    pct <= 0 ? 0 : Math.max(pct, railMinPct);
  // Side-panel open flags are layout-mode agnostic: wide = resizable columns,
  // narrow = edge drawers. Same flags, so resizing the host never "loses"
  // an open tools panel. Bottom workbench stays separate (content-gated).
  //
  // Overlay width is driven by the live layout during drag via DOM only
  // (see handlePanelLayout). React state holds the *committed* size so
  // re-renders never snap the overlay back to a default mid-drag.
  const [computeInlineOpen, setComputeInlineOpen] = useState(false);
  // Once requested, keep the lazy panel mounted so analysis inputs/results
  // survive close/reopen without making the initial page pay its bundle cost.
  const [computePanelLoaded, setComputePanelLoaded] = useState(false);
  // Tools inspector starts open on fine-pointer desktops; coarse-pointer
  // (phones / many tablets) keeps the canvas full-bleed until the user
  // pulls the drawer open.
  const [toolsInlineOpen, setToolsInlineOpen] = useState(() => {
    if (typeof window === "undefined" || !window.matchMedia) return true;
    return !window.matchMedia("(pointer: coarse)").matches;
  });
  const [computeWidthPct, setComputeWidthPct] = useState(0);
  // Match SIDE_PANEL.openDefaultPct when open; 0 when coarse-pointer starts closed.
  const [toolsWidthPct, setToolsWidthPct] = useState<number>(() => {
    if (typeof window === "undefined" || !window.matchMedia)
      return SIDE_PANEL.openDefaultPct;
    return window.matchMedia("(pointer: coarse)").matches
      ? 0
      : SIDE_PANEL.openDefaultPct;
  });
  const computePanelRef = useRef<HTMLElement>(null);
  const toolsPanelRef = useRef<HTMLElement>(null);
  const computeSlotRef = usePanelRef();
  const toolsSlotRef = usePanelRef();
  /** Last open width restored by chrome open (not the snap-close default). */
  const lastComputeWidthRef = useRef<number>(SIDE_PANEL.openDefaultPct);
  const lastToolsWidthRef = useRef<number>(SIDE_PANEL.openDefaultPct);

  useEffect(() => {
    if (computeInlineOpen) {
      setComputePanelLoaded(true);
    }
  }, [computeInlineOpen]);

  const applyOverlayWidth = useCallback(
    (side: "compute" | "tools", pct: number) => {
      const el =
        side === "compute" ? computePanelRef.current : toolsPanelRef.current;
      if (el) el.style.width = `${pct}%`;
    },
    [],
  );

  // Coarse-pointer hosts start with tools closed. When the layout is wide
  // enough for an inline tools slot, collapse that slot so we do not leave
  // a blank column beside an invisible overlay.
  useEffect(() => {
    if (toolsInlineOpen || isNarrow || uiHidden || !chrome.rightSidebar) return;
    const slot = toolsSlotRef.current;
    if (slot && !slot.isCollapsed()) {
      slot.collapse();
    }
    applyOverlayWidth("tools", 0);
  }, [
    toolsInlineOpen,
    isNarrow,
    uiHidden,
    chrome.rightSidebar,
    toolsSlotRef,
    applyOverlayWidth,
  ]);

  const setLeftOpen = useCallback(
    (open: boolean) => {
      if (open) setComputePanelLoaded(true);
      setComputeInlineOpen(open);
      const slot = computeSlotRef.current;
      if (open) {
        const width = Math.max(lastComputeWidthRef.current, railMinPct);
        setComputeWidthPct(width);
        applyOverlayWidth("compute", width);
        if (slot) {
          if (slot.isCollapsed()) slot.expand();
          slot.resize(`${width}%`);
        }
      } else {
        setComputeWidthPct(0);
        applyOverlayWidth("compute", 0);
        if (slot && !slot.isCollapsed()) slot.collapse();
      }
    },
    [computeSlotRef, applyOverlayWidth, railMinPct],
  );

  const setRightOpen = useCallback(
    (open: boolean) => {
      setToolsInlineOpen(open);
      const slot = toolsSlotRef.current;
      if (open) {
        const width = Math.max(lastToolsWidthRef.current, railMinPct);
        setToolsWidthPct(width);
        applyOverlayWidth("tools", width);
        if (slot) {
          if (slot.isCollapsed()) slot.expand();
          slot.resize(`${width}%`);
        }
      } else {
        setToolsWidthPct(0);
        applyOverlayWidth("tools", 0);
        if (slot && !slot.isCollapsed()) slot.collapse();
      }
    },
    [toolsSlotRef, applyOverlayWidth, railMinPct],
  );

  const openLeftAdvancedPanel = useCallback(() => {
    setLeftOpen(true);
  }, [setLeftOpen]);

  const stateSync = useBackendStateSync(app);
  const showInlineCompute = !uiHidden && !isNarrow && chrome.leftSidebar;
  const showInlineTools = !uiHidden && !isNarrow && chrome.rightSidebar;
  const hasInlineSidePanel = showInlineCompute || showInlineTools;
  const {
    defaultLayout: defaultPanelLayout,
    computeSize: defaultComputeSize,
    canvasSize: defaultCanvasSize,
    toolsSize: defaultToolsSize,
  } = resolveViewerPanelLayout({
    showCompute: showInlineCompute,
    showTools: showInlineTools,
  });
  /**
   * Canvas floor for this row. {@link CANVAS_MIN_PCT} assumes rails at
   * {@link SIDE_PANEL.minPct}; when the 240px form floor pushes `railMinPct`
   * above it, every minimum in the row must still sum to ≤ 100 or the group has
   * no layout that satisfies them. Lowering the canvas is the right give: the
   * rails have a designed width, the canvas only needs to stay dominant.
   */
  const canvasMinPct = Math.min(
    CANVAS_MIN_PCT,
    100 -
      railMinPct * ((showInlineCompute ? 1 : 0) + (showInlineTools ? 1 : 0)),
  );
  // Trajectory is a canvas HUD (P0), not status-bar chrome. Single-frame
  // trajectories never show the strip. Fullscreen (uiHidden) still keeps it.
  const showTimeline = chrome.timeline && app !== null && trajectoryLength > 1;
  // P1: status is a canvas overlay, not a layout strip.
  const showStatusOverlay = !uiHidden && chrome.statusBar;

  // VS Code hosts own postMessage IO in vsc-ext (never reverse-depend on page).
  useDevDemo(app, setCurrentMode, opts);

  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if (
        e.key === "?" &&
        !e.ctrlKey &&
        !e.metaKey &&
        !(e.target instanceof HTMLInputElement) &&
        !(e.target instanceof HTMLTextAreaElement)
      ) {
        setShortcutsOpen((prev) => !prev);
      }
      if (e.key === "Escape") {
        // Esc belongs to the canvas modes (clear selection, exit fence…) —
        // never close side panels from here. Only leave hidden-UI fullscreen,
        // which has no other pointer affordance.
        setUiHidden(false);
      }
    };
    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, []);

  const handleModeChange = (mode: string) => {
    if (currentMode !== mode) {
      if (app) {
        app.setMode(mode);
      }
      setCurrentMode(mode);
    }
  };

  /**
   * Live layout (every pointermove while dragging).
   * Width is DOM-only. Open flags may soft-update for visibility, but never
   * call collapse/expand/resize on the slot here — that fights the library
   * and makes the hairline separator jump off the cursor.
   */
  const handlePanelLayout = useCallback(
    (layout: Record<string, number>) => {
      if (layout.compute !== undefined) {
        applyOverlayWidth("compute", layout.compute);
        const open = isSidePanelOpen(layout.compute);
        setComputeInlineOpen((current) => (current === open ? current : open));
      }
      if (layout.tools !== undefined) {
        applyOverlayWidth("tools", layout.tools);
        const open = isSidePanelOpen(layout.tools);
        setToolsInlineOpen((current) => (current === open ? current : open));
      }
    },
    [applyOverlayWidth],
  );

  /**
   * Committed layout (pointer up / keyboard resize end).
   * Snap below min → closed; otherwise record open size for reopen.
   */
  const handlePanelLayoutChanged = useCallback(
    (layout: Record<string, number>) => {
      if (layout.compute !== undefined) {
        const size = layout.compute;
        applyOverlayWidth("compute", size);
        if (size > 0 && size < railMinPct) {
          setLeftOpen(false);
        } else {
          const open = isSidePanelOpen(size);
          if (open) {
            lastComputeWidthRef.current = size;
            setComputeWidthPct(size);
          } else {
            setComputeWidthPct(0);
          }
          setComputeInlineOpen((current) =>
            current === open ? current : open,
          );
        }
      }
      if (layout.tools !== undefined) {
        const size = layout.tools;
        applyOverlayWidth("tools", size);
        if (size > 0 && size < railMinPct) {
          setRightOpen(false);
        } else {
          const open = isSidePanelOpen(size);
          if (open) {
            lastToolsWidthRef.current = size;
            setToolsWidthPct(size);
          } else {
            setToolsWidthPct(0);
          }
          setToolsInlineOpen((current) => (current === open ? current : open));
        }
      }
    },
    [applyOverlayWidth, railMinPct, setLeftOpen, setRightOpen],
  );

  if (canvasOnly) {
    return (
      <ErrorBoundary>
        <BackendConnectionProvider
          app={app}
          initial={{
            wsUrl: opts.wsUrl,
            token: opts.token,
            session: opts.session,
          }}
        >
          <FormatPickerProvider>
            <BondMappingPickerProvider>
              <section
                aria-label="MolVis molecular viewer"
                className="relative h-full w-full bg-background overflow-hidden"
                onContextMenu={(e) => e.preventDefault()}
              >
                <MolvisWrapper key={viewerGeneration} onMount={setApp} />
              </section>
              <StateSyncDialog
                open={stateSync.pending !== null}
                summary={stateSync.pending?.summary ?? null}
                feedback={stateSync.feedback}
                onKeepLocal={stateSync.keepLocal}
                onApplyBackend={() => void stateSync.applyBackend()}
              />
            </BondMappingPickerProvider>
          </FormatPickerProvider>
        </BackendConnectionProvider>
      </ErrorBoundary>
    );
  }

  return (
    <ErrorBoundary>
      <BackendConnectionProvider
        app={app}
        initial={{
          wsUrl: opts.wsUrl,
          token: opts.token,
          session: opts.session,
        }}
      >
        <FormatPickerProvider>
          <BondMappingPickerProvider>
            <LeftShellProvider onOpen={openLeftAdvancedPanel}>
              <section
                ref={rootRef}
                aria-label="MolVis molecular viewer"
                className="relative h-full w-full flex flex-col bg-background text-foreground overflow-hidden safe-area-shell"
                onContextMenu={(e) => e.preventDefault()}
              >
                {!uiHidden && <WeChatOpenBrowserBanner />}

                {!uiHidden && chrome.topBar && (
                  <ViewerToolbar
                    app={app}
                    onToggleFullscreen={() => setUiHidden((v) => !v)}
                    narrow={isNarrow}
                  />
                )}

                <div className="relative min-h-0 flex-1">
                  <ResizablePanelGroup
                    orientation="horizontal"
                    className="h-full"
                    defaultLayout={defaultPanelLayout}
                    onLayoutChange={handlePanelLayout}
                    onLayoutChanged={handlePanelLayoutChanged}
                    resizeTargetMinimumSize={{ fine: 28, coarse: 44 }}
                  >
                    {showInlineCompute && (
                      <ResizablePanel
                        key="compute"
                        id="compute"
                        panelRef={computeSlotRef}
                        defaultSize={defaultComputeSize}
                        collapsible
                        collapsedSize="0%"
                        minSize={`${railMinPct}%`}
                        maxSize={`${SIDE_PANEL.maxPct}%`}
                        aria-hidden="true"
                      />
                    )}

                    {showInlineCompute && (
                      <ResizableHandle
                        key="handle-compute"
                        aria-label="Resize compute panel"
                        className="z-20"
                      />
                    )}

                    <ResizablePanel
                      key="canvas"
                      id="canvas"
                      defaultSize={defaultCanvasSize}
                      minSize={hasInlineSidePanel ? `${canvasMinPct}%` : "100%"}
                      className="flex min-w-0 flex-col"
                    >
                      <div className="relative flex-1 overflow-hidden bg-canvas">
                        <MolvisWrapper
                          key={viewerGeneration}
                          onMount={setApp}
                        />
                        {uiHidden && <CameraTrajectoryOverlay app={app} />}
                        {uiHidden && (
                          <ExitFullscreenAction
                            onExit={() => setUiHidden(false)}
                          />
                        )}
                        {/*
                          Bottom-center HUD stack — single column so status and
                          trajectory never paint on top of each other. Status is
                          embedded (no absolute) when this stack owns layout.
                        */}
                        {(showStatusOverlay || showTimeline) && (
                          <div
                            className={cn(
                              "pointer-events-none absolute inset-x-0 bottom-0 z-20 flex flex-col items-center gap-2",
                              "px-4 pb-4 safe-area-bottom",
                            )}
                          >
                            {showStatusOverlay && (
                              <ViewerStatusOverlay app={app} embedded />
                            )}
                            {showTimeline && (
                              <div
                                className={cn(
                                  "pointer-events-auto w-[min(72vw,56rem)]",
                                  "rounded-xl border border-border/70",
                                  "bg-background/90 text-foreground shadow-sm backdrop-blur-xl",
                                  "dark:bg-background/85 dark:shadow-sm",
                                )}
                              >
                                <div className="h-10">
                                  <TrajectoryTimeline
                                    app={app}
                                    totalFrames={trajectoryLength}
                                    compact={isNarrow}
                                  />
                                </div>
                              </div>
                            )}
                          </div>
                        )}
                      </div>
                    </ResizablePanel>

                    {showInlineTools && (
                      <ResizableHandle
                        key="handle-tools"
                        aria-label="Resize tool panel"
                        className="z-20"
                      />
                    )}

                    {showInlineTools && (
                      <ResizablePanel
                        key="tools"
                        id="tools"
                        panelRef={toolsSlotRef}
                        defaultSize={defaultToolsSize}
                        collapsible
                        collapsedSize="0%"
                        minSize={`${railMinPct}%`}
                        maxSize={`${SIDE_PANEL.maxPct}%`}
                        aria-hidden="true"
                      />
                    )}
                  </ResizablePanelGroup>

                  {isNarrow && (computeInlineOpen || toolsInlineOpen) && (
                    <button
                      type="button"
                      aria-label="Close side panel"
                      onClick={() => {
                        setLeftOpen(false);
                        setRightOpen(false);
                      }}
                      className="motion-fade-in absolute inset-0 z-20 cursor-default bg-scrim"
                    />
                  )}

                  {chrome.leftSidebar && (
                    <ViewerSidePanel
                      drawer={isNarrow}
                      inlineWidth={`${openRailWidth(computeWidthPct)}%`}
                      label="Left panel"
                      open={!uiHidden && computeInlineOpen}
                      panelRef={computePanelRef}
                      side="left"
                    >
                      {computePanelLoaded && (
                        <Suspense
                          fallback={
                            <div
                              role="status"
                              className="flex h-full items-center justify-center px-3 text-label text-muted-foreground"
                            >
                              Loading compute tools…
                            </div>
                          }
                        >
                          <LeftSidebar app={app} />
                        </Suspense>
                      )}
                    </ViewerSidePanel>
                  )}

                  {chrome.rightSidebar && (
                    <ViewerSidePanel
                      drawer={isNarrow}
                      inlineWidth={`${openRailWidth(toolsWidthPct)}%`}
                      label="Right panel"
                      open={!uiHidden && toolsInlineOpen}
                      panelRef={toolsPanelRef}
                      side="right"
                    >
                      <StructureInspector
                        app={app}
                        currentMode={currentMode}
                        onModeChange={handleModeChange}
                      />
                    </ViewerSidePanel>
                  )}
                </div>

                <WorkbenchBottomPanel app={app} hidden={uiHidden} />

                <PluginDialogHost app={app} />

                <CommandPalette
                  app={app}
                  open={commandPaletteOpen}
                  onOpenChange={setCommandPaletteOpen}
                  onModeChange={handleModeChange}
                  onReload={reloadViewer}
                  onReset={() => setResetOpen(true)}
                />

                <ResetMolvisDialog
                  open={resetOpen}
                  onOpenChange={setResetOpen}
                  onCleared={reloadViewer}
                />

                <KeyboardShortcutsDialog
                  open={shortcutsOpen}
                  onOpenChange={setShortcutsOpen}
                />

                <StateSyncDialog
                  open={stateSync.pending !== null}
                  summary={stateSync.pending?.summary ?? null}
                  feedback={stateSync.feedback}
                  onKeepLocal={stateSync.keepLocal}
                  onApplyBackend={() => void stateSync.applyBackend()}
                />
              </section>
            </LeftShellProvider>
          </BondMappingPickerProvider>
        </FormatPickerProvider>
      </BackendConnectionProvider>
    </ErrorBoundary>
  );
};

export default App;
