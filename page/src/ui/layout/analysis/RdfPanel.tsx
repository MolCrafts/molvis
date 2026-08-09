import { LineChart, type SeriesPoint } from "@molcrafts/molplot";
import {
  computeRdfTrajectory,
  estimateBoundingBoxVolume,
  estimateBoundingSphereVolume,
  estimateNBins,
  estimateRMax,
  type FrameRange,
  type Molvis,
  type PairRepresentation,
  type RdfResult,
  type RdfTrajectoryResult,
  type ResolvedPairRepresentation,
  resolvePairRepresentation,
} from "@molcrafts/molvis-stage";
import type React from "react";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { EmptyState } from "@/components/ui/empty-state";
import { Input } from "@/components/ui/input";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { AnalysisAlert } from "./AnalysisAlert";
import { AnalysisChart, type AnalysisChartController } from "./AnalysisChart";
import { AnalysisPanelShell } from "./AnalysisPanelShell";
import { AnalysisRunBar } from "./AnalysisRunBar";
import { ParamStack } from "./ParamStack";
import { ResultSection } from "./ResultSection";
import {
  ALL_ATOMS_OPTION_ID,
  collectAtomSelectionOptions,
  type ModifierOption,
  type SelectionOptionMap,
} from "./selectionOptions";

type VolumeSource = "manual" | "bbox" | "sphere";

function PairChart({ result }: { result: RdfResult }) {
  const controller = useMemo<AnalysisChartController>(() => {
    const { r, y, nBins, yLabel } = result;
    const points: SeriesPoint[] = new Array(nBins);
    for (let i = 0; i < nBins; i++) points[i] = { x: r[i], y: y[i] };
    return {
      mount: (el) => {
        const chart = new LineChart(el, {
          series: [
            {
              id: "y",
              label: yLabel,
              initialPoints: points,
              mode: "lines",
            },
          ],
          xAxis: { label: "r (Å)", rangemode: "tozero" },
          yAxis: { label: yLabel, rangemode: "tozero" },
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
      chartKey={`${result.representation}-${result.nBins}-${result.rMax}`}
      title={result.yLabel}
    />
  );
}

// ---------------------------------------------------------------------------
// Raw Data Table
// ---------------------------------------------------------------------------

const TABLE_ROW_HEIGHT = 22;
const TABLE_OVERSCAN = 5;

function downloadCsv(result: RdfResult) {
  const { r, y, gr, counts, density, nBins, yLabel } = result;
  const lines = [`r,${yLabel},g(r),counts,rho(r)`];
  for (let i = 0; i < nBins; i++) {
    lines.push(`${r[i]},${y[i]},${gr[i]},${counts[i]},${density[i]}`);
  }
  const blob = new Blob([lines.join("\n")], { type: "text/csv" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = "pair-distribution.csv";
  a.click();
  URL.revokeObjectURL(url);
}

function PairTable({ result }: { result: RdfResult }) {
  const [scrollTop, setScrollTop] = useState(0);
  const containerRef = useRef<HTMLDivElement>(null);

  const { r, y, counts, nBins, yLabel } = result;

  const totalHeight = nBins * TABLE_ROW_HEIGHT;
  const visibleCount = containerRef.current
    ? Math.ceil(containerRef.current.clientHeight / TABLE_ROW_HEIGHT)
    : 30;
  const startIdx = Math.max(
    0,
    Math.floor(scrollTop / TABLE_ROW_HEIGHT) - TABLE_OVERSCAN,
  );
  const endIdx = Math.min(nBins, startIdx + visibleCount + TABLE_OVERSCAN * 2);
  const offsetY = startIdx * TABLE_ROW_HEIGHT;

  const handleScroll = (e: React.UIEvent<HTMLDivElement>) => {
    setScrollTop(e.currentTarget.scrollTop);
  };

  const fmt = (v: number) => {
    if (Math.abs(v) < 1e-6) return "0";
    if (Math.abs(v) >= 100) return v.toFixed(2);
    if (Math.abs(v) >= 1) return v.toFixed(4);
    return v.toExponential(3);
  };

  return (
    <div
      className="flex flex-col"
      style={{ height: Math.min(nBins * TABLE_ROW_HEIGHT + 24, 300) }}
    >
      <div className="flex shrink-0 border-b border-border/70 bg-muted/30 text-micro font-semibold text-muted-foreground">
        <div className="w-8 shrink-0 px-1 py-1 text-right">#</div>
        <div className="min-w-0 flex-1 truncate px-1 py-1">r</div>
        <div className="min-w-0 flex-1 truncate px-1 py-1">{yLabel}</div>
        <div className="min-w-0 flex-1 truncate px-1 py-1">counts</div>
      </div>
      <div
        ref={containerRef}
        className="min-h-0 flex-1 overflow-y-auto"
        onScroll={handleScroll}
      >
        <div style={{ height: totalHeight, position: "relative" }}>
          <div
            style={{ position: "absolute", top: offsetY, left: 0, right: 0 }}
          >
            {Array.from({ length: endIdx - startIdx }, (_, offset) => {
              const i = startIdx + offset;
              return (
                <div
                  key={i}
                  className="flex border-b border-border/50 font-mono text-micro tabular-nums hover:bg-muted/40"
                  style={{ height: TABLE_ROW_HEIGHT }}
                >
                  <div className="flex w-8 shrink-0 items-center justify-end px-1 text-muted-foreground">
                    {i}
                  </div>
                  <div className="flex min-w-0 flex-1 items-center truncate px-1">
                    {fmt(r[i])}
                  </div>
                  <div className="flex min-w-0 flex-1 items-center truncate px-1">
                    {fmt(y[i])}
                  </div>
                  <div className="flex min-w-0 flex-1 items-center truncate px-1">
                    {counts[i]}
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

function formatVolume(v: number): string {
  if (!Number.isFinite(v) || v <= 0) return "";
  return v >= 100 ? v.toFixed(2) : v.toFixed(4);
}

function formatAutoCaption(
  v: number | null | undefined,
  unit?: string,
): string | null {
  if (v === null || v === undefined || !Number.isFinite(v) || v <= 0) {
    return null;
  }
  const n = v >= 100 ? v.toFixed(1) : v.toFixed(2);
  return unit ? `≈ ${n} ${unit}` : `≈ ${n}`;
}

function resolvedNeedsVolume(
  resolved: ResolvedPairRepresentation,
  hasBox: boolean,
): boolean {
  return resolved === "gr" && !hasBox;
}

export function RdfPanel({
  app,
  frameRange,
  trajectoryLength,
  children,
}: {
  app: Molvis | null;
  frameRange: FrameRange;
  trajectoryLength: number;
  /** Scope region rendered above parameters (scrolls with body). */
  children?: React.ReactNode;
}) {
  const [modifiers, setModifiers] = useState<ModifierOption[]>([]);
  const [groupA, setGroupA] = useState(ALL_ATOMS_OPTION_ID);
  const [groupB, setGroupB] = useState(ALL_ATOMS_OPTION_ID);
  const [representation, setRepresentation] =
    useState<PairRepresentation>("auto");
  const [nBins, setNBins] = useState(""); // empty = Auto
  const [rMin, setRMin] = useState("0");
  const [rMax, setRMax] = useState(""); // empty = Auto
  const [volume, setVolume] = useState("");
  const [volumeSource, setVolumeSource] = useState<VolumeSource>("manual");
  const [hasBox, setHasBox] = useState(false);
  const [boxVolume, setBoxVolume] = useState<number | null>(null);
  const [autoRMax, setAutoRMax] = useState<number | null>(null);
  const [bboxVolume, setBboxVolume] = useState<number | null>(null);
  const [sphereVolume, setSphereVolume] = useState<number | null>(null);
  const [result, setResult] = useState<RdfTrajectoryResult | null>(null);
  const [computing, setComputing] = useState(false);
  const [progress, setProgress] = useState<{
    completed: number;
    total: number;
  } | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [resultKey, setResultKey] = useState<string | null>(null);
  const selectionsRef = useRef<SelectionOptionMap>(new Map());

  const resolvedRep = useMemo((): ResolvedPairRepresentation => {
    if (representation === "auto") {
      return hasBox ? "gr" : "pair";
    }
    return representation;
  }, [representation, hasBox]);

  const needsManualVolume = resolvedNeedsVolume(resolvedRep, hasBox);

  const paramsKey = useMemo(
    () =>
      JSON.stringify({
        groupA,
        groupB,
        representation,
        nBins,
        rMin,
        rMax,
        volume,
        volumeSource,
        frameRange,
      }),
    [
      groupA,
      groupB,
      representation,
      nBins,
      rMin,
      rMax,
      volume,
      volumeSource,
      frameRange,
    ],
  );
  const stale =
    result !== null && resultKey !== null && resultKey !== paramsKey;

  useEffect(() => {
    if (!app) return;
    const update = () => {
      const { options: opts, selections } = collectAtomSelectionOptions(app);
      selectionsRef.current = selections;
      setModifiers(opts);
      if (opts.length === 0) {
        setGroupA(ALL_ATOMS_OPTION_ID);
        setGroupB(ALL_ATOMS_OPTION_ID);
        setResult(null);
        setResultKey(null);
      } else if (!groupA || !opts.some((o) => o.id === groupA)) {
        setGroupA(opts[0].id);
        setGroupB(opts[0].id);
      } else if (!groupB || !opts.some((o) => o.id === groupB)) {
        setGroupB(groupA);
      }
    };
    const unsub1 = app.modifierPipeline.on("computed", update);
    const unsub2 = app.modifierPipeline.on("entry-added", update);
    const unsub3 = app.modifierPipeline.on("entry-removed", update);
    const unsub4 = app.world.selectionManager.on("selection-change", update);
    const unsub5 = app.events.on("frame-change", update);
    update();
    return () => {
      unsub1();
      unsub2();
      unsub3();
      unsub4();
      unsub5();
    };
  }, [app, groupA, groupB]);

  useEffect(() => {
    if (!app) return;
    // `frame.box` is a frame-owned getter handle — do NOT free() it.
    let lastKey = "";
    const syncGeometry = () => {
      const frame = app.system.frame;
      if (!frame) {
        setHasBox(false);
        setBoxVolume(null);
        setAutoRMax(null);
        setBboxVolume(null);
        setSphereVolume(null);
        return;
      }
      const box = frame.box;
      const v = box ? box.volume() : null;
      const rEst = estimateRMax(frame);
      const bb = estimateBoundingBoxVolume(frame);
      const sp = estimateBoundingSphereVolume(frame);
      const key = `${v ?? "none"}|${rEst}|${bb ?? "n"}|${sp ?? "n"}`;
      if (key === lastKey) return;
      lastKey = key;
      if (v !== null && Number.isFinite(v) && v > 0) {
        setHasBox(true);
        setBoxVolume(v);
      } else {
        setHasBox(false);
        setBoxVolume(null);
      }
      setAutoRMax(rEst > 0 ? rEst : null);
      setBboxVolume(bb);
      setSphereVolume(sp);
    };
    syncGeometry();
    return app.events.on("frame-change", syncGeometry);
  }, [app]);

  // When volume source is bbox/sphere, mirror the estimate into the field.
  useEffect(() => {
    if (!needsManualVolume) return;
    if (volumeSource === "bbox" && bboxVolume != null) {
      setVolume(formatVolume(bboxVolume));
    } else if (volumeSource === "sphere" && sphereVolume != null) {
      setVolume(formatVolume(sphereVolume));
    }
  }, [needsManualVolume, volumeSource, bboxVolume, sphereVolume]);

  const handleGroupAChange = (val: string) => {
    setGroupA(val);
    if (!groupB || groupB === groupA) setGroupB(val);
  };

  const handleCompute = useCallback(() => {
    if (!app) return;
    const frame = app.system.frame;
    if (!frame) return;
    const selectionA = selectionsRef.current.get(groupA);
    const selectionB = selectionsRef.current.get(groupB);
    if (!selectionA) {
      setError("Group A selection not found.");
      return;
    }
    if (!selectionB) {
      setError("Group B selection not found.");
      return;
    }

    const resolved = resolvePairRepresentation(frame, representation);
    const needsVol = resolvedNeedsVolume(resolved, frame.box != null);

    let volumeParam: number | undefined;
    if (frame.box) {
      // Periodic: never send volume override unless user somehow forced one.
      // Box is the sole source for Auto g(r).
      volumeParam = undefined;
    } else if (needsVol) {
      const parsedVolume =
        volume.trim() === "" ? Number.NaN : Number.parseFloat(volume);
      if (!Number.isFinite(parsedVolume) || parsedVolume <= 0) {
        setError(
          "RDF g(r) needs a reference volume (Å³). Pick bounding box / sphere, or enter a value.",
        );
        return;
      }
      volumeParam = parsedVolume;
    }

    const parsedRMin = Number.parseFloat(rMin);
    const rMinParam =
      Number.isFinite(parsedRMin) && parsedRMin >= 0 ? parsedRMin : 0;

    let rMaxParam: number | undefined;
    if (rMax.trim() === "") {
      rMaxParam = undefined; // stage auto
    } else {
      const parsedRMax = Number.parseFloat(rMax);
      if (!(Number.isFinite(parsedRMax) && parsedRMax > rMinParam)) {
        setError("r_max must be > r_min.");
        return;
      }
      rMaxParam = parsedRMax;
    }

    let nBinsParam: number | undefined;
    if (nBins.trim() === "") {
      // Leave undefined so stage uses estimateNBins after resolving rMax —
      // but trajectory path needs a concrete value if rMax is also auto.
      // Resolve rMax client-side for auto bins consistency.
      const effectiveRMax = rMaxParam ?? estimateRMax(frame);
      if (!(effectiveRMax > rMinParam)) {
        setError("Could not estimate r_max — enter a value.");
        return;
      }
      nBinsParam = estimateNBins(effectiveRMax, rMinParam);
      if (rMaxParam === undefined) rMaxParam = effectiveRMax;
    } else {
      nBinsParam = Math.max(
        10,
        Math.min(500, Number.parseInt(nBins, 10) || 100),
      );
      if (rMaxParam === undefined) {
        const est = estimateRMax(frame);
        if (!(est > rMinParam)) {
          setError("Could not estimate r_max — enter a value.");
          return;
        }
        rMaxParam = est;
      }
    }

    setComputing(true);
    setProgress(null);
    setError(null);
    requestAnimationFrame(() => {
      void (async () => {
        try {
          const r = await computeRdfTrajectory(
            app.system.trajectory,
            {
              nBins: nBinsParam,
              rMin: rMinParam,
              rMax: rMaxParam,
              volume: volumeParam,
              representation,
              groupASelection: selectionA,
              groupBSelection: groupA === groupB ? undefined : selectionB,
            },
            {
              frameRange,
              onProgress: ({ completed, total }) =>
                setProgress({ completed, total }),
            },
          );
          if (!r) {
            setError(
              trajectoryLength === 0
                ? "Load a trajectory first."
                : "No frames in the selected range produced a histogram (need ≥2 atoms per frame).",
            );
          } else {
            setResult(r);
            setResultKey(paramsKey);
          }
        } catch (e) {
          const message =
            e instanceof Error
              ? e.message
              : typeof e === "string"
                ? e
                : "Pair distribution computation failed";
          setError(message);
        } finally {
          setComputing(false);
        }
      })();
    });
  }, [
    app,
    groupA,
    groupB,
    representation,
    nBins,
    rMin,
    rMax,
    volume,
    frameRange,
    paramsKey,
    trajectoryLength,
  ]);

  const isSelf = groupA === groupB;
  const volumeBlank = volume.trim() === "";
  const volumeMissing = needsManualVolume && volumeBlank;
  const computeDisabled =
    computing || !groupA || volumeMissing || trajectoryLength === 0;

  const autoBinsCaption = useMemo(() => {
    if (nBins.trim() !== "") return null;
    const r = rMax.trim() === "" ? autoRMax : Number.parseFloat(rMax);
    if (r === null || r === undefined || !Number.isFinite(r) || r <= 0) {
      return null;
    }
    const rMinV = Number.parseFloat(rMin);
    const rMinParam = Number.isFinite(rMinV) && rMinV >= 0 ? rMinV : 0;
    return formatAutoCaption(estimateNBins(r, rMinParam));
  }, [nBins, rMax, rMin, autoRMax]);

  const autoRMaxCaption =
    rMax.trim() === "" ? formatAutoCaption(autoRMax, "Å") : null;

  return (
    <AnalysisPanelShell
      footer={
        <div className="shrink-0 space-y-2 border-t border-border/70 bg-background/95 px-2 py-2 backdrop-blur">
          {children}
          <AnalysisRunBar
            className="border-0 p-0"
            onRun={handleCompute}
            running={computing}
            progress={progress}
            disabled={computeDisabled}
            label={
              isSelf
                ? `Compute self-${resolvedRep === "gr" ? "RDF" : "histogram"}`
                : `Compute cross-${resolvedRep === "gr" ? "RDF" : "histogram"}`
            }
            summary={
              trajectoryLength === 0
                ? "Load a trajectory first"
                : trajectoryLength === 1
                  ? "1 frame"
                  : `${trajectoryLength} frames`
            }
            hint={
              volumeMissing ? "Reference volume required for g(r)." : undefined
            }
          />
        </div>
      }
    >
      <div className="flex flex-col gap-2 p-2">
        <ParamStack label="Group A">
          <Select value={groupA} onValueChange={handleGroupAChange}>
            <SelectTrigger
              aria-label="Pair distribution group A"
              className="h-control-compact w-full min-w-0 px-2 text-xs"
            >
              <SelectValue placeholder="Choose group" />
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

        <ParamStack label="Group B">
          <Select value={groupB} onValueChange={setGroupB}>
            <SelectTrigger
              aria-label="Pair distribution group B"
              className="h-control-compact w-full min-w-0 px-2 text-xs"
            >
              <SelectValue placeholder="Choose group" />
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

        <ParamStack label="Representation">
          <Select
            value={representation}
            onValueChange={(v) => setRepresentation(v as PairRepresentation)}
          >
            <SelectTrigger
              aria-label="Pair distribution representation"
              className="h-control-compact w-full min-w-0 px-2 text-xs"
            >
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="auto">
                <span className="text-xs">
                  Auto
                  <span className="ml-1 text-muted-foreground">
                    ({hasBox ? "g(r)" : "p(r)"})
                  </span>
                </span>
              </SelectItem>
              <SelectItem value="gr">
                <span className="text-xs">RDF g(r)</span>
              </SelectItem>
              <SelectItem value="pair">
                <span className="text-xs">Pair distribution p(r)</span>
              </SelectItem>
              <SelectItem value="density">
                <span className="text-xs">Radial density ρ(r)</span>
              </SelectItem>
            </SelectContent>
          </Select>
        </ParamStack>

        {/* Histogram range: three equal mono fields — never 2-col with orphan. */}
        <div className="grid grid-cols-3 gap-1.5">
          <ParamStack label="bins" caption={autoBinsCaption}>
            <Input
              className="h-control-compact min-w-0 font-mono text-xs tabular-nums"
              value={nBins}
              onChange={(e) => setNBins(e.target.value)}
              placeholder="Auto"
              aria-label="Number of bins (empty = Auto)"
            />
          </ParamStack>
          <ParamStack label="r_min" unit="Å">
            <Input
              className="h-control-compact min-w-0 font-mono text-xs tabular-nums"
              value={rMin}
              onChange={(e) => setRMin(e.target.value)}
              placeholder="0"
              aria-label="r_min"
            />
          </ParamStack>
          <ParamStack label="r_max" unit="Å" caption={autoRMaxCaption}>
            <Input
              className="h-control-compact min-w-0 font-mono text-xs tabular-nums"
              value={rMax}
              onChange={(e) => setRMax(e.target.value)}
              placeholder="Auto"
              aria-label="r_max (empty = Auto)"
            />
          </ParamStack>
        </div>

        {/* Periodic g(r): density is derived — caption only, not a fake field. */}
        {hasBox && resolvedRep === "gr" && boxVolume != null && (
          <p className="px-0.5 text-micro tabular-nums text-muted-foreground">
            ρ from box · V = {formatVolume(boxVolume)} Å³
          </p>
        )}

        {!hasBox && resolvedRep !== "gr" && representation === "auto" && (
          <p className="px-0.5 text-micro text-muted-foreground">
            No box — Auto uses p(r)
          </p>
        )}

        {needsManualVolume && (
          <div className="flex flex-col gap-1.5">
            <ParamStack label="Reference volume" unit="Å³">
              <Select
                value={volumeSource}
                onValueChange={(v) => setVolumeSource(v as VolumeSource)}
              >
                <SelectTrigger
                  aria-label="Reference volume source"
                  className="h-control-compact w-full min-w-0 px-2 text-xs"
                >
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="bbox">
                    <span className="text-xs">
                      Bounding box
                      {bboxVolume != null && (
                        <span className="ml-1 text-muted-foreground">
                          ({formatVolume(bboxVolume)})
                        </span>
                      )}
                    </span>
                  </SelectItem>
                  <SelectItem value="sphere">
                    <span className="text-xs">
                      Bounding sphere
                      {sphereVolume != null && (
                        <span className="ml-1 text-muted-foreground">
                          ({formatVolume(sphereVolume)})
                        </span>
                      )}
                    </span>
                  </SelectItem>
                  <SelectItem value="manual">
                    <span className="text-xs">Manual</span>
                  </SelectItem>
                </SelectContent>
              </Select>
            </ParamStack>
            <Input
              className="h-control-compact min-w-0 font-mono text-xs tabular-nums"
              value={volume}
              onChange={(e) => {
                setVolumeSource("manual");
                setVolume(e.target.value);
              }}
              placeholder="Å³"
              aria-label="Normalization volume in cubic angstrom"
              readOnly={volumeSource !== "manual"}
            />
            {volumeMissing && (
              <AnalysisAlert tone="warning">
                Enter a positive volume (Å³) for g(r)
              </AnalysisAlert>
            )}
          </div>
        )}

        {error && <AnalysisAlert tone="error">{error}</AnalysisAlert>}
      </div>

      {!result && !computing && (
        <EmptyState density="compact" title="No RDF yet" />
      )}

      {result && (
        <ResultSection
          stale={stale}
          onExport={() => downloadCsv(result.average)}
          chart={<PairChart result={result.average} />}
          data={<PairTable result={result.average} />}
        />
      )}
    </AnalysisPanelShell>
  );
}
