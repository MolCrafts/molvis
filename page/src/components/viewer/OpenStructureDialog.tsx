import { useState } from "react";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { ViewerAction } from "@/components/viewer/ViewerAction";
import {
  buildShareUrl,
  type ResolvedOpenInput,
  resolveOpenInput,
  shareOrCopyUrl,
} from "@/lib/open-structure";
import { reportStatus } from "@/lib/status-report";

export interface OpenStructureRequest {
  filename: string;
  url: string;
  share: ResolvedOpenInput["share"];
}

interface OpenStructureDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onSubmit: (request: OpenStructureRequest) => void;
}

/**
 * Paste a PDB id, structure URL, or existing MolVis deep link.
 * Load opens it here; Copy / Share builds the deep link so nobody hand-edits query params.
 */
export function OpenStructureDialog({
  open,
  onOpenChange,
  onSubmit,
}: OpenStructureDialogProps): React.ReactElement {
  const [value, setValue] = useState("");
  const [error, setError] = useState<string | null>(null);

  const resolveOrError = (): ResolvedOpenInput | null => {
    const resolved = resolveOpenInput(value);
    if (!resolved) {
      setError(
        "Use a 4-character PDB id (1CRN), a file URL, or a MolVis share link",
      );
      return null;
    }
    setError(null);
    return resolved;
  };

  const submitLoad = () => {
    const resolved = resolveOrError();
    if (!resolved) return;
    onSubmit({
      filename: resolved.filename,
      url: resolved.url,
      share: resolved.share,
    });
    setValue("");
    onOpenChange(false);
  };

  const submitShare = async () => {
    const resolved = resolveOrError();
    if (!resolved) return;
    const link = buildShareUrl(resolved.share);
    const result = await shareOrCopyUrl(link, resolved.filename);
    if (result === "shared") {
      reportStatus("Share sheet opened", "success");
    } else if (result === "copied") {
      reportStatus("Share link copied", "success");
    } else {
      reportStatus("Could not share or copy the link", "error");
    }
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-sm">
        <DialogHeader>
          <DialogTitle>Open or share</DialogTitle>
          <DialogDescription>
            RCSB id, public file URL, or a MolVis link. Copy/Share builds a deep
            link automatically — no need to edit{" "}
            <code className="text-micro">?pdb=</code>.
          </DialogDescription>
        </DialogHeader>
        <div className="grid gap-2">
          <Label htmlFor="open-structure-input">
            PDB id, URL, or share link
          </Label>
          <Input
            id="open-structure-input"
            value={value}
            onChange={(e) => {
              setValue(e.target.value);
              setError(null);
            }}
            onKeyDown={(e) => {
              if (e.key === "Enter") {
                e.preventDefault();
                submitLoad();
              }
            }}
            placeholder="1CRN or https://…"
            autoCapitalize="none"
            autoCorrect="off"
            spellCheck={false}
            className="text-body-lg"
          />
          {error && (
            <p
              role="alert"
              className="text-label text-status-failed-foreground"
            >
              {error}
            </p>
          )}
        </div>
        <DialogFooter className="flex-col gap-2 sm:flex-row sm:justify-end">
          <ViewerAction
            type="button"
            purpose="dismiss"
            onClick={() => onOpenChange(false)}
          >
            Cancel
          </ViewerAction>
          <ViewerAction
            type="button"
            purpose="dismiss"
            onClick={() => void submitShare()}
          >
            Copy / Share link
          </ViewerAction>
          <ViewerAction type="button" purpose="commit" onClick={submitLoad}>
            Load
          </ViewerAction>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
