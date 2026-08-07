import { BarChart, type BarPoint } from "@molcrafts/molplot";
import {
  type ClusterResult,
  ColorByPropertyModifier,
  type ConnectivityMode,
  categoricalColorAt,
  computeClusters,
  type Molvis,
  nextModifierId,
  type SelectionMask,
} from "@molcrafts/molvis-stage";
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
import { ViewerToggleAction } from "@/components/viewer/ViewerToggleAction";
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
        if (points.length === 0) {
          return {
            ready: () => Promise.resolve(),
            dispose: () => undefined,
          };
        }
        const chart = new BarChart(el, {
          series: [{ id: "sizes", label: "clusters", points }],
          orientation: "v",
          xAxis: { label: "cluster size", dtype: "category" },
          yAxis: { label: "count", rangemode: "tozero" },
          showLegend: true,
        });
        return {
          ready: async () => {
            await chart.ready();
          },
          dispose: () => chart.dispose(),
        };
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
      <div className="flex shrink-0 border-b border-border/70 bg-muted/30 text-micro font-semibold text-muted-foreground">
        <div className="w-12 shrink-0 px-1 py-1 text-right">Cluster</div>
        <div className="min-w-data-count flex-1 px-1 py-1 text-right">Size</div>
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
                  className="flex border-b border-border/50 font-mono text-micro tabular-nums hover:bg-muted/40"
                  style={{ height: TABLE_ROW_HEIGHT }}
                >
                  <div className="flex w-12 shrink-0 items-center justify-end px-1 text-muted-foreground">
                    {row.id}
                  </div>
                  <div className="flex min-w-data-count flex-1 items-center justify-end px-1">
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

  const clusterColors = new Array<[number, number, number]>(numClusters);
  for (let c = 0; c < numClusters; c++) {
    const rgb = categoricalColorAt(c);
    clusterColors[c] = [rgb[0], rgb[1], rgb[2]];
  }
  // Unassigned: dim but still visible (not near-black).
  const unassignedColor: [number, number, number] = [0.55, 0.55, 0.58];

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
      const pipelineMods = app.modifierPipeline.modifiers();
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
    const unsub2 = app.modifierPipeline.on("entry-added", update);
    const unsub3 = app.modifierPipeline.on("entry-removed", update);
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

  /** Analysis (left) → pipeline draw modifier (right): Color by Property on cluster_id. */
  const handleAddColorModifier = useCallback(() => {
    if (!app || !result) return;
    const frame = app.system.frame;
    const atoms = frame?.getBlock("atoms");
    if (!atoms || atoms.nrows() !== result.nParticles) {
      setError("Frame atom count does not match cluster result.");
      return;
    }
    // Persist labels on the working atoms block so Color by Property can read them.
    atoms.setColI32("cluster_id", Int32Array.from(result.clusterIdx));
    const existing = app.modifierPipeline
      .modifiers()
      .find(
        (m) =>
          m instanceof ColorByPropertyModifier && m.columnName === "cluster_id",
      );
    if (!existing) {
      const mod = new ColorByPropertyModifier(nextModifierId("color-cluster"));
      mod.columnName = "cluster_id";
      mod.categorical = true;
      app.modifierPipeline.addModifier(mod);
    }
    void app.applyPipeline({ fullRebuild: true });
  }, [app, result]);

  return (
    <AnalysisPanelShell
      footer={
        <div className="shrink-0 space-y-2 border-t border-border/70 bg-background/95 px-2 py-2 backdrop-blur">
          {children}
          <AnalysisRunBar
            className="border-0 p-0"
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
          {result && result.numClusters > 0 && (
            <Button
              type="button"
              variant="secondary"
              size="sm"
              className="h-control-compact w-full text-xs"
              disabled={!app || computing}
              onClick={handleAddColorModifier}
            >
              Add Color by Property (cluster_id)
            </Button>
          )}
        </div>
      }
    >
      <SidebarSection
        title="Cluster"
        subtitle={
          mode === "bonds" ? "By bonds" : `Cutoff r = ${rMax || "auto"} Å`
        }
        defaultOpen={true}
      >
        <div className="flex flex-col gap-2">
          <ParamStack label="Mode">
            <div className="grid grid-cols-2 gap-1 rounded-md bg-muted/40 p-1">
              <ViewerToggleAction
                selected={mode === "cutoff"}
                onClick={() => setMode("cutoff")}
              >
                Cutoff
              </ViewerToggleAction>
              <ViewerToggleAction
                selected={mode === "bonds"}
                onClick={() => setMode("bonds")}
                disabled={!hasBonds}
                title={hasBonds ? "Use bond topology" : "Frame has no bonds"}
              >
                Bonds
              </ViewerToggleAction>
            </div>
          </ParamStack>

          {mode === "cutoff" && (
            <ParamStack label="r_max">
              <Input
                className="h-control-compact min-w-0 font-mono text-xs tabular-nums"
                value={rMax}
                onChange={(e) => setRMax(e.target.value)}
                placeholder="auto"
                aria-label="Cutoff distance"
              />
            </ParamStack>
          )}

          <ParamStack label="Min size">
            <Input
              className="h-control-compact min-w-0 font-mono text-xs tabular-nums"
              value={minSize}
              onChange={(e) => setMinSize(e.target.value)}
              placeholder="1"
              aria-label="Minimum cluster size"
            />
          </ParamStack>

          <div className="space-y-2 pt-1">
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
                  <SelectTrigger
                    aria-label="Cluster atom selection"
                    className="h-control-compact w-full min-w-0 px-2 text-xs"
                  >
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
    <div className="flex items-center gap-2">
      <Checkbox
        id={id}
        checked={checked}
        onCheckedChange={(v) => onCheckedChange(v === true)}
        className="h-3.5 w-3.5"
      />
      <Label
        htmlFor={id}
        className="cursor-pointer text-micro leading-none font-normal"
      >
        {label}
      </Label>
    </div>
  );
}
