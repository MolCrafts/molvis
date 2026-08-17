import type { Molvis } from "@molcrafts/molvis-stage";
import {
  defaultExtensionForFormat,
  exportFrame,
  FILE_FORMAT_REGISTRY,
  type FileFormat,
  inferFormatFromFilename,
  isWritableFormat,
} from "@molcrafts/molvis-stage/io";
import { Download, Loader2 } from "lucide-react";
import type React from "react";
import { useEffect, useMemo, useState } from "react";
import {
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { ViewerAction } from "@/components/viewer/ViewerAction";
import { ViewerIconAction } from "@/components/viewer/ViewerIconAction";
import { ViewerOperationState } from "@/components/viewer/ViewerOperationState";
import { useViewerOperation } from "@/hooks/useViewerOperation";

interface ExportDialogProps {
  app: Molvis | null;
}

const DEFAULT_FORMAT: FileFormat = "pdb";

/** Writable formats only — same set as the right-click Export submenu. */
const WRITABLE_FORMATS = FILE_FORMAT_REGISTRY.filter((d) => d.writable);

const swapExtension = (name: string, newExt: string): string => {
  const m = name.match(/^(.*?)(\.[^./\\]+)?$/);
  const stem = m?.[1] ?? name;
  return `${stem || "structure"}.${newExt}`;
};

const EXPORT_COPY = {
  running: "Preparing scene export…",
  success: "Download started",
  error: "Scene export failed",
};

export const ExportDialog: React.FC<ExportDialogProps> = ({ app }) => {
  const [open, setOpen] = useState(false);
  const [format, setFormat] = useState<FileFormat>(DEFAULT_FORMAT);
  const [filename, setFilename] = useState(
    () => `structure.${defaultExtensionForFormat(DEFAULT_FORMAT)}`,
  );
  const {
    feedback,
    running: isExporting,
    run: runExport,
    reset: resetExport,
  } = useViewerOperation();

  const formatOptions = useMemo(
    () =>
      WRITABLE_FORMATS.map((d) => ({
        format: d.format,
        label: `${d.label} (.${d.extensions[0]})`,
      })),
    [],
  );

  useEffect(() => {
    if (!app) return;
    const openDialog = (payload?: { format?: string }) => {
      // Honor the format chosen from the right-click Export submenu.
      if (payload?.format && isWritableFormat(payload.format)) {
        const next = payload.format;
        setFormat(next);
        setFilename((prev) =>
          swapExtension(prev, defaultExtensionForFormat(next)),
        );
      }
      resetExport();
      setOpen(true);
    };
    app.events.on("export-requested", openDialog);
    return () => app.events.off("export-requested", openDialog);
  }, [app, resetExport]);

  const onFormatChange = (value: string) => {
    if (!isWritableFormat(value)) return;
    setFormat(value);
    setFilename((current) =>
      swapExtension(current, defaultExtensionForFormat(value)),
    );
    resetExport();
  };

  const onFilenameChange = (value: string) => {
    setFilename(value);
    resetExport();
    const inferred = inferFormatFromFilename(value);
    if (inferred && isWritableFormat(inferred) && inferred !== format) {
      setFormat(inferred);
    }
  };

  const handleExport = () => {
    if (!app || isExporting || !filename.trim()) return;
    void runExport(
      () => {
        const payload = exportFrame(app.world.sceneIndex, {
          format,
          filename,
        });

        if (!payload.content) {
          throw new Error("Export payload is empty");
        }

        // content is string (text formats) or Uint8Array (DCD/TRR/XTC); both
        // are valid BlobParts.
        const blob = new Blob([payload.content as BlobPart], {
          type: payload.mime,
        });
        const url = URL.createObjectURL(blob);
        const a = document.createElement("a");
        a.href = url;
        a.download = payload.suggestedName;
        document.body.appendChild(a);
        a.click();
        document.body.removeChild(a);
        URL.revokeObjectURL(url);
      },
      { ...EXPORT_COPY, successDetail: filename },
    );
  };

  return (
    <Dialog
      modal={false}
      open={open}
      onOpenChange={(next) => {
        if (isExporting) return;
        setOpen(next);
        if (!next) resetExport();
      }}
    >
      <DialogTrigger asChild>
        <ViewerIconAction icon={<Download />} label="Export" />
      </DialogTrigger>
      <DialogContent className="max-w-dialog-sm">
        <DialogHeader>
          <DialogTitle>Export Scene</DialogTitle>
        </DialogHeader>
        <div className="grid gap-4 py-4">
          <div className="grid grid-cols-4 items-center gap-4">
            <Label htmlFor="export-format" className="text-right">
              Format
            </Label>
            <Select
              value={format}
              onValueChange={onFormatChange}
              disabled={isExporting}
            >
              <SelectTrigger
                id="export-format"
                className="col-span-3"
                aria-label="Export format"
              >
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {formatOptions.map((opt) => (
                  <SelectItem key={opt.format} value={opt.format}>
                    {opt.label}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
          <div className="grid grid-cols-4 items-center gap-4">
            <Label htmlFor="filename" className="text-right">
              File Name
            </Label>
            <Input
              id="filename"
              value={filename}
              disabled={isExporting}
              onChange={(e) => onFilenameChange(e.target.value)}
              className="col-span-3"
              spellCheck={false}
            />
          </div>
          {!app ? (
            <ViewerOperationState
              phase="disabled"
              message="Export is not available yet"
              detail="Wait for the molecular viewer to finish loading."
            />
          ) : !filename.trim() ? (
            <ViewerOperationState
              phase="empty"
              message="Enter a file name"
              detail="Pick a format above, or type an extension."
            />
          ) : (
            feedback && <ViewerOperationState {...feedback} />
          )}
        </div>
        <DialogFooter>
          <ViewerAction
            onClick={handleExport}
            disabled={isExporting || !app || !filename.trim()}
            aria-busy={isExporting}
          >
            {isExporting && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
            {isExporting
              ? "Exporting…"
              : feedback?.phase === "error"
                ? "Retry export"
                : feedback?.phase === "success"
                  ? "Export again"
                  : "Export"}
          </ViewerAction>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
};
