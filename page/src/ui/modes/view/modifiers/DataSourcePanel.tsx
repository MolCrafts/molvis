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
import { Check, ChevronDown, ChevronRight, Copy, FileUp } from "lucide-react";
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
import { copyTextToClipboard } from "@/lib/open-structure";
import { reportStatus } from "@/lib/status-report";
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

/**
 * Secondary label for list rows / meta — filename when present.
 * Properties chrome uses {@link DataSource.name} ("Source" / "Stream"), not this.
 */
export function dataSourceDisplayTitle(source: DataSource): string {
  if (source.filename) return source.filename;
  if (source instanceof MemoryDataSource) return source.name;
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

  const isEmpty = modifier.sourceType === "empty" && !modifier.filename;
  const pathLabel = modifier.filename || null;
  const displayTitle = dataSourceDisplayTitle(modifier);

  const [detailsOpen, setDetailsOpen] = useState(true);
  const [copied, setCopied] = useState(false);
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

  useEffect(() => {
    if (!copied) return;
    const t = window.setTimeout(() => setCopied(false), 1500);
    return () => window.clearTimeout(t);
  }, [copied]);

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

  const copyPath = async () => {
    if (!pathLabel) return;
    const ok = await copyTextToClipboard(pathLabel);
    if (ok) {
      setCopied(true);
      reportStatus("Path copied", "success");
    } else {
      reportStatus("Could not copy path", "error");
    }
  };

  const primaryLoadLabel = isEmpty ? "Open…" : "Replace…";
  const frameCount = modifier.frameCount;
  const frameWord = frameCount === 1 ? "frame" : "frames";
  const atomDetail = `${frameCount.toLocaleString()} ${frameWord} / ${stats.atomCount.toLocaleString()} atoms`;
  const bondDetail = stats.bondCount.toLocaleString();
  const boxDetail = stats.hasBox ? (stats.boxLabel ?? "present") : "none";

  return (
    <fieldset
      disabled={!app || running}
      aria-busy={running}
      className="m-0 min-w-0 space-y-2 border-0 p-0 text-xs"
    >
      {!isEmpty ? (
        <div className="min-w-0">
          {/* Filename row: expand details + copy path (right-aligned). */}
          <div className="flex min-w-0 items-center gap-0.5 px-0.5">
            <button
              type="button"
              className="flex min-w-0 flex-1 items-center gap-1 rounded-control px-0.5 py-0.5 text-left transition-colors hover:bg-interactive/60"
              onClick={() => setDetailsOpen((o) => !o)}
              aria-expanded={detailsOpen}
              title={detailsOpen ? "Hide file details" : "Show file details"}
            >
              {detailsOpen ? (
                <ChevronDown className="h-3.5 w-3.5 shrink-0 text-muted-foreground" />
              ) : (
                <ChevronRight className="h-3.5 w-3.5 shrink-0 text-muted-foreground" />
              )}
              <span className="min-w-0 truncate font-mono text-xs text-foreground">
                {displayTitle}
              </span>
            </button>
            {pathLabel ? (
              <button
                type="button"
                className="flex h-control-compact w-control-compact shrink-0 items-center justify-center rounded-control text-muted-foreground transition-colors hover:bg-interactive hover:text-foreground"
                onClick={() => void copyPath()}
                aria-label="Copy path"
                title="Copy path"
              >
                {copied ? (
                  <Check className="h-3.5 w-3.5" />
                ) : (
                  <Copy className="h-3.5 w-3.5" />
                )}
              </button>
            ) : null}
          </div>

          {detailsOpen ? (
            <div className="mt-1 space-y-0.5 border-t border-border/50 pt-1.5">
              <VisibilityRow
                label="Atoms"
                detail={atomDetail}
                checked={showAtoms}
                disabled={stats.atomCount === 0}
                onChange={(c) => {
                  app?.styleManager.setAtomVisibility(c ? "all" : "none");
                  redraw();
                }}
              />
              <VisibilityRow
                label="Bonds"
                detail={bondDetail}
                checked={showBonds}
                disabled={stats.bondCount === 0}
                onChange={(c) => {
                  app?.styleManager.setShowBonds(c);
                  redraw();
                }}
              />
              <VisibilityRow
                label="Box"
                detail={boxDetail}
                checked={showBox}
                disabled={!stats.hasBox}
                onChange={(c) => {
                  app?.styleManager.setShowBox(c);
                  redraw();
                }}
              />
            </div>
          ) : null}
        </div>
      ) : null}

      {/* Compact split: primary load + overflow for extend / add source. */}
      <div className="flex items-center gap-1 px-1 pt-0.5">
        <ViewerAction
          purpose="dismiss"
          className="h-control-compact min-w-0 flex-1 justify-start gap-1.5 px-2 text-xs"
          onClick={() => pickAndLoad("replace")}
          title={isEmpty ? "Open structure" : "Replace source"}
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
              {isEmpty ? "Open…" : "Replace…"}
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
              Add source…
            </DropdownMenuItem>
          </DropdownMenuContent>
        </DropdownMenu>
      </div>
    </fieldset>
  );
};

const VisibilityRow: React.FC<{
  label: string;
  detail: string;
  checked: boolean;
  disabled?: boolean;
  onChange: (checked: boolean) => void;
}> = ({ label, detail, checked, disabled, onChange }) => {
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
      <span className="max-w-[55%] truncate text-right font-mono text-micro tabular-nums text-muted-foreground">
        {detail}
      </span>
    </div>
  );
};
