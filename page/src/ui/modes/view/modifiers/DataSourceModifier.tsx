import {
  loadFileSmart,
  useFormatPicker,
} from "@/components/format-picker-dialog";
import { Button } from "@/components/ui/button";
import {
  type DataSourceModifier as CoreDataSourceModifier,
  FrameDataSource,
  type Molvis,
  TrajectoryDataSource,
} from "@molvis/core";
import { getAllAcceptExtensions } from "@molvis/core/io";
import { FileUp, Trash2 } from "lucide-react";
import type React from "react";

interface DataSourceModifierProps {
  modifier: CoreDataSourceModifier;
  app: Molvis | null;
  onUpdate: () => void;
}

export const DataSourceModifier: React.FC<DataSourceModifierProps> = ({
  modifier,
  app,
  onUpdate,
}) => {
  const pickFormat = useFormatPicker();

  // "Replace" semantics on the per-DS panel: the user is swapping this
  // DS's source. For pure additive flow ("Add Data Source"), the
  // pipeline-level button on PipelineList is the entry point.
  const handleFileUpload = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file || !app) return;
    try {
      const result = await loadFileSmart(app, file, pickFormat, "replace");
      if (result === "started") onUpdate();
    } finally {
      e.target.value = "";
    }
  };

  const handleRemove = async () => {
    if (!app) return;
    await app.removeDataSource(modifier.id);
    onUpdate();
  };

  const filename = modifier.filename === "" ? "—" : modifier.filename;
  const isTraj = modifier instanceof TrajectoryDataSource;
  const isFrame = modifier instanceof FrameDataSource;
  const kindBadge = isTraj
    ? `Trajectory · ${modifier.frameCount} frame${modifier.frameCount === 1 ? "" : "s"}`
    : isFrame
      ? "Topology · 1 frame"
      : "Data Source";

  const sourceTypeLabel =
    modifier.sourceType === "file"
      ? "File"
      : modifier.sourceType === "backend"
        ? "Backend"
        : "Empty";

  const blocksLabel =
    modifier.contributedBlocks.length > 0
      ? modifier.contributedBlocks.join(", ")
      : "atoms, bonds (default)";

  return (
    <div className="space-y-1.5">
      <div className="flex items-center gap-1.5">
        <div className="relative flex-1 min-w-0">
          <input
            type="file"
            className="absolute inset-0 opacity-0 cursor-pointer"
            onChange={handleFileUpload}
            accept={getAllAcceptExtensions()}
            title="Replace source"
            aria-label="Replace source"
          />
          <Button
            variant="outline"
            size="sm"
            className="h-7 w-full px-2 gap-1.5"
            title="Replace source (load a different file into this DS)"
            aria-label="Replace source"
          >
            <FileUp className="h-3.5 w-3.5" />
            <span className="text-[10px] truncate">Replace…</span>
          </Button>
        </div>

        <Button
          variant="ghost"
          size="icon"
          onClick={handleRemove}
          title="Remove this data source"
          aria-label="Remove data source"
          className="h-7 w-7 shrink-0 text-destructive hover:text-destructive hover:bg-destructive/10"
        >
          <Trash2 className="h-3.5 w-3.5" />
        </Button>
      </div>

      <div className="rounded-md border bg-background overflow-hidden">
        <div className="px-2 py-1 border-b flex items-center justify-between">
          <span className="text-[10px] uppercase tracking-wide font-semibold text-muted-foreground">
            {kindBadge}
          </span>
          <span className="text-[9px] text-muted-foreground">
            {sourceTypeLabel}
          </span>
        </div>
        <dl className="text-[10px] divide-y">
          <div className="flex items-center justify-between px-2 py-1">
            <dt className="text-muted-foreground">Source</dt>
            <dd className="font-mono text-foreground truncate ml-2 max-w-[60%]">
              {filename}
            </dd>
          </div>
          <div className="flex items-center justify-between px-2 py-1">
            <dt className="text-muted-foreground">Contributes</dt>
            <dd className="font-mono text-foreground truncate ml-2 max-w-[60%]">
              {blocksLabel}
            </dd>
          </div>
        </dl>
      </div>
    </div>
  );
};
