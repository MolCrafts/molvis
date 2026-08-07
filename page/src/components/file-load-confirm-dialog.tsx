import type { Molvis } from "@molcrafts/molvis-stage";
import {
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { ViewerAction } from "@/components/viewer/ViewerAction";

export function sceneHasLoadedData(app: Molvis | null): boolean {
  if (!app) return false;
  return app.modifierPipeline
    .sources()
    .some((source) => source.sourceType !== "empty");
}

interface FileLoadConfirmDialogProps {
  open: boolean;
  filename: string;
  busy?: boolean;
  onCancel: () => void;
  onAddSource: () => void;
  onReplace: () => void;
  onExtend: () => void;
}

/** Ask how to load a file when the scene already has data. */
export const FileLoadConfirmDialog: React.FC<FileLoadConfirmDialogProps> = ({
  open,
  filename,
  busy = false,
  onCancel,
  onAddSource,
  onReplace,
  onExtend,
}) => (
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
        <DialogTitle className="text-sm">Load into scene</DialogTitle>
      </DialogHeader>

      <div className="space-y-2 text-xs">
        <div className="truncate font-mono" title={filename}>
          {filename}
        </div>
        <p className="text-micro text-muted-foreground">
          Scene already has data — choose how to combine.
        </p>
        {busy && (
          <p
            role="status"
            aria-live="polite"
            className="text-micro text-muted-foreground"
          >
            Waiting for the current viewer operation…
          </p>
        )}
      </div>

      <DialogFooter className="flex-col gap-2 sm:flex-col sm:space-x-0">
        <div className="grid w-full grid-cols-3 gap-1.5">
          <ViewerAction
            className="w-full"
            disabled={busy}
            onClick={onReplace}
            title="Clear the scene and load this file"
          >
            Replace
          </ViewerAction>
          <ViewerAction
            purpose="dismiss"
            className="w-full"
            disabled={busy}
            onClick={onAddSource}
            title="Keep existing data and add this as another source"
          >
            Add
          </ViewerAction>
          <ViewerAction
            purpose="dismiss"
            className="w-full"
            disabled={busy}
            onClick={onExtend}
            title="Concatenate atoms into the current structure"
          >
            Extend
          </ViewerAction>
        </div>
        <ViewerAction
          purpose="dismiss"
          className="w-full"
          disabled={busy}
          onClick={onCancel}
        >
          Cancel
        </ViewerAction>
      </DialogFooter>
    </DialogContent>
  </Dialog>
);
