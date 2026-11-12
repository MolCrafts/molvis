import { SpinnerIosRegular as Loader2 } from "@fluentui/react-icons";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@molcrafts/ui";
import type React from "react";
import { ViewerAction } from "@/components/viewer/ViewerAction";
import { ViewerOperationState } from "@/components/viewer/ViewerOperationState";
import type { BackendStateSyncFeedback } from "@/hooks/useBackendStateSync";

export interface StateSyncDialogProps {
  open: boolean;
  /** In-dialog apply progress/error only (tips go to the bottom status bar). */
  feedback: BackendStateSyncFeedback | null;
  onKeepLocal(): void;
  onApplyBackend(): void;
}

/**
 * Shown only when the canvas already has a structure or a modifier and
 * Python hands over a scene. Two choices: keep the canvas, or replace it.
 */
export const StateSyncDialog: React.FC<StateSyncDialogProps> = ({
  open,
  feedback,
  onKeepLocal,
  onApplyBackend,
}) => {
  const applying = feedback?.phase === "running";

  return (
    <Dialog
      open={open}
      onOpenChange={(next) => {
        if (!next && !applying) onKeepLocal();
      }}
    >
      <DialogContent className="max-w-dialog-sm">
        <DialogHeader>
          <DialogTitle>Replace the scene?</DialogTitle>
          <DialogDescription>
            Keep this canvas, or use Python's.
          </DialogDescription>
        </DialogHeader>

        {feedback && feedback.phase !== "success" && (
          <ViewerOperationState {...feedback} />
        )}

        <DialogFooter className="gap-2">
          <ViewerAction
            purpose="dismiss"
            onClick={onKeepLocal}
            disabled={applying}
          >
            Keep
          </ViewerAction>
          <ViewerAction
            onClick={onApplyBackend}
            disabled={applying}
            aria-busy={applying}
          >
            {applying && <Loader2 className="animate-spin" />}
            {applying ? "Replacing…" : "Replace"}
          </ViewerAction>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
};
