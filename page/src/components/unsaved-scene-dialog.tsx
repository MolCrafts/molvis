import type { Molvis } from "@molcrafts/molvis-stage";
import {
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { ViewerAction } from "@/components/viewer/ViewerAction";

/** True when the working tree has edits not yet committed to molrs HEAD. */
export function sceneHasUnsavedEdits(app: Molvis | null): boolean {
  return app?.world.sceneIndex.hasUnsavedChanges ?? false;
}

interface UnsavedSceneDialogProps {
  open: boolean;
  title?: string;
  description?: string;
  busy?: boolean;
  onCancel: () => void;
  onSave: () => void;
  /**
   * When set, shows a three-way wipe gate (Save / Don’t save / Cancel).
   * Omit for commit-required flows (Save / Cancel only) — never silent
   * commit; the user must choose Save or Cancel.
   */
  onDiscard?: () => void;
  /** Primary button label. Defaults to "Save". */
  saveLabel?: string;
}

/**
 * Gate for actions that need a decision about uncommitted working-tree edits.
 *
 * - With {@link onDiscard}: destructive wipe (load replace, reset, …).
 * - Without {@link onDiscard}: commit-required (optimize, …) — Save or Cancel.
 */
export const UnsavedSceneDialog: React.FC<UnsavedSceneDialogProps> = ({
  open,
  title = "Unsaved scene edits",
  description = "The canvas has unsaved changes. Save (Ctrl+S) keeps them; Don’t save discards them.",
  busy = false,
  onCancel,
  onSave,
  onDiscard,
  saveLabel = "Save",
}) => {
  const threeWay = onDiscard !== undefined;
  return (
    <Dialog
      open={open}
      onOpenChange={(next) => {
        if (!next && !busy) onCancel();
      }}
    >
      <DialogContent
        className="max-w-dialog-sm gap-3 p-4"
        aria-busy={busy}
        showCloseButton={!busy}
      >
        <DialogHeader>
          <DialogTitle className="text-sm">{title}</DialogTitle>
        </DialogHeader>
        <p className="text-micro text-muted-foreground">{description}</p>
        <DialogFooter className="flex-col gap-2 sm:flex-col sm:space-x-0">
          <div
            className={
              threeWay
                ? "grid w-full grid-cols-3 gap-1.5"
                : "grid w-full grid-cols-2 gap-1.5"
            }
          >
            <ViewerAction className="w-full" disabled={busy} onClick={onSave}>
              {saveLabel}
            </ViewerAction>
            {threeWay && (
              <ViewerAction
                className="w-full"
                disabled={busy}
                onClick={onDiscard}
              >
                Don’t save
              </ViewerAction>
            )}
            <ViewerAction className="w-full" disabled={busy} onClick={onCancel}>
              Cancel
            </ViewerAction>
          </div>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
};
