import { Loader2 } from "lucide-react";
import type React from "react";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { ViewerAction } from "@/components/viewer/ViewerAction";
import { ViewerOperationState } from "@/components/viewer/ViewerOperationState";
import type { BackendStateSyncFeedback } from "@/hooks/useBackendStateSync";

export interface StateSyncDialogProps {
  open: boolean;
  summary: { nModifiers: number; nFrames: number } | null;
  /** In-dialog apply progress/error only (tips go to the bottom status bar). */
  feedback: BackendStateSyncFeedback | null;
  onKeepLocal(): void;
  onApplyBackend(): void;
}

/**
 * Prompt the user when the backend hands over a non-empty state but
 * the local pipeline is also non-empty. Two choices — no merge: either
 * keep what's currently on the canvas, or drop it and apply the
 * backend's snapshot.
 *
 * Success/error tips after apply land in the bottom status bar, never a
 * floating toast card.
 */
export const StateSyncDialog: React.FC<StateSyncDialogProps> = ({
  open,
  summary,
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
          <DialogTitle>Backend has pending state</DialogTitle>
          <DialogDescription>
            The Python controller sent a scene snapshot that differs from what's
            currently on the canvas. Pick one — there is no merge.
          </DialogDescription>
        </DialogHeader>

        {summary && (
          <div className="rounded-control border bg-muted/30 px-3 py-2 text-xs text-muted-foreground">
            backend snapshot · {summary.nModifiers} modifier
            {summary.nModifiers === 1 ? "" : "s"} · {summary.nFrames} frame
            {summary.nFrames === 1 ? "" : "s"}
          </div>
        )}

        {feedback && feedback.phase !== "success" && (
          <ViewerOperationState {...feedback} />
        )}

        <DialogFooter className="gap-2">
          <ViewerAction
            purpose="dismiss"
            onClick={onKeepLocal}
            disabled={applying}
          >
            Keep local
          </ViewerAction>
          <ViewerAction
            onClick={onApplyBackend}
            disabled={applying}
            aria-busy={applying}
          >
            {applying && <Loader2 className="animate-spin" />}
            {applying ? "Applying…" : "Apply backend"}
          </ViewerAction>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
};
