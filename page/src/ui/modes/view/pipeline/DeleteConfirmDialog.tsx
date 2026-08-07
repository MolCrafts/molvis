import type { PipelineEntry } from "@molcrafts/molvis-stage";
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

interface DeleteConfirmDialogProps {
  open: boolean;
  modifier: PipelineEntry;
  descendants: PipelineEntry[];
  busy: boolean;
  onConfirm: () => void;
  onCancel: () => void;
}

export const DeleteConfirmDialog: React.FC<DeleteConfirmDialogProps> = ({
  open,
  modifier,
  descendants,
  busy,
  onConfirm,
  onCancel,
}) => {
  return (
    <Dialog open={open} onOpenChange={(isOpen) => !isOpen && onCancel()}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Delete {modifier.name}?</DialogTitle>
          <DialogDescription>
            This will also delete the following dependent modifiers:
          </DialogDescription>
        </DialogHeader>

        <ul className="list-disc space-y-1 pl-6 text-sm">
          {descendants.map((desc) => (
            <li key={desc.id} className="text-muted-foreground">
              {desc.name}
            </li>
          ))}
        </ul>

        <DialogFooter>
          <ViewerAction purpose="dismiss" disabled={busy} onClick={onCancel}>
            Cancel
          </ViewerAction>
          <ViewerAction purpose="remove" disabled={busy} onClick={onConfirm}>
            {busy ? "Deleting…" : "Delete All"}
          </ViewerAction>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
};
