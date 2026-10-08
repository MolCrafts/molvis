import type { Block, Frame } from "@molcrafts/molvis-core/molrs";
import { DType } from "../utils/dtype";
import { occupiedAtomCountForFrame } from "./occupancy";
import type { SectionUpdates } from "./trajectory";

export type FrameUpdateKind = "position" | "bond" | "full";

/**
 * Store-index view of a transition: the {@link SectionUpdates} of the
 * previous and next frames, when the trajectory's provider keeps one
 * (`Trajectory.sectionUpdates`). Either side missing disables the index
 * path and the classifier compares values.
 */
export interface SectionUpdateTransition {
  previous: SectionUpdates | undefined;
  next: SectionUpdates | undefined;
}

export interface FrameTransitionDecision {
  kind: FrameUpdateKind;
  reasons: string[];
  stats: {
    atomCount: number;
    bondCount: number;
  };
}

function decision(
  kind: FrameUpdateKind,
  atomCount: number,
  bondCount: number,
  ...reasons: string[]
): FrameTransitionDecision {
  return {
    kind,
    reasons,
    stats: { atomCount, bondCount },
  };
}

function equalNumberArray(
  left: Float32Array | Uint32Array | BigUint64Array,
  right: Float32Array | Uint32Array | BigUint64Array,
): boolean {
  if (left.length !== right.length) return false;
  for (let i = 0; i < left.length; i++) {
    if (left[i] !== right[i]) return false;
  }
  return true;
}

function equalStringArray(left: string[], right: string[]): boolean {
  if (left.length !== right.length) return false;
  for (let i = 0; i < left.length; i++) {
    if (left[i] !== right[i]) return false;
  }
  return true;
}

// `copy("element")` materializes the whole element column out of WASM —
// the dominant cost of classifying a transition on large systems. During
// playback the same Frame object is compared as `next` on one seek and
// `previous` on the next, and trajectory frames are immutable, so cache the
// copied column keyed weakly on the Frame. Entries are collected when the
// frame is GC'd / freed. `null` means "no element column".
const elementColumnCache = new WeakMap<Frame, string[] | null>();

function getElementColumn(frame: Frame, atoms: Block): string[] | null {
  const cached = elementColumnCache.get(frame);
  if (cached !== undefined) return cached;
  const column =
    atoms.has("element") && atoms.dtype("element") === DType.String
      ? (atoms.copy("element") as string[])
      : null;
  elementColumnCache.set(frame, column);
  return column;
}

function compareOptionalElement(
  leftFrame: Frame,
  leftAtoms: Block,
  rightFrame: Frame,
  rightAtoms: Block,
): boolean {
  // Canonical identity column is `element: String`. LAMMPS data/dump without
  // element simply have no identity column — both sides missing is "equal".
  const left = getElementColumn(leftFrame, leftAtoms);
  const right = getElementColumn(rightFrame, rightAtoms);
  if (left === null && right === null) return true;
  if (left === null || right === null) return false;
  return equalStringArray(left, right);
}

function occupiedCount(frame: Frame, atoms: Block, n: number): number | null {
  if (!atoms.has("x") || !atoms.has("y") || !atoms.has("z")) return null;
  const x = atoms.view("x") as Float64Array;
  const y = atoms.view("y") as Float64Array;
  const z = atoms.view("z") as Float64Array;
  if (x.length < n) return null;
  return occupiedAtomCountForFrame(frame, x, y, z, n);
}

function hasSameBondTopology(leftBonds: Block, rightBonds: Block): boolean {
  const leftI = leftBonds.view("atomi") as BigUint64Array;
  const leftJ = leftBonds.view("atomj") as BigUint64Array;
  const rightI = rightBonds.view("atomi") as BigUint64Array;
  const rightJ = rightBonds.view("atomj") as BigUint64Array;

  if (!leftI || !leftJ || !rightI || !rightJ) {
    return false;
  }
  if (!equalNumberArray(leftI, rightI)) return false;
  if (!equalNumberArray(leftJ, rightJ)) return false;

  const leftType = leftBonds.view("bond_type") as BigUint64Array;
  const rightType = rightBonds.view("bond_type") as BigUint64Array;
  const leftNumber = leftBonds.view("bond_number") as BigUint64Array;
  const rightNumber = rightBonds.view("bond_number") as BigUint64Array;
  if (!leftType && !rightType && !leftNumber && !rightNumber) return true;
  if ((!leftType && rightType) || (leftType && !rightType)) return false;
  if ((!leftNumber && rightNumber) || (leftNumber && !rightNumber))
    return false;

  const count = leftBonds.nRows;
  for (let i = 0; i < count; i++) {
    if ((leftType?.[i] ?? 0n) !== (rightType?.[i] ?? 0n)) return false;
    if ((leftNumber?.[i] ?? 0n) !== (rightNumber?.[i] ?? 0n)) return false;
  }
  return true;
}

/**
 * Index-driven verdict for a transition whose provider exposes molrec section
 * update ids. `null` when either side has no index.
 *
 * Every block section (atoms included) is a CSR update list in the store: a
 * frame resolves to the latest update at or before it, and bit-identical
 * content earns no new update. So an unchanged id proves identical rows
 * without touching a value, while a changed id on any topology section
 * (bonds, angles, …) or a section appearing / disappearing is a rebuild. The
 * atoms section bumps whenever positions move, so its id says nothing by
 * itself; the caller still runs the O(1) row-count and the occupancy guards
 * before consulting this.
 *
 * Assumption pinned here: within a run, an atoms update changes coordinates
 * and per-frame scalars, not identity columns (`element`). A store that
 * rewrites identity per frame must be replayed with Create bonds on.
 */
function classifyBySectionUpdates(
  previous: SectionUpdates,
  next: SectionUpdates,
): { kind: "position" | "full"; reason: string } | null {
  if (previous.size !== next.size) {
    return { kind: "full", reason: "Store index: block set changed" };
  }
  for (const [name, update] of next) {
    const before = previous.get(name);
    if (before === undefined) {
      return { kind: "full", reason: `Store index: ${name} block appeared` };
    }
    if (name !== "atoms" && before !== update) {
      return {
        kind: "full",
        reason: `Store index: ${name} block updated (${before} -> ${update})`,
      };
    }
  }
  return {
    kind: "position",
    reason: "Store index: topology blocks unchanged; only atoms updated",
  };
}

export function classifyFrameTransition(
  previous: Frame | null,
  next: Frame,
  updates?: SectionUpdateTransition,
): FrameTransitionDecision {
  const nextAtoms = next.has("atoms") ? next.get("atoms") : undefined;
  const nextAtomCount = nextAtoms?.nRows ?? 0;
  const nextBondCount = next.has("bonds") ? next.get("bonds").nRows : 0;

  if (!previous) {
    return decision(
      "full",
      nextAtomCount,
      nextBondCount,
      "No previous frame available",
    );
  }

  const prevAtoms = previous.has("atoms") ? previous.get("atoms") : undefined;
  if (!prevAtoms || !nextAtoms) {
    return decision(
      "full",
      nextAtomCount,
      nextBondCount,
      "Atoms block is missing in previous or next frame",
    );
  }

  const prevAtomCount = prevAtoms.nRows;
  if (prevAtomCount !== nextAtomCount) {
    return decision(
      "full",
      nextAtomCount,
      nextBondCount,
      `Atom count changed: ${prevAtomCount} -> ${nextAtomCount}`,
    );
  }

  const occupancyChanged = (): boolean => {
    const prevOcc = occupiedCount(previous, prevAtoms, prevAtomCount);
    const nextOcc = occupiedCount(next, nextAtoms, nextAtomCount);
    return prevOcc !== null && nextOcc !== null && prevOcc !== nextOcc;
  };

  // Index path first: skip the O(N) occupancy walk when the store already
  // knows topology changed. Occupancy still runs when the index says
  // "position" (molpack growth keeps nrows fixed).
  if (updates?.previous && updates.next) {
    const indexed = classifyBySectionUpdates(updates.previous, updates.next);
    if (indexed) {
      if (indexed.kind === "full") {
        return decision("full", nextAtomCount, nextBondCount, indexed.reason);
      }
      if (occupancyChanged()) {
        return decision(
          "full",
          nextAtomCount,
          nextBondCount,
          "Occupancy changed",
        );
      }
      return decision("position", nextAtomCount, nextBondCount, indexed.reason);
    }
  }

  if (occupancyChanged()) {
    const prevOcc = occupiedCount(previous, prevAtoms, prevAtomCount);
    const nextOcc = occupiedCount(next, nextAtoms, nextAtomCount);
    return decision(
      "full",
      nextAtomCount,
      nextBondCount,
      `Occupancy changed: ${prevOcc} -> ${nextOcc}`,
    );
  }

  if (!compareOptionalElement(previous, prevAtoms, next, nextAtoms)) {
    return decision(
      "full",
      nextAtomCount,
      nextBondCount,
      "Atom element column changed",
    );
  }

  const prevBonds = previous.has("bonds") ? previous.get("bonds") : undefined;
  const nextBonds = next.has("bonds") ? next.get("bonds") : undefined;
  const prevHasBonds = !!prevBonds && prevBonds.nRows > 0;
  const nextHasBonds = !!nextBonds && nextBonds.nRows > 0;

  if (prevHasBonds !== nextHasBonds) {
    return decision(
      "full",
      nextAtomCount,
      nextBondCount,
      "Bond block presence changed",
    );
  }

  if (!prevHasBonds && !nextHasBonds) {
    return decision(
      "position",
      nextAtomCount,
      0,
      "No bonds in both frames; only positions can change",
    );
  }

  const prevBondCount = prevBonds?.nRows ?? 0;
  if (prevBondCount !== nextBondCount) {
    return decision(
      "full",
      nextAtomCount,
      nextBondCount,
      `Bond count changed: ${prevBondCount} -> ${nextBondCount}`,
    );
  }

  if (!prevBonds || !nextBonds) {
    return decision(
      "full",
      nextAtomCount,
      nextBondCount,
      "Bond block missing unexpectedly",
    );
  }

  if (!hasSameBondTopology(prevBonds, nextBonds)) {
    return decision(
      "bond",
      nextAtomCount,
      nextBondCount,
      "Bond topology/order changed while counts remained stable",
    );
  }

  return decision(
    "position",
    nextAtomCount,
    nextBondCount,
    "Topology unchanged; position-only update",
  );
}

/**
 * Playback `changeKind` after {@link classifyFrameTransition}.
 *
 * Create bonds rebuilds topology from the current coordinates. The
 * classifier only sees `system.frame` (pre-perceive), so a growth
 * trajectory with a stable atom count would otherwise stay on the
 * position fast path and keep the last frame's GPU bonds — reverse
 * play would not drop bonds or collapse the grown structure.
 */
export function resolvePlaybackChangeKind(
  decision: FrameTransitionDecision,
  perceiveBonds: boolean,
): "position" | "full" {
  // Opt-in Create bonds: the user asked for a fresh perceive every frame,
  // so the GPU topology must rebuild with it. Default (off) stays cheap.
  if (perceiveBonds) return "full";
  return decision.kind === "position" ? "position" : "full";
}
