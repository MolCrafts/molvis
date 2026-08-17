/**
 * Export current scene as a MolVis project file (OVITO-style document).
 *
 * Molecular truth is the pipeline DataSource graph + view state — not GPU
 * buffers. Uncommitted edit-tree content is not included; commit first.
 */

import {
  downloadProjectJson,
  type Molvis,
  serializeProjectJson,
} from "@molcrafts/molvis-stage";
import { FolderDown, Loader2 } from "lucide-react";
import type React from "react";
import { useState } from "react";
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
import { ViewerAction } from "@/components/viewer/ViewerAction";
import { ViewerIconAction } from "@/components/viewer/ViewerIconAction";
import { ViewerOperationState } from "@/components/viewer/ViewerOperationState";
import { useViewerOperation } from "@/hooks/useViewerOperation";

interface ExportProjectDialogProps {
  app: Molvis | null;
}

const EXPORT_COPY = {
  running: "Building project file…",
  success: "Project download started",
  error: "Project export failed",
};

export const ExportProjectDialog: React.FC<ExportProjectDialogProps> = ({
  app,
}) => {
  const [open, setOpen] = useState(false);
  const [filename, setFilename] = useState("scene.molvis.json");
  const {
    feedback,
    running: isExporting,
    run: runExport,
    reset: resetExport,
  } = useViewerOperation();

  const handleOpen = (next: boolean) => {
    setOpen(next);
    if (next) resetExport();
  };

  const handleExport = () => {
    if (!app || isExporting || !filename.trim()) return;
    void runExport(async () => {
      const stem = filename.replace(/\.json$/i, "").replace(/\.molvis$/i, "");
      const json = await serializeProjectJson(app, { title: stem || "scene" });
      downloadProjectJson(
        json,
        filename.endsWith(".json") ? filename : `${filename}.json`,
      );
    }, EXPORT_COPY);
  };

  return (
    <Dialog open={open} onOpenChange={handleOpen}>
      <DialogTrigger asChild>
        <ViewerIconAction
          icon={<FolderDown />}
          label="Export project"
          disabled={!app}
        />
      </DialogTrigger>
      <DialogContent className="max-w-md">
        <DialogHeader>
          <DialogTitle>Export project</DialogTitle>
        </DialogHeader>
        <p className="text-micro leading-relaxed text-muted-foreground">
          Saves pipeline + DataSource frames + camera (OVITO-style document).
          Molecular data comes only from DataSources — save the scene first if
          you have unsaved canvas edits.
        </p>
        <div className="space-y-2 py-2">
          <Label htmlFor="project-filename">Filename</Label>
          <Input
            id="project-filename"
            value={filename}
            onChange={(e) => {
              setFilename(e.target.value);
              resetExport();
            }}
            className="font-mono text-xs"
          />
        </div>
        {feedback && <ViewerOperationState {...feedback} />}
        <DialogFooter>
          <ViewerAction
            disabled={!app || isExporting || !filename.trim()}
            onClick={handleExport}
          >
            {isExporting ? (
              <Loader2 className="animate-spin" />
            ) : (
              <FolderDown />
            )}
            Download .molvis.json
          </ViewerAction>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
};
