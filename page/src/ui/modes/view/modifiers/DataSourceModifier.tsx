import {
  type DataSourceModifier as CoreDataSourceModifier,
  FileDataSource,
  Frame,
  MemoryDataSource,
  type Molvis,
  Trajectory,
} from "@molvis/core";
import { getAllAcceptExtensions } from "@molvis/core/io";
import { ChevronDown, ChevronRight, FileUp, Trash2 } from "lucide-react";
import type React from "react";
import { useEffect, useState } from "react";
import {
  loadFileWithFormatPrompt,
  useFormatPicker,
} from "@/components/format-picker-dialog";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { NumberField } from "@/components/ui/number-field";

interface DataSourceModifierProps {
  modifier: CoreDataSourceModifier;
  app: Molvis | null;
  onUpdate: () => void;
}

type ComponentKey = "atoms" | "bonds" | "box";

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

const ParamRow: React.FC<{ label: string; children: React.ReactNode }> = ({
  label,
  children,
}) => (
  <div className="flex items-center justify-between gap-1.5">
    <span className="text-[10px] text-muted-foreground truncate min-w-0">
      {label}
    </span>
    <div className="shrink-0">{children}</div>
  </div>
);

const ComponentRow: React.FC<{
  label: string;
  count: number;
  checked: boolean;
  disabled?: boolean;
  open: boolean;
  onToggleShow: (c: boolean) => void;
  onToggleExpand: () => void;
  children?: React.ReactNode;
}> = ({
  label,
  count,
  checked,
  disabled,
  open,
  onToggleShow,
  onToggleExpand,
  children,
}) => (
  <div className="border-b last:border-b-0">
    <div className="flex items-center gap-1 px-1.5 py-1 hover:bg-muted/50 transition-colors">
      <Checkbox
        checked={checked}
        disabled={disabled}
        onCheckedChange={(c) => onToggleShow(c === true)}
        aria-label={`Show ${label}`}
      />
      <button
        type="button"
        className="flex items-center gap-1 flex-1 min-w-0 text-left disabled:opacity-50"
        disabled={disabled || !children}
        onClick={onToggleExpand}
        aria-expanded={open}
      >
        {children ? (
          open ? (
            <ChevronDown className="h-3 w-3 shrink-0 text-muted-foreground" />
          ) : (
            <ChevronRight className="h-3 w-3 shrink-0 text-muted-foreground" />
          )
        ) : (
          <span className="w-3 shrink-0" />
        )}
        <span className="font-medium">{label}</span>
      </button>
      <span className="font-mono text-muted-foreground tabular-nums">
        {count}
      </span>
    </div>
    {open && children && (
      <div className="px-2 pb-1.5 pl-7 space-y-1 bg-muted/20">{children}</div>
    )}
  </div>
);

export const DataSourceModifier: React.FC<DataSourceModifierProps> = ({
  modifier,
  app,
  onUpdate,
}) => {
  const pickFormat = useFormatPicker();
  const [expanded, setExpanded] = useState<Record<ComponentKey, boolean>>({
    atoms: false,
    bonds: false,
    box: false,
  });

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

  const handleFileUpload = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file || !app) return;

    try {
      const content = await file.text();
      const started = await loadFileWithFormatPrompt(
        app,
        content,
        file.name,
        pickFormat,
      );
      if (started) {
        onUpdate();
      } else {
        app.events.emit("status-message", {
          text: `Cancelled loading ${file.name}`,
          type: "info",
        });
      }
    } catch (err) {
      app.events.emit("status-message", {
        text: `Failed to load file: ${err instanceof Error ? err.message : String(err)}`,
        type: "error",
      });
    } finally {
      e.target.value = "";
    }
  };

  const handleClear = async () => {
    if (!app) return;
    modifier.sourceType = "empty";
    modifier.filename = "";
    await app.setTrajectory(new Trajectory([new Frame()]));
    await app.applyPipeline({ fullRebuild: true });
    onUpdate();
  };

  const filename = modifier.filename === "" ? "—" : modifier.filename;
  const isTraj = modifier instanceof FileDataSource;
  const isFrame = modifier instanceof MemoryDataSource;
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

  const atomCount = stats.atomCount;
  const bondCount = stats.bondCount;
  const hasBox = stats.hasBox;

  // Render visibility/params read live from the render state the Artist
  // consumes: the StyleManager representation (atoms/bonds) and the sim_box
  // mesh (box). There is no separate "modifier visibility" — that was a no-op.
  const repr = app?.styleManager.getRepresentation();
  const showAtoms = repr?.showAtoms ?? true;
  const showBonds = repr?.showBonds ?? true;
  const atomScale = repr?.atomRadiusScale ?? 1;
  const bondScale = repr?.bondRadiusScale ?? 1;
  const boxMesh = app?.scene.getMeshByName("sim_box");
  const showBox = app?.styleManager.getShowBox() ?? true;
  const boxWidth = app?.styleManager.getBoxThicknessScale() ?? 1.0;

  const redraw = () => {
    app?.applyPipeline({ fullRebuild: true });
    onUpdate();
  };
  const toggleExpand = (key: ComponentKey) =>
    setExpanded((prev) => ({ ...prev, [key]: !prev[key] }));

  const onShowAtoms = (c: boolean) => {
    app?.styleManager.setShowAtoms(c);
    redraw();
  };
  const onShowBonds = (c: boolean) => {
    app?.styleManager.setShowBonds(c);
    redraw();
  };
  const onShowBox = (c: boolean) => {
    app?.styleManager.setShowBox(c);
    redraw();
  };
  const onAtomScale = (v: number) => {
    app?.styleManager.setAtomRadiusScale(v);
    redraw();
  };
  const onBondScale = (v: number) => {
    app?.styleManager.setBondRadiusScale(v);
    redraw();
  };
  const onBoxWidth = (v: number) => {
    app?.styleManager.setBoxThicknessScale(v); // persist across redraws
    // biome-ignore lint/suspicious/noExplicitAny: _userThicknessScale is an internal per-mesh control read by DrawBoxCommand
    if (boxMesh) (boxMesh as any)._userThicknessScale = v; // live apply
    onUpdate();
  };

  return (
    <div className="space-y-1.5">
      <div className="flex items-center gap-1.5">
        <div className="relative flex-1 min-w-0">
          <input
            type="file"
            className="absolute inset-0 opacity-0 cursor-pointer"
            onChange={handleFileUpload}
            accept={getAllAcceptExtensions()}
            title="Load file"
            aria-label="Load file"
          />
          <Button
            variant="outline"
            size="sm"
            className="h-7 w-full px-2"
            title="Load file"
            aria-label="Load file"
          >
            <FileUp className="h-3.5 w-3.5" />
          </Button>
        </div>

        <Button
          variant="ghost"
          size="icon"
          onClick={handleClear}
          title="Clear scene"
          aria-label="Clear scene"
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
        <div className="flex items-center justify-between px-2 py-1 border-b text-[10px]">
          <span className="text-muted-foreground">Source</span>
          <span className="font-mono text-foreground truncate ml-2 max-w-[60%]">
            {filename}
          </span>
        </div>
        <div className="flex items-center justify-between px-2 py-1 text-[10px]">
          <span className="text-muted-foreground">Contributes</span>
          <span className="font-mono text-foreground truncate ml-2 max-w-[60%]">
            {blocksLabel}
          </span>
        </div>
      </div>

      <div className="border rounded-md overflow-hidden bg-background text-[10px]">
        <ComponentRow
          label="Atoms"
          count={atomCount}
          checked={showAtoms}
          disabled={atomCount === 0}
          open={expanded.atoms}
          onToggleShow={onShowAtoms}
          onToggleExpand={() => toggleExpand("atoms")}
        >
          <ParamRow label="Radius scale">
            <NumberField
              value={atomScale}
              min={0.1}
              max={3}
              step={0.05}
              onChange={onAtomScale}
            />
          </ParamRow>
        </ComponentRow>

        <ComponentRow
          label="Bonds"
          count={bondCount}
          checked={showBonds}
          disabled={bondCount === 0}
          open={expanded.bonds}
          onToggleShow={onShowBonds}
          onToggleExpand={() => toggleExpand("bonds")}
        >
          <ParamRow label="Radius scale">
            <NumberField
              value={bondScale}
              min={0}
              max={3}
              step={0.05}
              onChange={onBondScale}
            />
          </ParamRow>
        </ComponentRow>

        <ComponentRow
          label="Box"
          count={hasBox ? 1 : 0}
          checked={showBox}
          disabled={!hasBox}
          open={expanded.box}
          onToggleShow={onShowBox}
          onToggleExpand={() => toggleExpand("box")}
        >
          <ParamRow label="Line width">
            <NumberField
              value={boxWidth}
              min={0.5}
              max={5}
              step={0.1}
              onChange={onBoxWidth}
            />
          </ParamRow>
        </ComponentRow>
      </div>
    </div>
  );
};
