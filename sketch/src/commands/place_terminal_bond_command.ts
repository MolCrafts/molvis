import { DEFAULT_BOND_LENGTH, resolveBondTarget } from "../geometry/snap";
import type { MoleculeGraph } from "../molecule_graph";
import { SketchCommand } from "../sketch_command";
import type { MoleculeData } from "../types";

/**
 * ChemDraw-like bond drag to empty: angle-snap + fixed bond length,
 * or snap-connect to an existing nearby atom. One undo step.
 */
export class PlaceTerminalBondCommand extends SketchCommand {
  private before: MoleculeData | null = null;

  constructor(
    private readonly graph: MoleculeGraph,
    private readonly startIndex: number,
    private readonly pointerX: number,
    private readonly pointerY: number,
    private readonly order: number,
    private readonly bondLength: number = DEFAULT_BOND_LENGTH,
    private readonly color?: string,
  ) {
    super();
  }

  do(): void {
    if (!Number.isInteger(this.order) || this.order < 1 || this.order > 3) {
      throw new Error(`bond order must be 1, 2, or 3; got ${this.order}`);
    }
    if (!Number.isFinite(this.bondLength) || this.bondLength <= 0) {
      throw new Error("bond length must be a positive finite number");
    }
    this.before = this.graph.getMoleculeData();
    const start = this.startIndex;
    const target = resolveBondTarget(
      this.graph,
      start,
      this.pointerX,
      this.pointerY,
      this.bondLength,
    );

    let end = target.existingIndex;
    if (end === null) {
      end = this.graph.addAtomInternal({
        element: "C",
        x: target.x,
        y: target.y,
        ...(this.color ? { color: this.color } : {}),
      });
    }
    if (end === start) return;

    if (this.graph.findBondIndex(start, end) === null) {
      this.graph.addBondInternal({
        i: start,
        j: end,
        order: this.order,
        ...(this.color ? { color: this.color } : {}),
      });
    }
  }

  undo(): void {
    if (this.before) {
      this.graph.replaceAll(this.before);
      this.before = null;
    }
  }
}
