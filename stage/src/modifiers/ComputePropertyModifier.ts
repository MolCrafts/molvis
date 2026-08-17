/**
 * OVITO-style **Compute property**: evaluate a per-atom expression and
 * write a float column.
 */

import { Frame } from "@molcrafts/molvis-core/molrs";
import { viewAtomCoords } from "../io/atom_coords";
import { BaseModifier, ModifierCapability } from "../pipeline/modifier";
import type { PipelineContext, ValidationResult } from "../pipeline/types";
import { ExpressionSelector } from "../selection/expression";
import { logger } from "../utils/logger";

type NumEval = (
  atom: { x: number; y: number; z: number; element: string; atomId: number },
  x: number,
  y: number,
  z: number,
  element: string,
  id: number,
  index: number,
) => number;

export class ComputePropertyModifier extends BaseModifier {
  static readonly NAME = "Compute property";

  private _expression = "0";
  private _outputColumn = "Compute";

  constructor(id = "compute-property-default") {
    super(
      id,
      ComputePropertyModifier.NAME,
      new Set([ModifierCapability.TransformsData]),
    );
  }

  get expression(): string {
    return this._expression;
  }
  get outputColumn(): string {
    return this._outputColumn;
  }

  setExpression(expr: string): void {
    this._expression = expr;
  }

  setOutputColumn(name: string): void {
    const t = name.trim();
    if (t) this._outputColumn = t;
  }

  getCacheKey(): string {
    return `${super.getCacheKey()}:${this._expression}:${this._outputColumn}`;
  }

  validate(_input: Frame, _context: PipelineContext): ValidationResult {
    if (!this._expression?.trim()) return { valid: true };
    try {
      ExpressionSelector.compile(this._expression);
      return { valid: true };
    } catch (e) {
      return {
        valid: false,
        errors: [`Invalid expression: ${(e as Error).message}`],
      };
    }
  }

  apply(input: Frame, _context: PipelineContext): Frame {
    const atoms = input.getBlock("atoms");
    if (!atoms) return input;
    const n = atoms.nrows();
    if (n === 0) return input;

    const coords = viewAtomCoords(atoms);
    const xCol = coords?.x;
    const yCol = coords?.y;
    const zCol = coords?.z;
    const elCol = atoms.dtype("element")
      ? (atoms.copyColStr("element") as string[])
      : undefined;
    if (!xCol || !yCol || !zCol || !elCol) {
      logger.warn("Compute property: missing coords/element, skipping");
      return input;
    }

    let evalFn: NumEval;
    try {
      evalFn = ExpressionSelector.compile(
        this._expression,
      ) as unknown as NumEval;
    } catch {
      logger.warn("Compute property: compile failed, writing zeros");
      evalFn = () => 0;
    }

    const out = new Float64Array(n);
    for (let i = 0; i < n; i++) {
      const x = xCol[i];
      const y = yCol[i];
      const z = zCol[i];
      const element = elCol[i];
      const atom = { x, y, z, element, atomId: i };
      try {
        const v = evalFn(atom, x, y, z, element, i, i);
        out[i] = typeof v === "number" && Number.isFinite(v) ? v : 0;
      } catch {
        out[i] = 0;
      }
    }

    const result = new Frame();
    result.insertBlock("atoms", atoms);
    const outAtoms = result.getBlock("atoms");
    if (!outAtoms) return input;
    outAtoms.setColF(this._outputColumn, out);

    const bonds = input.getBlock("bonds");
    if (bonds) result.insertBlock("bonds", bonds);
    for (const name of input.blockNames()) {
      if (name === "atoms" || name === "bonds") continue;
      const block = input.getBlock(name);
      if (block) result.insertBlock(name, block);
    }
    if (input.box) result.box = input.box;
    return result;
  }
}
