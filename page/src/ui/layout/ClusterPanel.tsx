import { BarChart, type BarPoint } from "@molcrafts/molplot";
import {
  type ClusterResult,
  type ConnectivityMode,
  computeClusters,
  getCategoricalPalette,
  type Molvis,
  type SelectionMask,
} from "@molvis/core";
import { AlertCircle, Download, Play } from "lucide-react";
import type React from "react";
import { useCallback, useEffect, useRef, useState } from "react";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { SidebarSection } from "@/ui/layout/SidebarSection";

interface ClusterPanelProps {
  app: Molvis | null;
}

// ---------------------------------------------------------------------------
// Modifier option for "use only selected particles"
// ---------------------------------------------------------------------------

interface ModifierOption {
  id: string;
  label: string;
  count: number;
}

// ---------------------------------------------------------------------------
// Cluster size distribution — molplot BarChart
// ---------------------------------------------------------------------------

function ClusterSizeChart({ result }: { result: ClusterResult }) {
  const [plotDiv, setPlotDiv] = useState<HTMLDivElement | null>(null);

  useEffect(() => {
    const div = plotDiv;
    if (!div) return;
    const { clusterSizes, numClusters } = result;
    const histogram = new Map<number, number>();
    for (let c = 0; c < numClusters; c++) {
      const size = clusterSizes[c];
      histogram.set(size, (histogram.get(size) ?? 0) + 1);
    }
    const points: BarPoint[] = Array.from(histogram.entries())
      .sort((a, b) => a[0] - b[0])
      .map(([size, count]) => ({
        x: size,
        y: count,
        text: `${count} cluster${count === 1 ? "" : "s"} of size ${size}`,
      }));
    if (points.length === 0) return;
    const chart = new BarChart(div, {
      series: [{ id: "sizes", label: "clusters", points }],
      orientation: "v",
      xAxis: { label: "cluster size", dtype: "category" },
      yAxis: { label: "count", rangemode: "tozero" },
    });
    return () => {
      chart.dispose();
    };
  }, [plotDiv, result]);

  return <div ref={setPlotDiv} className="h-40 w-full" />;
}

// ---------------------------------------------------------------------------
// Cluster Table
// ---------------------------------------------------------------------------

const TABLE_ROW_HEIGHT = 20;
const TABLE_OVERSCAN = 5;

interface ClusterRow {
  id: number;
  size: number;
}

function downloadClusterCsv(result: ClusterResult) {
  const { clusterIdx, clusterSizes, numClusters, nParticles } = result;
  const lines = ["atom_id,cluster_id"];
  for (let i = 0; i < nParticles; i++) {
    lines.push(`${i},${clusterIdx[i]}`);
  }
  lines.push("");
  lines.push("cluster_id,size");
  for (let c = 0; c < numClusters; c++) {
    lines.push(`${c},${clusterSizes[c]}`);
  }
  const blob = new Blob([lines.join("\n")], { type: "text/csv" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = "clusters.csv";
  a.click();
  URL.revokeObjectURL(url);
}

function ClusterTable({ rows }: { rows: ClusterRow[] }) {
  const [scrollTop, setScrollTop] = useState(0);
  const containerRef = useRef<HTMLDivElement>(null);

  const totalHeight = rows.length * TABLE_ROW_HEIGHT;
  const visibleCount = containerRef.current
    ? Math.ceil(containerRef.current.clientHeight / TABLE_ROW_HEIGHT)
    : 20;
  const startIdx = Math.max(
    0,
    Math.floor(scrollTop / TABLE_ROW_HEIGHT) - TABLE_OVERSCAN,
  );
  const endIdx = Math.min(
    rows.length,
    startIdx + visibleCount + TABLE_OVERSCAN * 2,
  );
  const offsetY = startIdx * TABLE_ROW_HEIGHT;

  return (
    <div
      className="flex flex-col"
      style={{ height: Math.min(rows.length * TABLE_ROW_HEIGHT + 24, 260) }}
    >
      <div className="flex bg-muted/30 border-b text-[9px] font-semibold text-muted-foreground shrink-0">
        <div className="w-12 px-1 py-0.5 text-right shrink-0">Cluster</div>
        <div className="flex-1 min-w-[52px] px-1 py-0.5 text-right">Size</div>
      </div>
      <div
        ref={containerRef}
        className="flex-1 min-h-0 overflow-y-auto"
        onScroll={(e) => setScrollTop(e.currentTarget.scrollTop)}
      >
        <div style={{ height: totalHeight, position: "relative" }}>
          <div
            style={{ position: "absolute", top: offsetY, left: 0, right: 0 }}
          >
            {Array.from({ length: endIdx - startIdx }, (_, offset) => {
              const i = startIdx + offset;
              const row = rows[i];
              return (
                <div
                  key={row.id}
                  className="flex text-[9px] font-mono hover:bg-muted/30 border-b border-muted/5"
                  style={{ height: TABLE_ROW_HEIGHT }}
                >
                  <div className="w-12 px-1 flex items-center justify-end text-muted-foreground shrink-0">
                    {row.id}
                  </div>
                  <div className="flex-1 min-w-[52px] px-1 flex items-center justify-end">
                    {row.size}
                  </div>
                </div>
              );
            })}
          </div>
        </div>
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Direct GPU coloring (no pipeline modifier)
// ---------------------------------------------------------------------------

function colorAtomsByCluster(app: Molvis, result: ClusterResult) {
  const atomState = app.world.sceneIndex.meshRegistry.getAtomState();
  if (!atomState) return;

  const colorDesc = atomState.buffers.get("instanceColor");
  if (!colorDesc) return;

  const { clusterIdx, numClusters, nParticles } = result;
  const total = atomState.frameOffset + atomState.count;

  // Pre-compute one color per cluster
  const palette = getCategoricalPalette();
  const clusterColors = new Array<[number, number, number]>(numClusters);
  for (let c = 0; c < numClusters; c++) {
    clusterColors[c] = palette[c % palette.length];
  }

  // Unassigned atoms (cluster -1) get a dim gray
  const unassignedColor: [number, number, number] = [0.3, 0.3, 0.3];

  const count = Math.min(nParticles, total);
  for (let i = 0; i < count; i++) {
    const cid = clusterIdx[i];
    const rgb =
      cid >= 0 && cid < numClusters ? clusterColors[cid] : unassignedColor;
    const idx4 = i * 4;
    colorDesc.data[idx4 + 0] = rgb[0];
    colorDesc.data[idx4 + 1] = rgb[1];
    colorDesc.data[idx4 + 2] = rgb[2];
    // preserve existing alpha
  }

  atomState.uploadBuffer("instanceColor");
}

// ---------------------------------------------------------------------------
// ClusterPanel
// ---------------------------------------------------------------------------

export const ClusterPanel: React.FC<ClusterPanelProps> = ({ app }) => {
  // Config
  const [mode, setMode] = useState<ConnectivityMode>("cutoff");
  const [rMax, setRMax] = useState("3.2");
  const [minSize, setMinSize] = useState("1");

  // Options
  const [sortBySize, setSortBySize] = useState(true);
  const [colorByCluster, setColorByCluster] = useState(false);
  const [useSelection, setUseSelection] = useState(false);
  const [selectionModId, setSelectionModId] = useState("");

  // Selection modifiers tracking
  const [modifiers, setModifiers] = useState<ModifierOption[]>([]);
  const selectionsRef = useRef<Map<string, SelectionMask>>(new Map());

  // Result
  const [result, setResult] = useState<ClusterResult | null>(null);
  const [computing, setComputing] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [showList, setShowList] = useState(false);

  // Track bonds availability
  const [hasBonds, setHasBonds] = useState(false);

  useEffect(() => {
    if (!app) return;
    const checkBonds = () => {
      const frame = app.system.frame;
      if (!frame) {
        setHasBonds(false);
        return;
      }
      const bonds = frame.getBlock("bonds");
      setHasBonds(bonds !== undefined && bonds !== null && bonds.nrows() > 0);
    };
    checkBonds();
    const unsub = app.events.on("frame-change", checkBonds);
    return unsub;
  }, [app]);

  // Track selection modifiers from pipeline
  useEffect(() => {
    if (!app) return;
    const update = () => {
      const selSet = app.selectionSet;
      selectionsRef.current = new Map(selSet);
      const pipelineMods = app.modifierPipeline.getModifiers();
      const opts: ModifierOption[] = [];
      for (const mod of pipelineMods) {
        const mask = selSet.get(mod.id);
        if (mask) {
          opts.push({ id: mod.id, label: mod.name, count: mask.count() });
        }
      }
      setModifiers(opts);
      if (opts.length > 0 && !selectionModId) {
        setSelectionModId(opts[0].id);
      }
    };
    const unsub1 = app.modifierPipeline.on("computed", update);
    const unsub2 = app.modifierPipeline.on("modifier-added", update);
    const unsub3 = app.modifierPipeline.on("modifier-removed", update);
    update();
    return () => {
      unsub1();
      unsub2();
      unsub3();
    };
  }, [app, selectionModId]);

  const handleCompute = useCallback(() => {
    if (!app) return;
    const frame = app.system.frame;
    if (!frame) {
      setError("No frame loaded.");
      return;
    }

    setComputing(true);
    setError(null);

    requestAnimationFrame(() => {
      try {
        // Gather selected indices if option is on
        let selectedIndices: number[] | undefined;
        if (useSelection && selectionModId) {
          const mask = selectionsRef.current.get(selectionModId);
          if (!mask || mask.count() === 0) {
            setError("Selected modifier has no atoms.");
            setComputing(false);
            return;
          }
          selectedIndices = mask.getIndices();
        }

        const r = computeClusters(frame, {
          mode,
          rMax:
            mode === "cutoff"
              ? rMax
                ? Number.parseFloat(rMax)
                : undefined
              : undefined,
          minClusterSize: Math.max(1, Number.parseInt(minSize, 10) || 1),
          sortBySize,
          selectedIndices,
        });

        if (!r) {
          setError("Cluster analysis failed.");
          setComputing(false);
          return;
        }

        setResult(r);

        if (colorByCluster) {
          colorAtomsByCluster(app, r);
        }
      } catch (e) {
        setError(e instanceof Error ? e.message : "Cluster computation failed");
      } finally {
        setComputing(false);
      }
    });
  }, [
    app,
    mode,
    rMax,
    minSize,
    sortBySize,
    colorByCluster,
    useSelection,
    selectionModId,
  ]);

  // Cluster rows for table (already sorted by computeClusters if sortBySize=true)
  const clusterRows: ClusterRow[] = [];
  if (result) {
    for (let c = 0; c < result.numClusters; c++) {
      clusterRows.push({ id: c, size: result.clusterSizes[c] });
    }
  }

  return (
    <SidebarSection
      title="Cluster"
      subtitle={
        mode === "bonds" ? "By bonds" : `Cutoff r = ${rMax || "auto"} Å`
      }
      defaultOpen={true}
    >
      {/* Connectivity mode — segmented toggle */}
      <div className="flex items-center gap-1.5">
        <span className="w-10 shrink-0 text-[10px] text-muted-foreground">
          Mode
        </span>
        <div className="flex-1 min-w-0 grid grid-cols-2 gap-0.5 rounded-md bg-muted/40 p-0.5">
          <Button
            size="sm"
            variant={mode === "cutoff" ? "secondary" : "ghost"}
            className={`h-6 text-[10px] px-1 ${mode === "cutoff" ? "ring-1 ring-ring" : ""}`}
            onClick={() => setMode("cutoff")}
            title="Connect atoms within a cutoff distance"
          >
            Cutoff
          </Button>
          <Button
            size="sm"
            variant={mode === "bonds" ? "secondary" : "ghost"}
            className={`h-6 text-[10px] px-1 ${mode === "bonds" ? "ring-1 ring-ring" : ""}`}
            onClick={() => setMode("bonds")}
            disabled={!hasBonds}
            title={hasBonds ? "Use bond topology" : "Frame has no bonds"}
          >
            Bonds
          </Button>
        </div>
      </div>

      {mode === "cutoff" && (
        <div className="flex items-center gap-1.5">
          <span className="w-10 shrink-0 text-[10px] text-muted-foreground">
            r_max
          </span>
          <Input
            className="h-7 flex-1 min-w-0 text-xs font-mono"
            value={rMax}
            onChange={(e) => setRMax(e.target.value)}
            placeholder="auto"
            aria-label="Cutoff distance"
          />
        </div>
      )}

      <div className="flex items-center gap-1.5">
        <span className="w-10 shrink-0 text-[10px] text-muted-foreground">
          Min size
        </span>
        <Input
          className="h-7 flex-1 min-w-0 text-xs font-mono"
          value={minSize}
          onChange={(e) => setMinSize(e.target.value)}
          placeholder="1"
          aria-label="Minimum cluster size"
        />
      </div>

      {/* Options */}
      <div className="space-y-1 pt-0.5">
        <CheckboxRow
          id="cl-sort"
          checked={sortBySize}
          onCheckedChange={setSortBySize}
          label="Sort by size"
        />
        <CheckboxRow
          id="cl-color"
          checked={colorByCluster}
          onCheckedChange={setColorByCluster}
          label="Color particles by cluster"
        />
        <CheckboxRow
          id="cl-sel"
          checked={useSelection}
          onCheckedChange={setUseSelection}
          label="Limit to selected particles"
        />

        {useSelection && (
          <div className="flex items-center gap-1.5 pl-5">
            <Select value={selectionModId} onValueChange={setSelectionModId}>
              <SelectTrigger className="h-7 flex-1 min-w-0 px-2 text-xs">
                <SelectValue
                  placeholder={
                    modifiers.length === 0
                      ? "No modifier yet"
                      : "Choose modifier"
                  }
                />
              </SelectTrigger>
              <SelectContent>
                {modifiers.map((m) => (
                  <SelectItem key={m.id} value={m.id}>
                    <span className="text-xs">
                      {m.label}
                      <span className="ml-1 text-muted-foreground">
                        ({m.count})
                      </span>
                    </span>
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
        )}
      </div>

      <Button
        size="sm"
        className="h-7 w-full text-xs gap-1.5"
        onClick={handleCompute}
        disabled={computing}
      >
        <Play className="h-3.5 w-3.5" />
        {computing ? "Computing…" : "Compute clusters"}
      </Button>

      {error && (
        <p className="flex items-start gap-1 text-[10px] text-destructive leading-tight px-0.5">
          <AlertCircle className="h-3 w-3 shrink-0 mt-px" />
          <span className="truncate">{error}</span>
        </p>
      )}

      {result && (
        <div className="text-[10px] text-muted-foreground px-0.5">
          Found{" "}
          <span className="text-foreground font-medium">
            {result.numClusters}
          </span>{" "}
          cluster{result.numClusters === 1 ? "" : "s"}
        </div>
      )}

      {result && result.numClusters > 0 && (
        <>
          <ClusterSizeChart result={result} />

          <Button
            size="sm"
            variant="outline"
            className="h-7 w-full text-xs"
            onClick={() => setShowList((v) => !v)}
          >
            {showList ? "Hide cluster list" : "Show cluster list"}
          </Button>

          {showList && (
            <div className="space-y-1">
              <ClusterTable rows={clusterRows} />
              <Button
                size="sm"
                variant="outline"
                className="h-7 w-full text-xs gap-1.5"
                onClick={() => downloadClusterCsv(result)}
              >
                <Download className="h-3.5 w-3.5" />
                Export CSV
              </Button>
            </div>
          )}
        </>
      )}
    </SidebarSection>
  );
};

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function CheckboxRow({
  id,
  checked,
  onCheckedChange,
  label,
}: {
  id: string;
  checked: boolean;
  onCheckedChange: (v: boolean) => void;
  label: string;
}) {
  return (
    <div className="flex items-center gap-1.5">
      <Checkbox
        id={id}
        checked={checked}
        onCheckedChange={(v) => onCheckedChange(v === true)}
        className="h-3.5 w-3.5"
      />
      <Label htmlFor={id} className="text-[10px] cursor-pointer leading-none">
        {label}
      </Label>
    </div>
  );
}
