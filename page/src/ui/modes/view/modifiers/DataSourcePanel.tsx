import type { Frame } from "@molcrafts/molvis-core/molrs";
import {
  type DataSource,
  MemoryDataSource,
  type Molvis,
} from "@molcrafts/molvis-stage";
import {
  getAllAcceptExtensions,
  type LoadMode,
} from "@molcrafts/molvis-stage/io";
import { ChevronDown, FileUp } from "lucide-react";
import type React from "react";
import { useEffect, useState } from "react";
import { useBondMappingPicker } from "@/components/bond-column-mapping-dialog";
import {
  loadFileSmart,
  useFormatPicker,
} from "@/components/format-picker-dialog";
import { Checkbox } from "@/components/ui/checkbox";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { usePipelineOperation } from "@/components/viewer/PipelineOperationProvider";
import { ViewerAction } from "@/components/viewer/ViewerAction";
import { cn } from "@/lib/utils";

interface DataSourcePanelProps {
  modifier: DataSource;
  app: Molvis | null;
  onUpdate: () => void;
}

interface FrameStats {
  atomCount: number;
  bondCount: number;
  hasBox: boolean;
  boxLabel: string | null;
}

function resolveStatsFrame(
  modifier: DataSource,
  app: Molvis | null,
): Frame | undefined {
  const peeked = modifier.peekFrame;
  if (peeked) return peeked;
  // Primary DS often shares System's trajectory — use the live scene frame
  // when the DS cache is cold (async traj before first seek).
  if (app?.system.frame && app.system.trajectory === modifier.trajectory) {
    return app.system.frame;
  }
  return undefined;
}

function readFrameStats(
  modifier: DataSource,
  app: Molvis | null = null,
): FrameStats {
  const frame = resolveStatsFrame(modifier, app);
  if (!frame) {
    return { atomCount: 0, bondCount: 0, hasBox: false, boxLabel: null };
  }
  const atoms = frame.getBlock("atoms");
  const bonds = frame.getBlock("bonds");
  const box = frame.box;
  let boxLabel: string | null = null;
  if (box) {
    try {
      const lengths = box.lengths();
      const L = lengths.toCopy();
      lengths.free();
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

const FILE_LOAD_COPY = {
  running: "Loading the data source…",
  success: "Data source loaded",
  error: "Could not load the data source",
};

const VISIBILITY_COPY = {
  running: "Updating scene visibility…",
  success: "Scene visibility updated",
  error: "Could not update scene visibility",
};

/** Human title for the properties chrome (never internal "Memory Source"). */
export function dataSourceDisplayTitle(source: DataSource): string {
  if (source.sourceType === "empty") return "Empty Scene";
  if (source.filename) return source.filename;
  if (source instanceof MemoryDataSource) return "Scene";
  return source.name || "Data source";
}

export const DataSourcePanel: React.FC<DataSourcePanelProps> = ({
  modifier,
  app,
  onUpdate,
}) => {
  const { run, running } = usePipelineOperation();
  const pickFormat = useFormatPicker();
  const pickBondMapping = useBondMappingPicker();

  const isEmpty = modifier.sourceType === "empty";
  const filename = modifier.filename || null;

  const [stats, setStats] = useState<FrameStats>(() =>
    readFrameStats(modifier, app),
  );
  useEffect(() => {
    setStats(readFrameStats(modifier, app));
    if (!app) return;
    const refresh = () => setStats(readFrameStats(modifier, app));
    app.events.on("frame-change", refresh);
    app.events.on("trajectory-change", refresh);
    return () => {
      app.events.off("frame-change", refresh);
      app.events.off("trajectory-change", refresh);
    };
  }, [app, modifier]);

  const repr = app?.styleManager.getRepresentation();
  const showAtoms = repr?.atomVisibility !== "none";
  const showBonds = repr?.showBonds ?? true;
  const showBox = app?.styleManager.getShowBox() ?? true;

  const redraw = () => {
    onUpdate();
    if (!app) return;
    void run(() => app.applyPipeline({ fullRebuild: true }), VISIBILITY_COPY);
  };

  const loadFile = async (file: File, mode: LoadMode) => {
    if (!app) return;
    await run(async () => {
      const result = await loadFileSmart(
        app,
        file,
        pickFormat,
        mode,
        pickBondMapping,
      );
      if (result === "cancelled") {
        throw new DOMException("File loading cancelled", "AbortError");
      }
      onUpdate();
      return result;
    }, FILE_LOAD_COPY);
  };

  /** Mode is chosen by the control (Replace / Extend / Add) — no second dialog. */
  const pickAndLoad = (mode: LoadMode) => {
    const input = document.createElement("input");
    input.type = "file";
    input.accept = getAllAcceptExtensions();
    input.onchange = (e: Event) => {
      const file = (e.target as HTMLInputElement).files?.[0];
      if (!file) return;
      void loadFile(file, mode);
    };
    input.click();
  };

  const primaryLoadLabel = isEmpty ? "Load file…" : "Replace…";

  return (
    <fieldset
      disabled={!app || running}
      aria-busy={running}
      className="m-0 min-w-0 space-y-2 border-0 p-0 text-xs"
    >
      {isEmpty ? (
        <p className="px-1 text-micro text-muted-foreground">
          No structure yet. Load a file to begin.
        </p>
      ) : (
        <>
          <div className="space-y-1 px-1">
            {filename ? (
              <div className="truncate font-mono text-xs text-foreground">
                {filename}
              </div>
            ) : null}
            <div className="text-micro leading-relaxed text-muted-foreground">
              {modifier.frameCount} frame
              {modifier.frameCount !== 1 ? "s" : ""}
              {" · "}
              {stats.atomCount.toLocaleString()} atoms
              {stats.bondCount > 0 &&
                ` · ${stats.bondCount.toLocaleString()} bonds`}
              {stats.hasBox && stats.boxLabel ? ` · ${stats.boxLabel}` : null}
            </div>
          </div>

          <div className="space-y-0.5 border-t border-border/50 pt-1.5">
            <VisibilityRow
              label="Atoms"
              count={stats.atomCount}
              checked={showAtoms}
              disabled={stats.atomCount === 0}
              onChange={(c) => {
                app?.styleManager.setAtomVisibility(c ? "all" : "none");
                redraw();
              }}
            />
            <VisibilityRow
              label="Bonds"
              count={stats.bondCount}
              checked={showBonds}
              disabled={stats.bondCount === 0}
              onChange={(c) => {
                app?.styleManager.setShowBonds(c);
                redraw();
              }}
            />
            <VisibilityRow
              label="Box"
              count={stats.hasBox ? 1 : 0}
              checked={showBox}
              disabled={!stats.hasBox}
              onChange={(c) => {
                app?.styleManager.setShowBox(c);
                redraw();
              }}
            />
          </div>
        </>
      )}

      {/* Compact split: primary load + overflow for extend / add source. */}
      <div className="flex items-center gap-1 px-1 pt-0.5">
        <ViewerAction
          purpose="dismiss"
          className="h-control-compact min-w-0 flex-1 justify-start gap-1.5 px-2 text-xs"
          onClick={() => pickAndLoad("replace")}
          title={
            isEmpty
              ? "Load a molecular structure file"
              : "Replace with a new file"
          }
        >
          <FileUp className="h-3.5 w-3.5 shrink-0" />
          <span className="truncate">{primaryLoadLabel}</span>
        </ViewerAction>
        <DropdownMenu modal={false}>
          <DropdownMenuTrigger asChild>
            <button
              type="button"
              className="flex h-control-compact w-control-compact shrink-0 items-center justify-center rounded-control border border-border text-muted-foreground transition-colors hover:bg-interactive hover:text-foreground"
              aria-label="More load options"
              title="More load options"
            >
              <ChevronDown className="h-3.5 w-3.5" />
            </button>
          </DropdownMenuTrigger>
          <DropdownMenuContent align="end" className="min-w-menu-compact">
            <DropdownMenuItem
              className="text-xs"
              onSelect={() => pickAndLoad("replace")}
            >
              {isEmpty ? "Load file…" : "Replace…"}
            </DropdownMenuItem>
            <DropdownMenuItem
              className="text-xs"
              disabled={isEmpty}
              onSelect={() => pickAndLoad("extend")}
            >
              Extend trajectory…
            </DropdownMenuItem>
            <DropdownMenuItem
              className="text-xs"
              disabled={isEmpty}
              onSelect={() => pickAndLoad("augment")}
            >
              Add as source…
            </DropdownMenuItem>
          </DropdownMenuContent>
        </DropdownMenu>
      </div>
    </fieldset>
  );
};

const VisibilityRow: React.FC<{
  label: string;
  count: number;
  checked: boolean;
  disabled?: boolean;
  onChange: (checked: boolean) => void;
}> = ({ label, count, checked, disabled, onChange }) => {
  const id = `ds-vis-${label.toLowerCase()}`;
  return (
    <div
      className={cn(
        "flex h-control-compact items-center gap-2 px-1 transition-colors duration-(--motion-fast) ease-standard",
        disabled ? "opacity-40" : "hover:bg-interactive/60",
      )}
    >
      <Checkbox
        id={id}
        checked={checked}
        disabled={disabled}
        onCheckedChange={(c) => onChange(c === true)}
      />
      <label
        htmlFor={id}
        className={cn(
          "min-w-0 flex-1 text-xs text-foreground",
          disabled ? "cursor-not-allowed" : "cursor-pointer",
        )}
      >
        {label}
      </label>
      <span className="font-mono text-micro tabular-nums text-muted-foreground">
        {count.toLocaleString()}
      </span>
    </div>
  );
};
