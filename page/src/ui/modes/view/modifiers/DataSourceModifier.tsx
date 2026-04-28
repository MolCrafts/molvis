import {
  type DataSourceModifier as CoreDataSourceModifier,
  FrameDataSource,
  type Molvis,
  TrajectoryDataSource,
} from "@molvis/core";
import type React from "react";

interface DataSourceModifierProps {
  modifier: CoreDataSourceModifier;
  app: Molvis | null;
  onUpdate: () => void;
}

/**
 * Read-only inspector for a DataSourceModifier. The pipeline list
 * footer "+" menu adds new sources and the list-row trash removes
 * them — there is intentionally no in-panel "Replace" or "Remove"
 * button. To swap data, remove the DS and add a new one (or drop a
 * new file onto the canvas).
 */
export const DataSourceModifier: React.FC<DataSourceModifierProps> = ({
  modifier,
}) => {
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
  );
};
