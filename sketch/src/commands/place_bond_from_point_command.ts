import {
  DEFAULT_BOND_LENGTH,
  findAtom,
  resolveBondTarget,
  SNAP_RADIUS,
} from "../geometry/snap";
import type { MoleculeGraph } from "../molecule_graph";
import { SketchCommand } from "../sketch_command";
import type { MoleculeData } from "../types";

/**
 * Place a complete bond gesture that starts on empty paper.
 *
 * Both endpoint atoms and the bond are one reversible history entry.
 */
export class PlaceBondFromPointCommand extends SketchCommand {
  private before: MoleculeData | null = null;

  constructor(
    private readonly graph: MoleculeGraph,
    private readonly startX: number,
    private readonly startY: number,
    private readonly pointerX: number,
    private readonly pointerY: number,
    private readonly order: 1 | 2 | 3,
    private readonly element = "C",
    private readonly bondLength = DEFAULT_BOND_LENGTH,
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
    const existingStart = findAtom(
      this.graph,
      this.startX,
      this.startY,
      SNAP_RADIUS,
    );
    const start =
      existingStart ??
      this.graph.addAtomInternal({
        element: this.element,
        x: this.startX,
        y: this.startY,
        ...(this.color ? { color: this.color } : {}),
      });
    const target = resolveBondTarget(
      this.graph,
      start,
      this.pointerX,
      this.pointerY,
      this.bondLength,
    );
    const end =
      target.existingIndex ??
      this.graph.addAtomInternal({
        element: this.element,
        x: target.x,
        y: target.y,
        ...(this.color ? { color: this.color } : {}),
      });
    if (end !== start && this.graph.findBondIndex(start, end) === null) {
      this.graph.addBondInternal({
        i: start,
        j: end,
        order: this.order,
        ...(this.color ? { color: this.color } : {}),
      });
    }
  }

  undo(): void {
    if (!this.before) return;
    this.graph.replaceAll(this.before);
    this.before = null;
  }
}
