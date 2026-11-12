import { toDomainUint, toRowIndex } from "@molcrafts/molvis-core";
import {
  Block,
  Box,
  Cell,
  type Column,
  Frame,
  type DType as MolrsDType,
  type NumericColumn,
} from "@molcrafts/molvis-core/molrs";
import { AtomColumnCarrier } from "../atom_columns";
import { BOND_TYPE_SINGLE, setBondTopology } from "../utils/bond_order";
import { DType } from "../utils/dtype";
import type { Trajectory } from "./trajectory";

const SOURCE_ID = "source_id";

export interface CompositionSource {
  id: string;
  /** Filename / display title used in compose errors. Falls back to `id`. */
  label?: string;
  trajectory: Trajectory;
  contributedBlocks?: ReadonlyArray<string>;
}

export interface CompositionValidationResult {
  valid: boolean;
  errors: string[];
  warnings: string[];
}

/**
 * Length-1 sources broadcast; a multi-frame source may stack onto them.
 * Two multi-frame sources must share a length. Used by compose and by
 * file-augment (LAMMPS data + DCD in either order).
 */
export function compatibleAugmentLengths(
  existingCount: number | undefined,
  incomingCount: number,
): boolean {
  if (incomingCount <= 1) return true;
  if (existingCount === undefined || existingCount <= 1) return true;
  return existingCount === incomingCount;
}

export async function composeSources(
  sources: readonly CompositionSource[],
  frameIndex: number,
): Promise<Frame> {
  if (sources.length === 0) return new Frame();

  const frames = await resolveFrames(sources, frameIndex);
  if (sources.length === 1) return projectSource(sources[0], frames[0]);

  const composedBlocks = new Map<string, Block>();
  const blockFromBroadcast = new Map<string, boolean>();
  let atomCount: number | null = null;
  let composedBox: Box | undefined;
  let boxFromBroadcast = false;

  for (let i = 0; i < sources.length; i++) {
    const source = sources[i];
    const frame = frames[i];
    const broadcast = isBroadcastSource(source);
    for (const name of contributedNames(source, frame)) {
      const block = frame.has(name) ? frame.get(name) : undefined;
      if (!block || block.nRows === 0) continue;
      if (name === "atoms") {
        if (atomCount === null) {
          atomCount = block.nRows;
        } else if (block.nRows !== atomCount) {
          throw new Error(
            `Source composition: source '${sourceLabel(source)}' contributes ${block.nRows} atoms but the composed system has ${atomCount}; augment sources must share atom count. To concatenate two structures, use Extend trajectory…`,
          );
        }
      }
      const existing = composedBlocks.get(name);
      if (existing) {
        if (existing.nRows !== block.nRows) {
          throw new Error(
            `Source composition: block '${name}' from source '${sourceLabel(source)}' has ${block.nRows} rows but the composed block has ${existing.nRows}; same-name augment blocks must align row-for-row. To concatenate two structures, use Extend trajectory…`,
          );
        }
        const existingBroadcast = blockFromBroadcast.get(name) === true;
        composedBlocks.set(
          name,
          mergeBlocks(existing, block, {
            existingBroadcast,
            incomingBroadcast: broadcast,
            atoms: name === "atoms",
          }),
        );
        if (!broadcast) blockFromBroadcast.set(name, false);
      } else {
        composedBlocks.set(name, block);
        blockFromBroadcast.set(name, broadcast);
      }
    }
    const box = frame.box;
    if (box !== undefined) {
      try {
        if (composedBox === undefined) {
          composedBox = cloneBox(box);
          boxFromBroadcast = broadcast;
        } else if (!broadcast && boxFromBroadcast) {
          composedBox.free();
          composedBox = cloneBox(box);
          boxFromBroadcast = false;
        }
      } finally {
        box.free();
      }
    }
  }

  const result = new Frame();
  for (const [name, block] of composedBlocks) {
    result.set(name, block);
  }
  if (composedBox !== undefined) result.box = composedBox;
  // Time-varying sources override broadcast metadata; within each group the
  // later source wins, matching same-priority column overlays.
  for (const broadcast of [true, false]) {
    frames.forEach((frame, index) => {
      if (isBroadcastSource(sources[index]) === broadcast)
        copyMetadata(result, frame);
    });
  }

  return result;
}

export async function validateSourceComposition(
  sources: readonly CompositionSource[],
  frameIndex = 0,
): Promise<CompositionValidationResult> {
  const errors: string[] = [];
  const warnings: string[] = [];
  try {
    await composeSources(sources, frameIndex);
  } catch (error) {
    errors.push(error instanceof Error ? error.message : String(error));
  }
  return { valid: errors.length === 0, errors, warnings };
}

export function extendFrames(frames: readonly Frame[]): Frame {
  if (frames.length === 0) return new Frame();

  const atomBlocks = frames.map((frame, index) => {
    if (!frame.has("atoms")) {
      throw new Error(
        `Loader extend: source ${index} has no atoms block and cannot be concatenated`,
      );
    }
    const block = frame.get("atoms");
    return block;
  });
  const counts = atomBlocks.map((block) => block.nRows);
  const total = counts.reduce((sum, count) => sum + count, 0);
  const outAtoms = new Block();

  const atomKeys = new Map<string, MolrsDType>();
  for (const block of atomBlocks) {
    for (const key of block.keys()) {
      if (key === SOURCE_ID || atomKeys.has(key)) continue;
      const dtype = block.dtype(key);
      atomKeys.set(key, dtype);
    }
  }

  for (const [key, dtype] of atomKeys) {
    if (key === SOURCE_ID) continue;
    concatColumn(outAtoms, key, dtype, atomBlocks, counts, total);
  }

  const sourceIds = new Int32Array(total);
  let cursor = 0;
  for (let sourceIndex = 0; sourceIndex < counts.length; sourceIndex++) {
    for (let i = 0; i < counts[sourceIndex]; i++) {
      sourceIds[cursor++] = sourceIndex;
    }
  }
  outAtoms.set(SOURCE_ID, sourceIds);

  const result = new Frame();
  result.set("atoms", outAtoms);

  const bonds = concatBonds(frames, counts);
  if (bonds) result.set("bonds", bonds);
  copyBox(result, frames[0]);
  // Extend uses the first source's box and metadata on conflicts, while
  // retaining metadata keys unique to later sources.
  for (const frame of [...frames].reverse()) copyMetadata(result, frame);
  return result;
}

export async function extendSourcesToTrajectory(
  sources: readonly CompositionSource[],
): Promise<Trajectory> {
  const { Trajectory } = await import("./trajectory");
  if (sources.length === 0) return new Trajectory([new Frame()]);
  const maxLength = timelineLength(sources);
  const frames: Frame[] = [];
  for (let frameIndex = 0; frameIndex < maxLength; frameIndex++) {
    const sourceFrames = await resolveFrames(sources, frameIndex);
    frames.push(extendFrames(sourceFrames));
  }
  return new Trajectory(frames);
}

function sourcePlayableLength(source: CompositionSource): number {
  const known = source.trajectory.length;
  if (typeof known === "number") return known;
  return source.trajectory.indexedLength;
}

function isBroadcastSource(source: CompositionSource): boolean {
  return sourcePlayableLength(source) <= 1;
}

function sourceLabel(source: CompositionSource): string {
  const label = source.label?.trim();
  return label && label.length > 0 ? label : source.id;
}

function timelineLength(sources: readonly CompositionSource[]): number {
  return sources.reduce(
    (max, source) => Math.max(max, source.trajectory.indexedLength),
    0,
  );
}

/**
 * Frame-index policy for multi-source compose (product: **timeline-aligned**).
 *
 * - length-1 sources **broadcast** (every scrub index uses that single frame);
 * - multi-frame sources must match `max(source.lengths)` exactly;
 * - unequal multi-frame lengths throw (not silent clamp).
 *
 * Loader **extend** (concat atoms) is a separate path ({@link extendFrames}).
 */
async function resolveFrames(
  sources: readonly CompositionSource[],
  frameIndex: number,
): Promise<Frame[]> {
  const maxLength = timelineLength(sources);
  return Promise.all(
    sources.map((source) => {
      const length = sourcePlayableLength(source);
      if (length <= 1) return source.trajectory.frame(0);
      if (length === maxLength) return source.trajectory.frame(frameIndex);
      throw new Error(
        `Source composition: source '${sourceLabel(source)}' has ${length} frames but the timeline has ${maxLength}; only length-1 broadcast sources or length-${maxLength} sources can be combined`,
      );
    }),
  );
}

function hasContributedFilter(source: CompositionSource): boolean {
  const declared = source.contributedBlocks;
  return declared !== undefined && declared.length > 0;
}

function contributedNames(source: CompositionSource, frame: Frame): string[] {
  const declared = source.contributedBlocks;
  if (declared === undefined || declared.length === 0) {
    return frame.keys();
  }
  return declared.filter((name) => frame.has(name));
}

/**
 * A single source *is* the composed system. Without a contributed-block
 * filter the provider's own handle is returned — no per-frame clone of every
 * block, column and box. Downstream modifiers are copy-on-write (they
 * `set` into a fresh Frame before writing), so the cached provider
 * frame is never mutated; see `.claude/notes/molrs-handles.md`.
 */
function projectSource(source: CompositionSource, frame: Frame): Frame {
  if (!hasContributedFilter(source)) return frame;
  const result = new Frame();
  for (const name of contributedNames(source, frame)) {
    const block = frame.has(name) ? frame.get(name) : undefined;
    if (block && block.nRows > 0) result.set(name, block);
  }
  copyBox(result, frame);
  copyMetadata(result, frame);
  return result;
}

function copyMetadata(target: Frame, source: Frame): void {
  for (const key of source.metaKeys()) {
    const value = source.getMeta(key);
    if (value !== undefined) target.setMeta(key, value);
  }
}

function copyBox(target: Frame, source: Frame): void {
  const box = source.box;
  if (box === undefined) return;
  try {
    target.box = cloneBox(box);
  } finally {
    box.free();
  }
}

function cloneBox(source: Box): Box {
  const h = copyAndFreeWasmArray(source.h());
  const origin = copyAndFreeWasmArray(source.origin());
  const pbc = source.pbc();
  // Box.h() is already the row-major layout Cell.matrix takes.
  return new Box(Cell.matrix(h), origin, pbc);
}

function copyAndFreeWasmArray(array: {
  toCopy(): Float64Array;
  free(): void;
}): Float64Array {
  try {
    return array.toCopy();
  } finally {
    array.free();
  }
}

function concatColumn(
  target: Block,
  key: string,
  dtype: MolrsDType,
  blocks: readonly Block[],
  counts: readonly number[],
  total: number,
): void {
  const exemplar = blocks.find((block) => block.has(key));
  if (!exemplar) throw new Error(`Loader extend: missing column '${key}'`);
  const shape = exemplar.shape(key);
  const width = shape.slice(1).reduce((size, dimension) => size * dimension, 1);
  const data = exemplar.copy(key);
  if (!Array.isArray(data) && !ArrayBuffer.isView(data))
    throw new Error(`Loader extend: unsupported dtype '${dtype}' for '${key}'`);
  const dst = Array.isArray(data)
    ? new Array<string | boolean>(total * width).fill(
        dtype === "bool" ? false : "",
      )
    : new (data.constructor as new (length: number) => NumericColumn)(
        total * width,
      );
  let offset = 0;
  for (let index = 0; index < blocks.length; index++) {
    const block = blocks[index];
    assertCompatibleDType(block, index, key, dtype);
    if (block.has(key)) {
      const actualShape = block.shape(key);
      if (
        actualShape.length !== shape.length ||
        actualShape.slice(1).some((n, i) => n !== shape[i + 1])
      )
        throw new Error(
          `Loader extend: incompatible shape for column '${key}' in source ${index}`,
        );
      assertCopyableColumn(block, key);
      const src = block.copy(key) as NumericColumn | string[] | boolean[];
      for (let i = 0; i < src.length; i++) dst[offset + i] = src[i];
    } else if (isCoordinateColumn(key)) throw missingColumn(index, key);
    offset += counts[index] * width;
  }
  if (dtype === "bool" && dst.length === 0)
    throw new Error(
      `Loader extend: cannot preserve empty bool column '${key}'`,
    );
  target.set(key, dst as Column, [total, ...shape.slice(1)]);
}

function mergeBlocks(
  existing: Block,
  incoming: Block,
  opts?: {
    existingBroadcast: boolean;
    incomingBroadcast: boolean;
    atoms: boolean;
  },
): Block {
  const mixed =
    opts !== undefined && opts.existingBroadcast !== opts.incomingBroadcast;
  if (mixed && opts.atoms) {
    return mergeAtomTopologyAndTrajectory(
      existing,
      incoming,
      opts.incomingBroadcast,
    );
  }
  const merged = new Block();
  const incomingKeys = new Set(incoming.keys());
  for (const key of existing.keys()) {
    if (!incomingKeys.has(key)) copyColumn(merged, key, existing);
  }
  for (const key of incoming.keys()) {
    copyColumn(merged, key, incoming);
  }
  applyMergedShape(merged, existing, incoming);
  return merged;
}

/** Coords from the time-varying source; identity / topology from the length-1 source. */
function mergeAtomTopologyAndTrajectory(
  existing: Block,
  incoming: Block,
  incomingBroadcast: boolean,
): Block {
  const topology = incomingBroadcast ? incoming : existing;
  const trajectory = incomingBroadcast ? existing : incoming;
  const alignedTraj = AtomIdAlignment.between(topology, trajectory).apply(
    trajectory,
  );
  const merged = new Block();
  const keys = new Set([...existing.keys(), ...incoming.keys()]);
  for (const key of keys) {
    const prefer = isTimeVaryingAtomColumn(key) ? alignedTraj : topology;
    const fallback = prefer === alignedTraj ? topology : alignedTraj;
    if (prefer.has(key)) copyColumn(merged, key, prefer);
    else if (fallback.has(key)) copyColumn(merged, key, fallback);
  }
  applyMergedShape(merged, existing, incoming);
  return merged;
}

/**
 * Map trajectory atom rows onto topology rows by `id`.
 *
 * LAMMPS `write_data` keeps file order (ids are a permutation). DCD/XTC/TRR
 * write coordinates in increasing atom-id order and stamp `id` = 1..N.
 * Overlaying xyz by row leaves bonds (row indices into the data file)
 * pointing at the wrong atoms — the topology looks exploded.
 */
class AtomIdAlignment {
  private constructor(private readonly srcOfDest: Int32Array | null) {}

  /**
   * Cache by both complete ID orders, including whether IDs are absent.
   * Retain only JS-owned keys and permutations, never borrowed Blocks/views.
   */
  static between(topology: Block, trajectory: Block): AtomIdAlignment {
    const cacheKey = alignmentCacheKey(topology, trajectory);
    const cached = alignmentCache.get(cacheKey);
    if (cached && cached.n === topology.nRows) return cached.align;

    const topoIds = atomIdColumn(topology);
    if (!topoIds) {
      const identity = new AtomIdAlignment(null);
      cacheAlignment(cacheKey, topology.nRows, identity);
      return identity;
    }
    const n = topology.nRows;
    const trajIds = atomIdColumn(trajectory);
    const destOfSrc = new Int32Array(n);
    const topoRowById = new Map<number, number>();
    for (let i = 0; i < n; i++) {
      const id = toRowIndex(topoIds[i]);
      if (topoRowById.has(id)) {
        throw new Error(`Source composition: duplicate atom id ${id}`);
      }
      topoRowById.set(id, i);
    }
    if (trajIds) {
      if (trajIds.length !== n) {
        throw new Error(
          `Source composition: trajectory has ${trajIds.length} atom ids but topology has ${n}`,
        );
      }
      for (let src = 0; src < n; src++) {
        const dest = topoRowById.get(toRowIndex(trajIds[src]));
        if (dest === undefined) {
          throw new Error(
            `Source composition: trajectory atom id ${toRowIndex(trajIds[src])} is missing from the topology`,
          );
        }
        destOfSrc[src] = dest;
      }
    } else {
      const order = Array.from({ length: n }, (_, i) => i);
      order.sort((a, b) => toRowIndex(topoIds[a]) - toRowIndex(topoIds[b]));
      for (let rank = 0; rank < n; rank++) destOfSrc[rank] = order[rank];
    }
    const srcOfDest = new Int32Array(n);
    srcOfDest.fill(-1);
    for (let src = 0; src < n; src++) {
      const dest = destOfSrc[src];
      if (dest < 0 || dest >= n || srcOfDest[dest] !== -1) {
        throw new Error(
          "Source composition: atom id alignment is not a permutation",
        );
      }
      srcOfDest[dest] = src;
    }
    let identity = true;
    for (let i = 0; i < n; i++) {
      if (srcOfDest[i] !== i) {
        identity = false;
        break;
      }
    }
    const align = new AtomIdAlignment(identity ? null : srcOfDest);
    cacheAlignment(cacheKey, n, align);
    return align;
  }

  apply(block: Block): Block {
    if (!this.srcOfDest) return block;
    return permuteAtomRows(block, this.srcOfDest);
  }
}

const alignmentCache = new Map<string, { n: number; align: AtomIdAlignment }>();

function alignmentCacheKey(topology: Block, trajectory: Block): string {
  return [topology, trajectory]
    .map((block) => {
      const ids = atomIdColumn(block);
      const order = ids ? Array.from(ids, toRowIndex).join(",") : "absent";
      return `${block.nRows}:${order}`;
    })
    .join("|");
}

function cacheAlignment(key: string, n: number, align: AtomIdAlignment): void {
  if (alignmentCache.size > 8) alignmentCache.clear();
  alignmentCache.set(key, { n, align });
}

function atomIdColumn(block: Block): ArrayLike<number | bigint> | null {
  if (!block.has("id")) return null;
  const dtype = block.dtype("id");
  if (dtype === DType.Uint) return block.view("id") as BigUint64Array;
  if (dtype === DType.Int) return block.view("id") as Int32Array;
  return null;
}

function permuteAtomRows(block: Block, srcOfDest: Int32Array): Block {
  const out = new Block();
  new AtomColumnCarrier(block).copyInto(
    out,
    srcOfDest.length,
    (row) => srcOfDest[row],
  );
  const shape = block.structuralShape;
  if (shape) out.setShape(shape);
  return out;
}

function applyMergedShape(
  merged: Block,
  existing: Block,
  incoming: Block,
): void {
  const incomingShape = incoming.structuralShape ?? [incoming.nRows];
  const existingShape = existing.structuralShape ?? [existing.nRows];
  const sameShape =
    incomingShape.length === existingShape.length &&
    incomingShape.every(
      (dimension, index) => dimension === existingShape[index],
    );
  if (!sameShape) {
    throw new Error(
      `Source composition: aligned blocks have incompatible shapes [${existingShape}] and [${incomingShape}]`,
    );
  }
  if (incoming.structuralShape) merged.setShape(incoming.structuralShape);
}

function isTimeVaryingAtomColumn(key: string): boolean {
  return (
    isCoordinateColumn(key) ||
    key === "vx" ||
    key === "vy" ||
    key === "vz" ||
    key === "fx" ||
    key === "fy" ||
    key === "fz" ||
    key === "xu" ||
    key === "yu" ||
    key === "zu"
  );
}

function assertCopyableColumn(source: Block, key: string): void {
  if (
    source.validity(key) !== undefined ||
    source.precision(key) !== undefined ||
    source.target(key) !== undefined
  ) {
    throw new Error(
      `Source composition: column '${key}' has validity, precision or target that Block.set cannot preserve`,
    );
  }
  if (source.dtype(key) === "bool" && source.shape(key).some((n) => n === 0))
    throw new Error(
      `Source composition: cannot preserve empty bool column '${key}'`,
    );
}

function copyColumn(target: Block, key: string, source: Block): void {
  assertCopyableColumn(source, key);
  target.set(key, source.copy(key), source.shape(key));
}

function assertCompatibleDType(
  block: Block,
  sourceIndex: number,
  key: string,
  expected: MolrsDType,
): void {
  if (!block.has(key)) return;
  const actual = block.dtype(key);
  if (actual !== expected) {
    throw new Error(
      `Loader extend: source ${sourceIndex} atom column '${key}' has dtype '${actual}' but expected '${expected}'`,
    );
  }
}

function isCoordinateColumn(key: string): boolean {
  return key === "x" || key === "y" || key === "z";
}

function missingColumn(sourceIndex: number, key: string): Error {
  return new Error(
    `Loader extend: source ${sourceIndex} is missing atom column '${key}' present in source 0`,
  );
}

function concatBonds(
  frames: readonly Frame[],
  counts: readonly number[],
): Block | undefined {
  const bondBlocks: Block[] = [];
  const atomi: number[] = [];
  const atomj: number[] = [];
  const bondType: number[] = [];
  const bondNumber: number[] = [];
  let offset = 0;
  let any = false;

  for (let sourceIndex = 0; sourceIndex < frames.length; sourceIndex++) {
    const frame = frames[sourceIndex];
    if (frame.has("bonds")) {
      const bonds = frame.get("bonds");
      bondBlocks.push(bonds);
      for (const key of ["atomi", "atomj", "bond_type", "bond_number"]) {
        if (bonds.has(key)) assertCopyableColumn(bonds, key);
      }
      const typeCol = bonds.has("bond_type")
        ? (bonds.copy("bond_type") as BigUint64Array)
        : undefined;
      const numberCol = bonds.has("bond_number")
        ? (bonds.copy("bond_number") as BigUint64Array)
        : undefined;
      const iCol = bonds.copy("atomi") as BigUint64Array;
      const jCol = bonds.copy("atomj") as BigUint64Array;
      any = true;
      for (let row = 0; row < bonds.nRows; row++) {
        atomi.push(toRowIndex(iCol[row]) + offset);
        atomj.push(toRowIndex(jCol[row]) + offset);
        const t = typeCol ? toRowIndex(typeCol[row]) : BOND_TYPE_SINGLE;
        bondType.push(t);
        bondNumber.push(numberCol ? toRowIndex(numberCol[row]) : t);
      }
    }
    offset += counts[sourceIndex];
  }

  if (!any) return undefined;
  const block = new Block();
  setBondTopology(
    block,
    toDomainUint(atomi),
    toDomainUint(atomj),
    toDomainUint(bondType),
    toDomainUint(bondNumber),
  );
  const extraKeys = new Map<string, MolrsDType>();
  for (const source of bondBlocks) {
    for (const key of source.keys()) {
      if (!block.has(key) && !extraKeys.has(key))
        extraKeys.set(key, source.dtype(key));
    }
  }
  const bondCounts = bondBlocks.map((source) => source.nRows);
  for (const [key, dtype] of extraKeys)
    concatColumn(block, key, dtype, bondBlocks, bondCounts, atomi.length);
  return block;
}
