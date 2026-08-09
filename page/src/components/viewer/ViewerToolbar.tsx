import { MOLVIS_VERSION, type Molvis } from "@molcrafts/molvis-stage";
import {
  BrushCleaning,
  Download,
  Focus,
  Maximize,
  Redo2,
  Save,
  Share2,
  Undo2,
} from "lucide-react";
import React from "react";
// Same brand mark as vsc-ext marketplace icon (vsc-ext/image/molvis-icon.png).
import molvisLogoUrl from "@/assets/molvis-logo-48.png";
import { Separator } from "@/components/ui/separator";
import { usePwaInstall } from "@/hooks/usePwaInstall";
import {
  buildShareUrl,
  readRememberedShareable,
  shareOrCopyUrl,
} from "@/lib/open-structure";
import { reportStatus } from "@/lib/status-report";
import { ExportDialog } from "@/ui/layout/ExportDialog";
import { ExportProjectDialog } from "@/ui/layout/ExportProjectDialog";
import { ScreenshotDialog } from "@/ui/layout/ScreenshotDialog";
import { SettingsDialog } from "@/ui/layout/SettingsDialog";
import { ThemeToggle } from "@/ui/layout/ThemeToggle";
import { AtomSelectionBadge } from "./AtomSelectionBadge";
import { IosInstallTipDialog } from "./IosInstallTipDialog";
import { ViewerIconAction } from "./ViewerIconAction";

interface ViewerToolbarProps {
  app: Molvis | null;
  /** Enter "fullscreen" = hide all UI chrome, leaving only the 3D canvas. */
  onToggleFullscreen: () => void;
  /**
   * Narrow layout: drop the version and the secondary actions
   * (screenshot, export, clear) so the essential controls — including
   * Settings — never overflow and clip off-screen. Those actions remain
   * available in the wider editor-tab layout.
   */
  narrow?: boolean;
}

/**
 * Viewer toolbar with identity, context, and global scene actions.
 * Mode is shown by core's canvas ModePanel, not here.
 * Side panels open via the canvas edge drag rails (not toolbar toggles).
 */
export const ViewerToolbar: React.FC<ViewerToolbarProps> = ({
  app,
  onToggleFullscreen,
  narrow = false,
}) => {
  const [canUndo, setCanUndo] = React.useState(false);
  const [canRedo, setCanRedo] = React.useState(false);
  const [sceneDirty, setSceneDirty] = React.useState(false);
  const { offer, install, showIosTip, dismissIosTip } = usePwaInstall();

  React.useEffect(() => {
    if (!app) {
      setSceneDirty(false);
      return;
    }
    setSceneDirty(app.world.sceneIndex.hasUnsavedChanges);
    return app.events.on("dirty-change", (isDirty) => {
      setSceneDirty(isDirty);
    });
  }, [app]);

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
      const target = e.target;
      const isEditingText =
        target instanceof HTMLElement &&
        (target.isContentEditable ||
          target.matches("input, textarea, select") ||
          target.closest('[contenteditable="true"]') !== null);
      if (e.defaultPrevented || isEditingText) return;

      const mod = e.ctrlKey || e.metaKey;
      if (!mod) return;

      const key = e.key.toLowerCase();
      // Global save — any mode, even when focus is outside the canvas
      // (sidebar, dialog chrome). Mirrors Office: Save is not mode-gated.
      if (key === "s" && !e.shiftKey) {
        app.commitScene();
        e.preventDefault();
        e.stopPropagation();
        return;
      }
      if (key === "z") {
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

  const handleSave = () => {
    if (!app) return;
    app.commitScene();
  };

  const handleUndo = () => {
    if (app) app.commandManager.undo();
  };

  const handleRedo = () => {
    if (app) app.commandManager.redo();
  };

  const handleResetCamera = () => {
    if (app?.world) {
      app.world.fit();
    }
  };

  const handleReset = () => {
    if (app) app.reset();
  };

  const handleShareLink = async () => {
    const share = readRememberedShareable();
    if (!share) {
      reportStatus(
        "Load a PDB id or public URL first (Link / share), then share again",
        "info",
      );
      return;
    }
    const link = buildShareUrl(share);
    const result = await shareOrCopyUrl(
      link,
      share.kind === "pdb" ? share.pdbId : "MolVis structure",
    );
    if (result === "shared") reportStatus("Share sheet opened", "success");
    else if (result === "copied") reportStatus("Share link copied", "success");
    else reportStatus("Could not share or copy the link", "error");
  };

  const handleInstall = async () => {
    const result = await install();
    if (result === "accepted") reportStatus("MolVis installed", "success");
  };

  return (
    <div className="flex h-toolbar shrink-0 items-center justify-between gap-2 border-b border-border bg-background px-2">
      <div className="flex items-center gap-2 min-w-0">
        <img
          src={molvisLogoUrl}
          alt=""
          width={24}
          height={24}
          className="size-6 shrink-0 rounded-control"
          draggable={false}
        />
        <span
          className="rounded-control px-1 text-title font-semibold tracking-tight"
          title={
            sceneDirty
              ? "Unsaved canvas edits — Save or Ctrl+S / ⌘S"
              : undefined
          }
        >
          MolVis{sceneDirty ? "*" : ""}
        </span>
        {!narrow && (
          <span
            title="Package version (history is git tags / log)"
            className="rounded-control px-1 font-mono text-micro leading-none text-muted-foreground"
          >
            v{MOLVIS_VERSION}
          </span>
        )}
        <AtomSelectionBadge app={app} compact={narrow} />
      </div>

      <div className="flex items-center gap-1">
        {/* File actions (Office-style: Save first, then secondary tools) */}
        <ViewerIconAction
          icon={<Save className={sceneDirty ? "text-accent" : undefined} />}
          label={
            sceneDirty
              ? "Save scene (Ctrl+S / ⌘S)"
              : "Save scene — no unsaved changes"
          }
          onClick={handleSave}
          disabled={!app || !sceneDirty}
          className={
            sceneDirty
              ? "text-foreground data-[disabled]:opacity-100"
              : undefined
          }
        />

        {!narrow && (
          <>
            <ScreenshotDialog app={app} />
            <ViewerIconAction
              icon={<BrushCleaning />}
              label="Clear"
              onClick={handleReset}
            />
            <ExportDialog app={app} />
            <ExportProjectDialog app={app} />
          </>
        )}

        <Separator orientation="vertical" className="h-4 mx-1" />

        <ViewerIconAction
          icon={<Undo2 />}
          label="Undo"
          onClick={handleUndo}
          disabled={!canUndo}
        />
        <ViewerIconAction
          icon={<Redo2 />}
          label="Redo"
          onClick={handleRedo}
          disabled={!canRedo}
        />

        <Separator orientation="vertical" className="h-4 mx-1" />

        <ViewerIconAction
          icon={<Focus />}
          label="Reset camera"
          onClick={handleResetCamera}
        />

        <ViewerIconAction
          icon={<Maximize />}
          label="Fullscreen (hide UI)"
          onClick={onToggleFullscreen}
        />

        <Separator orientation="vertical" className="h-4 mx-1" />

        <ViewerIconAction
          icon={<Share2 />}
          label="Copy or share structure link"
          onClick={() => void handleShareLink()}
        />

        {offer.kind !== "none" && (
          <ViewerIconAction
            icon={<Download />}
            label={
              offer.kind === "ios-tip"
                ? "Add to Home Screen (iOS)"
                : "Install MolVis app"
            }
            onClick={() => void handleInstall()}
          />
        )}

        <ThemeToggle />
        <SettingsDialog app={app} />
        <IosInstallTipDialog
          open={showIosTip}
          onOpenChange={(open) => {
            if (!open) dismissIosTip();
          }}
        />
      </div>
    </div>
  );
};
