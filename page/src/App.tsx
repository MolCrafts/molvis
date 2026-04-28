import { ErrorBoundary } from "@/components/ErrorBoundary";
import { TimelineControl } from "@/components/TimelineControl";
import { BondMappingPickerProvider } from "@/components/bond-column-mapping-dialog";
import { FormatPickerProvider } from "@/components/format-picker-dialog";
import {
  ResizableHandle,
  ResizablePanel,
  ResizablePanelGroup,
} from "@/components/ui/resizable";
import { useDevDemo } from "@/dev/useDevDemo";
import { BackendConnectionProvider } from "@/hooks/useBackendConnection";
import { useBackendStateSync } from "@/hooks/useBackendStateSync";
import { useHostFileBridge } from "@/hooks/useHostFileBridge";
import { useMolvisUiState } from "@/hooks/useMolvisUiState";
import { useStatusMessage } from "@/hooks/useStatusMessage";
import { useMountOpts } from "@/lib/mount-opts";
import type { Molvis } from "@molvis/core";
import type React from "react";
import { useEffect, useState } from "react";
import MolvisWrapper from "./MolvisWrapper";
import { KeyboardShortcutsDialog } from "./ui/layout/KeyboardShortcutsDialog";
import { LeftSidebar } from "./ui/layout/LeftSidebar";
import { RightSidebar } from "./ui/layout/RightSidebar";
import { StateSyncDialog } from "./ui/layout/StateSyncDialog";
import { TopBar } from "./ui/layout/TopBar";

/**
 * Main page application shell for the MolVis viewer.
 *
 * When mounted with `opts.minimal`, all chrome is hidden and only the
 * 3D canvas is rendered (useful for embeds that supply their own UI).
 */
const App: React.FC = () => {
  const opts = useMountOpts();
  const minimalMode = Boolean(opts.minimal);

  const [app, setApp] = useState<Molvis | null>(null);
  const { currentMode, setCurrentMode, trajectoryLength } =
    useMolvisUiState(app);
  const { statusMessage, statusType } = useStatusMessage(app);

  const [shortcutsOpen, setShortcutsOpen] = useState(false);
  const stateSync = useBackendStateSync(app);

  useHostFileBridge(app);
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
    };
    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, []);

  const handleModeSwitch = (mode: string) => {
    if (!app) {
      return;
    }
    app.setMode(mode);
    setCurrentMode(mode);
  };

  if (minimalMode) {
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
              <div
                className="h-full w-full bg-background overflow-hidden"
                onContextMenu={(e) => e.preventDefault()}
              >
                <MolvisWrapper onMount={setApp} />
              </div>
              <StateSyncDialog
                open={stateSync.pending !== null}
                summary={stateSync.pending?.summary ?? null}
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
            <div
              className="h-full w-full flex flex-col bg-background text-foreground overflow-hidden"
              onContextMenu={(e) => e.preventDefault()}
            >
              <TopBar app={app} currentMode={currentMode} />

              <ResizablePanelGroup
                orientation="horizontal"
                className="flex-1"
                defaultLayout={{ left: 0, canvas: 87, right: 13 }}
                resizeTargetMinimumSize={{ fine: 20, coarse: 36 }}
              >
                <ResizablePanel
                  id="left"
                  defaultSize="0%"
                  collapsible={true}
                  collapsedSize="0%"
                  minSize="14%"
                  maxSize="38%"
                  className="bg-background flex flex-col min-w-0"
                >
                  <LeftSidebar app={app} />
                </ResizablePanel>

                <ResizableHandle withHandle />

                <ResizablePanel
                  id="canvas"
                  defaultSize="87%"
                  minSize="35%"
                  className="flex flex-col min-w-[360px]"
                >
                  <div className="flex-1 relative bg-muted/20 overflow-hidden">
                    <MolvisWrapper onMount={setApp} />
                  </div>

                  {app && trajectoryLength > 1 && (
                    <div className="h-9 border-t bg-muted/20 shrink-0 z-10">
                      <TimelineControl
                        app={app}
                        totalFrames={trajectoryLength}
                      />
                    </div>
                  )}
                </ResizablePanel>

                <ResizableHandle withHandle />

                <ResizablePanel
                  id="right"
                  defaultSize="13%"
                  minSize="10%"
                  maxSize="40%"
                  collapsible={true}
                  collapsedSize="0%"
                  className="bg-background flex flex-col min-w-0"
                >
                  <RightSidebar
                    app={app}
                    currentMode={currentMode}
                    onModeChange={handleModeSwitch}
                  />
                </ResizablePanel>
              </ResizablePanelGroup>

              <div
                className={`h-4 border-t bg-muted/60 flex items-center px-2 text-[9px] shrink-0 ${statusType === "error" ? "text-red-500 font-bold bg-red-100/10" : "text-muted-foreground"}`}
              >
                {statusMessage}
              </div>

              <KeyboardShortcutsDialog
                open={shortcutsOpen}
                onOpenChange={setShortcutsOpen}
              />

              <StateSyncDialog
                open={stateSync.pending !== null}
                summary={stateSync.pending?.summary ?? null}
                onKeepLocal={stateSync.keepLocal}
                onApplyBackend={() => void stateSync.applyBackend()}
              />
            </div>
          </BondMappingPickerProvider>
        </FormatPickerProvider>
      </BackendConnectionProvider>
    </ErrorBoundary>
  );
};

export default App;
