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

  validate(_input: Frame, _context: PipelineContext): ValidationResult {
    if (!this.expression || !this.expression.trim()) {
      // Empty expression is valid (selects nothing or acts as pass-through)
      return { valid: true };
    }
    // We could try to pre-compile here to catch syntax errors
    try {
      // Just dry run compilation
      // ExpressionSelector.createEvaluator is private, but we can rely on try/catch available in selectFromFrame?
      // Or expose validation method? For now simple check.
      new Function("atom", `return (${this.expression})`);
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
