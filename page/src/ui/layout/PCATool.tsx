import {
  CHART_DEFAULT_COLOR,
  CHART_PALETTE,
  ScatterChart,
  type ScatterMarkerConfig,
  type ScatterPoint,
} from "@molcrafts/molplot";
import {
  type DatasetExploration,
  type ExplorationColorBy,
  type ExplorationConfig,
  type Molvis,
  runExploration,
} from "@molvis/core";
import type React from "react";
import { useCallback, useEffect, useMemo, useState } from "react";
import { Checkbox } from "@/components/ui/checkbox";
import { EmptyState } from "@/components/ui/empty-state";
import { Input } from "@/components/ui/input";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { cn } from "@/lib/utils";
import { SidebarSection } from "@/ui/layout/SidebarSection";
import { AnalysisAlert } from "./analysis/AnalysisAlert";
import {
  AnalysisChart,
  type AnalysisChartController,
} from "./analysis/AnalysisChart";
import { AnalysisPanelShell } from "./analysis/AnalysisPanelShell";
import { AnalysisRunBar } from "./analysis/AnalysisRunBar";
import { ParamStack } from "./analysis/ParamStack";
import { ResultSection } from "./analysis/ResultSection";

interface PCAToolProps {
  app: Molvis | null;
  children?: React.ReactNode;
}

const DEFAULT_K = 3;
const K_MIN = 2;
const K_MAX = 20;
const DEFAULT_SEED = 42;

const CATEGORICAL_PALETTE = CHART_PALETTE;
const SOLID_COLOR = CHART_DEFAULT_COLOR;

type ClusteringMethod = "none" | "kmeans";

type ColorBy = ExplorationColorBy;

interface DescriptorInfo {
  /** Descriptor name (a key in `system.frameLabels`). */
  name: string;
  /** Number of frames where the label parses to a finite number. */
  finite: number;
  /** Total frame count. */
  total: number;
}

interface ColorByOption {
  value: string;
  label: string;
  disabled?: boolean;
  config: ColorBy;
}

function clamp(v: number, lo: number, hi: number): number {
  if (v < lo) return lo;
  if (v > hi) return hi;
  return v;
}

/**
 * Summarise each frame-label column into a descriptor row. The columns are
 * already materialised on `system.frameLabels`, so this is a pure derivation —
 * the UI never walks frame meta directly.
 */
function describeLabels(
  frameLabels: Map<string, Float64Array> | null,
): DescriptorInfo[] {
  if (!frameLabels) return [];
  const out: DescriptorInfo[] = [];
  for (const [name, column] of frameLabels) {
    let finite = 0;
    for (const v of column) if (Number.isFinite(v)) finite++;
    if (finite > 0) out.push({ name, finite, total: column.length });
  }
  out.sort((a, b) => a.name.localeCompare(b.name));
  return out;
}

function buildMarker(
  colorBy: ColorBy,
  exploration: DatasetExploration,
  frameLabels: Map<string, Float64Array> | null,
): ScatterMarkerConfig {
  const nFrames = exploration.descriptors.nFrames;

  if (colorBy.kind === "cluster") {
    const clusters = exploration.clusters;
    if (!clusters) return { color: SOLID_COLOR };
    const colors = new Array<string>(nFrames);
    for (let i = 0; i < nFrames; i++) {
      const cid = clusters[i];
      const safe = cid >= 0 ? cid % CATEGORICAL_PALETTE.length : 0;
      colors[i] = CATEGORICAL_PALETTE[safe];
    }
    return { color: colors };
  }

  if (colorBy.kind === "label") {
    const column = frameLabels?.get(colorBy.name);
    if (!column) return { color: SOLID_COLOR };
    return {
      color: Array.from(column),
      colorscale: "Viridis",
      showscale: true,
    };
  }

  if (colorBy.kind === "frame-index") {
    const arr = new Array<number>(nFrames);
    for (let i = 0; i < nFrames; i++) arr[i] = i;
    return { color: arr, colorscale: "Viridis", showscale: true };
  }

  return { color: SOLID_COLOR };
}

export function PCATool({
  app,
  children,
}: PCAToolProps): React.ReactElement | null {
  // Both slots mirror `System` state, kept in sync via the matching events.
  // `frameLabels` is rebuilt by the loader on every trajectory swap;
  // `exploration` is the persisted PCA result (cleared on swap).
  const [frameLabels, setFrameLabels] = useState<Map<
    string,
    Float64Array
  > | null>(() => app?.system.frameLabels ?? null);
  const [exploration, setExploration] = useState<DatasetExploration | null>(
    () => app?.system.exploration ?? null,
  );
  const [tickedDescriptors, setTickedDescriptors] = useState<Set<string>>(
    new Set(),
  );
  const [clusteringMethod, setClusteringMethod] =
    useState<ClusteringMethod>("none");
  const [kText, setKText] = useState<string>(String(DEFAULT_K));
  const [colorBy, setColorBy] = useState<ColorBy>({ kind: "frame-index" });
  const [computing, setComputing] = useState(false);
  const [computeError, setComputeError] = useState<string | null>(null);
  const [resultKey, setResultKey] = useState<string | null>(null);

  useEffect(() => {
    if (!app) return;
    setFrameLabels(app.system.frameLabels);
    setExploration(app.system.exploration);

    const offLabels = app.events.on("frame-labels-change", (labels) => {
      setFrameLabels(labels);
    });
    const offExploration = app.events.on("exploration-change", (next) => {
      setExploration(next);
    });

    return () => {
      offLabels();
      offExploration();
    };
  }, [app]);

  const descriptors = useMemo<DescriptorInfo[]>(
    () => describeLabels(frameLabels),
    [frameLabels],
  );

  const descriptorNames = useMemo(
    () => descriptors.map((d) => d.name),
    [descriptors],
  );

  const nFrames = useMemo(() => {
    if (!frameLabels) return 0;
    for (const column of frameLabels.values()) return column.length;
    return 0;
  }, [frameLabels]);

  // Auto-pick everything on new label sets.
  useEffect(() => {
    setTickedDescriptors(new Set(descriptorNames));
  }, [descriptorNames]);

  const parsedK = useMemo(() => {
    const n = Number.parseInt(kText, 10);
    if (!Number.isFinite(n)) return DEFAULT_K;
    return clamp(n, K_MIN, K_MAX);
  }, [kText]);

  const paramsKey = useMemo(
    () =>
      JSON.stringify({
        descriptors: [...tickedDescriptors].sort(),
        clusteringMethod,
        k: parsedK,
        colorBy,
      }),
    [tickedDescriptors, clusteringMethod, parsedK, colorBy],
  );
  const stale =
    exploration !== null && resultKey !== null && resultKey !== paramsKey;

  const computeDisabled =
    computing ||
    descriptors.length === 0 ||
    tickedDescriptors.size < 2 ||
    nFrames < 3;

  const handleCompute = useCallback(() => {
    if (!app || !frameLabels) return;
    setComputing(true);
    setComputeError(null);
    try {
      const names = descriptorNames.filter((n) => tickedDescriptors.has(n));
      const config: ExplorationConfig = {
        descriptorNames: names,
        reduction: { method: "pca" },
        clustering:
          clusteringMethod === "kmeans"
            ? { method: "kmeans", k: parsedK, seed: DEFAULT_SEED }
            : { method: "none" },
        colorBy,
      };

      const result = runExploration(frameLabels, config);
      app.system.setExploration(result);
      setResultKey(paramsKey);

      if (colorBy.kind === "cluster" && !result.clusters) {
        setColorBy({ kind: "frame-index" });
      }
    } catch (err) {
      setComputeError(
        err instanceof Error ? err.message : "PCA computation failed",
      );
    } finally {
      setComputing(false);
    }
  }, [
    app,
    frameLabels,
    descriptorNames,
    tickedDescriptors,
    clusteringMethod,
    parsedK,
    colorBy,
    paramsKey,
  ]);

  const toggleDescriptor = useCallback((name: string, checked: boolean) => {
    setTickedDescriptors((prev) => {
      const next = new Set(prev);
      if (checked) next.add(name);
      else next.delete(name);
      return next;
    });
  }, []);

  const selectAllState: boolean | "indeterminate" = useMemo(() => {
    if (descriptorNames.length === 0) return false;
    if (tickedDescriptors.size === 0) return false;
    if (tickedDescriptors.size === descriptorNames.length) return true;
    return "indeterminate";
  }, [descriptorNames.length, tickedDescriptors.size]);

  const toggleSelectAll = useCallback(() => {
    setTickedDescriptors((prev) => {
      if (prev.size === descriptorNames.length) return new Set();
      return new Set(descriptorNames);
    });
  }, [descriptorNames]);

  const colorByOptions: ColorByOption[] = useMemo(() => {
    const opts: ColorByOption[] = [];
    opts.push({
      value: "frame-index",
      label: "Frame index",
      config: { kind: "frame-index" },
    });
    opts.push({
      value: "cluster",
      label: "Cluster",
      disabled: clusteringMethod === "none",
      config: { kind: "cluster" },
    });
    for (const name of descriptorNames) {
      opts.push({
        value: `label:${name}`,
        label: `Descriptor: ${name}`,
        config: { kind: "label", name },
      });
    }
    opts.push({
      value: "solid",
      label: "Solid",
      config: { kind: "solid" },
    });
    return opts;
  }, [descriptorNames, clusteringMethod]);

  const currentColorByValue = useMemo(() => {
    if (colorBy.kind === "cluster") return "cluster";
    if (colorBy.kind === "frame-index") return "frame-index";
    if (colorBy.kind === "solid") return "solid";
    return `label:${colorBy.name}`;
  }, [colorBy]);

  const handleColorByChange = useCallback(
    (value: string) => {
      const opt = colorByOptions.find((o) => o.value === value);
      if (opt) setColorBy(opt.config);
    },
    [colorByOptions],
  );

  const axes = useMemo<[string, string]>(
    () => exploration?.embedding.axes ?? ["PC1", "PC2"],
    [exploration],
  );

  const scatterController = useMemo<AnalysisChartController | null>(() => {
    if (!exploration || !app) return null;
    const explorationSnap = exploration;
    const colorBySnap = colorBy;
    const axesSnap = axes;
    const frameLabelsSnap = frameLabels;
    return {
      mount: (el) => {
        const { coords } = explorationSnap.embedding;
        const pointCount = coords.length / 2;
        const points: ScatterPoint[] = new Array(pointCount);
        for (let i = 0; i < pointCount; i++) {
          points[i] = {
            x: coords[2 * i],
            y: coords[2 * i + 1],
            customdata: i,
          };
        }

        const chart = new ScatterChart(el, {
          points,
          xAxis: { label: axesSnap[0] },
          yAxis: { label: axesSnap[1] },
          marker: {
            size: 6,
            ...buildMarker(colorBySnap, explorationSnap, frameLabelsSnap),
          },
          highlight: { index: app.system.trajectory.currentIndex ?? 0 },
          hovertemplate:
            "frame #%{customdata}<br>%{x:.3f}, %{y:.3f}<extra></extra>",
        });

        const offClick = chart.onPointClick((e) => {
          if (typeof e.customdata === "number") app.seekFrame(e.customdata);
        });

        let rafId: number | null = null;
        let pending: number | null = null;
        const flush = () => {
          rafId = null;
          const i = pending;
          pending = null;
          if (i === null || i < 0 || i >= pointCount) return;
          chart.setHighlight(i);
        };
        const offFrame = app.events.on("frame-change", (i) => {
          pending = i;
          if (rafId === null) rafId = requestAnimationFrame(flush);
        });

        return {
          dispose: () => {
            offClick();
            offFrame();
            if (rafId !== null) cancelAnimationFrame(rafId);
            chart.dispose();
          },
        };
      },
    };
  }, [app, exploration, colorBy, axes, frameLabels]);

  const hasDescriptors = descriptors.length > 0;

  if (!hasDescriptors) {
    return (
      <AnalysisPanelShell
        footer={
          <AnalysisRunBar
            onRun={() => undefined}
            disabled
            label="Run PCA"
            summary="No frame labels available"
            hint="Load ExtXYZ with key=value comment properties."
          />
        }
      >
        {children}
        <EmptyState
          density="compact"
          title="No frame labels"
          description="Load an ExtXYZ trajectory with key=value properties in comment lines to run PCA."
        />
      </AnalysisPanelShell>
    );
  }

  const runHint =
    nFrames < 3
      ? "Needs ≥ 3 frames with labels"
      : tickedDescriptors.size < 2
        ? "Pick ≥ 2 descriptors"
        : undefined;

  return (
    <AnalysisPanelShell
      footer={
        <AnalysisRunBar
          onRun={handleCompute}
          running={computing}
          disabled={computeDisabled}
          label={
            clusteringMethod === "kmeans"
              ? `Run PCA + k-means (k=${parsedK})`
              : "Run PCA"
          }
          summary={`${nFrames} frames · ${tickedDescriptors.size} descriptors`}
          hint={runHint}
        />
      }
    >
      {children}
      <SidebarSection
        title="Descriptors"
        subtitle={`${tickedDescriptors.size} / ${descriptors.length} selected`}
        defaultOpen={true}
      >
        <div className="overflow-hidden rounded-md border border-border/70">
          <div className="max-h-[220px] overflow-y-auto">
            <table className="w-full table-fixed border-collapse text-xs">
              <colgroup>
                <col className="w-7" />
                <col />
                <col className="w-14" />
              </colgroup>
              <thead className="sticky top-0 z-10 border-b border-border/70 bg-muted/40 backdrop-blur">
                <tr>
                  <th className="p-1 align-middle">
                    <div className="flex items-center justify-center">
                      <Checkbox
                        checked={selectAllState}
                        onCheckedChange={toggleSelectAll}
                        className="h-3.5 w-3.5"
                        aria-label="Toggle all descriptors"
                      />
                    </div>
                  </th>
                  <th className="px-1.5 py-1 text-left text-[10px] font-semibold uppercase tracking-wide text-muted-foreground">
                    Name
                  </th>
                  <th className="px-1.5 py-1 text-right text-[10px] font-semibold uppercase tracking-wide text-muted-foreground">
                    Finite
                  </th>
                </tr>
              </thead>
              <tbody>
                {descriptors.map((d) => {
                  const checked = tickedDescriptors.has(d.name);
                  return (
                    <tr
                      key={d.name}
                      tabIndex={0}
                      className={cn(
                        "cursor-pointer border-b border-border/50 last:border-b-0 outline-none transition-colors focus-visible:bg-muted/40",
                        checked
                          ? "bg-primary/5 hover:bg-primary/10"
                          : "hover:bg-muted/40",
                      )}
                      onClick={() => toggleDescriptor(d.name, !checked)}
                      onKeyDown={(e) => {
                        if (e.key === "Enter" || e.key === " ") {
                          e.preventDefault();
                          toggleDescriptor(d.name, !checked);
                        }
                      }}
                    >
                      <td className="p-1 align-middle">
                        <div className="flex items-center justify-center">
                          <Checkbox
                            checked={checked}
                            className="pointer-events-none h-3.5 w-3.5"
                            tabIndex={-1}
                          />
                        </div>
                      </td>
                      <td
                        className="truncate px-1.5 py-1 font-mono"
                        title={`${d.name} — ${d.finite}/${d.total} finite`}
                      >
                        {d.name}
                      </td>
                      <td className="px-1.5 py-1 text-right text-[10px] tabular-nums text-muted-foreground">
                        {d.finite}/{d.total}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        </div>
      </SidebarSection>

      <SidebarSection
        title="Clustering"
        subtitle={
          clusteringMethod === "kmeans"
            ? `k-means · k=${parsedK}`
            : "Off — PCA only"
        }
        defaultOpen={true}
      >
        <div className="flex flex-col gap-2">
          <ParamStack label="Method">
            <Select
              value={clusteringMethod}
              onValueChange={(v) => setClusteringMethod(v as ClusteringMethod)}
            >
              <SelectTrigger
                className="h-7 w-full min-w-0 px-2 text-xs"
                aria-label="Clustering method"
              >
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="none">
                  <span className="text-xs">Off (no clustering)</span>
                </SelectItem>
                <SelectItem value="kmeans">
                  <span className="text-xs">k-means</span>
                </SelectItem>
              </SelectContent>
            </Select>
          </ParamStack>

          {clusteringMethod === "kmeans" && (
            <ParamStack label={`k (${K_MIN}–${K_MAX})`}>
              <Input
                className="h-7 min-w-0 font-mono text-xs tabular-nums"
                value={kText}
                onChange={(e) => setKText(e.target.value)}
                inputMode="numeric"
                placeholder={String(DEFAULT_K)}
                aria-label="Number of clusters"
              />
            </ParamStack>
          )}
        </div>
      </SidebarSection>

      <SidebarSection title="Color" defaultOpen={true}>
        <ParamStack label="Color by">
          <Select
            value={currentColorByValue}
            onValueChange={handleColorByChange}
          >
            <SelectTrigger
              className="h-7 w-full min-w-0 px-2 text-xs"
              aria-label="Color by"
            >
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              {colorByOptions.map((opt) => (
                <SelectItem
                  key={opt.value}
                  value={opt.value}
                  disabled={opt.disabled}
                >
                  <span className="text-xs">{opt.label}</span>
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </ParamStack>
      </SidebarSection>

      {computeError && (
        <AnalysisAlert tone="error">{computeError}</AnalysisAlert>
      )}

      {!exploration && !computing && !computeError && (
        <EmptyState
          density="compact"
          title="No map yet"
          description="Select descriptors and run PCA to project frames into 2D."
        />
      )}

      {exploration && scatterController && (
        <ResultSection subtitle={`${axes[0]} · ${axes[1]}`} stale={stale}>
          <div role="img" aria-label="PCA scatter map">
            <AnalysisChart
              controller={scatterController}
              chartKey={`${resultKey ?? "pca"}-${axes[0]}-${axes[1]}-${colorBy.kind}`}
              title={`PCA · ${axes[0]} vs ${axes[1]}`}
              className="h-56 min-h-52"
            />
          </div>
        </ResultSection>
      )}
    </AnalysisPanelShell>
  );
}
