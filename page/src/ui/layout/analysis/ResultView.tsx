import { LineChart, type SeriesPoint } from "@molcrafts/molplot";
import type { AnalysisResultKind } from "@molvis/core";
import type React from "react";
import { useEffect, useState } from "react";

/**
 * Render an analysis payload by its catalog `resultKind`.
 *
 * Payload field names differ per binding, so each renderer picks the first
 * field it recognises rather than hard-coding one analysis's shape.
 */

type Payload = Record<string, unknown>;

const isNumericArray = (value: unknown): value is ArrayLike<number> =>
  ArrayBuffer.isView(value) || Array.isArray(value);

const toArray = (value: unknown): number[] =>
  isNumericArray(value) ? Array.from(value as ArrayLike<number>, Number) : [];

/** First present field among `keys`, as a number array. */
function pick(payload: Payload, keys: string[]): number[] {
  for (const key of keys) {
    if (key in payload && isNumericArray(payload[key]))
      return toArray(payload[key]);
  }
  return [];
}

const X_KEYS = ["binCenters", "lagTimes", "frequencies", "r", "centers", "x"];
const Y_KEYS = ["rdf", "values", "intensities", "gr", "density", "counts", "y"];

function LineResult({ payload, label }: { payload: Payload; label: string }) {
  const [host, setHost] = useState<HTMLDivElement | null>(null);
  const x = pick(payload, X_KEYS);
  const y = pick(payload, Y_KEYS);
  const plottable = x.length > 0 && y.length > 0;

  useEffect(() => {
    if (!host || !plottable) return;
    const n = Math.min(x.length, y.length);
    const initialPoints: SeriesPoint[] = Array.from({ length: n }, (_, i) => ({
      x: x[i],
      y: y[i],
    }));
    const chart = new LineChart(host, {
      series: [{ id: "result", label, initialPoints, mode: "lines" }],
      xAxis: { rangemode: "tozero" },
      yAxis: { label, rangemode: "tozero" },
    });
    return () => {
      chart.dispose();
    };
  }, [host, x, y, label, plottable]);

  if (!plottable) {
    return (
      <EmptyResult reason="the payload carries no plottable x/y columns" />
    );
  }
  return <div ref={setHost} className="h-48 w-full" />;
}

function BarResult({ payload }: { payload: Payload }) {
  const sizes = pick(payload, ["clusterSizes", "sizes", "counts"]);
  if (sizes.length === 0)
    return <EmptyResult reason="no bar data in the payload" />;
  const max = Math.max(...sizes);
  const shown = sizes.slice(0, 40);
  return (
    <div className="flex flex-col gap-0.5">
      {shown.map((size, i) => (
        // biome-ignore lint/suspicious/noArrayIndexKey: the bin index is the datum's identity
        <div key={i} className="flex items-center gap-1.5">
          <span className="w-8 shrink-0 text-right font-mono text-[10px] text-muted-foreground">
            {i}
          </span>
          <div className="h-2.5 flex-1 overflow-hidden rounded-sm bg-muted/40">
            <div
              className="h-full rounded-sm bg-primary/70"
              style={{ width: `${(size / max) * 100}%` }}
            />
          </div>
          <span className="w-10 shrink-0 font-mono text-[10px] tabular-nums">
            {size}
          </span>
        </div>
      ))}
      {sizes.length > shown.length && (
        <p className="pt-1 text-[10px] text-muted-foreground">
          showing {shown.length} of {sizes.length}
        </p>
      )}
    </div>
  );
}

function ScalarResult({ payload }: { payload: Payload }) {
  const entries = Object.entries(payload).filter(
    ([, value]) => typeof value === "number",
  ) as [string, number][];
  if (entries.length === 0)
    return <EmptyResult reason="no scalar fields in the payload" />;
  return (
    <div className="grid grid-cols-2 gap-1.5">
      {entries.map(([key, value]) => (
        <div key={key} className="rounded border bg-muted/15 px-2 py-1.5">
          <div className="truncate text-[10px] text-muted-foreground">
            {key}
          </div>
          <div className="font-mono text-xs tabular-nums">
            {Number.isInteger(value) ? value : value.toPrecision(6)}
          </div>
        </div>
      ))}
    </div>
  );
}

function stats(values: number[]): { min: number; max: number; mean: number } {
  let min = Number.POSITIVE_INFINITY;
  let max = Number.NEGATIVE_INFINITY;
  let sum = 0;
  for (const value of values) {
    if (value < min) min = value;
    if (value > max) max = value;
    sum += value;
  }
  return { min, max, mean: sum / values.length };
}

function MatrixResult({ payload }: { payload: Payload }) {
  const shape = isNumericArray(payload.shape)
    ? toArray(payload.shape)
    : Array.isArray(payload.shape)
      ? (payload.shape as number[])
      : [];
  const data = pick(payload, [
    "pmf",
    "density",
    "data",
    "counts",
    "intensities",
  ]);
  if (data.length === 0)
    return <EmptyResult reason="no matrix data in the payload" />;
  const { min, max, mean } = stats(data);
  return (
    <div className="flex flex-col gap-1.5">
      <dl className="grid grid-cols-2 gap-x-3 gap-y-1 text-[10px]">
        <Stat
          label="shape"
          value={shape.length ? shape.join(" × ") : String(data.length)}
        />
        <Stat label="cells" value={String(data.length)} />
        <Stat label="min" value={min.toPrecision(4)} />
        <Stat label="max" value={max.toPrecision(4)} />
        <Stat label="mean" value={mean.toPrecision(4)} />
      </dl>
      <DownloadJson payload={payload} />
    </div>
  );
}

function TableResult({ payload }: { payload: Payload }) {
  const rows = Object.entries(payload).filter(
    ([, value]) => !isNumericArray(value),
  );
  const columns = Object.entries(payload).filter(([, value]) =>
    isNumericArray(value),
  );
  return (
    <div className="flex flex-col gap-1.5">
      {rows.length > 0 && (
        <dl className="grid grid-cols-2 gap-x-3 gap-y-1 text-[10px]">
          {rows.map(([key, value]) => (
            <Stat key={key} label={key} value={String(value)} />
          ))}
        </dl>
      )}
      {columns.length > 0 && (
        <dl className="grid grid-cols-2 gap-x-3 gap-y-1 text-[10px]">
          {columns.map(([key, value]) => {
            const array = toArray(value);
            return (
              <Stat key={key} label={key} value={`${array.length} values`} />
            );
          })}
        </dl>
      )}
      <DownloadJson payload={payload} />
    </div>
  );
}

function Stat({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex min-w-0 justify-between gap-2">
      <dt className="truncate text-muted-foreground">{label}</dt>
      <dd className="shrink-0 font-mono tabular-nums">{value}</dd>
    </div>
  );
}

function DownloadJson({ payload }: { payload: Payload }) {
  const download = () => {
    const plain = Object.fromEntries(
      Object.entries(payload).map(([key, value]) => [
        key,
        isNumericArray(value) ? toArray(value) : value,
      ]),
    );
    const blob = new Blob([JSON.stringify(plain)], {
      type: "application/json",
    });
    const url = URL.createObjectURL(blob);
    const anchor = document.createElement("a");
    anchor.href = url;
    anchor.download = "analysis.json";
    anchor.click();
    URL.revokeObjectURL(url);
  };
  return (
    <button
      type="button"
      onClick={download}
      className="self-start rounded border px-2 py-1 text-[10px] text-muted-foreground hover:bg-muted/40"
    >
      Download JSON
    </button>
  );
}

function EmptyResult({ reason }: { reason: string }) {
  return (
    <p className="rounded border bg-muted/15 px-2 py-1.5 text-[10px] leading-snug text-muted-foreground">
      Nothing to show — {reason}.
    </p>
  );
}

interface ResultViewProps {
  resultKind: AnalysisResultKind;
  label: string;
  payload: unknown;
}

export const ResultView: React.FC<ResultViewProps> = ({
  resultKind,
  label,
  payload,
}) => {
  if (payload === undefined || payload === null) {
    return <EmptyResult reason="the run produced no payload" />;
  }
  if (isNumericArray(payload)) {
    return (
      <ScalarResult
        payload={{
          values: toArray(payload).length,
          first: toArray(payload)[0],
        }}
      />
    );
  }
  const record = payload as Payload;

  switch (resultKind) {
    case "lineSeries":
    case "trajectorySeries":
      return <LineResult payload={record} label={label} />;
    case "barSeries":
      return <BarResult payload={record} />;
    case "scalar":
      return <ScalarResult payload={record} />;
    case "matrix":
    case "grid3":
      return <MatrixResult payload={record} />;
    case "table":
      return <TableResult payload={record} />;
    case "custom":
      return <DownloadJson payload={record} />;
  }
};
