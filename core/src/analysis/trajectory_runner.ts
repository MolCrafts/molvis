import type { Frame } from "@molcrafts/molrs";
import type { SelectionMask } from "../pipeline/types";
import type { Trajectory } from "../system/trajectory";
import { type ColumnDType, DType } from "../utils/dtype";

export interface FrameRange {
  start?: number;
  endInclusive?: number;
  stride?: number;
}

export type AnalysisAtomSelection =
  | { kind: "all" }
  | { kind: "indices"; indices: readonly number[] }
  | { kind: "mask"; mask: SelectionMask };

export type AtomTrackingMode = "all" | "id-column" | "row-index";
export type AtomTrackingKey = string | number;

export interface TrackedAtomSelection {
  mode: AtomTrackingMode;
  referenceFrameIndex: number;
  referenceAtomCount: number;
  indices: number[];
  idColumn?: string;
  idDtype?: ColumnDType;
  keys?: AtomTrackingKey[];
  warnings: string[];
}

export interface ResolvedTrackedAtoms {
  ok: boolean;
  atomCount: number;
  indices: number[];
  missing: AtomTrackingKey[];
}

export interface AnalysisFrameFailure {
  frameIndex: number;
  error: Error;
}

export interface AnalysisProgress {
  completed: number;
  total: number;
  frameIndex: number;
}

export interface AnalysisRunOptions {
  frameRange?: FrameRange;
  referenceFrameIndex?: number;
  abortSignal?: AbortSignal;
  onProgress?: (progress: AnalysisProgress) => void;
  onFrameError?: (failure: AnalysisFrameFailure) => void;
  missingTrackedAtoms?: "skip-frame" | "throw";
}

export interface TrajectoryFrameContext {
  frame: Frame;
  frameIndex: number;
  ordinal: number;
  total: number;
  trackedSelection?: TrackedAtomSelection;
  atomIndices?: number[];
}

export interface TrajectoryFrameRunOptions {
  trajectory: Trajectory;
  selection?: AnalysisAtomSelection;
  run?: AnalysisRunOptions;
}

export interface TrajectoryFrameRunResult<T> {
  frameIndices: number[];
  results: Array<{ frameIndex: number; value: T }>;
  failures: AnalysisFrameFailure[];
  trackedSelection?: TrackedAtomSelection;
}

export class AnalysisAbortError extends Error {
  constructor() {
    super("Analysis run was aborted");
    this.name = "AnalysisAbortError";
  }
}

/**
 * The canonical stable atom identifier, per molrs `store::keys::ID`.
 *
 * Format-native spellings are renamed at the reader boundary, so a frame never
 * carries `atom_id` / `atomid`; probing for them would only mask a real gap.
 */
const STABLE_ATOM_ID_COLUMNS = ["id"];

function clampInt(value: number, min: number, max: number): number {
  if (!Number.isFinite(value)) return min;
  return Math.max(min, Math.min(max, Math.trunc(value)));
}

export function expandFrameRange(
  trajectoryLength: number,
  range: FrameRange = {},
): number[] {
  if (trajectoryLength <= 0) return [];
  const last = trajectoryLength - 1;
  const start = clampInt(range.start ?? 0, 0, last);
  const end = clampInt(range.endInclusive ?? last, 0, last);
  const stride = Math.max(1, Math.trunc(range.stride ?? 1));
  if (start > end) return [];

  const out: number[] = [];
  for (let i = start; i <= end; i += stride) out.push(i);
  return out;
}

function getAtomCount(frame: Frame): number {
  return frame.getBlock("atoms")?.nrows() ?? 0;
}

function selectionToIndices(
  frame: Frame,
  selection: AnalysisAtomSelection | undefined,
): number[] {
  const atomCount = getAtomCount(frame);
  if (!selection || selection.kind === "all") {
    return Array.from({ length: atomCount }, (_, i) => i);
  }
  if (selection.kind === "mask") return selection.mask.getIndices();
  return Array.from(new Set(selection.indices)).filter(
    (idx) => Number.isInteger(idx) && idx >= 0 && idx < atomCount,
  );
}

function readAtomKeys(
  frame: Frame,
  column: string,
): { dtype: ColumnDType; values: AtomTrackingKey[] } | null {
  const atoms = frame.getBlock("atoms");
  if (!atoms) return null;
  const dtype = atoms.dtype(column) as ColumnDType | undefined;
  if (!dtype) return null;

  if (dtype === DType.String) {
    const values = atoms.copyColStr(column);
    return values ? { dtype, values } : null;
  }
  if (dtype === DType.U32) {
    const values = atoms.copyColU32(column);
    return values ? { dtype, values: Array.from(values) } : null;
  }
  if (dtype === DType.I32) {
    const values = atoms.copyColI32(column);
    return values ? { dtype, values: Array.from(values) } : null;
  }
  if (dtype === DType.F64) {
    const values = atoms.copyColF(column);
    return values ? { dtype, values: Array.from(values) } : null;
  }
  return null;
}

function keyId(key: AtomTrackingKey): string {
  return `${typeof key}:${String(key)}`;
}

function pickStableIdColumn(
  frame: Frame,
  indices: readonly number[],
): { column: string; dtype: ColumnDType; keys: AtomTrackingKey[] } | null {
  for (const column of STABLE_ATOM_ID_COLUMNS) {
    const data = readAtomKeys(frame, column);
    if (!data) continue;
    const keys = indices.map((idx) => data.values[idx]);
    if (keys.some((key) => key === undefined || key === null)) continue;
    const unique = new Set(keys.map(keyId));
    if (unique.size !== keys.length) continue;
    return { column, dtype: data.dtype, keys };
  }
  return null;
}

export function resolveTrackedAtomSelection(
  frame: Frame,
  selection: AnalysisAtomSelection | undefined,
  referenceFrameIndex = 0,
): TrackedAtomSelection {
  const atomCount = getAtomCount(frame);
  const indices = selectionToIndices(frame, selection);
  const warnings: string[] = [];

  if (!selection || selection.kind === "all") {
    return {
      mode: "all",
      referenceFrameIndex,
      referenceAtomCount: atomCount,
      indices,
      warnings,
    };
  }

  const stable = pickStableIdColumn(frame, indices);
  if (stable) {
    return {
      mode: "id-column",
      referenceFrameIndex,
      referenceAtomCount: atomCount,
      indices,
      idColumn: stable.column,
      idDtype: stable.dtype,
      keys: stable.keys,
      warnings,
    };
  }

  warnings.push(
    "No stable atom id column found; tracking selected atoms by first-frame row index.",
  );
  return {
    mode: "row-index",
    referenceFrameIndex,
    referenceAtomCount: atomCount,
    indices,
    warnings,
  };
}

export function resolveTrackedAtomIndices(
  frame: Frame,
  tracked: TrackedAtomSelection,
): ResolvedTrackedAtoms {
  const atomCount = getAtomCount(frame);
  if (tracked.mode === "all") {
    return {
      ok: true,
      atomCount,
      indices: Array.from({ length: atomCount }, (_, i) => i),
      missing: [],
    };
  }

  if (tracked.mode === "row-index") {
    const missing = tracked.indices.filter((idx) => idx >= atomCount);
    const countChanged = atomCount !== tracked.referenceAtomCount;
    return {
      ok: missing.length === 0 && !countChanged,
      atomCount,
      indices: countChanged
        ? []
        : tracked.indices.filter((idx) => idx < atomCount),
      missing: countChanged ? tracked.indices : missing,
    };
  }

  if (!tracked.idColumn || !tracked.keys) {
    return {
      ok: false,
      atomCount,
      indices: [],
      missing: tracked.indices,
    };
  }

  const data = readAtomKeys(frame, tracked.idColumn);
  if (!data) {
    return {
      ok: false,
      atomCount,
      indices: [],
      missing: tracked.keys,
    };
  }

  const indexByKey = new Map<string, number>();
  data.values.forEach((key, idx) => {
    const id = keyId(key);
    if (!indexByKey.has(id)) indexByKey.set(id, idx);
  });

  const indices: number[] = [];
  const missing: AtomTrackingKey[] = [];
  for (const key of tracked.keys) {
    const idx = indexByKey.get(keyId(key));
    if (idx === undefined) missing.push(key);
    else indices.push(idx);
  }

  return {
    ok: missing.length === 0,
    atomCount,
    indices,
    missing,
  };
}

export async function runTrajectoryFrames<T>(
  options: TrajectoryFrameRunOptions,
  visit: (context: TrajectoryFrameContext) => T | Promise<T>,
): Promise<TrajectoryFrameRunResult<T>> {
  const frameIndices = expandFrameRange(
    options.trajectory.length,
    options.run?.frameRange,
  );
  const results: Array<{ frameIndex: number; value: T }> = [];
  const failures: AnalysisFrameFailure[] = [];
  if (frameIndices.length === 0) {
    return { frameIndices, results, failures };
  }

  const referenceFrameIndex =
    options.run?.referenceFrameIndex ?? frameIndices[0];
  const referenceFrame = await options.trajectory.frame(referenceFrameIndex);
  const trackedSelection = resolveTrackedAtomSelection(
    referenceFrame,
    options.selection,
    referenceFrameIndex,
  );

  const fail = (frameIndex: number, error: Error) => {
    const failure = { frameIndex, error };
    failures.push(failure);
    options.run?.onFrameError?.(failure);
  };

  for (let ordinal = 0; ordinal < frameIndices.length; ordinal++) {
    if (options.run?.abortSignal?.aborted) throw new AnalysisAbortError();
    const frameIndex = frameIndices[ordinal];
    try {
      const frame = await options.trajectory.frame(frameIndex);
      const resolved = resolveTrackedAtomIndices(frame, trackedSelection);
      if (!resolved.ok) {
        const error = new Error(
          `Tracked atom selection is not valid for frame ${frameIndex}`,
        );
        if (options.run?.missingTrackedAtoms === "throw") throw error;
        fail(frameIndex, error);
        continue;
      }
      const value = await visit({
        frame,
        frameIndex,
        ordinal,
        total: frameIndices.length,
        trackedSelection,
        atomIndices: resolved.indices,
      });
      results.push({ frameIndex, value });
    } catch (error) {
      fail(
        frameIndex,
        error instanceof Error ? error : new Error(String(error)),
      );
    } finally {
      options.run?.onProgress?.({
        completed: ordinal + 1,
        total: frameIndices.length,
        frameIndex,
      });
    }
  }

  return { frameIndices, results, failures, trackedSelection };
}
