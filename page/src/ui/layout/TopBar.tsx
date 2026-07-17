import type { Molvis } from "@molvis/core";
import {
  BrushCleaning,
  Focus,
  Maximize,
  PanelLeft,
  PanelLeftClose,
  Redo2,
  Undo2,
} from "lucide-react";
import React from "react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Separator } from "@/components/ui/separator";
import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from "@/components/ui/tooltip";
import { APP_VERSION } from "@/lib/changelog";
import { ChangelogDialog } from "./ChangelogDialog";
import { ExportDialog } from "./ExportDialog";
import { ScreenshotDialog } from "./ScreenshotDialog";
import { SettingsDialog } from "./SettingsDialog";
import { ThemeToggle } from "./ThemeToggle";

interface TopBarProps {
  app: Molvis | null;
  currentMode: string;
  /** Enter "fullscreen" = hide all UI chrome, leaving only the 3D canvas. */
  onToggleFullscreen: () => void;
  /**
   * Narrow layout: drop the wordmark/version and the secondary actions
   * (screenshot, export, reset scene) so the essential controls — including
   * Settings — never overflow and clip off-screen. Those actions remain
   * available in the wider editor-tab layout.
   */
  narrow?: boolean;
  /**
   * Whether the inline analysis panel is showing. Pass `undefined` — together
   * with `onToggleAnalysis` — when the host hides that panel entirely.
   */
  analysisOpen?: boolean;
  onToggleAnalysis?: () => void;
}

/**
 * Compact toolbar with global actions.
 * Mode switching is owned by the right workbench sidebar.
 *
 * Chrome language mirrors molexp ContextBar: monogram mark, semantic badge,
 * ghost icon buttons with tooltips, hairline separators.
 */
export const TopBar: React.FC<TopBarProps> = ({
  app,
  currentMode,
  onToggleFullscreen,
  narrow = false,
  analysisOpen,
  onToggleAnalysis,
}) => {
  const [canUndo, setCanUndo] = React.useState(false);
  const [canRedo, setCanRedo] = React.useState(false);
  const [changelogOpen, setChangelogOpen] = React.useState(false);

  React.useEffect(() => {
    if (!app) return;

    setCanUndo(app.commandManager.canUndo());
    setCanRedo(app.commandManager.canRedo());

    const updateHistory = (state: { canUndo: boolean; canRedo: boolean }) => {
      setCanUndo(state.canUndo);
      setCanRedo(state.canRedo);
    };

    app.events.on("history-change", updateHistory);

    const handleKeyDown = (e: KeyboardEvent) => {
      if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === "z") {
        if (e.shiftKey) {
          app.commandManager.redo();
        } else {
          app.commandManager.undo();
        }
        e.preventDefault();
        e.stopPropagation();
      }
    };

    window.addEventListener("keydown", handleKeyDown);

    return () => {
      app.events.off("history-change", updateHistory);
      window.removeEventListener("keydown", handleKeyDown);
    };
  }, [app]);

  const handleUndo = () => {
    if (app) app.commandManager.undo();
  };

  const handleRedo = () => {
    if (app) app.commandManager.redo();
  };

  const handleResetCamera = () => {
    if (app?.world) {
      app.world.resetCamera();
    }
  };

  const handleReset = () => {
    if (app) app.reset();
  };

  return (
    <>
      <div className="h-8 border-b border-border/70 bg-background/95 backdrop-blur flex items-center px-2 gap-2 shrink-0 justify-between">
        <div className="flex items-center gap-2 min-w-0">
          {!narrow && (
            <>
              <button
                type="button"
                onClick={() => setChangelogOpen(true)}
                title="Version & changelog"
                className="flex h-6 w-6 shrink-0 items-center justify-center rounded-md bg-foreground text-[10px] font-semibold uppercase tracking-[0.18em] text-background focus:outline-none focus-visible:ring-1 focus-visible:ring-ring"
              >
                V
              </button>
              <button
                type="button"
                onClick={() => setChangelogOpen(true)}
                title="Version & changelog"
                className="font-semibold tracking-tight text-xs hover:text-foreground/80 transition-colors cursor-pointer focus:outline-none focus-visible:ring-1 focus-visible:ring-ring rounded px-0.5"
              >
                MolVis
              </button>
              <button
                type="button"
                onClick={() => setChangelogOpen(true)}
                title="Version & changelog"
                className="font-mono text-[10px] leading-none text-muted-foreground/60 hover:text-muted-foreground transition-colors cursor-pointer focus:outline-none focus-visible:ring-1 focus-visible:ring-ring rounded px-0.5"
              >
                v{APP_VERSION}
              </button>
            </>
          )}
          <Badge
            variant="secondary"
            className="h-5 rounded-sm px-1.5 text-[10px] font-medium uppercase tracking-wide"
          >
            {currentMode}
          </Badge>
        </div>

        <div className="flex items-center gap-0.5">
          {!narrow && onToggleAnalysis && (
            <>
              <Tooltip>
                <TooltipTrigger asChild>
                  <Button
                    variant="ghost"
                    size="icon-sm"
                    className="h-7 w-7"
                    onClick={onToggleAnalysis}
                    aria-pressed={analysisOpen}
                    aria-label="Toggle analysis panel"
                  >
                    {analysisOpen ? (
                      <PanelLeftClose className="h-3.5 w-3.5" />
                    ) : (
                      <PanelLeft className="h-3.5 w-3.5" />
                    )}
                  </Button>
                </TooltipTrigger>
                <TooltipContent side="bottom">
                  {analysisOpen ? "Hide analysis panel" : "Show analysis panel"}
                </TooltipContent>
              </Tooltip>
              <Separator orientation="vertical" className="h-4 mx-0.5" />
            </>
          )}
          {!narrow && (
            <>
              <ScreenshotDialog app={app} />
              <Tooltip>
                <TooltipTrigger asChild>
                  <Button
                    variant="ghost"
                    size="icon-sm"
                    className="h-7 w-7"
                    onClick={handleReset}
                    aria-label="Reset Scene"
                  >
                    <BrushCleaning className="h-3.5 w-3.5" />
                  </Button>
                </TooltipTrigger>
                <TooltipContent side="bottom">Reset Scene</TooltipContent>
              </Tooltip>
              <ExportDialog app={app} />
              <Separator orientation="vertical" className="h-4 mx-0.5" />
            </>
          )}

          <Tooltip>
            <TooltipTrigger asChild>
              <Button
                variant="ghost"
                size="icon-sm"
                className="h-7 w-7"
                onClick={handleUndo}
                aria-label="Undo"
                disabled={!canUndo}
              >
                <Undo2 className="h-3.5 w-3.5" />
              </Button>
            </TooltipTrigger>
            <TooltipContent side="bottom">Undo</TooltipContent>
          </Tooltip>
          <Tooltip>
            <TooltipTrigger asChild>
              <Button
                variant="ghost"
                size="icon-sm"
                className="h-7 w-7"
                onClick={handleRedo}
                aria-label="Redo"
                disabled={!canRedo}
              >
                <Redo2 className="h-3.5 w-3.5" />
              </Button>
            </TooltipTrigger>
            <TooltipContent side="bottom">Redo</TooltipContent>
          </Tooltip>

          <Separator orientation="vertical" className="h-4 mx-0.5" />

          <Tooltip>
            <TooltipTrigger asChild>
              <Button
                variant="ghost"
                size="icon-sm"
                className="h-7 w-7"
                onClick={handleResetCamera}
                aria-label="Reset Camera"
              >
                <Focus className="h-3.5 w-3.5" />
              </Button>
            </TooltipTrigger>
            <TooltipContent side="bottom">Reset Camera</TooltipContent>
          </Tooltip>

          <Tooltip>
            <TooltipTrigger asChild>
              <Button
                variant="ghost"
                size="icon-sm"
                className="h-7 w-7"
                onClick={onToggleFullscreen}
                aria-label="Fullscreen (hide UI)"
              >
                <Maximize className="h-3.5 w-3.5" />
              </Button>
            </TooltipTrigger>
            <TooltipContent side="bottom">Fullscreen (hide UI)</TooltipContent>
          </Tooltip>

          <Separator orientation="vertical" className="h-4 mx-0.5" />

          <ThemeToggle />
          <SettingsDialog app={app} />
        </div>
      </div>
      <ChangelogDialog open={changelogOpen} onOpenChange={setChangelogOpen} />
    </>
  );
};
