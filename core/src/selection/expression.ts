import type { Frame } from "@molcrafts/molrs";
import { viewAtomCoords } from "../io/atom_coords";
import type { SceneIndex } from "../scene_index";

/**
 * Parses and evaluates boolean expressions for atom selection.
 */
type ExpressionEvaluator = (...args: unknown[]) => boolean;

/** Single-entry cache for compiled expression evaluators. */
let _cachedExpression: string | null = null;
let _cachedEvaluator: ExpressionEvaluator | null = null;

// biome-ignore lint/complexity/noStaticOnlyClass: ExpressionSelector groups related static methods for selection evaluation
export class ExpressionSelector {
  /**
   * Select atoms based on a boolean expression from SceneIndex.
   * returns logical atom ids.
   */
  static select(sceneIndex: SceneIndex, expression: string): number[] {
    const matchingAtomIds: number[] = [];
    const evaluator = ExpressionSelector.createEvaluator(expression);

    const atomSource = sceneIndex.metaRegistry.atoms;

    for (const atomId of atomSource.getAllIds()) {
      const meta = atomSource.getMeta(atomId);
      if (!meta) continue;

      const { x, y, z } = meta.position;
      const element = meta.element;
      const index = atomId;
      const atomProxy = { ...meta };

      try {
        if (evaluator(atomProxy, x, y, z, element, atomId, index)) {
          matchingAtomIds.push(atomId);
        }
      } catch (_e) {
        // Ignore errors
      }
    }
    return matchingAtomIds;
  }

  /**
   * Select atoms based on a boolean expression from a Frame.
   * returns atom indices.
   */
  static selectFromFrame(frame: Frame, expression: string): number[] {
    const indices: number[] = [];
    const evaluator = ExpressionSelector.createEvaluator(expression);

    const atomsBlock = frame.getBlock("atoms");
    if (!atomsBlock) return [];

    const count = atomsBlock.nrows();
    const coords = viewAtomCoords(atomsBlock);
    const xCol = coords?.x;
    const yCol = coords?.y;
    const zCol = coords?.z;
    const elCol = atomsBlock.dtype("element")
      ? (atomsBlock.copyColStr("element") as string[])
      : undefined;

    if (!xCol || !yCol || !zCol || !elCol) return [];

    for (let i = 0; i < count; i++) {
      const x = xCol[i];
      const y = yCol[i];
      const z = zCol[i];
      const element = elCol[i];
      // Proxy is limited for frame unless we construct full object,
      // but for perf we might skip if not needed by expression?
      // For consistency let's provide basic props
      const atomProxy = { x, y, z, element, atomId: i };

      try {
        if (evaluator(atomProxy, x, y, z, element, i, i)) {
          indices.push(i);
        }
      } catch (_e) {
        // Ignore
      }
    }
    return indices;
  }

  /**
   * Compile an expression, throwing on syntax error. Exposed so the pipeline's
   * {@link ExpressionSelectionModifier} validates through the *exact same*
   * compile path used for evaluation — a separate validation compile could
   * accept an expression that then throws at eval time (or vice versa).
   */
  static compile(expression: string): ExpressionEvaluator {
    return ExpressionSelector.createEvaluator(expression);
  }

  private static createEvaluator(expression: string): ExpressionEvaluator {
    if (_cachedExpression === expression && _cachedEvaluator) {
      return _cachedEvaluator;
    }
    try {
      const evaluator = new Function(
        "atom",
        "x",
        "y",
        "z",
        "element",
        "id",
        "index",
        `"use strict"; return (${expression});`,
      );
      _cachedExpression = expression;
      _cachedEvaluator = evaluator as ExpressionEvaluator;
      return evaluator as ExpressionEvaluator;
    } catch (_e) {
      throw new Error(`Invalid expression: ${expression}`);
    }
  }
}
