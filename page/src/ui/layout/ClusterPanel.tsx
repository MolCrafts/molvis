import { BarChart, type BarPoint } from "@molcrafts/molplot";
import {
  type ClusterResult,
  type ConnectivityMode,
  ensureClusterModifier,
  type Molvis,
  type SelectionMask,
  summarizeClusterMask,
} from "@molcrafts/molvis-stage";
import { ExternalLink } from "lucide-react";
import type React from "react";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
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
import { AnalysisAlert } from "./analysis/AnalysisAlert";
import { AnalysisChart } from "./analysis/AnalysisChart";
import { AnalysisPanelShell } from "./analysis/AnalysisPanelShell";
import { AnalysisRunBar } from "./analysis/AnalysisRunBar";
import { ParamStack } from "./analysis/ParamStack";
import { ResultSection } from "./analysis/ResultSection";

const CLUSTER_DOCS = "https://docs.molcrafts.org/molpy/compute/cluster/";

/**
 * Cutoff applied when the r_max field is left blank — the same default the
 * ClusterModifier starts from, restated here so a blank field never means
 * "keep whatever the last run used".
 */
const DEFAULT_R_MAX = 3.2;

interface ClusterPanelProps {
  app: Molvis | null;
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

function ClusterTable({
  rows,
  sortDir,
  onToggleSizeSort,
}: {
  rows: ClusterRow[];
  sortDir: "asc" | "desc" | null;
  onToggleSizeSort: () => void;
}) {
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

  const sizeHeader =
    sortDir === "asc" ? "Size ↑" : sortDir === "desc" ? "Size ↓" : "Size";

  return (
    <div
      className="flex flex-col"
      style={{ height: Math.min(rows.length * TABLE_ROW_HEIGHT + 24, 260) }}
    >
      <div className="flex shrink-0 border-b border-border/70 bg-muted/30 text-micro font-semibold text-muted-foreground">
        <div className="w-12 shrink-0 px-1 py-1 text-right">Cluster</div>
        <button
          type="button"
          className="min-w-data-count flex-1 px-1 py-1 text-right hover:text-foreground"
          onClick={onToggleSizeSort}
        >
          {sizeHeader}
        </button>
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

/**
 * Connected-component clustering on the current frame (cutoff or bond
 * topology). No frame scope: the run writes a mask on HEAD via the pipeline.
 */
export const ClusterPanel: React.FC<ClusterPanelProps> = ({ app }) => {
  const [mode, setMode] = useState<ConnectivityMode>("cutoff");
  const [rMax, setRMax] = useState(String(DEFAULT_R_MAX));
  const [useSelection, setUseSelection] = useState(false);
  const [selectionModId, setSelectionModId] = useState("");
  const [modifiers, setModifiers] = useState<ModifierOption[]>([]);
  const selectionsRef = useRef<Map<string, SelectionMask>>(new Map());
  const [result, setResult] = useState<ClusterResult | null>(null);
  const [computing, setComputing] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [resultKey, setResultKey] = useState<string | null>(null);
  const [hasBonds, setHasBonds] = useState(false);
  const [sizeSort, setSizeSort] = useState<"asc" | "desc" | null>(null);

  /**
   * Cutoff this run will actually use: the typed value when it parses to a
   * positive length, else {@link DEFAULT_R_MAX}. A blank field resolves to a
   * stated default, never to whatever the modifier last held.
   */
  const effectiveRMax = useMemo(() => {
    const parsed = Number.parseFloat(rMax);
    return Number.isFinite(parsed) && parsed > 0 ? parsed : DEFAULT_R_MAX;
  }, [rMax]);
  /** The field does not spell out the cutoff that will run — name the default. */
  const rMaxDefaulted = Number.parseFloat(rMax) !== effectiveRMax;

  /**
   * What a *rerun* would change. Scene coloring is absent on purpose: the
   * ClusterModifier's own draw switch owns it, so this form neither sets it nor
   * goes stale over it.
   */
  const paramsKey = useMemo(
    () =>
      JSON.stringify({
        mode,
        rMax: effectiveRMax,
        useSelection,
        selectionModId,
      }),
    [mode, effectiveRMax, useSelection, selectionModId],
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
    if (!app.system.frame) {
      setError("No frame loaded.");
      return;
    }

    setComputing(true);
    setError(null);

    void (async () => {
      try {
        const mod = ensureClusterModifier(app);
        mod.setMode(mode);
        if (mode === "cutoff") mod.setRMax(effectiveRMax);
        if (useSelection && selectionModId) {
          mod.selectionScopeId = selectionModId;
        } else {
          mod.selectionScopeId = null;
        }

        await app.applyPipeline({ fullRebuild: true });

        const frame = app.system.frame;
        const atoms = frame?.getBlock("atoms");
        const col = mod.columnName;
        const mask =
          atoms?.dtype(col) !== undefined ? atoms.viewColI32(col) : null;
        if (!mask || !atoms) {
          setError(`Cluster modifier did not write ${col}.`);
          return;
        }
        const summary = summarizeClusterMask(mask);
        const r: ClusterResult = {
          clusterIdx: summary.clusterIdx,
          clusterSizes: summary.clusterSizes,
          numClusters: summary.numClusters,
          nParticles: atoms.nrows(),
          mode,
          rMax: mode === "cutoff" ? mod.rMax : 0,
          minClusterSize: 1,
        };
        setResult(r);
        setResultKey(paramsKey);
        setSizeSort(null);
      } catch (e) {
        setError(e instanceof Error ? e.message : "Cluster computation failed");
      } finally {
        setComputing(false);
      }
    })();
  }, [app, mode, effectiveRMax, useSelection, selectionModId, paramsKey]);

  const clusterRows: ClusterRow[] = useMemo(() => {
    if (!result) return [];
    const rows: ClusterRow[] = [];
    for (let c = 0; c < result.numClusters; c++) {
      rows.push({ id: c, size: result.clusterSizes[c] });
    }
    if (sizeSort === "asc") rows.sort((a, b) => a.size - b.size);
    else if (sizeSort === "desc") rows.sort((a, b) => b.size - a.size);
    return rows;
  }, [result, sizeSort]);

  const selectionBlocked = useSelection && modifiers.length === 0;

  return (
    <AnalysisPanelShell
      footer={
        <AnalysisRunBar
          onRun={handleCompute}
          running={computing}
          disabled={computing || selectionBlocked || !app}
          label="Compute clusters"
          summary={mode === "bonds" ? "Topology components" : "Distance cutoff"}
        />
      }
    >
      {/* Flat form — no collapsible section wrapper, like every other panel. */}
      <div className="flex flex-col gap-2 p-2">
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
              title={
                hasBonds ? "Bond topology components" : "Frame has no bonds"
              }
            >
              Bonds
            </ViewerToggleAction>
          </div>
        </ParamStack>

        {mode === "cutoff" && (
          <ParamStack
            label="r_max"
            unit="Å"
            caption={rMaxDefaulted ? `default ${DEFAULT_R_MAX}` : null}
          >
            <Input
              className="h-control-compact min-w-0 font-mono text-xs tabular-nums"
              value={rMax}
              onChange={(e) => setRMax(e.target.value)}
              placeholder={String(DEFAULT_R_MAX)}
              aria-label="Cutoff distance"
            />
          </ParamStack>
        )}

        <div className="space-y-2 pt-1">
          <CheckboxRow
            id="cl-sel"
            checked={useSelection}
            onCheckedChange={setUseSelection}
            label="Limit to selected particles"
          />

          {useSelection && (
            <ParamStack label="Selection">
              <Select value={selectionModId} onValueChange={setSelectionModId}>
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

        {selectionBlocked && (
          <AnalysisAlert tone="warning">
            Add a Select modifier (or selection mask) to limit clusters.
          </AnalysisAlert>
        )}
        {error && <AnalysisAlert tone="error">{error}</AnalysisAlert>}

        {/* Reference, not a first-row control: docs sit after the form. */}
        <a
          href={CLUSTER_DOCS}
          target="_blank"
          rel="noreferrer"
          className="inline-flex items-center gap-1 self-start text-micro text-accent hover:underline"
        >
          Cluster docs
          <ExternalLink className="size-3" aria-hidden />
        </a>
      </div>

      {!result && !computing && (
        <EmptyState density="compact" title="No clusters yet" />
      )}

      {result && result.numClusters > 0 && (
        <ResultSection
          stale={stale}
          onExport={() => downloadClusterCsv(result)}
          chart={<ClusterSizeChart result={result} />}
          data={
            <ClusterTable
              rows={clusterRows}
              sortDir={sizeSort}
              onToggleSizeSort={() =>
                setSizeSort((d) =>
                  d === null ? "desc" : d === "desc" ? "asc" : null,
                )
              }
            />
          }
        />
      )}

      {result && result.numClusters === 0 && (
        <EmptyState density="compact" title="No clusters found" />
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
