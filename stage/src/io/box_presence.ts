/**
 * Simulation-box presence vs draw vs PBC usability.
 *
 * Product rules:
 * - **Zero / singular** (any edge ≤ {@link BOX_ZERO_EPS}): treat as no box —
 *   strip on load, no modifier attachment.
 * - **Placeholder 1.0 Å edges** (any edge ≤ {@link BOX_MIN_DRAW_LENGTH}):
 *   keep `frame.box` and allow Simulation cell modifier, but **do not draw**
 *   the wireframe and **do not** use the cell for PBC / MI (cryo-EM
 *   mmCIF often deposits `1×1×1`).
 * - **Real cells** (all edges > 1 Å): draw + usable for MI / Wrap PBC.
 * - Having a box never auto-enables Wrap PBC.
 */

import type { Box, Frame } from "@molcrafts/molvis-core/molrs";

/** Edge lengths at or below this (Å) count as zero / missing. */
export const BOX_ZERO_EPS = 1e-8;

/**
 * Edges at or below this (Å) are not drawn and not used for PBC/MI.
 * Exactly `1.0` (EM placeholder) is excluded.
 */
export const BOX_MIN_DRAW_LENGTH = 1.0;

function readLengths(box: Box): Float64Array | null {
  let L: { toCopy(): Float64Array; free(): void } | null = null;
  try {
    L = box.lengths();
    return L.toCopy();
  } catch {
    return null;
  } finally {
    L?.free();
  }
}

function allEdgesFiniteAbove(v: Float64Array, minExclusive: number): boolean {
  if (v.length < 3) return false;
  for (let i = 0; i < 3; i++) {
    const len = v[i];
    if (!Number.isFinite(len) || len <= minExclusive) return false;
  }
  return true;
}

/**
 * Box handle exists and is not zero/singular (all edges > {@link BOX_ZERO_EPS}).
 * Includes cryo-EM `1×1×1` placeholders — those still "have a box".
 */
export function hasPresentBox(box: Box | undefined | null): boolean {
  if (!box) return false;
  const v = readLengths(box);
  if (!v) return false;
  return allEdgesFiniteAbove(v, BOX_ZERO_EPS);
}

/**
 * Real cell: draw as wireframe and safe for PBC / MI / LinkedCell.
 * All edges strictly greater than {@link BOX_MIN_DRAW_LENGTH}
 * (excludes cryo-EM `1×1×1` placeholders).
 */
export function shouldDrawBox(box: Box | undefined | null): box is Box {
  if (!box) return false;
  const v = readLengths(box);
  if (!v) return false;
  return allEdgesFiniteAbove(v, BOX_MIN_DRAW_LENGTH);
}

/**
 * Drop only zero/singular boxes. Placeholder `1×1×1` cells stay on the
 * frame so Simulation cell can still attach (but not draw).
 */
export function normalizeFrameBox(frame: Frame): void {
  if (!frame.box) return;
  if (hasPresentBox(frame.box)) return;
  frame.box = undefined;
}
