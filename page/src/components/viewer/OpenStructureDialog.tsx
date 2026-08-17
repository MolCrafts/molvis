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
import { resolveOpenInput } from "@/lib/open-structure";

export interface OpenStructureRequest {
  filename: string;
  url: string;
}

interface OpenStructureDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onSubmit: (request: OpenStructureRequest) => void;
}

/**
 * Paste a PDB id or a public structure URL.
 */
export function OpenStructureDialog({
  open,
  onOpenChange,
  onSubmit,
}: OpenStructureDialogProps): React.ReactElement {
  const [value, setValue] = useState("");
  const [error, setError] = useState<string | null>(null);

  const submitLoad = () => {
    const resolved = resolveOpenInput(value);
    if (!resolved) {
      setError("Use a 4-character PDB id (1CRN) or a file URL");
      return;
    }
    onSubmit({
      filename: resolved.filename,
      url: resolved.url,
    });
    setValue("");
    onOpenChange(false);
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-sm">
        <DialogHeader>
          <DialogTitle>Open</DialogTitle>
          <DialogDescription className="sr-only">
            Open a structure from a PDB id or a public file URL.
          </DialogDescription>
        </DialogHeader>
        <div className="grid gap-2">
          <Label
            htmlFor="open-structure-input"
            title="4-character RCSB id or a public file URL"
          >
            PDB id or URL
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
            title="4-character RCSB id or a public file URL"
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
          <ViewerAction type="button" purpose="commit" onClick={submitLoad}>
            Load
          </ViewerAction>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
