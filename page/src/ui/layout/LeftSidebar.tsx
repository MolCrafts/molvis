import { LineChart, type SeriesPoint } from "@molcrafts/molplot";
import {
  computeRdf,
  type Molvis,
  type RdfResult,
  type SelectionMask,
} from "@molvis/core";
import { AlertCircle, Download, Info, Play } from "lucide-react";
import type React from "react";
import { useCallback, useEffect, useRef, useState } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { SidebarSection } from "@/ui/layout/SidebarSection";
import { ClusterPanel } from "./ClusterPanel";
import { PCATool } from "./PCATool";

interface LeftSidebarProps {
  app: Molvis | null;
}

type AnalysisType = "rdf" | "cluster" | "pca";

const ANALYSIS_OPTIONS: { value: AnalysisType; label: string }[] = [
  { value: "rdf", label: "Radial distribution g(r)" },
  { value: "cluster", label: "Cluster analysis" },
  { value: "pca", label: "PCA" },
];

/** Prevent pointer events from leaking to the BabylonJS canvas. */
const stopPointerPropagation = (e: React.PointerEvent) => {
  e.stopPropagation();
};

// ---------------------------------------------------------------------------
// RDF chart — molplot LineChart over g(r) vs r
// ---------------------------------------------------------------------------

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

  return <div ref={setPlotDiv} className="h-52 w-full" />;
}

// ---------------------------------------------------------------------------
// RDF Raw Data Table
// ---------------------------------------------------------------------------

const TABLE_ROW_HEIGHT = 20;
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
      <div className="flex bg-muted/30 border-b text-[9px] font-semibold text-muted-foreground shrink-0">
        <div className="w-8 px-0.5 py-0.5 text-right shrink-0">#</div>
        <div className="flex-1 min-w-0 px-0.5 py-0.5 truncate">r</div>
        <div className="flex-1 min-w-0 px-0.5 py-0.5 truncate">g(r)</div>
        <div className="flex-1 min-w-0 px-0.5 py-0.5 truncate">counts</div>
      </div>
      <div
        ref={containerRef}
        className="flex-1 min-h-0 overflow-y-auto"
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
                  className="flex text-[9px] font-mono hover:bg-muted/30 border-b border-muted/5"
                  style={{ height: TABLE_ROW_HEIGHT }}
                >
                  <div className="w-8 px-0.5 flex items-center justify-end text-muted-foreground shrink-0">
                    {i}
                  </div>
                  <div className="flex-1 min-w-0 px-0.5 flex items-center truncate">
                    {fmt(r[i])}
                  </div>
                  <div className="flex-1 min-w-0 px-0.5 flex items-center truncate">
                    {fmt(gr[i])}
                  </div>
                  <div className="flex-1 min-w-0 px-0.5 flex items-center truncate">
                    {counts[i]}
                  </div>
                </div>
              );
            })}
          </div>
        </div>
      </div>
      <Button
        size="sm"
        variant="outline"
        className="h-7 w-full text-xs gap-1.5 mt-1"
        onClick={() => downloadCsv(result)}
      >
        <Download className="h-3.5 w-3.5" />
        Export CSV
      </Button>
    </div>
  );
}

// ---------------------------------------------------------------------------
// RDF Panel
// ---------------------------------------------------------------------------

interface ModifierOption {
  id: string;
  label: string;
  count: number;
}

function formatVolume(v: number): string {
  if (!Number.isFinite(v) || v <= 0) return "";
  return v >= 100 ? v.toFixed(2) : v.toFixed(4);
}

// Threshold below which a user-typed volume is treated as "unchanged from box".
const VOLUME_OVERRIDE_EPSILON = 1e-6;

function RdfPanel({ app }: { app: Molvis | null }) {
  const [modifiers, setModifiers] = useState<ModifierOption[]>([]);
  const [groupA, setGroupA] = useState("");
  const [groupB, setGroupB] = useState("");
  const [nBins, setNBins] = useState("100");
  const [rMin, setRMin] = useState("0");
  const [rMax, setRMax] = useState("");
  const [volume, setVolume] = useState("");
  const [hasBox, setHasBox] = useState(false);
  const [result, setResult] = useState<RdfResult | null>(null);
  const [computing, setComputing] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const selectionsRef = useRef<Map<string, SelectionMask>>(new Map());

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
      if (opts.length > 0 && !groupA) {
        setGroupA(opts[0].id);
        setGroupB(opts[0].id);
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
  }, [app, groupA]);

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
    const maskA = selectionsRef.current.get(groupA);
    const maskB = selectionsRef.current.get(groupB);
    if (!maskA) {
      setError("Group A selection not found.");
      return;
    }
    if (!maskB) {
      setError("Group B selection not found.");
      return;
    }
    const indicesA = maskA.getIndices();
    const indicesB = maskB.getIndices();
    if (indicesA.length === 0) {
      setError("Group A is empty.");
      return;
    }
    if (indicesB.length === 0) {
      setError("Group B is empty.");
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
    setError(null);
    requestAnimationFrame(() => {
      try {
        const r = computeRdf(frame, {
          nBins: Math.max(10, Math.min(500, Number.parseInt(nBins, 10) || 100)),
          rMin: rMinParam,
          rMax: rMax ? Number.parseFloat(rMax) : undefined,
          volume: volumeParam,
          groupA: indicesA,
          groupB: indicesB,
        });
        if (!r) {
          setError("Not enough atoms to compute RDF.");
        } else {
          setResult(r);
        }
      } catch (e) {
        setError(e instanceof Error ? e.message : "RDF computation failed");
      } finally {
        setComputing(false);
      }
    });
  }, [app, groupA, groupB, nBins, rMin, rMax, volume, hasBox]);

  const isSelf = groupA === groupB;
  const noModifiers = modifiers.length === 0;
  const volumeBlank = volume.trim() === "";
  const volumeMissing = !hasBox && volumeBlank;
  const computeDisabled = computing || !groupA || volumeMissing;

  return (
    <>
      <SidebarSection
        title="RDF"
        subtitle={noModifiers ? undefined : isSelf ? "Self g(r)" : "Cross g(r)"}
        defaultOpen={true}
      >
        {noModifiers ? (
          <p className="flex items-start gap-1 text-[10px] text-muted-foreground leading-tight px-0.5">
            <Info className="h-3 w-3 shrink-0 mt-px" />
            <span>Add a selection modifier to choose groups</span>
          </p>
        ) : (
          <>
            <div className="flex items-center gap-1.5">
              <span className="w-10 shrink-0 text-[10px] text-muted-foreground">
                Group A
              </span>
              <Select value={groupA} onValueChange={handleGroupAChange}>
                <SelectTrigger className="h-7 flex-1 min-w-0 px-2 text-xs">
                  <SelectValue placeholder="Choose modifier" />
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

            <div className="flex items-center gap-1.5">
              <span className="w-10 shrink-0 text-[10px] text-muted-foreground">
                Group B
              </span>
              <Select value={groupB} onValueChange={setGroupB}>
                <SelectTrigger className="h-7 flex-1 min-w-0 px-2 text-xs">
                  <SelectValue placeholder="Choose modifier" />
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

            <div className="flex flex-wrap items-center gap-1.5">
              <div className="flex items-center gap-1.5 flex-1 min-w-[130px]">
                <span className="w-10 shrink-0 text-[10px] text-muted-foreground">
                  Bins
                </span>
                <Input
                  className="h-7 flex-1 min-w-0 text-xs font-mono"
                  value={nBins}
                  onChange={(e) => setNBins(e.target.value)}
                  placeholder="100"
                  aria-label="Number of bins"
                />
              </div>
              <div className="flex items-center gap-1.5 flex-1 min-w-[130px]">
                <span className="w-10 shrink-0 text-[10px] text-muted-foreground">
                  r_min
                </span>
                <Input
                  className="h-7 flex-1 min-w-0 text-xs font-mono"
                  value={rMin}
                  onChange={(e) => setRMin(e.target.value)}
                  placeholder="0"
                  aria-label="r_min"
                />
              </div>
            </div>

            <div className="flex flex-wrap items-center gap-1.5">
              <div className="flex items-center gap-1.5 flex-1 min-w-[130px]">
                <span className="w-10 shrink-0 text-[10px] text-muted-foreground">
                  r_max
                </span>
                <Input
                  className="h-7 flex-1 min-w-0 text-xs font-mono"
                  value={rMax}
                  onChange={(e) => setRMax(e.target.value)}
                  placeholder="auto"
                  aria-label="r_max"
                />
              </div>
              <div className="flex items-center gap-1.5 flex-1 min-w-[130px]">
                <span className="w-10 shrink-0 text-[10px] text-muted-foreground">
                  Volume
                </span>
                <Input
                  className="h-7 flex-1 min-w-0 text-xs font-mono"
                  value={volume}
                  onChange={(e) => setVolume(e.target.value)}
                  placeholder={hasBox ? "from box" : "required (Å³)"}
                  aria-label="Normalization volume in cubic angstrom"
                />
              </div>
            </div>

            {volumeMissing && (
              <p className="flex items-start gap-1 text-[10px] text-muted-foreground leading-tight px-0.5">
                <Info className="h-3 w-3 shrink-0 mt-px" />
                <span>Non-periodic frame — enter a volume in Å³</span>
              </p>
            )}

            <Button
              size="sm"
              className="h-7 w-full text-xs gap-1.5"
              onClick={handleCompute}
              disabled={computeDisabled}
            >
              <Play className="h-3.5 w-3.5" />
              {computing
                ? "Computing…"
                : isSelf
                  ? "Compute self-RDF"
                  : "Compute cross-RDF"}
            </Button>

            {error && (
              <p className="flex items-start gap-1 text-[10px] text-destructive leading-tight px-0.5">
                <AlertCircle className="h-3 w-3 shrink-0 mt-px" />
                <span className="truncate">{error}</span>
              </p>
            )}
          </>
        )}
      </SidebarSection>

      {result && (
        <>
          <SidebarSection
            title="Result"
            subtitle={`${result.nParticles} atoms · dr=${result.dr.toFixed(3)} · r_max=${result.rMax.toFixed(1)}`}
            defaultOpen={true}
          >
            <RdfChart result={result} />
          </SidebarSection>

          <SidebarSection
            title="Raw Data"
            subtitle={`${result.nBins} bins`}
            defaultOpen={false}
          >
            <RdfTable result={result} />
          </SidebarSection>
        </>
      )}
    </>
  );
}

// ---------------------------------------------------------------------------
// LeftSidebar — Analysis panel with type selector
// ---------------------------------------------------------------------------

export const LeftSidebar: React.FC<LeftSidebarProps> = ({ app }) => {
  const [analysisType, setAnalysisType] = useState<AnalysisType>("rdf");

  return (
    <div
      className="h-full w-full bg-background flex flex-col border-r"
      onPointerDown={stopPointerPropagation}
    >
      <div className="border-b bg-muted/15 shrink-0 flex items-center gap-1.5 px-2 py-1">
        <span className="text-[10px] font-semibold tracking-wide uppercase shrink-0">
          Analysis
        </span>
        <Select
          value={analysisType}
          onValueChange={(v) => setAnalysisType(v as AnalysisType)}
        >
          <SelectTrigger
            className="h-7 flex-1 min-w-0 px-2 text-xs"
            aria-label="Analysis type"
          >
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            {ANALYSIS_OPTIONS.map(({ value, label }) => (
              <SelectItem key={value} value={value}>
                <span className="text-xs">{label}</span>
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      </div>

      <div className="flex-1 min-h-0 overflow-y-auto flex flex-col">
        {analysisType === "rdf" && <RdfPanel app={app} />}
        {analysisType === "cluster" && <ClusterPanel app={app} />}
        {analysisType === "pca" && <PCATool app={app} />}
      </div>
    </div>
  );
};
