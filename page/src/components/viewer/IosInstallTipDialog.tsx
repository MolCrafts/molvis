import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { ViewerAction } from "@/components/viewer/ViewerAction";
import { iosAddToHomeHint } from "@/lib/platform";

interface IosInstallTipDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
}

/**
 * iOS has no beforeinstallprompt — explain Add to Home Screen and its limits.
 */
export function IosInstallTipDialog({
  open,
  onOpenChange,
}: IosInstallTipDialogProps): React.ReactElement {
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-sm">
        <DialogHeader>
          <DialogTitle>Add MolVis to Home Screen</DialogTitle>
          <DialogDescription className="space-y-2">
            <span className="block">{iosAddToHomeHint()}</span>
            <span className="block text-label">
              Open files with Open file — not “Open with”.
            </span>
          </DialogDescription>
        </DialogHeader>
        <DialogFooter>
          <ViewerAction
            type="button"
            purpose="commit"
            onClick={() => onOpenChange(false)}
          >
            Got it
          </ViewerAction>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
