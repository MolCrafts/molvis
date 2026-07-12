import type { Frame } from "@molcrafts/molrs";
import { BaseModifier, ModifierCapability } from "../pipeline/modifier";
import type { PipelineContext, ValidationResult } from "../pipeline/types";
import { SelectionMask } from "../pipeline/types";
import { ExpressionSelector } from "../selection/expression";

/**
 * Modifier that selects atoms based on a boolean expression.
 */
export class ExpressionSelectionModifier extends BaseModifier {
  constructor(
    id: string,
    public expression: string,
    public selectionName?: string,
  ) {
    super(
      id,
      `Expression Select: ${expression}`,
      new Set([ModifierCapability.ProducesSelection]),
    );
  }

  /** Display name: user-set selectionName or NATO ID (e.g. "Alpha"). */
  get name(): string {
    return this.selectionName || this.id;
  }

  validate(_input: Frame, _context: PipelineContext): ValidationResult {
    if (!this.expression?.trim()) {
      // Empty expression is valid (selects nothing or acts as pass-through)
      return { valid: true };
    }
    // Validate through the same compile path used at evaluation time so the
    // two cannot disagree (and the compiled result is cached for the upcoming
    // apply()).
    try {
      ExpressionSelector.compile(this.expression);
    } catch (e) {
      return {
        valid: false,
        errors: [`Invalid expression syntax: ${(e as Error).message}`],
      };
    }
    return { valid: true };
  }

  apply(input: Frame, context: PipelineContext): Frame {
    const atomsBlock = input.getBlock("atoms");
    if (!atomsBlock) return input;

    const count = atomsBlock.nrows();

    // Select indices from frame
    let indices: number[] = [];
    if (this.expression?.trim()) {
      indices = ExpressionSelector.selectFromFrame(input, this.expression);
    }

    const mask = SelectionMask.fromIndices(count, indices);

    // Always store in selectionSet using modifier ID
    context.selectionSet.set(this.id, mask);
    if (this.selectionName && this.selectionName !== this.id) {
      context.selectionSet.set(this.selectionName, mask);
    }

    // Update currentSelection
    context.currentSelection = mask;

    return input;
  }

  getCacheKey(): string {
    return `${super.getCacheKey()}:${this.expression}:${this.selectionName ?? ""}`;
  }
}
