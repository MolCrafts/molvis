import type { MoleculeGraph } from "../molecule_graph";
import { SketchCommand } from "../sketch_command";
import type { MoleculeData } from "../types";

/** Snapshot-based multi-delete of atoms and/or bonds. */
export class DeleteSelectionCommand extends SketchCommand {
  private before: MoleculeData | null = null;

  constructor(
    private readonly graph: MoleculeGraph,
    private readonly atomIndices: number[],
    private readonly bondIndices: number[],
  ) {
    super();
  }

  do(): void {
    this.before = this.graph.getMoleculeData();
    const data = this.before;
    const atomSet = new Set(this.atomIndices);
    const bondSet = new Set(this.bondIndices);
    const atoms = data.atoms.filter((_, i) => !atomSet.has(i));
    const map = new Map<number, number>();
    let ni = 0;
    for (let i = 0; i < data.atoms.length; i++) {
      if (!atomSet.has(i)) map.set(i, ni++);
    }

    const bonds = data.bonds
      .filter((b, idx) => {
        if (bondSet.has(idx)) return false;
        if (atomSet.has(b.i) || atomSet.has(b.j)) return false;
        return true;
      })
      .map((b) => {
        const i = map.get(b.i);
        const j = map.get(b.j);
        if (i === undefined || j === undefined) {
          throw new Error("DeleteSelectionCommand: remapping failed");
        }
        return { ...b, i, j };
      });

    this.graph.replaceAll({ atoms, bonds });
  }

  undo(): void {
    if (this.before) {
      this.graph.replaceAll(this.before);
      this.before = null;
    }
  }
}
