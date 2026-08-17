import type { Frame } from "@molcrafts/molvis-core/molrs";
import type { Trajectory } from "./trajectory";

/**
 * Walk a trajectory once and bucket every numeric `frame.meta` key into a
 * per-frame column. Keys whose value never parses to a finite number on any
 * frame are dropped (they are purely categorical). Missing or non-numeric
 * entries for an otherwise-numeric key are stored as `NaN`.
 *
 * This is the single materialisation point for per-frame descriptors — the
 * resulting `Map<name, Float64Array>` is cached on `System.frameLabels` and
 * fed directly to {@link runExploration}, so the UI never walks frame meta.
 *
 * For ExtXYZ trajectories the keys come from comment-line `key=value` pairs.
 * Non-XYZ formats expose no `frame.meta`, so the map comes back empty.
 */
export function aggregateFrameLabels(
  trajectory: Trajectory,
): Map<string, Float64Array> {
  const nFrames = trajectory.length;
  const out = new Map<string, Float64Array>();
  if (nFrames === 0) return out;

  // Resolve each frame once (a lazy provider would otherwise refetch per key).
  const frames = Array.from({ length: nFrames }, (_, i) => trajectory.get(i));

  const names = new Set<string>();
  for (const frame of frames) {
    if (!frame) continue;
    for (const name of frame.metaNames()) names.add(name);
  }

  for (const name of names) {
    const column = new Float64Array(nFrames).fill(Number.NaN);
    let anyNumeric = false;
    for (let i = 0; i < nFrames; i++) {
      const v = frames[i]?.getMetaScalar(name);
      if (v !== undefined && Number.isFinite(v)) {
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
    const v = frame?.getMetaScalar(name);
    next[column.length] =
      v !== undefined && Number.isFinite(v) ? v : Number.NaN;
    out.set(name, next);
  }
  return out;
}
