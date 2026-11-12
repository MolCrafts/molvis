import type { Frame } from "@molcrafts/molvis-core/molrs";
import type { Trajectory } from "./trajectory";

/** Convert a descriptor to f64 without silently rounding a native integer. */
function numericLabel(value: unknown, name: string): number {
  if (typeof value === "bigint") {
    const number = Number(value);
    if (!Number.isSafeInteger(number)) {
      throw new RangeError(
        `Frame label ${name} exceeds the safe integer range: ${value}`,
      );
    }
    return number;
  }
  const number =
    typeof value === "string" && value.trim() ? Number(value) : value;
  return typeof number === "number" && Number.isFinite(number)
    ? number
    : Number.NaN;
}

/**
 * Walk a trajectory once and bucket every numeric `frame.meta` key into a
 * per-frame column. Keys whose value never parses to a finite number on any
 * frame are dropped (they are purely categorical). Missing or non-numeric
 * entries for an otherwise-numeric key are stored as `NaN`. Integer metadata
 * outside the safe integer range throws rather than rounding into f64.
 *
 * This is the single materialisation point for per-frame descriptors — the
 * resulting `Map<name, Float64Array>` is cached on `System.frameLabels` and
 * fed directly to {@link runExploration}, so the UI never walks frame meta.
 *
 * Metadata comes from the source reader (ExtXYZ comments, LAMMPS timesteps,
 * mrec descriptors, and other format-specific labels).
 */
export function aggregateFrameLabels(
  trajectory: Trajectory,
): Map<string, Float64Array> {
  const nFrames = trajectory.requireCompleteLength("frame-labels");
  const out = new Map<string, Float64Array>();
  if (nFrames === 0) return out;

  // Resolve each frame once (a lazy provider would otherwise refetch per key).
  const frames = Array.from({ length: nFrames }, (_, i) => trajectory.get(i));

  const names = new Set<string>();
  for (const frame of frames) {
    if (!frame) continue;
    for (const name of frame.metaKeys()) names.add(name);
  }

  for (const name of names) {
    const column = new Float64Array(nFrames).fill(Number.NaN);
    let anyNumeric = false;
    for (let i = 0; i < nFrames; i++) {
      const v = numericLabel(frames[i]?.getMeta(name), name);
      if (Number.isFinite(v)) {
        column[i] = v;
        anyNumeric = true;
      }
    }
    if (anyNumeric) out.set(name, column);
  }

  return out;
}

/**
 * Grow an existing label table by one frame, keeping it index-aligned with a
 * trajectory that has just been appended to.
 *
 * Streaming ingress cannot call {@link aggregateFrameLabels} per frame — that
 * walks the whole trajectory, so a live run would cost O(N²). It also cannot
 * skip the update: a column shorter than the trajectory reads as `undefined`
 * at the playhead, which is a silently wrong descriptor rather than a missing
 * one.
 *
 * `null` in, `null` out — a stream that never had labels never grows one, so
 * the common case allocates nothing. Existing columns gain the new frame's
 * value for that key, or `NaN` when it has none. Keys that appear for the
 * first time on `frame` are **not** picked up: back-filling them would require
 * re-reading every earlier frame, which is the O(N) walk this exists to avoid.
 */
export function extendFrameLabels(
  labels: Map<string, Float64Array> | null,
  frame: Frame | undefined,
): Map<string, Float64Array> | null {
  if (labels === null || labels.size === 0) return labels;

  const out = new Map<string, Float64Array>();
  for (const [name, column] of labels) {
    const next = new Float64Array(column.length + 1);
    next.set(column);
    next[column.length] = numericLabel(frame?.getMeta(name), name);
    out.set(name, next);
  }
  return out;
}
