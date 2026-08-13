import type { Frame } from "@molcrafts/molvis-core/molrs";
import { BaseModifier, ModifierCapability } from "../pipeline/modifier";
import type { PipelineContext, ValidationResult } from "../pipeline/types";
import { SelectionMask } from "../pipeline/types";
import { ExpressionSelector } from "../selection/expression";

export type SelectModifierMode = "replace" | "add" | "remove" | "toggle";

/**
 * Selection modifier that creates or updates a named selection.
 * Supports atom indices, boolean expressions (via {@link ExpressionSelector}),
 * and bond IDs.
 */
export class SelectModifier extends BaseModifier {
  /** When false, the pipeline selection will not trigger visual highlighting. */
  public highlight = true;

  constructor(
    id: string,
    private _expression: string | number[],
    public mode: SelectModifierMode = "replace",
    private bondIds: number[] = [],
  ) {
    super(
      id,
      `Select (${mode})`,
      new Set([
        ModifierCapability.ConsumesSelection,
        ModifierCapability.ProducesSelection,
      ]),
    );
  }

  /** The selection source: atom indices array or expression string. */
  get selectionSource(): string | number[] {
    return this._expression;
  }

  /** True when this producer is index-backed (canvas-editable), not expression. */
  get isManual(): boolean {
    return Array.isArray(this._expression);
  }

  /** Bond ids carried by this manual selection (empty for expression-backed). */
  get selectedBondIds(): readonly number[] {
    return this.bondIds;
  }

  /**
   * Replace the manual atom/bond sets. Converts expression-backed selects
   * into index-backed ones (callers that need to keep the expression should
   * fork a new modifier instead).
   */
  setManualSelection(
    atoms: readonly number[],
    bonds: readonly number[] = [],
  ): void {
    this._expression = [...atoms].sort((a, b) => a - b);
    this.bondIds = [...bonds].sort((a, b) => a - b);
    this.mode = "replace";
  }

  /** Human-readable summary for UI display. */
  get selectionSummary(): string {
    if (Array.isArray(this._expression)) {
      const n = this._expression.length;
      const b = this.bondIds.length;
      if (b > 0) return `${n} atoms · ${b} bonds`;
      return n === 0 ? "empty" : `${n} atoms`;
    }
    return this._expression || "empty";
  }

  /** Display name: NATO ID (e.g. "Alpha"). */
  get name(): string {
    return this.id;
  }

  validate(input: Frame, _context: PipelineContext): ValidationResult {
    if (Array.isArray(this._expression)) {
      // Validate indices
      const atomsBlock = input.getBlock("atoms");
      const atomCount = atomsBlock?.nrows() ?? 0;
      const invalidIndices = this._expression.filter(
        (idx) => idx < 0 || idx >= atomCount,
      );
      if (invalidIndices.length > 0) {
        return {
          valid: false,
          errors: [`Invalid atom indices: ${invalidIndices.join(", ")}`],
        };
      }
      return { valid: true };
    }

    if (!this._expression?.trim()) {
      return { valid: true };
    }
    try {
      ExpressionSelector.compile(this._expression);
    } catch (e) {
      return {
        valid: false,
        errors: [`Invalid expression syntax: ${(e as Error).message}`],
      };
    }
    return { valid: true };
  }

  apply(input: Frame, context: PipelineContext): Frame {
    // Evaluate selection
    let mask: SelectionMask;
    const atomsBlock = input.getBlock("atoms");
    const atomCount = atomsBlock?.nrows() ?? 0;

    if (Array.isArray(this._expression)) {
      // Selection by indices
      mask = SelectionMask.fromIndices(atomCount, this._expression);
    } else if (!this._expression?.trim()) {
      mask = SelectionMask.fromIndices(atomCount, []);
    } else {
      let indices: number[] = [];
      try {
        ExpressionSelector.compile(this._expression);
        indices = ExpressionSelector.selectFromFrame(input, this._expression);
      } catch {
        // Invalid syntax: never silent select-all.
        indices = [];
      }
      mask = SelectionMask.fromIndices(atomCount, indices);
    }

    let nextMask = mask;
    switch (this.mode) {
      case "add":
        nextMask = context.currentSelection.union(mask);
        break;
      case "remove":
        nextMask = context.currentSelection.intersection(mask.invert());
        break;
      case "toggle": {
        const union = context.currentSelection.union(mask);
        const intersection = context.currentSelection.intersection(mask);
        nextMask = union.intersection(intersection.invert());
        break;
      }
      default:
        nextMask = mask;
        break;
    }

    // Store in selectionSet using modifier ID as key
    context.selectionSet.set(this.id, nextMask);

    // Update currentSelection
    context.currentSelection = nextMask;

    // Store bond IDs on context for COMPUTED sync
    context.selectedBondIds = this.bondIds;

    // Propagate highlight suppression
    if (!this.highlight) {
      context.suppressHighlight = true;
    }

    // Frame is unchanged (selection is context-only)
    return input;
  }

  getCacheKey(): string {
    const exprKey = Array.isArray(this._expression)
      ? this._expression.join(",")
      : this._expression;
    const bondKey =
      this.bondIds.length > 0 ? `:b${this.bondIds.join(",")}` : "";
    return `${super.getCacheKey()}:${exprKey}:${this.mode}${bondKey}`;
  }
}

/**
 * OVITO-style **Clear Selection**: write an empty particle selection
 * (`SelectionMask.none`), not "all selected".
 *
 * Distinct from the pipeline default when no selection producer is in
 * scope — `ModifierPipeline` still resets consumers without a
 * `selectionScopeId` to `SelectionMask.all` (consume-all). This
 * modifier only affects steps that read the mask it produces
 * (via `selectionCache` / `selectionScopeId`).
 */
export class ClearSelectionModifier extends BaseModifier {
  static readonly NAME = "Clear Selection";

  constructor(id = "clear-selection-default") {
    super(
      id,
      ClearSelectionModifier.NAME,
      new Set([ModifierCapability.ProducesSelection]),
    );
  }

  apply(input: Frame, context: PipelineContext): Frame {
    const atomsBlock = input.getBlock("atoms");
    const atomCount = atomsBlock?.nrows() ?? 0;
    const mask = SelectionMask.none(atomCount);
    context.currentSelection = mask;
    context.selectionSet.set(this.id, mask);
    context.selectedBondIds = [];
    return input;
  }
}
