/**
 * Read a volumetric `grid` block out of a frame.
 *
 * Shared by the two steps that consume one: the isosurface producer, which
 * meshes a level set, and the volume cloud, which sprites every voxel. Both
 * need the same five things and the same refusals, so neither owns them.
 */

import type { Frame } from "@molcrafts/molvis-core/molrs";
import { logger } from "../../utils/logger";

export interface GridField {
  data: Float64Array;
  shape: [number, number, number];
  /** 3×3 lattice matrix, column-major. */
  cell: Float64Array;
  origin: Float64Array;
  /** Marching cubes wraps boundary cells only when every axis is periodic. */
  gridType: "general" | "periodic";
  allPeriodic: boolean;
}

/** Column names the frame's grid block actually carries. */
export function gridChannels(frame: Frame): string[] {
  return frame.has("grid") ? frame.get("grid").keys() : [];
}

/**
 * True when the frame carries a 3-D grid big enough to mesh **and** a box to
 * place it in. Without the box the voxels have no world position, so a grid
 * alone is not enough to draw anything.
 */
export function hasMeshableGrid(frame: Frame): boolean {
  if (!frame.has("grid")) return false;
  const grid = frame.get("grid");
  const shape = grid.structuralShape;
  if (shape?.length !== 3 || shape[0] < 2 || shape[1] < 2 || shape[2] < 2) {
    return false;
  }
  // Never free a simbox handle — it is a borrow into shared frame data.
  return frame.box !== undefined;
}

/**
 * Returns `null` — with a specific reason logged — when the frame cannot
 * supply the requested channel. Callers treat that as "draw nothing".
 */
export function readGridField(frame: Frame, channel: string): GridField | null {
  if (!frame.has("grid")) {
    logger.warn("[Grid] frame has no 'grid' block; nothing to draw");
    return null;
  }
  const grid = frame.get("grid");
  const shape = grid.structuralShape;
  if (shape?.length !== 3) {
    logger.warn(
      `[Grid] grid block is not 3-D (shape ${shape ? `length ${shape.length}` : "unset"}); nothing to draw`,
    );
    return null;
  }
  const [nx, ny, nz] = [shape[0], shape[1], shape[2]];
  // Marching cubes works on (nx−1)(ny−1)(nz−1) cells, so an axis below 2
  // yields no cells at all. Say so rather than let the user blame the
  // isovalue — this is usually a hand-built threshold fixture, not real data.
  if (nx < 2 || ny < 2 || nz < 2) {
    logger.warn(
      `[Grid] shape [${nx},${ny},${nz}] has an axis < 2; at least 2×2×2 is needed for a single cell`,
    );
    return null;
  }

  if (!grid.has(channel)) {
    logger.warn(
      `[Grid] no '${channel}' column (available: ${grid.keys().join(", ")}); nothing to draw`,
    );
    return null;
  }
  const data = grid.copy(channel) as Float64Array;

  const box = frame.box;
  if (!box) {
    logger.warn("[Grid] frame has no box; cannot place voxels in world space");
    return null;
  }

  const cell = copyAndFree(box.h());
  const origin = copyAndFree(box.origin());
  const pbc = box.pbc();
  // CHGCAR-style periodic cells wrap; cube files declare non-periodic boxes
  // and take the sealed-at-boundary path. Mixed PBC (a slab) falls back to
  // general, since marching cubes' periodic mode is all-or-nothing.
  const allPeriodic = pbc[0] === 1 && pbc[1] === 1 && pbc[2] === 1;

  return {
    data,
    shape: [nx, ny, nz],
    cell,
    origin,
    gridType: allPeriodic ? "periodic" : "general",
    allPeriodic,
  };
}

/** Copy a `NDArray`'s bytes into a JS-owned array, then free the handle. */
function copyAndFree(wa: {
  toCopy(): Float64Array;
  free(): void;
}): Float64Array {
  try {
    return wa.toCopy();
  } finally {
    wa.free();
  }
}

/**
 * A conservative default isovalue from the channel statistics, matching
 * common community settings: 5 % of max|v| for charge density, 4 % for
 * orbitals, 2 % for a spin difference.
 */
export function defaultIsovalueFor(
  channel: string,
  data: ArrayLike<number>,
): number {
  let max = 0;
  for (let i = 0; i < data.length; i++) {
    const v = Math.abs(data[i]);
    if (v > max) max = v;
  }
  if (channel === "diff") return 0.02 * max;
  if (channel.startsWith("mo_")) return 0.04 * max;
  return 0.05 * max;
}

/** Channels whose data is signed, so both lobes are worth drawing. */
export function channelIsSigned(channel: string): boolean {
  return channel === "diff" || channel.startsWith("mo_");
}

export interface ChannelStats {
  maxAbs: number;
  /** Data spans both signs, so both lobes are worth offering. */
  signed: boolean;
}

/**
 * Magnitude and signedness of one grid column, for bounding an isovalue
 * slider against data that actually exists rather than an arbitrary 0..1.
 */
export function channelStats(frame: Frame, channel: string): ChannelStats {
  if (!frame.has("grid")) return { maxAbs: 0, signed: false };
  const grid = frame.get("grid");
  let data: Float64Array | undefined;
  try {
    data = grid.copy(channel) as Float64Array;
  } catch {
    return { maxAbs: 0, signed: false };
  }
  if (!data || data.length === 0) return { maxAbs: 0, signed: false };

  let maxAbs = 0;
  let hasNegative = false;
  let hasPositive = false;
  for (let i = 0; i < data.length; i++) {
    const v = data[i];
    const a = Math.abs(v);
    if (a > maxAbs) maxAbs = a;
    if (v < 0) hasNegative = true;
    else if (v > 0) hasPositive = true;
  }
  return { maxAbs, signed: hasNegative && hasPositive };
}
