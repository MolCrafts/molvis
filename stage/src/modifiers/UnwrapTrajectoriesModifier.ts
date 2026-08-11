/**
 * OVITO-style **Unwrap trajectories**: remove PBC jumps by accumulating
 * minimum-image displacements between successive pipeline frames.
 *
 * State is kept on the modifier instance across `apply` calls. Scrubbing
 * backward (frameIndex ≤ last) re-seeds from the current frame.
 *
 * Core step logic lives in {@link stepUnwrap} so the pipeline
 * `unwrap-trajectory` coordinate policy can share it.
 */

import type { Frame } from "@molcrafts/molvis-core/molrs";
import {
  frameWithCoords,
  readAtomCoords,
  stepUnwrap,
  type UnwrapState,
} from "../coords";
import { BaseModifier, ModifierCapability } from "../pipeline/modifier";
import type { PipelineContext } from "../pipeline/types";
import { logger } from "../utils/logger";

export class UnwrapTrajectoriesModifier extends BaseModifier {
  static readonly NAME = "Unwrap trajectories";

  private _moleculeAware = true;
  private _state: UnwrapState | null = null;

  constructor(id = "unwrap-trajectories-default") {
    super(
      id,
      UnwrapTrajectoriesModifier.NAME,
      new Set([ModifierCapability.TransformsData]),
    );
  }

  get moleculeAware(): boolean {
    return this._moleculeAware;
  }

  setMoleculeAware(v: boolean): void {
    this._moleculeAware = v;
  }

  /** Reset unwrap state (e.g. after disable). */
  resetState(): void {
    this._state = null;
  }

  getCacheKey(): string {
    return `${super.getCacheKey()}:${this._moleculeAware}:${this._state?.lastFrameIndex ?? -1}`;
  }

  apply(input: Frame, context: PipelineContext): Frame {
    const box = input.box;
    if (!box) {
      logger.warn("Unwrap trajectories: no box, skipping");
      return input;
    }
    const coords = readAtomCoords(input);
    if (!coords) {
      logger.warn("Unwrap trajectories: missing coordinates, skipping");
      return input;
    }

    const frameIndex = context.frameIndex ?? 0;
    // moleculeAware reserved for shared-image correction across bonded
    // components; current path is per-atom MIC (same as historical).
    void this._moleculeAware;

    const stepped = stepUnwrap(
      box,
      coords.x,
      coords.y,
      coords.z,
      coords.n,
      frameIndex,
      this._state,
    );
    this._state = stepped.state;
    return frameWithCoords(input, stepped.x, stepped.y, stepped.z);
  }
}
