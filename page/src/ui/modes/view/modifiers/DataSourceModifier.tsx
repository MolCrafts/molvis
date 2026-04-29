import {
  type DataSourceModifier as CoreDataSourceModifier,
  FrameDataSource,
  type Molvis,
  TrajectoryDataSource,
} from "@molvis/core";
import type React from "react";
import { useEffect, useState } from "react";

interface DataSourceModifierProps {
  modifier: CoreDataSourceModifier;
  app: Molvis | null;
  onUpdate: () => void;
}

interface FrameStats {
  atomCount: number;
  bondCount: number;
  hasBox: boolean;
  boxLabel: string | null;
}

function readFrameStats(modifier: CoreDataSourceModifier): FrameStats {
  const frame = modifier.peekFrame;
  if (!frame) {
    return { atomCount: 0, bondCount: 0, hasBox: false, boxLabel: null };
  }
  const atoms = frame.getBlock("atoms");
  const bonds = frame.getBlock("bonds");
  const box = frame.simbox;
  let boxLabel: string | null = null;
  if (box) {
    try {
      const lengths = box.lengths();
      const L = lengths.toCopy();
      lengths.free();
      // Render as `lx × ly × lz` with 2 decimals. Triclinic tilts are
      // not shown here — keep the cell description short; full geometry
      // lives in a separate inspector if/when we add one.
      boxLabel = `${L[0].toFixed(2)} × ${L[1].toFixed(2)} × ${L[2].toFixed(2)} Å`;
    } catch {
      boxLabel = null;
    }
  }
  return {
    atomCount: atoms?.nrows() ?? 0,
    bondCount: bonds?.nrows() ?? 0,
    hasBox: box !== undefined,
    boxLabel,
  };
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
  app,
}) => {
  // Re-read stats on every frame-change. The DS's cached frame lands
  // during pipeline phase A's preload, which is what fires
  // frame-change — without this subscription the panel would stay
  // stuck at "0 atoms" until something else triggered a re-render.
  const [stats, setStats] = useState<FrameStats>(() =>
    readFrameStats(modifier),
  );
  useEffect(() => {
    setStats(readFrameStats(modifier));
    if (!app) return;
    const refresh = () => setStats(readFrameStats(modifier));
    app.events.on("frame-change", refresh);
    app.events.on("trajectory-change", refresh);
    return () => {
      app.events.off("frame-change", refresh);
      app.events.off("trajectory-change", refresh);
    };
  }, [app, modifier]);

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
          <dt className="text-muted-foreground">Atoms</dt>
          <dd className="font-mono text-foreground">
            {stats.atomCount.toLocaleString()}
          </dd>
        </div>
        <div className="flex items-center justify-between px-2 py-1">
          <dt className="text-muted-foreground">Bonds</dt>
          <dd className="font-mono text-foreground">
            {stats.bondCount.toLocaleString()}
          </dd>
        </div>
        <div className="flex items-center justify-between px-2 py-1">
          <dt className="text-muted-foreground">Box</dt>
          <dd className="font-mono text-foreground truncate ml-2 max-w-[60%]">
            {stats.boxLabel ?? "—"}
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
