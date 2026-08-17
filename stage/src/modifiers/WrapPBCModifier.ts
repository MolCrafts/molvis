import type { Frame } from "@molcrafts/molvis-core/molrs";
import {
  frameWithCoords,
  readAtomCoords,
  wrapMoleculeAware,
  wrapMolecules,
} from "../coords";
import { shouldDrawBox } from "../io/box_presence";
import { BaseModifier, ModifierCapability } from "../pipeline/modifier";
import type { PipelineContext } from "../pipeline/types";
import { logger } from "../utils/logger";

// Re-export pure helper so existing tests keep importing from this module.
export { wrapMoleculeAware, wrapMolecules };

/**
 * WrapPBC wraps atom coordinates into the primary cell.
 *
 * Delegates to the shared coordinate-policy wrap helpers
 * (`wrapMolecules` / molecule-aware). Prefer the system
 * {@link import("../coords").CoordinatePolicy} when wrap should apply
 * after every compose; this modifier remains the OVITO-style Add-menu step.
 *
 * Requires a **usable** `frame.box`. Never auto-attaches.
 */
export class WrapPBCModifier extends BaseModifier {
  constructor(id: string) {
    super(id, "Wrap PBC", new Set([ModifierCapability.TransformsData]));
  }

  /** Never auto-attach. Box present ≠ wrap. */
  matches(_frame: Frame): boolean {
    return false;
  }

  isApplicable(frame: Frame): boolean {
    return shouldDrawBox(frame.box);
  }

  apply(input: Frame, _context: PipelineContext): Frame {
    const box = input.box;
    if (!shouldDrawBox(box)) {
      logger.warn("WrapPBC: Frame has no usable box, skipping");
      return input;
    }

    const coords = readAtomCoords(input);
    if (!coords) {
      logger.warn("WrapPBC: missing x/y/z and xu/yu/zu columns, skipping");
      return input;
    }
    if (coords.n === 0) return input;

    const bonds = input.getBlock("bonds") ?? undefined;
    const wrapped = wrapMolecules(
      box,
      coords.x,
      coords.y,
      coords.z,
      coords.n,
      bonds,
    );
    return frameWithCoords(input, wrapped.x, wrapped.y, wrapped.z);
  }

  getCacheKey(): string {
    return `${super.getCacheKey()}`;
  }
}
