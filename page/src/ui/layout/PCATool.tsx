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
import { AlertCircle, Info, Play } from "lucide-react";
import type React from "react";
import { useCallback, useEffect, useMemo, useState } from "react";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
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

interface PCAToolProps {
  app: Molvis | null;
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

export function PCATool({ app }: PCAToolProps): React.ReactElement | null {
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

  const [plotDiv, setPlotDiv] = useState<HTMLDivElement | null>(null);

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

  useEffect(() => {
    const div = plotDiv;
    if (!div || !exploration || !app) return;

    const { coords } = exploration.embedding;
    const pointCount = coords.length / 2;
    const points: ScatterPoint[] = new Array(pointCount);
    for (let i = 0; i < pointCount; i++) {
      points[i] = { x: coords[2 * i], y: coords[2 * i + 1], customdata: i };
    }

    const chart = new ScatterChart(div, {
      points,
      xAxis: { label: axes[0] },
      yAxis: { label: axes[1] },
      marker: {
        size: 6,
        ...buildMarker(colorBy, exploration, frameLabels),
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

    return () => {
      offClick();
      offFrame();
      if (rafId !== null) cancelAnimationFrame(rafId);
      chart.dispose();
    };
  }, [app, plotDiv, exploration, colorBy, axes, frameLabels]);

  const hasDescriptors = descriptors.length > 0;

  if (!hasDescriptors) {
    return (
      <div className="px-2 py-2">
        <p className="flex items-start gap-1 text-[10px] text-muted-foreground leading-tight">
          <Info className="h-3 w-3 shrink-0 mt-px" />
          <span>
            This dataset has no frame labels. Load an ExtXYZ trajectory with{" "}
            <code className="font-mono">key=value</code> properties in comment
            lines.
          </span>
        </p>
      </div>
    );
  }

  return (
    <div className="flex-1 min-h-0 flex flex-col">
      <SidebarSection
        title="Descriptors"
        subtitle={`${tickedDescriptors.size} / ${descriptors.length} selected`}
        defaultOpen={true}
      >
        <div className="rounded-md border overflow-hidden">
          <div className="max-h-[220px] overflow-y-auto">
            <table className="w-full text-xs table-fixed border-collapse">
              <colgroup>
                <col className="w-7" />
                <col />
                <col className="w-14" />
              </colgroup>
              <thead className="sticky top-0 z-10 bg-muted/40 backdrop-blur border-b">
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
                  <th className="text-left px-1.5 py-1 text-[9px] uppercase tracking-wide font-semibold text-muted-foreground">
                    Name
                  </th>
                  <th className="text-right px-1.5 py-1 text-[9px] uppercase tracking-wide font-semibold text-muted-foreground">
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
                        "border-b last:border-b-0 cursor-pointer transition-colors outline-none focus-visible:bg-muted/40",
                        checked
                          ? "bg-primary/5 hover:bg-primary/10"
                          : "hover:bg-muted/30",
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
                            className="h-3.5 w-3.5 pointer-events-none"
                            tabIndex={-1}
                          />
                        </div>
                      </td>
                      <td
                        className="px-1.5 py-1 font-mono truncate"
                        title={`${d.name} — ${d.finite}/${d.total} finite`}
                      >
                        {d.name}
                      </td>
                      <td className="px-1.5 py-1 text-right text-[10px] text-muted-foreground tabular-nums">
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
        <div className="flex items-center gap-1.5">
          <span className="w-10 shrink-0 text-[10px] text-muted-foreground">
            Method
          </span>
          <Select
            value={clusteringMethod}
            onValueChange={(v) => setClusteringMethod(v as ClusteringMethod)}
          >
            <SelectTrigger
              className="h-7 flex-1 min-w-0 px-2 text-xs"
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
        </div>

        {clusteringMethod === "kmeans" && (
          <div className="flex items-center gap-1.5">
            <span className="w-10 shrink-0 text-[10px] text-muted-foreground">
              k
            </span>
            <Input
              className="h-7 flex-1 min-w-0 text-xs font-mono"
              value={kText}
              onChange={(e) => setKText(e.target.value)}
              inputMode="numeric"
              placeholder={String(DEFAULT_K)}
              aria-label="Number of clusters"
            />
            <span className="text-[9px] text-muted-foreground shrink-0">
              {K_MIN}-{K_MAX}
            </span>
          </div>
        )}
      </SidebarSection>

      <SidebarSection title="Color" defaultOpen={true}>
        <div className="flex items-center gap-1.5">
          <span className="w-10 shrink-0 text-[10px] text-muted-foreground">
            Color by
          </span>
          <Select
            value={currentColorByValue}
            onValueChange={handleColorByChange}
          >
            <SelectTrigger
              className="h-7 flex-1 min-w-0 px-2 text-xs"
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
        </div>
      </SidebarSection>

      <SidebarSection title="Compute" defaultOpen={true}>
        <p className="text-[10px] text-muted-foreground px-0.5 leading-tight">
          Will run:{" "}
          <span className="text-foreground font-medium">
            PCA
            {clusteringMethod === "kmeans" ? ` + k-means (k=${parsedK})` : ""}
          </span>
        </p>

        <Button
          size="sm"
          className="h-7 w-full text-xs gap-1.5"
          onClick={handleCompute}
          disabled={computeDisabled}
        >
          <Play className="h-3.5 w-3.5" />
          {computing
            ? "Computing…"
            : nFrames < 3
              ? "Needs ≥ 3 frames"
              : tickedDescriptors.size < 2
                ? "Pick ≥ 2 descriptors"
                : "Compute"}
        </Button>

        {computeError && (
          <p className="flex items-start gap-1 text-[10px] text-destructive leading-tight px-0.5">
            <AlertCircle className="h-3 w-3 shrink-0 mt-px" />
            <span className="truncate" title={computeError}>
              {computeError}
            </span>
          </p>
        )}

        {exploration && !computeError && (
          <p className="text-[9px] text-muted-foreground px-0.5 truncate">
            {axes[0]} · {axes[1]}
          </p>
        )}
      </SidebarSection>

      <SidebarSection
        title="Map"
        defaultOpen={true}
        className="flex-1 min-h-0 flex flex-col"
        contentClassName="flex-1 min-h-0 flex flex-col"
      >
        {exploration ? (
          <div ref={setPlotDiv} className="flex-1 min-h-0" />
        ) : (
          <p className="flex items-start gap-1 text-[10px] text-muted-foreground leading-tight px-0.5">
            <Info className="h-3 w-3 shrink-0 mt-px" />
            <span>Click Compute to render the 2D map</span>
          </p>
        )}
      </SidebarSection>
    </div>
  );
}
