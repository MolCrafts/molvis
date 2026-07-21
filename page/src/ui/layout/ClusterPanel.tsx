import { BarChart, type BarPoint } from "@molcrafts/molplot";
import {
  type ClusterResult,
  type ConnectivityMode,
  computeClusters,
  getCategoricalPalette,
  type Molvis,
  type SelectionMask,
} from "@molvis/core";
import type React from "react";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { EmptyState } from "@/components/ui/empty-state";
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
import { AnalysisAlert } from "./analysis/AnalysisAlert";
import { AnalysisChart } from "./analysis/AnalysisChart";
import { AnalysisPanelShell } from "./analysis/AnalysisPanelShell";
import { AnalysisRunBar } from "./analysis/AnalysisRunBar";
import { ParamStack } from "./analysis/ParamStack";
import { ResultSection } from "./analysis/ResultSection";

interface ClusterPanelProps {
  app: Molvis | null;
  children?: React.ReactNode;
}

interface ModifierOption {
  id: string;
  label: string;
  count: number;
}

function ClusterSizeChart({ result }: { result: ClusterResult }) {
  const controller = useMemo(() => {
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
    return {
      mount: (el: HTMLElement) => {
        if (points.length === 0) return { dispose: () => undefined };
        const chart = new BarChart(el, {
          series: [{ id: "sizes", label: "clusters", points }],
          orientation: "v",
          xAxis: { label: "cluster size", dtype: "category" },
          yAxis: { label: "count", rangemode: "tozero" },
          showLegend: true,
        });
        return { dispose: () => chart.dispose() };
      },
    };
  }, [result]);

  return (
    <AnalysisChart
      controller={controller}
      chartKey={`${result.numClusters}-${result.nParticles}`}
      title="Cluster sizes"
    />
  );
}

const TABLE_ROW_HEIGHT = 22;
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
      <div className="flex shrink-0 border-b border-border/70 bg-muted/30 text-[10px] font-semibold text-muted-foreground">
        <div className="w-12 shrink-0 px-1 py-0.5 text-right">Cluster</div>
        <div className="min-w-[52px] flex-1 px-1 py-0.5 text-right">Size</div>
      </div>
      <div
        ref={containerRef}
        className="min-h-0 flex-1 overflow-y-auto"
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
                  className="flex border-b border-border/50 font-mono text-[10px] tabular-nums hover:bg-muted/40"
                  style={{ height: TABLE_ROW_HEIGHT }}
                >
                  <div className="flex w-12 shrink-0 items-center justify-end px-1 text-muted-foreground">
                    {row.id}
                  </div>
                  <div className="flex min-w-[52px] flex-1 items-center justify-end px-1">
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

function colorAtomsByCluster(app: Molvis, result: ClusterResult) {
  const atomState = app.world.sceneIndex.meshRegistry.getAtomState();
  if (!atomState) return;

  const colorDesc = atomState.buffers.get("instanceColor");
  if (!colorDesc) return;

  const { clusterIdx, numClusters, nParticles } = result;
  const total = atomState.frameOffset + atomState.count;

  const palette = getCategoricalPalette();
  const clusterColors = new Array<[number, number, number]>(numClusters);
  for (let c = 0; c < numClusters; c++) {
    clusterColors[c] = palette[c % palette.length];
  }

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
  }

  atomState.uploadBuffer("instanceColor");
}

export const ClusterPanel: React.FC<ClusterPanelProps> = ({
  app,
  children,
}) => {
  const [mode, setMode] = useState<ConnectivityMode>("cutoff");
  const [rMax, setRMax] = useState("3.2");
  const [minSize, setMinSize] = useState("1");
  const [sortBySize, setSortBySize] = useState(true);
  const [colorByCluster, setColorByCluster] = useState(false);
  const [useSelection, setUseSelection] = useState(false);
  const [selectionModId, setSelectionModId] = useState("");
  const [modifiers, setModifiers] = useState<ModifierOption[]>([]);
  const selectionsRef = useRef<Map<string, SelectionMask>>(new Map());
  const [result, setResult] = useState<ClusterResult | null>(null);
  const [computing, setComputing] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [resultKey, setResultKey] = useState<string | null>(null);
  const [hasBonds, setHasBonds] = useState(false);

  const paramsKey = useMemo(
    () =>
      JSON.stringify({
        mode,
        rMax,
        minSize,
        sortBySize,
        colorByCluster,
        useSelection,
        selectionModId,
      }),
    [
      mode,
      rMax,
      minSize,
      sortBySize,
      colorByCluster,
      useSelection,
      selectionModId,
    ],
  );
  const stale =
    result !== null && resultKey !== null && resultKey !== paramsKey;

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
    return app.events.on("frame-change", checkBonds);
  }, [app]);

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
      if (opts.length === 0) {
        setSelectionModId("");
      } else if (
        !selectionModId ||
        !opts.some((o) => o.id === selectionModId)
      ) {
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
        setResultKey(paramsKey);

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
    paramsKey,
  ]);

  const clusterRows: ClusterRow[] = [];
  if (result) {
    for (let c = 0; c < result.numClusters; c++) {
      clusterRows.push({ id: c, size: result.clusterSizes[c] });
    }
  }

  const selectionBlocked = useSelection && modifiers.length === 0;

  return (
    <AnalysisPanelShell
      footer={
        <AnalysisRunBar
          onRun={handleCompute}
          running={computing}
          disabled={computing || selectionBlocked || !app}
          label="Compute clusters"
          summary={
            mode === "bonds"
              ? "Connectivity: bonds"
              : `Connectivity: cutoff ${rMax || "auto"} Å`
          }
        />
      }
    >
      {children}
      <SidebarSection
        title="Cluster"
        subtitle={
          mode === "bonds" ? "By bonds" : `Cutoff r = ${rMax || "auto"} Å`
        }
        defaultOpen={true}
      >
        <div className="flex flex-col gap-2">
          <ParamStack label="Mode">
            <div className="grid grid-cols-2 gap-0.5 rounded-md bg-muted/40 p-0.5">
              <Button
                size="sm"
                variant={mode === "cutoff" ? "secondary" : "ghost"}
                className={`h-7 text-xs ${mode === "cutoff" ? "ring-1 ring-ring" : ""}`}
                onClick={() => setMode("cutoff")}
              >
                Cutoff
              </Button>
              <Button
                size="sm"
                variant={mode === "bonds" ? "secondary" : "ghost"}
                className={`h-7 text-xs ${mode === "bonds" ? "ring-1 ring-ring" : ""}`}
                onClick={() => setMode("bonds")}
                disabled={!hasBonds}
                title={hasBonds ? "Use bond topology" : "Frame has no bonds"}
              >
                Bonds
              </Button>
            </div>
          </ParamStack>

          {mode === "cutoff" && (
            <ParamStack label="r_max">
              <Input
                className="h-7 min-w-0 font-mono text-xs tabular-nums"
                value={rMax}
                onChange={(e) => setRMax(e.target.value)}
                placeholder="auto"
                aria-label="Cutoff distance"
              />
            </ParamStack>
          )}

          <ParamStack label="Min size">
            <Input
              className="h-7 min-w-0 font-mono text-xs tabular-nums"
              value={minSize}
              onChange={(e) => setMinSize(e.target.value)}
              placeholder="1"
              aria-label="Minimum cluster size"
            />
          </ParamStack>

          <div className="space-y-1.5 pt-0.5">
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
              <ParamStack label="Selection">
                <Select
                  value={selectionModId}
                  onValueChange={setSelectionModId}
                >
                  <SelectTrigger className="h-7 w-full min-w-0 px-2 text-xs">
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
              </ParamStack>
            )}
          </div>
        </div>

        {selectionBlocked && (
          <AnalysisAlert tone="warning">
            Add a Select modifier (or selection mask) to limit clusters.
          </AnalysisAlert>
        )}
        {error && <AnalysisAlert tone="error">{error}</AnalysisAlert>}
      </SidebarSection>

      {!result && !computing && (
        <EmptyState
          density="compact"
          title="No clusters yet"
          description="Choose connectivity, then compute connected components."
        />
      )}

      {result && result.numClusters > 0 && (
        <ResultSection
          subtitle={`${result.numClusters} cluster${result.numClusters === 1 ? "" : "s"}`}
          stale={stale}
          onExport={() => downloadClusterCsv(result)}
          chart={<ClusterSizeChart result={result} />}
          data={<ClusterTable rows={clusterRows} />}
        />
      )}

      {result && result.numClusters === 0 && (
        <EmptyState
          density="compact"
          title="No clusters found"
          description="Try a larger cutoff or lower min size."
        />
      )}
    </AnalysisPanelShell>
  );
};

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
      <Label
        htmlFor={id}
        className="cursor-pointer text-[11px] leading-none font-normal"
      >
        {label}
      </Label>
    </div>
  );
}
