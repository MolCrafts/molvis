import { DataSourceModifier, type Molvis } from "@molvis/core";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";

export function sceneHasLoadedData(app: Molvis | null): boolean {
  if (!app) return false;
  return app.modifierPipeline
    .getModifiers()
    .some(
      (modifier) =>
        modifier instanceof DataSourceModifier &&
        modifier.sourceType !== "empty",
    );
}

interface FileLoadConfirmDialogProps {
  open: boolean;
  filename: string;
  onCancel: () => void;
  onAddSource: () => void;
  onReplace: () => void;
  onExtend: () => void;
}

export const FileLoadConfirmDialog: React.FC<FileLoadConfirmDialogProps> = ({
  open,
  filename,
  onCancel,
  onAddSource,
  onReplace,
  onExtend,
}) => (
  <Dialog open={open} onOpenChange={(next) => !next && onCancel()}>
    <DialogContent className="max-w-[400px] gap-3 p-4">
      <DialogHeader>
        <DialogTitle className="text-sm">Load file</DialogTitle>
      </DialogHeader>
      <div className="space-y-2 text-xs">
        <div className="truncate font-mono">{filename}</div>
        <div className="text-muted-foreground space-y-1">
          <p>A scene is already loaded. Choose how to load this file.</p>
          <ul className="list-disc pl-4 space-y-0.5 text-[11px]">
            <li>
              <strong>Replace</strong> — clear the scene and load as the single
              source
            </li>
            <li>
              <strong>Add</strong> — keep existing sources, add as a separate
              source
            </li>
            <li>
              <strong>Extend</strong> — merge all atoms into one combined source
            </li>
          </ul>
        </div>
      </div>
      <DialogFooter>
        <Button type="button" variant="ghost" size="sm" onClick={onCancel}>
          Cancel
        </Button>
        <Button type="button" variant="outline" size="sm" onClick={onExtend}>
          Extend
        </Button>
        <Button type="button" variant="outline" size="sm" onClick={onAddSource}>
          Add
        </Button>
        <Button type="button" size="sm" onClick={onReplace}>
          Replace
        </Button>
      </DialogFooter>
    </DialogContent>
  </Dialog>
);
