import type { Frame } from "@molcrafts/molvis-core/molrs";
import { shouldDrawBox } from "../io/box_presence";
import { frameWithCoords, readAtomCoords } from "./frame_coords";
import type { CoordinatePolicy } from "./policy";
import { stepUnwrap, type UnwrapState } from "./unwrap";
import { wrapAtoms, wrapMolecules } from "./wrap";

export interface ApplyCoordinatePolicyOptions {
  /** Trajectory scrub index (for unwrap-trajectory). */
  frameIndex?: number;
  /** Mutable unwrap state owned by the pipeline (or null to seed). */
  unwrapState?: UnwrapState | null;
  /** Called when unwrap state advances. */
  onUnwrapState?: (state: UnwrapState | null) => void;
}

/**
 * Apply a system-level coordinate policy to a composed frame.
 * Default `as-deposited` is a no-op (returns the same frame reference).
 */
export function applyCoordinatePolicy(
  frame: Frame,
  policy: CoordinatePolicy,
  options: ApplyCoordinatePolicyOptions = {},
): Frame {
  if (policy === "as-deposited") {
    options.onUnwrapState?.(null);
    return frame;
  }

  const coords = readAtomCoords(frame);
  if (!coords || coords.n === 0) return frame;

  const box = frame.box;
  if (
    (policy === "wrap-atoms" ||
      policy === "wrap-molecules" ||
      policy === "unwrap-trajectory") &&
    !shouldDrawBox(box)
  ) {
    return frame;
  }
  if (!box) return frame;

  if (policy === "wrap-atoms") {
    options.onUnwrapState?.(null);
    const w = wrapAtoms(box, coords.x, coords.y, coords.z, coords.n);
    return frameWithCoords(frame, w.x, w.y, w.z);
  }

  if (policy === "wrap-molecules") {
    options.onUnwrapState?.(null);
    const bonds = frame.getBlock("bonds") ?? undefined;
    const w = wrapMolecules(box, coords.x, coords.y, coords.z, coords.n, bonds);
    return frameWithCoords(frame, w.x, w.y, w.z);
  }

  // unwrap-trajectory
  const frameIndex = options.frameIndex ?? 0;
  const stepped = stepUnwrap(
    box,
    coords.x,
    coords.y,
    coords.z,
    coords.n,
    frameIndex,
    options.unwrapState ?? null,
  );
  options.onUnwrapState?.(stepped.state);
  return frameWithCoords(frame, stepped.x, stepped.y, stepped.z);
}
