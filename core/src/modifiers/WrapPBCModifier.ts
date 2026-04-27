import { Frame, WasmArray } from "@molcrafts/molrs";
import { viewAtomCoords } from "../io/atom_coords";
import { BaseModifier, ModifierCapability } from "../pipeline/modifier";
import type { PipelineContext } from "../pipeline/types";
import { logger } from "../utils/logger";

/**
 * WrapPBC modifier wraps atoms into the periodic box.
 * This is a selection-insensitive (global) operation.
 */
export class WrapPBCModifier extends BaseModifier {
  constructor(id: string) {
    super(id, "Wrap PBC", new Set([ModifierCapability.TransformsData]));
  }

  apply(input: Frame, _context: PipelineContext): Frame {
    const box = input.simbox;
    if (!box) {
      logger.warn("WrapPBC: Frame has no box, skipping");
      return input;
    }

    const atoms = input.getBlock("atoms");
    if (!atoms) {
      return input;
    }

    const coords = viewAtomCoords(atoms);
    const x = coords?.x;
    const y = coords?.y;
    const z = coords?.z;
    if (!x || !y || !z) {
      logger.warn("WrapPBC: missing x/y/z and xu/yu/zu columns, skipping");
      return input;
    }

    const atomCount = atoms.nrows();
    if (atomCount === 0) {
      return input;
    }

    // Build interleaved coords for WASM wrap operation.
    const interleaved = new Float64Array(atomCount * 3);
    for (let i = 0; i < atomCount; i++) {
      const i3 = i * 3;
      interleaved[i3] = x[i];
      interleaved[i3 + 1] = y[i];
      interleaved[i3 + 2] = z[i];
    }
    const coordsArr = WasmArray.from(
      interleaved,
      new Uint32Array([atomCount, 3]),
    );

    try {
      // Clone atoms into new frame, then write wrapped coords directly into it.
      const result = new Frame();
      result.insertBlock("atoms", atoms);
      const resultAtoms = result.getBlock("atoms");
      if (!resultAtoms) {
        throw new Error("WrapPBC: failed to clone atoms block");
      }

      // wrapToBlock writes wrapped xyz directly into a Block column,
      // avoiding an intermediate WasmArray copy + JS-side deinterleave.
      box.wrapToBlock(coordsArr, resultAtoms, "pos");
      const wrapped = resultAtoms.viewColF("pos");
      if (!wrapped) {
        throw new Error("WrapPBC: wrapToBlock did not produce pos column");
      }

      // Deinterleave the wrapped [x0,y0,z0,...] back into separate columns.
      const wrappedX = new Float64Array(atomCount);
      const wrappedY = new Float64Array(atomCount);
      const wrappedZ = new Float64Array(atomCount);
      for (let i = 0; i < atomCount; i++) {
        const i3 = i * 3;
        wrappedX[i] = wrapped[i3];
        wrappedY[i] = wrapped[i3 + 1];
        wrappedZ[i] = wrapped[i3 + 2];
      }
      resultAtoms.setColF("x", wrappedX);
      resultAtoms.setColF("y", wrappedY);
      resultAtoms.setColF("z", wrappedZ);

      const bonds = input.getBlock("bonds");
      if (bonds) {
        result.insertBlock("bonds", bonds);
      }

      result.simbox = box;
      return result;
    } finally {
      coordsArr.free();
    }
  }

  getCacheKey(): string {
    return `${super.getCacheKey()}`;
  }
}
