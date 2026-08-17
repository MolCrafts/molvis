import type { Frame } from "@molcrafts/molvis-core/molrs";
import { BaseModifier, ModifierCapability } from "../pipeline/modifier";
import type { PipelineContext } from "../pipeline/types";
import { SelectionMask } from "../pipeline/types";

/**
 * OVITO-style **Invert Selection**: complement of the current selection mask.
 *
 * Declares {@link ModifierCapability.ConsumesSelection} so the pipeline
 * ParentSelector can bind `selectionScopeId` to an upstream producer
 * (same contract as Hide Selection). Unit tests set
 * `context.currentSelection` directly before `apply`.
 */
export class InvertSelectionModifier extends BaseModifier {
  static readonly NAME = "Invert Selection";

  constructor(id = "invert-selection-default") {
    super(
      id,
      InvertSelectionModifier.NAME,
      new Set([
        ModifierCapability.ConsumesSelection,
        ModifierCapability.ProducesSelection,
      ]),
    );
  }

  apply(input: Frame, context: PipelineContext): Frame {
    const atomsBlock = input.getBlock("atoms");
    const atomCount = atomsBlock?.nrows() ?? 0;

    const source =
      context.currentSelection.size === atomCount
        ? context.currentSelection
        : SelectionMask.none(atomCount);

    const mask = source.invert();
    context.currentSelection = mask;
    context.selectionSet.set(this.id, mask);
    return input;
  }
}
