import type { MoleculeGraph } from "../molecule_graph";
import { SketchCommand } from "../sketch_command";
import type { Atom2D, Bond2D } from "../types";

export class AddAtomCommand extends SketchCommand {
  private index = -1;

  constructor(
    private readonly graph: MoleculeGraph,
    private readonly atom: Atom2D,
  ) {
    super();
  }

  do(): void {
    this.index = this.graph.addAtomInternal(this.atom);
  }

  undo(): void {
    if (this.index < 0) return;
    this.graph.removeAtomInternal(this.index);
    this.index = -1;
  }

  /** Index after do(); -1 before. */
  getAtomIndex(): number {
    return this.index;
  }
}

export class RemoveAtomCommand extends SketchCommand {
  private snapshot: ReturnType<MoleculeGraph["getMoleculeData"]> | null = null;

  constructor(
    private readonly graph: MoleculeGraph,
    private readonly index: number,
  ) {
    super();
  }

  do(): void {
    // Snapshot full graph so undo restores bonds + indices exactly.
    this.snapshot = this.graph.getMoleculeData();
    this.graph.removeAtomInternal(this.index);
  }

  undo(): void {
    if (this.snapshot) {
      this.graph.replaceAll(this.snapshot);
      this.snapshot = null;
    }
  }
}

export class AddBondCommand extends SketchCommand {
  private index = -1;

  constructor(
    private readonly graph: MoleculeGraph,
    private readonly bond: Bond2D,
  ) {
    super();
  }

  do(): void {
    this.index = this.graph.addBondInternal(this.bond);
  }

  undo(): void {
    if (this.index < 0) return;
    this.graph.removeBondInternal(this.index);
    this.index = -1;
  }

  getBondIndex(): number {
    return this.index;
  }
}

export class RemoveBondCommand extends SketchCommand {
  private removed: Bond2D | null = null;

  constructor(
    private readonly graph: MoleculeGraph,
    private readonly index: number,
  ) {
    super();
  }

  do(): void {
    this.removed = this.graph.removeBondInternal(this.index);
  }

  undo(): void {
    if (!this.removed) return;
    // Re-insert at original index if possible by rebuilding bond list.
    const data = this.graph.getMoleculeData();
    const bonds = data.bonds;
    bonds.splice(this.index, 0, this.removed);
    this.graph.replaceAll({ atoms: data.atoms, bonds });
    this.removed = null;
  }
}
