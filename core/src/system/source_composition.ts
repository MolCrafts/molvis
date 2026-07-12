import { Block, Box, Frame } from "@molcrafts/molrs";
import { type ColumnDType, DType } from "../utils/dtype";
import type { Trajectory } from "./trajectory";

const SOURCE_ID = "source_id";

export interface CompositionSource {
  id: string;
  trajectory: Trajectory;
  contributedBlocks?: ReadonlyArray<string>;
}

export interface CompositionValidationResult {
  valid: boolean;
  errors: string[];
  warnings: string[];
}

export async function composeSources(
  sources: readonly CompositionSource[],
  frameIndex: number,
): Promise<Frame> {
  if (sources.length === 0) return new Frame();

  const frames = await resolveFrames(sources, frameIndex);
  if (sources.length === 1) return projectSource(sources[0], frames[0]);

  const composedBlocks = new Map<string, Block>();
  let atomCount: number | null = null;
  let simbox: Box | undefined;

  for (let i = 0; i < sources.length; i++) {
    const source = sources[i];
    const frame = frames[i];
    for (const name of contributedNames(source, frame)) {
      const block = frame.getBlock(name);
      if (!block || block.nrows() === 0) continue;
      if (name === "atoms") {
        if (atomCount === null) {
          atomCount = block.nrows();
        } else if (block.nrows() !== atomCount) {
          throw new Error(
            `Source composition: source '${source.id}' contributes ${block.nrows()} atoms but the composed system has ${atomCount}; augment sources must share atom count`,
          );
        }
      }
      const existing = composedBlocks.get(name);
      if (existing) {
        if (existing.nrows() !== block.nrows()) {
          throw new Error(
            `Source composition: block '${name}' from source '${source.id}' has ${block.nrows()} rows but the composed block has ${existing.nrows()}; same-name augment blocks must align row-for-row`,
          );
        }
        composedBlocks.set(name, mergeBlocks(existing, block));
      } else {
        composedBlocks.set(name, cloneBlock(block));
      }
    }
    const box = frame.simbox;
    if (box !== undefined) {
      simbox?.free();
      try {
        simbox = cloneBox(box);
      } finally {
        box.free();
      }
    }
  }

  const result = new Frame();
  for (const [name, block] of composedBlocks) {
    result.insertBlock(name, block);
  }
  if (simbox !== undefined) result.simbox = simbox;

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
    const block = frame.getBlock("atoms");
    if (!block) {
      throw new Error(
        `Loader extend: source ${index} has no atoms block and cannot be concatenated`,
      );
    }
    return block;
  });
  const counts = atomBlocks.map((block) => block.nrows());
  const total = counts.reduce((sum, count) => sum + count, 0);
  const outAtoms = new Block();

  const atomKeys = new Map<string, ColumnDType>();
  for (const block of atomBlocks) {
    for (const key of block.keys()) {
      if (key === SOURCE_ID || atomKeys.has(key)) continue;
      const dtype = block.dtype(key);
      if (isColumnDType(dtype)) atomKeys.set(key, dtype);
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
  outAtoms.setColI32(SOURCE_ID, sourceIds);

  const result = new Frame();
  result.insertBlock("atoms", outAtoms);

  const bonds = concatBonds(frames, counts);
  if (bonds) result.insertBlock("bonds", bonds);
  copySimbox(result, frames[0]);
  return result;
}

export async function extendSourcesToTrajectory(
  sources: readonly CompositionSource[],
): Promise<Trajectory> {
  const { Trajectory } = await import("./trajectory");
  if (sources.length === 0) return new Trajectory([new Frame()]);
  const maxLength = timelineLength(sources);
  const frames: Frame[] = [];
  const boxes = [];
  for (let frameIndex = 0; frameIndex < maxLength; frameIndex++) {
    const sourceFrames = await resolveFrames(sources, frameIndex);
    const frame = extendFrames(sourceFrames);
    frames.push(frame);
    boxes.push(frame.simbox);
  }
  return new Trajectory(frames, boxes);
}

function timelineLength(sources: readonly CompositionSource[]): number {
  return sources.reduce(
    (max, source) => Math.max(max, source.trajectory.length),
    0,
  );
}

async function resolveFrames(
  sources: readonly CompositionSource[],
  frameIndex: number,
): Promise<Frame[]> {
  const maxLength = timelineLength(sources);
  return Promise.all(
    sources.map((source) => {
      const length = source.trajectory.length;
      if (length === 1) return source.trajectory.frame(0);
      if (length === maxLength) return source.trajectory.frame(frameIndex);
      throw new Error(
        `Source composition: source '${source.id}' has ${length} frames but the timeline has ${maxLength}; only length-1 broadcast sources or length-${maxLength} sources can be combined`,
      );
    }),
  );
}

function contributedNames(source: CompositionSource, frame: Frame): string[] {
  const declared = source.contributedBlocks;
  if (declared && declared.length > 0) {
    return declared.filter((name) => frame.getBlock(name) !== undefined);
  }
  return frame.blockNames();
}

function projectSource(source: CompositionSource, frame: Frame): Frame {
  const result = new Frame();
  for (const name of contributedNames(source, frame)) {
    const block = frame.getBlock(name);
    if (block && block.nrows() > 0) result.insertBlock(name, cloneBlock(block));
  }
  copySimbox(result, frame);
  return result;
}

function cloneBlock(source: Block): Block {
  const cloned = new Block();
  for (const key of source.keys()) copyColumn(cloned, key, source);
  return cloned;
}

function copySimbox(target: Frame, source: Frame): void {
  const box = source.simbox;
  if (box === undefined) return;
  try {
    target.simbox = cloneBox(box);
  } finally {
    box.free();
  }
}

function cloneBox(source: Box): Box {
  const hColMajor = copyAndFreeWasmArray(source.hMatrix());
  const origin = copyAndFreeWasmArray(source.origin());
  const pbc = source.pbc();
  const hRowMajor = new Float64Array([
    hColMajor[0],
    hColMajor[3],
    hColMajor[6],
    hColMajor[1],
    hColMajor[4],
    hColMajor[7],
    hColMajor[2],
    hColMajor[5],
    hColMajor[8],
  ]);
  return new Box(hRowMajor, origin, pbc[0] !== 0, pbc[1] !== 0, pbc[2] !== 0);
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
  dtype: ColumnDType,
  blocks: readonly Block[],
  counts: readonly number[],
  total: number,
): void {
  if (dtype === DType.String) {
    const dst: string[] = [];
    for (let sourceIndex = 0; sourceIndex < blocks.length; sourceIndex++) {
      assertCompatibleDType(blocks[sourceIndex], sourceIndex, key, dtype);
      const src =
        blocks[sourceIndex].dtype(key) === DType.String
          ? blocks[sourceIndex].copyColStr(key)
          : undefined;
      for (let i = 0; i < counts[sourceIndex]; i++) dst.push(src?.[i] ?? "");
    }
    target.setColStr(key, dst);
  } else if (dtype === DType.F64) {
    const dst = new Float64Array(total);
    let offset = 0;
    for (let sourceIndex = 0; sourceIndex < blocks.length; sourceIndex++) {
      assertCompatibleDType(blocks[sourceIndex], sourceIndex, key, dtype);
      const src = blocks[sourceIndex].viewColF(key);
      if (src) {
        dst.set(src, offset);
      } else if (isCoordinateColumn(key)) {
        throw missingColumn(sourceIndex, key);
      }
      offset += counts[sourceIndex];
    }
    target.setColF(key, dst);
  } else if (dtype === DType.U32) {
    const dst = new Uint32Array(total);
    let offset = 0;
    for (let sourceIndex = 0; sourceIndex < blocks.length; sourceIndex++) {
      assertCompatibleDType(blocks[sourceIndex], sourceIndex, key, dtype);
      const src = blocks[sourceIndex].viewColU32(key);
      if (src) dst.set(src, offset);
      offset += counts[sourceIndex];
    }
    target.setColU32(key, dst);
  } else if (dtype === DType.I32) {
    const dst = new Int32Array(total);
    let offset = 0;
    for (let sourceIndex = 0; sourceIndex < blocks.length; sourceIndex++) {
      assertCompatibleDType(blocks[sourceIndex], sourceIndex, key, dtype);
      const src = blocks[sourceIndex].viewColI32(key);
      if (src) dst.set(src, offset);
      offset += counts[sourceIndex];
    }
    target.setColI32(key, dst);
  }
}

function mergeBlocks(existing: Block, incoming: Block): Block {
  const merged = new Block();
  const incomingKeys = new Set(incoming.keys());
  for (const key of existing.keys()) {
    if (!incomingKeys.has(key)) copyColumn(merged, key, existing);
  }
  for (const key of incoming.keys()) {
    copyColumn(merged, key, incoming);
  }
  return merged;
}

function copyColumn(target: Block, key: string, source: Block): void {
  const dtype = source.dtype(key);
  if (dtype === DType.String) {
    target.setColStr(key, source.copyColStr(key) ?? []);
  } else if (dtype === DType.F64) {
    const src = source.viewColF(key);
    if (src) target.setColF(key, new Float64Array(src));
  } else if (dtype === DType.U32) {
    const src = source.viewColU32(key);
    if (src) target.setColU32(key, new Uint32Array(src));
  } else if (dtype === DType.I32) {
    const src = source.viewColI32(key);
    if (src) target.setColI32(key, new Int32Array(src));
  }
}

function assertCompatibleDType(
  block: Block,
  sourceIndex: number,
  key: string,
  expected: ColumnDType,
): void {
  const actual = block.dtype(key);
  if (actual !== undefined && actual !== expected) {
    throw new Error(
      `Loader extend: source ${sourceIndex} atom column '${key}' has dtype '${actual}' but expected '${expected}'`,
    );
  }
}

function isCoordinateColumn(key: string): boolean {
  return key === "x" || key === "y" || key === "z";
}

function isColumnDType(dtype: string | undefined): dtype is ColumnDType {
  return (
    dtype === DType.String ||
    dtype === DType.F64 ||
    dtype === DType.U32 ||
    dtype === DType.I32
  );
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
  const atomi: number[] = [];
  const atomj: number[] = [];
  const order: number[] = [];
  let offset = 0;
  let any = false;

  for (let sourceIndex = 0; sourceIndex < frames.length; sourceIndex++) {
    const bonds = frames[sourceIndex].getBlock("bonds");
    if (bonds) {
      const iCol = bonds.viewColU32("atomi");
      const jCol = bonds.viewColU32("atomj");
      const orderCol =
        bonds.dtype("order") === DType.U32
          ? bonds.viewColU32("order")
          : undefined;
      if (iCol && jCol) {
        any = true;
        for (let row = 0; row < bonds.nrows(); row++) {
          atomi.push(iCol[row] + offset);
          atomj.push(jCol[row] + offset);
          order.push(orderCol ? orderCol[row] : 1);
        }
      }
    }
    offset += counts[sourceIndex];
  }

  if (!any) return undefined;
  const block = new Block();
  block.setColU32("atomi", Uint32Array.from(atomi));
  block.setColU32("atomj", Uint32Array.from(atomj));
  block.setColU32("order", Uint32Array.from(order));
  return block;
}
