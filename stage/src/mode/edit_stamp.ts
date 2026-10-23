import type { Frame } from "@molcrafts/molvis-core/molrs";
import type { MolvisApp } from "../app";
import { EditMode } from "./edit";

/**
 * Arm Edit mode's stamp tool with `frame`.
 *
 * Each empty-canvas click in Edit places a copy. The frame stays armed
 * until another call replaces it, the user clears it, or Edit mode exits.
 * Edit mode takes ownership: it frees a replaced frame, and this function
 * frees `frame` itself when Edit is not the active mode.
 */
export function stageEditMolecule(app: MolvisApp, frame: Frame): void {
  const mode = app.mode;
  if (!(mode instanceof EditMode)) {
    frame.free();
    throw new Error("Switch to Edit mode first");
  }
  mode.pendingMolecule = frame;
}
