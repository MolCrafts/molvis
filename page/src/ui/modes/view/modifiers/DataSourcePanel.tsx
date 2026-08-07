import type { DataSource, Molvis } from "@molcrafts/molvis-stage";
import {
  getAllAcceptExtensions,
  type LoadMode,
} from "@molcrafts/molvis-stage/io";
import { ChevronDown, FileUp } from "lucide-react";
import type React from "react";
import { useEffect, useState } from "react";
import { useBondMappingPicker } from "@/components/bond-column-mapping-dialog";
import {
  FileLoadConfirmDialog,
  sceneHasLoadedData,
} from "@/components/file-load-confirm-dialog";
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
import { ViewerIconAction } from "@/components/viewer/ViewerIconAction";

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

function readFrameStats(modifier: DataSource): FrameStats {
  const frame = modifier.peekFrame;
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

export const DataSourcePanel: React.FC<DataSourcePanelProps> = ({
  modifier,
  app,
  onUpdate,
}) => {
  const { run, running } = usePipelineOperation();
  const pickFormat = useFormatPicker();
  const pickBondMapping = useBondMappingPicker();
  const [pendingFileLoad, setPendingFileLoad] = useState<{
    file: File;
    mode: LoadMode;
  } | null>(null);

  const isEmpty = modifier.sourceType === "empty";
  const filename = modifier.filename || null;

  // ── Live frame stats ──
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

  // ── Visibility (global StyleManager) ──
  const repr = app?.styleManager.getRepresentation();
  const showAtoms = repr?.atomVisibility !== "none";
  const showBonds = repr?.showBonds ?? true;
  const showBox = app?.styleManager.getShowBox() ?? true;

  const redraw = () => {
    onUpdate();
    if (!app) return;
    void run(() => app.applyPipeline({ fullRebuild: true }), VISIBILITY_COPY);
  };

  // ── File loading ──
  const loadFile = async (file: File, mode: LoadMode) => {
    if (!app) return;
    await run(async () => {
      // loadFileSmart throws with the molrs/WASM parse message on failure —
      // do not wrap as "Failed to load <name>" or that detail is lost.
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

  const pickAndLoad = (mode: LoadMode) => {
    const input = document.createElement("input");
    input.type = "file";
    input.accept = getAllAcceptExtensions();
    input.onchange = (e: Event) => {
      const file = (e.target as HTMLInputElement).files?.[0];
      if (!file) return;
      if (mode === "replace" && !sceneHasLoadedData(app)) {
        void loadFile(file, "replace");
      } else {
        setPendingFileLoad({ file, mode });
      }
    };
    input.click();
  };

  const resolvePendingFileLoad = async (mode: LoadMode) => {
    const pending = pendingFileLoad;
    setPendingFileLoad(null);
    if (!pending) return;
    await loadFile(pending.file, mode);
  };

  return (
    <fieldset
      disabled={!app || running}
      aria-busy={running}
      className="m-0 min-w-0 space-y-2 border-0 p-0"
    >
      {/* ── 1. File details (first item) ── */}
      {isEmpty ? (
        <div className="rounded-md border bg-background px-2 py-3 text-micro text-muted-foreground text-center">
          No file loaded
        </div>
      ) : (
        <>
          <div className="rounded-md border bg-background px-2 py-2 text-micro space-y-1">
            {filename && (
              <div className="truncate font-mono text-foreground">
                {filename}
              </div>
            )}
            <div className="text-muted-foreground leading-relaxed">
              {modifier.frameCount} frame{modifier.frameCount !== 1 ? "s" : ""}
              {" · "}
              {stats.atomCount.toLocaleString()} atoms
              {stats.bondCount > 0 &&
                ` · ${stats.bondCount.toLocaleString()} bonds`}
              {stats.hasBox && stats.boxLabel && ` · ${stats.boxLabel}`}
            </div>
          </div>

          {/* ── 2. Visibility toggles ── */}
          <div className="border rounded-md overflow-hidden bg-background text-micro">
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

      {/* ── 3. New button (split: main = replace, dropdown = extend / add source) ── */}
      <div className="flex gap-1">
        <ViewerAction
          purpose="dismiss"
          className="flex-1"
          onClick={() => pickAndLoad("replace")}
          title={
            isEmpty
              ? "Load a molecular structure file"
              : "Replace with a new file"
          }
        >
          <FileUp className="h-3.5 w-3.5" />
          New
        </ViewerAction>
        <DropdownMenu modal={false}>
          <DropdownMenuTrigger asChild>
            <ViewerIconAction
              icon={<ChevronDown />}
              label="More load options"
            />
          </DropdownMenuTrigger>
          <DropdownMenuContent align="end" className="min-w-menu-compact">
            <DropdownMenuItem
              className="text-xs"
              onSelect={() => pickAndLoad("replace")}
            >
              New
            </DropdownMenuItem>
            <DropdownMenuItem
              className="text-xs"
              disabled={isEmpty}
              onSelect={() => pickAndLoad("extend")}
            >
              Extend
            </DropdownMenuItem>
            <DropdownMenuItem
              className="text-xs"
              disabled={isEmpty}
              onSelect={() => pickAndLoad("augment")}
            >
              Add Source
            </DropdownMenuItem>
          </DropdownMenuContent>
        </DropdownMenu>
      </div>

      <FileLoadConfirmDialog
        open={pendingFileLoad !== null}
        filename={pendingFileLoad?.file.name ?? ""}
        busy={running}
        onCancel={() => setPendingFileLoad(null)}
        onAddSource={() => void resolvePendingFileLoad("augment")}
        onReplace={() => void resolvePendingFileLoad("replace")}
        onExtend={() => void resolvePendingFileLoad("extend")}
      />
    </fieldset>
  );
};

const VisibilityRow: React.FC<{
  label: string;
  count: number;
  checked: boolean;
  disabled?: boolean;
  onChange: (checked: boolean) => void;
}> = ({ label, count, checked, disabled, onChange }) => (
  <div className="flex items-center gap-2 px-2 py-1 border-b last:border-b-0 hover:bg-muted/50 transition-colors duration-(--motion-fast) ease-standard">
    <Checkbox
      checked={checked}
      disabled={disabled}
      onCheckedChange={(c) => onChange(c === true)}
      aria-label={`Show ${label}`}
    />
    <span className="flex-1 min-w-0 text-foreground">{label}</span>
    <span className="font-mono text-muted-foreground tabular-nums">
      {count}
    </span>
  </div>
);
