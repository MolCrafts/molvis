import { LineChart, type SeriesPoint } from "@molcrafts/molplot";
import {
  computeRdfTrajectory,
  type FrameRange,
  type Molvis,
  type RdfResult,
  type RdfTrajectoryResult,
} from "@molvis/core";
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
import { SidebarSection } from "@/ui/layout/SidebarSection";
import { AnalysisAlert } from "./AnalysisAlert";
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

function RdfChart({ result }: { result: RdfResult }) {
  const [plotDiv, setPlotDiv] = useState<HTMLDivElement | null>(null);

  useEffect(() => {
    const div = plotDiv;
    if (!div) return;
    const { r, gr, nBins } = result;
    const points: SeriesPoint[] = new Array(nBins);
    for (let i = 0; i < nBins; i++) points[i] = { x: r[i], y: gr[i] };
    const chart = new LineChart(div, {
      series: [
        { id: "gr", label: "g(r)", initialPoints: points, mode: "lines" },
      ],
      xAxis: { label: "r (Å)", rangemode: "tozero" },
      yAxis: { label: "g(r)", rangemode: "tozero" },
    });
    return () => {
      chart.dispose();
    };
  }, [plotDiv, result]);

  return <div ref={setPlotDiv} className="h-44 w-full min-h-40" />;
}

// ---------------------------------------------------------------------------
// RDF Raw Data Table
// ---------------------------------------------------------------------------

const TABLE_ROW_HEIGHT = 22;
const TABLE_OVERSCAN = 5;

function downloadCsv(result: RdfResult) {
  const { r, gr, counts, nBins } = result;
  const lines = ["r,g(r),counts"];
  for (let i = 0; i < nBins; i++) {
    lines.push(`${r[i]},${gr[i]},${counts[i]}`);
  }
  const blob = new Blob([lines.join("\n")], { type: "text/csv" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = "rdf.csv";
  a.click();
  URL.revokeObjectURL(url);
}

function RdfTable({ result }: { result: RdfResult }) {
  const [scrollTop, setScrollTop] = useState(0);
  const containerRef = useRef<HTMLDivElement>(null);

  const { r, gr, counts, nBins } = result;

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
      <div className="flex shrink-0 border-b border-border/70 bg-muted/30 text-[10px] font-semibold text-muted-foreground">
        <div className="w-8 shrink-0 px-0.5 py-0.5 text-right">#</div>
        <div className="min-w-0 flex-1 truncate px-0.5 py-0.5">r</div>
        <div className="min-w-0 flex-1 truncate px-0.5 py-0.5">g(r)</div>
        <div className="min-w-0 flex-1 truncate px-0.5 py-0.5">counts</div>
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
                  className="flex border-b border-border/50 font-mono text-[10px] tabular-nums hover:bg-muted/40"
                  style={{ height: TABLE_ROW_HEIGHT }}
                >
                  <div className="flex w-8 shrink-0 items-center justify-end px-0.5 text-muted-foreground">
                    {i}
                  </div>
                  <div className="flex min-w-0 flex-1 items-center truncate px-0.5">
                    {fmt(r[i])}
                  </div>
                  <div className="flex min-w-0 flex-1 items-center truncate px-0.5">
                    {fmt(gr[i])}
                  </div>
                  <div className="flex min-w-0 flex-1 items-center truncate px-0.5">
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

// Threshold below which a user-typed volume is treated as "unchanged from box".
const VOLUME_OVERRIDE_EPSILON = 1e-6;

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
  const [nBins, setNBins] = useState("100");
  const [rMin, setRMin] = useState("0");
  const [rMax, setRMax] = useState("");
  const [volume, setVolume] = useState("");
  const [hasBox, setHasBox] = useState(false);
  const [result, setResult] = useState<RdfTrajectoryResult | null>(null);
  const [computing, setComputing] = useState(false);
  const [progress, setProgress] = useState<{
    completed: number;
    total: number;
  } | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [resultKey, setResultKey] = useState<string | null>(null);
  const selectionsRef = useRef<SelectionOptionMap>(new Map());

  const paramsKey = useMemo(
    () =>
      JSON.stringify({
        groupA,
        groupB,
        nBins,
        rMin,
        rMax,
        volume,
        frameRange,
      }),
    [groupA, groupB, nBins, rMin, rMax, volume, frameRange],
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
        // Re-home B when its modifier disappeared; avoid depending on groupB
        // in the effect deps (would re-subscribe on every B change).
        setGroupB(groupA);
      }
    };
    const unsub1 = app.modifierPipeline.on("computed", update);
    const unsub2 = app.modifierPipeline.on("modifier-added", update);
    const unsub3 = app.modifierPipeline.on("modifier-removed", update);
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
    // `frame.simbox` yields a fresh Box wrapper on every access, so compare by
    // the numeric volume (stable across ticks) and free the transient wrapper.
    let lastVolume: number | null = Number.NaN;
    const syncBoxVolume = () => {
      const box = app.system.frame?.simbox;
      const v = box ? box.volume() : null;
      box?.free();
      if (v === lastVolume) return;
      lastVolume = v;
      if (v !== null) {
        setHasBox(true);
        setVolume(formatVolume(v));
      } else {
        setHasBox(false);
        setVolume("");
      }
    };
    syncBoxVolume();
    return app.events.on("frame-change", syncBoxVolume);
  }, [app]);

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

    const parsedVolume =
      volume.trim() === "" ? Number.NaN : Number.parseFloat(volume);
    let volumeParam: number | undefined;
    if (hasBox) {
      const box = frame.simbox;
      const boxVol = box ? box.volume() : Number.NaN;
      box?.free();
      if (
        Number.isFinite(parsedVolume) &&
        parsedVolume > 0 &&
        Math.abs(parsedVolume - boxVol) > VOLUME_OVERRIDE_EPSILON
      ) {
        volumeParam = parsedVolume;
      }
    } else {
      if (!Number.isFinite(parsedVolume) || parsedVolume <= 0) {
        setError("Non-periodic frame — enter a positive volume (Å³).");
        return;
      }
      volumeParam = parsedVolume;
    }

    const parsedRMin = Number.parseFloat(rMin);
    const rMinParam =
      Number.isFinite(parsedRMin) && parsedRMin >= 0 ? parsedRMin : 0;

    setComputing(true);
    setProgress(null);
    setError(null);
    requestAnimationFrame(() => {
      void (async () => {
        try {
          const r = await computeRdfTrajectory(
            app.system.trajectory,
            {
              nBins: Math.max(
                10,
                Math.min(500, Number.parseInt(nBins, 10) || 100),
              ),
              rMin: rMinParam,
              rMax: rMax ? Number.parseFloat(rMax) : undefined,
              volume: volumeParam,
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
            setError("Not enough atoms to compute RDF.");
          } else {
            setResult(r);
            setResultKey(paramsKey);
          }
        } catch (e) {
          setError(e instanceof Error ? e.message : "RDF computation failed");
        } finally {
          setComputing(false);
        }
      })();
    });
  }, [
    app,
    groupA,
    groupB,
    nBins,
    rMin,
    rMax,
    volume,
    hasBox,
    frameRange,
    paramsKey,
  ]);

  const isSelf = groupA === groupB;
  const volumeBlank = volume.trim() === "";
  const volumeMissing = !hasBox && volumeBlank;
  const computeDisabled =
    computing || !groupA || volumeMissing || trajectoryLength === 0;

  return (
    <AnalysisPanelShell
      footer={
        <AnalysisRunBar
          onRun={handleCompute}
          running={computing}
          progress={progress}
          disabled={computeDisabled}
          label={isSelf ? "Compute self-RDF" : "Compute cross-RDF"}
          summary={
            trajectoryLength === 0
              ? "Load a trajectory first"
              : `${trajectoryLength} frame${trajectoryLength === 1 ? "" : "s"} available`
          }
          hint={
            volumeMissing
              ? "Volume is required for non-periodic systems."
              : undefined
          }
        />
      }
    >
      {children}
      <SidebarSection
        title="RDF"
        subtitle={
          trajectoryLength > 1
            ? `${trajectoryLength} frames available`
            : isSelf
              ? "Self g(r)"
              : "Cross g(r)"
        }
        defaultOpen={true}
      >
        <div className="flex flex-col gap-2">
          <ParamStack label="Group A">
            <Select value={groupA} onValueChange={handleGroupAChange}>
              <SelectTrigger className="h-7 w-full min-w-0 px-2 text-xs">
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
              <SelectTrigger className="h-7 w-full min-w-0 px-2 text-xs">
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

          <div className="grid grid-cols-2 gap-1.5">
            <ParamStack label="Bins">
              <Input
                className="h-7 min-w-0 font-mono text-xs tabular-nums"
                value={nBins}
                onChange={(e) => setNBins(e.target.value)}
                placeholder="100"
                aria-label="Number of bins"
              />
            </ParamStack>
            <ParamStack label="r_min">
              <Input
                className="h-7 min-w-0 font-mono text-xs tabular-nums"
                value={rMin}
                onChange={(e) => setRMin(e.target.value)}
                placeholder="0"
                aria-label="r_min"
              />
            </ParamStack>
            <ParamStack label="r_max">
              <Input
                className="h-7 min-w-0 font-mono text-xs tabular-nums"
                value={rMax}
                onChange={(e) => setRMax(e.target.value)}
                placeholder="auto"
                aria-label="r_max"
              />
            </ParamStack>
            <ParamStack label="Volume">
              <Input
                className="h-7 min-w-0 font-mono text-xs tabular-nums"
                value={volume}
                onChange={(e) => setVolume(e.target.value)}
                placeholder={hasBox ? "from box" : "Å³ required"}
                aria-label="Normalization volume in cubic angstrom"
              />
            </ParamStack>
          </div>
        </div>

        {volumeMissing && (
          <AnalysisAlert tone="warning">
            Non-periodic frame — enter a volume in Å³
          </AnalysisAlert>
        )}

        {error && <AnalysisAlert tone="error">{error}</AnalysisAlert>}
      </SidebarSection>

      {!result && !computing && (
        <EmptyState
          density="compact"
          title="No RDF yet"
          description="Set groups and bins, then compute g(r)."
        />
      )}

      {result && (
        <ResultSection
          subtitle={`${result.perFrame.length} frame${result.perFrame.length === 1 ? "" : "s"} · ${result.average.nBins} bins · r_max=${result.average.rMax.toFixed(1)}`}
          stale={stale}
          onExport={() => downloadCsv(result.average)}
          chart={<RdfChart result={result.average} />}
          data={<RdfTable result={result.average} />}
        />
      )}
    </AnalysisPanelShell>
  );
}
