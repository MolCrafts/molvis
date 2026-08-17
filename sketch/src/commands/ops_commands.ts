import { buildRingTemplate, type RingKind } from "../geometry/ring_template";
import { DEFAULT_BOND_LENGTH, findAtom, SNAP_RADIUS } from "../geometry/snap";
import type { MoleculeGraph } from "../molecule_graph";
import { SketchCommand } from "../sketch_command";
import type { Bond2D, MoleculeData } from "../types";

export class PlaceRingCommand extends SketchCommand {
  private before: MoleculeData | null = null;

  /**
   * @param bondLength - edge length (document units). Same as sketcher bond
   *   length; ring circumradius is derived (RDKit/OpenBabel), not free-form.
   *   The 5th ctor arg was previously misused as circumradius — call sites
   *   must pass bond length or omit for DEFAULT_BOND_LENGTH.
   */
  constructor(
    private readonly graph: MoleculeGraph,
    private readonly size: number,
    private readonly cx: number,
    private readonly cy: number,
    private readonly bondLength: number | undefined,
    private readonly kind: RingKind,
    private readonly rotationRad = -Math.PI / 2,
    private readonly clockwise = false,
    private readonly color?: string,
  ) {
    super();
  }

  do(): void {
    this.before = this.graph.getMoleculeData();
    const ring = buildRingTemplate(
      this.size,
      this.cx,
      this.cy,
      this.bondLength ?? DEFAULT_BOND_LENGTH,
      this.kind,
      this.rotationRad,
      this.clockwise,
    );
    const mergeRadius = Math.min(SNAP_RADIUS, ring.bondLength * 0.42);
    const indexMap: number[] = [];
    for (const v of ring.vertices) {
      const snap = findAtom(this.graph, v.x, v.y, mergeRadius);
      if (snap !== null) {
        indexMap.push(snap);
      } else {
        indexMap.push(
          this.graph.addAtomInternal({
            element: "C",
            x: v.x,
            y: v.y,
            ...(this.color ? { color: this.color } : {}),
          }),
        );
      }
    }
    // Benzene = Kekulé alternating single/double (edge 0,2,4 → double).
    // Aliphatic rings = all single.
    ring.edges.forEach(([a, b], edgeIdx) => {
      const i = indexMap[a];
      const j = indexMap[b];
      const order = this.kind === "benzene" ? (edgeIdx % 2 === 0 ? 2 : 1) : 1;
      const existingBond = this.graph.findBondIndex(i, j);
      if (existingBond !== null) {
        if (this.color) {
          this.graph.setBondInternal(existingBond, {
            ...this.graph.getBond(existingBond),
            color: this.color,
          });
        }
        return;
      }
      this.graph.addBondInternal({
        i,
        j,
        order,
        ...(this.color ? { color: this.color } : {}),
      });
    });
  }

  undo(): void {
    if (this.before) {
      this.graph.replaceAll(this.before);
      this.before = null;
    }
  }
}

export class CycleBondOrderCommand extends SketchCommand {
  private prevOrder = 1;
  private prevStereo: "none" | "up" | "down" | undefined;

  constructor(
    private readonly graph: MoleculeGraph,
    private readonly bondIndex: number,
  ) {
    super();
  }

  do(): void {
    const b = this.graph.getBond(this.bondIndex);
    this.prevOrder = b.order;
    this.prevStereo = b.stereo;
    const next = b.order >= 3 ? 1 : b.order + 1;
    this.graph.setBondInternal(this.bondIndex, {
      ...b,
      order: next,
      stereo: next === 1 ? b.stereo : "none",
    });
  }

  undo(): void {
    const b = this.graph.getBond(this.bondIndex);
    this.graph.setBondInternal(this.bondIndex, {
      ...b,
      order: this.prevOrder,
      stereo: this.prevStereo,
    });
  }
}

/** Replace one atom's element symbol without changing its topology. */
export class SetAtomElementCommand extends SketchCommand {
  private previous = "";

  constructor(
    private readonly graph: MoleculeGraph,
    private readonly atomIndex: number,
    private readonly element: string,
  ) {
    super();
  }

  do(): void {
    const atom = this.graph.getAtom(this.atomIndex);
    this.previous = atom.element;
    this.graph.setAtomInternal(this.atomIndex, {
      ...atom,
      element: this.element,
    });
  }

  undo(): void {
    const atom = this.graph.getAtom(this.atomIndex);
    this.graph.setAtomInternal(this.atomIndex, {
      ...atom,
      element: this.previous,
    });
  }
}

/** Set an existing bond to the active order, clearing invalid stereo. */
export class SetBondOrderCommand extends SketchCommand {
  private previousOrder = 1;
  private previousStereo: "none" | "up" | "down" | undefined;

  constructor(
    private readonly graph: MoleculeGraph,
    private readonly bondIndex: number,
    private readonly order: 1 | 2 | 3,
  ) {
    super();
  }

  do(): void {
    const bond = this.graph.getBond(this.bondIndex);
    this.previousOrder = bond.order;
    this.previousStereo = bond.stereo;
    this.graph.setBondInternal(this.bondIndex, {
      ...bond,
      order: this.order,
      stereo: this.order === 1 ? bond.stereo : "none",
    });
  }

  undo(): void {
    const bond = this.graph.getBond(this.bondIndex);
    this.graph.setBondInternal(this.bondIndex, {
      ...bond,
      order: this.previousOrder,
      stereo: this.previousStereo,
    });
  }
}

export class SetBondStereoCommand extends SketchCommand {
  private previous: Bond2D | null = null;

  constructor(
    private readonly graph: MoleculeGraph,
    private readonly bondIndex: number,
    private readonly stereo: "none" | "up" | "down",
  ) {
    super();
  }

  do(): void {
    const b = this.graph.getBond(this.bondIndex);
    this.previous = b;
    if (b.order !== 1) return;
    this.graph.setBondInternal(
      this.bondIndex,
      b.stereo === this.stereo && this.stereo !== "none"
        ? { ...b, i: b.j, j: b.i }
        : { ...b, stereo: this.stereo },
    );
  }

  undo(): void {
    if (!this.previous) return;
    this.graph.setBondInternal(this.bondIndex, this.previous);
    this.previous = null;
  }
}

export class AdjustAtomChargeCommand extends SketchCommand {
  private prev = 0;

  constructor(
    private readonly graph: MoleculeGraph,
    private readonly atomIndex: number,
    private readonly delta: number,
  ) {
    super();
  }

  do(): void {
    const a = this.graph.getAtom(this.atomIndex);
    this.prev = a.charge ?? 0;
    this.graph.setAtomInternal(this.atomIndex, {
      ...a,
      charge: this.prev + this.delta,
    });
  }

  undo(): void {
    const a = this.graph.getAtom(this.atomIndex);
    this.graph.setAtomInternal(this.atomIndex, { ...a, charge: this.prev });
  }
}

export class MoveSelectionCommand extends SketchCommand {
  private readonly atomIndices: number[];

  constructor(
    private readonly graph: MoleculeGraph,
    atomIndices: number[],
    private readonly dx: number,
    private readonly dy: number,
  ) {
    super();
    this.atomIndices = [...new Set(atomIndices)].sort((a, b) => a - b);
  }

  do(): void {
    for (const i of this.atomIndices) {
      const a = this.graph.getAtom(i);
      this.graph.setAtomInternal(i, {
        ...a,
        x: a.x + this.dx,
        y: a.y + this.dy,
      });
    }
  }

  undo(): void {
    for (const i of this.atomIndices) {
      const a = this.graph.getAtom(i);
      this.graph.setAtomInternal(i, {
        ...a,
        x: a.x - this.dx,
        y: a.y - this.dy,
      });
    }
  }
}

export class ClearDocumentCommand extends SketchCommand {
  private before: MoleculeData | null = null;

  constructor(private readonly graph: MoleculeGraph) {
    super();
  }

  do(): void {
    this.before = this.graph.getMoleculeData();
    this.graph.replaceAll({ atoms: [], bonds: [] });
  }

  undo(): void {
    if (this.before) {
      this.graph.replaceAll(this.before);
      this.before = null;
    }
  }
}
