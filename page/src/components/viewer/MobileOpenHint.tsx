import { FileUp, Link2 } from "lucide-react";
import { useMemo, useRef } from "react";
import { ViewerAction } from "@/components/viewer/ViewerAction";
import { detectClientPlatform, openStructureHint } from "@/lib/platform";

interface MobileOpenHintProps {
  /** Called with the first selected file. */
  onPickFile: (file: File) => void;
  /** Optional: open a small URL/PDB dialog. */
  onOpenLink?: () => void;
  className?: string;
}

/**
 * Lightweight empty-canvas affordance for touch hosts: open a structure
 * without needing drag-and-drop or a desktop file dialog path.
 */
export function MobileOpenHint({
  onPickFile,
  onOpenLink,
  className,
}: MobileOpenHintProps): React.ReactElement {
  const inputRef = useRef<HTMLInputElement>(null);
  const hint = useMemo(() => openStructureHint(detectClientPlatform()), []);

  return (
    <div
      className={
        className ??
        "pointer-events-none absolute inset-x-0 bottom-[max(1rem,env(safe-area-inset-bottom))] z-10 flex justify-center px-3"
      }
    >
      <div className="pointer-events-auto flex max-w-sm flex-col items-stretch gap-2 rounded-lg border border-border/80 bg-panel/95 px-3 py-3 shadow-lg backdrop-blur-sm">
        <p className="text-center text-label leading-snug text-muted-foreground">
          {hint}
        </p>
        <div className="flex gap-2">
          <ViewerAction
            type="button"
            className="min-h-touch-target flex-1 gap-1.5"
            onClick={() => inputRef.current?.click()}
          >
            <FileUp className="size-4" aria-hidden />
            Open file
          </ViewerAction>
          {onOpenLink && (
            <ViewerAction
              type="button"
              purpose="dismiss"
              className="min-h-touch-target flex-1 gap-1.5"
              onClick={onOpenLink}
            >
              <Link2 className="size-4" aria-hidden />
              Open URL
            </ViewerAction>
          )}
        </div>
        <input
          ref={inputRef}
          type="file"
          className="sr-only"
          accept=".pdb,.ent,.brk,.cif,.mmcif,.xyz,.extxyz,.sdf,.mol,.mol2,.gro,.dump,.lammpstrj,.data,.lmp,.cube,.dcd,.xtc,.trr,chemical/*,text/plain"
          onChange={(e) => {
            const file = e.target.files?.[0];
            e.target.value = "";
            if (file) onPickFile(file);
          }}
        />
      </div>
    </div>
  );
}
