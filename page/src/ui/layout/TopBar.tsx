import { Button } from "@/components/ui/button";
import { Separator } from "@/components/ui/separator";
import type { Molvis } from "@molvis/core";
import { Redo2, Scan, Trash2, Undo2 } from "lucide-react";
import React from "react";
import { ExportDialog } from "./ExportDialog";
import { ScreenshotDialog } from "./ScreenshotDialog";
import { SettingsDialog } from "./SettingsDialog";
import { ThemeToggle } from "./ThemeToggle";

interface TopBarProps {
  app: Molvis | null;
  currentMode: string;
}

/**
 * Compact toolbar with global actions.
 * Mode switching is owned by the right workbench sidebar.
 */
export const TopBar: React.FC<TopBarProps> = ({ app, currentMode }) => {
  const [canUndo, setCanUndo] = React.useState(false);
  const [canRedo, setCanRedo] = React.useState(false);

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
    <div className="h-8 border-b bg-background flex items-center px-2 gap-2 shrink-0 justify-between">
      <div className="flex items-center gap-2 min-w-0">
        <div className="font-semibold tracking-wide text-xs">MolVis</div>
        <div className="h-4 px-1.5 rounded border bg-muted/30 text-[9px] uppercase tracking-wide text-muted-foreground inline-flex items-center">
          {currentMode}
        </div>
      </div>

      <div className="flex items-center gap-0.5">
        <ScreenshotDialog app={app} />
        <Button
          variant="ghost"
          size="icon-sm"
          onClick={handleReset}
          title="Reset Scene"
        >
          <Trash2 className="h-3.5 w-3.5" />
        </Button>
        <ExportDialog app={app} />
        <Separator orientation="vertical" className="h-4 mx-0.5" />

        <Button
          variant="ghost"
          size="icon-sm"
          onClick={handleUndo}
          title="Undo"
          disabled={!canUndo}
        >
          <Undo2 className="h-3.5 w-3.5" />
        </Button>
        <Button
          variant="ghost"
          size="icon-sm"
          onClick={handleRedo}
          title="Redo"
          disabled={!canRedo}
        >
          <Redo2 className="h-3.5 w-3.5" />
        </Button>

        <Separator orientation="vertical" className="h-4 mx-0.5" />

        <Button
          variant="ghost"
          size="icon-sm"
          onClick={handleResetCamera}
          title="Reset Camera"
        >
          <Scan className="h-3.5 w-3.5" />
        </Button>

        <Separator orientation="vertical" className="h-4 mx-0.5" />

        <ThemeToggle />
        <SettingsDialog app={app} />
      </div>
    </div>
  );
};
